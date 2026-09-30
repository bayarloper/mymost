import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { Page, PageVerification, User } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { PageAccessService } from '../page/page-access/page-access.service';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import {
  IApprovalRejectedNotificationJob,
  IApprovalRequestedNotificationJob,
  IPageVerifiedNotificationJob,
} from '../../integrations/queue/constants/queue.interface';
import {
  AuditEvent,
  AuditEventType,
  AuditResource,
} from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import {
  ListVerificationsDto,
  PeriodUnit,
  SetupVerificationDto,
} from './dto/page-verification.dto';
import { addPeriod, computeVerificationState } from './page-verification.utils';

@Injectable()
export class PageVerificationService {
  private readonly logger = new Logger(PageVerificationService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pageAccessService: PageAccessService,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async getPage(pageId: string, workspaceId: string): Promise<Page> {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== workspaceId || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    return page;
  }

  async getInfo(page: Page, user: User) {
    await this.pageAccessService.validateCanView(page, user);

    const canManage = await this.pageAccessService
      .validateCanEdit(page, user)
      .then(() => true)
      .catch(() => false);

    const verification = await this.findByPageId(page.id);
    if (!verification) {
      return { verification: null, canManage, isVerifier: false };
    }

    const verifiers = await this.getVerifiers(verification.id);
    return {
      verification: {
        ...verification,
        state: computeVerificationState(verification),
        verifiers,
      },
      canManage,
      isVerifier: verifiers.some((v) => v.id === user.id),
    };
  }

  async setup(page: Page, user: User, dto: SetupVerificationDto) {
    await this.pageAccessService.validateCanEdit(page, user, { fresh: true });

    const verifierIds = [...new Set(dto.verifierIds)];
    await this.assertVerifiersCanAccess(page, verifierIds);

    const existing = await this.findByPageId(page.id);
    const typeChanged = existing && existing.type !== dto.type;
    const periodAmount = dto.type === 'expiring' ? dto.periodAmount : null;
    const periodUnit = dto.type === 'expiring' ? dto.periodUnit : null;

    // Keep the current verification when only settings change; recompute expiry.
    let expiresAt: Date | null = null;
    if (
      dto.type === 'expiring' &&
      existing &&
      !typeChanged &&
      existing.verifiedAt
    ) {
      expiresAt = addPeriod(
        new Date(existing.verifiedAt),
        periodAmount,
        periodUnit as PeriodUnit,
      );
    }

    const resetState = !existing || typeChanged;

    await executeTx(this.db, async (trx) => {
      let id: string;
      if (existing) {
        await trx
          .updateTable('pageVerifications')
          .set({
            type: dto.type,
            periodAmount,
            periodUnit,
            ...(resetState
              ? {
                  status: dto.type === 'approval' ? 'draft' : null,
                  verifiedAt: null,
                  verifiedById: null,
                  expiresAt: null,
                  requestedAt: null,
                  requestedById: null,
                  rejectedAt: null,
                  rejectedById: null,
                  rejectionComment: null,
                }
              : { expiresAt }),
            updatedAt: new Date(),
          })
          .where('id', '=', existing.id)
          .execute();
        id = existing.id;
      } else {
        const inserted = await trx
          .insertInto('pageVerifications')
          .values({
            pageId: page.id,
            workspaceId: page.workspaceId,
            spaceId: page.spaceId,
            type: dto.type,
            status: dto.type === 'approval' ? 'draft' : null,
            periodAmount,
            periodUnit,
            creatorId: user.id,
          })
          .returning('id')
          .executeTakeFirst();
        id = inserted.id;
      }

      await trx
        .deleteFrom('pageVerifiers')
        .where('pageVerificationId', '=', id)
        .execute();
      await trx
        .insertInto('pageVerifiers')
        .values(
          verifierIds.map((userId, index) => ({
            pageVerificationId: id,
            userId,
            isPrimary: index === 0,
            addedById: user.id,
          })),
        )
        .execute();

      return id;
    });

    this.audit(
      existing
        ? AuditEvent.PAGE_VERIFICATION_UPDATED
        : AuditEvent.PAGE_VERIFICATION_CREATED,
      page,
      { type: dto.type, periodAmount, periodUnit, verifierIds },
    );

    return this.getInfo(page, user);
  }

  async remove(page: Page, user: User) {
    await this.pageAccessService.validateCanEdit(page, user, { fresh: true });
    const existing = await this.findByPageId(page.id);
    if (!existing) return;

    await this.db
      .deleteFrom('pageVerifications')
      .where('id', '=', existing.id)
      .execute();
    this.audit(AuditEvent.PAGE_VERIFICATION_REMOVED, page, {
      type: existing.type,
    });
  }

  /** Expiring type: a verifier confirms the page is still accurate. */
  async verify(page: Page, user: User) {
    const { verification, verifierIds } = await this.loadForVerifier(
      page,
      user,
    );
    if (verification.type !== 'expiring') {
      throw new BadRequestException('Use approve for approval workflows');
    }

    const now = new Date();
    const expiresAt = addPeriod(
      now,
      verification.periodAmount ?? 1,
      (verification.periodUnit as PeriodUnit) ?? 'month',
    );

    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'verified',
        verifiedAt: now,
        verifiedById: user.id,
        expiresAt,
        updatedAt: now,
      })
      .where('id', '=', verification.id)
      .execute();

    await this.queueVerified(
      page,
      user,
      verifierIds.filter((id) => id !== user.id),
    );
    this.audit(AuditEvent.PAGE_VERIFIED, page, { expiresAt });
    return this.getInfo(page, user);
  }

  /** Approval type: an editor submits the page for approval. */
  async requestApproval(page: Page, user: User) {
    await this.pageAccessService.validateCanEdit(page, user);
    const verification = await this.findByPageIdOrThrow(page.id);
    if (verification.type !== 'approval') {
      throw new BadRequestException('This page does not use approvals');
    }
    if (verification.status === 'in_approval') {
      throw new BadRequestException('Approval has already been requested');
    }

    const now = new Date();
    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'in_approval',
        requestedAt: now,
        requestedById: user.id,
        rejectedAt: null,
        rejectedById: null,
        rejectionComment: null,
        updatedAt: now,
      })
      .where('id', '=', verification.id)
      .execute();

    const verifierIds = (await this.getVerifiers(verification.id))
      .map((v) => v.id)
      .filter((id) => id !== user.id);
    if (verifierIds.length > 0) {
      const job: IApprovalRequestedNotificationJob = {
        pageId: page.id,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
        actorId: user.id,
        verifierIds,
      };
      this.queue(QueueJob.PAGE_APPROVAL_REQUESTED_NOTIFICATION, job);
    }

    this.audit(AuditEvent.PAGE_APPROVAL_REQUESTED, page);
    return this.getInfo(page, user);
  }

  async approve(page: Page, user: User) {
    const { verification } = await this.loadForVerifier(page, user);
    if (verification.type !== 'approval') {
      throw new BadRequestException('Use verify for expiring verifications');
    }
    if (verification.status !== 'in_approval') {
      throw new BadRequestException('There is no pending approval request');
    }

    const now = new Date();
    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'approved',
        verifiedAt: now,
        verifiedById: user.id,
        updatedAt: now,
      })
      .where('id', '=', verification.id)
      .execute();

    const notify =
      verification.requestedById && verification.requestedById !== user.id
        ? [verification.requestedById]
        : [];
    await this.queueVerified(page, user, notify);
    this.audit(AuditEvent.PAGE_VERIFIED, page, { approval: true });
    return this.getInfo(page, user);
  }

  async reject(page: Page, user: User, comment?: string) {
    const { verification } = await this.loadForVerifier(page, user);
    if (verification.status !== 'in_approval') {
      throw new BadRequestException('There is no pending approval request');
    }

    const now = new Date();
    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'draft',
        rejectedAt: now,
        rejectedById: user.id,
        rejectionComment: comment?.trim() || null,
        updatedAt: now,
      })
      .where('id', '=', verification.id)
      .execute();

    if (verification.requestedById && verification.requestedById !== user.id) {
      const job: IApprovalRejectedNotificationJob = {
        pageId: page.id,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
        actorId: user.id,
        requestedById: verification.requestedById,
        comment: comment?.trim() || undefined,
      };
      this.queue(QueueJob.PAGE_APPROVAL_REJECTED_NOTIFICATION, job);
    }

    this.audit(AuditEvent.PAGE_APPROVAL_REJECTED, page);
    return this.getInfo(page, user);
  }

  async markObsolete(page: Page, user: User) {
    const { verification } = await this.loadForVerifier(page, user);
    if (verification.type !== 'approval') {
      throw new BadRequestException('Only approval workflows can be obsolete');
    }

    await this.db
      .updateTable('pageVerifications')
      .set({ status: 'obsolete', updatedAt: new Date() })
      .where('id', '=', verification.id)
      .execute();

    this.audit(AuditEvent.PAGE_MARKED_OBSOLETE, page);
    return this.getInfo(page, user);
  }

  async list(workspaceId: string, user: User, dto: ListVerificationsDto) {
    let query = this.db
      .selectFrom('pageVerifications')
      .innerJoin('pages', 'pages.id', 'pageVerifications.pageId')
      .innerJoin('spaces', 'spaces.id', 'pageVerifications.spaceId')
      .select([
        'pageVerifications.id',
        'pageVerifications.pageId',
        'pageVerifications.spaceId',
        'pageVerifications.type',
        'pageVerifications.status',
        'pageVerifications.verifiedAt',
        'pageVerifications.expiresAt',
        'pageVerifications.requestedAt',
        'pageVerifications.updatedAt',
        'pages.title as pageTitle',
        'pages.slugId as pageSlugId',
        'pages.icon as pageIcon',
        'spaces.name as spaceName',
        'spaces.slug as spaceSlug',
      ])
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('users')
            .select(['users.id', 'users.name', 'users.avatarUrl'])
            .whereRef('users.id', '=', 'pageVerifications.verifiedById'),
        ).as('verifiedBy'),
      )
      .where('pageVerifications.workspaceId', '=', workspaceId)
      .where('pages.deletedAt', 'is', null)
      .where(
        'pageVerifications.spaceId',
        'in',
        this.spaceMemberRepo.getUserSpaceIdsQuery(user.id),
      );

    if (dto.spaceId) {
      query = query.where('pageVerifications.spaceId', '=', dto.spaceId);
    }

    const now = new Date();
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    switch (dto.state) {
      case 'unverified':
        query = query
          .where('pageVerifications.type', '=', 'expiring')
          .where('pageVerifications.verifiedAt', 'is', null);
        break;
      case 'expired':
        query = query
          .where('pageVerifications.type', '=', 'expiring')
          .where('pageVerifications.expiresAt', '<=', now);
        break;
      case 'expiring':
        query = query
          .where('pageVerifications.type', '=', 'expiring')
          .where('pageVerifications.expiresAt', '>', now)
          .where('pageVerifications.expiresAt', '<=', soon);
        break;
      case 'verified':
        query = query
          .where('pageVerifications.type', '=', 'expiring')
          .where('pageVerifications.expiresAt', '>', soon);
        break;
      case 'draft':
      case 'in_approval':
      case 'approved':
      case 'obsolete':
        query = query
          .where('pageVerifications.type', '=', 'approval')
          .where('pageVerifications.status', '=', dto.state);
        break;
    }

    const result = await executeWithCursorPagination(query, {
      perPage: dto.limit,
      cursor: dto.cursor,
      beforeCursor: dto.beforeCursor,
      fields: [
        { expression: 'pageVerifications.id', direction: 'desc', key: 'id' },
      ],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });

    // Hide pages the user cannot open (page-level restrictions).
    const accessible = new Set(
      await this.pagePermissionRepo.filterAccessiblePageIds({
        pageIds: result.items.map((i) => i.pageId),
        userId: user.id,
      }),
    );

    return {
      items: result.items
        .filter((item) => accessible.has(item.pageId))
        .map((item) => ({ ...item, state: computeVerificationState(item) })),
      meta: result.meta,
    };
  }

  // ---------------------------------------------------------------------------

  private async findByPageId(pageId: string): Promise<PageVerification> {
    return this.db
      .selectFrom('pageVerifications')
      .selectAll()
      .where('pageId', '=', pageId)
      .executeTakeFirst();
  }

  private async findByPageIdOrThrow(pageId: string) {
    const verification = await this.findByPageId(pageId);
    if (!verification) {
      throw new NotFoundException('This page has no verification set up');
    }
    return verification;
  }

  private async getVerifiers(verificationId: string) {
    return this.db
      .selectFrom('pageVerifiers')
      .innerJoin('users', 'users.id', 'pageVerifiers.userId')
      .select([
        'users.id',
        'users.name',
        'users.email',
        'users.avatarUrl',
        'pageVerifiers.isPrimary',
      ])
      .where('pageVerifiers.pageVerificationId', '=', verificationId)
      .orderBy('pageVerifiers.isPrimary', 'desc')
      .orderBy('users.name', 'asc')
      .execute();
  }

  private async loadForVerifier(page: Page, user: User) {
    await this.pageAccessService.validateCanView(page, user);
    const verification = await this.findByPageIdOrThrow(page.id);
    const verifierIds = (await this.getVerifiers(verification.id)).map(
      (v) => v.id,
    );
    if (!verifierIds.includes(user.id)) {
      throw new ForbiddenException('Only verifiers of this page can do this');
    }
    return { verification, verifierIds };
  }

  private async assertVerifiersCanAccess(page: Page, verifierIds: string[]) {
    const inSpace = await this.spaceMemberRepo.getUserIdsWithSpaceAccess(
      verifierIds,
      page.spaceId,
    );
    const withPageAccess = new Set(
      await this.pagePermissionRepo.getUserIdsWithPageAccess(page.id, [
        ...inSpace,
      ]),
    );
    if (verifierIds.some((id) => !withPageAccess.has(id))) {
      throw new BadRequestException(
        'Verifiers must be able to access this page',
      );
    }
  }

  private async queueVerified(page: Page, user: User, verifierIds: string[]) {
    if (verifierIds.length === 0) return;
    const job: IPageVerifiedNotificationJob = {
      pageId: page.id,
      spaceId: page.spaceId,
      workspaceId: page.workspaceId,
      actorId: user.id,
      verifierIds,
    };
    this.queue(QueueJob.PAGE_VERIFIED_NOTIFICATION, job);
  }

  private queue(name: string, data: object) {
    this.notificationQueue
      .add(name, data)
      .catch((err) =>
        this.logger.warn(`Failed to queue ${name}: ${(err as Error)?.message}`),
      );
  }

  private audit(
    event: AuditEventType,
    page: Page,
    metadata: Record<string, unknown> = {},
  ) {
    this.auditService.log({
      event,
      resourceType: AuditResource.PAGE,
      resourceId: page.id,
      spaceId: page.spaceId,
      metadata,
    });
  }
}

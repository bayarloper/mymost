import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { Page, User } from '@docmost/db/types/entity.types';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { PageAccessService } from '../page-access/page-access.service';
import { WsService } from '../../../ws/ws.service';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';
import { PagePermissionRole } from './dto/page-permission.dto';

export const RESTRICTED_ACCESS_LEVEL = 'restricted';

type Target = { userId?: string; groupId?: string };

@Injectable()
export class PagePermissionService {
  constructor(
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly pageRepo: PageRepo,
    private readonly groupRepo: GroupRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly wsService: WsService,
    @InjectKysely() private readonly db: KyselyDB,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async getPage(pageId: string, workspaceId: string): Promise<Page> {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== workspaceId || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    return page;
  }

  /** Managing access requires edit rights on the page (page writer when restricted). */
  async assertCanManage(page: Page, user: User): Promise<void> {
    // Never authorize access changes from a cached permission decision.
    await this.pageAccessService.validateCanEdit(page, user, { fresh: true });
  }

  async getInfo(page: Page, user: User) {
    await this.pageAccessService.validateCanView(page, user);

    const [pageAccess, restrictedAncestor, canManage] = await Promise.all([
      this.pagePermissionRepo.findPageAccessByPageId(page.id),
      this.pagePermissionRepo.findRestrictedAncestor(page.id),
      this.pageAccessService
        .validateCanEdit(page, user, { fresh: true })
        .then(() => true)
        .catch(() => false),
    ]);

    let inheritedFrom: { id: string; slugId: string; title: string } | null =
      null;
    if (restrictedAncestor && restrictedAncestor.depth > 0) {
      const ancestor = await this.pageRepo.findById(restrictedAncestor.pageId);
      if (ancestor) {
        inheritedFrom = {
          id: ancestor.id,
          slugId: ancestor.slugId,
          title: ancestor.title,
        };
      }
    }

    return {
      pageId: page.id,
      isRestricted: !!pageAccess,
      inheritedFrom,
      canManage,
    };
  }

  async restrict(page: Page, user: User): Promise<void> {
    await this.assertCanManage(page, user);

    const existing = await this.pagePermissionRepo.findPageAccessByPageId(
      page.id,
    );
    if (existing) return;

    await executeTx(this.db, async (trx) => {
      const pageAccess = await this.pagePermissionRepo.insertPageAccess(
        {
          pageId: page.id,
          workspaceId: page.workspaceId,
          spaceId: page.spaceId,
          accessLevel: RESTRICTED_ACCESS_LEVEL,
          creatorId: user.id,
        },
        trx,
      );

      // The person restricting the page keeps edit access so nobody gets locked out.
      await this.pagePermissionRepo.insertPagePermissions(
        [
          {
            pageAccessId: pageAccess.id,
            userId: user.id,
            role: 'writer',
            addedById: user.id,
          },
        ],
        trx,
      );
    });

    await this.afterChange(page, [user.id]);
    this.audit(AuditEvent.PAGE_RESTRICTED, page);
  }

  async unrestrict(page: Page, user: User): Promise<void> {
    await this.assertCanManage(page, user);
    await this.pagePermissionRepo.deletePageAccess(page.id);
    await this.afterChange(page);
    this.audit(AuditEvent.PAGE_RESTRICTION_REMOVED, page);
  }

  async listMembers(page: Page, user: User, pagination: PaginationOptions) {
    await this.pageAccessService.validateCanView(page, user);
    const pageAccess = await this.pagePermissionRepo.findPageAccessByPageId(
      page.id,
    );
    if (!pageAccess) {
      return {
        items: [],
        meta: {
          limit: pagination.limit,
          hasNextPage: false,
          hasPrevPage: false,
          nextCursor: null,
          prevCursor: null,
        },
      };
    }
    return this.pagePermissionRepo.getPagePermissionsPaginated(
      pageAccess.id,
      pagination,
    );
  }

  async addMembers(
    page: Page,
    user: User,
    input: {
      userIds?: string[];
      groupIds?: string[];
      role: PagePermissionRole;
    },
  ): Promise<void> {
    await this.assertCanManage(page, user);
    const pageAccess = await this.getRestrictionOrThrow(page.id);

    const userIds = [...new Set(input.userIds ?? [])];
    const groupIds = [...new Set(input.groupIds ?? [])];
    if (userIds.length === 0 && groupIds.length === 0) {
      throw new BadRequestException('Select at least one user or group');
    }

    // Page access only makes sense for people who can see the space.
    if (userIds.length > 0) {
      const inSpace = await this.spaceMemberRepo.getUserIdsWithSpaceAccess(
        userIds,
        page.spaceId,
      );
      if (userIds.some((id) => !inSpace.has(id))) {
        throw new BadRequestException(
          'Only members of this space can be given access to the page',
        );
      }
    }

    for (const groupId of groupIds) {
      const group = await this.groupRepo.findById(groupId, page.workspaceId);
      if (!group) {
        throw new BadRequestException('Group not found');
      }
    }

    const added: Target[] = [];
    await executeTx(this.db, async (trx) => {
      const rows = [];
      for (const userId of userIds) {
        const exists = await this.pagePermissionRepo.findPagePermissionByUserId(
          pageAccess.id,
          userId,
          trx,
        );
        if (!exists) {
          rows.push({
            pageAccessId: pageAccess.id,
            userId,
            role: input.role,
            addedById: user.id,
          });
          added.push({ userId });
        }
      }
      for (const groupId of groupIds) {
        const exists =
          await this.pagePermissionRepo.findPagePermissionByGroupId(
            pageAccess.id,
            groupId,
            trx,
          );
        if (!exists) {
          rows.push({
            pageAccessId: pageAccess.id,
            groupId,
            role: input.role,
            addedById: user.id,
          });
          added.push({ groupId });
        }
      }
      await this.pagePermissionRepo.insertPagePermissions(rows, trx);
    });

    await this.afterChange(
      page,
      added.filter((a) => a.userId).map((a) => a.userId),
    );
    for (const target of added) {
      this.audit(AuditEvent.PAGE_PERMISSION_ADDED, page, {
        ...target,
        role: input.role,
      });
    }
  }

  async removeMember(page: Page, user: User, target: Target): Promise<void> {
    await this.assertCanManage(page, user);
    const pageAccess = await this.getRestrictionOrThrow(page.id);
    const permission = await this.findPermissionOrThrow(pageAccess.id, target);

    if (permission.role === 'writer') {
      await this.assertNotLastWriter(pageAccess.id);
    }

    if (target.userId) {
      await this.pagePermissionRepo.deletePagePermissionByUserId(
        pageAccess.id,
        target.userId,
      );
    } else {
      await this.pagePermissionRepo.deletePagePermissionByGroupId(
        pageAccess.id,
        target.groupId,
      );
    }

    await this.afterChange(page, target.userId ? [target.userId] : []);
    this.audit(AuditEvent.PAGE_PERMISSION_REMOVED, page, { ...target });
  }

  async updateRole(
    page: Page,
    user: User,
    target: Target,
    role: PagePermissionRole,
  ): Promise<void> {
    await this.assertCanManage(page, user);
    const pageAccess = await this.getRestrictionOrThrow(page.id);
    const permission = await this.findPermissionOrThrow(pageAccess.id, target);

    if (permission.role === role) return;
    if (permission.role === 'writer' && role !== 'writer') {
      await this.assertNotLastWriter(pageAccess.id);
    }

    await this.pagePermissionRepo.updatePagePermissionRole(
      pageAccess.id,
      role,
      target,
    );

    await this.afterChange(page, target.userId ? [target.userId] : []);
    this.audit(AuditEvent.PAGE_PERMISSION_ROLE_CHANGED, page, {
      ...target,
      before: permission.role,
      after: role,
    });
  }

  private async getRestrictionOrThrow(pageId: string) {
    const pageAccess =
      await this.pagePermissionRepo.findPageAccessByPageId(pageId);
    if (!pageAccess) {
      throw new BadRequestException('This page is not restricted');
    }
    return pageAccess;
  }

  private async findPermissionOrThrow(pageAccessId: string, target: Target) {
    if (!!target.userId === !!target.groupId) {
      throw new BadRequestException('Provide either a userId or a groupId');
    }
    const permission = target.userId
      ? await this.pagePermissionRepo.findPagePermissionByUserId(
          pageAccessId,
          target.userId,
        )
      : await this.pagePermissionRepo.findPagePermissionByGroupId(
          pageAccessId,
          target.groupId,
        );
    if (!permission) {
      throw new NotFoundException('Member not found');
    }
    return permission;
  }

  private async assertNotLastWriter(pageAccessId: string) {
    const writers =
      await this.pagePermissionRepo.countWritersByPageAccessId(pageAccessId);
    if (writers <= 1) {
      throw new BadRequestException(
        'A restricted page must keep at least one member with edit access',
      );
    }
  }

  private async afterChange(page: Page, affectedUserIds: string[] = []) {
    await this.wsService.invalidateSpaceRestrictionCache(page.spaceId);
    // Cached per-user decisions otherwise linger for PERMISSION_CACHE_TTL_MS.
    await this.pagePermissionRepo.invalidateCanEditCache(
      affectedUserIds,
      page.id,
    );
  }

  private audit(
    event: string,
    page: Page,
    metadata: Record<string, unknown> = {},
  ) {
    this.auditService.log({
      event: event as any,
      resourceType: AuditResource.PAGE,
      resourceId: page.id,
      spaceId: page.spaceId,
      metadata,
    });
  }
}

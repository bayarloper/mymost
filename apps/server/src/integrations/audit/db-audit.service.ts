import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { ClsService } from 'nestjs-cls';
import { sql } from 'kysely';
import { validate as isValidUUID } from 'uuid';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InsertableAudit } from '@docmost/db/types/entity.types';
import {
  ActorType,
  AuditEvent,
  AuditLogPayload,
  EXCLUDED_AUDIT_EVENTS,
} from '../../common/events/audit-events';
import {
  AUDIT_CONTEXT_KEY,
  AuditContext,
} from '../../common/middlewares/audit-context.middleware';
import { AuditLogContext, IAuditService } from './audit.service';

const MAX_USER_AGENT_LENGTH = 512;

/**
 * Persists audit events to the `audit` table. Request metadata (workspace,
 * actor, IP, user agent) comes from the CLS audit context set by
 * AuditContextMiddleware / AuditActorInterceptor, or from an explicit context
 * for background jobs. Writes are fire-and-forget so auditing never breaks the
 * action being audited.
 */
@Injectable()
export class DbAuditService implements IAuditService {
  private readonly logger = new Logger(DbAuditService.name);
  private readonly excluded = EXCLUDED_AUDIT_EVENTS;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly cls: ClsService,
  ) {}

  log(payload: AuditLogPayload): void {
    const context = this.getClsContext();
    if (!context?.workspaceId) return;

    this.write([payload], {
      workspaceId: context.workspaceId,
      actorId: context.actorId ?? undefined,
      actorType: context.actorType,
      ipAddress: context.ipAddress ?? undefined,
      userAgent: context.userAgent ?? undefined,
    });
  }

  logWithContext(payload: AuditLogPayload, context: AuditLogContext): void {
    this.write([payload], context);
  }

  logBatchWithContext(
    payloads: AuditLogPayload[],
    context: AuditLogContext,
  ): void {
    this.write(payloads, context);
  }

  setActorId(actorId: string): void {
    const context = this.getClsContext();
    if (context) context.actorId = actorId;
  }

  setActorType(actorType: ActorType): void {
    const context = this.getClsContext();
    if (context) context.actorType = actorType;
  }

  async updateRetention(
    workspaceId: string,
    retentionDays: number,
  ): Promise<void> {
    await this.db
      .updateTable('workspaces')
      .set({ auditRetentionDays: retentionDays })
      .where('id', '=', workspaceId)
      .execute();
  }

  private getClsContext(): AuditContext | undefined {
    try {
      if (!this.cls.isActive()) return undefined;
      return this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
    } catch {
      return undefined;
    }
  }

  private write(payloads: AuditLogPayload[], context: AuditLogContext) {
    if (!context?.workspaceId) return;

    const rows: InsertableAudit[] = payloads
      .filter((p) => p && !this.excluded.has(p.event))
      .map((p) => this.toRow(p, context));

    if (rows.length === 0) return;

    this.db
      .insertInto('audit')
      .values(rows)
      .execute()
      .catch((err) =>
        this.logger.error(
          `Failed to write audit log: ${(err as Error)?.message}`,
        ),
      );
  }

  private toRow(
    payload: AuditLogPayload,
    context: AuditLogContext,
  ): InsertableAudit {
    const metadata: Record<string, unknown> = { ...(payload.metadata ?? {}) };

    // resource_id / space_id are uuid columns; keep other identifiers in metadata.
    let resourceId: string | null = payload.resourceId ?? null;
    if (resourceId && !isValidUUID(resourceId)) {
      metadata.resourceKey = resourceId;
      resourceId = null;
    }
    const spaceId =
      payload.spaceId && isValidUUID(payload.spaceId) ? payload.spaceId : null;

    // Unauthenticated events (e.g. sign-in) are attributed to the user they concern.
    let actorId = context.actorId ?? null;
    if (!actorId && payload.event === AuditEvent.USER_LOGIN && resourceId) {
      actorId = resourceId;
    }

    return {
      workspaceId: context.workspaceId,
      actorId: actorId && isValidUUID(actorId) ? actorId : null,
      actorType: context.actorType ?? 'user',
      event: payload.event,
      resourceType: payload.resourceType,
      resourceId,
      spaceId,
      changes: payload.changes
        ? sql`${JSON.stringify(payload.changes)}::text::jsonb`
        : null,
      metadata:
        Object.keys(metadata).length > 0
          ? sql`${JSON.stringify(metadata)}::text::jsonb`
          : null,
      ipAddress: normalizeIp(context.ipAddress),
      userAgent: context.userAgent
        ? context.userAgent.slice(0, MAX_USER_AGENT_LENGTH)
        : null,
    } as InsertableAudit;
  }
}

function normalizeIp(ip?: string | null): string | null {
  if (!ip) return null;
  const value = ip.trim();
  // inet column: accept plain IPv4/IPv6 only.
  if (/^[0-9a-fA-F:.]+$/.test(value) && value.length <= 45) return value;
  return null;
}

import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ListAuditLogsDto } from './dto/audit.dto';

export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
const CLEANUP_BATCH_SIZE = 5000;

/**
 * Smallest UUIDv7 for a timestamp. Audit ids are UUIDv7, so `id < floor(t)`
 * selects rows created before t using the (workspace_id, id) index.
 */
export function uuidV7Floor(date: Date): string {
  const hex = date.getTime().toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async list(workspaceId: string, dto: ListAuditLogsDto) {
    let query = this.db
      .selectFrom('audit')
      .select([
        'audit.id',
        'audit.event',
        'audit.resourceType',
        'audit.resourceId',
        'audit.spaceId',
        'audit.actorId',
        'audit.actorType',
        'audit.changes',
        'audit.metadata',
        'audit.ipAddress',
        'audit.userAgent',
        'audit.createdAt',
      ])
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('users')
            .select([
              'users.id',
              'users.name',
              'users.email',
              'users.avatarUrl',
            ])
            .whereRef('users.id', '=', 'audit.actorId'),
        ).as('actor'),
      )
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('spaces')
            .select(['spaces.id', 'spaces.name', 'spaces.slug'])
            .whereRef('spaces.id', '=', 'audit.spaceId'),
        ).as('space'),
      )
      .where('audit.workspaceId', '=', workspaceId);

    if (dto.event) query = query.where('audit.event', '=', dto.event);
    if (dto.eventPrefix) {
      // Exact category match; LIKE would treat '_' in e.g. "api_key" as a wildcard.
      query = query.where(
        sql<string>`split_part(audit.event, '.', 1)`,
        '=',
        dto.eventPrefix,
      );
    }
    if (dto.actorId) query = query.where('audit.actorId', '=', dto.actorId);
    if (dto.resourceType) {
      query = query.where('audit.resourceType', '=', dto.resourceType);
    }
    if (dto.spaceId) query = query.where('audit.spaceId', '=', dto.spaceId);
    if (dto.startDate) {
      query = query.where('audit.createdAt', '>=', new Date(dto.startDate));
    }
    if (dto.endDate) {
      query = query.where('audit.createdAt', '<=', new Date(dto.endDate));
    }

    return executeWithCursorPagination(query, {
      perPage: dto.limit,
      cursor: dto.cursor,
      beforeCursor: dto.beforeCursor,
      fields: [{ expression: 'audit.id', direction: 'desc', key: 'id' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
  }

  async getRetentionDays(workspaceId: string): Promise<number> {
    const row = await this.db
      .selectFrom('workspaces')
      .select('auditRetentionDays')
      .where('id', '=', workspaceId)
      .executeTakeFirst();
    return row?.auditRetentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
  }

  /** Deletes audit rows older than each workspace's retention (0 = keep forever). */
  @Interval('audit-cleanup', 24 * 60 * 60 * 1000)
  async cleanup() {
    try {
      const workspaces = await this.db
        .selectFrom('workspaces')
        .select(['id', 'auditRetentionDays'])
        .where('deletedAt', 'is', null)
        .execute();

      let total = 0;
      for (const workspace of workspaces) {
        const days =
          workspace.auditRetentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
        if (!days || days <= 0) continue;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        // Batched deletes keep transactions and locks short on large tables.
        for (;;) {
          const result = await sql<{ count: number }>`
            WITH doomed AS (
              SELECT id FROM audit
              WHERE workspace_id = ${workspace.id}::uuid AND id < ${uuidV7Floor(cutoff)}::uuid
              LIMIT ${CLEANUP_BATCH_SIZE}
            )
            DELETE FROM audit WHERE id IN (SELECT id FROM doomed)
          `.execute(this.db);
          const deleted = Number(result.numAffectedRows ?? 0);
          total += deleted;
          if (deleted < CLEANUP_BATCH_SIZE) break;
        }
      }

      if (total > 0) {
        this.logger.log(`Audit cleanup removed ${total} entries`);
      }
    } catch (err) {
      this.logger.error(
        'Audit cleanup failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}

import { DbAuditService } from './db-audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';

function setup(context?: Record<string, unknown>) {
  const inserted: any[] = [];
  const db = {
    insertInto: jest.fn(() => ({
      values: (rows: any[]) => {
        inserted.push(...rows);
        return { execute: () => Promise.resolve() };
      },
    })),
  };
  const cls = {
    isActive: () => context !== undefined,
    get: () => context,
  };
  const service = new DbAuditService(db as any, cls as any);
  return { service, inserted, db };
}

const ctx = {
  workspaceId: '01a0ecce-41bd-70b0-a22a-269a367f6c5f',
  actorId: '01a0ecce-41b6-7ad1-bd48-6e3ae29e2394',
  actorType: 'user',
  ipAddress: '10.0.0.5',
  userAgent: 'jest',
};

describe('DbAuditService', () => {
  it('writes events with the request context', () => {
    const { service, inserted } = setup({ ...ctx });
    service.log({
      event: AuditEvent.SPACE_CREATED,
      resourceType: AuditResource.SPACE,
      resourceId: '01a0ece6-f143-771b-8f71-3a57a86a3bf2',
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      workspaceId: ctx.workspaceId,
      actorId: ctx.actorId,
      event: 'space.created',
      ipAddress: '10.0.0.5',
      userAgent: 'jest',
    });
  });

  it('skips excluded noisy events', () => {
    const { service, inserted } = setup({ ...ctx });
    service.log({
      event: AuditEvent.PAGE_CREATED,
      resourceType: AuditResource.PAGE,
    });
    expect(inserted).toHaveLength(0);
  });

  it('does nothing outside a request without explicit context', () => {
    const { service, inserted } = setup(undefined);
    service.log({
      event: AuditEvent.SPACE_CREATED,
      resourceType: AuditResource.SPACE,
    });
    expect(inserted).toHaveLength(0);
  });

  it('uses an explicit context for background jobs', () => {
    const { service, inserted } = setup(undefined);
    service.logWithContext(
      { event: AuditEvent.SPACE_DELETED, resourceType: AuditResource.SPACE },
      { workspaceId: ctx.workspaceId, actorType: 'system' },
    );
    expect(inserted[0]).toMatchObject({
      workspaceId: ctx.workspaceId,
      actorType: 'system',
      actorId: null,
    });
  });

  it('moves non-uuid resource ids to metadata and drops bad IPs', () => {
    const { service, inserted } = setup({ ...ctx, ipAddress: 'not-an-ip' });
    service.log({
      event: AuditEvent.SHARE_CREATED,
      resourceType: AuditResource.SHARE,
      resourceId: 'abc123key',
    });
    expect(inserted[0].resourceId).toBeNull();
    expect(inserted[0].ipAddress).toBeNull();
  });

  it('attributes sign-ins to the signed-in user', () => {
    const { service, inserted } = setup({ ...ctx, actorId: null });
    service.log({
      event: AuditEvent.USER_LOGIN,
      resourceType: AuditResource.USER,
      resourceId: ctx.actorId,
    });
    expect(inserted[0].actorId).toBe(ctx.actorId);
  });

  it('setActorId / setActorType update the request context', () => {
    const context = { ...ctx, actorId: null };
    const { service } = setup(context);
    service.setActorId(ctx.actorId);
    service.setActorType('api_key');
    expect(context).toMatchObject({
      actorId: ctx.actorId,
      actorType: 'api_key',
    });
  });
});

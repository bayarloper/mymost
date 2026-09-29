import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PageVerificationService } from './page-verification.service';
import { addPeriod, computeVerificationState } from './page-verification.utils';

describe('page verification utils', () => {
  const base = new Date('2026-01-31T10:00:00Z');

  it('adds periods', () => {
    expect(addPeriod(base, 3, 'day').toISOString()).toBe(
      '2026-02-03T10:00:00.000Z',
    );
    expect(addPeriod(base, 2, 'week').toISOString()).toBe(
      '2026-02-14T10:00:00.000Z',
    );
    expect(addPeriod(base, 1, 'year').toISOString()).toBe(
      '2027-01-31T10:00:00.000Z',
    );
  });

  it('computes expiring states', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const v = (
      expiresAt: string | null,
      verifiedAt: string | null = '2026-01-01',
    ) => ({
      type: 'expiring',
      status: null,
      verifiedAt,
      expiresAt,
    });
    expect(computeVerificationState(v(null, null), now)).toBe('unverified');
    expect(computeVerificationState(v('2026-05-31T00:00:00Z'), now)).toBe(
      'expired',
    );
    expect(computeVerificationState(v('2026-06-05T00:00:00Z'), now)).toBe(
      'expiring',
    );
    expect(computeVerificationState(v('2026-08-01T00:00:00Z'), now)).toBe(
      'verified',
    );
  });

  it('computes approval states', () => {
    const v = (status: string | null) => ({
      type: 'approval',
      status,
      verifiedAt: null,
      expiresAt: null,
    });
    expect(computeVerificationState(v('in_approval'))).toBe('in_approval');
    expect(computeVerificationState(v(null))).toBe('draft');
  });
});

describe('PageVerificationService', () => {
  const page = { id: 'p1', spaceId: 's1', workspaceId: 'w1' } as any;
  const verifier = { id: 'v1' } as any;
  const other = { id: 'u2' } as any;

  function setup(verification: any, verifierIds: string[] = ['v1']) {
    const updates: any[] = [];
    const chain = (result: any) => {
      const q: any = {
        select: () => q,
        selectAll: () => q,
        innerJoin: () => q,
        where: () => q,
        orderBy: () => q,
        set: (v: any) => {
          updates.push(v);
          return q;
        },
        execute: () => Promise.resolve(result),
        executeTakeFirst: () => Promise.resolve(result),
      };
      return q;
    };
    const db = {
      selectFrom: (table: string) =>
        table === 'pageVerifiers'
          ? chain(verifierIds.map((id) => ({ id })))
          : chain(verification),
      updateTable: () => chain(undefined),
      deleteFrom: () => chain(undefined),
    };
    const pageAccessService = {
      validateCanView: jest.fn().mockResolvedValue(undefined),
      validateCanEdit: jest.fn().mockResolvedValue({ hasRestriction: false }),
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new PageVerificationService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      pageAccessService as any,
      queue as any,
      { log: jest.fn() } as any,
    );
    return { service, updates, queue };
  }

  it('only verifiers can verify', async () => {
    const { service } = setup({ id: 'ver1', type: 'expiring' });
    await expect(service.verify(page, other)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('verify sets the expiry from the configured period', async () => {
    const { service, updates } = setup({
      id: 'ver1',
      type: 'expiring',
      periodAmount: 2,
      periodUnit: 'week',
    });
    const before = Date.now();
    await service.verify(page, verifier);
    const set = updates.find((u) => u.status === 'verified');
    const expected = before + 14 * 24 * 60 * 60 * 1000;
    expect(Math.abs(set.expiresAt.getTime() - expected)).toBeLessThan(5000);
    expect(set.verifiedById).toBe('v1');
  });

  it('cannot approve without a pending request', async () => {
    const { service } = setup({
      id: 'ver1',
      type: 'approval',
      status: 'draft',
    });
    await expect(service.approve(page, verifier)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reject returns the page to draft and notifies the requester', async () => {
    const { service, updates, queue } = setup({
      id: 'ver1',
      type: 'approval',
      status: 'in_approval',
      requestedById: 'u2',
    });
    await service.reject(page, verifier, 'needs sources');
    expect(updates.find((u) => u.status === 'draft')).toMatchObject({
      rejectionComment: 'needs sources',
    });
    expect(queue.add).toHaveBeenCalledWith(
      'page-approval-rejected-notification',
      expect.objectContaining({
        requestedById: 'u2',
        comment: 'needs sources',
      }),
    );
  });

  it('cannot request approval twice', async () => {
    const { service } = setup({
      id: 'ver1',
      type: 'approval',
      status: 'in_approval',
    });
    await expect(service.requestApproval(page, other)).rejects.toThrow(
      'Approval has already been requested',
    );
  });
});

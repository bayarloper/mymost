import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PagePermissionService } from './page-permission.service';

const page = {
  id: 'page-1',
  workspaceId: 'ws-1',
  spaceId: 'space-1',
  deletedAt: null,
} as any;
const user = { id: 'u-1' } as any;

function setup(opts: {
  canEdit?: boolean;
  pageAccess?: any;
  permission?: any;
  writers?: number;
  inSpace?: string[];
}) {
  const repo = {
    findPageAccessByPageId: jest.fn().mockResolvedValue(opts.pageAccess),
    insertPageAccess: jest.fn().mockResolvedValue({ id: 'pa-1' }),
    deletePageAccess: jest.fn(),
    insertPagePermissions: jest.fn(),
    findPagePermissionByUserId: jest.fn().mockResolvedValue(opts.permission),
    findPagePermissionByGroupId: jest.fn().mockResolvedValue(opts.permission),
    deletePagePermissionByUserId: jest.fn(),
    deletePagePermissionByGroupId: jest.fn(),
    updatePagePermissionRole: jest.fn(),
    countWritersByPageAccessId: jest.fn().mockResolvedValue(opts.writers ?? 1),
    invalidateCanEditCache: jest.fn(),
  };
  const pageAccessService = {
    validateCanEdit: jest.fn(() =>
      opts.canEdit === false
        ? Promise.reject(new ForbiddenException())
        : Promise.resolve({ hasRestriction: false }),
    ),
    validateCanView: jest.fn().mockResolvedValue(undefined),
  };
  const spaceMemberRepo = {
    getUserIdsWithSpaceAccess: jest
      .fn()
      .mockResolvedValue(new Set(opts.inSpace ?? [])),
  };
  const groupRepo = { findById: jest.fn().mockResolvedValue({ id: 'g-1' }) };
  const wsService = { invalidateSpaceRestrictionCache: jest.fn() };
  const db = { transaction: () => ({ execute: (cb: any) => cb({}) }) };
  const auditService = { log: jest.fn() };

  const service = new PagePermissionService(
    repo as any,
    {} as any,
    groupRepo as any,
    spaceMemberRepo as any,
    pageAccessService as any,
    wsService as any,
    db as any,
    auditService as any,
  );
  return { service, repo, wsService, pageAccessService };
}

describe('PagePermissionService', () => {
  it('restricting a page adds the caller as writer', async () => {
    const { service, repo, wsService } = setup({});
    await service.restrict(page, user);
    expect(repo.insertPageAccess).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'page-1', creatorId: 'u-1' }),
      expect.anything(),
    );
    expect(repo.insertPagePermissions).toHaveBeenCalledWith(
      [expect.objectContaining({ userId: 'u-1', role: 'writer' })],
      expect.anything(),
    );
    expect(wsService.invalidateSpaceRestrictionCache).toHaveBeenCalledWith(
      'space-1',
    );
  });

  it('requires edit rights to manage access', async () => {
    const { service, repo } = setup({ canEdit: false });
    await expect(service.restrict(page, user)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.unrestrict(page, user)).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.deletePageAccess).not.toHaveBeenCalled();
  });

  it('authorizes access changes with a fresh (uncached) permission check', async () => {
    const { service, pageAccessService } = setup({});
    await service.unrestrict(page, user);
    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(page, user, {
      fresh: true,
    });
  });

  it('clears the cached decision of a removed member', async () => {
    const { service, repo } = setup({
      pageAccess: { id: 'pa-1' },
      permission: { role: 'reader' },
    });
    await service.removeMember(page, user, { userId: 'u-2' });
    expect(repo.invalidateCanEditCache).toHaveBeenCalledWith(['u-2'], 'page-1');
  });

  it('refuses to remove the last writer', async () => {
    const { service, repo } = setup({
      pageAccess: { id: 'pa-1' },
      permission: { role: 'writer' },
      writers: 1,
    });
    await expect(
      service.removeMember(page, user, { userId: 'u-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.deletePagePermissionByUserId).not.toHaveBeenCalled();
  });

  it('refuses to demote the last writer', async () => {
    const { service, repo } = setup({
      pageAccess: { id: 'pa-1' },
      permission: { role: 'writer' },
      writers: 1,
    });
    await expect(
      service.updateRole(page, user, { userId: 'u-1' }, 'reader'),
    ).rejects.toThrow(BadRequestException);
    expect(repo.updatePagePermissionRole).not.toHaveBeenCalled();
  });

  it('allows removing a writer when another writer remains', async () => {
    const { service, repo } = setup({
      pageAccess: { id: 'pa-1' },
      permission: { role: 'writer' },
      writers: 2,
    });
    await service.removeMember(page, user, { userId: 'u-2' });
    expect(repo.deletePagePermissionByUserId).toHaveBeenCalledWith(
      'pa-1',
      'u-2',
    );
  });

  it('only adds members of the space', async () => {
    const { service, repo } = setup({
      pageAccess: { id: 'pa-1' },
      inSpace: ['u-2'],
    });
    await expect(
      service.addMembers(page, user, {
        userIds: ['u-2', 'u-outsider'],
        role: 'reader',
      }),
    ).rejects.toThrow('Only members of this space');
    expect(repo.insertPagePermissions).not.toHaveBeenCalled();
  });

  it('cannot add members to an unrestricted page', async () => {
    const { service } = setup({ pageAccess: undefined, inSpace: ['u-2'] });
    await expect(
      service.addMembers(page, user, { userIds: ['u-2'], role: 'reader' }),
    ).rejects.toThrow('This page is not restricted');
  });

  it('rejects a target with both or neither user and group', async () => {
    const { service } = setup({ pageAccess: { id: 'pa-1' } });
    await expect(service.removeMember(page, user, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('404s when the member does not exist', async () => {
    const { service } = setup({
      pageAccess: { id: 'pa-1' },
      permission: undefined,
    });
    await expect(
      service.removeMember(page, user, { userId: 'u-9' }),
    ).rejects.toThrow(NotFoundException);
  });
});

import { JwtService } from '@nestjs/jwt';
import { TokenService } from '../auth/services/token.service';
import { hashPassword } from '../../common/helpers';
import {
  SHARE_PASSWORD_REQUIRED,
  ShareAccessService,
  SharePasswordRequiredException,
} from './share-access.service';

const APP_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

function setup() {
  const hashes = new Map<string, string | null>();
  // pageId -> protected share rooted at that page
  const protectedByPage = new Map<string, any>();
  const shareRepo = {
    findPasswordHash: jest.fn(async (id: string) => hashes.get(id) ?? null),
    findProtectedByPageIds: jest.fn(async (pageIds: string[]) =>
      pageIds
        .map((id) => protectedByPage.get(id))
        .filter((s) => s && hashes.get(s.id))
        .map((s) => ({ ...s, passwordHash: hashes.get(s.id) })),
    ),
    setPasswordHash: jest.fn(async (id: string, hash: string | null) => {
      hashes.set(id, hash);
    }),
  };
  const environmentService = {
    getAppSecret: () => APP_SECRET,
    isHttps: () => false,
  };
  const tokenService = new TokenService(
    new JwtService({ secret: APP_SECRET }),
    environmentService as any,
  );
  const service = new ShareAccessService(
    shareRepo as any,
    tokenService,
    environmentService as any,
  );

  // Minimal Fastify reply/request doubles sharing a cookie jar.
  const jar: Record<string, string> = {};
  const res = {
    setCookie: jest.fn((name: string, value: string) => {
      jar[name] = value;
    }),
  } as any;
  const req = () => ({ cookies: { ...jar } }) as any;

  return {
    service,
    shareRepo,
    hashes,
    protectedByPage,
    res,
    req,
    jar,
    tokenService,
  };
}

const shareA = { id: 'share-a', key: 'keya', workspaceId: 'ws-1' };
const shareB = { id: 'share-b', key: 'keyb', workspaceId: 'ws-1' };

describe('ShareAccessService.filterLockedSubtrees', () => {
  // root (shared publicly, includeSubPages)
  //  ├─ public-child
  //  └─ secret (own password-protected share)
  //      └─ secret-grandchild
  const pages = [
    { id: 'root', parentPageId: null },
    { id: 'public-child', parentPageId: 'root' },
    { id: 'secret', parentPageId: 'root' },
    { id: 'secret-grandchild', parentPageId: 'secret' },
  ];
  const parentShare = { id: 'share-root', workspaceId: 'ws-1', pageId: 'root' };
  const secretShare = { id: 'share-secret', key: 'sec', workspaceId: 'ws-1', pageId: 'secret' };

  it('hides a locked sub-share and everything below it', async () => {
    const { service, hashes, protectedByPage, req } = setup();
    hashes.set(secretShare.id, await hashPassword('pw-1234'));
    protectedByPage.set('secret', secretShare);

    const result = await service.filterLockedSubtrees(req(), parentShare, pages);
    expect(result.map((p) => p.id)).toEqual(['root', 'public-child']);
  });

  it('keeps the sub-share once the viewer has unlocked it', async () => {
    const { service, hashes, protectedByPage, req, res } = setup();
    hashes.set(secretShare.id, await hashPassword('pw-1234'));
    protectedByPage.set('secret', secretShare);
    await service.unlock(res, secretShare, 'pw-1234');

    const result = await service.filterLockedSubtrees(req(), parentShare, pages);
    expect(result).toHaveLength(4);
  });

  it('never removes the shared root page itself', async () => {
    const { service, hashes, protectedByPage, req } = setup();
    hashes.set('share-root', await hashPassword('pw-1234'));
    protectedByPage.set('root', { ...parentShare, key: 'root' });

    const result = await service.filterLockedSubtrees(req(), parentShare, pages);
    expect(result).toHaveLength(4);
  });
});

describe('ShareAccessService', () => {
  it('treats shares without a password as unlocked', async () => {
    const { service, req } = setup();
    await expect(service.isUnlocked(req(), shareA)).resolves.toBe(true);
    await expect(
      service.assertUnlocked(req(), shareA),
    ).resolves.toBeUndefined();
  });

  it('requires the password for protected shares', async () => {
    const { service, hashes, req } = setup();
    hashes.set(shareA.id, await hashPassword('secret-pw'));

    await expect(service.isUnlocked(req(), shareA)).resolves.toBe(false);
    const err = await service
      .assertUnlocked(req(), shareA)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SharePasswordRequiredException);
    expect((err as SharePasswordRequiredException).getResponse()).toMatchObject(
      { error: SHARE_PASSWORD_REQUIRED, shareId: 'keya' },
    );
  });

  it('rejects a wrong password and sets no cookie', async () => {
    const { service, hashes, res, req } = setup();
    hashes.set(shareA.id, await hashPassword('secret-pw'));

    await expect(service.unlock(res, shareA, 'wrong')).resolves.toBe(false);
    expect(res.setCookie).not.toHaveBeenCalled();
    await expect(service.isUnlocked(req(), shareA)).resolves.toBe(false);
  });

  it('unlocks with the right password via an httpOnly cookie', async () => {
    const { service, hashes, res, req } = setup();
    hashes.set(shareA.id, await hashPassword('secret-pw'));

    await expect(service.unlock(res, shareA, 'secret-pw')).resolves.toBe(true);
    expect(res.setCookie).toHaveBeenCalledWith(
      'share_access_share-a',
      expect.any(String),
      expect.objectContaining({ httpOnly: true }),
    );
    await expect(service.isUnlocked(req(), shareA)).resolves.toBe(true);
  });

  it('does not let a token for one share unlock another', async () => {
    const { service, hashes, res, jar, req } = setup();
    hashes.set(shareA.id, await hashPassword('same-pw'));
    hashes.set(shareB.id, await hashPassword('same-pw'));
    await service.unlock(res, shareA, 'same-pw');

    // Replay share A's token under share B's cookie name.
    jar['share_access_share-b'] = jar['share_access_share-a'];
    await expect(service.isUnlocked(req(), shareB)).resolves.toBe(false);
  });

  it('invalidates issued tokens when the password changes or is removed', async () => {
    const { service, hashes, res, req } = setup();
    hashes.set(shareA.id, await hashPassword('old-pw'));
    await service.unlock(res, shareA, 'old-pw');

    await service.setPassword(shareA.id, 'new-pw');
    await expect(service.isUnlocked(req(), shareA)).resolves.toBe(false);

    await service.removePassword(shareA.id);
    await expect(service.isUnlocked(req(), shareA)).resolves.toBe(true);
  });

  it('rejects tokens of another type or from another workspace', async () => {
    const { service, hashes, jar, req, tokenService } = setup();
    const hash = await hashPassword('secret-pw');
    hashes.set(shareA.id, hash);

    jar['share_access_share-a'] = await tokenService.generateAttachmentToken({
      attachmentId: 'x',
      pageId: 'y',
      workspaceId: 'ws-1',
    });
    await expect(service.isUnlocked(req(), shareA)).resolves.toBe(false);

    jar['share_access_share-a'] = 'not-a-jwt';
    await expect(service.isUnlocked(req(), shareA)).resolves.toBe(false);
  });

  it('never stores the plaintext password', async () => {
    const { service, shareRepo } = setup();
    await service.setPassword(shareA.id, 'secret-pw');
    const stored = shareRepo.setPasswordHash.mock.calls[0][1];
    expect(stored).not.toContain('secret-pw');
    expect(stored).toMatch(/^\$2[aby]\$/);
  });
});

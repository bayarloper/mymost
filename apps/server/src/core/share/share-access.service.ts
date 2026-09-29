import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { TokenService } from '../auth/services/token.service';
import { JwtType } from '../auth/dto/jwt-payload';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { comparePasswordHash, hashPassword } from '../../common/helpers';

const SHARE_ACCESS_COOKIE_PREFIX = 'share_access_';
const SHARE_ACCESS_TTL_MS = 12 * 60 * 60 * 1000;

export const SHARE_PASSWORD_REQUIRED = 'SHARE_PASSWORD_REQUIRED';

export class SharePasswordRequiredException extends ForbiddenException {
  constructor(shareKey: string) {
    super({
      message: 'This shared page is password protected',
      error: SHARE_PASSWORD_REQUIRED,
      shareId: shareKey,
    });
  }
}

type ShareRef = { id: string; key?: string; workspaceId: string };

/**
 * Password protection for public shares. A viewer unlocks a share once and
 * receives a short-lived, httpOnly JWT cookie scoped to that share. The token
 * embeds a fingerprint of the password hash, so changing or removing the
 * password invalidates previously issued tokens.
 */
@Injectable()
export class ShareAccessService {
  constructor(
    private readonly shareRepo: ShareRepo,
    private readonly tokenService: TokenService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async setPassword(shareId: string, password: string): Promise<void> {
    await this.shareRepo.setPasswordHash(shareId, await hashPassword(password));
  }

  async removePassword(shareId: string): Promise<void> {
    await this.shareRepo.setPasswordHash(shareId, null);
  }

  async isUnlocked(
    req: FastifyRequest,
    share: ShareRef,
    passwordHash?: string | null,
  ): Promise<boolean> {
    const hash =
      passwordHash !== undefined
        ? passwordHash
        : await this.shareRepo.findPasswordHash(share.id);
    if (!hash) return true;

    const token = req.cookies?.[this.cookieName(share.id)];
    if (!token) return false;

    try {
      const payload = await this.tokenService.verifyJwt(
        token,
        JwtType.SHARE_ACCESS,
      );
      return (
        payload.shareId === share.id &&
        payload.workspaceId === share.workspaceId &&
        payload.pv === this.passwordVersion(hash)
      );
    } catch {
      return false;
    }
  }

  async assertUnlocked(
    req: FastifyRequest,
    share: ShareRef,
    passwordHash?: string | null,
  ): Promise<void> {
    if (!(await this.isUnlocked(req, share, passwordHash))) {
      throw new SharePasswordRequiredException(share.key ?? share.id);
    }
  }

  /**
   * Removes pages that are covered by a *different* password-protected share
   * (and everything below them) unless the viewer has unlocked that share.
   * Prevents a public parent share (includeSubPages) from exposing the title or
   * content of a protected sub-page through its tree or search.
   */
  async filterLockedSubtrees<
    T extends { id: string; parentPageId?: string | null },
  >(req: FastifyRequest, share: ShareRef & { pageId: string }, pages: T[]) {
    const candidateIds = pages
      .map((p) => p.id)
      .filter((id) => id !== share.pageId);
    const protectedShares = await this.shareRepo.findProtectedByPageIds(
      candidateIds,
      share.workspaceId,
    );

    const lockedRoots = new Set<string>();
    for (const protectedShare of protectedShares) {
      if (protectedShare.id === share.id) continue;
      const unlocked = await this.isUnlocked(
        req,
        protectedShare,
        protectedShare.passwordHash,
      );
      if (!unlocked) lockedRoots.add(protectedShare.pageId);
    }
    if (lockedRoots.size === 0) return pages;

    const childrenByParent = new Map<string, string[]>();
    for (const page of pages) {
      if (!page.parentPageId) continue;
      const siblings = childrenByParent.get(page.parentPageId) ?? [];
      siblings.push(page.id);
      childrenByParent.set(page.parentPageId, siblings);
    }

    const excluded = new Set<string>();
    const stack = [...lockedRoots];
    while (stack.length > 0) {
      const id = stack.pop();
      if (excluded.has(id)) continue;
      excluded.add(id);
      stack.push(...(childrenByParent.get(id) ?? []));
    }

    return pages.filter((p) => !excluded.has(p.id));
  }

  /**
   * Verifies the password and sets the access cookie. Returns false on a wrong
   * password; unprotected shares are always unlocked.
   */
  async unlock(
    res: FastifyReply,
    share: ShareRef,
    password: string,
  ): Promise<boolean> {
    const hash = await this.shareRepo.findPasswordHash(share.id);
    if (!hash) return true;

    if (!(await comparePasswordHash(password, hash))) {
      return false;
    }

    const token = await this.tokenService.generateShareAccessToken({
      shareId: share.id,
      workspaceId: share.workspaceId,
      passwordVersion: this.passwordVersion(hash),
      expiresIn: '12h',
    });

    res.setCookie(this.cookieName(share.id), token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(Date.now() + SHARE_ACCESS_TTL_MS),
      secure: this.environmentService.isHttps(),
    });

    return true;
  }

  private cookieName(shareId: string): string {
    return `${SHARE_ACCESS_COOKIE_PREFIX}${shareId}`;
  }

  private passwordVersion(hash: string): string {
    return createHash('sha256').update(hash).digest('hex').slice(0, 16);
  }
}

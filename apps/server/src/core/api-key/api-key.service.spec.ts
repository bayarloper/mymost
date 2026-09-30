import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';

function setup(opts: { apiKey?: any; workspace?: any; user?: any }) {
  const apiKeyRepo = {
    findById: jest.fn().mockResolvedValue(opts.apiKey),
    insert: jest.fn().mockResolvedValue({ id: 'key-1', name: 'ci' }),
    updateLastUsedAt: jest.fn().mockResolvedValue(undefined),
  };
  const workspaceRepo = {
    findById: jest
      .fn()
      .mockResolvedValue(opts.workspace ?? { id: 'ws-1', settings: {} }),
  };
  const userRepo = {
    findById: jest
      .fn()
      .mockResolvedValue(
        opts.user ?? { id: 'u-1', role: 'member', deactivatedAt: null },
      ),
  };
  const tokenService = {
    generateApiToken: jest.fn().mockResolvedValue('jwt'),
  };
  const auditService = { log: jest.fn() };

  const service = new ApiKeyService(
    apiKeyRepo as any,
    userRepo as any,
    workspaceRepo as any,
    tokenService as any,
    auditService as any,
  );
  return { service, apiKeyRepo, tokenService };
}

const payload = {
  sub: 'u-1',
  workspaceId: 'ws-1',
  apiKeyId: 'key-1',
  type: 'api_key' as const,
};
const activeKey = {
  id: 'key-1',
  workspaceId: 'ws-1',
  deletedAt: null,
  expiresAt: null,
};

describe('ApiKeyService.validateApiKey', () => {
  it('accepts an active key', async () => {
    const { service, apiKeyRepo } = setup({ apiKey: activeKey });
    await expect(service.validateApiKey(payload)).resolves.toMatchObject({
      user: { id: 'u-1' },
    });
    expect(apiKeyRepo.updateLastUsedAt).toHaveBeenCalledWith('key-1');
  });

  it('does not rewrite lastUsedAt within the throttle window', async () => {
    const { service, apiKeyRepo } = setup({
      apiKey: { ...activeKey, lastUsedAt: new Date(Date.now() - 60_000) },
    });
    await service.validateApiKey(payload);
    expect(apiKeyRepo.updateLastUsedAt).not.toHaveBeenCalled();
  });

  it('does not fail authentication when the lastUsedAt write fails', async () => {
    const { service, apiKeyRepo } = setup({ apiKey: activeKey });
    apiKeyRepo.updateLastUsedAt.mockRejectedValue(new Error('db down'));
    await expect(service.validateApiKey(payload)).resolves.toBeDefined();
    // Let the rejected promise settle; an unhandled rejection would fail the test run.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('rejects revoked (missing) keys', async () => {
    const { service } = setup({ apiKey: undefined });
    await expect(service.validateApiKey(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects expired keys', async () => {
    const { service } = setup({
      apiKey: { ...activeKey, expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(service.validateApiKey(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a key used against another workspace', async () => {
    const { service } = setup({
      apiKey: { ...activeKey, workspaceId: 'ws-other' },
    });
    await expect(service.validateApiKey(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects member keys when the API is restricted to admins', async () => {
    const { service } = setup({
      apiKey: activeKey,
      workspace: { id: 'ws-1', settings: { api: { restrictToAdmins: true } } },
    });
    await expect(service.validateApiKey(payload)).rejects.toThrow(
      'API access is restricted to admins',
    );
  });

  it('keeps admin keys working when the API is restricted', async () => {
    const { service } = setup({
      apiKey: activeKey,
      workspace: { id: 'ws-1', settings: { api: { restrictToAdmins: true } } },
      user: { id: 'u-1', role: 'admin', deactivatedAt: null },
    });
    await expect(service.validateApiKey(payload)).resolves.toBeDefined();
  });

  it('rejects keys of deactivated users', async () => {
    const { service } = setup({
      apiKey: activeKey,
      user: { id: 'u-1', role: 'admin', deactivatedAt: new Date() },
    });
    await expect(service.validateApiKey(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('ApiKeyService.createApiKey', () => {
  it('issues a long-lived token when no expiry is given', async () => {
    const { service, tokenService } = setup({});
    await service.createApiKey({ id: 'u-1' } as any, 'ws-1', { name: 'ci' });
    expect(tokenService.generateApiToken).toHaveBeenCalledWith(
      expect.objectContaining({ expiresIn: '100y' }),
    );
  });

  it('rejects an expiry date in the past', async () => {
    const { service } = setup({});
    await expect(
      service.createApiKey({ id: 'u-1' } as any, 'ws-1', {
        name: 'ci',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).rejects.toThrow('Expiration date must be in the future');
  });
});

describe('API key endpoints', () => {
  it('require an interactive session (an API key cannot mint new keys)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ApiKeyController } = require('./api-key.controller');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      REQUIRE_SESSION_AUTH_KEY,
    } = require('../../common/decorators/require-session-auth.decorator');
    expect(
      Reflect.getMetadata(REQUIRE_SESSION_AUTH_KEY, ApiKeyController),
    ).toBe(true);
  });
});

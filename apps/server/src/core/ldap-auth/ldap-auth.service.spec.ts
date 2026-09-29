import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { LdapAuthService } from './ldap-auth.service';
import {
  buildUserSearchFilter,
  escapeLdapFilterValue,
} from './ldap-directory.service';
import { LdapDirectoryUser } from './ldap-auth.types';

const workspace = { id: 'ws-1', settings: {} } as any;

const directoryUser: LdapDirectoryUser = {
  dn: 'CN=Jane Doe,OU=Finance,DC=corp,DC=local',
  uid: 'guid-jane',
  username: 'jdoe',
  email: 'jane@corp.local',
  name: 'Jane Doe',
};

const FINANCE_DN = 'CN=Finance,OU=Groups,DC=corp,DC=local';
const HR_DN = 'CN=HR,OU=Groups,DC=corp,DC=local';

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    type: 'ldap',
    isEnabled: true,
    allowSignup: true,
    ldapUrl: 'ldap://dc.corp.local',
    ldapBindDn: 'CN=svc,DC=corp,DC=local',
    ldapBindPassword: 'encrypted',
    ldapBaseDn: 'DC=corp,DC=local',
    ldapUserSearchFilter: '(sAMAccountName={{username}})',
    ldapUserAttributes: null,
    ldapTlsEnabled: false,
    ldapTlsCaCert: null,
    ldapConfig: {
      allowedUsers: [],
      allowedGroups: [{ dn: FINANCE_DN, docmostGroupId: 'group-finance' }],
      nestedGroups: false,
      linkExistingByEmail: false,
    },
    ...overrides,
  };
}

function setup(opts: {
  provider?: any;
  memberOfGroups?: string[];
  existingAccount?: any;
  existingUserByEmail?: any;
  existingGroupMembership?: boolean;
  authenticateError?: Error;
}) {
  const createdUser = {
    id: 'user-new',
    name: 'Jane Doe',
    email: 'jane@corp.local',
    role: 'member',
    deactivatedAt: null,
    deletedAt: null,
  };

  const authProviderRepo = {
    findByType: jest.fn().mockResolvedValue(opts.provider),
  };
  const authAccountRepo = {
    findByProviderUserId: jest.fn().mockResolvedValue(opts.existingAccount),
    findByUserId: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockResolvedValue({}),
  };
  const userRepo = {
    findById: jest
      .fn()
      .mockImplementation(async (id: string) =>
        id === createdUser.id ? createdUser : { id, deactivatedAt: null },
      ),
    findByEmail: jest.fn().mockResolvedValue(opts.existingUserByEmail),
    insertUser: jest.fn().mockResolvedValue(createdUser),
    updateLastLogin: jest.fn(),
  };
  const groupRepo = {
    findById: jest.fn().mockResolvedValue({ id: 'group-finance' }),
  };
  const groupUserRepo = {
    addUserToDefaultGroup: jest.fn(),
    getGroupUserById: jest
      .fn()
      .mockResolvedValue(opts.existingGroupMembership ? { id: 'gu' } : null),
    insertGroupUser: jest.fn(),
    delete: jest.fn(),
  };
  const workspaceService = { addUserToWorkspace: jest.fn() };
  const sessionService = {
    createSessionAndToken: jest.fn().mockResolvedValue('jwt-token'),
  };
  const encryptionService = {
    encrypt: jest.fn((v: string) => `enc(${v})`),
    decrypt: jest.fn(() => 'bind-secret'),
  };
  const ldapDirectoryService = {
    authenticate: opts.authenticateError
      ? jest.fn().mockRejectedValue(opts.authenticateError)
      : jest.fn().mockResolvedValue({
          user: directoryUser,
          memberOfGroups: opts.memberOfGroups ?? [],
        }),
    testConnection: jest.fn(),
  };
  const db = {
    transaction: () => ({ execute: (cb: any) => cb({}) }),
  };
  const auditService = {
    log: jest.fn(),
    setActorId: jest.fn(),
  };

  const service = new LdapAuthService(
    authProviderRepo as any,
    authAccountRepo as any,
    userRepo as any,
    groupRepo as any,
    groupUserRepo as any,
    workspaceService as any,
    sessionService as any,
    encryptionService as any,
    ldapDirectoryService as any,
    db as any,
    auditService as any,
  );

  return {
    service,
    authProviderRepo,
    authAccountRepo,
    userRepo,
    groupUserRepo,
    ldapDirectoryService,
    sessionService,
    encryptionService,
  };
}

describe('LdapAuthService stored bind password', () => {
  const configDto = (overrides: Record<string, unknown> = {}) =>
    ({
      name: 'AD',
      isEnabled: true,
      allowSignup: true,
      url: 'ldap://dc.corp.local',
      bindDn: 'CN=svc,DC=corp,DC=local',
      bindPassword: '',
      baseDn: 'DC=corp,DC=local',
      userSearchFilter: '(sAMAccountName={{username}})',
      userAttributes: {
        username: 'sAMAccountName',
        email: 'mail',
        name: 'displayName',
        uid: 'objectGUID',
      },
      tlsEnabled: false,
      allowedUsers: [],
      allowedGroups: [],
      nestedGroups: false,
      linkExistingByEmail: false,
      ...overrides,
    }) as any;

  it('refuses to test a different server with the stored password', async () => {
    const { service, ldapDirectoryService, encryptionService } = setup({
      provider: makeProvider(),
    });
    await expect(
      service.testConfig('ws-1', configDto({ url: 'ldap://attacker.example' })),
    ).rejects.toThrow('Re-enter the bind password');
    expect(encryptionService.decrypt).not.toHaveBeenCalled();
    expect(ldapDirectoryService.testConnection).not.toHaveBeenCalled();
  });

  it('refuses to save a changed bind DN without a new password', async () => {
    const { service } = setup({ provider: makeProvider() });
    await expect(
      service.updateConfig(
        workspace,
        { id: 'u-1' } as any,
        configDto({ bindDn: 'CN=other,DC=corp,DC=local' }),
      ),
    ).rejects.toThrow('Re-enter the bind password');
  });

  it('reuses the stored password for the same server and bind DN', async () => {
    const { service, ldapDirectoryService } = setup({
      provider: makeProvider(),
    });
    ldapDirectoryService.testConnection.mockResolvedValue(null);
    await expect(
      service.testConfig('ws-1', configDto({ url: 'LDAP://DC.corp.local ' })),
    ).resolves.toMatchObject({ success: true });
    expect(ldapDirectoryService.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ bindPassword: 'bind-secret' }),
      undefined,
      [],
      false,
    );
  });

  it('accepts a changed server when the password is re-entered', async () => {
    const { service, ldapDirectoryService } = setup({
      provider: makeProvider(),
    });
    ldapDirectoryService.testConnection.mockResolvedValue(null);
    await expect(
      service.testConfig(
        'ws-1',
        configDto({ url: 'ldaps://dc2.corp.local', bindPassword: 'new-pw' }),
      ),
    ).resolves.toMatchObject({ success: true });
  });
});

describe('LdapAuthService.login', () => {
  it('rejects when LDAP is not configured or disabled', async () => {
    const { service } = setup({ provider: makeProvider({ isEnabled: false }) });
    await expect(service.login(workspace, 'jdoe', 'pw')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('passes through invalid credentials', async () => {
    const { service } = setup({
      provider: makeProvider(),
      authenticateError: new UnauthorizedException(),
    });
    await expect(service.login(workspace, 'jdoe', 'bad')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('maps directory connection errors to 503', async () => {
    const { service } = setup({
      provider: makeProvider(),
      authenticateError: new Error('ECONNREFUSED'),
    });
    await expect(service.login(workspace, 'jdoe', 'pw')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('denies users who are neither allowed nor in an allowed group', async () => {
    const { service, userRepo } = setup({
      provider: makeProvider(),
      memberOfGroups: [],
    });
    await expect(service.login(workspace, 'jdoe', 'pw')).rejects.toThrow(
      ForbiddenException,
    );
    expect(userRepo.insertUser).not.toHaveBeenCalled();
  });

  it('allows an explicitly allowed username (case-insensitive)', async () => {
    const provider = makeProvider({
      ldapConfig: {
        allowedUsers: ['JDOE'],
        allowedGroups: [],
        nestedGroups: false,
        linkExistingByEmail: false,
      },
    });
    const { service } = setup({ provider });
    await expect(service.login(workspace, 'jdoe', 'pw')).resolves.toBe(
      'jwt-token',
    );
  });

  it('creates a new user for an allowed group member and adds them to the mapped group', async () => {
    const { service, userRepo, authAccountRepo, groupUserRepo } = setup({
      provider: makeProvider(),
      memberOfGroups: [FINANCE_DN],
    });

    await expect(service.login(workspace, 'jdoe', 'pw')).resolves.toBe(
      'jwt-token',
    );

    expect(userRepo.insertUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'jane@corp.local',
        hasGeneratedPassword: true,
        workspaceId: 'ws-1',
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(authAccountRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        providerUserId: 'guid-jane',
        authProviderId: 'provider-1',
      }),
      expect.anything(),
    );
    expect(groupUserRepo.insertGroupUser).toHaveBeenCalledWith(
      { userId: 'user-new', groupId: 'group-finance' },
      expect.anything(),
    );
  });

  it('does not create users when signup is disabled', async () => {
    const { service, userRepo } = setup({
      provider: makeProvider({ allowSignup: false }),
      memberOfGroups: [FINANCE_DN],
    });
    await expect(service.login(workspace, 'jdoe', 'pw')).rejects.toThrow(
      ForbiddenException,
    );
    expect(userRepo.insertUser).not.toHaveBeenCalled();
  });

  it('refuses to take over an existing local account unless linking is enabled', async () => {
    const { service, authAccountRepo } = setup({
      provider: makeProvider(),
      memberOfGroups: [FINANCE_DN],
      existingUserByEmail: { id: 'user-local', deactivatedAt: null },
    });
    await expect(service.login(workspace, 'jdoe', 'pw')).rejects.toThrow(
      ForbiddenException,
    );
    expect(authAccountRepo.insert).not.toHaveBeenCalled();
  });

  it('links an existing account by email when enabled', async () => {
    const provider = makeProvider({
      ldapConfig: {
        allowedUsers: [],
        allowedGroups: [{ dn: FINANCE_DN }],
        nestedGroups: false,
        linkExistingByEmail: true,
      },
    });
    const { service, authAccountRepo, userRepo } = setup({
      provider,
      memberOfGroups: [FINANCE_DN],
      existingUserByEmail: { id: 'user-local', deactivatedAt: null },
    });
    await service.login(workspace, 'jdoe', 'pw');
    expect(authAccountRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-local' }),
    );
    expect(userRepo.insertUser).not.toHaveBeenCalled();
  });

  it('rejects deactivated linked users', async () => {
    const { service, userRepo } = setup({
      provider: makeProvider(),
      memberOfGroups: [FINANCE_DN],
      existingAccount: { userId: 'user-old' },
    });
    userRepo.findById.mockResolvedValue({
      id: 'user-old',
      deactivatedAt: new Date(),
    });
    await expect(service.login(workspace, 'jdoe', 'pw')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('removes the user from a mapped group they no longer belong to', async () => {
    const provider = makeProvider({
      ldapConfig: {
        allowedUsers: [],
        allowedGroups: [
          { dn: FINANCE_DN, docmostGroupId: 'group-finance' },
          { dn: HR_DN, docmostGroupId: 'group-hr' },
        ],
        nestedGroups: false,
        linkExistingByEmail: false,
      },
    });
    const { service, groupUserRepo } = setup({
      provider,
      memberOfGroups: [HR_DN],
      existingAccount: { userId: 'user-old' },
      existingGroupMembership: true,
    });

    await service.login(workspace, 'jdoe', 'pw');

    expect(groupUserRepo.delete).toHaveBeenCalledWith(
      'user-old',
      'group-finance',
      expect.anything(),
    );
    expect(groupUserRepo.delete).not.toHaveBeenCalledWith(
      'user-old',
      'group-hr',
      expect.anything(),
    );
  });
});

describe('LDAP filter escaping', () => {
  it('escapes RFC 4515 special characters', () => {
    expect(escapeLdapFilterValue('a*b(c)d\\e\0')).toBe(
      'a\\2ab\\28c\\29d\\5ce\\00',
    );
  });

  it('prevents filter injection through the username', () => {
    expect(
      buildUserSearchFilter('(sAMAccountName={{username}})', '*)(uid=*'),
    ).toBe('(sAMAccountName=\\2a\\29\\28uid=\\2a)');
  });

  it('replaces every {{username}} placeholder', () => {
    expect(
      buildUserSearchFilter(
        '(|(sAMAccountName={{username}})(mail={{username}}))',
        'jdoe',
      ),
    ).toBe('(|(sAMAccountName=jdoe)(mail=jdoe))');
  });
});

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { randomBytes } from 'node:crypto';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { Json } from '@docmost/db/types/db';
import { AuthProvider, User, Workspace } from '@docmost/db/types/entity.types';
import { AuthProviderRepo } from '@docmost/db/repos/auth-provider/auth-provider.repo';
import { AuthAccountRepo } from '@docmost/db/repos/auth-provider/auth-account.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { EncryptionService } from '../../integrations/encryption/encryption.service';
import { SessionService } from '../session/session.service';
import { WorkspaceService } from '../workspace/services/workspace.service';
import { getWorkspaceDefaultPageEditMode } from '../workspace/workspace.util';
import { isUserDisabled } from '../../common/helpers';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { LdapDirectoryService } from './ldap-directory.service';
import {
  DEFAULT_LDAP_ACCESS_CONFIG,
  DEFAULT_LDAP_USER_ATTRIBUTES,
  DEFAULT_LDAP_USER_SEARCH_FILTER,
  LDAP_PROVIDER_TYPE,
  LdapAccessConfig,
  LdapConnectionConfig,
  LdapDirectoryUser,
  LdapUserAttributes,
} from './ldap-auth.types';
import { TestLdapConfigDto, UpdateLdapConfigDto } from './dto/ldap-auth.dto';

// Plain-object round trip so DTO class instances fit the jsonb column type.
function toJson(value: object): Json {
  return JSON.parse(JSON.stringify(value));
}

@Injectable()
export class LdapAuthService {
  private readonly logger = new Logger(LdapAuthService.name);

  constructor(
    private readonly authProviderRepo: AuthProviderRepo,
    private readonly authAccountRepo: AuthAccountRepo,
    private readonly userRepo: UserRepo,
    private readonly groupRepo: GroupRepo,
    private readonly groupUserRepo: GroupUserRepo,
    private readonly workspaceService: WorkspaceService,
    private readonly sessionService: SessionService,
    private readonly encryptionService: EncryptionService,
    private readonly ldapDirectoryService: LdapDirectoryService,
    @InjectKysely() private readonly db: KyselyDB,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async login(
    workspace: Workspace,
    username: string,
    password: string,
  ): Promise<string> {
    const provider = await this.authProviderRepo.findByType(
      LDAP_PROVIDER_TYPE,
      workspace.id,
    );
    if (!provider?.isEnabled) {
      throw new NotFoundException('LDAP login is not enabled');
    }

    const access = this.getAccessConfig(provider);
    const connection = this.getConnectionConfig(provider);

    let result: Awaited<ReturnType<LdapDirectoryService['authenticate']>>;
    try {
      result = await this.ldapDirectoryService.authenticate(
        connection,
        username,
        password,
        access.allowedGroups.map((g) => g.dn),
        access.nestedGroups,
      );
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(
        `LDAP authentication error: ${(err as Error)?.message}`,
      );
      throw new ServiceUnavailableException(
        'Unable to reach the directory server. Please try again later.',
      );
    }

    const { user: directoryUser, memberOfGroups } = result;

    if (!this.isAllowed(directoryUser, memberOfGroups, access)) {
      this.logger.log(
        `LDAP login denied for "${directoryUser.username}": not in allowed users or groups`,
      );
      throw new ForbiddenException(
        'Your directory account is not permitted to access this workspace.',
      );
    }

    const user = await this.resolveUser(workspace, provider, directoryUser);

    if (isUserDisabled(user)) {
      throw new UnauthorizedException('Your account has been deactivated.');
    }

    await this.syncMappedGroups(user.id, workspace.id, access, memberOfGroups);

    await this.userRepo.updateLastLogin(user.id, workspace.id);

    this.auditService.setActorId(user.id);
    this.auditService.log({
      event: AuditEvent.USER_LOGIN,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      metadata: { source: 'ldap' },
    });

    return this.sessionService.createSessionAndToken(user);
  }

  async getConfig(workspaceId: string) {
    const provider = await this.authProviderRepo.findByType(
      LDAP_PROVIDER_TYPE,
      workspaceId,
    );
    if (!provider) return null;
    return this.toConfigResponse(provider);
  }

  async updateConfig(
    workspace: Workspace,
    actor: User,
    dto: UpdateLdapConfigDto,
  ) {
    await this.validateGroupMappings(workspace.id, dto);

    const existing = await this.authProviderRepo.findByType(
      LDAP_PROVIDER_TYPE,
      workspace.id,
    );

    if (!dto.bindPassword) {
      this.assertStoredPasswordReusable(existing, dto);
    }

    const bindPassword = dto.bindPassword
      ? this.encryptionService.encrypt(dto.bindPassword)
      : existing?.ldapBindPassword;

    if (!bindPassword) {
      throw new BadRequestException('Bind password is required');
    }

    const values = {
      name: dto.name,
      isEnabled: dto.isEnabled,
      allowSignup: dto.allowSignup,
      ldapUrl: dto.url,
      ldapBindDn: dto.bindDn,
      ldapBindPassword: bindPassword,
      ldapBaseDn: dto.baseDn,
      ldapUserSearchFilter: dto.userSearchFilter,
      ldapUserAttributes: toJson(dto.userAttributes),
      ldapTlsEnabled: dto.tlsEnabled,
      ldapTlsCaCert: dto.tlsCaCert?.trim() || null,
      ldapConfig: toJson(this.toAccessConfig(dto)),
    };

    const provider = existing
      ? await this.authProviderRepo.update(values, existing.id, workspace.id)
      : await this.authProviderRepo.insert({
          ...values,
          type: LDAP_PROVIDER_TYPE,
          creatorId: actor.id,
          workspaceId: workspace.id,
        });

    this.auditService.log({
      event: existing
        ? AuditEvent.SSO_PROVIDER_UPDATED
        : AuditEvent.SSO_PROVIDER_CREATED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: provider.id,
      metadata: { type: LDAP_PROVIDER_TYPE, isEnabled: provider.isEnabled },
    });

    return this.toConfigResponse(provider);
  }

  async testConfig(workspaceId: string, dto: TestLdapConfigDto) {
    const existing = await this.authProviderRepo.findByType(
      LDAP_PROVIDER_TYPE,
      workspaceId,
    );

    let bindPassword = dto.bindPassword;
    if (!bindPassword && existing?.ldapBindPassword) {
      this.assertStoredPasswordReusable(existing, dto);
      bindPassword = this.encryptionService.decrypt(existing.ldapBindPassword);
    }
    if (!bindPassword) {
      throw new BadRequestException('Bind password is required');
    }

    const access = this.toAccessConfig(dto);
    try {
      const result = await this.ldapDirectoryService.testConnection(
        {
          url: dto.url,
          bindDn: dto.bindDn,
          bindPassword,
          baseDn: dto.baseDn,
          userSearchFilter: dto.userSearchFilter,
          tlsEnabled: dto.tlsEnabled,
          tlsCaCert: dto.tlsCaCert,
          attributes: dto.userAttributes,
        },
        dto.testUsername,
        access.allowedGroups.map((g) => g.dn),
        access.nestedGroups,
      );

      if (!dto.testUsername) {
        return { success: true, message: 'Connected and bound successfully.' };
      }

      if (!result) {
        return {
          success: false,
          message: `Connected, but no unique user matched "${dto.testUsername}".`,
        };
      }

      return {
        success: true,
        message: 'Connected and found the user.',
        user: result.user,
        memberOfGroups: result.memberOfGroups,
        allowed: this.isAllowed(result.user, result.memberOfGroups, access),
      };
    } catch (err) {
      return {
        success: false,
        message: (err as Error)?.message || 'Connection failed',
      };
    }
  }

  /**
   * The stored service-account password may only be reused against the same
   * server and bind DN; otherwise it could be sent to an arbitrary host.
   */
  private assertStoredPasswordReusable(
    existing: AuthProvider | undefined,
    dto: UpdateLdapConfigDto,
  ) {
    if (!existing?.ldapBindPassword) return;
    const sameTarget =
      existing.ldapUrl?.trim().toLowerCase() === dto.url.trim().toLowerCase() &&
      existing.ldapBindDn?.trim().toLowerCase() ===
        dto.bindDn.trim().toLowerCase();
    if (!sameTarget) {
      throw new BadRequestException(
        'Re-enter the bind password when changing the server URL or bind DN',
      );
    }
  }

  private isAllowed(
    directoryUser: LdapDirectoryUser,
    memberOfGroups: string[],
    access: LdapAccessConfig,
  ): boolean {
    const username = directoryUser.username.toLowerCase();
    const isAllowedUser = access.allowedUsers.some(
      (u) => u.trim().toLowerCase() === username,
    );
    return isAllowedUser || memberOfGroups.length > 0;
  }

  private async resolveUser(
    workspace: Workspace,
    provider: AuthProvider,
    directoryUser: LdapDirectoryUser,
  ): Promise<User> {
    const account = await this.authAccountRepo.findByProviderUserId(
      directoryUser.uid,
      provider.id,
      workspace.id,
    );

    if (account) {
      const linkedUser = await this.userRepo.findById(
        account.userId,
        workspace.id,
      );
      if (linkedUser) return linkedUser;
    }

    if (!directoryUser.email) {
      throw new ForbiddenException(
        'Your directory account has no email address. Please contact your administrator.',
      );
    }

    const access = this.getAccessConfig(provider);
    const existingUser = await this.userRepo.findByEmail(
      directoryUser.email,
      workspace.id,
    );

    if (existingUser) {
      if (!access.linkExistingByEmail) {
        throw new ForbiddenException(
          'An account with this email already exists. Please contact your administrator.',
        );
      }

      const existingLink = await this.authAccountRepo.findByUserId(
        existingUser.id,
        provider.id,
      );
      if (existingLink) {
        throw new ForbiddenException(
          'This account is already linked to another directory account.',
        );
      }

      await this.authAccountRepo.insert({
        userId: existingUser.id,
        providerUserId: directoryUser.uid,
        authProviderId: provider.id,
        workspaceId: workspace.id,
      });
      return existingUser;
    }

    if (!provider.allowSignup) {
      throw new ForbiddenException(
        'You do not have an account yet. Please contact your administrator.',
      );
    }

    return this.createUser(workspace, provider, directoryUser);
  }

  private async createUser(
    workspace: Workspace,
    provider: AuthProvider,
    directoryUser: LdapDirectoryUser,
  ): Promise<User> {
    const user = await executeTx(this.db, async (trx) => {
      const user = await this.userRepo.insertUser(
        {
          name: (directoryUser.name || directoryUser.username).slice(0, 100),
          email: directoryUser.email,
          // Never used: directory users authenticate against LDAP.
          password: randomBytes(32).toString('hex'),
          hasGeneratedPassword: true,
          emailVerifiedAt: new Date(),
          workspaceId: workspace.id,
        },
        trx,
        { pageEditMode: getWorkspaceDefaultPageEditMode(workspace) },
      );

      await this.workspaceService.addUserToWorkspace(
        user.id,
        workspace.id,
        undefined,
        trx,
      );
      await this.groupUserRepo.addUserToDefaultGroup(
        user.id,
        workspace.id,
        trx,
      );
      await this.authAccountRepo.insert(
        {
          userId: user.id,
          providerUserId: directoryUser.uid,
          authProviderId: provider.id,
          workspaceId: workspace.id,
        },
        trx,
      );

      return user;
    });

    this.auditService.log({
      event: AuditEvent.USER_CREATED,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      changes: {
        after: { name: user.name, email: user.email, role: user.role },
      },
      metadata: { source: 'ldap' },
    });

    // Re-read so the role assigned by addUserToWorkspace is reflected.
    return this.userRepo.findById(user.id, workspace.id);
  }

  /**
   * Adds the user to Docmost groups mapped from directory groups they belong to,
   * and removes them from mapped groups they no longer belong to.
   * Groups that are not mapped are never touched.
   */
  private async syncMappedGroups(
    userId: string,
    workspaceId: string,
    access: LdapAccessConfig,
    memberOfGroups: string[],
  ) {
    const matched = new Set(memberOfGroups);
    const mappedGroupIds = new Set<string>();
    const desiredGroupIds = new Set<string>();

    for (const group of access.allowedGroups) {
      if (!group.docmostGroupId) continue;
      mappedGroupIds.add(group.docmostGroupId);
      if (matched.has(group.dn)) desiredGroupIds.add(group.docmostGroupId);
    }

    if (mappedGroupIds.size === 0) return;

    await executeTx(this.db, async (trx) => {
      for (const groupId of mappedGroupIds) {
        const group = await this.groupRepo.findById(groupId, workspaceId, {
          trx,
        });
        if (!group) continue;

        const membership = await this.groupUserRepo.getGroupUserById(
          userId,
          groupId,
          trx,
        );

        if (desiredGroupIds.has(groupId) && !membership) {
          await this.groupUserRepo.insertGroupUser({ userId, groupId }, trx);
        } else if (!desiredGroupIds.has(groupId) && membership) {
          await this.groupUserRepo.delete(userId, groupId, { trx });
        }
      }
    });
  }

  private async validateGroupMappings(
    workspaceId: string,
    dto: UpdateLdapConfigDto,
  ) {
    for (const group of dto.allowedGroups) {
      if (!group.docmostGroupId) continue;
      const docmostGroup = await this.groupRepo.findById(
        group.docmostGroupId,
        workspaceId,
      );
      if (!docmostGroup) {
        throw new BadRequestException(
          `Docmost group for "${group.dn}" was not found`,
        );
      }
      if (docmostGroup.isDefault) {
        throw new BadRequestException(
          'The default group cannot be mapped to a directory group',
        );
      }
    }
  }

  private toAccessConfig(dto: UpdateLdapConfigDto): LdapAccessConfig {
    return {
      allowedUsers: [
        ...new Set(dto.allowedUsers.map((u) => u.trim()).filter(Boolean)),
      ],
      allowedGroups: dto.allowedGroups
        .filter((g) => g.dn)
        .map((g) => ({ dn: g.dn, docmostGroupId: g.docmostGroupId || null })),
      nestedGroups: dto.nestedGroups,
      linkExistingByEmail: dto.linkExistingByEmail,
    };
  }

  private getAccessConfig(provider: AuthProvider): LdapAccessConfig {
    return {
      ...DEFAULT_LDAP_ACCESS_CONFIG,
      ...((provider.ldapConfig as Partial<LdapAccessConfig>) ?? {}),
    };
  }

  private getUserAttributes(provider: AuthProvider): LdapUserAttributes {
    return {
      ...DEFAULT_LDAP_USER_ATTRIBUTES,
      ...((provider.ldapUserAttributes as Partial<LdapUserAttributes>) ?? {}),
    };
  }

  private getConnectionConfig(provider: AuthProvider): LdapConnectionConfig {
    return {
      url: provider.ldapUrl,
      bindDn: provider.ldapBindDn,
      bindPassword: provider.ldapBindPassword
        ? this.encryptionService.decrypt(provider.ldapBindPassword)
        : '',
      baseDn: provider.ldapBaseDn,
      userSearchFilter:
        provider.ldapUserSearchFilter || DEFAULT_LDAP_USER_SEARCH_FILTER,
      tlsEnabled: !!provider.ldapTlsEnabled,
      tlsCaCert: provider.ldapTlsCaCert,
      attributes: this.getUserAttributes(provider),
    };
  }

  private toConfigResponse(provider: AuthProvider) {
    const access = this.getAccessConfig(provider);
    return {
      id: provider.id,
      name: provider.name,
      isEnabled: provider.isEnabled,
      allowSignup: provider.allowSignup,
      url: provider.ldapUrl,
      bindDn: provider.ldapBindDn,
      hasBindPassword: !!provider.ldapBindPassword,
      baseDn: provider.ldapBaseDn,
      userSearchFilter:
        provider.ldapUserSearchFilter || DEFAULT_LDAP_USER_SEARCH_FILTER,
      userAttributes: this.getUserAttributes(provider),
      tlsEnabled: !!provider.ldapTlsEnabled,
      tlsCaCert: provider.ldapTlsCaCert,
      ...access,
    };
  }
}

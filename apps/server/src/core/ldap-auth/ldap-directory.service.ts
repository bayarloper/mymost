import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Client, Entry, InvalidCredentialsError } from 'ldapts';
import { LdapConnectionConfig, LdapDirectoryUser } from './ldap-auth.types';

const LDAP_TIMEOUT_MS = 10_000;
// Active Directory LDAP_MATCHING_RULE_IN_CHAIN: resolves nested group membership.
const AD_MATCHING_RULE_IN_CHAIN = '1.2.840.113556.1.4.1941';
const INVALID_CREDENTIALS = 'Invalid username or password';

// RFC 4515 filter value escaping.
export function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (char) => {
    return '\\' + char.charCodeAt(0).toString(16).padStart(2, '0');
  });
}

export function buildUserSearchFilter(template: string, username: string) {
  return template.split('{{username}}').join(escapeLdapFilterValue(username));
}

function normalizeDn(dn: string): string {
  return dn
    .split(/(?<!\\),/)
    .map((part) => part.trim())
    .join(',')
    .toLowerCase();
}

// LDAP attribute names are case-insensitive; servers may return a different case than requested.
function getAttribute(entry: Entry, name: string): Entry[string] | undefined {
  const lowerName = name.toLowerCase();
  const values = Object.keys(entry)
    .filter((k) => k !== 'dn' && k.toLowerCase() === lowerName)
    .map((k) => entry[k]);
  return values.find((v) => !Array.isArray(v) || v.length > 0) ?? values[0];
}

function firstValue(value: Entry[string] | undefined): string | null {
  if (value === undefined || value === null) return null;
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return null;
  if (Buffer.isBuffer(first)) return first.toString('utf8');
  return String(first);
}

function allValues(value: Entry[string] | undefined): string[] {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((v) => (Buffer.isBuffer(v) ? v.toString('utf8') : v));
}

function binaryValue(value: Entry[string] | undefined): string | null {
  if (value === undefined || value === null) return null;
  const first = Array.isArray(value) ? value[0] : value;
  if (Buffer.isBuffer(first)) return first.toString('hex');
  return first ? String(first) : null;
}

export type LdapAuthenticationResult = {
  user: LdapDirectoryUser;
  // DNs (as configured) of the requested groups the user is a member of.
  memberOfGroups: string[];
};

@Injectable()
export class LdapDirectoryService {
  private readonly logger = new Logger(LdapDirectoryService.name);

  /**
   * Verifies the user's credentials against the directory and resolves which of
   * `groupDns` the user belongs to. Throws UnauthorizedException on bad credentials.
   */
  async authenticate(
    config: LdapConnectionConfig,
    username: string,
    password: string,
    groupDns: string[],
    nestedGroups: boolean,
  ): Promise<LdapAuthenticationResult> {
    // An empty password results in an unauthenticated bind, which many
    // directories (including AD) report as a success.
    if (!username || !password) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return this.withServiceClient(config, async (client) => {
      const entry = await this.searchUserEntry(client, config, username);
      if (!entry) {
        throw new UnauthorizedException(INVALID_CREDENTIALS);
      }

      try {
        await client.bind(entry.dn, password);
      } catch (err) {
        if (err instanceof InvalidCredentialsError) {
          throw new UnauthorizedException(INVALID_CREDENTIALS);
        }
        throw err;
      }

      // Re-bind as the service account: regular users often cannot read group entries.
      await client.bind(config.bindDn, config.bindPassword);

      const user = this.toDirectoryUser(entry, config, username);
      const memberOfGroups = await this.resolveGroupMembership(
        client,
        entry,
        user,
        groupDns,
        nestedGroups,
      );

      return { user, memberOfGroups };
    });
  }

  /**
   * Used by the admin "test connection" action. Binds with the service account and,
   * when `username` is given, looks the user up without verifying a password.
   */
  async testConnection(
    config: LdapConnectionConfig,
    username: string | undefined,
    groupDns: string[],
    nestedGroups: boolean,
  ): Promise<LdapAuthenticationResult | null> {
    return this.withServiceClient(config, async (client) => {
      if (!username) return null;

      const entry = await this.searchUserEntry(client, config, username);
      if (!entry) return null;

      const user = this.toDirectoryUser(entry, config, username);
      const memberOfGroups = await this.resolveGroupMembership(
        client,
        entry,
        user,
        groupDns,
        nestedGroups,
      );
      return { user, memberOfGroups };
    });
  }

  private async withServiceClient<T>(
    config: LdapConnectionConfig,
    fn: (client: Client) => Promise<T>,
  ): Promise<T> {
    const tlsOptions = config.tlsCaCert?.trim()
      ? { ca: [config.tlsCaCert] }
      : undefined;

    const client = new Client({
      url: config.url,
      timeout: LDAP_TIMEOUT_MS,
      connectTimeout: LDAP_TIMEOUT_MS,
      tlsOptions,
    });

    try {
      if (config.tlsEnabled && config.url.toLowerCase().startsWith('ldap://')) {
        await client.startTLS(tlsOptions ?? {});
      }
      await client.bind(config.bindDn, config.bindPassword);
      return await fn(client);
    } finally {
      try {
        await client.unbind();
      } catch (err) {
        this.logger.debug(`LDAP unbind failed: ${(err as Error)?.message}`);
      }
    }
  }

  private async searchUserEntry(
    client: Client,
    config: LdapConnectionConfig,
    username: string,
  ): Promise<Entry | null> {
    const { attributes } = config;
    const { searchEntries } = await client.search(config.baseDn, {
      scope: 'sub',
      filter: buildUserSearchFilter(config.userSearchFilter, username),
      attributes: [
        attributes.username,
        attributes.email,
        attributes.name,
        attributes.uid,
        'memberOf',
      ],
      explicitBufferAttributes: [attributes.uid, attributes.uid.toLowerCase()],
      sizeLimit: 2,
    });

    // Ambiguous matches are treated as "not found" rather than guessing.
    if (searchEntries.length !== 1) {
      if (searchEntries.length > 1) {
        this.logger.warn(
          `LDAP user search matched ${searchEntries.length} entries; refine the user search filter`,
        );
      }
      return null;
    }

    return searchEntries[0];
  }

  private toDirectoryUser(
    entry: Entry,
    config: LdapConnectionConfig,
    fallbackUsername: string,
  ): LdapDirectoryUser {
    const { attributes } = config;
    return {
      dn: entry.dn,
      uid:
        binaryValue(getAttribute(entry, attributes.uid)) ??
        normalizeDn(entry.dn),
      username:
        firstValue(getAttribute(entry, attributes.username)) ??
        fallbackUsername,
      email:
        firstValue(getAttribute(entry, attributes.email))
          ?.trim()
          .toLowerCase() || null,
      name: firstValue(getAttribute(entry, attributes.name))?.trim() || null,
    };
  }

  private async resolveGroupMembership(
    client: Client,
    entry: Entry,
    user: LdapDirectoryUser,
    groupDns: string[],
    nestedGroups: boolean,
  ): Promise<string[]> {
    const matched: string[] = [];
    const memberOf = new Set(
      allValues(getAttribute(entry, 'memberOf')).map(normalizeDn),
    );

    for (const groupDn of groupDns) {
      if (!groupDn?.trim()) continue;

      if (memberOf.has(normalizeDn(groupDn))) {
        matched.push(groupDn);
        continue;
      }

      const isMember =
        (nestedGroups &&
          (await this.isNestedMember(client, user.dn, groupDn))) ||
        (await this.isDirectMemberByGroupEntry(client, user, groupDn));

      if (isMember) matched.push(groupDn);
    }

    return matched;
  }

  // Active Directory only: follows nested group membership server-side.
  private async isNestedMember(
    client: Client,
    userDn: string,
    groupDn: string,
  ): Promise<boolean> {
    try {
      const { searchEntries } = await client.search(userDn, {
        scope: 'base',
        filter: `(memberOf:${AD_MATCHING_RULE_IN_CHAIN}:=${escapeLdapFilterValue(groupDn)})`,
        attributes: ['1.1'],
      });
      return searchEntries.length > 0;
    } catch (err) {
      this.logger.warn(
        `LDAP nested group check failed for ${groupDn}: ${(err as Error)?.message}`,
      );
      return false;
    }
  }

  // Fallback for directories without a memberOf attribute (e.g. OpenLDAP without the overlay).
  private async isDirectMemberByGroupEntry(
    client: Client,
    user: LdapDirectoryUser,
    groupDn: string,
  ): Promise<boolean> {
    const dn = escapeLdapFilterValue(user.dn);
    const uid = escapeLdapFilterValue(user.username);
    try {
      const { searchEntries } = await client.search(groupDn, {
        scope: 'base',
        filter: `(|(member=${dn})(uniqueMember=${dn})(memberUid=${uid}))`,
        attributes: ['1.1'],
      });
      return searchEntries.length > 0;
    } catch (err) {
      this.logger.warn(
        `LDAP group lookup failed for ${groupDn}: ${(err as Error)?.message}`,
      );
      return false;
    }
  }
}

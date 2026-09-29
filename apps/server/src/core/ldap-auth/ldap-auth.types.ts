export const LDAP_PROVIDER_TYPE = 'ldap';

export const DEFAULT_LDAP_USER_SEARCH_FILTER = '(sAMAccountName={{username}})';

export type LdapUserAttributes = {
  username: string;
  email: string;
  name: string;
  uid: string;
};

export const DEFAULT_LDAP_USER_ATTRIBUTES: LdapUserAttributes = {
  username: 'sAMAccountName',
  email: 'mail',
  name: 'displayName',
  uid: 'objectGUID',
};

export type LdapAllowedGroup = {
  dn: string;
  // Docmost group the member is added to (and removed from when they leave the directory group).
  docmostGroupId?: string | null;
};

// Stored in auth_providers.ldap_config
export type LdapAccessConfig = {
  allowedUsers: string[];
  allowedGroups: LdapAllowedGroup[];
  nestedGroups: boolean;
  linkExistingByEmail: boolean;
};

export const DEFAULT_LDAP_ACCESS_CONFIG: LdapAccessConfig = {
  allowedUsers: [],
  allowedGroups: [],
  nestedGroups: false,
  linkExistingByEmail: false,
};

export type LdapConnectionConfig = {
  url: string;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  userSearchFilter: string;
  // StartTLS for ldap:// URLs. ldaps:// URLs are always TLS.
  tlsEnabled: boolean;
  tlsCaCert?: string | null;
  attributes: LdapUserAttributes;
};

export type LdapDirectoryUser = {
  dn: string;
  uid: string;
  username: string;
  email: string | null;
  name: string | null;
};

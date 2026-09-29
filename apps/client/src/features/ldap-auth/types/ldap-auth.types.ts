export interface ILdapUserAttributes {
  username: string;
  email: string;
  name: string;
  uid: string;
}

export interface ILdapAllowedGroup {
  dn: string;
  docmostGroupId?: string | null;
}

export interface ILdapConfigInput {
  name: string;
  isEnabled: boolean;
  allowSignup: boolean;
  url: string;
  bindDn: string;
  bindPassword?: string;
  baseDn: string;
  userSearchFilter: string;
  userAttributes: ILdapUserAttributes;
  tlsEnabled: boolean;
  tlsCaCert?: string | null;
  allowedUsers: string[];
  allowedGroups: ILdapAllowedGroup[];
  nestedGroups: boolean;
  linkExistingByEmail: boolean;
}

export interface ILdapConfig extends Omit<ILdapConfigInput, "bindPassword"> {
  id: string;
  hasBindPassword: boolean;
}

export interface ILdapTestInput extends ILdapConfigInput {
  testUsername?: string;
}

export interface ILdapTestResult {
  success: boolean;
  message: string;
  user?: {
    dn: string;
    uid: string;
    username: string;
    email: string | null;
    name: string | null;
  };
  memberOfGroups?: string[];
  allowed?: boolean;
}

export interface ILdapLogin {
  username: string;
  password: string;
}

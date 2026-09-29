import api from "@/lib/api-client";
import {
  ILdapConfig,
  ILdapConfigInput,
  ILdapLogin,
  ILdapTestInput,
  ILdapTestResult,
} from "@/features/ldap-auth/types/ldap-auth.types";

export async function ldapLogin(data: ILdapLogin): Promise<void> {
  await api.post<void>("/ldap-auth/login", data);
}

export async function getLdapConfig(): Promise<ILdapConfig | null> {
  const req = await api.post<ILdapConfig | null>("/ldap-auth/config");
  return req.data;
}

export async function updateLdapConfig(
  data: ILdapConfigInput,
): Promise<ILdapConfig> {
  const req = await api.post<ILdapConfig>("/ldap-auth/config/update", data);
  return req.data;
}

export async function testLdapConfig(
  data: ILdapTestInput,
): Promise<ILdapTestResult> {
  const req = await api.post<ILdapTestResult>("/ldap-auth/config/test", data);
  return req.data;
}

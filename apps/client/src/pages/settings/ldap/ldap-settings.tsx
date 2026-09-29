import SettingsTitle from "@/components/settings/settings-title.tsx";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import { useTranslation } from "react-i18next";
import useUserRole from "@/hooks/use-user-role.tsx";
import LdapSettingsForm from "@/features/ldap-auth/components/ldap-settings-form.tsx";

export default function LdapSettings() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();

  if (!isAdmin) {
    return null;
  }

  return (
    <>
      <DocumentTitle title="LDAP / Active Directory" />
      <SettingsTitle title={t("LDAP / Active Directory")} />
      <LdapSettingsForm />
    </>
  );
}

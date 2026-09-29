import { useEffect, useState } from "react";
import {
  Anchor,
  Badge,
  Button,
  Divider,
  Group,
  NumberInput,
  Stack,
  Switch,
  TagsInput,
  Text,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import useUserRole from "@/hooks/use-user-role.tsx";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { IWorkspace } from "@/features/workspace/types/workspace.types.ts";
import { useLdapConfigQuery } from "@/features/ldap-auth/queries/ldap-auth-query.ts";
import { getApiErrorMessage } from "@/lib/api-error.ts";

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{label}</Text>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </div>
      {children}
    </Group>
  );
}

export default function Security() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const { data: ldapConfig } = useLdapConfigQuery();
  const [saving, setSaving] = useState<string | null>(null);
  const [emailDomains, setEmailDomains] = useState<string[]>([]);
  const [trashDays, setTrashDays] = useState<number | string>("");

  useEffect(() => {
    setEmailDomains(workspace?.emailDomains ?? []);
    setTrashDays(workspace?.trashRetentionDays ?? "");
  }, [workspace?.emailDomains, workspace?.trashRetentionDays]);

  if (!isAdmin) return null;

  const save = async (key: string, data: Partial<IWorkspace>) => {
    setSaving(key);
    try {
      const updated = await updateWorkspace(data);
      setWorkspace(updated);
      notifications.show({ message: t("Updated successfully") });
    } catch (err) {
      notifications.show({
        message: getApiErrorMessage(err, t("Failed to update setting")),
        color: "red",
      });
    } finally {
      setSaving(null);
    }
  };

  const ldapEnabled = !!ldapConfig?.isEnabled;

  const handleEnforceSso = (checked: boolean) => {
    if (!checked) {
      save("enforceSso", { enforceSso: false });
      return;
    }
    modals.openConfirmModal({
      title: t("Enforce SSO?"),
      centered: true,
      children: (
        <Text size="sm">
          {t(
            "Everyone, including administrators, will only be able to sign in with directory (LDAP) login. Email and password login and password reset will be disabled. If the directory server becomes unreachable, nobody will be able to sign in.",
          )}
        </Text>
      ),
      labels: { confirm: t("Enforce SSO"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => save("enforceSso", { enforceSso: true }),
    });
  };

  const restrictApi = workspace?.settings?.api?.restrictToAdmins === true;

  return (
    <>
      <DocumentTitle title={t("Security")} />
      <SettingsTitle title={t("Security")} />

      <Stack gap="lg">
        <Title order={4}>{t("Authentication")}</Title>

        <SettingRow
          label={t("Directory login (LDAP / Active Directory)")}
          description={t("Let members sign in with their directory account.")}
        >
          <Group gap="sm" wrap="nowrap">
            <Badge color={ldapEnabled ? "green" : "gray"} variant="light">
              {ldapEnabled ? t("Enabled") : t("Disabled")}
            </Badge>
            <Anchor component={Link} to="/settings/ldap" size="sm">
              {t("Configure")}
            </Anchor>
          </Group>
        </SettingRow>

        <SettingRow
          label={t("Enforce SSO")}
          description={t(
            "Only allow directory login. Requires LDAP to be enabled.",
          )}
        >
          <Switch
            aria-label={t("Enforce SSO")}
            checked={!!workspace?.enforceSso}
            disabled={
              saving === "enforceSso" ||
              (!ldapEnabled && !workspace?.enforceSso)
            }
            onChange={(e) => handleEnforceSso(e.currentTarget.checked)}
          />
        </SettingRow>

        <Stack gap={6}>
          <Text size="md">{t("Allowed email domains")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "Only people with an email address from these domains can accept invitations. Leave empty to allow any domain.",
            )}
          </Text>
          <Group align="flex-start" wrap="nowrap">
            <TagsInput
              style={{ flex: 1 }}
              placeholder="company.com"
              value={emailDomains}
              onChange={setEmailDomains}
              clearable
            />
            <Button
              variant="default"
              loading={saving === "emailDomains"}
              onClick={() => save("emailDomains", { emailDomains })}
            >
              {t("Save")}
            </Button>
          </Group>
        </Stack>

        <Divider />
        <Title order={4}>{t("Data")}</Title>

        <Stack gap={6}>
          <Text size="md">{t("Trash retention")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "Number of days deleted pages are kept in trash before they are permanently removed.",
            )}
          </Text>
          <Group align="flex-start" wrap="nowrap">
            <NumberInput
              style={{ flex: 1 }}
              min={1}
              max={3650}
              suffix={` ${t("days")}`}
              value={trashDays}
              onChange={(value) =>
                setTrashDays(typeof value === "bigint" ? Number(value) : value)
              }
            />
            <Button
              variant="default"
              loading={saving === "trashRetentionDays"}
              disabled={!trashDays || Number(trashDays) < 1}
              onClick={() =>
                save("trashRetentionDays", {
                  trashRetentionDays: Number(trashDays),
                })
              }
            >
              {t("Save")}
            </Button>
          </Group>
        </Stack>

        <Divider />
        <Title order={4}>{t("API")}</Title>

        <SettingRow
          label={t("Restrict API keys to admins")}
          description={t(
            "Only workspace admins and owners can create and use API keys.",
          )}
        >
          <Switch
            aria-label={t("Restrict API keys to admins")}
            checked={restrictApi}
            disabled={saving === "restrictApiToAdmins"}
            onChange={(e) =>
              save("restrictApiToAdmins", {
                restrictApiToAdmins: e.currentTarget.checked,
              })
            }
          />
        </SettingRow>
      </Stack>
    </>
  );
}

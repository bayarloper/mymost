// Ported from Forkmost (AGPL-3.0): https://github.com/Vito0912/forkmost
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { useTranslation } from "react-i18next";
import { Divider, Group, Switch, Text } from "@mantine/core";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { useState } from "react";
import { notifications } from "@mantine/notifications";
import useUserRole from "@/hooks/use-user-role.tsx";
import CreateApiKeyModal from "@/features/api-key/components/create-api-key-modal.tsx";
import ApiKeyList from "@/features/api-key/components/api-key-list.tsx";
import { Navigate } from "react-router-dom";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import { getApiErrorMessage } from "@/lib/api-error.ts";

export default function ApiManagementSettings() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [isLoading, setIsLoading] = useState(false);
  const { isAdmin } = useUserRole();

  if (!isAdmin) {
    return <Navigate to="/settings/account/api-keys" replace />;
  }

  async function handleRestrictToggle(checked: boolean) {
    setIsLoading(true);
    try {
      const updatedWorkspace = await updateWorkspace({
        restrictApiToAdmins: checked,
      });
      setWorkspace(updatedWorkspace);
      notifications.show({ message: t("Updated successfully") });
    } catch (error) {
      notifications.show({
        message: getApiErrorMessage(error, t("Failed to update setting")),
        color: "red",
      });
    }
    setIsLoading(false);
  }

  return (
    <>
      <DocumentTitle title={t("API management")} />
      <SettingsTitle title={t("API management")} />

      <Group justify="space-between" wrap="nowrap" gap="xl">
        <div>
          <Text size="md">{t("Restrict API keys to admins")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "Only admins and owners can create and use API keys. Existing keys of members stop working while this is enabled.",
            )}
          </Text>
        </div>
        <Switch
          aria-label={t("Restrict API keys to admins")}
          checked={workspace?.settings?.api?.restrictToAdmins ?? false}
          onChange={(event) =>
            handleRestrictToggle(event.currentTarget.checked)
          }
          disabled={isLoading}
        />
      </Group>

      <Divider my="lg" />

      <Group justify="flex-end" mb="md">
        <CreateApiKeyModal />
      </Group>

      <ApiKeyList adminView />
    </>
  );
}

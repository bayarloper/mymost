import { useState } from "react";
import { Group, Switch, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { useUpdateSpaceMutation } from "@/features/space/queries/space-query.ts";
import { ISpace } from "@/features/space/types/space.types.ts";
import { getApiErrorMessage } from "@/lib/api-error.ts";

type PublicSharingSwitchProps = {
  label: string;
  description: string;
  enabled: boolean;
  loading: boolean;
  onChange: (enabled: boolean) => void;
};

function PublicSharingSwitch({
  label,
  description,
  enabled,
  loading,
  onChange,
}: PublicSharingSwitchProps) {
  const { t } = useTranslation();

  const handleChange = (checked: boolean) => {
    if (checked) {
      onChange(true);
      return;
    }

    // Disabling deletes every existing share link, so ask first.
    modals.openConfirmModal({
      title: t("Disable public sharing?"),
      centered: true,
      children: (
        <Text size="sm">
          {t(
            "All existing public share links will be deleted and cannot be restored.",
          )}
        </Text>
      ),
      labels: { confirm: t("Disable"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => onChange(false),
    });
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{label}</Text>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </div>
      <Switch
        aria-label={label}
        checked={enabled}
        disabled={loading}
        onChange={(event) => handleChange(event.currentTarget.checked)}
      />
    </Group>
  );
}

export function WorkspacePublicSharingToggle() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [loading, setLoading] = useState(false);
  const enabled = workspace?.settings?.sharing?.disabled !== true;

  const handleChange = async (value: boolean) => {
    setLoading(true);
    try {
      const updatedWorkspace = await updateWorkspace({
        disablePublicSharing: !value,
      });
      setWorkspace(updatedWorkspace);
    } catch (err) {
      notifications.show({
        message: getApiErrorMessage(err, t("Failed to update setting")),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicSharingSwitch
      label={t("Allow public sharing")}
      description={t(
        "Allow members to share pages publicly with anyone who has the link.",
      )}
      enabled={enabled}
      loading={loading}
      onChange={handleChange}
    />
  );
}

export function SpacePublicSharingToggle({ space }: { space: ISpace }) {
  const { t } = useTranslation();
  const updateSpaceMutation = useUpdateSpaceMutation();
  const enabled = space?.settings?.sharing?.disabled !== true;

  return (
    <PublicSharingSwitch
      label={t("Allow public sharing")}
      description={t(
        "Allow pages in this space to be shared publicly with anyone who has the link.",
      )}
      enabled={enabled}
      loading={updateSpaceMutation.isPending}
      onChange={(value) =>
        updateSpaceMutation.mutate({
          spaceId: space.id,
          disablePublicSharing: !value,
        })
      }
    />
  );
}

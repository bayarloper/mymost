import { useState } from "react";
import { Button, Group, PasswordInput, Switch, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  useRemoveSharePasswordMutation,
  useSetSharePasswordMutation,
} from "@/features/share/queries/share-query.ts";

const MIN_PASSWORD_LENGTH = 4;

type SharePasswordSettingsProps = {
  shareId: string;
  hasPassword: boolean;
  readOnly?: boolean;
};

export default function SharePasswordSettings({
  shareId,
  hasPassword,
  readOnly,
}: SharePasswordSettingsProps) {
  const { t } = useTranslation();
  const setPasswordMutation = useSetSharePasswordMutation();
  const removePasswordMutation = useRemoveSharePasswordMutation();
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");

  const showInput = editing;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  const handleToggle = async (checked: boolean) => {
    if (checked) {
      setEditing(true);
      return;
    }
    setEditing(false);
    setPassword("");
    if (hasPassword) {
      await removePasswordMutation.mutateAsync(shareId).catch(() => {});
    }
  };

  const handleSave = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) return;
    try {
      await setPasswordMutation.mutateAsync({ shareId, password });
      setEditing(false);
      setPassword("");
    } catch {
      // notification shown by the mutation
    }
  };

  return (
    <>
      <Group justify="space-between" wrap="nowrap" gap="xl" mt="sm">
        <div>
          <Text size="sm">{t("Password protection")}</Text>
          <Text size="xs" c="dimmed">
            {hasPassword
              ? t("Viewers must enter a password")
              : t("Require a password to view")}
          </Text>
        </div>
        <Switch
          checked={hasPassword || editing}
          onChange={(event) => handleToggle(event.currentTarget.checked)}
          disabled={readOnly || removePasswordMutation.isPending}
          size="xs"
        />
      </Group>

      {showInput && (
        <Group mt="xs" gap="xs" wrap="nowrap" align="flex-start">
          <PasswordInput
            size="xs"
            style={{ flex: 1 }}
            placeholder={hasPassword ? t("New password") : t("Password")}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            error={
              tooShort
                ? t("Password must be at least {{count}} characters", {
                    count: MIN_PASSWORD_LENGTH,
                  })
                : null
            }
            autoComplete="new-password"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
          <Button
            size="xs"
            onClick={handleSave}
            loading={setPasswordMutation.isPending}
            disabled={password.length < MIN_PASSWORD_LENGTH}
          >
            {t("Save")}
          </Button>
        </Group>
      )}

      {hasPassword && !editing && !readOnly && (
        <Button
          variant="subtle"
          size="compact-xs"
          mt={4}
          onClick={() => setEditing(true)}
        >
          {t("Change password")}
        </Button>
      )}
    </>
  );
}

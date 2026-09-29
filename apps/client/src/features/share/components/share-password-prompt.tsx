import { useState } from "react";
import {
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { unlockShare } from "@/features/share/services/share-service.ts";

type SharePasswordPromptProps = {
  shareKey: string;
};

export default function SharePasswordPrompt({
  shareKey,
}: SharePasswordPromptProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) return;

    setLoading(true);
    setError(null);
    try {
      await unlockShare({ shareId: shareKey, password });
      // The access cookie is now set; refetch everything the share page shows.
      await queryClient.invalidateQueries({
        predicate: (query) =>
          ["shares", "shared-page-tree", "share-by-id"].includes(
            query.queryKey[0] as string,
          ),
      });
    } catch (err) {
      const status = err?.["response"]?.status;
      setError(
        status === 429
          ? t("Too many attempts. Please try again later.")
          : t("Incorrect password"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center py={80}>
      <Paper withBorder p="xl" radius="md" w={380} maw="100%">
        <form onSubmit={handleSubmit}>
          <Stack align="stretch">
            <Center>
              <ThemeIcon size={44} radius="xl" variant="light">
                <IconLock size={22} />
              </ThemeIcon>
            </Center>
            <Title order={2} size="h4" ta="center">
              {t("This page is password protected")}
            </Title>
            <Text size="sm" c="dimmed" ta="center">
              {t("Enter the password to view this page.")}
            </Text>
            <PasswordInput
              label={t("Password")}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              error={error}
              autoComplete="current-password"
              data-autofocus
              autoFocus
            />
            <Button type="submit" loading={loading} disabled={!password}>
              {t("Unlock")}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}

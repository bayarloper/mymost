import { useState } from "react";
import { z } from "zod/v4";
import { useForm } from "@mantine/form";
import { zod4Resolver } from "mantine-form-zod-resolver";
import { useDisclosure } from "@mantine/hooks";
import {
  Button,
  Divider,
  Modal,
  PasswordInput,
  Stack,
  TextInput,
} from "@mantine/core";
import { IconServer } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useWorkspacePublicDataQuery } from "@/features/workspace/queries/workspace-query.ts";
import { ldapLogin } from "@/features/ldap-auth/services/ldap-auth-service.ts";
import { getPostLoginRedirect } from "@/lib/app-route.ts";

const formSchema = z.object({
  username: z.string().trim().min(1, { message: "Username is required" }),
  password: z.string().min(1, { message: "Password is required" }),
});
type FormValues = z.infer<typeof formSchema>;

export default function LdapLogin({ showDivider }: { showDivider?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data } = useWorkspacePublicDataQuery();
  const [opened, { open, close }] = useDisclosure(false);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<FormValues>({
    validate: zod4Resolver(formSchema),
    initialValues: { username: "", password: "" },
  });

  const provider = data?.authProviders?.find(
    (p) => (p.type as string) === "ldap",
  );
  if (!provider) return null;

  async function onSubmit(values: FormValues) {
    setIsLoading(true);
    try {
      await ldapLogin(values);
      close();
      navigate(getPostLoginRedirect());
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message ?? t("Login failed"),
        color: "red",
      });
    } finally {
      setIsLoading(false);
    }
  }

  function handleClose() {
    form.reset();
    close();
  }

  return (
    <>
      <Button
        fullWidth
        variant="default"
        leftSection={<IconServer size={16} />}
        onClick={open}
      >
        {t("Sign in with {{name}}", { name: provider.name })}
      </Button>

      {showDivider && (
        <Divider my="md" label={t("OR")} labelPosition="center" />
      )}

      <Modal
        opened={opened}
        onClose={handleClose}
        title={provider.name}
        centered
      >
        <form onSubmit={form.onSubmit(onSubmit)}>
          <Stack>
            <TextInput
              label={t("Username")}
              placeholder="jdoe"
              autoComplete="username"
              data-autofocus
              {...form.getInputProps("username")}
            />
            <PasswordInput
              label={t("Password")}
              autoComplete="current-password"
              {...form.getInputProps("password")}
            />
            <Button type="submit" fullWidth loading={isLoading}>
              {t("Sign In")}
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useForm } from "@mantine/form";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  useLdapConfigQuery,
  useTestLdapConfigMutation,
  useUpdateLdapConfigMutation,
} from "@/features/ldap-auth/queries/ldap-auth-query.ts";
import {
  ILdapConfig,
  ILdapConfigInput,
  ILdapTestResult,
} from "@/features/ldap-auth/types/ldap-auth.types.ts";
import { useGetGroupsQuery } from "@/features/group/queries/group-query.ts";

const DEFAULT_VALUES: ILdapConfigInput = {
  name: "Active Directory",
  isEnabled: false,
  allowSignup: true,
  url: "ldap://",
  bindDn: "",
  bindPassword: "",
  baseDn: "",
  userSearchFilter: "(sAMAccountName={{username}})",
  userAttributes: {
    username: "sAMAccountName",
    email: "mail",
    name: "displayName",
    uid: "objectGUID",
  },
  tlsEnabled: false,
  tlsCaCert: "",
  allowedUsers: [],
  allowedGroups: [],
  nestedGroups: true,
  linkExistingByEmail: false,
};

function toFormValues(config: ILdapConfig): ILdapConfigInput {
  const { id, hasBindPassword, ...rest } = config;
  return {
    ...DEFAULT_VALUES,
    ...rest,
    bindPassword: "",
    tlsCaCert: rest.tlsCaCert ?? "",
    allowedGroups: rest.allowedGroups.map((g) => ({
      dn: g.dn,
      docmostGroupId: g.docmostGroupId ?? null,
    })),
  };
}

export default function LdapSettingsForm() {
  const { t } = useTranslation();
  const { data: config, isLoading } = useLdapConfigQuery();
  const updateMutation = useUpdateLdapConfigMutation();
  const testMutation = useTestLdapConfigMutation();
  const { data: groups } = useGetGroupsQuery({ limit: 100 });
  const [testUsername, setTestUsername] = useState("");
  const [testResult, setTestResult] = useState<ILdapTestResult | null>(null);

  const form = useForm<ILdapConfigInput>({
    initialValues: DEFAULT_VALUES,
    validate: {
      name: (v) => (v.trim() ? null : t("Required")),
      url: (v) =>
        /^ldaps?:\/\/.+/i.test(v.trim())
          ? null
          : t("URL must start with ldap:// or ldaps://"),
      bindDn: (v) => (v.trim() ? null : t("Required")),
      bindPassword: (v) =>
        v || config?.hasBindPassword ? null : t("Required"),
      baseDn: (v) => (v.trim() ? null : t("Required")),
      userSearchFilter: (v) =>
        v.includes("{{username}}")
          ? null
          : t("User search filter must contain {{username}}", {
              username: "{{username}}",
            }),
    },
  });

  useEffect(() => {
    if (config) {
      const values = toFormValues(config);
      form.setValues(values);
      form.resetDirty(values);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const groupOptions = useMemo(
    () =>
      (groups?.items ?? [])
        .filter((g) => !g.isDefault)
        .map((g) => ({ value: g.id, label: g.name })),
    [groups],
  );

  if (isLoading) {
    return <Loader size="sm" />;
  }

  const handleSubmit = (values: ILdapConfigInput) => {
    updateMutation.mutate({
      ...values,
      allowedGroups: values.allowedGroups.filter((g) => g.dn.trim()),
    });
  };

  const handleTest = async () => {
    const validation = await form.validate();
    if (validation.hasErrors) return;
    setTestResult(null);
    try {
      const result = await testMutation.mutateAsync({
        ...form.getValues(),
        testUsername: testUsername.trim() || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        message: err?.response?.data?.message ?? t("Connection failed"),
      });
    }
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="lg">
        <Stack gap="xs">
          <Switch
            label={t("Enable LDAP login")}
            description={t(
              "Shows a sign-in button for directory users on the login page.",
            )}
            {...form.getInputProps("isEnabled", { type: "checkbox" })}
          />
          <TextInput
            label={t("Button label")}
            description={t("Shown on the login page, e.g. 'Active Directory'.")}
            {...form.getInputProps("name")}
          />
        </Stack>

        <Stack gap="xs">
          <Title order={4}>{t("Connection")}</Title>
          <TextInput
            label={t("Server URL")}
            placeholder="ldaps://dc01.corp.local:636"
            {...form.getInputProps("url")}
          />
          <Switch
            label={t("Use StartTLS")}
            description={t(
              "Upgrades ldap:// connections to TLS. ldaps:// URLs always use TLS.",
            )}
            {...form.getInputProps("tlsEnabled", { type: "checkbox" })}
          />
          <Textarea
            label={t("CA certificate (PEM)")}
            description={t(
              "Only needed if the directory uses a certificate from an internal CA.",
            )}
            placeholder="-----BEGIN CERTIFICATE-----"
            autosize
            minRows={2}
            maxRows={8}
            styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
            {...form.getInputProps("tlsCaCert")}
          />
          <TextInput
            label={t("Bind DN")}
            description={t("Service account used to look up users.")}
            placeholder="CN=svc-docmost,OU=Service Accounts,DC=corp,DC=local"
            {...form.getInputProps("bindDn")}
          />
          <PasswordInput
            label={t("Bind password")}
            placeholder={
              config?.hasBindPassword ? t("Leave blank to keep current") : ""
            }
            autoComplete="new-password"
            {...form.getInputProps("bindPassword")}
          />
          <TextInput
            label={t("Base DN")}
            description={t("Where to search for users.")}
            placeholder="OU=Users,DC=corp,DC=local"
            {...form.getInputProps("baseDn")}
          />
          <TextInput
            label={t("User search filter")}
            description={t(
              "{{username}} is replaced with the (escaped) login name.",
              { username: "{{username}}" },
            )}
            {...form.getInputProps("userSearchFilter")}
          />
        </Stack>

        <Stack gap="xs">
          <Title order={4}>{t("Attribute mapping")}</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label={t("Username attribute")}
              {...form.getInputProps("userAttributes.username")}
            />
            <TextInput
              label={t("Email attribute")}
              {...form.getInputProps("userAttributes.email")}
            />
            <TextInput
              label={t("Display name attribute")}
              {...form.getInputProps("userAttributes.name")}
            />
            <TextInput
              label={t("Unique ID attribute")}
              description={t(
                "objectGUID for Active Directory, entryUUID for OpenLDAP.",
              )}
              {...form.getInputProps("userAttributes.uid")}
            />
          </SimpleGrid>
        </Stack>

        <Stack gap="xs">
          <Title order={4}>{t("Who can sign in")}</Title>
          <Text size="sm" c="dimmed">
            {t(
              "Only the users and members of the groups listed here can sign in. Everyone else in the directory is denied.",
            )}
          </Text>

          <TagsInput
            label={t("Allowed users")}
            description={t(
              "Directory usernames, e.g. jdoe. Press Enter to add.",
            )}
            clearable
            {...form.getInputProps("allowedUsers")}
          />

          <Text size="sm" fw={500} mt="xs">
            {t("Allowed groups")}
          </Text>
          <Text size="xs" c="dimmed">
            {t(
              "Optionally link a directory group to a Docmost group. Members are added to it on sign in and removed when they leave the directory group.",
            )}
          </Text>

          {form.getValues().allowedGroups.map((_, index) => (
            <Group
              key={form.key(`allowedGroups.${index}`)}
              align="flex-start"
              wrap="nowrap"
            >
              <TextInput
                style={{ flex: 2 }}
                placeholder="CN=Finance,OU=Groups,DC=corp,DC=local"
                aria-label={t("Group DN")}
                {...form.getInputProps(`allowedGroups.${index}.dn`)}
              />
              <Select
                style={{ flex: 1 }}
                placeholder={t("No Docmost group")}
                aria-label={t("Docmost group")}
                data={groupOptions}
                clearable
                searchable
                {...form.getInputProps(`allowedGroups.${index}.docmostGroupId`)}
              />
              <ActionIcon
                variant="subtle"
                color="red"
                mt={4}
                aria-label={t("Remove")}
                onClick={() => form.removeListItem("allowedGroups", index)}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          ))}

          <Group>
            <Button
              variant="default"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() =>
                form.insertListItem("allowedGroups", {
                  dn: "",
                  docmostGroupId: null,
                })
              }
            >
              {t("Add group")}
            </Button>
          </Group>

          <Switch
            mt="xs"
            label={t("Include nested groups (Active Directory)")}
            description={t(
              "Also allow members of groups nested inside the allowed groups.",
            )}
            {...form.getInputProps("nestedGroups", { type: "checkbox" })}
          />
        </Stack>

        <Stack gap="xs">
          <Title order={4}>{t("Accounts")}</Title>
          <Switch
            label={t("Create accounts automatically")}
            description={t(
              "Create a Docmost account the first time an allowed user signs in.",
            )}
            {...form.getInputProps("allowSignup", { type: "checkbox" })}
          />
          <Switch
            label={t("Link existing accounts by email")}
            description={t(
              "Let directory users sign in to an existing Docmost account with the same email address.",
            )}
            {...form.getInputProps("linkExistingByEmail", {
              type: "checkbox",
            })}
          />
        </Stack>

        <Stack gap="xs">
          <Title order={4}>{t("Test connection")}</Title>
          <Group align="flex-end">
            <TextInput
              style={{ flex: 1 }}
              label={t("Test username (optional)")}
              description={t(
                "Looks the user up and checks group access. No password is needed.",
              )}
              value={testUsername}
              onChange={(e) => setTestUsername(e.currentTarget.value)}
            />
            <Button
              variant="default"
              onClick={handleTest}
              loading={testMutation.isPending}
            >
              {t("Test")}
            </Button>
          </Group>

          {testResult && (
            <Alert color={testResult.success ? "green" : "red"}>
              <Text size="sm">{testResult.message}</Text>
              {testResult.user && (
                <Stack gap={4} mt="xs">
                  <Text size="xs">DN: {testResult.user.dn}</Text>
                  <Text size="xs">
                    {t("Email")}: {testResult.user.email ?? "-"}
                  </Text>
                  <Text size="xs">
                    {t("Name")}: {testResult.user.name ?? "-"}
                  </Text>
                  <Text size="xs">
                    {t("Matched groups")}:{" "}
                    {testResult.memberOfGroups?.length
                      ? testResult.memberOfGroups.join("; ")
                      : "-"}
                  </Text>
                  <Group gap="xs">
                    <Badge color={testResult.allowed ? "green" : "red"}>
                      {testResult.allowed
                        ? t("Allowed to sign in")
                        : t("Not allowed to sign in")}
                    </Badge>
                  </Group>
                </Stack>
              )}
            </Alert>
          )}
        </Stack>

        <Group justify="flex-end">
          <Button type="submit" loading={updateMutation.isPending}>
            {t("Save")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

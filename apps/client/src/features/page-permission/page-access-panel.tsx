import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Button,
  Group,
  Loader,
  MultiSelect,
  ScrollArea,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import {
  IconLock,
  IconUsersGroup,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { useSpaceMembersInfiniteQuery } from "@/features/space/queries/space-query.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import {
  IPagePermissionMember,
  PagePermissionRole,
  useAddPagePermissionsMutation,
  usePagePermissionInfoQuery,
  usePagePermissionMembersQuery,
  useRemovePagePermissionMutation,
  useRestrictPageMutation,
  useUnrestrictPageMutation,
  useUpdatePagePermissionRoleMutation,
} from "./page-permission.api";

type PageAccessPanelProps = {
  pageId: string;
  spaceId: string;
};

export default function PageAccessPanel({
  pageId,
  spaceId,
}: PageAccessPanelProps) {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const { data: info, isLoading } = usePagePermissionInfoQuery(pageId);
  const isRestricted = !!info?.isRestricted;
  const canManage = !!info?.canManage;
  const { data: members } = usePagePermissionMembersQuery(pageId, isRestricted);

  const restrictMutation = useRestrictPageMutation(pageId);
  const unrestrictMutation = useUnrestrictPageMutation(pageId);
  const addMutation = useAddPagePermissionsMutation(pageId);
  const removeMutation = useRemovePagePermissionMutation(pageId);
  const updateRoleMutation = useUpdatePagePermissionRoleMutation(pageId);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [selected, setSelected] = useState<string[]>([]);
  const [newRole, setNewRole] = useState<PagePermissionRole>("reader");
  const { data: spaceMembers } = useSpaceMembersInfiniteQuery(
    isRestricted && canManage ? spaceId : undefined,
    debouncedSearch,
  );

  const roleOptions = [
    { value: "reader", label: t("Can view") },
    { value: "writer", label: t("Can edit") },
  ];

  const existingKeys = useMemo(
    () => new Set((members?.items ?? []).map((m) => `${m.type}:${m.id}`)),
    [members],
  );

  const candidateOptions = useMemo(() => {
    const items = spaceMembers?.pages.flatMap((p) => p.items) ?? [];
    return items
      .filter((m) => !existingKeys.has(`${m.type}:${m.id}`))
      .map((m) => ({
        value: `${m.type}:${m.id}`,
        label: m.type === "group" ? `${m.name} (${t("group")})` : m.name,
      }));
  }, [spaceMembers, existingKeys, t]);

  if (isLoading || !info) {
    return <Loader size="sm" />;
  }

  const handleGeneralAccess = (value: string | null) => {
    if (value === "restricted" && !isRestricted) {
      restrictMutation.mutate();
    } else if (value === "space" && isRestricted) {
      modals.openConfirmModal({
        title: t("Remove page restriction?"),
        centered: true,
        children: (
          <Text size="sm">
            {t(
              "Everyone with access to the space will be able to open this page again.",
            )}
          </Text>
        ),
        labels: { confirm: t("Remove restriction"), cancel: t("Cancel") },
        onConfirm: () => unrestrictMutation.mutate(),
      });
    }
  };

  const handleAdd = () => {
    const userIds = selected
      .filter((v) => v.startsWith("user:"))
      .map((v) => v.slice(5));
    const groupIds = selected
      .filter((v) => v.startsWith("group:"))
      .map((v) => v.slice(6));
    addMutation.mutate(
      { userIds, groupIds, role: newRole },
      { onSuccess: () => setSelected([]) },
    );
  };

  const target = (m: IPagePermissionMember) =>
    m.type === "user" ? { userId: m.id } : { groupId: m.id };

  return (
    <Stack gap="sm">
      {info.inheritedFrom && (
        <Alert
          variant="light"
          color="yellow"
          icon={<IconLock size={16} />}
          p="xs"
        >
          <Text size="xs">
            {t("Access is also limited by the restricted parent page")}{" "}
            <Anchor
              size="xs"
              component={Link}
              to={buildPageUrl(
                spaceSlug,
                info.inheritedFrom.slugId,
                info.inheritedFrom.title,
              )}
            >
              {info.inheritedFrom.title || t("untitled")}
            </Anchor>
          </Text>
        </Alert>
      )}

      <div>
        <Text size="sm" fw={500} mb={4}>
          {t("General access")}
        </Text>
        <Select
          size="sm"
          value={isRestricted ? "restricted" : "space"}
          onChange={handleGeneralAccess}
          allowDeselect={false}
          disabled={
            !canManage ||
            restrictMutation.isPending ||
            unrestrictMutation.isPending
          }
          leftSection={
            isRestricted ? <IconLock size={16} /> : <IconWorld size={16} />
          }
          data={[
            { value: "space", label: t("Everyone in this space") },
            { value: "restricted", label: t("Only people with access") },
          ]}
          comboboxProps={{ withinPortal: false }}
        />
        <Text size="xs" c="dimmed" mt={4}>
          {isRestricted
            ? t(
                "Only the people and groups below can open this page and its sub-pages.",
              )
            : t("Anyone who can access this space can open this page.")}
        </Text>
      </div>

      {isRestricted && canManage && (
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <MultiSelect
            style={{ flex: 1 }}
            size="xs"
            placeholder={t("Add people or groups")}
            data={candidateOptions}
            value={selected}
            onChange={setSelected}
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            nothingFoundMessage={t("No space members found")}
            comboboxProps={{ withinPortal: false }}
            hidePickedOptions
          />
          <Select
            size="xs"
            w={105}
            data={roleOptions}
            value={newRole}
            onChange={(v) => setNewRole((v as PagePermissionRole) ?? "reader")}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
          />
          <Button
            size="xs"
            onClick={handleAdd}
            disabled={selected.length === 0}
            loading={addMutation.isPending}
          >
            {t("Add")}
          </Button>
        </Group>
      )}

      {isRestricted && (
        <ScrollArea.Autosize mah={240}>
          <Stack gap={6}>
            {(members?.items ?? []).map((member) => (
              <Group
                key={`${member.type}:${member.id}`}
                justify="space-between"
                wrap="nowrap"
              >
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  {member.type === "user" ? (
                    <CustomAvatar
                      size="sm"
                      avatarUrl={member.avatarUrl}
                      name={member.name}
                    />
                  ) : (
                    <Avatar size="sm" radius="xl">
                      <IconUsersGroup size={14} />
                    </Avatar>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" lineClamp={1}>
                      {member.name}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {member.type === "user"
                        ? member.email
                        : t("{{count}} members", { count: member.memberCount })}
                    </Text>
                  </div>
                </Group>
                <Group gap={4} wrap="nowrap">
                  <Select
                    size="xs"
                    w={105}
                    data={roleOptions}
                    value={member.role}
                    disabled={!canManage}
                    allowDeselect={false}
                    comboboxProps={{ withinPortal: false }}
                    onChange={(v) =>
                      v &&
                      v !== member.role &&
                      updateRoleMutation.mutate({
                        ...target(member),
                        role: v as PagePermissionRole,
                      })
                    }
                  />
                  {canManage && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label={t("Remove")}
                      onClick={() => removeMutation.mutate(target(member))}
                    >
                      <IconX size={16} />
                    </ActionIcon>
                  )}
                </Group>
              </Group>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Stack>
  );
}

import { Fragment, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import useUserRole from "@/hooks/use-user-role.tsx";
import NoTableResults from "@/components/common/no-table-results.tsx";
import {
  formatAuditEvent,
  IAuditLog,
  IAuditLogFilters,
  useAuditLogsQuery,
  useAuditSettingsQuery,
  useUpdateAuditRetentionMutation,
} from "@/features/audit/audit.api.ts";

const EVENT_CATEGORIES = [
  "user",
  "workspace",
  "space",
  "group",
  "page",
  "comment",
  "share",
  "api_key",
  "sso",
];

function AuditDetails({ log }: { log: IAuditLog }) {
  const { t } = useTranslation();
  const details = {
    ...(log.changes ? { changes: log.changes } : {}),
    ...(log.metadata ? { metadata: log.metadata } : {}),
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    actorType: log.actorType,
    userAgent: log.userAgent,
  };
  return (
    <Stack gap={4}>
      <Text size="xs" c="dimmed">
        {t("Details")}
      </Text>
      <Code block style={{ fontSize: 11, maxHeight: 240, overflow: "auto" }}>
        {JSON.stringify(details, null, 2)}
      </Code>
    </Stack>
  );
}

export default function AuditLogs() {
  const { t } = useTranslation();
  const { isOwner } = useUserRole();
  const [category, setCategory] = useState<string | null>(null);
  const [range, setRange] = useState<[string | null, string | null]>([
    null,
    null,
  ]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filters: IAuditLogFilters = {
    eventPrefix: category ?? undefined,
    startDate: range[0] ? new Date(range[0]).toISOString() : undefined,
    endDate: range[1]
      ? new Date(
          new Date(range[1]).getTime() + 24 * 60 * 60 * 1000 - 1,
        ).toISOString()
      : undefined,
  };

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAuditLogsQuery(filters);
  const { data: settings } = useAuditSettingsQuery();
  const retentionMutation = useUpdateAuditRetentionMutation();

  if (!isOwner) return null;

  const logs = data?.pages.flatMap((p) => p.items) ?? [];

  const retentionOptions = [
    { value: "30", label: t("30 days") },
    { value: "90", label: t("90 days") },
    { value: "180", label: t("180 days") },
    { value: "365", label: t("1 year") },
    { value: "730", label: t("2 years") },
    { value: "1825", label: t("5 years") },
    { value: "0", label: t("Forever") },
  ];

  return (
    <>
      <DocumentTitle title={t("Audit logs")} />
      <SettingsTitle title={t("Audit logs")} />

      <Group justify="space-between" align="flex-end" mb="md" wrap="wrap">
        <Group gap="sm" align="flex-end">
          <Select
            label={t("Category")}
            placeholder={t("All events")}
            clearable
            w={180}
            value={category}
            onChange={(value) => setCategory(value ? String(value) : null)}
            data={EVENT_CATEGORIES.map((c) => ({
              value: c,
              label: formatAuditEvent(c),
            }))}
          />
          <DatePickerInput
            type="range"
            label={t("Date range")}
            placeholder={t("Any time")}
            clearable
            w={260}
            value={range}
            onChange={(value) =>
              setRange(value as [string | null, string | null])
            }
          />
        </Group>
        <Select
          label={t("Keep logs for")}
          w={160}
          allowDeselect={false}
          value={settings ? String(settings.retentionDays) : null}
          onChange={(v) => v !== null && retentionMutation.mutate(Number(v))}
          data={retentionOptions}
        />
      </Group>

      <Table.ScrollContainer minWidth={700}>
        <Table highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={30} />
              <Table.Th>{t("Time")}</Table.Th>
              <Table.Th>{t("Actor")}</Table.Th>
              <Table.Th>{t("Event")}</Table.Th>
              <Table.Th>{t("Space")}</Table.Th>
              <Table.Th>{t("IP address")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading ? (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Loader size="sm" />
                </Table.Td>
              </Table.Tr>
            ) : logs.length === 0 ? (
              <NoTableResults colSpan={6} text={t("No audit logs")} />
            ) : (
              logs.map((log) => (
                <Fragment key={log.id}>
                  <Table.Tr
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      setExpanded(expanded === log.id ? null : log.id)
                    }
                  >
                    <Table.Td>
                      <ActionIcon variant="subtle" color="gray" size="sm">
                        {expanded === log.id ? (
                          <IconChevronDown size={14} />
                        ) : (
                          <IconChevronRight size={14} />
                        )}
                      </ActionIcon>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={new Date(log.createdAt).toISOString()}>
                        <Text size="sm">
                          {format(
                            new Date(log.createdAt),
                            "MMM dd, yyyy HH:mm",
                          )}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      {log.actor ? (
                        <Group gap="xs" wrap="nowrap">
                          <CustomAvatar
                            size={24}
                            avatarUrl={log.actor.avatarUrl}
                            name={log.actor.name}
                          />
                          <Text size="sm" lineClamp={1}>
                            {log.actor.name}
                          </Text>
                          {log.actorType === "api_key" && (
                            <Badge size="xs" variant="light">
                              API
                            </Badge>
                          )}
                        </Group>
                      ) : (
                        <Text size="sm" c="dimmed">
                          {log.actorType === "system" ? t("System") : "-"}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatAuditEvent(log.event)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{log.space?.name ?? "-"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {log.ipAddress ?? "-"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                  {expanded === log.id && (
                    <Table.Tr>
                      <Table.Td />
                      <Table.Td colSpan={5}>
                        <AuditDetails log={log} />
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {hasNextPage && (
        <Group justify="center" mt="md">
          <Button
            variant="default"
            onClick={() => fetchNextPage()}
            loading={isFetchingNextPage}
          >
            {t("Load more")}
          </Button>
        </Group>
      )}
    </>
  );
}

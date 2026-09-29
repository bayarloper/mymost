import { useState } from "react";
import {
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Select,
  Table,
  Text,
} from "@mantine/core";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import NoTableResults from "@/components/common/no-table-results.tsx";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { getPageIcon } from "@/lib";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import {
  useVerificationListQuery,
  useVerificationStateLabel,
  VerificationState,
} from "@/features/page-verification/verification.api.ts";

const STATES: VerificationState[] = [
  "verified",
  "expiring",
  "expired",
  "unverified",
  "in_approval",
  "approved",
  "draft",
  "obsolete",
];

export default function VerifiedPages() {
  const { t } = useTranslation();
  const stateLabel = useVerificationStateLabel();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const { data: spaces } = useGetSpacesQuery({ limit: 100 });
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useVerificationListQuery({
      spaceId: spaceId ?? undefined,
      state: (state as VerificationState) ?? undefined,
    });

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <DocumentTitle title={t("Verified pages")} />
      <SettingsTitle title={t("Verified pages")} />

      <Group mb="md">
        <Select
          placeholder={t("All spaces")}
          clearable
          w={220}
          value={spaceId}
          onChange={(v) => setSpaceId(v ? String(v) : null)}
          data={(spaces?.items ?? []).map((s) => ({
            value: s.id,
            label: s.name,
          }))}
        />
        <Select
          placeholder={t("All statuses")}
          clearable
          w={200}
          value={state}
          onChange={(v) => setState(v ? String(v) : null)}
          data={STATES.map((s) => ({ value: s, label: stateLabel(s).label }))}
        />
      </Group>

      <Table.ScrollContainer minWidth={600}>
        <Table highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Page")}</Table.Th>
              <Table.Th>{t("Space")}</Table.Th>
              <Table.Th>{t("Status")}</Table.Th>
              <Table.Th>{t("Verified by")}</Table.Th>
              <Table.Th>{t("Expires")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Loader size="sm" />
                </Table.Td>
              </Table.Tr>
            ) : items.length === 0 ? (
              <NoTableResults colSpan={5} text={t("No verified pages")} />
            ) : (
              items.map((item) => {
                const { label, color } = stateLabel(item.state);
                return (
                  <Table.Tr key={item.id}>
                    <Table.Td>
                      <Anchor
                        component={Link}
                        to={buildPageUrl(
                          item.spaceSlug,
                          item.pageSlugId,
                          item.pageTitle,
                        )}
                        size="sm"
                        underline="never"
                      >
                        <Group gap={6} wrap="nowrap">
                          {getPageIcon(item.pageIcon)}
                          <Text size="sm" lineClamp={1}>
                            {item.pageTitle || t("untitled")}
                          </Text>
                        </Group>
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{item.spaceName}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={color}>
                        {label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{item.verifiedBy?.name ?? "-"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {item.type === "expiring" && item.expiresAt
                          ? format(new Date(item.expiresAt), "MMM dd, yyyy")
                          : "-"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })
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

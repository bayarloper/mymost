import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { IconRosetteDiscountCheck } from "@tabler/icons-react";
import { format } from "date-fns";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import { extractPageSlugId } from "@/lib";
import { useSpaceMembersInfiniteQuery } from "@/features/space/queries/space-query.ts";
import {
  PeriodUnit,
  useVerificationAction,
  useVerificationInfoQuery,
  useVerificationStateLabel,
  VerificationType,
} from "./verification.api";

/** Status badge shown next to the page title. Clicking opens the modal. */
export function PageVerificationBadge({ readOnly }: { readOnly?: boolean }) {
  const { pageSlug } = useParams();
  const { data: page } = usePageQuery({ pageId: extractPageSlugId(pageSlug) });
  const { data } = useVerificationInfoQuery(page?.id);
  const stateLabel = useVerificationStateLabel();
  const [opened, { open, close }] = useDisclosure(false);

  const verification = data?.verification;
  if (!page || !verification) return null;

  const { label, color } = stateLabel(verification.state);
  const tooltip =
    verification.type === "expiring" && verification.expiresAt
      ? format(new Date(verification.expiresAt), "MMM dd, yyyy")
      : undefined;

  return (
    <>
      <Tooltip label={tooltip} disabled={!tooltip} withArrow>
        <Badge
          variant="light"
          color={color}
          leftSection={<IconRosetteDiscountCheck size={14} />}
          style={{ cursor: "pointer" }}
          onClick={open}
        >
          {label}
        </Badge>
      </Tooltip>
      <PageVerificationModal
        pageId={page.id}
        opened={opened}
        onClose={close}
        readOnly={readOnly}
      />
    </>
  );
}

export function PageVerificationMenuItem({
  pageId,
  onClick,
}: {
  pageId?: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  if (!pageId) return null;
  return (
    <Menu.Item
      leftSection={<IconRosetteDiscountCheck size={16} />}
      onClick={onClick}
    >
      {t("Verification")}
    </Menu.Item>
  );
}

export function PageVerificationModal({
  pageId,
  opened,
  onClose,
  readOnly,
}: {
  pageId: string;
  opened: boolean;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { data: info } = useVerificationInfoQuery(opened ? pageId : undefined);
  const [editing, setEditing] = useState(false);
  const verification = info?.verification;

  useEffect(() => {
    if (opened) setEditing(false);
  }, [opened]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Page verification")}
      size="lg"
      centered
    >
      {!info ? null : editing || !verification ? (
        info.canManage && !readOnly ? (
          <VerificationSetupForm
            pageId={pageId}
            onDone={() => setEditing(false)}
            onCancel={verification ? () => setEditing(false) : onClose}
          />
        ) : (
          <Text size="sm" c="dimmed">
            {t("Verification has not been set up for this page.")}
          </Text>
        )
      ) : (
        <VerificationStatusView
          pageId={pageId}
          onEdit={
            info.canManage && !readOnly ? () => setEditing(true) : undefined
          }
        />
      )}
    </Modal>
  );
}

function VerificationStatusView({
  pageId,
  onEdit,
}: {
  pageId: string;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const { data: info } = useVerificationInfoQuery(pageId);
  const action = useVerificationAction(pageId);
  const stateLabel = useVerificationStateLabel();
  const verification = info?.verification;
  if (!info || !verification) return null;

  const { label, color } = stateLabel(verification.state);
  const fmt = (d: string | null) =>
    d ? format(new Date(d), "MMM dd, yyyy HH:mm") : "-";

  const confirmRemove = () =>
    modals.openConfirmModal({
      title: t("Remove verification?"),
      centered: true,
      labels: { confirm: t("Remove"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => action.mutate({ action: "remove" }),
    });

  return (
    <Stack>
      <Group justify="space-between">
        <Badge size="lg" variant="light" color={color}>
          {label}
        </Badge>
        <Text size="sm" c="dimmed">
          {verification.type === "expiring"
            ? t("Re-verify every {{amount}} {{unit}}", {
                amount: verification.periodAmount,
                unit: t(verification.periodUnit ?? "month"),
              })
            : t("Approval workflow")}
        </Text>
      </Group>

      {verification.type === "expiring" ? (
        <Stack gap={2}>
          <Text size="sm">
            {t("Last verified")}: {fmt(verification.verifiedAt)}
          </Text>
          <Text size="sm">
            {t("Expires")}: {fmt(verification.expiresAt)}
          </Text>
        </Stack>
      ) : (
        <Stack gap={2}>
          {verification.requestedAt && (
            <Text size="sm">
              {t("Approval requested")}: {fmt(verification.requestedAt)}
            </Text>
          )}
          {verification.verifiedAt && (
            <Text size="sm">
              {t("Last approved")}: {fmt(verification.verifiedAt)}
            </Text>
          )}
          {verification.rejectionComment && verification.state === "draft" && (
            <Alert color="orange" title={t("Returned for revision")}>
              <Text size="sm">{verification.rejectionComment}</Text>
            </Alert>
          )}
        </Stack>
      )}

      <div>
        <Text size="sm" fw={500} mb={4}>
          {t("Verifiers")}
        </Text>
        <Text size="sm" c="dimmed">
          {verification.verifiers.map((v) => v.name).join(", ")}
        </Text>
      </div>

      <Divider />

      <Group justify="space-between">
        <Group gap="xs">
          {verification.type === "expiring" && info.isVerifier && (
            <Button
              loading={action.isPending}
              onClick={() => action.mutate({ action: "verify" })}
            >
              {t("Verify now")}
            </Button>
          )}

          {verification.type === "approval" &&
            verification.state !== "in_approval" &&
            info.canManage && (
              <Button
                loading={action.isPending}
                onClick={() => action.mutate({ action: "request-approval" })}
              >
                {t("Request approval")}
              </Button>
            )}

          {verification.type === "approval" &&
            verification.state === "in_approval" &&
            info.isVerifier && (
              <>
                <Button
                  color="green"
                  loading={action.isPending}
                  onClick={() => action.mutate({ action: "approve" })}
                >
                  {t("Approve")}
                </Button>
                <Button
                  variant="default"
                  onClick={() => {
                    // Read by onConfirm; a closure over state would be stale.
                    let comment = "";
                    modals.openConfirmModal({
                      title: t("Return for revision"),
                      centered: true,
                      children: (
                        <Textarea
                          label={t("Comment (optional)")}
                          autosize
                          minRows={2}
                          onChange={(e) => {
                            comment = e.currentTarget.value;
                          }}
                        />
                      ),
                      labels: { confirm: t("Reject"), cancel: t("Cancel") },
                      confirmProps: { color: "red" },
                      onConfirm: () =>
                        action.mutate({
                          action: "reject",
                          data: { comment },
                        }),
                    });
                  }}
                >
                  {t("Reject")}
                </Button>
              </>
            )}

          {verification.type === "approval" &&
            verification.state !== "obsolete" &&
            info.isVerifier && (
              <Button
                variant="subtle"
                color="red"
                onClick={() => action.mutate({ action: "mark-obsolete" })}
              >
                {t("Mark obsolete")}
              </Button>
            )}
        </Group>

        {onEdit && (
          <Group gap="xs">
            <Button variant="default" onClick={onEdit}>
              {t("Edit")}
            </Button>
            <Button variant="subtle" color="red" onClick={confirmRemove}>
              {t("Remove")}
            </Button>
          </Group>
        )}
      </Group>
    </Stack>
  );
}

function VerificationSetupForm({
  pageId,
  onDone,
  onCancel,
}: {
  pageId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { data: info } = useVerificationInfoQuery(pageId);
  const { data: page } = usePageQuery({ pageId });
  const action = useVerificationAction(pageId);
  const existing = info?.verification;

  const [type, setType] = useState<VerificationType>(
    existing?.type ?? "expiring",
  );
  const [periodAmount, setPeriodAmount] = useState<number>(
    existing?.periodAmount ?? 3,
  );
  const [periodUnit, setPeriodUnit] = useState<PeriodUnit>(
    existing?.periodUnit ?? "month",
  );
  const [verifierIds, setVerifierIds] = useState<string[]>(
    existing?.verifiers.map((v) => v.id) ?? [],
  );
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const { data: members } = useSpaceMembersInfiniteQuery(
    page?.spaceId,
    debouncedSearch,
  );

  const options = useMemo(() => {
    const map = new Map<string, string>();
    existing?.verifiers.forEach((v) => map.set(v.id, v.name));
    members?.pages
      .flatMap((p) => p.items)
      .filter((m) => m.type === "user")
      .forEach((m) => map.set(m.id, m.name));
    return [...map].map(([value, label]) => ({ value, label }));
  }, [members, existing]);

  const submit = () =>
    action.mutate(
      {
        action: "setup",
        data: {
          type,
          verifierIds,
          ...(type === "expiring" ? { periodAmount, periodUnit } : {}),
        },
      },
      { onSuccess: onDone },
    );

  return (
    <Stack>
      <SegmentedControl
        value={type}
        onChange={(v) => setType(v as VerificationType)}
        data={[
          { value: "expiring", label: t("Periodic verification") },
          { value: "approval", label: t("Approval workflow") },
        ]}
      />
      <Text size="sm" c="dimmed">
        {type === "expiring"
          ? t(
              "Verifiers confirm the page is still accurate on a regular schedule. They are notified before it expires.",
            )
          : t(
              "Editors request approval and verifiers approve or return the page for revision.",
            )}
      </Text>

      {type === "expiring" && (
        <Group grow>
          <NumberInput
            label={t("Re-verify every")}
            min={1}
            max={365}
            value={periodAmount}
            onChange={(v) => setPeriodAmount(Number(v) || 1)}
          />
          <Select
            label={t("Unit")}
            allowDeselect={false}
            value={periodUnit}
            onChange={(v) => setPeriodUnit((v as PeriodUnit) ?? "month")}
            data={[
              { value: "day", label: t("Days") },
              { value: "week", label: t("Weeks") },
              { value: "month", label: t("Months") },
              { value: "year", label: t("Years") },
            ]}
          />
        </Group>
      )}

      <MultiSelect
        label={t("Verifiers")}
        description={t("Space members who can verify or approve this page.")}
        data={options}
        value={verifierIds}
        onChange={setVerifierIds}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        nothingFoundMessage={t("No space members found")}
        maxValues={20}
      />

      {existing && existing.type !== type && (
        <Alert color="yellow">
          {t("Changing the type resets the current verification status.")}
        </Alert>
      )}

      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button
          onClick={submit}
          loading={action.isPending}
          disabled={verifierIds.length === 0}
        >
          {t("Save")}
        </Button>
      </Group>
    </Stack>
  );
}

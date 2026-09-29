import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import api from "@/lib/api-client";
import { IPagination } from "@/lib/types.ts";

export interface IAuditLog {
  id: string;
  event: string;
  resourceType: string;
  resourceId: string | null;
  spaceId: string | null;
  actorId: string | null;
  actorType: "user" | "system" | "api_key";
  changes: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  } | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  } | null;
  space: { id: string; name: string; slug: string } | null;
}

export interface IAuditLogFilters {
  eventPrefix?: string;
  actorId?: string;
  spaceId?: string;
  startDate?: string;
  endDate?: string;
}

export async function getAuditLogs(
  params: IAuditLogFilters & { cursor?: string; limit?: number },
): Promise<IPagination<IAuditLog>> {
  const req = await api.post<IPagination<IAuditLog>>("/audit", params);
  return req.data;
}

export function useAuditLogsQuery(filters: IAuditLogFilters) {
  return useInfiniteQuery({
    queryKey: ["audit-logs", filters],
    queryFn: ({ pageParam }) =>
      getAuditLogs({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNextPage ? lastPage.meta.nextCursor : undefined,
  });
}

export function useAuditSettingsQuery() {
  return useQuery({
    queryKey: ["audit-settings"],
    queryFn: async () => {
      const req = await api.post<{ retentionDays: number }>("/audit/settings");
      return req.data;
    },
  });
}

export function useUpdateAuditRetentionMutation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (retentionDays: number) => {
      const req = await api.post<{ retentionDays: number }>(
        "/audit/retention",
        { retentionDays },
      );
      return req.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["audit-settings"], data);
      notifications.show({ message: t("Updated successfully") });
    },
    onError: () => {
      notifications.show({
        message: t("Failed to update setting"),
        color: "red",
      });
    },
  });
}

/** "page.permission_added" -> "Page permission added" */
export function formatAuditEvent(event: string): string {
  const text = event.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

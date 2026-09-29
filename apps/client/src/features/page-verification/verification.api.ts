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

export type VerificationType = "expiring" | "approval";
export type PeriodUnit = "day" | "week" | "month" | "year";
export type VerificationState =
  | "unverified"
  | "verified"
  | "expiring"
  | "expired"
  | "draft"
  | "in_approval"
  | "approved"
  | "obsolete";

export interface IVerifier {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isPrimary: boolean;
}

export interface IPageVerification {
  id: string;
  pageId: string;
  type: VerificationType;
  status: string | null;
  state: VerificationState;
  periodAmount: number | null;
  periodUnit: PeriodUnit | null;
  verifiedAt: string | null;
  verifiedById: string | null;
  expiresAt: string | null;
  requestedAt: string | null;
  requestedById: string | null;
  rejectedAt: string | null;
  rejectionComment: string | null;
  verifiers: IVerifier[];
}

export interface IVerificationInfo {
  verification: IPageVerification | null;
  canManage: boolean;
  isVerifier: boolean;
}

export interface IVerificationListItem {
  id: string;
  pageId: string;
  spaceId: string;
  type: VerificationType;
  state: VerificationState;
  verifiedAt: string | null;
  expiresAt: string | null;
  pageTitle: string | null;
  pageSlugId: string;
  pageIcon: string | null;
  spaceName: string;
  spaceSlug: string;
  verifiedBy: { id: string; name: string; avatarUrl: string | null } | null;
}

export interface ISetupVerification {
  type: VerificationType;
  periodAmount?: number;
  periodUnit?: PeriodUnit;
  verifierIds: string[];
}

async function post<T>(path: string, data: object = {}): Promise<T> {
  const req = await api.post<T>(`/pages/verification/${path}`, data);
  return req.data;
}

const infoKey = (pageId: string) => ["page-verification", pageId];

export function useVerificationInfoQuery(pageId: string | undefined) {
  return useQuery({
    queryKey: infoKey(pageId),
    queryFn: () => post<IVerificationInfo>("info", { pageId }),
    enabled: !!pageId,
  });
}

export function useVerificationListQuery(filters: {
  spaceId?: string;
  state?: VerificationState;
}) {
  return useInfiniteQuery({
    queryKey: ["page-verification-list", filters],
    queryFn: ({ pageParam }) =>
      post<IPagination<IVerificationListItem>>("list", {
        ...filters,
        cursor: pageParam,
        limit: 50,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNextPage ? lastPage.meta.nextCursor : undefined,
  });
}

export function useVerificationAction(pageId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      action,
      data,
    }: {
      action:
        | "setup"
        | "remove"
        | "verify"
        | "request-approval"
        | "approve"
        | "reject"
        | "mark-obsolete";
      data?: object;
    }) => post(action, { pageId, ...(data ?? {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: infoKey(pageId) });
      queryClient.invalidateQueries({ queryKey: ["page-verification-list"] });
    },
    onError: (error) => {
      const message = error?.["response"]?.data?.message;
      notifications.show({
        message: Array.isArray(message)
          ? message.join(", ")
          : message || t("Something went wrong"),
        color: "red",
      });
    },
  });
}

export function useVerificationStateLabel() {
  const { t } = useTranslation();
  return (state: VerificationState) =>
    ({
      unverified: { label: t("Not verified"), color: "gray" },
      verified: { label: t("Verified"), color: "green" },
      expiring: { label: t("Expiring soon"), color: "yellow" },
      expired: { label: t("Verification expired"), color: "red" },
      draft: { label: t("Draft"), color: "gray" },
      in_approval: { label: t("In approval"), color: "blue" },
      approved: { label: t("Approved"), color: "green" },
      obsolete: { label: t("Obsolete"), color: "red" },
    })[state];
}

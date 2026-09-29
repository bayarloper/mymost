import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import api from "@/lib/api-client";
import { IPagination } from "@/lib/types.ts";

export type PagePermissionRole = "reader" | "writer";

export interface IPagePermissionInfo {
  pageId: string;
  isRestricted: boolean;
  inheritedFrom: { id: string; slugId: string; title: string } | null;
  canManage: boolean;
}

export type IPagePermissionMember = {
  id: string;
  name: string;
  role: PagePermissionRole;
  createdAt: string;
} & (
  | { type: "user"; email: string; avatarUrl: string | null }
  | { type: "group"; memberCount: number; isDefault: boolean }
);

export type PagePermissionTarget = { userId?: string; groupId?: string };

async function post<T>(path: string, data: object): Promise<T> {
  const req = await api.post<T>(`/pages/permissions/${path}`, data);
  return req.data;
}

const infoKey = (pageId: string) => ["page-permission-info", pageId];
const membersKey = (pageId: string) => ["page-permission-members", pageId];

export function usePagePermissionInfoQuery(
  pageId: string | undefined,
): UseQueryResult<IPagePermissionInfo, Error> {
  return useQuery({
    queryKey: infoKey(pageId),
    queryFn: () => post<IPagePermissionInfo>("info", { pageId }),
    enabled: !!pageId,
  });
}

export function usePagePermissionMembersQuery(
  pageId: string | undefined,
  enabled: boolean,
): UseQueryResult<IPagination<IPagePermissionMember>, Error> {
  return useQuery({
    queryKey: membersKey(pageId),
    queryFn: () =>
      post<IPagination<IPagePermissionMember>>("members", {
        pageId,
        limit: 100,
      }),
    enabled: !!pageId && enabled,
  });
}

function usePagePermissionMutation<TVars>(
  pageId: string,
  mutationFn: (vars: TVars) => Promise<unknown>,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, TVars>({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: infoKey(pageId) });
      queryClient.invalidateQueries({ queryKey: membersKey(pageId) });
      // Sidebar / page data carry restriction flags.
      queryClient.invalidateQueries({ queryKey: ["pages"] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-pages"] });
    },
    onError: (error) => {
      const message = error?.["response"]?.data?.message;
      notifications.show({
        message: Array.isArray(message)
          ? message.join(", ")
          : message || t("Failed to update page access"),
        color: "red",
      });
    },
  });
}

export function useRestrictPageMutation(pageId: string) {
  return usePagePermissionMutation<void>(pageId, () =>
    post("restrict", { pageId }),
  );
}

export function useUnrestrictPageMutation(pageId: string) {
  return usePagePermissionMutation<void>(pageId, () =>
    post("unrestrict", { pageId }),
  );
}

export function useAddPagePermissionsMutation(pageId: string) {
  return usePagePermissionMutation<{
    userIds: string[];
    groupIds: string[];
    role: PagePermissionRole;
  }>(pageId, (vars) => post("add", { pageId, ...vars }));
}

export function useRemovePagePermissionMutation(pageId: string) {
  return usePagePermissionMutation<PagePermissionTarget>(pageId, (target) =>
    post("remove", { pageId, ...target }),
  );
}

export function useUpdatePagePermissionRoleMutation(pageId: string) {
  return usePagePermissionMutation<
    PagePermissionTarget & { role: PagePermissionRole }
  >(pageId, (vars) => post("update-role", { pageId, ...vars }));
}

import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import {
  getLdapConfig,
  testLdapConfig,
  updateLdapConfig,
} from "@/features/ldap-auth/services/ldap-auth-service";
import {
  ILdapConfig,
  ILdapConfigInput,
  ILdapTestInput,
  ILdapTestResult,
} from "@/features/ldap-auth/types/ldap-auth.types";

export function useLdapConfigQuery(): UseQueryResult<
  ILdapConfig | null,
  Error
> {
  return useQuery({
    queryKey: ["ldap-config"],
    queryFn: () => getLdapConfig(),
  });
}

export function useUpdateLdapConfigMutation() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation<ILdapConfig, Error, ILdapConfigInput>({
    mutationFn: (data) => updateLdapConfig(data),
    onSuccess: (data) => {
      queryClient.setQueryData(["ldap-config"], data);
      queryClient.invalidateQueries({ queryKey: ["workspace-public"] });
      notifications.show({ message: t("LDAP settings saved") });
    },
    onError: (error) => {
      const message = error["response"]?.data?.message;
      notifications.show({
        message: Array.isArray(message)
          ? message.join(", ")
          : message || t("Failed to save LDAP settings"),
        color: "red",
      });
    },
  });
}

export function useTestLdapConfigMutation() {
  return useMutation<ILdapTestResult, Error, ILdapTestInput>({
    mutationFn: (data) => testLdapConfig(data),
  });
}

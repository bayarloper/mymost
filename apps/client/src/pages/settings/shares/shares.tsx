import SettingsTitle from "@/components/settings/settings-title.tsx";
import { useTranslation } from "react-i18next";
import { useAtom } from "jotai";
import ShareList from "@/features/share/components/share-list.tsx";
import PublishedSpacesList from "@/features/public-space/components/published-spaces-list.tsx";
import { isPublicSpacesAllowed } from "@/features/public-space/utils/public-space-access.ts";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { Alert, Divider, Tabs } from "@mantine/core";
import useUserRole from "@/hooks/use-user-role.tsx";
import { WorkspacePublicSharingToggle } from "@/features/share/components/public-sharing-toggle.tsx";
import { IconInfoCircle } from "@tabler/icons-react";
import React from "react";
import { DocumentTitle } from "@/components/ui/document-title.tsx";

export default function Shares() {
  const { t } = useTranslation();
  const [workspace] = useAtom(workspaceAtom);
  const { isAdmin } = useUserRole();

  const allowPublicSpaces = isPublicSpacesAllowed(workspace);

  const sharedPages = (
    <>
      <Alert variant="light" color="blue" icon={<IconInfoCircle />}>
        {t(
          "Publicly shared pages from spaces you are a member of will appear here",
        )}
      </Alert>

      <ShareList />
    </>
  );

  return (
    <>
      <DocumentTitle title={t("Public sharing")} />
      <SettingsTitle title={t("Public sharing")} />

      {isAdmin && (
        <>
          <WorkspacePublicSharingToggle />
          <Divider my="lg" />
        </>
      )}

      {allowPublicSpaces ? (
        <Tabs color="dark" defaultValue="pages">
          <Tabs.List>
            <Tabs.Tab fw={500} value="pages">
              {t("Shared pages")}
            </Tabs.Tab>
            <Tabs.Tab fw={500} value="spaces">
              {t("Published spaces")}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="pages" pt="md">
            {sharedPages}
          </Tabs.Panel>

          <Tabs.Panel value="spaces" pt="md">
            <Alert variant="light" color="blue" icon={<IconInfoCircle />}>
              {t("Spaces published to the web will appear here")}
            </Alert>

            <PublishedSpacesList />
          </Tabs.Panel>
        </Tabs>
      ) : (
        sharedPages
      )}
    </>
  );
}

import {
  ActionIcon,
  Anchor,
  Button,
  Group,
  Indicator,
  Popover,
  Switch,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { IconExternalLink, IconWorld, IconLock } from "@tabler/icons-react";
import React, { useEffect, useMemo, useState } from "react";
import {
  useCreateShareMutation,
  useDeleteShareMutation,
  useShareForPageQuery,
  useUpdateShareMutation,
} from "@/features/share/queries/share-query.ts";
import { Link, useNavigate, useParams } from "react-router-dom";
import { extractPageSlugId, getPageIcon } from "@/lib";
import { useTranslation } from "react-i18next";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import CopyTextButton from "@/components/common/copy.tsx";
import { getAppUrl, isCloud } from "@/lib/config.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import classes from "@/features/share/components/share.module.css";
import PageAccessPanel from "@/features/page-permission/page-access-panel.tsx";
import SharePasswordSettings from "@/features/share/components/share-password-settings.tsx";
import useTrial from "@/ee/hooks/use-trial.tsx";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useSpaceQuery } from "@/features/space/queries/space-query.ts";

interface ShareModalProps {
  readOnly: boolean;
}
export function SharePublishPanel({ readOnly }: ShareModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pageSlug } = useParams();
  const pageSlugId = extractPageSlugId(pageSlug);
  const { data: page } = usePageQuery({ pageId: pageSlugId });
  const pageId = page?.id;
  const { data: share } = useShareForPageQuery(pageId);
  const { spaceSlug } = useParams();
  const { isTrial } = useTrial();
  const [workspace] = useAtom(workspaceAtom);
  const { data: space } = useSpaceQuery(spaceSlug);
  const workspaceDisabled = workspace?.settings?.sharing?.disabled === true;
  const spaceDisabled = space?.settings?.sharing?.disabled === true;
  const sharingDisabled = workspaceDisabled || spaceDisabled;
  const createShareMutation = useCreateShareMutation();
  const updateShareMutation = useUpdateShareMutation();
  const deleteShareMutation = useDeleteShareMutation();
  // pageIsShared means that the share exists and its level equals zero.
  const pageIsShared = share && share.level === 0;
  // if level is greater than zero, then it is a descendant page from a shared page
  const isDescendantShared = share && share.level > 0;

  const publicLink = `${getAppUrl()}/share/${share?.key}/p/${pageSlug}`;

  const [isPagePublic, setIsPagePublic] = useState<boolean>(false);
  useEffect(() => {
    if (share) {
      setIsPagePublic(true);
    } else {
      setIsPagePublic(false);
    }
  }, [share, pageId]);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.checked;
    setIsPagePublic(value);

    try {
      if (value) {
        await createShareMutation.mutateAsync({
          pageId: pageId,
          includeSubPages: true,
          searchIndexing: false,
        });
      } else if (share && share.id) {
        await deleteShareMutation.mutateAsync(share.id);
      }
    } catch {
      setIsPagePublic(!value);
    }
  };

  const handleSubPagesChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.currentTarget.checked;
    try {
      await updateShareMutation.mutateAsync({
        shareId: share.id,
        includeSubPages: value,
      });
    } catch {
      // query invalidation will revert the UI
    }
  };

  const handleIndexSearchChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.currentTarget.checked;
    try {
      await updateShareMutation.mutateAsync({
        shareId: share.id,
        searchIndexing: value,
      });
    } catch {
      // query invalidation will revert the UI
    }
  };

  const shareLink = useMemo(
    () => (
      <Group my="sm" gap={4} wrap="nowrap">
        <TextInput
          variant="filled"
          value={publicLink}
          readOnly
          rightSection={<CopyTextButton text={publicLink} />}
          style={{ width: "100%" }}
        />
        <ActionIcon
          component="a"
          variant="default"
          target="_blank"
          href={publicLink}
          size="sm"
        >
          <IconExternalLink size={16} />
        </ActionIcon>
      </Group>
    ),
    [publicLink],
  );

  return (
    <>
        {isCloud() && isTrial ? (
          <>
            <Group justify="center" mb="sm">
              <IconLock size={20} stroke={1.5} />
            </Group>
            <Text size="sm" ta="center" fw={500} mb="xs">
              {t("Upgrade to share pages")}
            </Text>
            <Text size="sm" c="dimmed" ta="center" mb="sm">
              {t(
                "Page sharing is available on paid plans. Upgrade to share your pages publicly.",
              )}
            </Text>
            <Button
              size="xs"
              onClick={() => navigate("/settings/billing")}
              fullWidth
            >
              {t("Upgrade Plan")}
            </Button>
          </>
        ) : sharingDisabled ? (
          <>
            <Group justify="center" mb="sm">
              <IconLock size={20} stroke={1.5} />
            </Group>
            <Text size="sm" ta="center" fw={500} mb="xs">
              {t("Public sharing is disabled")}
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              {workspaceDisabled
                ? t("Public sharing has been disabled at the workspace level.")
                : t("Public sharing has been disabled for this space.")}
            </Text>
          </>
        ) : isDescendantShared ? (
          <>
            <Text size="sm">{t("Inherits public sharing from")}</Text>
            <Anchor
              size="sm"
              underline="never"
              style={{
                cursor: "pointer",
                color: "var(--mantine-color-text)",
              }}
              component={Link}
              to={buildPageUrl(
                spaceSlug,
                share.sharedPage.slugId,
                share.sharedPage.title,
              )}
            >
              <Group gap="4" wrap="nowrap" my="sm">
                {getPageIcon(share.sharedPage.icon)}
                <div className={classes.shareLinkText}>
                  <Text fz="sm" fw={500} lineClamp={1}>
                    {share.sharedPage.title || t("untitled")}
                  </Text>
                </div>
              </Group>
            </Anchor>

            {shareLink}
          </>
        ) : (
          <>
            <Group justify="space-between" wrap="nowrap" gap="xl">
              <div>
                <Text size="sm">
                  {isPagePublic ? t("Shared to web") : t("Share to web")}
                </Text>
                <Text size="xs" c="dimmed">
                  {isPagePublic
                    ? t("Anyone with the link can view this page")
                    : t("Make this page publicly accessible")}
                </Text>
              </div>
              <Switch
                onChange={handleChange}
                defaultChecked={isPagePublic}
                disabled={readOnly}
                size="xs"
              />
            </Group>

            {pageIsShared && (
              <>
                {shareLink}
                <Group justify="space-between" wrap="nowrap" gap="xl">
                  <div>
                    <Text size="sm">{t("Include sub-pages")}</Text>
                    <Text size="xs" c="dimmed">
                      {t("Make sub-pages public too")}
                    </Text>
                  </div>

                  <Switch
                    onChange={handleSubPagesChange}
                    checked={share.includeSubPages}
                    size="xs"
                    disabled={readOnly}
                  />
                </Group>
                <Group justify="space-between" wrap="nowrap" gap="xl" mt="sm">
                  <div>
                    <Text size="sm">{t("Search engine indexing")}</Text>
                    <Text size="xs" c="dimmed">
                      {t("Allow search engines to index page")}
                    </Text>
                  </div>
                  <Switch
                    onChange={handleIndexSearchChange}
                    checked={share.searchIndexing}
                    size="xs"
                    disabled={readOnly}
                  />
                </Group>
                <SharePasswordSettings
                  shareId={share.id}
                  hasPassword={!!share.hasPassword}
                  readOnly={readOnly}
                />
              </>
            )}
          </>
        )}
    </>
  );
}

export default function ShareModal({ readOnly }: ShareModalProps) {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
  const { data: page } = usePageQuery({ pageId: extractPageSlugId(pageSlug) });
  const { data: share } = useShareForPageQuery(page?.id);
  const [tab, setTab] = useState<string | null>("access");

  return (
    <Popover width={400} position="bottom" withArrow shadow="md">
      <Popover.Target>
        <Button
          size="compact-sm"
          leftSection={
            <Indicator color="green" offset={5} disabled={!share} withBorder>
              <IconWorld size={20} stroke={1.5} />
            </Indicator>
          }
          color="dark"
          variant="subtle"
        >
          {t("Share")}
        </Button>
      </Popover.Target>
      <Popover.Dropdown style={{ userSelect: "none" }}>
        <Tabs value={tab} onChange={setTab}>
          <Tabs.List mb="sm">
            <Tabs.Tab value="access">{t("Access")}</Tabs.Tab>
            <Tabs.Tab value="publish">{t("Publish")}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="access">
            {page && (
              <PageAccessPanel pageId={page.id} spaceId={page.spaceId} />
            )}
          </Tabs.Panel>
          <Tabs.Panel value="publish">
            <SharePublishPanel readOnly={readOnly} />
          </Tabs.Panel>
        </Tabs>
      </Popover.Dropdown>
    </Popover>
  );
}

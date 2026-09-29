import { Group, Switch, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useUpdateSpaceMutation } from "@/features/space/queries/space-query.ts";
import { ISpace } from "@/features/space/types/space.types.ts";

export default function SpaceViewerCommentsToggle({
  space,
}: {
  space: ISpace;
}) {
  const { t } = useTranslation();
  const updateSpaceMutation = useUpdateSpaceMutation();
  const enabled = space?.settings?.comments?.allowViewerComments === true;
  const label = t("Allow viewers to comment");

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{label}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Members with view-only access can add and reply to comments in this space.",
          )}
        </Text>
      </div>
      <Switch
        aria-label={label}
        checked={enabled}
        disabled={updateSpaceMutation.isPending}
        onChange={(event) =>
          updateSpaceMutation.mutate({
            spaceId: space.id,
            allowViewerComments: event.currentTarget.checked,
          })
        }
      />
    </Group>
  );
}

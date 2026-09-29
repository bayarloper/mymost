import { ActionIcon, Tooltip } from "@mantine/core";
import { IconCircleCheck, IconCircleCheckFilled } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

type ResolveCommentButtonProps = {
  isResolved: boolean;
  loading?: boolean;
  onToggle: () => void;
};

export default function ResolveCommentButton({
  isResolved,
  loading,
  onToggle,
}: ResolveCommentButtonProps) {
  const { t } = useTranslation();
  const label = isResolved ? t("Re-open comment") : t("Resolve comment");

  return (
    <Tooltip label={label} withArrow>
      <ActionIcon
        variant="default"
        style={{ border: "none" }}
        aria-label={label}
        loading={loading}
        onClick={onToggle}
      >
        {isResolved ? (
          <IconCircleCheckFilled size={20} stroke={2} />
        ) : (
          <IconCircleCheck size={20} stroke={2} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}

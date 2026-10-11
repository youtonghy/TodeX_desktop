import { cx } from "@/utils/cx";
import { RiCheckboxBlankCircleLine, RiCheckboxCircleLine, RiPieChart2Line } from "@remixicon/react";
import type { KanbanTaskStatus } from "@/session/kanbanTasks";

const STATUS_ICONS: Record<KanbanTaskStatus, typeof RiCheckboxBlankCircleLine> = {
  planned: RiCheckboxBlankCircleLine,
  "in-progress": RiPieChart2Line,
  done: RiCheckboxCircleLine,
};

/** Consistent status glyphs across the board columns, task creation and details. */
export function TaskStatusIcon({ status, className }: { status: KanbanTaskStatus; className?: string }) {
  const Icon = STATUS_ICONS[status] ?? RiCheckboxBlankCircleLine;
  return <Icon className={cx("size-[18px] shrink-0", className)} aria-hidden />;
}

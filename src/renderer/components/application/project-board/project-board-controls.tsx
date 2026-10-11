"use client";

import { useState } from "react";
import type { WorkspaceRecord } from "@todex/protocol/todex";
import { RiCheckLine, RiEqualizerLine, RiSideBarLine, RiSortDesc } from "@remixicon/react";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Dropdown, DropdownItem, DropdownPopover, DropdownTrigger } from "@/components/base/dropdown/dropdown";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { useT } from "@/i18n";
import { workspaceDisplayName } from "@/session/helpers";
import type { BoardSort } from "./project-board-data";

const TRIGGER = "relative flex size-9 shrink-0 items-center justify-center rounded-2lg border border-border-button-default bg-background-primary-default text-foreground-icon-primary shadow-xs transition-colors hover:border-border-button-hover hover:bg-background-primary-hover";
const MENU = "w-[220px] rounded-[14px] p-1";
const ROW = "rounded-2lg px-2 py-1.5 text-body-medium";
const DOT = "absolute -top-0.5 -end-0.5 size-2 rounded-full bg-accent-500 ring-2 ring-background-full";

/** Board toolbar: sort, workspace filter and display options. */
export function ProjectBoardControls({ sort, onSort, workspaceId, onWorkspace, workspaces, showDone, onShowDone, fillColumns, onFillColumns }: {
  sort: BoardSort;
  onSort: (sort: BoardSort) => void;
  /** "all" or a workspace id. */
  workspaceId: string;
  onWorkspace: (workspaceId: string) => void;
  workspaces: readonly WorkspaceRecord[];
  showDone: boolean;
  onShowDone: (show: boolean) => void;
  fillColumns: boolean;
  onFillColumns: (fill: boolean) => void;
}) {
  const t = useT();
  const [sortOpen, setSortOpen] = useState(false);
  const filtered = workspaceId !== "all";
  const sorts: { id: BoardSort; label: string }[] = [
    { id: "manual", label: t("kanban.sortManual") },
    { id: "priority", label: t("kanban.sortPriority") },
    { id: "title", label: t("kanban.sortTitle") },
    { id: "due", label: t("kanban.sortDue") },
  ];
  return (
    <div className="flex items-center gap-2" role="group">
      <Dropdown isOpen={sortOpen} onOpenChange={setSortOpen}>
        <TooltipTrigger delay={200}>
          <DropdownTrigger aria-label={t("kanban.sort")} className={TRIGGER}>
            <RiSortDesc className="size-5" aria-hidden />
            {sort !== "manual" && <span aria-hidden className={DOT} />}
          </DropdownTrigger>
          <Tooltip placement="bottom">{t("kanban.sort")}</Tooltip>
        </TooltipTrigger>
        <DropdownPopover aria-label={t("kanban.sort")} placement="bottom end" className={MENU}>
          {sorts.map((option) =>
            <DropdownItem key={option.id} selected={sort === option.id} className={ROW} onSelect={() => { onSort(option.id); setSortOpen(false); }}>
              <span className="flex-1">{option.label}</span>{sort === option.id && <RiCheckLine className="size-4" aria-hidden />}
            </DropdownItem>)}
        </DropdownPopover>
      </Dropdown>
      <Dropdown>
        <TooltipTrigger delay={200}>
          <DropdownTrigger aria-label={t("kanban.filter")} className={TRIGGER}>
            <RiEqualizerLine className="size-5" aria-hidden />
            {filtered && <span aria-hidden className={DOT} />}
          </DropdownTrigger>
          <Tooltip placement="bottom">{t("kanban.filter")}</Tooltip>
        </TooltipTrigger>
        <DropdownPopover aria-label={t("kanban.filter")} placement="bottom end" className={MENU} dialogClassName="max-h-[60vh] overflow-y-auto">
          <p className="px-2 pt-2 pb-1 text-body-2-medium text-text-tertiary">{t("kanban.workspace")}</p>
          {[{ id: "all", label: t("kanban.allWorkspaces") }, ...workspaces.map((workspace) => ({ id: workspace.id, label: workspaceDisplayName(workspace) }))].map((option) =>
            <DropdownItem key={option.id} selected={workspaceId === option.id} className={ROW} onSelect={() => onWorkspace(option.id)}>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>{workspaceId === option.id && <RiCheckLine className="size-4 shrink-0" aria-hidden />}
            </DropdownItem>)}
          {filtered && <DropdownItem className={ROW} onSelect={() => onWorkspace("all")}>{t("kanban.clearFilters")}</DropdownItem>}
        </DropdownPopover>
      </Dropdown>
      <Dropdown>
        <TooltipTrigger delay={200}>
          <DropdownTrigger aria-label={t("kanban.display")} className={TRIGGER}><RiSideBarLine className="size-5" aria-hidden /></DropdownTrigger>
          <Tooltip placement="bottom">{t("kanban.display")}</Tooltip>
        </TooltipTrigger>
        <DropdownPopover aria-label={t("kanban.display")} placement="bottom end" className={MENU}>
          <Checkbox isSelected={showDone} onChange={onShowDone} className={ROW}>{t("kanban.showDone")}</Checkbox>
          <Checkbox isSelected={fillColumns} onChange={onFillColumns} className={ROW}>{t("kanban.fillColumns")}</Checkbox>
        </DropdownPopover>
      </Dropdown>
    </div>
  );
}

"use client";

import { useDirection } from "@/components/foundations/direction/direction";
import { useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { Badge } from "@/components/base/badges/badge";
import { ChevronDownSmall } from "@/components/foundations/icons/chevrons";
import { cx } from "@/utils/cx";

/**
 * Figma source: Board UI → sidebar profile menu (node 3823:3699).
 *
 * Dropdown opened from the sidebar's team card. Floats to the right of the
 * sidebar: white panel, 1px border/button/default, radius 16, p 10,
 * shadow/dropdown. Header (team avatar + name/subtitle), grouped sections of
 * sidebar-style rows separated by full-bleed dividers, and a name + version
 * footer. Rows mirror the sidebar nav item pattern (icon + label + optional
 * counter) but use the menu tokens from Figma (text/primary label,
 * background/primary/hover on hover + the selected row).
 */

type IconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

export type DashboardTeamMenuRow = {
  id: string;
  icon: IconComponent;
  label: string;
  badge?: ReactNode;
  isSelected?: boolean;
  /** Runs after the menu closes itself. */
  onSelect?: () => void;
};

export type DashboardTeamMenuGroup = {
  id: string;
  label?: string;
  items: DashboardTeamMenuRow[];
};

/** Label/chevron slot on the trigger: blurs + fades away as the rail collapses. */
function Collapsible({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <span
      className={cx(
        "flex min-w-0 items-center overflow-hidden transition-[max-width,opacity,filter] duration-300 ease-in-out motion-reduce:transition-none",
        collapsed ? "max-w-0 opacity-0 blur-[3px]" : "max-w-40 opacity-100 blur-0",
      )}
    >
      {children}
    </span>
  );
}

function TeamMenuItem({ icon: Icon, label, badge, isSelected, onSelect }: DashboardTeamMenuRow & { onSelect: () => void }) {
  return (
    <AriaButton
      type="button"
      aria-current={isSelected ? "page" : undefined}
      onPress={onSelect}
      className={cx(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-2lg p-2 text-start outline-none transition-colors",
        isSelected
          ? "bg-background-primary-hover"
          : "hover:bg-background-primary-hover focus-visible:bg-background-primary-hover",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Icon className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />
        <span className="truncate text-body-medium text-text-primary">{label}</span>
      </span>
      {badge !== undefined && badge !== null && badge !== false ? (
        typeof badge === "string" || typeof badge === "number" ? (
          <Badge
            color="neutral"
            className="bg-team-menu-count-background text-team-menu-count-foreground"
          >
            {badge}
          </Badge>
        ) : (
          badge
        )
      ) : null}
    </AriaButton>
  );
}

const mobileSnapshot = () => window.matchMedia("(max-width: 639px)").matches;
const subscribeMobile = (listener: () => void) => {
  const query = window.matchMedia("(max-width: 639px)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

/** Avatar + title + subtitle, shared by the card and the panel header. */
function Identity({ avatar, title, subtitle }: { avatar: ReactNode; title: string; subtitle?: ReactNode }) {
  return (
    <>
      {avatar}
      <span className="flex min-w-0 flex-col items-start justify-center">
        <span className="max-w-full truncate text-body-medium whitespace-nowrap text-text-primary">{title}</span>
        {subtitle ? (
          <span className="max-w-full truncate text-body-regular whitespace-nowrap text-text-secondary">{subtitle}</span>
        ) : null}
      </span>
    </>
  );
}

export function DashboardTeamMenu({
  collapsed = false,
  className,
  avatar,
  title,
  subtitle,
  "aria-label": ariaLabel,
  menuLabel,
  groups,
  footer,
  onOpenChange,
}: {
  collapsed?: boolean;
  className?: string;
  /** 32px mark, e.g. an `Avatar size="md"`. */
  avatar: ReactNode;
  title: string;
  subtitle?: ReactNode;
  /** Trigger name; defaults to `title`. */
  "aria-label"?: string;
  /** Accessible name of the panel. */
  menuLabel: string;
  groups: DashboardTeamMenuGroup[];
  /** Footer line, e.g. the product name and its version chip. */
  footer?: { label: ReactNode; meta?: ReactNode };
  onOpenChange?: (isOpen: boolean) => void;
}) {
  const direction = useDirection();
  const [isOpen, setIsOpen] = useState(false);
  const changeOpen = (next: boolean) => {
    setIsOpen(next);
    onOpenChange?.(next);
  };
  // "right" placement assumes room to the sidebar's right (true in-flow on
  // desktop) — on mobile the sidebar can span the full viewport, so the
  // 265px panel would render off-screen. Below sm, drop into a plain
  // dropdown under the trigger instead.
  const isMobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, () => false);

  return (
    <AriaDialogTrigger isOpen={isOpen} onOpenChange={changeOpen}>
      <AriaButton
        aria-label={ariaLabel ?? title}
        className={cx(
          "flex cursor-pointer items-center overflow-hidden outline-none",
          "border-2 border-transparent hover:border-border-button-hover",
          "transition-[width,background-color,border-color,padding] duration-300 ease-in-out motion-reduce:transition-none",
          "focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2",
          collapsed
            ? "size-9 justify-start rounded-full bg-transparent p-0"
            : "w-full justify-between rounded-xl bg-background-tertiary-default py-2 pe-4 ps-2.5",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {avatar}
          <Collapsible collapsed={collapsed}>
            <span className="flex min-w-0 flex-col items-start justify-center">
              <span className="max-w-full truncate text-body-medium whitespace-nowrap text-text-primary">{title}</span>
              {subtitle ? (
                <span className="max-w-full truncate text-body-regular whitespace-nowrap text-text-secondary">{subtitle}</span>
              ) : null}
            </span>
          </Collapsible>
        </span>
        <Collapsible collapsed={collapsed}>
          <span className="flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-background-tertiary-hover">
            <ChevronDownSmall
              className={cx("size-4 text-text-secondary transition-transform duration-200 ease", isOpen && "rotate-180")}
            />
          </span>
        </Collapsible>
      </AriaButton>

      <AriaPopover
        placement={isMobile ? "bottom start" : direction === "rtl" ? "left bottom" : "right bottom"}
        offset={8}
        className={cx(
          "w-[265px] max-w-[calc(100vw-32px)] origin-bottom-left overflow-y-auto",
          "rounded-2xl border border-border-button-default bg-background-primary-default p-2.5 shadow-dropdown",
          "transition duration-150 ease-out",
          "data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]",
          "data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]",
        )}
      >
        <AriaDialog aria-label={menuLabel} className="flex flex-col gap-[7px] outline-none">
          {/* Header */}
          <div className="flex w-full items-center gap-2 px-2 pt-1">
            <Identity avatar={avatar} title={title} subtitle={subtitle} />
          </div>

          {/* Grouped sidebar-style rows */}
          <div className="flex w-full flex-col">
            {groups.map((group, index) => (
              <Group
                key={group.id}
                group={group}
                showDivider={index > 0}
                onSelect={(row) => {
                  changeOpen(false);
                  row.onSelect?.();
                }}
              />
            ))}
          </div>

          {/* Footer */}
          {footer ? (
            <div className="flex w-full items-center justify-between px-2 pt-1 pb-2">
              <span className="text-body-2-medium whitespace-nowrap text-text-tertiary">{footer.label}</span>
              {footer.meta ? (
                <span className="inline-flex items-center justify-center rounded-sm bg-background-tertiary-default px-1 py-px text-body-2-medium whitespace-nowrap text-text-tertiary">
                  {footer.meta}
                </span>
              ) : null}
            </div>
          ) : null}
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}

function Group({
  group,
  showDivider,
  onSelect,
}: {
  group: DashboardTeamMenuGroup;
  showDivider: boolean;
  onSelect: (row: DashboardTeamMenuRow) => void;
}) {
  return (
    <>
      {showDivider && <div className="-mx-2.5 my-2.5 h-px bg-border-button-default" />}
      <div className={cx("flex w-full flex-col gap-1", group.label && "gap-1.5 pt-1")}>
        {group.label && (
          <span className="px-2 text-body-medium text-text-secondary">{group.label}</span>
        )}
        <div className="flex w-full flex-col gap-1">
          {group.items.map((item) => (
            <TeamMenuItem key={item.id} {...item} onSelect={() => onSelect(item)} />
          ))}
        </div>
      </div>
    </>
  );
}

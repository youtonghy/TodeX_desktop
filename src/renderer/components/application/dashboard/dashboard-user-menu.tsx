"use client";

import { useDirection } from "@/components/foundations/direction/direction";
import { useEffect, useState, type ReactNode } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { ChevronUpDownSmall } from "@/components/foundations/icons/chevrons";
import { cx } from "@/utils/cx";

/**
 * Figma source: Board UI → sidebar account menu (node 3828:3895).
 *
 * Dropdown opened from the sidebar's workspace switcher (avatar + name +
 * chevron) at the top. Floats to the right of the sidebar with the same panel
 * surface and appear animation as the team menu: white, 1px border, radius 16,
 * p 10, shadow/dropdown. The panel's contents come from the caller, built from
 * the pieces below: a labelled list of 20px-avatar rows, a full-bleed divider,
 * then a row of actions.
 */

/** Label slot on the trigger: blurs + fades away as the rail collapses. */
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

/** A labelled list ("Users with access"). */
export function DashboardUserMenuSection({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1.5 pt-[5px]">
      {label ? <span className="px-2 text-body-medium text-text-secondary">{label}</span> : null}
      <div className="flex w-full flex-col gap-1">{children}</div>
    </div>
  );
}

/** One list row: a 20px avatar and a name. Rows without `onSelect` are static. */
export function DashboardUserMenuRow({
  avatar,
  label,
  description,
  trailing,
  isSelected = false,
  onSelect,
  title,
}: {
  avatar?: ReactNode;
  label: ReactNode;
  /** Second line under the name. */
  description?: ReactNode;
  trailing?: ReactNode;
  isSelected?: boolean;
  onSelect?: () => void;
  /** Native tooltip, e.g. the full value behind a truncated name. */
  title?: string;
}) {
  const className = cx(
    "flex w-full items-center gap-2 rounded-2lg px-2 py-1.5 text-start outline-none transition-colors",
    isSelected && "bg-background-primary-hover",
  );
  const content = (
    <>
      {avatar}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-medium text-text-primary">{label}</span>
        {description ? <span className="truncate text-body-2-regular text-text-secondary">{description}</span> : null}
      </span>
      {trailing}
    </>
  );
  if (!onSelect) {
    return (
      <div className={className} title={title} aria-current={isSelected ? "true" : undefined}>
        {content}
      </div>
    );
  }
  return (
    <AriaButton
      type="button"
      aria-current={isSelected ? "page" : undefined}
      onPress={onSelect}
      className={cx(
        className,
        "cursor-pointer",
        !isSelected && "hover:bg-background-primary-hover focus-visible:bg-background-primary-hover",
      )}
    >
      {content}
    </AriaButton>
  );
}

/** Divider centered in the 28px gap between the list and the actions. */
export function DashboardUserMenuDivider() {
  return <div className="-mx-2.5 my-3.5 h-px bg-border-button-default" />;
}

/** Actions — pb-2 makes the space below the buttons match their left/right
 *  inset (panel p-2.5 + row px-2 = 18px on every side). */
export function DashboardUserMenuActions({ children }: { children: ReactNode }) {
  return <div className="flex w-full items-center gap-3 px-2 pb-2">{children}</div>;
}

export function DashboardUserMenu({
  collapsed = false,
  suppressHover = false,
  onHoverSuppressionEnd,
  avatar,
  name,
  badge,
  "aria-label": ariaLabel,
  menuLabel,
  onOpenChange,
  panelClassName,
  children,
}: {
  collapsed?: boolean;
  /** Prevents expansion from creating a hover state under a stationary pointer. */
  suppressHover?: boolean;
  /** Re-arms hover after the pointer fully leaves the trigger. */
  onHoverSuppressionEnd?: () => void;
  /** 32px mark, e.g. an `Avatar size="md"`. */
  avatar: ReactNode;
  name: string;
  /** Beside the name, e.g. a version chip. */
  badge?: ReactNode;
  /** Trigger name; defaults to `name`. */
  "aria-label"?: string;
  /** Accessible name of the panel. */
  menuLabel: string;
  onOpenChange?: (isOpen: boolean) => void;
  /** Overrides the panel's width / padding (e.g. a wider notification center). */
  panelClassName?: string;
  /** Panel contents; the function form receives a `close` callback. */
  children: ReactNode | ((close: () => void) => ReactNode);
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
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <AriaDialogTrigger isOpen={isOpen} onOpenChange={changeOpen}>
      <AriaButton
        aria-label={ariaLabel ?? name}
        onPointerLeave={() => {
          if (suppressHover) onHoverSuppressionEnd?.();
        }}
        className={cx(
          "relative flex min-w-0 cursor-pointer items-center gap-2 rounded-full outline-none",
          "focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2",
          // Hover pill (Figma node 3829:4063): a fully-rounded 2px border/button/hover
          // outline drawn via a pseudo-element so it never shifts the layout.
          "before:pointer-events-none before:absolute before:-inset-x-1.5 before:-inset-y-[5px] before:rounded-full before:border-2 before:border-transparent before:transition-colors before:duration-150",
          !suppressHover && "hover:before:border-border-sidebar-profile-hover",
          // Collapsed, the trigger takes the rail's own 36px column and centres
          // the 32px avatar in it, instead of sizing to the avatar plus a gap
          // held open for a label that's shrunk to nothing. That gap made the
          // button 42px wide in a 36px rail, which pushed its hover pill
          // off-centre and into the rail's clip.
          //
          // The pill's insets go square too: 36×32 plus the expanded 6/5 reach
          // is a 48×42 stadium, not the circle the avatar wants. 3/5 lands it
          // on 42×42.
          collapsed && "w-9 justify-center gap-0 before:-inset-x-[3px]",
        )}
      >
        {avatar}
        <Collapsible collapsed={collapsed}>
          <span className="flex items-center gap-0.5">
            <span className="text-body-medium whitespace-nowrap text-text-primary">{name}</span>
            {badge ? <span className="ms-1 me-0.5 flex shrink-0 items-center">{badge}</span> : null}
            <ChevronUpDownSmall className="size-4 shrink-0 text-foreground-icon-tertiary" />
          </span>
        </Collapsible>
      </AriaButton>

      <AriaPopover
        placement={isMobile ? "bottom start" : direction === "rtl" ? "left top" : "right top"}
        offset={8}
        className={cx(
          "w-[265px] max-w-[calc(100vw-32px)] origin-top-left overflow-y-auto",
          "rounded-2xl border border-border-button-default bg-background-primary-default p-2.5 shadow-dropdown",
          "transition duration-150 ease-out",
          "data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]",
          "data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]",
          panelClassName,
        )}
      >
        <AriaDialog aria-label={menuLabel} className="flex flex-col outline-none">
          {typeof children === "function" ? children(() => changeOpen(false)) : children}
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}

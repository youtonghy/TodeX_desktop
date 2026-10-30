"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { RiCloseLine, RiSearchLine, RiSideBarFill } from "@remixicon/react";
import { Focusable } from "react-aria-components";
import { Badge } from "@/components/base/badges/badge";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Kbd } from "@/components/base/kbd/kbd";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cx } from "@/utils/cx";

/**
 * Figma sources:
 *   expanded  → Board UI → dashboard 1 → Sidebar (node 3731:2934)
 *   collapsed → Board UI → Sidebar (node 3768:3382)
 *
 * Floating sidebar panel. Expanded: 260px wide, p 12, radius/3xl (24px),
 * white 1px border, "Background/Sidebar Elevation" shadow, bg
 * background/secondary. Collapsed: 60px wide (36px icon items + 12px
 * padding); collapse button sits centered above the workspace avatar, quick
 * search becomes a 36px neutral-200 square, nav items become icon-only
 * squares, the team card reduces to its avatar.
 *
 * The two states morph into each other: the panel width animates while
 * labels / badges / kbd collapse via max-width + opacity.
 *
 * The shell carries no content of its own: the identity (`header`), the
 * primary and secondary rows, the quick search, the scrolling content under
 * the nav (`children`) and the team card (`footer`) come from the caller.
 */

type IconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/**
 * Collapsible text/badge slot: blurs + fades + shrinks away when the rail
 * closes, and blurs back in on expand. The icons/rows themselves stay pinned in
 * place — only these label/badge slots animate — so nothing jumps to center.
 */
export function Collapsible({ collapsed, children, className }: { collapsed: boolean; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "flex min-w-0 items-center overflow-hidden transition-[max-width,opacity,filter] duration-300 ease-in-out motion-reduce:transition-none",
        // Expanded, the cap is the row itself: a fixed cap (it was 160px)
        // clipped any label wider than it, "Components and Blocks" included.
        collapsed ? "max-w-0 opacity-0 blur-[3px]" : "max-w-full opacity-100 blur-0",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A primary or secondary navigation row. */
export interface DashboardNavItem {
  key: string;
  label: string;
  icon: IconComponent;
  /** Link rows navigate; rows without one are buttons that run `onClick`. */
  href?: string;
  /** Runs on press. On a link row it intercepts the navigation. */
  onClick?: () => void;
  /** The filled accent pill. Defaults to `key === selected`. */
  isSelected?: boolean;
  /** Toggle rows report the selected state with `aria-pressed` instead of `aria-current`. */
  toggle?: boolean;
  /** Disclosure rows report whether the rows they reveal are open (`aria-expanded`). */
  expanded?: boolean;
  disabled?: boolean;
  /** Why a disabled row is unavailable: the row stays focusable and hoverable
   *  (`aria-disabled`) and explains itself in a tooltip. */
  disabledReason?: string;
  /** Trailing counter: strings and numbers render as a `Badge`, nodes as they are. */
  badge?: ReactNode;
  /** Trailing hint after the badge, e.g. a shortcut keycap. */
  hint?: ReactNode;
}

/** Kept as a name for callers that typed their `selected` prop; any key works. */
export type DashboardNavKey = string;

function NavItem({
  item,
  isSelected,
  collapsed,
}: {
  item: DashboardNavItem;
  isSelected: boolean;
  collapsed: boolean;
}) {
  const { icon: Icon, label, href, onClick, toggle, expanded, disabled = false, disabledReason, badge, hint } = item;
  // A disabled row with a reason stays reachable so its tooltip can explain.
  const explained = disabled && Boolean(disabledReason);
  const className = cx(
    "flex items-center justify-between overflow-hidden rounded-2lg p-2 text-start",
    "outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
    "transition-[width,background-color] duration-300 ease-in-out motion-reduce:transition-none",
    collapsed ? "w-9" : "w-full",
    isSelected
      ? "bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected"
      : !disabled && "hover:bg-background-secondary-hover",
    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
  );
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          className={cx("size-5 shrink-0", isSelected ? "text-text-white" : "text-foreground-icon-secondary")}
          aria-hidden
        />
        <Collapsible collapsed={collapsed}>
          <span
            className={cx(
              "truncate text-body-medium whitespace-nowrap",
              isSelected ? "text-text-white" : "text-text-secondary",
            )}
          >
            {label}
          </span>
        </Collapsible>
      </span>
      {badge !== undefined && badge !== null && badge !== false ? (
        <Collapsible collapsed={collapsed} className="shrink-0">
          {typeof badge === "string" || typeof badge === "number" ? (
            <Badge color={isSelected ? "primary" : "neutral"}>{badge}</Badge>
          ) : (
            badge
          )}
        </Collapsible>
      ) : null}
      {hint ? (
        <Collapsible collapsed={collapsed} className="shrink-0">
          {hint}
        </Collapsible>
      ) : null}
    </>
  );
  const row = href && !disabled ? (
    <a
      href={href}
      onClick={
        onClick
          ? (event) => {
              event.preventDefault();
              onClick();
            }
          : undefined
      }
      aria-current={isSelected ? "page" : undefined}
      aria-label={label}
      className={className}
    >
      {content}
    </a>
  ) : (
    <button
      type="button"
      disabled={disabled && !explained}
      aria-disabled={explained || undefined}
      onClick={explained ? undefined : onClick}
      aria-current={!toggle && isSelected ? "page" : undefined}
      aria-pressed={toggle ? isSelected : undefined}
      aria-expanded={expanded}
      aria-label={label}
      className={className}
    >
      {content}
    </button>
  );
  // The rail shows icons only, so its rows name themselves in a tooltip.
  return (
    <TooltipTrigger delay={200} isDisabled={explained ? false : !collapsed || disabled}>
      <Focusable isDisabled={disabled && !explained}>{row}</Focusable>
      <Tooltip placement="right">{explained ? (collapsed ? `${label} · ${disabledReason}` : disabledReason) : label}</Tooltip>
    </TooltipTrigger>
  );
}

/** Quick search: the pill that turns into a field. The caller owns the query
 *  and decides what it filters. */
export interface DashboardSidebarSearch {
  value: string;
  onChange: (value: string) => void;
  /** Pill text and the pill's accessible name ("Quick Search"). */
  label: string;
  placeholder?: string;
  /** Accessible name of the field. */
  "aria-label": string;
  /** Accessible name of the clear button. */
  clearLabel: string;
  /** Keycap inside the pill, e.g. "⌘L". The caller binds the shortcut. */
  shortcut?: ReactNode;
  /** Shows the field instead of the pill. Uncontrolled when omitted. */
  active?: boolean;
  onActiveChange?: (active: boolean) => void;
}

/** What the render-prop slots see. */
export interface DashboardSidebarState {
  collapsed: boolean;
  mobile: boolean;
  flat: boolean;
}

export interface DashboardSidebarHeaderState extends DashboardSidebarState {
  /** For `DashboardUserMenu`: no hover outline under a pointer that just expanded the rail. */
  suppressHover: boolean;
  onHoverSuppressionEnd: () => void;
}

export interface DashboardSidebarProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "className"> {
  ref?: Ref<HTMLElement>;
  /** Rendered inside the mobile drawer: always expanded, close button instead of collapse. */
  mobile?: boolean;
  onClose?: () => void;
  /** Accessible name of the mobile close button. */
  closeLabel?: string;
  /** Controlled rail state; uncontrolled (from `defaultCollapsed`) when omitted. */
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Names of the collapse button. `expanded` is the state the button reports
   *  and toggles when it differs from the drawn one (a rail peeking open). */
  collapseButton?: { expandLabel: string; collapseLabel: string; expanded?: boolean } | false;
  /** Expanded width fills its container below `lg` instead of the fixed
   *  260px (e.g. the landing page, where the sidebar isn't in a drawer).
   *  Collapsed width stays the fixed 60px rail at every breakpoint — the
   *  whole point of collapsing is to shrink, so it must never get
   *  overridden back to full width. */
  fluid?: boolean;
  /** Removes the floating panel treatment for a sidebar revealed beneath mobile content. */
  flat?: boolean;
  className?: string;
  /** Above everything, outside the scroller (e.g. a window drag strip). */
  chrome?: ReactNode;
  /** Top-left identity, usually a `DashboardUserMenu`. */
  header?: (state: DashboardSidebarHeaderState) => ReactNode;
  /** Primary navigation rows. */
  items?: DashboardNavItem[];
  /** Which row shows the selected (filled accent) state, for rows without `isSelected`. */
  selected?: DashboardNavKey;
  search?: DashboardSidebarSearch;
  /** Scrolling content under the primary nav. */
  children?: (state: DashboardSidebarState) => ReactNode;
  /** Rows pinned above the footer. */
  secondaryItems?: DashboardNavItem[];
  /** Card at the end of the scrolling content (e.g. an Announcement); hidden on the rail. */
  announcement?: ReactNode;
  /** The team card, usually a `DashboardTeamMenu`. */
  footer?: (state: DashboardSidebarState) => ReactNode;
}

export function DashboardSidebar({
  mobile = false,
  onClose,
  closeLabel = "Close sidebar",
  collapsed: collapsedProp,
  defaultCollapsed = false,
  onCollapsedChange,
  collapseButton,
  fluid = false,
  flat = false,
  className,
  chrome,
  header,
  items = [],
  selected,
  search,
  children,
  secondaryItems = [],
  announcement,
  footer,
  ...asideProps
}: DashboardSidebarProps = {}) {
  const [collapsedState, setCollapsedState] = useState(defaultCollapsed);
  const setCollapsed = (next: boolean) => {
    if (collapsedProp === undefined) setCollapsedState(next);
    onCollapsedChange?.(next);
  };
  const [suppressUserHover, setSuppressUserHover] = useState(false);
  const [searchActiveState, setSearchActiveState] = useState(false);
  const searchActive = search?.active ?? searchActiveState;
  // Read through a ref so the document listener below stays put while typing.
  const searchRef = useRef(search);
  searchRef.current = search;
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchFieldRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const collapsed = mobile ? false : (collapsedProp ?? collapsedState);
  const expanded = (collapseButton && collapseButton.expanded) ?? !collapsed;
  const state: DashboardSidebarState = { collapsed, mobile, flat };

  const setSearchActive = useCallback((next: boolean) => {
    if (searchRef.current?.active === undefined) setSearchActiveState(next);
    searchRef.current?.onActiveChange?.(next);
  }, []);

  const activateSearch = () => {
    if (!mobile && collapsed) setCollapsed(false);
    setSearchActive(true);
  };

  const deactivateSearch = useCallback((restoreFocus: boolean) => {
    searchRef.current?.onChange("");
    setSearchActive(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => searchTriggerRef.current?.focus());
    }
  }, [setSearchActive]);

  useEffect(() => {
    if (!searchActive) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchActive]);

  useEffect(() => {
    if (!searchActive) return;

    // An empty field closes on any outside press; a query stays applied (it
    // filters the content below) until it is cleared or Escape is pressed.
    // `pointerdown`, not `click`: React flushes this effect while the click
    // that opened the field is still bubbling, and the trigger it landed on
    // has already been swapped for the field, so that click counted as
    // outside and shut the field again at once.
    const onOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && searchFieldRef.current?.contains(target)) return;
      if (searchRef.current?.value.trim()) return;
      deactivateSearch(false);
    };

    document.addEventListener("pointerdown", onOutsidePress);
    return () => document.removeEventListener("pointerdown", onOutsidePress);
  }, [deactivateSearch, searchActive]);

  const fieldProps = search
    ? {
        ref: searchInputRef,
        type: "search" as const,
        "aria-label": search["aria-label"],
        value: search.value,
        placeholder: search.placeholder,
        onChange: (event: ChangeEvent<HTMLInputElement>) => search.onChange(event.target.value),
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            deactivateSearch(true);
          }
        },
      }
    : null;

  const renderRows = (rows: DashboardNavItem[]) =>
    rows.map((item) => (
      <NavItem
        key={item.key}
        item={item}
        isSelected={item.isSelected ?? selected === item.key}
        collapsed={collapsed}
      />
    ));

  return (
    <aside
      {...asideProps}
      className={cx(
        "flex h-full shrink-0 flex-col justify-between overflow-hidden",
        flat
          ? "bg-background-full"
          : "rounded-3xl border border-border-button-white bg-background-secondary-default shadow-sidebar",
        "transition-[width] duration-300 ease-in-out motion-reduce:transition-none",
        // Collapsed rail keeps the 60px spec: 1px border + 11px padding on each
        // side leaves an exactly 36px column so the w-9 (36px) icon items center.
        collapsed
          ? "w-[60px] px-[11px] py-3"
          : fluid
            ? "w-full p-3 lg:w-[260px]"
            : "w-[260px] p-3",
        className,
      )}
    >
      {chrome}
      {/* `overflow-y: auto` forces the x axis to clip too, and this box hugs
          its contents on every side — so the selected item's 1px ring, the
          profile's hover pill (which outsets 6px) and focus rings all landed
          outside it. Padding moves the clip edge out; the matching negative
          margin borrows that space back from the rail's own padding, leaving
          every child exactly where it was. Scrolled content softens under the
          progressive blur edges of the ScrollArea. */}
      <ScrollArea
        surface={flat ? "full" : "secondary"}
        fadeBottom
        className="-m-2 w-[calc(100%+16px)] flex-1"
        contentClassName="flex flex-col gap-3 overflow-x-hidden p-2 [scrollbar-width:none]"
      >
        {/* Workspace switcher / collapse control */}
        <div
          className={cx(
            "flex w-full shrink-0 transition-[gap] duration-300 ease-in-out",
            collapsed
              ? "flex-col-reverse items-start justify-center gap-2.5"
              : "flex-row items-center justify-between",
          )}
        >
          {/* The clip is here to hide the label as `max-width` animates shut,
              but it also cropped the trigger's hover pill down to four corner
              arcs. Same trick as the scroller: pad the clip box out by the
              pill's 8px reach and pull it back with a negative margin, so the
              widths below are 16px larger than the footprint they produce. */}
          <div
            className={cx(
              "-m-2 min-w-0 overflow-hidden p-2 transition-[max-width,opacity,transform] duration-300 ease-in-out",
              mobile && flat && searchActive
                ? "max-w-0 scale-95 opacity-0"
                : "max-w-[206px] scale-100 opacity-100",
            )}
          >
            {header?.({
              ...state,
              suppressHover: suppressUserHover,
              onHoverSuppressionEnd: () => setSuppressUserHover(false),
            })}
          </div>
          {mobile && flat ? (
            search && fieldProps ? (
              <div
                ref={searchFieldRef}
                className={cx(
                  "flex h-9 items-center overflow-hidden rounded-full bg-background-tertiary-default transition-[width,box-shadow] duration-300 ease-in-out",
                  searchActive
                    ? "w-full gap-2 pe-2.5 ps-2 ring-2 ring-inset ring-border-button-active"
                    : "w-9 gap-0 px-2",
                )}
              >
                <button
                  ref={searchTriggerRef}
                  type="button"
                  aria-label={search.label}
                  onClick={activateSearch}
                  className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground-icon-secondary outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                >
                  <RiSearchLine className="size-5" aria-hidden />
                </button>
                <input
                  {...fieldProps}
                  tabIndex={searchActive ? 0 : -1}
                  className={cx(
                    "min-w-0 bg-transparent text-body-medium tracking-[-0.015em] text-text-primary outline-none placeholder:text-text-tertiary [&::-webkit-search-cancel-button]:hidden",
                    "transition-[width,opacity] duration-200 ease-in-out",
                    searchActive
                      ? "w-full flex-1 opacity-100 delay-100"
                      : "pointer-events-none w-0 flex-none opacity-0 delay-0",
                  )}
                />
                <CloseButton
                  size="2xs"
                  aria-label={search.clearLabel}
                  tabIndex={searchActive ? 0 : -1}
                  onClick={() => deactivateSearch(true)}
                  className={cx(
                    "shrink-0 bg-background-tertiary-hover transition-opacity duration-150",
                    searchActive ? "opacity-100 delay-150" : "pointer-events-none opacity-0 delay-0",
                  )}
                />
              </div>
            ) : null
          ) : mobile ? (
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              className="cursor-pointer rounded-md text-foreground-icon-secondary outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
            >
              <RiCloseLine className="size-5" aria-hidden />
            </button>
          ) : collapseButton === false ? null : (
            <button
              type="button"
              aria-label={
                expanded
                  ? (collapseButton?.collapseLabel ?? "Collapse sidebar")
                  : (collapseButton?.expandLabel ?? "Expand sidebar")
              }
              aria-expanded={expanded}
              onClick={() => {
                const isExpanding = !expanded;
                if (!isExpanding) deactivateSearch(false);
                setCollapsed(!isExpanding);
                setSuppressUserHover(isExpanding);
              }}
              className={cx(
                "cursor-pointer rounded-md text-foreground-icon-secondary outline-none transition-transform duration-300 ease-in-out focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                collapsed && "flex w-9 items-center justify-center",
              )}
            >
              <RiSideBarFill
                className={cx(
                  "size-5 transition-transform duration-300 ease-in-out",
                  expanded ? "-scale-x-100 rtl:scale-x-100" : "rtl:-scale-x-100",
                )}
                aria-hidden
              />
            </button>
          )}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-3">
          {/* Quick search */}
          {!flat && search && fieldProps ? (
            searchActive && !collapsed ? (
              <div
                ref={searchFieldRef}
                className="flex w-full items-center gap-2 rounded-full bg-background-tertiary-default py-2 pe-2.5 ps-2 ring-2 ring-inset ring-border-button-active transition-[background-color,box-shadow] duration-[var(--input-transition-ms)] ease"
              >
                <RiSearchLine className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />
                <input
                  {...fieldProps}
                  className="min-w-0 flex-1 bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-tertiary [&::-webkit-search-cancel-button]:hidden"
                />
                <CloseButton
                  size="2xs"
                  aria-label={search.clearLabel}
                  onClick={() => deactivateSearch(true)}
                  className="bg-background-tertiary-hover"
                />
              </div>
            ) : (
              <TooltipTrigger delay={200} isDisabled={!collapsed}>
                <Focusable>
                  <button
                    ref={searchTriggerRef}
                    type="button"
                    aria-label={search.label}
                    onClick={activateSearch}
                    className={cx(
                      "flex cursor-pointer items-center gap-2 p-2 hover:bg-background-tertiary-hover/55",
                      "outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                      "transition-[width,border-radius,background-color] duration-300 ease-in-out motion-reduce:transition-none",
                      collapsed
                        ? "w-9 rounded-full bg-background-tertiary-default"
                        : "w-full rounded-full bg-background-tertiary-default",
                    )}
                  >
                    <span className={cx("flex min-w-0 items-center gap-2", !collapsed && "flex-1")}>
                      <RiSearchLine className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />
                      <Collapsible collapsed={collapsed}>
                        <span className="text-body-medium whitespace-nowrap text-text-secondary">
                          {search.label}
                        </span>
                      </Collapsible>
                    </span>
                    {search.shortcut ? (
                      <Collapsible collapsed={collapsed} className="shrink-0">
                        <Kbd>{search.shortcut}</Kbd>
                      </Collapsible>
                    ) : null}
                  </button>
                </Focusable>
                <Tooltip placement="right">{search.label}</Tooltip>
              </TooltipTrigger>
            )
          ) : null}

          {/* Primary nav. The 2px inset is for the expanded rail only: the
              collapsed column is exactly as wide as a 36px item, so padding
              here pushes every item 2px right and the rail's own clip shaves
              that much off its selected fill and hover state. */}
          {items.length > 0 ? (
            <nav className={cx("flex w-full flex-col gap-1", !collapsed && "px-0.5")}>
              {renderRows(items)}
            </nav>
          ) : null}
        </div>

        {children?.(state)}
        {/* Scrolls with the lists so it never squeezes them below the fold. */}
        {announcement && !collapsed ? announcement : null}
      </ScrollArea>

      <div className="flex w-full shrink-0 flex-col gap-3 pt-3">
        {/* Secondary nav */}
        {secondaryItems.length > 0 ? (
          <nav className="flex w-full flex-col gap-1">
            {renderRows(secondaryItems)}
          </nav>
        ) : null}

        {/* Team card → opens the profile menu next to the sidebar */}
        {footer?.(state)}
      </div>
    </aside>
  );
}

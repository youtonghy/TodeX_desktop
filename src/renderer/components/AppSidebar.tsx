import { RiPushpin2Fill, RiLockLine, RiAddLine, RiArrowRightSLine, RiCheckLine, RiFolderReduceLine, RiFoldersLine, RiFolderTransferLine, RiPencilLine, RiEdit2Line, RiErrorWarningLine, RiFolder3Line, RiGitBranchLine, RiDeleteBinLine, RiArrowDownSLine, RiBarChartBoxLine, RiInformationLine, RiKanbanView2, RiPaletteLine, RiPriceTag3Line, RiPuzzle2Line, RiSettings3Line, RiTerminalBoxLine, RiTerminalLine, RiTimeLine, RiUserSettingsLine, RiVipCrownLine } from '@remixicon/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactNode } from 'react';
import {
  Dialog,
  Focusable,
  GridList,
  GridListItem,
  Pressable,
  Radio,
  RadioGroup,
  SubmenuTrigger,
  parseColor,
  type GridListItemRenderProps,
} from 'react-aria-components';
import { DashboardSidebar, type DashboardNavItem } from '@/components/application/dashboard/dashboard-sidebar';
import { DashboardTeamMenu, type DashboardTeamMenuGroup } from '@/components/application/dashboard/dashboard-team-menu';
import {
  DashboardUserMenu,
  DashboardUserMenuActions,
  DashboardUserMenuDivider,
  DashboardUserMenuRow,
  DashboardUserMenuSection,
} from '@/components/application/dashboard/dashboard-user-menu';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { IconAction } from '@/components/ui/icon-action';
import { Menu, MenuItem, MenuPopover, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { cx } from '@/utils/cx';
import { useSidebarPins } from '../session/useSidebarPins';
import { useSidebarGroupCollapse } from '../session/useSidebarGroupCollapse';
import { useKanbanTasks } from '../session/kanbanTasks';
import { BACKEND_LABEL_COLORS, backendLabelColor } from '../session/backendColors';
import type { BackendConnectionProfile } from '../session/backendColors';
import { groupWorkspaceEntries, moveWorkspaceEntry, moveWorkspaceToGroup, newWorkspaceGroupId, removeWorkspaceFromGroup, renameWorkspaceGroup, ungroupWorkspaceGroup, workspaceLayoutPatches } from '@todex/protocol/todex';
import type { WorkspaceDragSource, WorkspaceDropTarget, WorkspaceRecord, WorkspaceSidebarEntry } from '@todex/protocol/todex';
import { ProviderIcon } from './ProviderIcon';
import { WorkspaceGroupRenameDialog } from './WorkspaceGroupRenameDialog';
import { AppIcon } from './AppIcon';
import { WORKSPACE_ICON_CHOICES, WORKSPACE_RING_STYLES, WorkspaceStatusRing, ringStyleKey, workspaceIconComponent } from './WorkspaceIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import { connectionStateLabel, conversationDisplayTitle, formatResetInstant, getConversationStatus, healthLabelOf, isConversationHighlighted, workspaceDisplayName } from '../session/helpers';
import { ShortcutHint, shortcutKeys, useAppShortcuts, type ShortcutId } from '../lib/shortcuts';
import { useT } from '../i18n';

type Props = {
  session: TodeXSession;
  /** Desktop: the full 260px panel (true) or the collapsed icon rail (false). */
  open: boolean;
  /** Pins the desktop sidebar open or collapses it to the rail (its collapse button). */
  onOpenChange?: (open: boolean) => void;
  /** Rendered in the compact-layout drawer: always expanded, flat on the page ground. */
  mobile?: boolean;
  /** Closes the compact-layout drawer. */
  onCloseMobile?: () => void;
  className?: string;
  onCreateWorkspace: () => void;
  onEditWorkspace: (workspaceId: string) => void;
  onCreateConversation: () => void;
  onOpenSettings: () => void;
  onOpenCapabilities: () => void;
  onOpenCliManager: () => void;
  onOpenAgentProviders: () => void;
  onOpenUsage: () => void;
  onOpenQuota: () => void;
  onOpenAbout: () => void;
  onOpenKanban: () => void;
  /** Toggles the SSH view (hosts, keys, SSH terminals, remote files). */
  onOpenTerminal: () => void;
  terminalActive?: boolean;
  /** Called after the user picks a conversation, e.g. to leave the SSH view. */
  onSelectConversation?: () => void;
};

type ContextMenu = { kind: 'workspace' | 'conversation' | 'group'; id: string; x: number; y: number } | null;

type WorkspaceGroupEntry = Extract<WorkspaceSidebarEntry, { kind: 'group' }>;

/** Status dots: running (emerald), needs attention (yellow), unread (accent). */
const STATUS_DOT_CLASS = { working: 'bg-chart-7', issue: 'bg-chart-8', unread: 'bg-accent-500' } as const;

/** Backend health dot on the TodeX mark. */
const HEALTH_DOT_CLASS = { success: 'bg-chart-7', warning: 'bg-chart-8', danger: 'bg-foreground-icon-error' } as const;

const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring';

/** Small relative-time / status chip from the BoardUI AI chat sidebar. */
const CHIP = 'inline-flex shrink-0 items-center justify-center rounded-sm bg-background-tertiary-default px-1 py-px text-caption-1-medium whitespace-nowrap text-text-secondary';

/** Quiet text action ("show more", "reset"): row hover fill, no border. */
const QUIET_BUTTON = cx(
  'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-caption-1-regular text-text-tertiary',
  'transition-colors duration-150 ease hover:bg-background-secondary-hover hover:text-text-primary',
  FOCUS_RING,
);

/** Drop indicators: a 3px accent bar on the edge being dropped at, or an
 * outlined accent tint when dropping onto the row (grouping). */
const DROP_EDGE = 'after:pointer-events-none after:absolute after:inset-x-2.5 after:z-3 after:h-[3px] after:rounded-full after:bg-accent-500';
const DROP_CLASS: Record<WorkspaceDropTarget['position'], string> = {
  before: cx(DROP_EDGE, 'after:-top-[3px]'),
  after: cx(DROP_EDGE, 'after:-bottom-[3px]'),
  merge: 'bg-badge-new-background ring-[1.5px] ring-inset ring-accent-500',
  into: 'bg-badge-new-background ring-[1.5px] ring-inset ring-accent-500',
};

/** Normalized swatch value: the same `#RRGGBB` form the HeroUI color picker
 * stored, so saved colors keep matching their swatch. */
function swatchKey(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return parseColor(value).toString('hex');
  } catch {
    return null;
  }
}

/** Maps the pointer's vertical position within a row (0..1) to a drop: row
 * edges reorder, the middle of a workspace groups, a group header absorbs.
 * Groups never nest, so a dragged group only reorders among top-level rows. */
function workspaceDropTargetAt(
  source: WorkspaceDragSource,
  kind: 'workspace' | 'group',
  id: string,
  inGroup: boolean,
  fraction: number,
): WorkspaceDropTarget | null {
  if (source.kind === kind && source.id === id) return null;
  if (kind === 'group') {
    if (source.kind === 'group') return { kind, id, position: fraction < 0.5 ? 'before' : 'after' };
    return { kind, id, position: fraction < 0.3 ? 'before' : 'into' };
  }
  if (source.kind === 'group') return inGroup ? null : { kind, id, position: fraction < 0.5 ? 'before' : 'after' };
  return { kind, id, position: fraction < 0.25 ? 'before' : fraction > 0.75 ? 'after' : 'merge' };
}

function sameDropTarget(left: WorkspaceDropTarget | null, right: WorkspaceDropTarget | null): boolean {
  return left?.kind === right?.kind && left?.id === right?.id && left?.position === right?.position;
}

/** Section header: a collapse toggle (chevron, label, count) beside its add action. */
function SectionHeader({ label, count, collapsed, expandLabel, collapseLabel, onToggle, addLabel, addDisabled, onAdd, hint }: {
  label: string;
  count: number;
  collapsed: boolean;
  expandLabel: string;
  collapseLabel: string;
  onToggle: () => void;
  addLabel: string;
  addDisabled?: boolean;
  onAdd: () => void;
  hint: ShortcutId;
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? expandLabel : collapseLabel}
        className={cx(
          'flex min-w-0 flex-1 cursor-pointer select-none items-center gap-1.5 rounded-2lg px-2 py-1',
          'transition-colors duration-150 ease hover:bg-background-secondary-hover',
          FOCUS_RING,
        )}
      >
        <RiArrowDownSLine
          aria-hidden
          className={cx('size-4 shrink-0 text-foreground-icon-tertiary transition-transform duration-200 ease', collapsed && '-rotate-90 rtl:rotate-90')}
        />
        <span className="truncate text-body-medium text-text-secondary">{label}</span>
        <span className="text-caption-1-regular text-text-tertiary">({count})</span>
      </button>
      <span className="relative inline-flex shrink-0">
        <IconAction size="xs" icon={RiAddLine} aria-label={addLabel} disabled={addDisabled} onClick={onAdd} />
        <ShortcutHint id={hint} className="absolute -top-1.5 -end-1.5 z-10" />
      </span>
    </div>
  );
}

/** "Show more" / "Collapse" paging under a list. */
function ListPaging({ hasMore, canCollapse, onMore, onCollapse }: { hasMore: boolean; canCollapse: boolean; onMore: () => void; onCollapse: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between px-1 pt-1">
      {hasMore ? <button type="button" className={QUIET_BUTTON} onClick={onMore}>{t('sidebar.showMore')}</button> : <span />}
      {canCollapse ? <button type="button" className={QUIET_BUTTON} onClick={onCollapse}>{t('sidebar.collapse')}</button> : null}
    </div>
  );
}

/** Round color swatches (workspace icon color, conversation label). */
function SwatchPicker({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (hex: string) => void }) {
  return (
    <RadioGroup aria-label={label} orientation="horizontal" value={swatchKey(value)} onChange={onChange} className="flex flex-wrap gap-1.5 p-0.5">
      {BACKEND_LABEL_COLORS.map(({ value: color, label: colorLabel }) => (
        <Radio
          key={color}
          value={swatchKey(color) ?? color}
          aria-label={colorLabel}
          style={{ backgroundColor: color }}
          className={({ isSelected, isFocusVisible, isHovered }) => cx(
            'flex size-6 cursor-pointer items-center justify-center rounded-full outline-none',
            'ring-offset-2 ring-offset-background-primary-default transition-shadow duration-150 ease',
            isSelected || isFocusVisible ? 'ring-2 ring-border-focus-ring' : isHovered && 'ring-2 ring-border-button-hover',
          )}
        >
          {({ isSelected }) => (isSelected ? <RiCheckLine aria-hidden className="size-3.5 text-text-white" /> : null)}
        </Radio>
      ))}
    </RadioGroup>
  );
}

/** A right-click menu opened at the pointer. Built on a MenuTrigger (not the
 * kit's ContextMenu) so its submenus get the root menu state they need. */
function PointMenu({ position, onClose, children }: { position: { x: number; y: number } | null; onClose: () => void; children: ReactNode }) {
  const last = useRef(position);
  if (position) last.current = position;
  const point = position ?? last.current;
  return (
    <MenuTrigger isOpen={Boolean(position)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* An anchor only: the menu opens from the pointer, never by pressing it. */}
      <Pressable isDisabled>
        <span
          role="button"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none fixed size-0"
          style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
        />
      </Pressable>
      <MenuPopover placement="bottom start" offset={2}>{children}</MenuPopover>
    </MenuTrigger>
  );
}

const SUBMENU_CHEVRON = <RiArrowRightSLine aria-hidden className="size-4 rtl:-scale-x-100" />;

/** Grid row recipe shared by the workspace, group and conversation lists. The
 * row carries the fill, focus ring and drop bar; `hidden` folds it away with
 * the grid-rows 0fr→1fr transition (children of a folded group). */
function rowClassName({ selected, rail, hidden, drop, dragging, dim, extra }: {
  selected?: boolean;
  rail: boolean;
  hidden?: boolean;
  drop?: WorkspaceDropTarget['position'] | null;
  dragging?: boolean;
  dim?: boolean;
  extra?: string;
}) {
  return ({ isFocusVisible, isHovered, isPressed }: GridListItemRenderProps) => cx(
    'relative grid w-full cursor-pointer rounded-2lg outline-none',
    // Folding eases over 300ms; hover fills keep the 150ms color timing.
    '[transition:grid-template-rows_300ms_ease-in-out,opacity_300ms_ease-in-out,margin_300ms_ease-in-out,background-color_150ms_ease] motion-reduce:transition-none',
    hidden ? 'mt-0 grid-rows-[0fr] opacity-0' : 'mt-0.5 grid-rows-[1fr] first:mt-0',
    selected ? 'bg-background-secondary-hover' : isPressed ? 'bg-background-tertiary-default' : isHovered && 'bg-background-secondary-hover',
    isFocusVisible && 'ring-2 ring-inset ring-border-focus-ring',
    dim && 'opacity-60',
    dragging && 'opacity-40',
    drop && DROP_CLASS[drop],
    rail && 'w-9',
    extra,
  );
}

/** Inner padding box of a grid row; the wrapper clips it while folding. */
function RowContent({ rail, indent, title, children }: { rail: boolean; indent?: boolean; title?: string; children: ReactNode }) {
  return (
    <div className="min-h-0 overflow-hidden" title={title}>
      <div className={cx('flex min-w-0 items-center gap-2', rail ? 'justify-center px-0 py-2' : 'px-2 py-1.5', !rail && indent && 'ps-7')}>
        {children}
      </div>
    </div>
  );
}

export function AppSidebar({
  session,
  open,
  onOpenChange,
  mobile = false,
  onCloseMobile,
  className,
  onCreateWorkspace,
  onEditWorkspace,
  onCreateConversation,
  onOpenSettings,
  onOpenCapabilities,
  onOpenCliManager,
  onOpenAgentProviders,
  onOpenUsage,
  onOpenQuota,
  onOpenAbout,
  onOpenKanban,
  onOpenTerminal,
  terminalActive = false,
  onSelectConversation,
}: Props) {
  const t = useT();
  const isOpen = mobile || open;
  const { pins, togglePin } = useSidebarPins();
  const kanbanTasks = useKanbanTasks();
  const insetChrome = window.todexDesktop.app.windowChrome === 'hidden-inset';

  const conversationTaskMetaMap = useMemo(() => {
    const map: Record<string, { count: number; pending: number }> = {};
    for (const task of kanbanTasks) {
      if (!task.conversationId || task.deletedAt) continue;
      const meta = map[task.conversationId] ??= { count: 0, pending: 0 };
      meta.count += 1;
      if (task.status !== 'done') meta.pending += 1;
    }
    return map;
  }, [kanbanTasks]);

  const workspaceConversations = useMemo(() => (
    session.conversations.filter(
      (conversation) => conversation.workspaceId === session.activeWorkspaceId && !conversation.archived,
    )
  ), [session.activeWorkspaceId, session.conversations]);

  // Workspaces cached under other backend profiles are read-only and render in
  // their own sections; only the active backend's workspaces are editable here.
  const ownWorkspaces = useMemo(() => session.workspaces.filter(
    (workspace) => !workspace.backendConnectionId || workspace.backendConnectionId === session.activeBackendConnectionId,
  ), [session.workspaces, session.activeBackendConnectionId]);

  const foreignWorkspaceGroups = useMemo(() => {
    const groups = new Map<string, { profile: BackendConnectionProfile | undefined; workspaces: WorkspaceRecord[] }>();
    for (const workspace of session.workspaces) {
      const profileId = workspace.backendConnectionId;
      if (!profileId || profileId === session.activeBackendConnectionId) continue;
      const group = groups.get(profileId) ?? {
        profile: session.backendConnections.find((item) => item.id === profileId),
        workspaces: [],
      };
      group.workspaces.push(workspace);
      groups.set(profileId, group);
    }
    for (const group of groups.values()) {
      group.workspaces.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
    }
    return [...groups.values()].sort((a, b) => (a.profile?.name ?? '').localeCompare(b.profile?.name ?? ''));
  }, [session.backendConnections, session.workspaces, session.activeBackendConnectionId]);

  const { collapsedGroups, toggleGroupCollapsed } = useSidebarGroupCollapse();
  const dragSourceRef = useRef<WorkspaceDragSource | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<WorkspaceDropTarget | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<{ id: string; name: string } | null>(null);
  const healthColor = session.connectionState !== 'open'
    ? 'danger'
    : session.connectionHealth.latencyMs !== null && session.connectionHealth.latencyMs <= 100
      ? 'success'
      : 'warning';
  // "Backend online · 42 ms" while connected, the connection state otherwise.
  const connectionLabel = session.connectionState === 'open'
    ? healthLabelOf(session.connectionHealth)
    : connectionStateLabel(session.connectionState);

  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  // The menu keeps rendering its last target while it animates out.
  const lastContextMenuRef = useRef<ContextMenu>(contextMenu);
  if (contextMenu) lastContextMenuRef.current = contextMenu;
  const menu = contextMenu ?? lastContextMenuRef.current;
  // The identity (top) and TodeX (team card) panels keep a peeking rail open.
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);

  // Quick search: filters the workspace and conversation lists by name.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const query = searchQuery.trim().toLocaleLowerCase();
  const asideRef = useRef<HTMLElement>(null);

  // Section collapse states
  const [workspacesCollapsed, setWorkspacesCollapsed] = useState(false);
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false);

  // Progressive disclosure limits (default 5, clicking '显示更多' shows 5 more)
  const [workspaceLimit, setWorkspaceLimit] = useState(5);
  const [conversationLimit, setConversationLimit] = useState(5);

  // Reset conversation limit when switching workspaces
  useEffect(() => {
    setConversationLimit(5);
  }, [session.activeWorkspaceId]);

  // Icon-rail peek: the collapsed sidebar renders as a 60px icon rail. Hover,
  // keyboard focus, or an open menu expands it back to 260px while a negative
  // inline-end margin keeps the rail's layout footprint, so the expanded
  // sidebar floats over the conversation instead of pushing it.
  const railCollapsed = !isOpen;
  const [hoverPeek, setHoverPeek] = useState(false);
  const [focusPeek, setFocusPeek] = useState(false);
  const insideRef = useRef({ pointer: false, focus: false });
  const suppressPeekRef = useRef(false);
  const peekTimerRef = useRef<number | null>(null);
  const peeking = railCollapsed
    && !suppressPeekRef.current
    && (hoverPeek || focusPeek || contextMenu !== null || headerMenuOpen || teamMenuOpen);
  // The rail shows icons only; a peek shows the full sidebar.
  const rail = railCollapsed && !peeking;

  const scheduleHoverPeek = (next: boolean) => {
    if (peekTimerRef.current !== null) window.clearTimeout(peekTimerRef.current);
    peekTimerRef.current = window.setTimeout(() => {
      peekTimerRef.current = null;
      setHoverPeek(next);
    }, next ? 70 : 140);
  };

  const updatePeekSuppression = () => {
    if (!insideRef.current.pointer && !insideRef.current.focus) {
      suppressPeekRef.current = false;
    }
  };

  // Collapsing while the pointer or focus is already inside must not pop the
  // sidebar back open — require one clean exit before hover peeking re-arms.
  const wasOpenRef = useRef(isOpen);
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      suppressPeekRef.current = insideRef.current.pointer || insideRef.current.focus;
      if (peekTimerRef.current !== null) window.clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
      setHoverPeek(false);
      setFocusPeek(false);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => () => {
    if (peekTimerRef.current !== null) window.clearTimeout(peekTimerRef.current);
  }, []);

  // The rail has no room for the field: closing it drops the search.
  useEffect(() => {
    if (!rail) return;
    setSearchActive(false);
    setSearchQuery('');
  }, [rail]);

  // Mod+L opens the quick search (a collapsed rail peeks open around it). It
  // is left to text fields and the terminal, where Ctrl+L clears the screen.
  useAppShortcuts({
    quickSearch: () => {
      // A closed compact-layout drawer is inert; nothing in it can take focus.
      if (asideRef.current?.closest('[inert]')) return;
      if (railCollapsed) {
        suppressPeekRef.current = false;
        setFocusPeek(true);
      }
      setSearchActive(true);
    },
  });

  const railProps = {
    ref: asideRef,
    'data-peek': railCollapsed ? 'true' : undefined,
    'data-state': rail ? 'collapsed' as const : 'expanded' as const,
    onMouseEnter: () => {
      insideRef.current.pointer = true;
      if (!suppressPeekRef.current) scheduleHoverPeek(true);
    },
    onMouseLeave: () => {
      insideRef.current.pointer = false;
      scheduleHoverPeek(false);
      updatePeekSuppression();
    },
    onFocus: () => {
      insideRef.current.focus = true;
      if (!suppressPeekRef.current) setFocusPeek(true);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      insideRef.current.focus = false;
      setFocusPeek(false);
      updatePeekSuppression();
    },
  };

  // The floating panel (BoardUI sidebar recipe). Collapsed it is a 60px rail
  // of the same panel; a peek floats the 260px panel over the conversation
  // while a negative inline-end margin keeps the rail's footprint.
  const shellClassName = cx(
    'relative',
    !mobile && 'transition-[width,margin-inline-end,box-shadow,padding] duration-300 ease-in-out motion-reduce:transition-none',
    peeking && 'z-40 -me-50 shadow-xl',
    className,
  );
  // macOS hidden-inset chrome: the traffic lights sit over the top of the
  // sidebar, so its top strip is a drag region with room for them.
  const chromeStrip = insetChrome ? <div aria-hidden="true" className="window-drag -mx-3 -mt-3 h-7 shrink-0" /> : null;

  // High-performance timeline lookup map: precomputed once in O(M) time instead of O(N*M) during sorting
  const timelineInfoMap = useMemo(() => {
    const map: Record<string, { latestAt: number; latestEntry?: TodeXSession['timeline'][number]; latestIncomingAt: number }> = {};
    const timeline = session.timeline;
    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i];
      if (!entry?.conversationId || !entry?.at) continue;
      const existing = map[entry.conversationId] ??= { latestAt: 0, latestIncomingAt: 0 };
      if (entry.at > existing.latestAt) {
        existing.latestAt = entry.at;
        existing.latestEntry = entry;
      }
      if (entry.kind === 'incoming' && entry.at > existing.latestIncomingAt) {
        existing.latestIncomingAt = entry.at;
      }
    }
    return map;
  }, [session.timeline]);

  // A workspace surfaces its most urgent conversation status: a running turn
  // beats an unread error, which beats a plain unread marker — the same
  // precedence getConversationStatus uses per row.
  const workspaceStatusMap = useMemo(() => {
    const rank = { working: 3, issue: 2, unread: 1 } as const;
    const map: Record<string, keyof typeof rank> = {};
    for (const conversation of session.conversations) {
      if (!conversation.workspaceId || conversation.archived) continue;
      const status = getConversationStatus(session, conversation, timelineInfoMap[conversation.id]?.latestEntry, timelineInfoMap[conversation.id]?.latestIncomingAt);
      if (!status) continue;
      const current = map[conversation.workspaceId];
      if (!current || rank[status.kind] > rank[current]) {
        map[conversation.workspaceId] = status.kind;
      }
    }
    return map;
  }, [session, timelineInfoMap]);

  // Workspaces use an explicit manual order and never move when a conversation updates.
  const sortedWorkspaces = useMemo(() => [...ownWorkspaces].sort((a, b) => Number(pins.workspace.includes(b.id)) - Number(pins.workspace.includes(a.id)) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id)), [ownWorkspaces, pins.workspace]);

  // Conversations order by the last finished/stopped turn, so a running
  // conversation no longer re-sorts while it streams. Items that have never
  // completed keep their creation order.
  const sortedConversations = useMemo(() => {
    return [...workspaceConversations].sort((a, b) => {
      const pinOrder = Number(pins.conversation.includes(b.id)) - Number(pins.conversation.includes(a.id));
      if (pinOrder) return pinOrder;
      const aTime = a.lastCompletedAt || a.createdAt || 0;
      const bTime = b.lastCompletedAt || b.createdAt || 0;
      if (bTime !== aTime) return bTime - aTime;
      if ((b.createdAt || 0) !== (a.createdAt || 0)) return (b.createdAt || 0) - (a.createdAt || 0);
      return a.id.localeCompare(b.id);
    });
  }, [workspaceConversations, pins.conversation]);

  // Top-level rows: lone workspaces and groups. "Show more" pages by these,
  // so a group counts as one row.
  const workspaceEntries = useMemo(() => groupWorkspaceEntries(sortedWorkspaces), [sortedWorkspaces]);
  const newGroupFallbackName = t('sidebar.newGroupName');
  // A search keeps the rows whose name matches; a group whose own name matches
  // keeps all of its workspaces, otherwise just the matching ones.
  const matchedEntries = useMemo(() => {
    if (!query) return workspaceEntries;
    const hit = (text: string) => text.toLocaleLowerCase().includes(query);
    return workspaceEntries.flatMap((entry): WorkspaceSidebarEntry[] => {
      if (entry.kind === 'workspace') return hit(workspaceDisplayName(entry.workspace)) ? [entry] : [];
      if (hit(entry.name || newGroupFallbackName)) return [entry];
      const workspaces = entry.workspaces.filter((workspace) => hit(workspaceDisplayName(workspace)));
      return workspaces.length > 0 ? [{ ...entry, workspaces }] : [];
    });
  }, [workspaceEntries, query, newGroupFallbackName]);
  const matchedWorkspaceCount = useMemo(() => matchedEntries.reduce(
    (count, entry) => count + (entry.kind === 'group' ? entry.workspaces.length : 1),
    0,
  ), [matchedEntries]);
  // Search results are shown whole; paging applies to the full list.
  const displayedEntries = useMemo(
    () => (query ? matchedEntries : matchedEntries.slice(0, workspaceLimit)),
    [matchedEntries, query, workspaceLimit],
  );
  const workspaceEntriesRef = useRef(workspaceEntries);
  workspaceEntriesRef.current = workspaceEntries;
  // Search results open folded groups.
  const isGroupFolded = useCallback(
    (groupId: string) => !query && collapsedGroups.includes(groupId),
    [query, collapsedGroups],
  );
  // Children of a folded group stay mounted (they fold away with the
  // grid-rows transition) but leave keyboard navigation.
  const foldedWorkspaceKeys = useMemo(() => displayedEntries.flatMap((entry) => (
    entry.kind === 'group' && isGroupFolded(entry.id) ? entry.workspaces.map((workspace) => workspace.id) : []
  )), [displayedEntries, isGroupFolded]);

  const matchedForeignGroups = useMemo(() => {
    if (!query) return foreignWorkspaceGroups;
    return foreignWorkspaceGroups
      .map((group) => ({ ...group, workspaces: group.workspaces.filter((workspace) => workspaceDisplayName(workspace).toLocaleLowerCase().includes(query)) }))
      .filter((group) => group.workspaces.length > 0);
  }, [foreignWorkspaceGroups, query]);

  // Persists a regrouped or reordered layout as per-workspace sortOrder/groupId/groupName.
  const applyWorkspaceLayout = useCallback((next: WorkspaceSidebarEntry[]) => {
    for (const { id, patch } of workspaceLayoutPatches(next)) session.updateWorkspace(id, patch);
  }, [session]);

  // Titles are only resolved for every conversation while a search runs.
  const matchedConversations = useMemo(() => {
    if (!query) return sortedConversations;
    return sortedConversations.filter((conversation) => (
      conversationDisplayTitle(conversation, session.timeline).toLocaleLowerCase().includes(query)
    ));
  }, [sortedConversations, query, session.timeline]);

  const displayedConversations = useMemo(() => {
    return query ? matchedConversations : matchedConversations.slice(0, conversationLimit);
  }, [matchedConversations, query, conversationLimit]);

  // Drag-and-drop uses native listeners on the rendered rows; each draggable
  // row carries data-workspace-drag="<kind>:<id>".
  useEffect(() => {
    const finish = () => {
      dragSourceRef.current = null;
      setDraggingKey(null);
      setDropTarget(null);
    };
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-drag]'));
    const cleanups = rows.map((row) => {
      const key = row.dataset.workspaceDrag || '';
      const separator = key.indexOf(':');
      const kind = key.slice(0, separator);
      const id = key.slice(separator + 1);
      if ((kind !== 'workspace' && kind !== 'group') || !id) return () => {};
      const inGroup = row.dataset.workspaceInGroup === 'true';
      const targetAt = (event: globalThis.DragEvent) => {
        const source = dragSourceRef.current;
        if (!source) return null;
        const rect = row.getBoundingClientRect();
        return workspaceDropTargetAt(source, kind, id, inGroup, (event.clientY - rect.top) / Math.max(rect.height, 1));
      };
      row.draggable = true;
      const start = (event: globalThis.DragEvent) => {
        dragSourceRef.current = { kind, id };
        setDraggingKey(key);
        event.dataTransfer?.setData('text/plain', id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      };
      const over = (event: globalThis.DragEvent) => {
        if (!dragSourceRef.current) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const target = targetAt(event);
        setDropTarget((current) => (sameDropTarget(current, target) ? current : target));
      };
      const drop = (event: globalThis.DragEvent) => {
        event.preventDefault();
        const source = dragSourceRef.current;
        const target = targetAt(event);
        finish();
        if (!source || !target) return;
        const current = workspaceEntriesRef.current;
        const groupId = newWorkspaceGroupId();
        const next = moveWorkspaceEntry(current, source, target, { id: groupId, fallbackName: newGroupFallbackName });
        if (next === current) return;
        applyWorkspaceLayout(next);
        const created = next.find((entry): entry is WorkspaceGroupEntry => entry.kind === 'group' && entry.id === groupId);
        if (created) setRenamingGroup({ id: created.id, name: created.name });
      };
      row.addEventListener('dragstart', start);
      row.addEventListener('dragover', over);
      row.addEventListener('drop', drop);
      row.addEventListener('dragend', finish);
      return () => {
        row.removeEventListener('dragstart', start);
        row.removeEventListener('dragover', over);
        row.removeEventListener('drop', drop);
        row.removeEventListener('dragend', finish);
      };
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [displayedEntries, isGroupFolded, applyWorkspaceLayout, newGroupFallbackName]);

  // Losing window focus closes the menu; outside presses close it through
  // the popover itself.
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('blur', close);
    return () => window.removeEventListener('blur', close);
  }, []);

  const openContextMenu = (event: MouseEvent, kind: NonNullable<ContextMenu>['kind'], id: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind, id, x: event.clientX, y: event.clientY });
  };
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const contextGroup = menu?.kind === 'group'
    ? workspaceEntries.find((entry): entry is WorkspaceGroupEntry => entry.kind === 'group' && entry.id === menu.id)
    : undefined;
  const contextWorkspaceGroupId = menu?.kind === 'workspace'
    ? workspaceEntries.find((entry): entry is WorkspaceGroupEntry => entry.kind === 'group' && entry.workspaces.some((workspace) => workspace.id === menu.id))?.id
    : undefined;
  const contextMoveTargets = menu?.kind === 'workspace'
    ? workspaceEntries.filter((entry): entry is WorkspaceGroupEntry => entry.kind === 'group' && entry.id !== contextWorkspaceGroupId)
    : [];
  const runGroupLayout = (next: WorkspaceSidebarEntry[]) => {
    applyWorkspaceLayout(next);
    setContextMenu(null);
  };

  // Legacy plaintext history is read-only: no rename or fork.
  const contextReadOnly = menu?.kind === 'conversation'
    && session.conversations.find((item) => item.id === menu.id)?.legacyPlaintext === true;
  const runContextAction = (action: 'rename' | 'edit' | 'fork' | 'pin' | 'delete') => {
    if (!menu || menu.kind === 'group') return;
    if (action === 'pin') {
      togglePin(menu.kind, menu.id);
      setContextMenu(null);
      return;
    }
    if (menu.kind === 'workspace') {
      const workspace = session.workspaces.find((item) => item.id === menu.id);
      if (!workspace) return;
      if (action === 'rename') {
        const name = window.prompt(t('sidebar.renameWorkspacePrompt'), workspace.name);
        if (name) session.renameWorkspace(workspace.id, name);
      } else if (action === 'edit') onEditWorkspace(workspace.id);
      else if (action === 'delete') session.removeWorkspace(workspace.id);
    } else {
      const conversation = session.conversations.find((item) => item.id === menu.id);
      if (!conversation) return;
      if (action === 'rename') {
        const title = window.prompt(t('sidebar.renameConversationPrompt'), conversation.title);
        if (title) session.renameConversation(conversation.id, title);
      } else if (action === 'fork') session.forkConversation(conversation.id);
      else if (action === 'delete') session.removeConversation(conversation.id);
    }
    setContextMenu(null);
  };

  const renderWorkspaceItem = (workspace: WorkspaceRecord, group: { entry: WorkspaceGroupEntry; last: boolean; folded: boolean } | null) => {
    const isSelected = workspace.id === session.activeWorkspaceId;
    // A group-after drop on an expanded group marks the group's last row.
    const drop = dropTarget?.kind === 'workspace' && dropTarget.id === workspace.id
      ? dropTarget.position
      : group?.last && !group.folded && dropTarget?.kind === 'group' && dropTarget.id === group.entry.id && dropTarget.position === 'after'
        ? 'after' as const
        : null;
    const isMissing = Boolean(workspace.pathMissing);
    const backend = session.backendConnections.find((profile) => profile.id === (workspace.backendConnectionId || session.activeBackendConnectionId));
    const backendLabel = backend ? t('sidebar.backendLabel', { name: backend.name, url: backend.serverUrl }) : t('sidebar.backendRemoved');
    const workspaceStatus = workspaceStatusMap[workspace.id];
    const workspaceStatusLabel = workspaceStatus === 'working'
      ? t('sidebar.statusWorking')
      : workspaceStatus === 'issue'
        ? t('sidebar.statusIssue')
        : t('sidebar.statusUnread');
    const WorkspaceGlyph = workspaceIconComponent(workspace.icon);
    return (
      <GridListItem
        key={workspace.id}
        id={workspace.id}
        textValue={workspaceDisplayName(workspace)}
        className={rowClassName({
          selected: isSelected,
          rail,
          hidden: group?.folded,
          drop,
          dragging: draggingKey === `workspace:${workspace.id}`,
          extra: isMissing ? 'cursor-not-allowed opacity-50' : undefined,
        })}
        inert={group?.folded || undefined}
        data-workspace-id={workspace.id}
        data-workspace-drag={`workspace:${workspace.id}`}
        data-workspace-in-group={group ? 'true' : undefined}
        onContextMenu={(event) => openContextMenu(event, 'workspace', workspace.id)}
      >
        <RowContent rail={rail} indent={Boolean(group)} title={isMissing ? t('sidebar.workspaceMissingPath') : rail ? workspaceDisplayName(workspace) : undefined}>
          <span className="relative flex size-5 shrink-0 items-center justify-center">
            {workspaceStatus ? (
              <WorkspaceStatusRing kind={workspaceStatus} style={workspace.ringStyle} label={workspaceStatusLabel} />
            ) : null}
            <WorkspaceGlyph
              className={cx('size-4', !workspace.iconColor && (isSelected ? 'text-foreground-icon-primary' : 'text-foreground-icon-secondary'))}
              color={workspace.iconColor}
            />
          </span>
          <span className={cx('flex min-w-0 flex-1 flex-col', rail && 'hidden')}>
            <span className={cx('flex min-w-0 items-center gap-1 text-body-medium', isSelected ? 'text-text-primary' : isMissing ? 'text-text-tertiary' : 'text-text-secondary')}>
              <span className="truncate">{workspaceDisplayName(workspace)}</span>
              {pins.workspace.includes(workspace.id) ? <RiPushpin2Fill className="size-3 shrink-0 text-foreground-icon-tertiary" aria-label={t('sidebar.pinned')} /> : null}
              {isMissing ? <RiErrorWarningLine className="size-3 shrink-0 text-status-yellow-text" aria-label={t('sidebar.workspaceMissingPath')} /> : null}
            </span>
          </span>
          {rail ? null : (
            <TooltipTrigger delay={300}>
              <Focusable>
                <span
                  role="img"
                  tabIndex={-1}
                  aria-label={backendLabel}
                  className={cx('ms-auto flex size-6 shrink-0 items-center justify-center rounded-full', FOCUS_RING)}
                >
                  <span aria-hidden="true" className="size-2.5 rounded-full ring-1 ring-separator-border" style={{ backgroundColor: backendLabelColor(backend) }} />
                </span>
              </Focusable>
              <Tooltip placement="right" className="max-w-xs break-all">{backendLabel}</Tooltip>
            </TooltipTrigger>
          )}
        </RowContent>
      </GridListItem>
    );
  };

  const renderGroupItems = (entry: WorkspaceGroupEntry) => {
    const folded = isGroupFolded(entry.id);
    const name = entry.name || t('sidebar.newGroupName');
    const containsSelected = entry.workspaces.some((workspace) => workspace.id === session.activeWorkspaceId);
    const statuses = entry.workspaces
      .map((workspace) => workspaceStatusMap[workspace.id])
      .filter((status): status is NonNullable<typeof status> => Boolean(status))
      .slice(0, 3);
    const drop = dropTarget?.kind === 'group' && dropTarget.id === entry.id
      ? dropTarget.position === 'after' && !folded ? null : dropTarget.position
      : null;
    const header = (
      <GridListItem
        key={`group:${entry.id}`}
        id={`group:${entry.id}`}
        textValue={name}
        aria-label={folded ? t('sidebar.expandGroup', { name }) : t('sidebar.collapseGroup', { name })}
        className={rowClassName({ rail, drop, dragging: draggingKey === `group:${entry.id}` })}
        data-workspace-drag={`group:${entry.id}`}
        onContextMenu={(event) => openContextMenu(event, 'group', entry.id)}
      >
        <RowContent rail={rail} title={rail ? name : undefined}>
          <span className="relative flex size-5 shrink-0 items-center justify-center">
            {rail ? (
              <RiFoldersLine aria-hidden className={cx('size-4', containsSelected ? 'text-foreground-icon-primary' : 'text-foreground-icon-secondary')} />
            ) : (
              <RiArrowDownSLine aria-hidden className={cx('size-4 text-foreground-icon-tertiary transition-transform duration-200 ease', folded && '-rotate-90 rtl:rotate-90')} />
            )}
          </span>
          <span className={cx('flex min-w-0 flex-1 items-center gap-1', rail && 'hidden')}>
            <span className={cx('truncate text-body-semibold', folded && containsSelected ? 'text-text-primary' : 'text-text-secondary')}>{name}</span>
            <span className="text-caption-2-regular text-text-tertiary">{entry.workspaces.length}</span>
          </span>
          {folded && statuses.length > 0 && !rail ? (
            <span className="ms-auto flex shrink-0 items-center gap-1 pe-1" aria-hidden="true">
              {statuses.map((status, index) => <span key={index} className={cx('size-1.5 rounded-full', STATUS_DOT_CLASS[status])} />)}
            </span>
          ) : null}
        </RowContent>
      </GridListItem>
    );
    return [header, ...entry.workspaces.map((workspace, index) => renderWorkspaceItem(workspace, { entry, last: index === entry.workspaces.length - 1, folded }))];
  };

  // Cached data renders immediately; the directory sync only blocks an
  // entirely empty sidebar (first run or cleared storage).
  const syncing = session.directorySyncStatus === 'loading' && session.workspaces.length === 0;

  const primaryItems: DashboardNavItem[] = [
    {
      key: 'new-conversation',
      label: t('sidebar.newConversation'),
      icon: RiAddLine,
      disabled: !session.activeWorkspaceId,
      onClick: onCreateConversation,
      hint: <ShortcutHint id="newConversation" />,
    },
    {
      key: 'terminal',
      label: t('sidebar.terminal'),
      icon: RiTerminalLine,
      isSelected: terminalActive,
      toggle: true,
      onClick: () => {
        if (mobile) onCloseMobile?.();
        onOpenTerminal();
      },
      hint: <ShortcutHint id="sshTerminal" />,
    },
    {
      key: 'kanban',
      label: t('sidebar.kanban'),
      icon: RiKanbanView2,
      isSelected: false,
      onClick: onOpenKanban,
      hint: <ShortcutHint id="kanban" />,
    },
  ];

  const secondaryItems: DashboardNavItem[] = [
    { key: 'settings', label: t('app.settings'), icon: RiSettings3Line, isSelected: false, onClick: onOpenSettings },
  ];

  // The TodeX menu (formerly the identity menu), grouped: management, then
  // usage and about. Settings sits right above it as its own row.
  const teamMenuGroups: DashboardTeamMenuGroup[] = [
    {
      id: 'manage',
      items: [
        { id: 'capabilities', icon: RiPuzzle2Line, label: t('app.mcpSkillManager'), onSelect: onOpenCapabilities },
        {
          id: 'cli-manager',
          icon: RiTerminalBoxLine,
          label: t('app.cliManager'),
          onSelect: () => {
            if (mobile) onCloseMobile?.();
            onOpenCliManager();
          },
        },
        {
          id: 'agent-providers',
          icon: RiUserSettingsLine,
          label: t('app.agentProviders'),
          onSelect: () => {
            if (mobile) onCloseMobile?.();
            onOpenAgentProviders();
          },
        },
      ],
    },
    {
      id: 'usage',
      items: [
        { id: 'usage', icon: RiBarChartBoxLine, label: t('app.usage'), onSelect: onOpenUsage },
        { id: 'quota', icon: RiVipCrownLine, label: t('usage.quotaTitle'), onSelect: onOpenQuota },
        { id: 'about', icon: RiInformationLine, label: t('app.about'), onSelect: onOpenAbout },
      ],
    },
  ];

  // TodeX mark with the backend health dot; its ring matches the surface.
  const identityMark = (
    <span className="relative flex shrink-0">
      <AppIcon />
      <span
        role="img"
        aria-label={session.connectionState === 'open' ? t('sidebar.backendConnected') : t('sidebar.backendDisconnected')}
        className={cx('absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full ring-2', mobile ? 'ring-background-full' : 'ring-background-secondary-default', HEALTH_DOT_CLASS[healthColor])}
      />
    </span>
  );

  const menuWorkspace = menu?.kind === 'workspace' ? session.workspaces.find((item) => item.id === menu.id) : undefined;
  const nothingMatches = Boolean(query)
    && matchedWorkspaceCount === 0
    && matchedForeignGroups.length === 0
    && matchedConversations.length === 0;

  return (
    <DashboardSidebar
      {...railProps}
      className={shellClassName}
      mobile={mobile}
      flat={mobile}
      onClose={onCloseMobile}
      closeLabel={t('sidebar.closeSidebar')}
      collapsed={rail}
      onCollapsedChange={(collapsed) => onOpenChange?.(!collapsed)}
      collapseButton={{ expandLabel: t('app.expandSidebar'), collapseLabel: t('app.collapseSidebar'), expanded: isOpen }}
      chrome={chromeStrip}
      header={({ collapsed, suppressHover, onHoverSuppressionEnd }) => (
        <DashboardUserMenu
          collapsed={collapsed}
          suppressHover={suppressHover}
          onHoverSuppressionEnd={onHoverSuppressionEnd}
          avatar={identityMark}
          name="TodeX"
          badge={<Chip variant="caption" color="neutral" className="py-0.5">V2</Chip>}
          aria-label={`TodeX · ${connectionLabel}`}
          menuLabel={t('settings.backendConnections')}
          onOpenChange={setHeaderMenuOpen}
        >
          {(close) => (
            <>
              <DashboardUserMenuSection label={t('settings.backendConnections')}>
                {session.backendConnections.length > 0 ? session.backendConnections.map((profile) => {
                  const active = profile.id === session.activeBackendConnectionId;
                  return (
                    <DashboardUserMenuRow
                      key={profile.id}
                      avatar={<span aria-hidden="true" className="size-5 shrink-0 rounded-full ring-1 ring-inset ring-separator-border" style={{ backgroundColor: backendLabelColor(profile) }} />}
                      label={profile.name}
                      description={active ? connectionLabel : undefined}
                      trailing={active ? <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-full', HEALTH_DOT_CLASS[healthColor])} /> : undefined}
                      isSelected={active}
                      title={t('sidebar.backendLabel', { name: profile.name, url: profile.serverUrl })}
                    />
                  );
                }) : (
                  <DashboardUserMenuRow
                    avatar={<span aria-hidden="true" className={cx('size-2 shrink-0 rounded-full', HEALTH_DOT_CLASS[healthColor])} />}
                    label={connectionLabel}
                  />
                )}
              </DashboardUserMenuSection>
              <DashboardUserMenuDivider />
              <DashboardUserMenuActions>
                <Button
                  variant="secondary"
                  size="small"
                  leadingIcon={RiSettings3Line}
                  className="flex-1"
                  onClick={() => {
                    close();
                    onOpenSettings();
                  }}
                >
                  {t('app.settings')}
                </Button>
              </DashboardUserMenuActions>
            </>
          )}
        </DashboardUserMenu>
      )}
      items={primaryItems}
      search={{
        value: searchQuery,
        onChange: setSearchQuery,
        label: t('sidebar.quickSearch'),
        placeholder: t('sidebar.searchPlaceholder'),
        'aria-label': t('sidebar.searchAria'),
        clearLabel: t('sidebar.clearSearch'),
        shortcut: shortcutKeys('quickSearch'),
        active: searchActive,
        onActiveChange: setSearchActive,
      }}
      secondaryItems={secondaryItems}
      footer={({ collapsed, flat }) => (
        <DashboardTeamMenu
          collapsed={collapsed}
          className={flat ? '!bg-background-secondary-default' : undefined}
          avatar={<AppIcon />}
          title="TodeX"
          subtitle={connectionLabel}
          aria-label={t('sidebar.menu')}
          menuLabel={t('sidebar.menu')}
          groups={teamMenuGroups}
          footer={{ label: 'TodeX', meta: `v${__TODEX_BUILD_VERSION__}` }}
          onOpenChange={setTeamMenuOpen}
        />
      )}
    >
      {() => (
      <>
      {syncing ? (
        rail ? null : <p className="px-2 py-1 text-body-regular text-text-secondary">{t('sidebar.syncing')}</p>
      ) : (
      <div className={cx('flex flex-col gap-4', !rail && 'px-0.5')}>
        {nothingMatches ? <p className="px-2 py-3 text-body-regular text-text-tertiary">{t('sidebar.noResults')}</p> : null}

        {/* Workspace section */}
        {query && matchedWorkspaceCount === 0 && matchedForeignGroups.length === 0 ? null : (
        <section className="flex flex-col gap-1">
          {rail ? null : (
            <SectionHeader
              label={t('sidebar.workspaces')}
              count={query ? matchedWorkspaceCount : ownWorkspaces.length}
              collapsed={!query && workspacesCollapsed}
              expandLabel={t('sidebar.expandWorkspaces')}
              collapseLabel={t('sidebar.collapseWorkspaces')}
              onToggle={() => setWorkspacesCollapsed((prev) => !prev)}
              addLabel={t('sidebar.newWorkspace')}
              onAdd={() => onCreateWorkspace()}
              hint="newWorkspace"
            />
          )}

          {(query || !workspacesCollapsed) && (
            <>
              {ownWorkspaces.length === 0 ? (
                rail || query ? null : <p className="px-2 py-1 text-caption-1-regular text-text-tertiary">{t('sidebar.noWorkspaces')}</p>
              ) : displayedEntries.length === 0 ? null : (
                <>
                  <GridList
                    key={`workspaces_${workspaceLimit}`}
                    aria-label={t('sidebar.workspaces')}
                    className="flex flex-col outline-none"
                    disabledKeys={foldedWorkspaceKeys}
                    disabledBehavior="all"
                    onAction={(key) => {
                      if (String(key).startsWith('group:')) {
                        toggleGroupCollapsed(String(key).slice('group:'.length));
                        return;
                      }
                      const target = session.workspaces.find((item) => item.id === String(key));
                      if (target?.pathMissing) {
                        return;
                      }
                      session.selectWorkspace(String(key));
                    }}
                  >
                    {displayedEntries.flatMap((entry) => (entry.kind === 'group'
                      ? renderGroupItems(entry)
                      : [renderWorkspaceItem(entry.workspace, null)]))}
                  </GridList>

                  {!query && workspaceEntries.length > 5 && !rail && (
                    <ListPaging
                      hasMore={workspaceEntries.length > workspaceLimit}
                      canCollapse={workspaceLimit > 5}
                      onMore={() => setWorkspaceLimit((prev) => prev + 5)}
                      onCollapse={() => setWorkspaceLimit(5)}
                    />
                  )}
                </>
              )}
              {matchedForeignGroups.map((group) => {
                const backendLabel = group.profile
                  ? t('sidebar.backendLabel', { name: group.profile.name, url: group.profile.serverUrl })
                  : t('sidebar.backendRemoved');
                return (
                  <div key={group.profile?.id ?? 'removed'} className="mt-1.5 flex flex-col gap-0.5 border-t border-separator-border pt-1.5">
                    <div className={cx('flex items-center gap-1.5 px-2 pt-1 pb-0.5', rail && 'hidden')}>
                      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full ring-1 ring-separator-border" style={{ backgroundColor: backendLabelColor(group.profile) }} />
                      <span className="min-w-0 flex-1 truncate text-caption-1-medium text-text-secondary" title={backendLabel}>
                        {group.profile?.name || t('sidebar.backendRemoved')}
                      </span>
                      <Chip variant="caption" color="neutral" className="py-0.5">{t('sidebar.otherBackend')}</Chip>
                    </div>
                    <GridList
                      aria-label={backendLabel}
                      className="flex flex-col outline-none"
                      onAction={(key) => session.selectWorkspace(String(key))}
                    >
                      {group.workspaces.map((workspace) => {
                        const WorkspaceGlyph = workspaceIconComponent(workspace.icon);
                        return (
                          <GridListItem
                            key={workspace.id}
                            id={workspace.id}
                            textValue={workspaceDisplayName(workspace)}
                            className={rowClassName({ rail })}
                          >
                            <RowContent rail={rail} title={rail ? workspaceDisplayName(workspace) : undefined}>
                              <span className="relative flex size-5 shrink-0 items-center justify-center">
                                <WorkspaceGlyph className={cx('size-4', !workspace.iconColor && 'text-foreground-icon-secondary')} color={workspace.iconColor} />
                              </span>
                              <span className={cx('flex min-w-0 flex-1 flex-col', rail && 'hidden')}>
                                <span className="truncate text-body-medium text-text-secondary">{workspaceDisplayName(workspace)}</span>
                              </span>
                            </RowContent>
                          </GridListItem>
                        );
                      })}
                    </GridList>
                  </div>
                );
              })}
            </>
          )}
        </section>
        )}

        {/* Conversation section */}
        {query && matchedConversations.length === 0 ? null : (
        <section className="flex flex-col gap-1">
          {rail ? null : (
            <SectionHeader
              label={t('sidebar.conversations')}
              count={query ? matchedConversations.length : workspaceConversations.length}
              collapsed={!query && conversationsCollapsed}
              expandLabel={t('sidebar.expandConversations')}
              collapseLabel={t('sidebar.collapseConversations')}
              onToggle={() => setConversationsCollapsed((prev) => !prev)}
              addLabel={t('sidebar.newConversationAria')}
              addDisabled={!session.activeWorkspaceId}
              onAdd={() => onCreateConversation()}
              hint="newConversation"
            />
          )}

          {(query || !conversationsCollapsed) && (
            workspaceConversations.length === 0 ? (
              rail ? null : (
                <p className="px-2 py-1 text-caption-1-regular text-text-tertiary">
                  {session.activeWorkspaceId ? t('sidebar.noConversations') : t('sidebar.selectWorkspace')}
                </p>
              )
            ) : (
              <>
                <GridList
                  key={`${session.activeWorkspaceId || 'no-workspace'}_${conversationLimit}`}
                  aria-label={t('sidebar.conversations')}
                  className="flex flex-col outline-none"
                  onAction={(key) => {
                    const conversation = workspaceConversations.find((item) => item.id === String(key));
                    if (conversation) {
                      session.selectConversation(conversation.workspaceId, conversation.id);
                      onSelectConversation?.();
                    }
                  }}
                >
                  {displayedConversations.map((conversation) => {
                    const isSelected = conversation.id === session.activeConversationId;
                    const status = getConversationStatus(session, conversation, timelineInfoMap[conversation.id]?.latestEntry, timelineInfoMap[conversation.id]?.latestIncomingAt);
                    const taskMeta = conversationTaskMetaMap[conversation.id];
                    // A daemon-paused follow-up queue waiting out a provider rate
                    // limit gets a clock badge; it reports its own resumeAt.
                    const followUps = session.conversationRuntimeById[conversation.id]?.followUps;
                    const backendWait = followUps?.paused && followUps.pauseReason === 'rate_limited' && followUps.items.length > 0
                      ? Date.parse(followUps.resumeAt) : NaN;
                    const resetAt = Number.isFinite(backendWait) && backendWait > Date.now() ? backendWait : undefined;
                    const tasksDone = Boolean(taskMeta && taskMeta.pending === 0);
                    const title = conversationDisplayTitle(conversation, session.timeline);
                    const running = isConversationHighlighted(conversation, session.activeConversationId, session.turnIds);
                    return (
                      <GridListItem
                        key={conversation.id}
                        id={conversation.id}
                        textValue={title}
                        className={rowClassName({ selected: isSelected, rail, dim: tasksDone })}
                        onContextMenu={(event) => openContextMenu(event, 'conversation', conversation.id)}
                      >
                        <RowContent rail={rail} title={rail ? title : undefined}>
                          <span className="relative flex size-5 shrink-0 items-center justify-center">
                            <ProviderIcon className={cx('size-4', isSelected ? 'text-foreground-icon-primary' : 'text-foreground-icon-secondary')} provider={conversation.provider} />
                            <span
                              className={cx(
                                'absolute -end-0.5 -bottom-0.5 size-2 rounded-full ring-2',
                                isSelected ? 'ring-background-secondary-hover' : mobile ? 'ring-background-full' : 'ring-background-secondary-default',
                                status ? STATUS_DOT_CLASS[status.kind] : 'hidden',
                              )}
                              aria-label={status?.label}
                            />
                          </span>
                          <span className={cx('flex min-w-0 flex-1 flex-col', rail && 'hidden')}>
                            <span className={cx('flex min-w-0 items-center gap-1 text-body-medium', isSelected ? 'text-text-primary' : tasksDone ? 'text-text-tertiary' : 'text-text-secondary')}>
                              {conversation.legacyPlaintext ? <span className="inline-flex shrink-0 text-foreground-icon-tertiary" role="img" title={t('history.readOnlyBadge')} aria-label={t('history.readOnlyBadge')}><RiLockLine className="size-3" aria-hidden="true" /></span> : null}
                              <span className="truncate">{title}</span>
                              {pins.conversation.includes(conversation.id) ? <RiPushpin2Fill className="size-3 shrink-0 text-foreground-icon-tertiary" aria-label={t('sidebar.pinned')} /> : null}
                              {taskMeta ? (
                                <span
                                  aria-label={t('sidebar.taskCount', { count: taskMeta.count })}
                                  className={cx(CHIP, !tasksDone && 'bg-badge-new-background text-badge-new-text')}
                                >
                                  {tasksDone ? t('sidebar.tasksDone') : t('sidebar.tasksPlanning')}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          {rail ? null : (
                            <span className="flex shrink-0 items-center gap-1">
                              {resetAt ? (
                                <TooltipTrigger delay={300}>
                                  <Focusable>
                                    <span
                                      role="img"
                                      tabIndex={-1}
                                      aria-label={t('controls.waitingReset', { time: formatResetInstant(resetAt) })}
                                      className={cx('inline-flex rounded-sm', FOCUS_RING)}
                                    >
                                      <RiTimeLine className="size-3.5 text-status-yellow-text" aria-hidden="true" />
                                    </span>
                                  </Focusable>
                                  <Tooltip placement="top" className="max-w-xs">
                                    {t('controls.waitingReset', { time: formatResetInstant(resetAt) })}
                                  </Tooltip>
                                </TooltipTrigger>
                              ) : null}
                              {conversation.labelColor ? (
                                <span
                                  aria-label={t('sidebar.labelColor')}
                                  className="inline-block size-2 rounded-full"
                                  style={{ backgroundColor: conversation.labelColor }}
                                />
                              ) : null}
                              {running ? <span className={CHIP}>{t('sidebar.running')}</span> : null}
                            </span>
                          )}
                          {running ? <span className="sr-only">{t('sidebar.running')}</span> : null}
                        </RowContent>
                      </GridListItem>
                    );
                  })}
                </GridList>

                {!query && sortedConversations.length > 5 && !rail && (
                  <ListPaging
                    hasMore={sortedConversations.length > conversationLimit}
                    canCollapse={conversationLimit > 5}
                    onMore={() => setConversationLimit((prev) => prev + 5)}
                    onCollapse={() => setConversationLimit(5)}
                  />
                )}
              </>
            )
          )}
        </section>
        )}
      </div>
      )}

      <PointMenu position={contextMenu} onClose={closeContextMenu}>
        {menu?.kind === 'group' ? (
          <Menu aria-label={t('sidebar.groupMenu')} autoFocus="first">
            <MenuItem id="rename-group" icon={RiPencilLine} textValue={t('sidebar.renameGroup')} onAction={() => { if (contextGroup) setRenamingGroup({ id: contextGroup.id, name: contextGroup.name }); setContextMenu(null); }}>{t('sidebar.renameGroup')}</MenuItem>
            <MenuItem id="toggle-group" icon={RiArrowDownSLine} textValue={collapsedGroups.includes(menu.id) ? t('sidebar.unfoldGroup') : t('sidebar.foldGroup')} onAction={() => { toggleGroupCollapsed(menu.id); setContextMenu(null); }}>{collapsedGroups.includes(menu.id) ? t('sidebar.unfoldGroup') : t('sidebar.foldGroup')}</MenuItem>
            <MenuSeparator />
            <MenuItem id="ungroup" icon={RiFoldersLine} tone="danger" textValue={t('sidebar.ungroup')} onAction={() => runGroupLayout(ungroupWorkspaceGroup(workspaceEntries, menu.id))}>{t('sidebar.ungroup')}</MenuItem>
          </Menu>
        ) : menu ? (
          <Menu aria-label={menu.kind === 'workspace' ? t('sidebar.workspaceMenu') : t('sidebar.conversationMenu')} autoFocus="first">
            {menu.kind === 'conversation' && !contextReadOnly ? <MenuItem id="fork" icon={RiGitBranchLine} textValue="Fork" onAction={() => runContextAction('fork')}>Fork</MenuItem> : null}
            {contextReadOnly ? null : <MenuItem id="rename" icon={RiPencilLine} textValue={t('sidebar.rename')} onAction={() => runContextAction('rename')}>{t('sidebar.rename')}</MenuItem>}
            {menu.kind === 'workspace' ? <MenuItem id="edit" icon={RiEdit2Line} textValue={t('sidebar.edit')} onAction={() => runContextAction('edit')}>{t('sidebar.edit')}</MenuItem> : null}
            <MenuItem id="pin" icon={RiPushpin2Fill} textValue={pins[menu.kind].includes(menu.id) ? t('sidebar.unpin') : t('sidebar.pin')} onAction={() => runContextAction('pin')}>{pins[menu.kind].includes(menu.id) ? t('sidebar.unpin') : t('sidebar.pin')}</MenuItem>
            {menu.kind === 'workspace' ? (
              <SubmenuTrigger>
                <MenuItem id="workspace-icon" icon={RiPaletteLine} textValue={t('sidebar.workspaceIcon')} trailing={SUBMENU_CHEVRON}>{t('sidebar.workspaceIcon')}</MenuItem>
                <MenuPopover placement="end top" className="min-w-0">
                  <Dialog aria-label={t('sidebar.workspaceIcon')} className="flex w-52 flex-col gap-2 p-1 outline-none">
                    {menuWorkspace ? (
                      <>
                        <div className="grid grid-cols-5 gap-1">
                          {WORKSPACE_ICON_CHOICES.map(({ key, Icon }) => (
                            <IconAction
                              key={key}
                              size="sm"
                              icon={Icon}
                              aria-label={key}
                              active={(menuWorkspace.icon ?? 'folder') === key}
                              onClick={() => {
                                session.updateWorkspace(menu.id, { icon: key === 'folder' ? undefined : key });
                                setContextMenu(null);
                              }}
                            />
                          ))}
                        </div>
                        <SwatchPicker
                          label={t('sidebar.iconColor')}
                          value={menuWorkspace.iconColor}
                          onChange={(color) => {
                            session.updateWorkspace(menu.id, { iconColor: color });
                            setContextMenu(null);
                          }}
                        />
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-caption-2-medium uppercase text-text-tertiary">{t('sidebar.ringStyle')}</span>
                          <span className="h-px flex-1 bg-separator-border" />
                        </div>
                        <div className="grid grid-cols-5 gap-1">
                          {WORKSPACE_RING_STYLES.map(({ key, labelKey }) => {
                            const active = ringStyleKey(menuWorkspace.ringStyle) === key;
                            return (
                              <button
                                key={key}
                                type="button"
                                aria-label={t(labelKey)}
                                aria-pressed={active}
                                className={cx(
                                  'inline-flex size-7 cursor-pointer items-center justify-center rounded-lg',
                                  'transition-colors duration-150 ease hover:bg-background-secondary-hover active:bg-background-tertiary-default',
                                  FOCUS_RING,
                                  active && 'bg-background-secondary-hover',
                                )}
                                onClick={() => {
                                  session.updateWorkspace(menu.id, { ringStyle: key === 'orbit' ? undefined : key });
                                  setContextMenu(null);
                                }}
                              >
                                <span className="relative flex size-5 items-center justify-center">
                                  <WorkspaceStatusRing kind="working" style={key} label={t(labelKey)} />
                                  <RiFolder3Line aria-hidden className="size-3.5 text-foreground-icon-secondary" />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          className={cx(QUIET_BUTTON, 'justify-start text-body-medium text-text-secondary')}
                          onClick={() => {
                            session.updateWorkspace(menu.id, { icon: undefined, iconColor: undefined, ringStyle: undefined });
                            setContextMenu(null);
                          }}
                        >
                          {t('sidebar.iconReset')}
                        </button>
                      </>
                    ) : null}
                  </Dialog>
                </MenuPopover>
              </SubmenuTrigger>
            ) : null}
            {contextMoveTargets.length > 0 ? (
              <SubmenuTrigger>
                <MenuItem id="move-to-group" icon={RiFolderTransferLine} textValue={t('sidebar.moveToGroup')} trailing={SUBMENU_CHEVRON}>{t('sidebar.moveToGroup')}</MenuItem>
                <MenuPopover placement="end top">
                  <Menu aria-label={t('sidebar.moveToGroup')}>
                    {contextMoveTargets.map((group) => (
                      <MenuItem
                        key={group.id}
                        id={group.id}
                        icon={RiFoldersLine}
                        textValue={group.name || t('sidebar.newGroupName')}
                        onAction={() => runGroupLayout(moveWorkspaceToGroup(workspaceEntries, menu.id, group.id))}
                      >
                        {group.name || t('sidebar.newGroupName')}
                      </MenuItem>
                    ))}
                  </Menu>
                </MenuPopover>
              </SubmenuTrigger>
            ) : null}
            {contextWorkspaceGroupId ? <MenuItem id="remove-from-group" icon={RiFolderReduceLine} textValue={t('sidebar.removeFromGroup')} onAction={() => runGroupLayout(removeWorkspaceFromGroup(workspaceEntries, menu.id))}>{t('sidebar.removeFromGroup')}</MenuItem> : null}
            {menu.kind === 'conversation' ? (
              <SubmenuTrigger>
                <MenuItem id="label-color" icon={RiPriceTag3Line} textValue={t('sidebar.labelColor')} trailing={SUBMENU_CHEVRON}>{t('sidebar.labelColor')}</MenuItem>
                <MenuPopover placement="end top" className="min-w-0">
                  <Dialog aria-label={t('sidebar.labelColor')} className="flex flex-col gap-1 p-1 outline-none">
                    <SwatchPicker
                      label={t('sidebar.labelColor')}
                      value={session.conversations.find((item) => item.id === menu.id)?.labelColor}
                      onChange={(color) => {
                        session.setConversationLabelColor(menu.id, color);
                        setContextMenu(null);
                      }}
                    />
                    <button
                      type="button"
                      className={cx(QUIET_BUTTON, 'justify-start text-body-medium text-text-secondary')}
                      onClick={() => {
                        session.setConversationLabelColor(menu.id, undefined);
                        setContextMenu(null);
                      }}
                    >
                      {t('sidebar.labelClear')}
                    </button>
                  </Dialog>
                </MenuPopover>
              </SubmenuTrigger>
            ) : null}
            <MenuSeparator />
            <MenuItem id="delete" icon={RiDeleteBinLine} tone="danger" textValue={t('common.delete')} onAction={() => runContextAction('delete')}>{t('common.delete')}</MenuItem>
          </Menu>
        ) : <Menu aria-label={t('sidebar.conversationMenu')}>{[]}</Menu>}
      </PointMenu>

      {renamingGroup ? (
        <WorkspaceGroupRenameDialog
          initialName={renamingGroup.name}
          onSubmit={(name) => applyWorkspaceLayout(renameWorkspaceGroup(workspaceEntriesRef.current, renamingGroup.id, name))}
          onClose={() => setRenamingGroup(null)}
        />
      ) : null}
      </>
      )}
    </DashboardSidebar>
  );
}

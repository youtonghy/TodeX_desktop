import { RiPushpin2Fill, RiLockLine, RiAddLine, RiArrowRightSLine, RiCheckLine, RiFolderReduceLine, RiFoldersLine, RiFolderTransferLine, RiPencilLine, RiEdit2Line, RiErrorWarningLine, RiFolder3Line, RiFolderOpenLine, RiGitBranchLine, RiDeleteBinLine, RiArrowDownSLine, RiBarChartBoxLine, RiBookOpenLine, RiBrush3Line, RiKanbanView2, RiMoreLine, RiPaletteLine, RiPriceTag3Line, RiPuzzle2Line, RiSettings3Line, RiTerminalBoxLine, RiTerminalLine, RiTimeLine, RiTimerLine, RiUserSettingsLine, RiVipCrownLine } from '@remixicon/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
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
  type Key,
} from 'react-aria-components';
import { DashboardSidebar, type DashboardNavItem } from '@/components/application/dashboard/dashboard-sidebar';
import { Announcement } from '@/components/base/announcement/announcement';
import { TreeView, TreeViewItem } from '@/components/base/tree-view/tree-view';
import { NotificationCenter, type NotificationCenterItem } from '@/components/application/notification-center/notification-center';
import { markAllNotificationsRead, markNotificationRead, useNotificationFeed } from '../session/notificationFeed';
import { getLocale, translate } from '../i18n';
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
import { ConfirmDialog } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import { useSidebarPins } from '../session/useSidebarPins';
import { useSidebarGroupCollapse } from '../session/useSidebarGroupCollapse';
import { useKanbanTasks } from '../session/kanbanTasks';
import { setFeaturesMoreOpen, useFeatureModes, useFeaturesMoreOpen, type FeatureId } from '../session/featureToggles';
import { BACKEND_LABEL_COLORS, backendLabelColor } from '../session/backendColors';
import type { BackendConnectionProfile } from '../session/backendColors';
import { WORKSPACE_GROUP_FIELD_MAX, groupWorkspaceEntries, moveWorkspaceEntry, moveWorkspaceToGroup, newWorkspaceGroupId, removeWorkspaceFromGroup, renameWorkspaceGroup, ungroupWorkspaceGroup, workspaceLayoutPatches } from '@todex/protocol/todex';
import type { WorkspaceDragSource, WorkspaceDropTarget, WorkspaceRecord, WorkspaceSidebarEntry } from '@todex/protocol/todex';
import { ProviderIcon } from './ProviderIcon';
import { ConversationScheduleIcon } from './ConversationSchedule';
import { ScheduleConversationDialog } from './ScheduleConversationDialog';
import { RenameDialog } from './RenameDialog';
import { WorkspaceHoverTooltip } from './WorkspaceHoverTooltip';
import { AppIcon } from './AppIcon';
import { WORKSPACE_ICON_CHOICES, WORKSPACE_RING_STYLES, WorkspaceStatusRing, ringStyleKey, workspaceIconComponent } from './WorkspaceIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import { connectionStateLabel, conversationDisplayTitle, formatResetInstant, getConversationStatus, healthLabelOf, isConversationHighlighted, isListedConversation, isNoneWorkspaceId, workspaceDisplayName } from '../session/helpers';
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
  /** Creates a conversation in the workspace that sends at `at` (ISO). */
  onCreateScheduledConversation: (workspaceId: string, at: string) => Promise<boolean>;
  onOpenSettings: () => void;
  onOpenCapabilities: () => void;
  onOpenCliManager: () => void;
  onOpenAgentProviders: () => void;
  onOpenCleanup: () => void;
  onOpenUsage: () => void;
  onOpenQuota: () => void;
  onOpenKanban: () => void;
  /** Toggles the SSH view (hosts, keys, SSH terminals, remote files). */
  onOpenTerminal: () => void;
  terminalActive?: boolean;
  /** The task board is showing in the main area. */
  kanbanActive?: boolean;
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

const DOCS_URL = 'https://todex.dev/docs';

/** "5 分钟前" / "2 hours ago"; a minute or less reads as just now. */
function relativeTime(at: number): string {
  const seconds = Math.round((at - Date.now()) / 1000);
  if (seconds > -60) return translate(getLocale(), 'notify.justNow');
  const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const minutes = Math.round(seconds / 60);
  if (minutes > -60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours > -24) return format.format(hours, 'hour');
  return format.format(Math.round(hours / 24), 'day');
}
const DOCS_DISMISSED_KEY = 'todex.sidebar.docsDismissed';

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
  onCreateScheduledConversation,
  onOpenSettings,
  onOpenCapabilities,
  onOpenCliManager,
  onOpenAgentProviders,
  onOpenCleanup,
  onOpenUsage,
  onOpenQuota,
  onOpenKanban,
  onOpenTerminal,
  terminalActive = false,
  kanbanActive = false,
  onSelectConversation,
}: Props) {
  const t = useT();
  const isOpen = mobile || open;
  const { pins, togglePin } = useSidebarPins();
  const features = useFeatureModes();
  const featuresMoreOpen = useFeaturesMoreOpen();
  const allKanbanTasks = useKanbanTasks();
  // A disabled task board leaves no trace in the conversation list either.
  const kanbanTasks = features.kanban === 'off' ? [] : allKanbanTasks;
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

  // Every backend stays connected, so None lists the conversations of all of them.
  const workspaceConversations = useMemo(() => (
    session.conversations.filter(
      (conversation) => conversation.workspaceId === session.activeWorkspaceId && !conversation.archived && isListedConversation(conversation),
    )
  ), [session.activeWorkspaceId, session.conversations]);

  // Workspaces of every configured backend are live and editable here; only
  // those left behind by a removed backend profile render read-only below.
  const ownWorkspaces = useMemo(() => session.workspaces.filter(
    (workspace) => !workspace.backendConnectionId || session.backendConnections.some((profile) => profile.id === workspace.backendConnectionId),
  ), [session.workspaces, session.backendConnections]);

  const foreignWorkspaceGroups = useMemo(() => {
    const groups = new Map<string, { profile: BackendConnectionProfile | undefined; workspaces: WorkspaceRecord[] }>();
    for (const workspace of session.workspaces) {
      const profileId = workspace.backendConnectionId;
      if (!profileId || session.backendConnections.some((profile) => profile.id === profileId)) continue;
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
  }, [session.backendConnections, session.workspaces]);

  // Display names shared by several workspaces; only those rows show the
  // backend dot so same-named workspaces on different backends stay apart.
  const duplicateWorkspaceNames = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const workspace of session.workspaces) {
      const name = workspaceDisplayName(workspace);
      if (seen.has(name)) duplicates.add(name);
      else seen.add(name);
    }
    return duplicates;
  }, [session.workspaces]);

  // Newest conversation update per workspace, for the row tooltip.
  const workspaceLastActivity = useMemo(() => {
    const latest = new Map<string, number>();
    for (const conversation of session.conversations) {
      if (conversation.updatedAt > (latest.get(conversation.workspaceId) ?? 0)) latest.set(conversation.workspaceId, conversation.updatedAt);
    }
    return latest;
  }, [session.conversations]);

  const { collapsedGroups, toggleGroupCollapsed } = useSidebarGroupCollapse();
  const dragSourceRef = useRef<WorkspaceDragSource | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<WorkspaceDropTarget | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<{ id: string; name: string } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'workspace' | 'conversation'; id: string; name: string } | null>(null);
  // Delete asks first; `local` marks a legacy record that is only archived.
  const [deleting, setDeleting] = useState<{ kind: 'workspace' | 'conversation'; id: string; local?: boolean } | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  // Other configured backends that are not connected right now.
  const offlineBackends = session.backendConnections.filter((profile) => (
    profile.id !== session.activeBackendConnectionId && profile.serverUrl.trim()
    && session.backendLinkStatus[profile.id]?.state !== 'open'
  )).length;
  const healthColor = session.connectionState !== 'open'
    ? 'danger'
    : offlineBackends === 0 && session.connectionHealth.latencyMs !== null && session.connectionHealth.latencyMs <= 100
      ? 'success'
      : 'warning';
  // "Backend online · 42 ms" while connected, the connection state otherwise;
  // other backends that are down are counted after it.
  const focusConnectionLabel = session.connectionState === 'open'
    ? healthLabelOf(session.connectionHealth)
    : session.backendStarting
      ? t('conn.backendStarting')
      : connectionStateLabel(session.connectionState);
  const connectionLabel = offlineBackends > 0
    ? `${focusConnectionLabel} · ${t('sidebar.backendsOffline', { n: offlineBackends })}`
    : focusConnectionLabel;

  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [schedulingWorkspaceId, setSchedulingWorkspaceId] = useState<string | null>(null);
  const canSchedule = features.scheduledConversations !== 'off' && session.v2Providers.some((provider) => provider.available && provider.capabilities.scheduledConversations === true);
  // The menu keeps rendering its last target while it animates out.
  const lastContextMenuRef = useRef<ContextMenu>(contextMenu);
  if (contextMenu) lastContextMenuRef.current = contextMenu;
  const menu = contextMenu ?? lastContextMenuRef.current;
  // Notification history (finished conversations, app notices) for the header panel.
  const feed = useNotificationFeed();
  const unreadNotifications = feed.filter((item) => !item.read).length;
  const notificationItems: NotificationCenterItem[] = feed.map((item) => ({
    id: item.id,
    category: item.kind === 'conversation' ? 'mentions' : 'system',
    group: '',
    title: item.title,
    description: item.description,
    timestamp: relativeTime(item.at),
    unread: !item.read,
    status: item.status,
    actions: item.kind === 'conversation' && item.conversationId ? [{ id: 'open', label: t('notify.openConversation') }] : undefined,
  }));
  // The docs card stays closed once dismissed.
  const [docsDismissed, setDocsDismissed] = useState(() => {
    try { return window.localStorage.getItem(DOCS_DISMISSED_KEY) === '1'; } catch { return false; }
  });
  const dismissDocs = () => {
    setDocsDismissed(true);
    try { window.localStorage.setItem(DOCS_DISMISSED_KEY, '1'); } catch { /* the card returns next launch */ }
  };

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

  // Two modes only: the full 260px panel or the 60px icon rail. The rail
  // never widens on hover, focus or an open menu; the app header's toggle
  // (or the rail's search button) switches modes.
  const rail = !isOpen;

  // The rail has no room for the field: collapsing drops the search.
  useEffect(() => {
    if (!rail) return;
    setSearchActive(false);
    setSearchQuery('');
  }, [rail]);

  // Mod+L opens the quick search, expanding a collapsed sidebar for it. It
  // is left to text fields and the terminal, where Ctrl+L clears the screen.
  useAppShortcuts({
    quickSearch: () => {
      // A closed compact-layout drawer is inert; nothing in it can take focus.
      if (asideRef.current?.closest('[inert]')) return;
      if (rail) onOpenChange?.(true);
      setSearchActive(true);
    },
  });

  const shellClassName = cx(
    'relative',
    !mobile && 'transition-[width,padding] duration-300 ease-in-out motion-reduce:transition-none',
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
      if (!conversation.workspaceId || conversation.archived || !isListedConversation(conversation)) continue;
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
  // The built-in None workspace always leads the list.
  const sortedWorkspaces = useMemo(() => [...ownWorkspaces].sort((a, b) => Number(isNoneWorkspaceId(b.id)) - Number(isNoneWorkspaceId(a.id)) || Number(pins.workspace.includes(b.id)) - Number(pins.workspace.includes(a.id)) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id)), [ownWorkspaces, pins.workspace]);

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

  // The built-in None workspace keeps only pin and icon actions.
  const contextIsNone = menu?.kind === 'workspace' && isNoneWorkspaceId(menu.id);
  // Legacy plaintext history is read-only: no rename or fork.
  const contextReadOnly = menu?.kind === 'conversation'
    && session.conversations.find((item) => item.id === menu.id)?.legacyPlaintext === true;
  const runContextAction = (action: 'rename' | 'edit' | 'fork' | 'pin' | 'delete' | 'schedule') => {
    if (!menu || menu.kind === 'group') return;
    if (action === 'schedule') {
      setSchedulingWorkspaceId(menu.id);
      setContextMenu(null);
      return;
    }
    if (action === 'pin') {
      togglePin(menu.kind, menu.id);
      setContextMenu(null);
      return;
    }
    if (menu.kind === 'workspace') {
      const workspace = session.workspaces.find((item) => item.id === menu.id);
      if (!workspace) return;
      if (action === 'rename') setRenaming({ kind: 'workspace', id: workspace.id, name: workspace.name });
      else if (action === 'edit') onEditWorkspace(workspace.id);
      else if (action === 'delete') setDeleting({ kind: 'workspace', id: workspace.id });
    } else {
      const conversation = session.conversations.find((item) => item.id === menu.id);
      if (!conversation) return;
      if (action === 'rename') setRenaming({ kind: 'conversation', id: conversation.id, name: conversationDisplayTitle(conversation, session.timeline) });
      else if (action === 'fork') session.forkConversation(conversation.id);
      else if (action === 'delete') setDeleting({ kind: 'conversation', id: conversation.id, local: !conversation.v2ConversationId });
    }
    setContextMenu(null);
  };

  const confirmDelete = async () => {
    if (!deleting || deletePending) return;
    if (deleting.kind === 'workspace') {
      session.removeWorkspace(deleting.id);
      setDeleting(null);
      return;
    }
    setDeletePending(true);
    try {
      const outcome = await session.deleteConversation(deleting.id);
      if (outcome.status === 'skipped') {
        toast.warning(outcome.code === 'CONFLICT' ? t('sidebar.deleteRunning') : outcome.message || t('sidebar.deleteFailed'));
      }
      setDeleting(null);
    } catch (error) {
      toast.danger(t('sidebar.deleteFailed'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setDeletePending(false);
    }
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
    const showBackend = duplicateWorkspaceNames.has(workspaceDisplayName(workspace));
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
        data-workspace-drag={isNoneWorkspaceId(workspace.id) ? undefined : `workspace:${workspace.id}`}
        data-workspace-in-group={group ? 'true' : undefined}
        onContextMenu={(event) => openContextMenu(event, 'workspace', workspace.id)}
      >
        <RowContent rail={rail} indent={Boolean(group)}>
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
          {rail || !showBackend ? null : (
            <span role="img" aria-label={backendLabel} className="ms-auto flex size-6 shrink-0 items-center justify-center">
              <span aria-hidden="true" className="size-2.5 rounded-full ring-1 ring-separator-border" style={{ backgroundColor: backendLabelColor(backend) }} />
            </span>
          )}
        </RowContent>
      </GridListItem>
    );
  };

  const workspaceTooltipContent = (workspaceId: string): ReactNode => {
    const workspace = session.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return null;
    const backend = session.backendConnections.find((profile) => profile.id === (workspace.backendConnectionId || session.activeBackendConnectionId));
    const lastActivity = workspaceLastActivity.get(workspace.id) ?? workspace.updatedAt;
    return (
      <span className="flex flex-col gap-1">
        <bdi className="text-caption-1-semibold">{workspaceDisplayName(workspace)}</bdi>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
          <dt className="text-text-tertiary">{t('sidebar.workspaceTipBackend')}</dt>
          <dd className="break-words">{backend ? backend.name : t('sidebar.backendRemoved')}</dd>
          <dt className="text-text-tertiary">{t('sidebar.workspaceTipPath')}</dt>
          <dd className="break-all"><span dir="ltr">{workspace.path || '—'}</span></dd>
          <dt className="text-text-tertiary">{t('sidebar.workspaceTipActivity')}</dt>
          <dd>{lastActivity ? relativeTime(lastActivity) : '—'}</dd>
        </dl>
        {workspace.pathMissing ? <span className="text-status-yellow-text">{t('sidebar.workspaceMissingPath')}</span> : null}
      </span>
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

  // Expanded sidebar: the workspace list is a BoardUI tree. Groups are
  // branches (folder, chevron, guides) holding their workspaces; lone
  // workspaces are root leaves. The icon rail keeps the flat grid list.
  const workspaceTreeItem = (workspace: WorkspaceRecord, group: { entry: WorkspaceGroupEntry; last: boolean } | null): ReactNode => {
    const isSelected = workspace.id === session.activeWorkspaceId;
    const drop = dropTarget?.kind === 'workspace' && dropTarget.id === workspace.id
      ? dropTarget.position
      : group?.last && dropTarget?.kind === 'group' && dropTarget.id === group.entry.id && dropTarget.position === 'after'
        ? 'after' as const
        : null;
    const isMissing = Boolean(workspace.pathMissing);
    const backend = session.backendConnections.find((profile) => profile.id === (workspace.backendConnectionId || session.activeBackendConnectionId));
    const backendLabel = backend ? t('sidebar.backendLabel', { name: backend.name, url: backend.serverUrl }) : t('sidebar.backendRemoved');
    const showBackend = duplicateWorkspaceNames.has(workspaceDisplayName(workspace));
    const workspaceStatus = workspaceStatusMap[workspace.id];
    const WorkspaceGlyph = workspaceIconComponent(workspace.icon);
    return (
      <TreeViewItem
        key={workspace.id}
        id={workspace.id}
        label={workspaceDisplayName(workspace)}
        className={({ isHovered, isPressed }) => cx(
          // The sidebar's row fills: the tree's menu fill matches this surface.
          isSelected ? 'bg-background-secondary-hover' : isPressed ? 'bg-background-tertiary-default' : isHovered ? 'bg-background-secondary-hover' : 'bg-transparent',
          isSelected ? 'text-text-primary' : isMissing ? 'cursor-not-allowed text-text-tertiary opacity-50' : 'text-text-secondary',
          'text-body-medium',
          drop && DROP_CLASS[drop],
          draggingKey === `workspace:${workspace.id}` && 'opacity-40',
        )}
        data-workspace-id={workspace.id}
        data-workspace-drag={isNoneWorkspaceId(workspace.id) ? undefined : `workspace:${workspace.id}`}
        data-workspace-in-group={group ? 'true' : undefined}
        onContextMenu={(event) => openContextMenu(event, 'workspace', workspace.id)}
        leading={(
          <span className="relative flex size-5 shrink-0 items-center justify-center">
            {workspaceStatus ? (
              <WorkspaceStatusRing
                kind={workspaceStatus}
                style={workspace.ringStyle}
                label={workspaceStatus === 'working' ? t('sidebar.statusWorking') : workspaceStatus === 'issue' ? t('sidebar.statusIssue') : t('sidebar.statusUnread')}
              />
            ) : null}
            <WorkspaceGlyph
              className={cx('size-4', !workspace.iconColor && (isSelected ? 'text-foreground-icon-primary' : 'text-foreground-icon-secondary'))}
              color={workspace.iconColor}
            />
          </span>
        )}
        trailingContent={(
          <span className="flex items-center gap-1">
            {pins.workspace.includes(workspace.id) ? <RiPushpin2Fill className="size-3 shrink-0 text-foreground-icon-tertiary" aria-label={t('sidebar.pinned')} /> : null}
            {isMissing ? <RiErrorWarningLine className="size-3 shrink-0 text-status-yellow-text" aria-label={t('sidebar.workspaceMissingPath')} /> : null}
            {showBackend ? (
              <span role="img" aria-label={backendLabel} className="flex size-6 shrink-0 items-center justify-center">
                <span aria-hidden="true" className="size-2.5 rounded-full ring-1 ring-separator-border" style={{ backgroundColor: backendLabelColor(backend) }} />
              </span>
            ) : null}
          </span>
        )}
      />
    );
  };

  const groupTreeItem = (entry: WorkspaceGroupEntry): ReactNode => {
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
    return (
      <TreeViewItem
        key={`group:${entry.id}`}
        id={`group:${entry.id}`}
        label={name}
        icon={RiFolder3Line}
        expandedIcon={RiFolderOpenLine}
        className={({ isHovered, isPressed }) => cx(
          isPressed ? 'bg-background-tertiary-default' : isHovered ? 'bg-background-secondary-hover' : 'bg-transparent',
          'text-body-semibold',
          folded && containsSelected ? 'text-text-primary' : 'text-text-secondary',
          drop && DROP_CLASS[drop],
          draggingKey === `group:${entry.id}` && 'opacity-40',
        )}
        data-workspace-drag={`group:${entry.id}`}
        onContextMenu={(event) => openContextMenu(event, 'group', entry.id)}
        trailingContent={(
          <span className="flex items-center gap-1.5 pe-1">
            {folded && statuses.length > 0 ? (
              <span className="flex items-center gap-1" aria-hidden="true">
                {statuses.map((status, index) => <span key={index} className={cx('size-1.5 rounded-full', STATUS_DOT_CLASS[status])} />)}
              </span>
            ) : null}
            <span className="tabular-nums">{entry.workspaces.length}</span>
          </span>
        )}
      >
        {entry.workspaces.map((workspace, index) => workspaceTreeItem(workspace, { entry, last: index === entry.workspaces.length - 1 }))}
      </TreeViewItem>
    );
  };

  const expandedGroupKeys = new Set<Key>(displayedEntries
    .filter((entry): entry is WorkspaceGroupEntry => entry.kind === 'group' && !isGroupFolded(entry.id))
    .map((entry) => `group:${entry.id}`));

  // Cached data renders immediately; the directory sync only blocks an
  // entirely empty sidebar (first run or cleared storage).
  const syncing = session.directorySyncStatus === 'loading' && session.workspaces.length === 0;

  const newConversationItems: DashboardNavItem[] = [
    {
      key: 'new-conversation',
      label: t('sidebar.newConversation'),
      icon: RiAddLine,
      disabled: !session.activeWorkspaceId,
      onClick: onCreateConversation,
      hint: <ShortcutHint id="newConversation" />,
    },
  ];
  // Optional features: shown in the nav, folded under "More", or off.
  const featureItems: Array<DashboardNavItem & { feature: FeatureId }> = [
    {
      feature: 'scheduledConversations',
      key: 'new-scheduled-conversation',
      label: t('schedule.create'),
      icon: RiTimerLine,
      disabled: !session.activeWorkspaceId || !canSchedule,
      onClick: () => setSchedulingWorkspaceId(session.activeWorkspaceId),
    },
    {
      feature: 'terminal',
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
      feature: 'kanban',
      key: 'kanban',
      label: t('sidebar.kanban'),
      icon: RiKanbanView2,
      isSelected: kanbanActive,
      toggle: true,
      onClick: () => {
        if (mobile) onCloseMobile?.();
        onOpenKanban();
      },
      hint: <ShortcutHint id="kanban" />,
    },
  ];
  const foldedItems = featureItems.filter((item) => features[item.feature] === 'folded');
  const moreStandsIn = !featuresMoreOpen && foldedItems.some((item) => item.isSelected);
  const primaryItems: DashboardNavItem[] = [
    ...newConversationItems,
    ...featureItems.filter((item) => features[item.feature] === 'shown'),
    ...(foldedItems.length > 0 ? [
      {
        key: 'more-features',
        label: t('sidebar.moreFeatures'),
        icon: RiMoreLine,
        // A collapsed "More" stands in for the open folded feature it hides.
        isSelected: moreStandsIn,
        expanded: featuresMoreOpen,
        onClick: () => setFeaturesMoreOpen(!featuresMoreOpen),
        hint: <RiArrowDownSLine aria-hidden className={cx('size-4 transition-transform duration-200 ease', moreStandsIn ? 'text-text-white' : 'text-foreground-icon-tertiary', !featuresMoreOpen && '-rotate-90 rtl:rotate-90')} />,
      },
      ...(featuresMoreOpen ? foldedItems : []),
    ] : []),
  ];

  const secondaryItems: DashboardNavItem[] = [
    { key: 'settings', label: t('app.settings'), icon: RiSettings3Line, isSelected: false, onClick: onOpenSettings },
  ];

  // The TodeX menu (formerly the identity menu), grouped: management, then
  // usage. Settings (with About) sits right above it as its own row.
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
        {
          id: 'cleanup',
          icon: RiBrush3Line,
          label: t('app.cleanup'),
          onSelect: () => {
            if (mobile) onCloseMobile?.();
            onOpenCleanup();
          },
        },
      ],
    },
    {
      id: 'usage',
      items: [
        { id: 'usage', icon: RiBarChartBoxLine, label: t('app.usage'), onSelect: onOpenUsage },
        { id: 'quota', icon: RiVipCrownLine, label: t('usage.quotaTitle'), onSelect: onOpenQuota },
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
      ref={asideRef}
      data-state={rail ? 'collapsed' : 'expanded'}
      className={shellClassName}
      mobile={mobile}
      flat={mobile}
      onClose={onCloseMobile}
      closeLabel={t('sidebar.closeSidebar')}
      collapsed={rail}
      onCollapsedChange={(collapsed) => onOpenChange?.(!collapsed)}
      // The app header's sidebar toggle is the only collapse control.
      collapseButton={false}
      chrome={chromeStrip}
      header={({ collapsed, suppressHover, onHoverSuppressionEnd }) => (
        <DashboardUserMenu
          collapsed={collapsed}
          suppressHover={suppressHover}
          onHoverSuppressionEnd={onHoverSuppressionEnd}
          avatar={identityMark}
          name="TodeX"
          badge={(
            <span className="flex items-center gap-1.5">
              <Chip variant="caption" color="neutral" className="py-0.5">V2</Chip>
              {unreadNotifications ? <span aria-label={t('notify.unreadCount', { count: unreadNotifications })} className="size-2 rounded-full bg-accent-500" /> : null}
            </span>
          )}
          aria-label={`TodeX · ${connectionLabel}`}
          menuLabel={t('notify.center')}
          panelClassName="w-[400px] p-0 rounded-3xl border-0 bg-transparent shadow-none"
        >
          {(close) => (
            <NotificationCenter
              className="max-w-none"
              title={t('notify.center')}
              emptyMessage={t('notify.empty')}
              notifications={notificationItems}
              labels={{
                tabs: { all: t('notify.tabAll'), mentions: t('notify.tabConversations'), system: t('notify.tabSystem') },
                unread: (count) => t('notify.unreadCount', { count }),
                noUnread: t('notify.noUnread'),
                markAllRead: t('notify.markAllRead'),
                emptyHint: t('notify.emptyHint'),
                unreadDot: t('notify.unread'),
                category: t('notify.category'),
              }}
              onMarkAllRead={markAllNotificationsRead}
              onItemRead={markNotificationRead}
              onAction={(id) => {
                const item = feed.find((entry) => entry.id === id);
                if (!item?.workspaceId || !item.conversationId) return;
                close();
                if (mobile) onCloseMobile?.();
                session.selectConversation(item.workspaceId, item.conversationId);
                onSelectConversation?.();
              }}
            />
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
      announcement={docsDismissed ? null : (
        <Announcement
          icon={RiBookOpenLine}
          title={t('sidebar.docsTitle')}
          description={t('sidebar.docsDescription')}
          actionLabel={t('sidebar.docsAction')}
          onAction={() => window.open(DOCS_URL, '_blank', 'noopener')}
          dismissible
          closeLabel={t('common.dismiss')}
          onClose={dismissDocs}
        />
      )}
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
                  <WorkspaceHoverTooltip disabled={Boolean(draggingKey) || Boolean(contextMenu)} renderContent={workspaceTooltipContent}>
                  {rail ? (
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
                  ) : (
                    <TreeView
                      key={`workspaces_${workspaceLimit}`}
                      aria-label={t('sidebar.workspaces')}
                      className="rounded-none border-0 bg-transparent p-0"
                      selectionMode="single"
                      selectionBehavior="replace"
                      selectedKeys={session.activeWorkspaceId ? [session.activeWorkspaceId] : []}
                      expandedKeys={expandedGroupKeys}
                      onExpandedChange={(keys) => {
                        for (const entry of displayedEntries) {
                          if (entry.kind !== 'group') continue;
                          const key = `group:${entry.id}`;
                          if (keys.has(key) !== expandedGroupKeys.has(key)) toggleGroupCollapsed(entry.id);
                        }
                      }}
                      onSelectionChange={(keys) => {
                        const key = keys === 'all' ? '' : String([...keys][0] ?? '');
                        if (!key) return;
                        // A group row folds or unfolds; it is never selected.
                        if (key.startsWith('group:')) {
                          toggleGroupCollapsed(key.slice('group:'.length));
                          return;
                        }
                        if (session.workspaces.find((item) => item.id === key)?.pathMissing) return;
                        session.selectWorkspace(key);
                      }}
                    >
                      {displayedEntries.map((entry) => (entry.kind === 'group'
                        ? groupTreeItem(entry)
                        : workspaceTreeItem(entry.workspace, null)))}
                    </TreeView>
                  )}
                  </WorkspaceHoverTooltip>

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
                              {conversation.schedule ? <ConversationScheduleIcon schedule={conversation.schedule} /> : null}
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

      <ScheduleConversationDialog
        isOpen={schedulingWorkspaceId !== null}
        mode="create"
        onConfirm={(at) => (schedulingWorkspaceId ? onCreateScheduledConversation(schedulingWorkspaceId, at) : Promise.resolve(false))}
        onClose={() => setSchedulingWorkspaceId(null)}
      />
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
            {contextReadOnly || contextIsNone ? null : <MenuItem id="rename" icon={RiPencilLine} textValue={t('sidebar.rename')} onAction={() => runContextAction('rename')}>{t('sidebar.rename')}</MenuItem>}
            {menu.kind === 'workspace' && canSchedule ? <MenuItem id="schedule" icon={RiTimerLine} textValue={t('schedule.create')} onAction={() => runContextAction('schedule')}>{t('schedule.create')}</MenuItem> : null}
            {menu.kind === 'workspace' && !contextIsNone ? <MenuItem id="edit" icon={RiEdit2Line} textValue={t('sidebar.edit')} onAction={() => runContextAction('edit')}>{t('sidebar.edit')}</MenuItem> : null}
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
            {contextMoveTargets.length > 0 && !contextIsNone ? (
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
            {contextIsNone ? null : (
              <>
                <MenuSeparator />
                <MenuItem id="delete" icon={RiDeleteBinLine} tone="danger" textValue={t('common.delete')} onAction={() => runContextAction('delete')}>{t('common.delete')}</MenuItem>
              </>
            )}
          </Menu>
        ) : <Menu aria-label={t('sidebar.conversationMenu')}>{[]}</Menu>}
      </PointMenu>

      {renamingGroup ? (
        <RenameDialog
          title={t('sidebar.renameGroup')}
          label={t('sidebar.groupNameLabel')}
          maxLength={WORKSPACE_GROUP_FIELD_MAX}
          initialName={renamingGroup.name}
          onSubmit={(name) => applyWorkspaceLayout(renameWorkspaceGroup(workspaceEntriesRef.current, renamingGroup.id, name))}
          onClose={() => setRenamingGroup(null)}
        />
      ) : null}
      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(open) => { if (!open && !deletePending) setDeleting(null); }}
        title={deleting?.kind === 'workspace' ? t('sidebar.deleteWorkspaceTitle') : t('sidebar.deleteConversationTitle')}
        description={deleting?.kind === 'workspace'
          ? t('sidebar.deleteWorkspaceBody')
          : deleting?.local ? t('sidebar.deleteLocalConversationBody') : t('sidebar.deleteConversationBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        isPending={deletePending}
        onConfirm={() => { void confirmDelete(); }}
      />
      {renaming ? (
        <RenameDialog
          key={`${renaming.kind}:${renaming.id}`}
          title={renaming.kind === 'workspace' ? t('sidebar.renameWorkspace') : t('sidebar.renameConversation')}
          label={renaming.kind === 'workspace' ? t('sidebar.renameWorkspacePrompt') : t('sidebar.renameConversationPrompt')}
          initialName={renaming.name}
          onSubmit={(name) => {
            if (renaming.kind === 'workspace') session.renameWorkspace(renaming.id, name);
            else session.renameConversation(renaming.id, name);
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      </>
      )}
    </DashboardSidebar>
  );
}

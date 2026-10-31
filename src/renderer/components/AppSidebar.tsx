import { RiPushpin2Fill, RiLockLine, RiSpyLine, RiAddLine, RiArrowRightSLine, RiCheckLine, RiFolderReduceLine, RiFoldersLine, RiFolderTransferLine, RiPencilLine, RiEdit2Line, RiErrorWarningLine, RiFolder3Line, RiFolderOpenLine, RiGitBranchLine, RiDeleteBinLine, RiArrowDownSLine, RiBookOpenLine, RiKanbanView2, RiMoreLine, RiPaletteLine, RiPriceTag3Line, RiSettings3Line, RiTerminalLine, RiTimeLine, RiTimerLine } from '@remixicon/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import {
  Button as AriaButton,
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
import { DashboardTeamMenu } from '@/components/application/dashboard/dashboard-team-menu';
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
import { searchConversations } from '../session/conversationSearch';
import { useSidebarGroupCollapse } from '../session/useSidebarGroupCollapse';
import { useSidebarLayout, useSidebarWorkspaceExpansion } from '../session/sidebarLayout';
import { platform } from '../platform';
import { sameRecordValues, useRuntimeSelector, useTimelineSelector } from '../session/conversationStore';
import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';
import { useKanbanTasks } from '../session/kanbanTasks';
import { setFeaturesMoreOpen, useFeatureModes, useFeaturesMoreOpen, type FeatureId } from '../session/featureToggles';
import { BACKEND_LABEL_COLORS, backendLabelColor } from '../session/backendColors';
import type { BackendConnectionProfile } from '../session/backendColors';
import { WORKSPACE_GROUP_FIELD_MAX, collectWorkspaceTags, groupWorkspaceEntries, groupWorkspaceEntriesByTag, moveWorkspaceEntry, moveWorkspaceToGroup, newWorkspaceGroupId, normalizeWorkspaceTags, removeWorkspaceFromGroup, renameWorkspaceGroup, setWorkspaceGroupTags, ungroupWorkspaceGroup, workspaceLayoutPatches } from '@todex/protocol/todex';
import type { WorkspaceDragSource, WorkspaceDropTarget, WorkspaceRecord, WorkspaceSidebarEntry, WorkspaceTagSection } from '@todex/protocol/todex';
import { ProviderIcon } from './ProviderIcon';
import { ConversationScheduleIcon } from './ConversationSchedule';
import { ScheduleConversationDialog } from './ScheduleConversationDialog';
import { RenameDialog } from './RenameDialog';
import { WorkspaceTagsDialog } from './WorkspaceTagsDialog';
import { WorkspaceHoverTooltip } from './WorkspaceHoverTooltip';
import { AppIcon } from './AppIcon';
import { WORKSPACE_ICON_CHOICES, WORKSPACE_RING_STYLES, WorkspaceStatusRing, ringStyleKey, workspaceIconComponent } from './WorkspaceIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import type { ProviderKind } from '@todex/protocol/v2';
import { connectionStateLabel, conversationDisplayTitle, isReadOnlyConversation, isPrivateConversation, formatResetInstant, getConversationStatus, healthLabelOf, isConversationHighlighted, isListedConversation, isNoneWorkspaceId, NONE_WORKSPACE_ID, noneWorkspaceRowBackendId, noneWorkspaceRowId, workspaceDisplayName, type TimelineEntry } from '../session/helpers';
import { ownerBackendId } from '../session/backendRouting';
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
  /** Creates a conversation in the active workspace, or in `workspaceId`
   * (on `backendConnectionId`, for a None row) when given. */
  onCreateConversation: (workspaceId?: string, options?: { backendConnectionId?: string }) => void;
  /** Creates a conversation in the workspace that sends at `at` (ISO), on
   * the picked agent (the default one when absent). */
  onCreateScheduledConversation: (workspaceId: string, at: string, options: { provider?: ProviderKind }) => Promise<boolean>;
  /** Opens the private (RAM-only) conversation dialog for the active workspace. */
  onCreatePrivateConversation: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onOpenKanban: () => void;
  /** Toggles the SSH view (hosts, keys, SSH terminals, remote files). */
  onOpenTerminal: () => void;
  terminalActive?: boolean;
  /** The task board is showing in the main area. */
  kanbanActive?: boolean;
  profileActive?: boolean;
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
function SectionHeader({ label, count, collapsed, expandLabel, collapseLabel, onToggle, addLabel, addDisabled, onAdd, hint, actions }: {
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
  /** Extra header actions before the add button. */
  actions?: ReactNode;
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
      {actions}
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

/** A quick-search content excerpt with the matched text (`query`, already
 * lowercased) brought forward. */
function SearchSnippet({ snippet, query }: { snippet: string; query: string }) {
  const at = snippet.toLocaleLowerCase().indexOf(query);
  return (
    <span className="truncate text-caption-1-regular text-text-tertiary">
      {at < 0 ? snippet : (
        <>
          {snippet.slice(0, at)}
          <span className="text-text-primary">{snippet.slice(at, at + query.length)}</span>
          {snippet.slice(at + query.length)}
        </>
      )}
    </span>
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

/** Whether a sidebar workspace row is one of the per-backend None rows. */
function isNoneRowId(rowId: string): boolean {
  return noneWorkspaceRowBackendId(rowId) !== null;
}

/** Several None rows form this built-in group, which cannot be renamed,
 * ungrouped, dragged or joined. */
const NONE_GROUP_ID = NONE_WORKSPACE_ID;

/** Tag-view row keys: a workspace or group can sit under several tags, so its
 * key is prefixed by the tag section's key. */
const SCOPE_SEPARATOR = '\u0001';
function scopedKey(scope: string | undefined, key: string): string {
  return scope ? `${scope}${SCOPE_SEPARATOR}${key}` : key;
}
/** The workspace id or `group:<id>` behind a (possibly scoped) row key. */
function unscopedKey(key: string): string {
  return key.slice(key.lastIndexOf(SCOPE_SEPARATOR) + 1);
}
/** Fold-state id and tree key of a tag section header. */
function tagSectionKey(section: WorkspaceTagSection): string {
  return `tag:${section.key}`;
}
function isTagSectionKey(key: string): boolean {
  return key.startsWith('tag:') && !key.includes(SCOPE_SEPARATOR);
}
const WORKSPACE_VIEW_KEY = 'todex.sidebar.workspaceView';

/** The None rows (alone or as their built-in group) stay out of tag sections. */
function isNoneEntry(entry: WorkspaceSidebarEntry): boolean {
  return entry.kind === 'group' ? entry.id === NONE_GROUP_ID : isNoneRowId(entry.workspace.id);
}

/** A tag section's distinct workspaces in order, groups flattened (the rail). */
function tagSectionWorkspaces(section: WorkspaceTagSection): WorkspaceRecord[] {
  const seen = new Set<string>();
  return section.entries
    .flatMap((entry) => (entry.kind === 'group' ? entry.workspaces : [entry.workspace]))
    .filter((workspace) => !seen.has(workspace.id) && Boolean(seen.add(workspace.id)));
}

/** The workspace record behind a sidebar row (None rows share one). */
function workspaceIdOfRow(rowId: string): string {
  return isNoneRowId(rowId) ? NONE_WORKSPACE_ID : rowId;
}

type TimelineInfo = { latestAt: number; latestEntry?: TimelineEntry; latestIncomingAt: number; firstPrompt: string; firstPromptAt: number };
const NO_ROWS: TimelineEntry[] = [];

/** Equal when every conversation's status inputs and title fallback are. */
function sameTimelineInfo(left: Record<string, TimelineInfo>, right: Record<string, TimelineInfo>): boolean {
  return sameRecordValues(left, right, (a, b) => a.latestAt === b.latestAt && a.latestIncomingAt === b.latestIncomingAt
    && a.firstPrompt === b.firstPrompt && a.latestEntry?.id === b.latestEntry?.id && a.latestEntry?.kind === b.latestEntry?.kind
    && a.latestEntry?.marker === b.latestEntry?.marker && a.latestEntry?.title === b.latestEntry?.title);
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
  onCreateScheduledConversation,
  onCreatePrivateConversation,
  onOpenSettings,
  onOpenProfile,
  onOpenKanban,
  onOpenTerminal,
  terminalActive = false,
  kanbanActive = false,
  profileActive = false,
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
  const insetChrome = platform.windowChrome === 'hidden-inset';

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

  // None is listed once per backend: its row id names the backend, and each
  // row holds only that backend's None conversations (an untagged draft
  // belongs to the None in view).
  const activeRowId = isNoneWorkspaceId(session.activeWorkspaceId) ? noneWorkspaceRowId(session.noWorkspaceBackendId) : session.activeWorkspaceId;
  const rowIdOf = useCallback((conversation: TodeXSession['conversations'][number]) => (
    isNoneWorkspaceId(conversation.workspaceId)
      ? noneWorkspaceRowId(ownerBackendId(conversation, null, session.noWorkspaceBackendId))
      : conversation.workspaceId
  ), [session.noWorkspaceBackendId]);
  const workspaceConversations = useMemo(() => (
    session.conversations.filter(
      (conversation) => rowIdOf(conversation) === activeRowId && !conversation.archived && isListedConversation(conversation),
    )
  ), [activeRowId, rowIdOf, session.conversations]);

  // Containers get no None row unless they already hold None conversations.
  const containerProfileIds = platform.containers.useProfileIds();
  const noneBackendsInUse = useMemo(() => new Set(session.conversations
    .filter((conversation) => isNoneWorkspaceId(conversation.workspaceId) && !conversation.archived && isListedConversation(conversation))
    .map((conversation) => ownerBackendId(conversation, null, session.noWorkspaceBackendId))), [session.conversations, session.noWorkspaceBackendId]);

  // Workspaces of every configured backend are live and editable here; only
  // those left behind by a removed backend profile render read-only below.
  // None becomes one row per backend, in the order they were added; several
  // of them form the built-in None group, each row named by its backend.
  const ownWorkspaces = useMemo(() => {
    // A disabled profile's backend is listed under the profile serving it.
    const enabled = session.backendConnections.filter((profile) => !profile.disabled);
    // Row ids are collection keys: a workspace id listed twice (two
    // profiles of one daemon) keeps its first record rather than crash.
    const seen = new Set<string>();
    const listed = session.workspaces.filter((workspace) => !isNoneWorkspaceId(workspace.id) && (
      !workspace.backendConnectionId || enabled.some((profile) => profile.id === workspace.backendConnectionId)
    ) && !seen.has(workspace.id) && Boolean(seen.add(workspace.id)));
    const none = session.workspaces.find((workspace) => isNoneWorkspaceId(workspace.id));
    if (!none) return listed;
    const profiles = enabled
      .filter((profile) => !platform.containers.isContainerProfile(profile, containerProfileIds) || noneBackendsInUse.has(profile.id))
      .sort((a, b) => a.createdAt - b.createdAt);
    const grouped = profiles.length > 1;
    const rows = profiles.map((profile, index): WorkspaceRecord => ({
      ...none,
      id: noneWorkspaceRowId(profile.id),
      name: grouped ? profile.name : t('sidebar.noWorkspace'),
      groupId: grouped ? NONE_GROUP_ID : undefined,
      groupName: grouped ? t('sidebar.noWorkspace') : undefined,
      backendConnectionId: profile.id,
      sortOrder: index,
    }));
    return [...rows, ...listed];
  }, [session.workspaces, session.backendConnections, containerProfileIds, noneBackendsInUse, t]);
  const openWorkspaceRow = (rowId: string) => {
    const noneBackendId = noneWorkspaceRowBackendId(rowId);
    if (noneBackendId === null) session.selectWorkspace(rowId);
    else session.selectWorkspace(NONE_WORKSPACE_ID, noneBackendId || undefined);
  };
  const rowById = useMemo(() => new Map(ownWorkspaces.map((workspace) => [workspace.id, workspace])), [ownWorkspaces]);
  const splitNone = ownWorkspaces.filter((workspace) => isNoneRowId(workspace.id)).length > 1;

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
      const rowId = rowIdOf(conversation);
      if (conversation.updatedAt > (latest.get(rowId) ?? 0)) latest.set(rowId, conversation.updatedAt);
    }
    return latest;
  }, [session.conversations, rowIdOf]);

  const { collapsedGroups, toggleGroupCollapsed } = useSidebarGroupCollapse();
  const dragSourceRef = useRef<WorkspaceDragSource | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<WorkspaceDropTarget | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<{ id: string; name: string } | null>(null);
  const [editingTags, setEditingTags] = useState<{ kind: 'workspace' | 'group'; id: string; tags: string[] } | null>(null);
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
  const schedulingAgents = useMemo(
    () => (schedulingWorkspaceId ? session.scheduledConversationAgents(schedulingWorkspaceId) : undefined),
    // Re-read when the agent catalogs change while the dialog is open.
    [schedulingWorkspaceId, session.scheduledConversationAgents, session.v2Providers],
  );
  // Private conversations need a real workspace and an agent able to keep
  // one; a backend without any is too old for them.
  const privateUnavailable = !session.activeWorkspaceId ? t('private.pickWorkspace')
    : isNoneWorkspaceId(session.activeWorkspaceId) ? t('private.needsWorkspace')
      : !session.v2Providers.some((provider) => provider.available && provider.capabilities.privateConversations) ? t('private.backendUnsupportedHint')
        : '';
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
  }, [activeRowId]);

  // Two modes only: the full 260px panel or the 60px icon rail. The rail
  // never widens on hover, focus or an open menu; the app header's toggle
  // (or the rail's search button) switches modes.
  const rail = !isOpen;

  // Unified layout: the workspace tree unfolds each workspace into its own
  // conversations, paged like the split list. The icon rail and search
  // results keep the split sections.
  const unifiedLayout = useSidebarLayout() === 'unified';
  const nested = unifiedLayout && !rail && !query;
  const { expandedWorkspaces, toggleWorkspaceExpanded, expandWorkspace } = useSidebarWorkspaceExpansion();
  const [rowConversationLimits, setRowConversationLimits] = useState<Record<string, number>>({});
  // The workspace in use opens: on entering the layout, and when a
  // conversation elsewhere is picked. Folding it afterwards is left alone.
  useEffect(() => {
    if (unifiedLayout && activeRowId) expandWorkspace(activeRowId);
  }, [unifiedLayout, activeRowId, expandWorkspace]);

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

  // Per conversation: its latest row and reply time, and its first prompt
  // (title fallback). Taken from the session stores, and kept while what the
  // rows show does not change, so a streamed delta into an existing row does
  // not re-render the sidebar.
  const timelineInfoMap = useTimelineSelector(session.stores, (timeline) => {
    const map: Record<string, TimelineInfo> = {};
    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i];
      if (!entry?.conversationId || !entry?.at) continue;
      const existing = map[entry.conversationId] ??= { latestAt: 0, latestIncomingAt: 0, firstPrompt: '', firstPromptAt: Infinity };
      if (entry.at > existing.latestAt) {
        existing.latestAt = entry.at;
        existing.latestEntry = entry;
      }
      if (entry.kind === 'incoming' && entry.at > existing.latestIncomingAt) {
        existing.latestIncomingAt = entry.at;
      }
      if (entry.kind === 'outgoing' && entry.at < existing.firstPromptAt && entry.subtitle.trim()) {
        existing.firstPrompt = entry.subtitle;
        existing.firstPromptAt = entry.at;
      }
    }
    return map;
  }, sameTimelineInfo);
  // Message text only matters while searching.
  const searchTimeline = useTimelineSelector(session.stores, (timeline) => (query ? timeline : NO_ROWS), Object.is);
  // Rate-limit badges read each conversation's follow-up queue.
  const followUpsById = useRuntimeSelector(session.stores, (runtimes) => {
    const map: Record<string, ConversationRuntime['followUps']> = {};
    for (const [id, runtime] of Object.entries(runtimes)) if (runtime.followUps) map[id] = runtime.followUps;
    return map;
  }, sameRecordValues);

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
      const rowId = rowIdOf(conversation);
      const current = map[rowId];
      if (!current || rank[status.kind] > rank[current]) {
        map[rowId] = status.kind;
      }
    }
    return map;
  }, [session, timelineInfoMap, rowIdOf]);

  // Workspaces use an explicit manual order and never move when a conversation updates.
  // The built-in None workspace always leads the list.
  const sortedWorkspaces = useMemo(() => [...ownWorkspaces].sort((a, b) => Number(isNoneRowId(b.id)) - Number(isNoneRowId(a.id)) || Number(pins.workspace.includes(b.id)) - Number(pins.workspace.includes(a.id)) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id)), [ownWorkspaces, pins.workspace]);

  // Conversations order by the last finished/stopped turn, so a running
  // conversation no longer re-sorts while it streams. Items that have never
  // completed keep their creation order.
  const compareConversations = useCallback((a: TodeXSession['conversations'][number], b: TodeXSession['conversations'][number]) => {
    const pinOrder = Number(pins.conversation.includes(b.id)) - Number(pins.conversation.includes(a.id));
    if (pinOrder) return pinOrder;
    const aTime = a.lastCompletedAt || a.createdAt || 0;
    const bTime = b.lastCompletedAt || b.createdAt || 0;
    if (bTime !== aTime) return bTime - aTime;
    if ((b.createdAt || 0) !== (a.createdAt || 0)) return (b.createdAt || 0) - (a.createdAt || 0);
    return a.id.localeCompare(b.id);
  }, [pins.conversation]);
  const sortedConversations = useMemo(
    () => [...workspaceConversations].sort(compareConversations),
    [workspaceConversations, compareConversations],
  );
  // Unified layout: every workspace row's listed conversations, in list order.
  const conversationsByRow = useMemo(() => {
    const byRow = new Map<string, TodeXSession['conversations']>();
    if (!unifiedLayout) return byRow;
    for (const conversation of session.conversations) {
      if (conversation.archived || !isListedConversation(conversation)) continue;
      const rowId = rowIdOf(conversation);
      const list = byRow.get(rowId);
      if (list) list.push(conversation);
      else byRow.set(rowId, [conversation]);
    }
    for (const list of byRow.values()) list.sort(compareConversations);
    return byRow;
  }, [unifiedLayout, session.conversations, rowIdOf, compareConversations]);

  // Top-level rows: lone workspaces and groups. "Show more" pages by these,
  // so a group counts as one row.
  const workspaceEntries = useMemo(() => groupWorkspaceEntries(sortedWorkspaces), [sortedWorkspaces]);
  const newGroupFallbackName = t('sidebar.newGroupName');
  // A search keeps the rows whose name matches; a group whose own name matches
  // keeps all of its workspaces, otherwise just the matching ones.
  const matchEntries = useCallback((entries: WorkspaceSidebarEntry[]) => {
    if (!query) return entries;
    const hit = (text: string) => text.toLocaleLowerCase().includes(query);
    return entries.flatMap((entry): WorkspaceSidebarEntry[] => {
      if (entry.kind === 'workspace') return hit(workspaceDisplayName(entry.workspace)) ? [entry] : [];
      if (hit(entry.name || newGroupFallbackName)) return [entry];
      const workspaces = entry.workspaces.filter((workspace) => hit(workspaceDisplayName(workspace)));
      return workspaces.length > 0 ? [{ ...entry, workspaces }] : [];
    });
  }, [query, newGroupFallbackName]);
  const matchedEntries = useMemo(() => matchEntries(workspaceEntries), [matchEntries, workspaceEntries]);

  // Grouping by tag (a per-device choice): the None rows stay on top, the
  // rest regroup into one section per tag. A search keeps a section whose tag
  // matches whole, otherwise its matching rows.
  const [tagView, setTagView] = useState(() => {
    try { return window.localStorage.getItem(WORKSPACE_VIEW_KEY) === 'tags'; } catch { return false; }
  });
  const toggleTagView = () => {
    setTagView((current) => {
      try { window.localStorage.setItem(WORKSPACE_VIEW_KEY, current ? 'groups' : 'tags'); } catch { /* the view resets next launch */ }
      return !current;
    });
  };
  const tagNoneEntries = useMemo(() => matchedEntries.filter(isNoneEntry), [matchedEntries]);
  const tagSections = useMemo(() => {
    if (!tagView) return [];
    const untaggedLabel = t('sidebar.untagged').toLocaleLowerCase();
    return groupWorkspaceEntriesByTag(workspaceEntries.filter((entry) => !isNoneEntry(entry))).flatMap((section): WorkspaceTagSection[] => {
      if (!query || (section.tag ?? untaggedLabel).toLocaleLowerCase().includes(query)) return [section];
      const entries = matchEntries(section.entries);
      return entries.length > 0 ? [{ ...section, entries }] : [];
    });
  }, [tagView, workspaceEntries, matchEntries, query, t]);
  const knownTags = useMemo(() => collectWorkspaceTags(ownWorkspaces), [ownWorkspaces]);

  const matchedWorkspaceCount = useMemo(() => {
    if (!tagView) {
      return matchedEntries.reduce((count, entry) => count + (entry.kind === 'group' ? entry.workspaces.length : 1), 0);
    }
    // Distinct workspaces: a tagged one may be listed under several tags.
    const ids = new Set<string>();
    for (const entry of [...tagNoneEntries, ...tagSections.flatMap((section) => section.entries)]) {
      if (entry.kind === 'group') entry.workspaces.forEach((workspace) => ids.add(workspace.id));
      else ids.add(entry.workspace.id);
    }
    return ids.size;
  }, [tagView, matchedEntries, tagNoneEntries, tagSections]);
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
  const foldedWorkspaceKeys = useMemo(() => {
    const folded = (tagView ? tagNoneEntries : displayedEntries).flatMap((entry) => (
      entry.kind === 'group' && isGroupFolded(entry.id) ? entry.workspaces.map((workspace) => workspace.id) : []
    ));
    if (!tagView) return folded;
    // The rail lists a tag section's workspaces flat under its header.
    return [...folded, ...tagSections.flatMap((section) => (isGroupFolded(tagSectionKey(section))
      ? tagSectionWorkspaces(section).map((workspace) => scopedKey(tagSectionKey(section), workspace.id))
      : []))];
  }, [tagView, tagNoneEntries, tagSections, displayedEntries, isGroupFolded]);

  const matchedForeignGroups = useMemo(() => {
    if (!query) return foreignWorkspaceGroups;
    return foreignWorkspaceGroups
      .map((group) => ({ ...group, workspaces: group.workspaces.filter((workspace) => workspaceDisplayName(workspace).toLocaleLowerCase().includes(query)) }))
      .filter((group) => group.workspaces.length > 0);
  }, [foreignWorkspaceGroups, query]);

  // Persists a regrouped or reordered layout as per-workspace sortOrder/groupId/groupName.
  const applyWorkspaceLayout = useCallback((next: WorkspaceSidebarEntry[]) => {
    for (const { id, patch } of workspaceLayoutPatches(next)) {
      if (!isNoneRowId(id)) session.updateWorkspace(id, patch);
    }
  }, [session]);

  // A search covers the conversations of every workspace (except those whose
  // directory is missing on the backend); titles are only resolved for every
  // conversation while it runs. Besides titles it matches the preview and the
  // prompts and replies cached on this device, ranking title matches first.
  const workspaceById = useMemo(() => new Map(session.workspaces.map((workspace) => [workspace.id, workspace])), [session.workspaces]);
  const { matchedConversations, searchSnippets } = useMemo(() => {
    if (!query) return { matchedConversations: sortedConversations, searchSnippets: new Map<string, string>() };
    const hidden = new Set(session.workspaces.filter((workspace) => workspace.pathMissing).map((workspace) => workspace.id));
    const messagesById = new Map<string, string[]>();
    for (const entry of searchTimeline) {
      if (!entry.conversationId || !entry.subtitle) continue;
      const message = entry.kind === 'outgoing'
        || (entry.kind === 'incoming' && (!entry.category || entry.category === 'assistant_final' || entry.category === 'assistant_progress'));
      if (!message) continue;
      const texts = messagesById.get(entry.conversationId);
      if (texts) texts.push(entry.subtitle);
      else messagesById.set(entry.conversationId, [entry.subtitle]);
    }
    const hits = searchConversations(
      session.conversations.filter((conversation) => workspaceById.has(conversation.workspaceId)).sort(compareConversations),
      query,
      (conversation) => conversationDisplayTitle(conversation, timelineInfoMap[conversation.id]?.firstPrompt ?? ''),
      hidden,
      (conversation) => [conversation.preview ?? '', ...(messagesById.get(conversation.id) ?? [])],
    );
    return {
      matchedConversations: hits.map((hit) => hit.conversation),
      searchSnippets: new Map(hits.flatMap((hit) => (hit.snippet ? [[hit.conversation.id, hit.snippet] as const] : []))),
    };
  }, [sortedConversations, query, session.conversations, session.workspaces, searchTimeline, timelineInfoMap, workspaceById, compareConversations]);

  const displayedConversations = useMemo(() => {
    return query ? matchedConversations : matchedConversations.slice(0, conversationLimit);
  }, [matchedConversations, query, conversationLimit]);

  // Drag-and-drop uses native listeners delegated from the workspace section;
  // each draggable row carries data-workspace-drag="<kind>:<id>". The tree
  // renders its rows after this effect runs, so an observer keeps `draggable`
  // in step with the attribute instead of marking rows once.
  const [workspaceSection, setWorkspaceSection] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!workspaceSection) return;
    const finish = () => {
      dragSourceRef.current = null;
      setDraggingKey(null);
      setDropTarget(null);
    };
    const markDraggable = () => {
      workspaceSection.querySelectorAll<HTMLElement>('[role="row"]').forEach((row) => {
        const draggable = row.hasAttribute('data-workspace-drag');
        if (row.draggable !== draggable) row.draggable = draggable;
      });
    };
    markDraggable();
    const observer = new MutationObserver(markDraggable);
    observer.observe(workspaceSection, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-workspace-drag'] });
    const rowOf = (event: globalThis.DragEvent) => {
      const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-workspace-drag]') : null;
      const key = row?.dataset.workspaceDrag || '';
      const separator = key.indexOf(':');
      const kind = key.slice(0, separator);
      const id = key.slice(separator + 1);
      if (!row || (kind !== 'workspace' && kind !== 'group') || !id) return null;
      return { row, key, kind: kind as WorkspaceDragSource['kind'], id };
    };
    const targetAt = (event: globalThis.DragEvent) => {
      const source = dragSourceRef.current;
      const hit = rowOf(event);
      if (!source || !hit) return null;
      const rect = hit.row.getBoundingClientRect();
      const inGroup = hit.row.dataset.workspaceInGroup === 'true';
      return workspaceDropTargetAt(source, hit.kind, hit.id, inGroup, (event.clientY - rect.top) / Math.max(rect.height, 1));
    };
    const start = (event: globalThis.DragEvent) => {
      const hit = rowOf(event);
      if (!hit) return;
      dragSourceRef.current = { kind: hit.kind, id: hit.id };
      setDraggingKey(hit.key);
      event.dataTransfer?.setData('text/plain', hit.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    };
    const over = (event: globalThis.DragEvent) => {
      if (!dragSourceRef.current || !rowOf(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const target = targetAt(event);
      setDropTarget((current) => (sameDropTarget(current, target) ? current : target));
    };
    const drop = (event: globalThis.DragEvent) => {
      if (!dragSourceRef.current) return;
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
    workspaceSection.addEventListener('dragstart', start);
    workspaceSection.addEventListener('dragover', over);
    workspaceSection.addEventListener('drop', drop);
    workspaceSection.addEventListener('dragend', finish);
    return () => {
      observer.disconnect();
      workspaceSection.removeEventListener('dragstart', start);
      workspaceSection.removeEventListener('dragover', over);
      workspaceSection.removeEventListener('drop', drop);
      workspaceSection.removeEventListener('dragend', finish);
    };
  }, [workspaceSection, applyWorkspaceLayout, newGroupFallbackName]);

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
    ? workspaceEntries.filter((entry): entry is WorkspaceGroupEntry => entry.kind === 'group' && entry.id !== contextWorkspaceGroupId && entry.id !== NONE_GROUP_ID)
    : [];
  const runGroupLayout = (next: WorkspaceSidebarEntry[]) => {
    applyWorkspaceLayout(next);
    setContextMenu(null);
  };

  // The built-in None workspace keeps only pin and icon actions.
  const contextIsNone = menu?.kind === 'workspace' && isNoneRowId(menu.id);
  // Read-only history (legacy plaintext, retired local Codex): no rename or fork.
  const contextReadOnly = menu?.kind === 'conversation'
    && isReadOnlyConversation(session.conversations.find((item) => item.id === menu.id));
  // Private conversations cannot be forked, and are never pinned (pins are stored).
  const contextPrivate = menu?.kind === 'conversation'
    && isPrivateConversation(session.conversations.find((item) => item.id === menu.id));
  const runContextAction = (action: 'rename' | 'edit' | 'tags' | 'fork' | 'pin' | 'delete' | 'schedule') => {
    if (!menu || menu.kind === 'group') return;
    if (action === 'schedule') {
      // A None row schedules on its own backend: it opens first.
      if (isNoneRowId(menu.id)) openWorkspaceRow(menu.id);
      setSchedulingWorkspaceId(workspaceIdOfRow(menu.id));
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
      else if (action === 'tags') setEditingTags({ kind: 'workspace', id: workspace.id, tags: workspace.tags ?? [] });
      else if (action === 'delete') setDeleting({ kind: 'workspace', id: workspace.id });
    } else {
      const conversation = session.conversations.find((item) => item.id === menu.id);
      if (!conversation) return;
      if (action === 'rename') setRenaming({ kind: 'conversation', id: conversation.id, name: conversationDisplayTitle(conversation, timelineInfoMap[conversation.id]?.firstPrompt ?? '') });
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

  // One conversation row's pieces, shared by the split list (grid rows) and
  // the unified workspace tree (tree leaves).
  const conversationRow = (conversation: TodeXSession['conversations'][number]) => {
    const isSelected = conversation.id === session.activeConversationId;
    const status = getConversationStatus(session, conversation, timelineInfoMap[conversation.id]?.latestEntry, timelineInfoMap[conversation.id]?.latestIncomingAt);
    const taskMeta = conversationTaskMetaMap[conversation.id];
    // A daemon-paused follow-up queue waiting out a provider rate
    // limit gets a clock badge; it reports its own resumeAt.
    const followUps = followUpsById[conversation.id];
    const backendWait = followUps?.paused && followUps.pauseReason === 'rate_limited' && followUps.items.length > 0
      ? Date.parse(followUps.resumeAt) : NaN;
    const resetAt = Number.isFinite(backendWait) && backendWait > Date.now() ? backendWait : undefined;
    const tasksDone = Boolean(taskMeta && taskMeta.pending === 0);
    const title = conversationDisplayTitle(conversation, timelineInfoMap[conversation.id]?.firstPrompt ?? '');
    const running = isConversationHighlighted(conversation, session.activeConversationId, session.turnIds);
    // Search results come from every workspace, so each names its own.
    const resultWorkspace = query ? rowById.get(rowIdOf(conversation)) ?? workspaceById.get(conversation.workspaceId) : undefined;
    const resultSnippet = query ? searchSnippets.get(conversation.id) : undefined;
    const glyph = (
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
    );
    const label = (
      <span className={cx('flex min-w-0 flex-1 flex-col', rail && 'hidden')}>
        <span className={cx('flex min-w-0 items-center gap-1 text-body-medium', isSelected ? 'text-text-primary' : tasksDone ? 'text-text-tertiary' : 'text-text-secondary')}>
          {isReadOnlyConversation(conversation) ? <span className="inline-flex shrink-0 text-foreground-icon-tertiary" role="img" title={t('history.readOnlyBadge')} aria-label={t('history.readOnlyBadge')}><RiLockLine className="size-3" aria-hidden="true" /></span> : null}
          {isPrivateConversation(conversation) ? (
            <TooltipTrigger delay={300}>
              <Focusable>
                <span role="img" tabIndex={-1} aria-label={t('private.badge')} className={cx('inline-flex shrink-0 rounded-sm text-foreground-icon-tertiary', FOCUS_RING)}>
                  <RiSpyLine className="size-3.5" aria-hidden="true" />
                </span>
              </Focusable>
              <Tooltip placement="top">{t('private.badge')}</Tooltip>
            </TooltipTrigger>
          ) : null}
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
        {resultSnippet ? <SearchSnippet snippet={resultSnippet} query={query} /> : null}
        {resultWorkspace ? (
          <span className="truncate text-caption-1-regular text-text-tertiary">{workspaceDisplayName(resultWorkspace)}</span>
        ) : null}
      </span>
    );
    const badges = (
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
    );
    return { isSelected, title, tasksDone, running, glyph, label, badges };
  };

  // `scope` places a tag-view row under its tag section (no dragging there).
  const renderWorkspaceItem = (workspace: WorkspaceRecord, group: { entry: WorkspaceGroupEntry; last: boolean; folded: boolean } | null, scope?: { key: string; folded: boolean }) => {
    const isSelected = workspace.id === activeRowId;
    // A group-after drop on an expanded group marks the group's last row.
    const drop = dropTarget?.kind === 'workspace' && dropTarget.id === workspace.id
      ? dropTarget.position
      : group?.last && !group.folded && dropTarget?.kind === 'group' && dropTarget.id === group.entry.id && dropTarget.position === 'after'
        ? 'after' as const
        : null;
    const isMissing = Boolean(workspace.pathMissing);
    const backend = session.backendConnections.find((profile) => profile.id === (workspace.backendConnectionId || session.activeBackendConnectionId));
    const backendLabel = backend ? t('sidebar.backendLabel', { name: backend.name, url: backend.serverUrl }) : t('sidebar.backendRemoved');
    const showBackend = duplicateWorkspaceNames.has(workspaceDisplayName(workspace)) || (splitNone && isNoneRowId(workspace.id));
    const workspaceStatus = workspaceStatusMap[workspace.id];
    const workspaceStatusLabel = workspaceStatus === 'working'
      ? t('sidebar.statusWorking')
      : workspaceStatus === 'issue'
        ? t('sidebar.statusIssue')
        : t('sidebar.statusUnread');
    const WorkspaceGlyph = workspaceIconComponent(workspace.icon);
    return (
      <GridListItem
        key={scopedKey(scope?.key, workspace.id)}
        id={scopedKey(scope?.key, workspace.id)}
        textValue={workspaceDisplayName(workspace)}
        className={rowClassName({
          selected: isSelected,
          rail,
          hidden: group?.folded || scope?.folded,
          drop,
          dragging: draggingKey === `workspace:${workspace.id}`,
          extra: isMissing ? 'cursor-not-allowed opacity-50' : undefined,
        })}
        inert={group?.folded || scope?.folded || undefined}
        data-workspace-id={workspace.id}
        data-workspace-drag={isNoneRowId(workspace.id) || scope ? undefined : `workspace:${workspace.id}`}
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
    const workspace = rowById.get(workspaceId) ?? session.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return null;
    const backend = session.backendConnections.find((profile) => profile.id === (workspace.backendConnectionId || session.activeBackendConnectionId));
    const lastActivity = workspaceLastActivity.get(workspace.id) ?? workspace.updatedAt;
    // Own tags first, then those it takes from its group.
    const groupTags = workspaceEntries.find((entry): entry is WorkspaceGroupEntry => entry.kind === 'group' && entry.workspaces.some((item) => item.id === workspace.id))?.tags ?? [];
    const tags = normalizeWorkspaceTags([...(workspace.tags ?? []), ...groupTags]) ?? [];
    return (
      <span className="flex flex-col gap-1">
        <bdi className="text-caption-1-semibold">{workspaceDisplayName(workspace)}</bdi>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
          <dt className="text-text-tertiary">{t('sidebar.workspaceTipBackend')}</dt>
          <dd className="break-words">{backend ? backend.name : t('sidebar.backendRemoved')}</dd>
          <dt className="text-text-tertiary">{t('sidebar.workspaceTipPath')}</dt>
          <dd className="break-all"><span dir="ltr">{(isNoneRowId(workspace.id) ? session.backendLinkStatus[workspace.backendConnectionId ?? '']?.serverVersion?.scratch_workspace_root : workspace.path) || '—'}</span></dd>
          <dt className="text-text-tertiary">{t('sidebar.workspaceTipActivity')}</dt>
          <dd>{lastActivity ? relativeTime(lastActivity) : '—'}</dd>
          {tags.length > 0 ? (
            <>
              <dt className="text-text-tertiary">{t('sidebar.workspaceTipTags')}</dt>
              <dd className="break-words">{tags.map((tag, index) => <span key={tag}>{index > 0 ? ', ' : null}<bdi>{tag}</bdi></span>)}</dd>
            </>
          ) : null}
        </dl>
        {workspace.pathMissing ? <span className="text-status-yellow-text">{t('sidebar.workspaceMissingPath')}</span> : null}
      </span>
    );
  };

  const renderGroupItems = (entry: WorkspaceGroupEntry) => {
    const folded = isGroupFolded(entry.id);
    const name = entry.name || t('sidebar.newGroupName');
    const containsSelected = entry.workspaces.some((workspace) => workspace.id === activeRowId);
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
        data-workspace-drag={entry.id === NONE_GROUP_ID ? undefined : `group:${entry.id}`}
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

  // Rail tag view: a tag header followed by the section's workspaces.
  const renderTagItems = (section: WorkspaceTagSection) => {
    const key = tagSectionKey(section);
    const folded = isGroupFolded(key);
    const name = section.tag ?? t('sidebar.untagged');
    const workspaces = tagSectionWorkspaces(section);
    const containsSelected = workspaces.some((workspace) => workspace.id === activeRowId);
    const header = (
      <GridListItem
        key={key}
        id={key}
        textValue={name}
        aria-label={folded ? t('sidebar.expandGroup', { name }) : t('sidebar.collapseGroup', { name })}
        className={rowClassName({ rail })}
      >
        <RowContent rail={rail} title={name}>
          <span className="relative flex size-5 shrink-0 items-center justify-center">
            <RiPriceTag3Line aria-hidden className={cx('size-4', containsSelected ? 'text-foreground-icon-primary' : 'text-foreground-icon-secondary')} />
          </span>
        </RowContent>
      </GridListItem>
    );
    return [header, ...workspaces.map((workspace) => renderWorkspaceItem(workspace, null, { key, folded }))];
  };

  // A new conversation in the workspace behind a row (None rows open first,
  // so the draft lands on their own backend).
  const createConversationIn = (rowId: string) => {
    const noneBackendId = noneWorkspaceRowBackendId(rowId);
    if (noneBackendId !== null) openWorkspaceRow(rowId);
    onCreateConversation(workspaceIdOfRow(rowId), noneBackendId ? { backendConnectionId: noneBackendId } : undefined);
    if (mobile) onCloseMobile?.();
  };

  // Unified layout: a workspace branch's leaves — its conversations, paged
  // like the split list, then the paging row. A folded branch keeps a single
  // placeholder leaf (never shown) so it still carries its chevron without
  // building every conversation row.
  const workspaceConversationItems = (rowId: string, conversations: TodeXSession['conversations'], unfolded: boolean, scope?: string): ReactNode[] => {
    if (!unfolded || conversations.length === 0) {
      return [(
        <TreeViewItem
          key={scopedKey(scope, `empty:${rowId}`)}
          id={scopedKey(scope, `empty:${rowId}`)}
          label={t('sidebar.noConversations')}
          icon={null}
          className="cursor-default bg-transparent text-caption-1-regular text-text-tertiary"
        />
      )];
    }
    const limit = rowConversationLimits[rowId] ?? 5;
    const items: ReactNode[] = conversations.slice(0, limit).map((conversation) => {
      const row = conversationRow(conversation);
      return (
        <TreeViewItem
          key={scopedKey(scope, `conversation:${conversation.id}`)}
          id={scopedKey(scope, `conversation:${conversation.id}`)}
          label={row.title}
          leading={row.glyph}
          labelContent={(
            <>
              {row.label}
              {row.running ? <span className="sr-only">{t('sidebar.running')}</span> : null}
            </>
          )}
          trailingContent={row.badges}
          className={({ isHovered, isPressed }) => cx(
            row.isSelected ? 'bg-background-secondary-hover' : isPressed ? 'bg-background-tertiary-default' : isHovered ? 'bg-background-secondary-hover' : 'bg-transparent',
            row.tasksDone && 'opacity-60',
          )}
          onContextMenu={(event) => openContextMenu(event, 'conversation', conversation.id)}
        />
      );
    });
    if (conversations.length > 5) {
      const setLimit = (next: number) => setRowConversationLimits((current) => ({ ...current, [rowId]: next }));
      const hasMore = conversations.length > limit;
      items.push(
        <TreeViewItem
          key={scopedKey(scope, `more:${rowId}`)}
          id={scopedKey(scope, `more:${rowId}`)}
          label={hasMore ? t('sidebar.showMore') : t('sidebar.collapse')}
          icon={null}
          className="cursor-default bg-transparent"
          labelContent={(
            <span className="flex min-w-0 flex-1 items-center justify-between">
              {hasMore ? <AriaButton className={QUIET_BUTTON} onPress={() => setLimit(limit + 5)}>{t('sidebar.showMore')}</AriaButton> : <span />}
              {limit > 5 ? <AriaButton className={QUIET_BUTTON} onPress={() => setLimit(5)}>{t('sidebar.collapse')}</AriaButton> : null}
            </span>
          )}
        />,
      );
    }
    return items;
  };

  // Expanded sidebar: the workspace list is a BoardUI tree. Groups are
  // branches (folder, chevron, guides) holding their workspaces; lone
  // workspaces are root leaves. The icon rail keeps the flat grid list.
  const workspaceTreeItem = (workspace: WorkspaceRecord, group: { entry: WorkspaceGroupEntry; last: boolean } | null, scope?: string): ReactNode => {
    const isSelected = workspace.id === activeRowId;
    const drop = dropTarget?.kind === 'workspace' && dropTarget.id === workspace.id
      ? dropTarget.position
      : group?.last && dropTarget?.kind === 'group' && dropTarget.id === group.entry.id && dropTarget.position === 'after'
        ? 'after' as const
        : null;
    const isMissing = Boolean(workspace.pathMissing);
    const backend = session.backendConnections.find((profile) => profile.id === (workspace.backendConnectionId || session.activeBackendConnectionId));
    const backendLabel = backend ? t('sidebar.backendLabel', { name: backend.name, url: backend.serverUrl }) : t('sidebar.backendRemoved');
    const showBackend = duplicateWorkspaceNames.has(workspaceDisplayName(workspace)) || (splitNone && isNoneRowId(workspace.id));
    const workspaceStatus = workspaceStatusMap[workspace.id];
    const WorkspaceGlyph = workspaceIconComponent(workspace.icon);
    const conversations = nested ? conversationsByRow.get(workspace.id) ?? [] : [];
    const unfolded = nested && expandedWorkspaces.includes(workspace.id);
    return (
      <TreeViewItem
        key={scopedKey(scope, workspace.id)}
        id={scopedKey(scope, workspace.id)}
        label={workspaceDisplayName(workspace)}
        className={({ isHovered, isPressed }) => cx(
          'group/workspace-row',
          // The sidebar's row fills: the tree's menu fill matches this surface.
          // An unfolded workspace leaves the fill to its selected conversation.
          isSelected && !unfolded ? 'bg-background-secondary-hover' : isPressed ? 'bg-background-tertiary-default' : isHovered ? 'bg-background-secondary-hover' : 'bg-transparent',
          isSelected ? 'text-text-primary' : isMissing ? 'cursor-not-allowed text-text-tertiary opacity-50' : 'text-text-secondary',
          'text-body-medium',
          drop && DROP_CLASS[drop],
          draggingKey === `workspace:${workspace.id}` && 'opacity-40',
        )}
        data-workspace-id={workspace.id}
        data-workspace-drag={isNoneRowId(workspace.id) || scope ? undefined : `workspace:${workspace.id}`}
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
            {nested ? (
              <>
                {isMissing ? null : (
                  <AriaButton
                    aria-label={t('sidebar.newConversationIn', { name: workspaceDisplayName(workspace) })}
                    onPress={() => createConversationIn(workspace.id)}
                    className={cx(
                      'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary',
                      'transition-[color,background-color,opacity] duration-150 ease hover:bg-background-tertiary-default hover:text-foreground-icon-primary',
                      // Shown while the row is hovered or focused.
                      'opacity-0 group-data-[hovered]/workspace-row:opacity-100 group-data-[focus-visible]/workspace-row:opacity-100 data-[focus-visible]:opacity-100',
                      FOCUS_RING,
                    )}
                  >
                    <RiAddLine aria-hidden className="size-3.5" />
                  </AriaButton>
                )}
                <span className="min-w-4 text-center tabular-nums">{conversations.length}</span>
              </>
            ) : null}
          </span>
        )}
      >
        {nested ? workspaceConversationItems(workspace.id, conversations, unfolded, scope) : null}
      </TreeViewItem>
    );
  };

  const groupTreeItem = (entry: WorkspaceGroupEntry, scope?: string): ReactNode => {
    const folded = isGroupFolded(entry.id);
    const name = entry.name || t('sidebar.newGroupName');
    const containsSelected = entry.workspaces.some((workspace) => workspace.id === activeRowId);
    const statuses = entry.workspaces
      .map((workspace) => workspaceStatusMap[workspace.id])
      .filter((status): status is NonNullable<typeof status> => Boolean(status))
      .slice(0, 3);
    const drop = dropTarget?.kind === 'group' && dropTarget.id === entry.id
      ? dropTarget.position === 'after' && !folded ? null : dropTarget.position
      : null;
    return (
      <TreeViewItem
        key={scopedKey(scope, `group:${entry.id}`)}
        id={scopedKey(scope, `group:${entry.id}`)}
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
        data-workspace-drag={entry.id === NONE_GROUP_ID || scope ? undefined : `group:${entry.id}`}
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
        {entry.workspaces.map((workspace, index) => workspaceTreeItem(workspace, { entry, last: index === entry.workspaces.length - 1 }, scope))}
      </TreeViewItem>
    );
  };

  const entryTreeItem = (entry: WorkspaceSidebarEntry, scope?: string): ReactNode => (entry.kind === 'group'
    ? groupTreeItem(entry, scope)
    : workspaceTreeItem(entry.workspace, null, scope));

  const tagTreeItem = (section: WorkspaceTagSection): ReactNode => {
    const key = tagSectionKey(section);
    const folded = isGroupFolded(key);
    const name = section.tag ?? t('sidebar.untagged');
    const workspaces = tagSectionWorkspaces(section);
    const containsSelected = workspaces.some((workspace) => workspace.id === activeRowId);
    const statuses = workspaces
      .map((workspace) => workspaceStatusMap[workspace.id])
      .filter((status): status is NonNullable<typeof status> => Boolean(status))
      .slice(0, 3);
    return (
      <TreeViewItem
        key={key}
        id={key}
        label={name}
        icon={RiPriceTag3Line}
        className={({ isHovered, isPressed }) => cx(
          isPressed ? 'bg-background-tertiary-default' : isHovered ? 'bg-background-secondary-hover' : 'bg-transparent',
          'text-body-semibold',
          folded && containsSelected ? 'text-text-primary' : section.tag === null ? 'text-text-tertiary' : 'text-text-secondary',
        )}
        trailingContent={(
          <span className="flex items-center gap-1.5 pe-1">
            {folded && statuses.length > 0 ? (
              <span className="flex items-center gap-1" aria-hidden="true">
                {statuses.map((status, index) => <span key={index} className={cx('size-1.5 rounded-full', STATUS_DOT_CLASS[status])} />)}
              </span>
            ) : null}
            <span className="tabular-nums">{workspaces.length}</span>
          </span>
        )}
      >
        {section.entries.map((entry) => entryTreeItem(entry, key))}
      </TreeViewItem>
    );
  };

  // Branches of the current view: their tree keys, fold-state ids, whether
  // they are open and how they toggle. A group listed under several tags
  // shares one fold state, and so does a workspace (unified layout).
  type TreeBranch = { key: string; foldId: string; open: boolean; toggle: () => void };
  const groupBranch = (key: string, foldId: string): TreeBranch => ({ key, foldId, open: !isGroupFolded(foldId), toggle: () => toggleGroupCollapsed(foldId) });
  const entryBranches = (entry: WorkspaceSidebarEntry, scope?: string): TreeBranch[] => [
    ...(entry.kind === 'group' ? [groupBranch(scopedKey(scope, `group:${entry.id}`), entry.id)] : []),
    ...(nested ? (entry.kind === 'group' ? entry.workspaces : [entry.workspace]).map((workspace): TreeBranch => ({
      key: scopedKey(scope, workspace.id),
      foldId: `workspace:${workspace.id}`,
      open: expandedWorkspaces.includes(workspace.id),
      toggle: () => toggleWorkspaceExpanded(workspace.id),
    })) : []),
  ];
  const treeBranches = tagView
    ? [
      ...tagNoneEntries.flatMap((entry) => entryBranches(entry)),
      ...tagSections.flatMap((section) => [
        groupBranch(tagSectionKey(section), tagSectionKey(section)),
        ...section.entries.flatMap((entry) => entryBranches(entry, tagSectionKey(section))),
      ]),
    ]
    : displayedEntries.flatMap((entry) => entryBranches(entry));
  const expandedGroupKeys = new Set<Key>(treeBranches.filter((branch) => branch.open).map((branch) => branch.key));
  // Every row key of the active workspace (several in the tag view).
  const selectedWorkspaceKeys = !activeRowId ? [] : !tagView ? [activeRowId] : [
    ...(tagNoneEntries.some((entry) => (entry.kind === 'group' ? entry.workspaces.some((workspace) => workspace.id === activeRowId) : entry.workspace.id === activeRowId)) ? [activeRowId] : []),
    ...tagSections.flatMap((section) => section.entries
      .filter((entry) => (entry.kind === 'group' ? entry.workspaces.some((workspace) => workspace.id === activeRowId) : entry.workspace.id === activeRowId))
      .map(() => scopedKey(tagSectionKey(section), activeRowId))),
  ];
  // Unified layout: the tree selects the active conversation under each of
  // those rows; the workspace row only fills while folded.
  const selectedTreeKeys = !nested ? selectedWorkspaceKeys : !session.activeConversationId ? [] : selectedWorkspaceKeys.map((key) => (
    `${key.slice(0, key.length - activeRowId.length)}conversation:${session.activeConversationId}`
  ));
  // A row key picked in the list: tag and group headers fold, workspaces open.
  const activateWorkspaceKey = (rawKey: string) => {
    if (isTagSectionKey(rawKey)) {
      toggleGroupCollapsed(rawKey);
      return;
    }
    const key = unscopedKey(rawKey);
    if (key.startsWith('group:')) {
      toggleGroupCollapsed(key.slice('group:'.length));
      return;
    }
    if (nested) {
      if (key.startsWith('conversation:')) {
        const conversation = session.conversations.find((item) => item.id === key.slice('conversation:'.length));
        if (!conversation) return;
        session.selectConversation(conversation.workspaceId, conversation.id);
        onSelectConversation?.();
        return;
      }
      // The paging row's own buttons page; picking the row pages forward
      // (or back once everything shows).
      if (key.startsWith('more:')) {
        const rowId = key.slice('more:'.length);
        const limit = rowConversationLimits[rowId] ?? 5;
        const next = (conversationsByRow.get(rowId)?.length ?? 0) > limit ? limit + 5 : 5;
        setRowConversationLimits((current) => ({ ...current, [rowId]: next }));
        return;
      }
      if (key.startsWith('empty:')) return;
      // A workspace row folds or unfolds its conversations; it does not
      // switch away from the conversation in view.
      if (session.workspaces.find((item) => item.id === workspaceIdOfRow(key))?.pathMissing) return;
      toggleWorkspaceExpanded(key);
      return;
    }
    if (session.workspaces.find((item) => item.id === key)?.pathMissing) return;
    openWorkspaceRow(key);
  };

  // Cached data renders immediately; the directory sync only blocks an
  // entirely empty sidebar (first run or cleared storage).
  const syncing = session.directorySyncStatus === 'loading' && session.workspaces.length === 0;

  const newConversationItems: DashboardNavItem[] = [
    {
      key: 'new-conversation',
      label: t('sidebar.newConversation'),
      icon: RiAddLine,
      disabled: !session.activeWorkspaceId,
      onClick: () => onCreateConversation(),
      hint: <ShortcutHint id="newConversation" />,
    },
    {
      key: 'new-private-conversation',
      label: t('private.create'),
      icon: RiSpyLine,
      disabled: Boolean(privateUnavailable),
      disabledReason: privateUnavailable || undefined,
      onClick: () => {
        if (mobile) onCloseMobile?.();
        onCreatePrivateConversation();
      },
      hint: <ShortcutHint id="newPrivateConversation" />,
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

  const menuWorkspace = menu?.kind === 'workspace' ? session.workspaces.find((item) => item.id === workspaceIdOfRow(menu.id)) : undefined;
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
          aria-label={t('app.profile')}
          // The card opens the profile page; Settings (with About, CLI
          // management and cleanup) sits right above it as its own row.
          onPress={() => {
            if (mobile) onCloseMobile?.();
            onOpenProfile();
          }}
          isSelected={profileActive}
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
        <section ref={setWorkspaceSection} className="flex flex-col gap-1">
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
              actions={(
                <IconAction
                  size="xs"
                  icon={RiPriceTag3Line}
                  aria-label={t('sidebar.groupByTags')}
                  tooltip
                  active={tagView}
                  onClick={toggleTagView}
                />
              )}
            />
          )}

          {(query || !workspacesCollapsed) && (
            <>
              {ownWorkspaces.length === 0 ? (
                rail || query ? null : <p className="px-2 py-1 text-caption-1-regular text-text-tertiary">{t('sidebar.noWorkspaces')}</p>
              ) : (tagView ? tagNoneEntries.length + tagSections.length : displayedEntries.length) === 0 ? null : (
                <>
                  <WorkspaceHoverTooltip disabled={Boolean(draggingKey) || Boolean(contextMenu)} renderContent={workspaceTooltipContent}>
                  {rail ? (
                    <GridList
                      key={`workspaces_${workspaceLimit}`}
                      aria-label={t('sidebar.workspaces')}
                      className="flex flex-col outline-none"
                      disabledKeys={foldedWorkspaceKeys}
                      disabledBehavior="all"
                      onAction={(key) => activateWorkspaceKey(String(key))}
                    >
                      {[
                        ...(tagView ? tagNoneEntries : displayedEntries).flatMap((entry) => (entry.kind === 'group'
                          ? renderGroupItems(entry)
                          : [renderWorkspaceItem(entry.workspace, null)])),
                        ...tagSections.flatMap(renderTagItems),
                      ]}
                    </GridList>
                  ) : (
                    <TreeView
                      key={`workspaces_${workspaceLimit}`}
                      aria-label={t('sidebar.workspaces')}
                      className="rounded-none border-0 bg-transparent p-0"
                      selectionMode="single"
                      selectionBehavior="replace"
                      selectedKeys={selectedTreeKeys}
                      expandedKeys={expandedGroupKeys}
                      onExpandedChange={(keys) => {
                        const toggled = new Set<string>();
                        for (const branch of treeBranches) {
                          if (keys.has(branch.key) === expandedGroupKeys.has(branch.key) || toggled.has(branch.foldId)) continue;
                          toggled.add(branch.foldId);
                          branch.toggle();
                        }
                      }}
                      onSelectionChange={(keys) => {
                        // Tag and group rows (and, unified, workspace rows)
                        // fold or unfold; they are never selected.
                        const key = keys === 'all' ? '' : String([...keys][0] ?? '');
                        if (key) activateWorkspaceKey(key);
                      }}
                    >
                      {[
                        ...(tagView ? tagNoneEntries : displayedEntries).map((entry) => entryTreeItem(entry)),
                        ...tagSections.map(tagTreeItem),
                      ]}
                    </TreeView>
                  )}
                  </WorkspaceHoverTooltip>

                  {!query && !tagView && workspaceEntries.length > 5 && !rail && (
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

        {/* Conversation section (the unified layout nests it in the tree) */}
        {nested || (query && matchedConversations.length === 0) ? null : (
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
            !query && workspaceConversations.length === 0 ? (
              rail ? null : (
                <p className="px-2 py-1 text-caption-1-regular text-text-tertiary">
                  {session.activeWorkspaceId ? t('sidebar.noConversations') : t('sidebar.selectWorkspace')}
                </p>
              )
            ) : (
              <>
                <GridList
                  key={query ? `search_${query}` : `${activeRowId || 'no-workspace'}_${conversationLimit}`}
                  aria-label={t('sidebar.conversations')}
                  className="flex flex-col outline-none"
                  onAction={(key) => {
                    const conversation = displayedConversations.find((item) => item.id === String(key));
                    if (conversation) {
                      session.selectConversation(conversation.workspaceId, conversation.id);
                      onSelectConversation?.();
                    }
                  }}
                >
                  {displayedConversations.map((conversation) => {
                    const row = conversationRow(conversation);
                    return (
                      <GridListItem
                        key={conversation.id}
                        id={conversation.id}
                        textValue={row.title}
                        className={rowClassName({ selected: row.isSelected, rail, dim: row.tasksDone })}
                        onContextMenu={(event) => openContextMenu(event, 'conversation', conversation.id)}
                      >
                        <RowContent rail={rail} title={rail ? row.title : undefined}>
                          {row.glyph}
                          {row.label}
                          {rail ? null : row.badges}
                          {row.running ? <span className="sr-only">{t('sidebar.running')}</span> : null}
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
        agents={schedulingAgents}
        onConfirm={(at, options) => (schedulingWorkspaceId ? onCreateScheduledConversation(schedulingWorkspaceId, at, options) : Promise.resolve(false))}
        onClose={() => setSchedulingWorkspaceId(null)}
      />
      <PointMenu position={contextMenu} onClose={closeContextMenu}>
        {menu?.kind === 'group' ? (
          <Menu aria-label={t('sidebar.groupMenu')} autoFocus="first">
            {menu.id === NONE_GROUP_ID ? null : <MenuItem id="rename-group" icon={RiPencilLine} textValue={t('sidebar.renameGroup')} onAction={() => { if (contextGroup) setRenamingGroup({ id: contextGroup.id, name: contextGroup.name }); setContextMenu(null); }}>{t('sidebar.renameGroup')}</MenuItem>}
            {menu.id === NONE_GROUP_ID ? null : <MenuItem id="group-tags" icon={RiPriceTag3Line} textValue={t('sidebar.editGroupTags')} onAction={() => { if (contextGroup) setEditingTags({ kind: 'group', id: contextGroup.id, tags: contextGroup.tags }); setContextMenu(null); }}>{t('sidebar.editGroupTags')}</MenuItem>}
            <MenuItem id="toggle-group" icon={RiArrowDownSLine} textValue={collapsedGroups.includes(menu.id) ? t('sidebar.unfoldGroup') : t('sidebar.foldGroup')} onAction={() => { toggleGroupCollapsed(menu.id); setContextMenu(null); }}>{collapsedGroups.includes(menu.id) ? t('sidebar.unfoldGroup') : t('sidebar.foldGroup')}</MenuItem>
            {menu.id === NONE_GROUP_ID ? null : <MenuSeparator />}
            {menu.id === NONE_GROUP_ID ? null : <MenuItem id="ungroup" icon={RiFoldersLine} tone="danger" textValue={t('sidebar.ungroup')} onAction={() => runGroupLayout(ungroupWorkspaceGroup(workspaceEntries, menu.id))}>{t('sidebar.ungroup')}</MenuItem>}
          </Menu>
        ) : menu ? (
          <Menu aria-label={menu.kind === 'workspace' ? t('sidebar.workspaceMenu') : t('sidebar.conversationMenu')} autoFocus="first">
            {menu.kind === 'conversation' && !contextReadOnly && !contextPrivate ? <MenuItem id="fork" icon={RiGitBranchLine} textValue="Fork" onAction={() => runContextAction('fork')}>Fork</MenuItem> : null}
            {contextReadOnly || contextIsNone ? null : <MenuItem id="rename" icon={RiPencilLine} textValue={t('sidebar.rename')} onAction={() => runContextAction('rename')}>{t('sidebar.rename')}</MenuItem>}
            {menu.kind === 'workspace' && canSchedule ? <MenuItem id="schedule" icon={RiTimerLine} textValue={t('schedule.create')} onAction={() => runContextAction('schedule')}>{t('schedule.create')}</MenuItem> : null}
            {menu.kind === 'workspace' && !contextIsNone ? <MenuItem id="edit" icon={RiEdit2Line} textValue={t('sidebar.edit')} onAction={() => runContextAction('edit')}>{t('sidebar.edit')}</MenuItem> : null}
            {menu.kind === 'workspace' && !contextIsNone ? <MenuItem id="tags" icon={RiPriceTag3Line} textValue={t('sidebar.editTags')} onAction={() => runContextAction('tags')}>{t('sidebar.editTags')}</MenuItem> : null}
            {contextPrivate ? null : <MenuItem id="pin" icon={RiPushpin2Fill} textValue={pins[menu.kind].includes(menu.id) ? t('sidebar.unpin') : t('sidebar.pin')} onAction={() => runContextAction('pin')}>{pins[menu.kind].includes(menu.id) ? t('sidebar.unpin') : t('sidebar.pin')}</MenuItem>}
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
                                session.updateWorkspace(workspaceIdOfRow(menu.id), { icon: key === 'folder' ? undefined : key });
                                setContextMenu(null);
                              }}
                            />
                          ))}
                        </div>
                        <SwatchPicker
                          label={t('sidebar.iconColor')}
                          value={menuWorkspace.iconColor}
                          onChange={(color) => {
                            session.updateWorkspace(workspaceIdOfRow(menu.id), { iconColor: color });
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
                                  session.updateWorkspace(workspaceIdOfRow(menu.id), { ringStyle: key === 'orbit' ? undefined : key });
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
                            session.updateWorkspace(workspaceIdOfRow(menu.id), { icon: undefined, iconColor: undefined, ringStyle: undefined });
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
            {contextWorkspaceGroupId && !contextIsNone ? <MenuItem id="remove-from-group" icon={RiFolderReduceLine} textValue={t('sidebar.removeFromGroup')} onAction={() => runGroupLayout(removeWorkspaceFromGroup(workspaceEntries, menu.id))}>{t('sidebar.removeFromGroup')}</MenuItem> : null}
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
      {editingTags ? (
        <WorkspaceTagsDialog
          key={`${editingTags.kind}:${editingTags.id}`}
          title={editingTags.kind === 'group' ? t('sidebar.editGroupTags') : t('sidebar.editTags')}
          initialTags={editingTags.tags}
          knownTags={knownTags}
          onSubmit={(tags) => {
            if (editingTags.kind === 'group') applyWorkspaceLayout(setWorkspaceGroupTags(workspaceEntriesRef.current, editingTags.id, tags));
            else session.updateWorkspace(editingTags.id, { tags: normalizeWorkspaceTags(tags) });
          }}
          onClose={() => setEditingTags(null)}
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

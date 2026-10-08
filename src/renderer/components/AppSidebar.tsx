import { RiPushpin2Fill, RiLockLine, RiAddLine, RiFolderReduceLine, RiFoldersLine, RiFolderTransferLine, RiPencilLine, RiEdit2Line, RiErrorWarningLine, RiFolder3Line, RiGitBranchLine, RiDeleteBinLine, RiArrowDownSLine, RiBarChartBoxLine, RiInformationLine, RiKanbanView2, RiPaletteLine, RiPriceTag3Line, RiPuzzle2Line, RiSettings3Line, RiTerminalBoxLine, RiTerminalLine, RiTimeLine, RiUserSettingsLine, RiVipCrownLine } from '@remixicon/react';
import { Badge, Button, Chip, ColorSwatchPicker, Dropdown, Label, Tooltip } from '@heroui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent } from 'react';
import { ContextMenu as HeroContextMenu, ChatListView, Sidebar, useSidebar } from '@heroui-pro/react';
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
import { conversationDisplayTitle, formatResetInstant, getConversationStatus, isConversationHighlighted, workspaceDisplayName } from '../session/helpers';
import { ShortcutHint } from '../lib/shortcuts';
import { t, useT } from '../i18n';

type Props = {
  session: TodeXSession;
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

const STATUS_DOT_CLASS = { working: 'bg-green-500', issue: 'bg-amber-500', unread: 'bg-blue-500' } as const;

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

export function AppSidebar({
  session,
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
  const { isMobile, isOpen, setMobileOpen } = useSidebar();
  const { pins, togglePin } = useSidebarPins();
  const kanbanTasks = useKanbanTasks();

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

  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

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

  // Icon-rail peek: the collapsed sidebar renders as a 48px icon rail. Hover,
  // keyboard focus, or an open overlay flips data-state back to expanded while
  // the [data-peek] CSS keeps a 48px layout footprint via a negative margin, so
  // the expanded sidebar floats over the main content instead of pushing it.
  const railCollapsed = !isOpen;
  const [hoverPeek, setHoverPeek] = useState(false);
  const [focusPeek, setFocusPeek] = useState(false);
  const insideRef = useRef({ pointer: false, focus: false });
  const suppressPeekRef = useRef(false);
  const peekTimerRef = useRef<number | null>(null);
  const peeking = railCollapsed
    && !suppressPeekRef.current
    && (hoverPeek || focusPeek || contextMenu !== null || headerMenuOpen);

  const scheduleHoverPeek = (open: boolean) => {
    if (peekTimerRef.current !== null) window.clearTimeout(peekTimerRef.current);
    peekTimerRef.current = window.setTimeout(() => {
      peekTimerRef.current = null;
      setHoverPeek(open);
    }, open ? 70 : 140);
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

  const railProps = {
    'data-peek': railCollapsed ? 'true' : undefined,
    ...(peeking ? { 'data-state': 'expanded' as const } : {}),
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

  // Precompute latest activity per workspace in O(C) time
  const workspaceLastActiveMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (let i = 0; i < session.conversations.length; i++) {
      const c = session.conversations[i];
      if (!c.workspaceId) continue;
      const cTime = Math.max(c.updatedAt || 0, c.createdAt || 0, timelineInfoMap[c.id]?.latestAt || 0);
      if (!map[c.workspaceId] || cTime > map[c.workspaceId]) {
        map[c.workspaceId] = cTime;
      }
    }
    return map;
  }, [session.conversations, timelineInfoMap]);

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
  const displayedEntries = useMemo(() => workspaceEntries.slice(0, workspaceLimit), [workspaceEntries, workspaceLimit]);
  const workspaceEntriesRef = useRef(workspaceEntries);
  workspaceEntriesRef.current = workspaceEntries;

  // Persists a regrouped or reordered layout as per-workspace sortOrder/groupId/groupName.
  const applyWorkspaceLayout = useCallback((next: WorkspaceSidebarEntry[]) => {
    for (const { id, patch } of workspaceLayoutPatches(next)) session.updateWorkspace(id, patch);
  }, [session]);

  const displayedConversations = useMemo(() => {
    return sortedConversations.slice(0, conversationLimit);
  }, [sortedConversations, conversationLimit]);

  // Drag-and-drop uses native listeners on the rendered rows; each draggable
  // row carries data-workspace-drag="<kind>:<id>".
  const newGroupFallbackName = t('sidebar.newGroupName');
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
  }, [displayedEntries, collapsedGroups, applyWorkspaceLayout, newGroupFallbackName]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  const openContextMenu = (event: MouseEvent, kind: NonNullable<ContextMenu>['kind'], id: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind, id, x: event.clientX, y: event.clientY });
  };

  const contextGroup = contextMenu?.kind === 'group'
    ? workspaceEntries.find((entry): entry is WorkspaceGroupEntry => entry.kind === 'group' && entry.id === contextMenu.id)
    : undefined;
  const contextWorkspaceGroupId = contextMenu?.kind === 'workspace'
    ? workspaceEntries.find((entry): entry is WorkspaceGroupEntry => entry.kind === 'group' && entry.workspaces.some((workspace) => workspace.id === contextMenu.id))?.id
    : undefined;
  const contextMoveTargets = contextMenu?.kind === 'workspace'
    ? workspaceEntries.filter((entry): entry is WorkspaceGroupEntry => entry.kind === 'group' && entry.id !== contextWorkspaceGroupId)
    : [];
  const runGroupLayout = (next: WorkspaceSidebarEntry[]) => {
    applyWorkspaceLayout(next);
    setContextMenu(null);
  };

  // Legacy plaintext history is read-only: no rename or fork.
  const contextReadOnly = contextMenu?.kind === 'conversation'
    && session.conversations.find((item) => item.id === contextMenu.id)?.legacyPlaintext === true;
  const runContextAction = (action: 'rename' | 'edit' | 'fork' | 'pin' | 'delete') => {
    if (!contextMenu || contextMenu.kind === 'group') return;
    if (action === 'pin') {
      togglePin(contextMenu.kind, contextMenu.id);
      setContextMenu(null);
      return;
    }
    if (contextMenu.kind === 'workspace') {
      const workspace = session.workspaces.find((item) => item.id === contextMenu.id);
      if (!workspace) return;
      if (action === 'rename') {
        const name = window.prompt(t('sidebar.renameWorkspacePrompt'), workspace.name);
        if (name) session.renameWorkspace(workspace.id, name);
      } else if (action === 'edit') onEditWorkspace(workspace.id);
      else if (action === 'delete') session.removeWorkspace(workspace.id);
    } else {
      const conversation = session.conversations.find((item) => item.id === contextMenu.id);
      if (!conversation) return;
      if (action === 'rename') {
        const title = window.prompt(t('sidebar.renameConversationPrompt'), conversation.title);
        if (title) session.renameConversation(conversation.id, title);
      } else if (action === 'fork') session.forkConversation(conversation.id);
      else if (action === 'delete') session.removeConversation(conversation.id);
    }
    setContextMenu(null);
  };

  const renderWorkspaceItem = (workspace: WorkspaceRecord, group: { entry: WorkspaceGroupEntry; last: boolean } | null) => {
    const isSelected = workspace.id === session.activeWorkspaceId;
    // A group-after drop on an expanded group marks the group's last row.
    const dropClass = dropTarget?.kind === 'workspace' && dropTarget.id === workspace.id
      ? `drop-${dropTarget.position}`
      : group?.last && dropTarget?.kind === 'group' && dropTarget.id === group.entry.id && dropTarget.position === 'after'
        ? 'drop-after'
        : '';
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
      <ChatListView.Item
        key={workspace.id}
        id={workspace.id}
        className={`sidebar-item ${group ? 'is-group-child' : ''} ${isSelected ? 'is-selected' : ''} ${isMissing ? 'opacity-50 cursor-not-allowed' : ''} ${draggingKey === `workspace:${workspace.id}` ? 'is-dragging' : ''} ${dropClass}`}
        textValue={workspaceDisplayName(workspace)}
        {...({ title: isMissing ? t('sidebar.workspaceMissingPath') : undefined } as object)}
        data-workspace-id={workspace.id}
        data-workspace-drag={`workspace:${workspace.id}`}
        data-workspace-in-group={group ? 'true' : undefined}
        onContextMenu={(event) => openContextMenu(event, 'workspace', workspace.id)}
      >
        <ChatListView.ItemContent>
          <ChatListView.Icon>
            <span className="relative flex size-5 items-center justify-center">
              {workspaceStatus ? (
                <WorkspaceStatusRing kind={workspaceStatus} style={workspace.ringStyle} label={workspaceStatusLabel} />
              ) : null}
              <WorkspaceGlyph
                className={`size-4 ${!workspace.iconColor && isSelected ? 'text-accent' : ''}`}
                color={workspace.iconColor}
              />
            </span>
          </ChatListView.Icon>
          <ChatListView.Text className="flex-1">
            <ChatListView.Title className={isSelected ? 'text-accent font-semibold' : isMissing ? 'text-muted' : ''}>
              {workspaceDisplayName(workspace)}{pins.workspace.includes(workspace.id) ? <RiPushpin2Fill className="ml-1 inline size-3 text-muted" aria-label={t('sidebar.pinned')} /> : null}{isMissing ? <RiErrorWarningLine className="ml-1 inline size-3 text-warning" aria-label={t('sidebar.workspaceMissingPath')} /> : null}
            </ChatListView.Title>
            <ChatListView.Preview>{workspace.path}</ChatListView.Preview>
          </ChatListView.Text>
          <Tooltip delay={300}>
            <Tooltip.Trigger
              aria-label={backendLabel}
              className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span aria-hidden="true" className="size-2.5 rounded-full ring-1 ring-foreground/10" style={{ backgroundColor: backendLabelColor(backend) }} />
            </Tooltip.Trigger>
            <Tooltip.Content placement="right" className="max-w-xs break-all">
              {backendLabel}
            </Tooltip.Content>
          </Tooltip>
        </ChatListView.ItemContent>
      </ChatListView.Item>
    );
  };

  const renderGroupItems = (entry: WorkspaceGroupEntry) => {
    const collapsed = collapsedGroups.includes(entry.id);
    const name = entry.name || t('sidebar.newGroupName');
    const containsSelected = entry.workspaces.some((workspace) => workspace.id === session.activeWorkspaceId);
    const statuses = entry.workspaces
      .map((workspace) => workspaceStatusMap[workspace.id])
      .filter((status): status is NonNullable<typeof status> => Boolean(status))
      .slice(0, 3);
    const dropClass = dropTarget?.kind === 'group' && dropTarget.id === entry.id
      ? dropTarget.position === 'into'
        ? 'drop-merge'
        : dropTarget.position === 'after' && !collapsed ? '' : `drop-${dropTarget.position}`
      : '';
    const header = (
      <ChatListView.Item
        key={`group:${entry.id}`}
        id={`group:${entry.id}`}
        className={`sidebar-item sidebar-group-head ${draggingKey === `group:${entry.id}` ? 'is-dragging' : ''} ${dropClass}`}
        textValue={name}
        aria-label={collapsed ? t('sidebar.expandGroup', { name }) : t('sidebar.collapseGroup', { name })}
        data-workspace-drag={`group:${entry.id}`}
        onContextMenu={(event) => openContextMenu(event, 'group', entry.id)}
      >
        <ChatListView.ItemContent>
          <ChatListView.Icon>
            <span className="relative flex size-5 items-center justify-center">
              <RiArrowDownSLine className={`sidebar-group-chevron size-4 text-muted transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
              <RiFoldersLine className={`sidebar-group-rail-glyph size-4 ${containsSelected ? 'text-accent' : 'text-muted'}`} />
            </span>
          </ChatListView.Icon>
          <ChatListView.Text className="flex-1">
            <ChatListView.Title className={`font-semibold ${collapsed && containsSelected ? 'text-accent' : ''}`}>
              {name}<span className="ml-1 text-[11px] font-normal text-muted">{entry.workspaces.length}</span>
            </ChatListView.Title>
          </ChatListView.Text>
          {collapsed && statuses.length > 0 ? (
            <span className="ml-auto flex shrink-0 items-center gap-1 pr-2" aria-hidden="true">
              {statuses.map((status, index) => <span key={index} className={`size-1.5 rounded-full ${STATUS_DOT_CLASS[status]}`} />)}
            </span>
          ) : null}
        </ChatListView.ItemContent>
      </ChatListView.Item>
    );
    if (collapsed) return [header];
    return [header, ...entry.workspaces.map((workspace, index) => renderWorkspaceItem(workspace, { entry, last: index === entry.workspaces.length - 1 }))];
  };

  // Cached data renders immediately; the directory sync only blocks an
  // entirely empty sidebar (first run or cleared storage).
  if (session.directorySyncStatus === 'loading' && session.workspaces.length === 0) {
    return <Sidebar {...railProps}><Sidebar.Content><p className="sidebar-empty-hint text-muted px-3 py-4 text-sm">{t('sidebar.syncing')}</p></Sidebar.Content></Sidebar>;
  }

  const identityMenu = (
    <Dropdown onOpenChange={setHeaderMenuOpen}>
      <Dropdown.Trigger
        aria-label={t('sidebar.menu')}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-secondary active:bg-surface-secondary/70 transition-colors cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Badge.Anchor className="shrink-0">
          <AppIcon />
          <Badge color={healthColor} placement="bottom-right" size="sm" aria-label={session.connectionState === 'open' ? t('sidebar.backendConnected') : t('sidebar.backendDisconnected')} />
        </Badge.Anchor>
        <span className="flex min-w-0 flex-1 items-center gap-1.5" data-sidebar="label">
          <span className="text-foreground truncate text-sm font-semibold tracking-tight">TodeX</span>
          <Chip size="sm" variant="soft">V2</Chip>
        </span>
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu onAction={(key) => {
          if (key === 'settings') onOpenSettings();
          if (key === 'capabilities') onOpenCapabilities();
          if (key === 'cli-manager') {
            if (isMobile) setMobileOpen(false);
            onOpenCliManager();
          }
          if (key === 'agent-providers') {
            if (isMobile) setMobileOpen(false);
            onOpenAgentProviders();
          }
          if (key === 'usage') onOpenUsage();
          if (key === 'quota') onOpenQuota();
          if (key === 'about') onOpenAbout();
        }}>
          <Dropdown.Item id="settings" textValue={t('app.settings')}><RiSettings3Line className="text-muted size-4 shrink-0" /><Label>{t('app.settings')}</Label></Dropdown.Item>
          <Dropdown.Item id="capabilities" textValue={t('app.mcpSkillManager')}><RiPuzzle2Line className="text-muted size-4 shrink-0" /><Label>{t('app.mcpSkillManager')}</Label></Dropdown.Item>
          <Dropdown.Item id="cli-manager" textValue={t('app.cliManager')}><RiTerminalBoxLine className="text-muted size-4 shrink-0" /><Label>{t('app.cliManager')}</Label></Dropdown.Item>
          <Dropdown.Item id="agent-providers" textValue={t('app.agentProviders')}><RiUserSettingsLine className="text-muted size-4 shrink-0" /><Label>{t('app.agentProviders')}</Label></Dropdown.Item>
          <Dropdown.Item id="usage" textValue={t('app.usage')}><RiBarChartBoxLine className="text-muted size-4 shrink-0" /><Label>{t('app.usage')}</Label></Dropdown.Item>
          <Dropdown.Item id="quota" textValue={t('usage.quotaTitle')}><RiVipCrownLine className="text-muted size-4 shrink-0" /><Label>{t('usage.quotaTitle')}</Label></Dropdown.Item>
          <Dropdown.Item id="about" textValue={t('app.about')}><RiInformationLine className="text-muted size-4 shrink-0" /><Label>{t('app.about')}</Label></Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );

  return (
    <Sidebar {...railProps}>
      <Sidebar.Header>
        <Button
          className="connection-create-button w-full justify-start"
          variant="secondary"
          isDisabled={!session.activeWorkspaceId}
          onPress={onCreateConversation}
        >
          <RiAddLine className="size-4" />
          <span data-sidebar="label">{t('sidebar.newConversation')}</span>
          <ShortcutHint id="newConversation" className="ml-auto" />
        </Button>
        <Button
          className="mt-1 w-full justify-start"
          variant={terminalActive ? 'secondary' : 'ghost'}
          aria-pressed={terminalActive}
          onPress={() => {
            if (isMobile) setMobileOpen(false);
            onOpenTerminal();
          }}
        >
          <RiTerminalLine className="size-4" />
          <span data-sidebar="label">{t('sidebar.terminal')}</span>
          <ShortcutHint id="sshTerminal" className="ml-auto" />
        </Button>
        <Button className="mt-1 w-full justify-start" variant="ghost" onPress={onOpenKanban}>
          <RiKanbanView2 className="size-4" />
          <span data-sidebar="label">{t('sidebar.kanban')}</span>
          <ShortcutHint id="kanban" className="ml-auto" />
        </Button>
      </Sidebar.Header>

      <Sidebar.Content>
        {/* Workspace Section */}
        <Sidebar.Group>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setWorkspacesCollapsed((prev) => !prev)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setWorkspacesCollapsed((prev) => !prev);
              }
            }}
            className="sidebar-section-head group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer hover:bg-surface-secondary transition-colors select-none"
            aria-expanded={!workspacesCollapsed}
            aria-label={workspacesCollapsed ? t('sidebar.expandWorkspaces') : t('sidebar.collapseWorkspaces')}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <RiArrowDownSLine
                className={`size-4 text-muted transition-transform duration-200 ${
                  workspacesCollapsed ? '-rotate-90' : ''
                }`}
              />
              <Sidebar.GroupLabel className="cursor-pointer p-0 font-medium text-foreground text-xs">
                {t('sidebar.workspaces')}
              </Sidebar.GroupLabel>
              <span className="text-[11px] text-muted font-normal">
                ({ownWorkspaces.length})
              </span>
            </div>
            <span className="relative inline-flex shrink-0">
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={t('sidebar.newWorkspace')}
                className="size-6 text-muted hover:text-foreground"
                onPress={() => onCreateWorkspace()}
                onClick={(e) => e.stopPropagation()}
              >
                <RiAddLine className="size-4" />
              </Button>
              <ShortcutHint id="newWorkspace" className="absolute -top-1.5 -right-1.5 z-10" />
            </span>
          </div>

          {!workspacesCollapsed && (
            <>
              {ownWorkspaces.length === 0 ? (
                <p className="sidebar-empty-hint text-muted px-3 py-2 text-xs">{t('sidebar.noWorkspaces')}</p>
              ) : (
              <>
                <ChatListView
                  key={`workspaces_${workspaceLimit}`}
                  aria-label={t('sidebar.workspaces')}
                  density="compact"
                  className="sidebar-chat-list"
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
                </ChatListView>

                {workspaceEntries.length > 5 && (
                  <div className="sidebar-list-more flex items-center justify-between px-2 pt-1">
                    {workspaceEntries.length > workspaceLimit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted hover:text-foreground font-normal"
                        onPress={() => setWorkspaceLimit((prev) => prev + 5)}
                      >
                        <span>{t('sidebar.showMore')}</span>
                      </Button>
                    ) : <span />}
                    {workspaceLimit > 5 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted hover:text-foreground font-normal"
                        onPress={() => setWorkspaceLimit(5)}
                      >
                        <span>{t('sidebar.collapse')}</span>
                      </Button>
                    ) : null}
                  </div>
                )}
              </>
              )}
              {foreignWorkspaceGroups.map((group) => {
                const backendLabel = group.profile
                  ? t('sidebar.backendLabel', { name: group.profile.name, url: group.profile.serverUrl })
                  : t('sidebar.backendRemoved');
                return (
                  <div key={group.profile?.id ?? 'removed'} className="mt-1.5 border-t border-separator/60 pt-1.5">
                    <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-1">
                      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/10" style={{ backgroundColor: backendLabelColor(group.profile) }} />
                      <span className="text-muted min-w-0 flex-1 truncate text-[11px] font-medium" title={backendLabel}>
                        {group.profile?.name || t('sidebar.backendRemoved')}
                      </span>
                      <Chip size="sm" variant="soft">{t('sidebar.otherBackend')}</Chip>
                    </div>
                    <ChatListView
                      aria-label={backendLabel}
                      density="compact"
                      className="sidebar-chat-list"
                      onAction={(key) => session.selectWorkspace(String(key))}
                    >
                      {group.workspaces.map((workspace) => {
                        const WorkspaceGlyph = workspaceIconComponent(workspace.icon);
                        return (
                          <ChatListView.Item
                            key={workspace.id}
                            id={workspace.id}
                            className="sidebar-item"
                            textValue={workspaceDisplayName(workspace)}
                          >
                            <ChatListView.ItemContent>
                              <ChatListView.Icon>
                                <span className="relative flex size-5 items-center justify-center">
                                  <WorkspaceGlyph className="size-4" color={workspace.iconColor} />
                                </span>
                              </ChatListView.Icon>
                              <ChatListView.Text className="flex-1">
                                <ChatListView.Title>{workspaceDisplayName(workspace)}</ChatListView.Title>
                                <ChatListView.Preview>{workspace.path}</ChatListView.Preview>
                              </ChatListView.Text>
                            </ChatListView.ItemContent>
                          </ChatListView.Item>
                        );
                      })}
                    </ChatListView>
                  </div>
                );
              })}
            </>
          )}
        </Sidebar.Group>

        {/* Conversation Section */}
        <Sidebar.Group>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setConversationsCollapsed((prev) => !prev)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setConversationsCollapsed((prev) => !prev);
              }
            }}
            className="sidebar-section-head group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer hover:bg-surface-secondary transition-colors select-none"
            aria-expanded={!conversationsCollapsed}
            aria-label={conversationsCollapsed ? t('sidebar.expandConversations') : t('sidebar.collapseConversations')}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <RiArrowDownSLine
                className={`size-4 text-muted transition-transform duration-200 ${
                  conversationsCollapsed ? '-rotate-90' : ''
                }`}
              />
              <Sidebar.GroupLabel className="cursor-pointer p-0 font-medium text-foreground text-xs">
                {t('sidebar.conversations')}
              </Sidebar.GroupLabel>
              <span className="text-[11px] text-muted font-normal">
                ({workspaceConversations.length})
              </span>
            </div>
            <span className="relative inline-flex shrink-0">
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={t('sidebar.newConversationAria')}
                className="size-6 text-muted hover:text-foreground"
                isDisabled={!session.activeWorkspaceId}
                onPress={() => onCreateConversation()}
                onClick={(e) => e.stopPropagation()}
              >
                <RiAddLine className="size-4" />
              </Button>
              <ShortcutHint id="newConversation" className="absolute -top-1.5 -right-1.5 z-10" />
            </span>
          </div>

          {!conversationsCollapsed && (
            workspaceConversations.length === 0 ? (
              <p className="sidebar-empty-hint text-muted px-3 py-2 text-xs">
                {session.activeWorkspaceId ? t('sidebar.noConversations') : t('sidebar.selectWorkspace')}
              </p>
            ) : (
              <>
                <ChatListView
                  key={`${session.activeWorkspaceId || 'no-workspace'}_${conversationLimit}`}
                  aria-label={t('sidebar.conversations')}
                  density="compact"
                  className="sidebar-chat-list"
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
                    return (
                      <ChatListView.Item
                        key={conversation.id}
                        id={conversation.id}
                        className={`sidebar-item ${isSelected ? 'is-selected' : ''} ${tasksDone ? 'opacity-60' : ''}`}
                        textValue={conversationDisplayTitle(conversation, session.timeline)}
                        onContextMenu={(event) => openContextMenu(event, 'conversation', conversation.id)}
                      >
                        <ChatListView.ItemContent>
                          <ChatListView.Icon>
                            <span className="relative flex size-5 items-center justify-center">
                              <ProviderIcon className="size-4" provider={conversation.provider} />
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-surface ${status?.color || 'hidden'}`}
                                aria-label={status?.label}
                              />
                            </span>
                          </ChatListView.Icon>
                          <ChatListView.Text>
                            <ChatListView.Title className={isSelected ? 'text-accent font-semibold' : tasksDone ? 'text-muted' : ''}>
                              {conversation.legacyPlaintext ? <span className="mr-1 inline-flex align-middle text-muted" role="img" title={t('history.readOnlyBadge')} aria-label={t('history.readOnlyBadge')}><RiLockLine className="size-3" aria-hidden="true" /></span> : null}{conversationDisplayTitle(conversation, session.timeline)}{pins.conversation.includes(conversation.id) ? <RiPushpin2Fill className="ml-1 inline size-3 text-muted" aria-label={t('sidebar.pinned')} /> : null}{taskMeta ? <Chip className="ml-1 inline-flex h-4 align-middle px-1.5 text-[10px]" color={tasksDone ? 'default' : 'accent'} size="sm" variant="soft" aria-label={t('sidebar.taskCount', { count: taskMeta.count })}>{tasksDone ? t('sidebar.tasksDone') : t('sidebar.tasksPlanning')}</Chip> : null}
                            </ChatListView.Title>
                            <ChatListView.Preview>{conversation.preview || t('sidebar.noMessages')}</ChatListView.Preview>
                          </ChatListView.Text>
                          <ChatListView.Meta>
                            {resetAt ? (
                              <Tooltip delay={300}>
                                <Tooltip.Trigger
                                  aria-label={t('controls.waitingReset', { time: formatResetInstant(resetAt) })}
                                  className="mr-1 inline-flex align-middle"
                                >
                                  <RiTimeLine className="size-3.5 text-warning" aria-hidden="true" />
                                </Tooltip.Trigger>
                                <Tooltip.Content placement="top" className="max-w-xs">
                                  {t('controls.waitingReset', { time: formatResetInstant(resetAt) })}
                                </Tooltip.Content>
                              </Tooltip>
                            ) : null}
                            {conversation.labelColor ? (
                              <span
                                aria-label={t('sidebar.labelColor')}
                                className="mr-1 inline-block size-2 rounded-full align-middle"
                                style={{ backgroundColor: conversation.labelColor }}
                              />
                            ) : null}
                            {isConversationHighlighted(conversation, session.activeConversationId, session.turnIds) ? t('sidebar.running') : ''}
                          </ChatListView.Meta>
                        </ChatListView.ItemContent>
                        {isConversationHighlighted(conversation, session.activeConversationId, session.turnIds) ? (
                          <span className="sr-only">{t('sidebar.running')}</span>
                        ) : null}
                      </ChatListView.Item>
                    );
                  })}
                </ChatListView>

                {sortedConversations.length > 5 && (
                  <div className="sidebar-list-more flex items-center justify-between px-2 pt-1">
                    {sortedConversations.length > conversationLimit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted hover:text-foreground font-normal"
                        onPress={() => setConversationLimit((prev) => prev + 5)}
                      >
                        <span>{t('sidebar.showMore')}</span>
                      </Button>
                    ) : <span />}
                    {conversationLimit > 5 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted hover:text-foreground font-normal"
                        onPress={() => setConversationLimit(5)}
                      >
                        <span>{t('sidebar.collapse')}</span>
                      </Button>
                    ) : null}
                  </div>
                )}
              </>
            )
          )}
        </Sidebar.Group>
      </Sidebar.Content>

      {contextMenu ? (
        <HeroContextMenu open onOpenChange={(open) => { if (!open) setContextMenu(null); }}>
          <div
            className="fixed z-50 w-44 rounded-xl border border-separator bg-overlay p-1 shadow-overlay"
            style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 184)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 200)) }}
            onClick={(event) => event.stopPropagation()}
          >
            {contextMenu.kind === 'group' ? (
              <HeroContextMenu.Menu aria-label={t('sidebar.groupMenu')} autoFocus="first" onClose={() => setContextMenu(null)}>
                <HeroContextMenu.Item id="rename-group" textValue={t('sidebar.renameGroup')} onAction={() => { if (contextGroup) setRenamingGroup({ id: contextGroup.id, name: contextGroup.name }); setContextMenu(null); }}><RiPencilLine className="size-4 text-muted" /><Label>{t('sidebar.renameGroup')}</Label></HeroContextMenu.Item>
                <HeroContextMenu.Item id="toggle-group" textValue={collapsedGroups.includes(contextMenu.id) ? t('sidebar.unfoldGroup') : t('sidebar.foldGroup')} onAction={() => { toggleGroupCollapsed(contextMenu.id); setContextMenu(null); }}><RiArrowDownSLine className="size-4 text-muted" /><Label>{collapsedGroups.includes(contextMenu.id) ? t('sidebar.unfoldGroup') : t('sidebar.foldGroup')}</Label></HeroContextMenu.Item>
                <HeroContextMenu.Separator />
                <HeroContextMenu.Item id="ungroup" textValue={t('sidebar.ungroup')} variant="danger" onAction={() => runGroupLayout(ungroupWorkspaceGroup(workspaceEntries, contextMenu.id))}><RiFoldersLine className="size-4 text-danger" /><Label>{t('sidebar.ungroup')}</Label></HeroContextMenu.Item>
              </HeroContextMenu.Menu>
            ) : (
            <HeroContextMenu.Menu aria-label={contextMenu.kind === 'workspace' ? t('sidebar.workspaceMenu') : t('sidebar.conversationMenu')} autoFocus="first" onClose={() => setContextMenu(null)}>
              {contextMenu.kind === 'conversation' && !contextReadOnly ? <HeroContextMenu.Item id="fork" textValue="Fork" onAction={() => runContextAction('fork')}><RiGitBranchLine className="size-4 text-muted" /><Label>Fork</Label></HeroContextMenu.Item> : null}
              {contextReadOnly ? null : <HeroContextMenu.Item id="rename" textValue={t('sidebar.rename')} onAction={() => runContextAction('rename')}><RiPencilLine className="size-4 text-muted" /><Label>{t('sidebar.rename')}</Label></HeroContextMenu.Item>}
              {contextMenu.kind === 'workspace' ? <HeroContextMenu.Item id="edit" textValue={t('sidebar.edit')} onAction={() => runContextAction('edit')}><RiEdit2Line className="size-4 text-muted" /><Label>{t('sidebar.edit')}</Label></HeroContextMenu.Item> : null}
              <HeroContextMenu.Item id="pin" textValue={pins[contextMenu.kind].includes(contextMenu.id) ? t('sidebar.unpin') : t('sidebar.pin')} onAction={() => runContextAction('pin')}><RiPushpin2Fill className="size-4 text-muted" /><Label>{pins[contextMenu.kind].includes(contextMenu.id) ? t('sidebar.unpin') : t('sidebar.pin')}</Label></HeroContextMenu.Item>
              {contextMenu.kind === 'workspace' ? (
                <HeroContextMenu.SubmenuTrigger>
                  <HeroContextMenu.Item id="workspace-icon" textValue={t('sidebar.workspaceIcon')}>
                    <RiPaletteLine className="size-4 text-muted" />
                    <Label>{t('sidebar.workspaceIcon')}</Label>
                    <HeroContextMenu.SubmenuIndicator />
                  </HeroContextMenu.Item>
                  <HeroContextMenu.Popover className="rounded-xl">
                    {(() => {
                      const menuWorkspace = session.workspaces.find((item) => item.id === contextMenu.id);
                      if (!menuWorkspace) return null;
                      return (
                        <div className="flex w-48 flex-col gap-2 p-2">
                          <div className="grid grid-cols-5 gap-1">
                            {WORKSPACE_ICON_CHOICES.map(({ key, Icon }) => (
                              <Button
                                key={key}
                                isIconOnly
                                size="sm"
                                variant={(menuWorkspace.icon ?? 'folder') === key ? 'secondary' : 'ghost'}
                                aria-label={key}
                                className="rounded-lg"
                                onPress={() => {
                                  session.updateWorkspace(contextMenu.id, { icon: key === 'folder' ? undefined : key });
                                  setContextMenu(null);
                                }}
                              >
                                <Icon className="size-4" />
                              </Button>
                            ))}
                          </div>
                          <ColorSwatchPicker
                            aria-label={t('sidebar.iconColor')}
                            value={menuWorkspace.iconColor ?? undefined}
                            onChange={(color) => {
                              session.updateWorkspace(contextMenu.id, { iconColor: color.toString('hex') });
                              setContextMenu(null);
                            }}
                          >
                            {BACKEND_LABEL_COLORS.map(({ value, label }) => (
                              <ColorSwatchPicker.Item key={value} color={value} aria-label={label}>
                                <ColorSwatchPicker.Swatch />
                                <ColorSwatchPicker.Indicator />
                              </ColorSwatchPicker.Item>
                            ))}
                          </ColorSwatchPicker>
                          <div className="flex items-center gap-2 px-1">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t('sidebar.ringStyle')}</span>
                            <span className="h-px flex-1 bg-separator" />
                          </div>
                          <div className="grid grid-cols-5 gap-1">
                            {WORKSPACE_RING_STYLES.map(({ key, labelKey }) => (
                              <Button
                                key={key}
                                isIconOnly
                                size="sm"
                                variant={ringStyleKey(menuWorkspace.ringStyle) === key ? 'secondary' : 'ghost'}
                                aria-label={t(labelKey)}
                                className="rounded-lg"
                                onPress={() => {
                                  session.updateWorkspace(contextMenu.id, { ringStyle: key === 'orbit' ? undefined : key });
                                  setContextMenu(null);
                                }}
                              >
                                <span className="relative flex size-5 items-center justify-center">
                                  <WorkspaceStatusRing kind="working" style={key} label={t(labelKey)} />
                                  <RiFolder3Line className="size-3.5 text-muted" />
                                </span>
                              </Button>
                            ))}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="justify-start rounded-lg"
                            onPress={() => {
                              session.updateWorkspace(contextMenu.id, { icon: undefined, iconColor: undefined, ringStyle: undefined });
                              setContextMenu(null);
                            }}
                          >
                            {t('sidebar.iconReset')}
                          </Button>
                        </div>
                      );
                    })()}
                  </HeroContextMenu.Popover>
                </HeroContextMenu.SubmenuTrigger>
              ) : null}
              {contextMoveTargets.length > 0 ? (
                <HeroContextMenu.SubmenuTrigger>
                  <HeroContextMenu.Item id="move-to-group" textValue={t('sidebar.moveToGroup')}>
                    <RiFolderTransferLine className="size-4 text-muted" />
                    <Label>{t('sidebar.moveToGroup')}</Label>
                    <HeroContextMenu.SubmenuIndicator />
                  </HeroContextMenu.Item>
                  <HeroContextMenu.Popover className="rounded-xl">
                    <div className="flex w-44 flex-col gap-0.5 p-1">
                      {contextMoveTargets.map((group) => (
                        <Button
                          key={group.id}
                          size="sm"
                          variant="ghost"
                          className="justify-start rounded-lg"
                          onPress={() => runGroupLayout(moveWorkspaceToGroup(workspaceEntries, contextMenu.id, group.id))}
                        >
                          <RiFoldersLine className="size-4 text-muted" />
                          <span className="truncate">{group.name || t('sidebar.newGroupName')}</span>
                        </Button>
                      ))}
                    </div>
                  </HeroContextMenu.Popover>
                </HeroContextMenu.SubmenuTrigger>
              ) : null}
              {contextWorkspaceGroupId ? <HeroContextMenu.Item id="remove-from-group" textValue={t('sidebar.removeFromGroup')} onAction={() => runGroupLayout(removeWorkspaceFromGroup(workspaceEntries, contextMenu.id))}><RiFolderReduceLine className="size-4 text-muted" /><Label>{t('sidebar.removeFromGroup')}</Label></HeroContextMenu.Item> : null}
              {contextMenu.kind === 'conversation' ? (
                <HeroContextMenu.SubmenuTrigger>
                  <HeroContextMenu.Item id="label-color" textValue={t('sidebar.labelColor')}>
                    <RiPriceTag3Line className="size-4 text-muted" />
                    <Label>{t('sidebar.labelColor')}</Label>
                    <HeroContextMenu.SubmenuIndicator />
                  </HeroContextMenu.Item>
                  <HeroContextMenu.Popover>
                    <div className="flex flex-col gap-1 p-2">
                      <ColorSwatchPicker
                        aria-label={t('sidebar.labelColor')}
                        value={session.conversations.find((item) => item.id === contextMenu.id)?.labelColor ?? undefined}
                        onChange={(color) => {
                          session.setConversationLabelColor(contextMenu.id, color.toString('hex'));
                          setContextMenu(null);
                        }}
                      >
                        {BACKEND_LABEL_COLORS.map(({ value, label }) => (
                          <ColorSwatchPicker.Item key={value} color={value} aria-label={label}>
                            <ColorSwatchPicker.Swatch />
                            <ColorSwatchPicker.Indicator />
                          </ColorSwatchPicker.Item>
                        ))}
                      </ColorSwatchPicker>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="justify-start"
                        onPress={() => {
                          session.setConversationLabelColor(contextMenu.id, undefined);
                          setContextMenu(null);
                        }}
                      >
                        {t('sidebar.labelClear')}
                      </Button>
                    </div>
                  </HeroContextMenu.Popover>
                </HeroContextMenu.SubmenuTrigger>
              ) : null}
              <HeroContextMenu.Separator />
              <HeroContextMenu.Item id="delete" textValue={t('common.delete')} variant="danger" onAction={() => runContextAction('delete')}><RiDeleteBinLine className="size-4 text-danger" /><Label>{t('common.delete')}</Label></HeroContextMenu.Item>
            </HeroContextMenu.Menu>
            )}
          </div>
        </HeroContextMenu>
      ) : null}

      {renamingGroup ? (
        <WorkspaceGroupRenameDialog
          initialName={renamingGroup.name}
          onSubmit={(name) => applyWorkspaceLayout(renameWorkspaceGroup(workspaceEntriesRef.current, renamingGroup.id, name))}
          onClose={() => setRenamingGroup(null)}
        />
      ) : null}

      <Sidebar.Footer>
        <div className="sidebar-footer-row flex items-center gap-1">
          {identityMenu}
        </div>
      </Sidebar.Footer>
    </Sidebar>
  );
}

import { RiPushpin2Fill, RiAddLine, RiPencilLine, RiEdit2Line, RiErrorWarningLine, RiFolder3Line, RiGitBranchLine, RiDeleteBinLine, RiArrowDownSLine, RiBarChartBoxLine, RiInformationLine, RiKanbanView2, RiPaletteLine, RiPriceTag3Line, RiPuzzle2Line, RiSettings3Line, RiTerminalBoxLine, RiUserSettingsLine } from '@remixicon/react';
import { Badge, Button, Chip, ColorSwatchPicker, Dropdown, Label, Tooltip } from '@heroui/react';
import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { ContextMenu as HeroContextMenu, ChatListView, Sidebar, useSidebar } from '@heroui-pro/react';
import { useSidebarPins } from '../session/useSidebarPins';
import { useKanbanTasks } from '../session/kanbanTasks';
import { BACKEND_LABEL_COLORS, backendLabelColor } from '../session/backendColors';
import { ProviderIcon } from './ProviderIcon';
import { AppIcon } from './AppIcon';
import { WORKSPACE_ICON_CHOICES, WORKSPACE_RING_STYLES, WorkspaceStatusRing, ringStyleKey, workspaceIconComponent } from './WorkspaceIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import { conversationDisplayTitle, getConversationStatus, isConversationHighlighted, workspaceDisplayName } from '../session/helpers';
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
  onOpenAbout: () => void;
  onOpenKanban: () => void;
};

type ContextMenu = { kind: 'workspace' | 'conversation'; id: string; x: number; y: number } | null;

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
  onOpenAbout,
  onOpenKanban,
}: Props) {
  const t = useT();
  const { isMobile, setMobileOpen } = useSidebar();
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

  const orderedWorkspaces = [...session.workspaces].sort((a, b) => Number(pins.workspace.includes(b.id)) - Number(pins.workspace.includes(a.id)) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
  const [draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null);
  const [dragIndicator, setDragIndicator] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const healthColor = session.connectionState !== 'open'
    ? 'danger'
    : session.connectionHealth.latencyMs !== null && session.connectionHealth.latencyMs <= 100
      ? 'success'
      : 'warning';

  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);

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
  const sortedWorkspaces = useMemo(() => [...session.workspaces].sort((a, b) => Number(pins.workspace.includes(b.id)) - Number(pins.workspace.includes(a.id)) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id)), [session.workspaces, pins.workspace]);

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

  const displayedWorkspaces = useMemo(() => {
    return sortedWorkspaces.slice(0, workspaceLimit);
  }, [sortedWorkspaces, workspaceLimit]);

  const displayedConversations = useMemo(() => {
    return sortedConversations.slice(0, conversationLimit);
  }, [sortedConversations, conversationLimit]);

  useEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-id]'));
    const cleanups = rows.map((row) => {
      const id = row.dataset.workspaceId || '';
      row.draggable = true;
      const start = (event: globalThis.DragEvent) => { event.dataTransfer?.setData('text/plain', id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; setDraggedWorkspaceId(id); };
      const over = (event: globalThis.DragEvent) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; const rect = row.getBoundingClientRect(); setDragIndicator({ id, position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' }); };
      const drop = (event: globalThis.DragEvent) => {
        event.preventDefault();
        const sourceId = draggedWorkspaceId || event.dataTransfer?.getData('text/plain');
        if (!sourceId || sourceId === id) { setDraggedWorkspaceId(null); setDragIndicator(null); return; }
        const from = orderedWorkspaces.findIndex((item) => item.id === sourceId);
        const to = orderedWorkspaces.findIndex((item) => item.id === id);
        if (from < 0 || to < 0) { setDraggedWorkspaceId(null); return; }
        const next = [...orderedWorkspaces]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
        next.forEach((item, index) => session.updateWorkspace(item.id, { sortOrder: index })); setDraggedWorkspaceId(null); setDragIndicator(null);
      };
      row.addEventListener('dragstart', start); row.addEventListener('dragover', over); row.addEventListener('drop', drop);
      return () => { row.removeEventListener('dragstart', start); row.removeEventListener('dragover', over); row.removeEventListener('drop', drop); };
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [displayedWorkspaces, orderedWorkspaces, draggedWorkspaceId, session]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  const openContextMenu = (event: MouseEvent, kind: 'workspace' | 'conversation', id: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind, id, x: event.clientX, y: event.clientY });
  };

  const runContextAction = (action: 'rename' | 'edit' | 'fork' | 'pin' | 'delete') => {
    if (!contextMenu) return;
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

  // Cached data renders immediately; the directory sync only blocks an
  // entirely empty sidebar (first run or cleared storage).
  if (session.directorySyncStatus === 'loading' && session.workspaces.length === 0) {
    return <Sidebar><Sidebar.Content><p className="text-muted px-3 py-4 text-sm">{t('sidebar.syncing')}</p></Sidebar.Content></Sidebar>;
  }

  return (
    <Sidebar>
      <Sidebar.Header>
        <Dropdown>
          <Dropdown.Trigger
            aria-label={t('sidebar.menu')}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-secondary active:bg-surface-secondary/70 transition-colors cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
              if (key === 'about') onOpenAbout();
            }}>
              <Dropdown.Item id="settings" textValue={t('app.settings')}><RiSettings3Line className="text-muted size-4 shrink-0" /><Label>{t('app.settings')}</Label></Dropdown.Item>
              <Dropdown.Item id="capabilities" textValue={t('app.mcpSkillManager')}><RiPuzzle2Line className="text-muted size-4 shrink-0" /><Label>{t('app.mcpSkillManager')}</Label></Dropdown.Item>
              <Dropdown.Item id="cli-manager" textValue={t('app.cliManager')}><RiTerminalBoxLine className="text-muted size-4 shrink-0" /><Label>{t('app.cliManager')}</Label></Dropdown.Item>
              <Dropdown.Item id="agent-providers" textValue={t('app.agentProviders')}><RiUserSettingsLine className="text-muted size-4 shrink-0" /><Label>{t('app.agentProviders')}</Label></Dropdown.Item>
              <Dropdown.Item id="usage" textValue={t('app.usage')}><RiBarChartBoxLine className="text-muted size-4 shrink-0" /><Label>{t('app.usage')}</Label></Dropdown.Item>
              <Dropdown.Item id="about" textValue={t('app.about')}><RiInformationLine className="text-muted size-4 shrink-0" /><Label>{t('app.about')}</Label></Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <Button
          className="connection-create-button mt-1 w-full justify-start"
          variant="secondary"
          isDisabled={!session.activeWorkspaceId}
          onPress={onCreateConversation}
        >
          <RiAddLine className="size-4" />
          <span data-sidebar="label">{t('sidebar.newConversation')}</span>
          <ShortcutHint id="newConversation" className="ml-auto" />
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
            className="group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer hover:bg-surface-secondary transition-colors select-none"
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
                ({session.workspaces.length})
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
            session.workspaces.length === 0 ? (
              <p className="text-muted px-3 py-2 text-xs">{t('sidebar.noWorkspaces')}</p>
            ) : (
              <>
                <ChatListView
                  key={`workspaces_${workspaceLimit}`}
                  aria-label={t('sidebar.workspaces')}
                  density="compact"
                  className="sidebar-chat-list"
                  onAction={(key) => {
                    const target = session.workspaces.find((item) => item.id === String(key));
                    if (target?.pathMissing) {
                      return;
                    }
                    session.selectWorkspace(String(key));
                  }}
                >
                  {displayedWorkspaces.map((workspace) => {
                    const isSelected = workspace.id === session.activeWorkspaceId;
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
                        className={`sidebar-item ${isSelected ? 'is-selected' : ''} ${isMissing ? 'opacity-50 cursor-not-allowed' : ''} ${dragIndicator?.id === workspace.id ? `drop-${dragIndicator.position}` : ''}`}
                        textValue={workspaceDisplayName(workspace)}
                        title={isMissing ? t('sidebar.workspaceMissingPath') : undefined}
                        data-workspace-id={workspace.id}
                        {...({ draggable: true, onDragStart: (event: globalThis.DragEvent) => { event.dataTransfer?.setData('text/plain', workspace.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; setDraggedWorkspaceId(workspace.id); }, onDragOver: (event: globalThis.DragEvent) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; }, onDrop: (event: globalThis.DragEvent) => { event.preventDefault(); const sourceId = draggedWorkspaceId || event.dataTransfer?.getData('text/plain'); if (!sourceId || sourceId === workspace.id) { setDraggedWorkspaceId(null); return; } const from = orderedWorkspaces.findIndex((item) => item.id === sourceId); const to = orderedWorkspaces.findIndex((item) => item.id === workspace.id); if (from < 0 || to < 0) { setDraggedWorkspaceId(null); return; } const next = [...orderedWorkspaces]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); next.forEach((item, index) => session.updateWorkspace(item.id, { sortOrder: index })); setDraggedWorkspaceId(null); setDragIndicator(null); }, onDragEnd: () => { setDraggedWorkspaceId(null); setDragIndicator(null); } } as any)} onContextMenu={(event) => openContextMenu(event, 'workspace', workspace.id)}
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
                  })}
                </ChatListView>

                {sortedWorkspaces.length > 5 && (
                  <div className="flex items-center justify-between px-2 pt-1">
                    {sortedWorkspaces.length > workspaceLimit ? (
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
            )
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
            className="group flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer hover:bg-surface-secondary transition-colors select-none"
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
              <p className="text-muted px-3 py-2 text-xs">
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
                    }
                  }}
                >
                  {displayedConversations.map((conversation) => {
                    const isSelected = conversation.id === session.activeConversationId;
                    const status = getConversationStatus(session, conversation, timelineInfoMap[conversation.id]?.latestEntry, timelineInfoMap[conversation.id]?.latestIncomingAt);
                    const taskMeta = conversationTaskMetaMap[conversation.id];
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
                              {conversationDisplayTitle(conversation, session.timeline)}{pins.conversation.includes(conversation.id) ? <RiPushpin2Fill className="ml-1 inline size-3 text-muted" aria-label={t('sidebar.pinned')} /> : null}{taskMeta ? <Chip className="ml-1 inline-flex h-4 align-middle px-1.5 text-[10px]" color={tasksDone ? 'default' : 'accent'} size="sm" variant="soft" aria-label={t('sidebar.taskCount', { count: taskMeta.count })}>{tasksDone ? t('sidebar.tasksDone') : t('sidebar.tasksPlanning')}</Chip> : null}
                            </ChatListView.Title>
                            <ChatListView.Preview>{conversation.preview || t('sidebar.noMessages')}</ChatListView.Preview>
                          </ChatListView.Text>
                          <ChatListView.Meta>
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
                  <div className="flex items-center justify-between px-2 pt-1">
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
            <HeroContextMenu.Menu aria-label={contextMenu.kind === 'workspace' ? t('sidebar.workspaceMenu') : t('sidebar.conversationMenu')} autoFocus="first" onClose={() => setContextMenu(null)}>
              {contextMenu.kind === 'conversation' ? <HeroContextMenu.Item id="fork" textValue="Fork" onAction={() => runContextAction('fork')}><RiGitBranchLine className="size-4 text-muted" /><Label>Fork</Label></HeroContextMenu.Item> : null}
              <HeroContextMenu.Item id="rename" textValue={t('sidebar.rename')} onAction={() => runContextAction('rename')}><RiPencilLine className="size-4 text-muted" /><Label>{t('sidebar.rename')}</Label></HeroContextMenu.Item>
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
          </div>
        </HeroContextMenu>
      ) : null}
    </Sidebar>
  );
}

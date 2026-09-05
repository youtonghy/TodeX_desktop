import { RiAddLine, RiArrowDownSLine, RiBarChartBoxLine, RiFolder3Line, RiInformationLine, RiKanbanView2, RiPuzzle2Line, RiSettings3Line, RiTerminalBoxLine } from '@remixicon/react';
import { Badge, Button, Chip, Dropdown, Label } from '@heroui/react';
import { useEffect, useMemo, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { ChatListView, Sidebar, useSidebar } from '@heroui-pro/react';
import { ProviderIcon } from './ProviderIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import { conversationDisplayTitle, isConversationHighlighted, workspaceDisplayName } from '../session/helpers';

type Props = {
  session: TodeXSession;
  onCreateWorkspace: () => void;
  onCreateConversation: () => void;
  onOpenSettings: () => void;
  onOpenCapabilities: () => void;
  onOpenCliManager: () => void;
  onOpenUsage: () => void;
  onOpenAbout: () => void;
  onOpenKanban: () => void;
};

type ContextMenu = { kind: 'workspace' | 'conversation'; id: string; x: number; y: number } | null;

function getConversationStatus(
  session: TodeXSession,
  conversation: TodeXSession['conversations'][number],
  latestEntry?: TodeXSession['timeline'][number],
): { color: string; label: string } | null {
  if (isConversationHighlighted(conversation, session.activeConversationId, session.turnIds)) {
    return { color: 'bg-green-500', label: '正在工作' };
  }
  if (
    /error|failed|异常|失败/i.test(conversation.nativeStatus || '') ||
    /error|failed|异常|失败/i.test(latestEntry?.title || '')
  ) {
    return { color: 'bg-amber-500', label: '遇到问题' };
  }
  if (conversation.id !== session.activeConversationId && latestEntry?.kind === 'incoming') {
    return { color: 'bg-blue-500', label: '有未读回复' };
  }
  return null;
}

export function AppSidebar({
  session,
  onCreateWorkspace,
  onCreateConversation,
  onOpenSettings,
  onOpenCapabilities,
  onOpenCliManager,
  onOpenUsage,
  onOpenAbout,
  onOpenKanban,
}: Props) {
  const { isMobile, setMobileOpen } = useSidebar();
  if (session.directorySyncStatus === 'loading') return <Sidebar><Sidebar.Content><p className="text-muted px-3 py-4 text-sm">正在同步目录…</p></Sidebar.Content></Sidebar>;

  const workspaceConversations = useMemo(() => (
    session.conversations.filter(
      (conversation) => conversation.workspaceId === session.activeWorkspaceId && !conversation.archived,
    )
  ), [session.activeWorkspaceId, session.conversations]);

  const orderedWorkspaces = [...session.workspaces].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
  const [draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null);
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
    const map: Record<string, { latestAt: number; latestEntry?: TodeXSession['timeline'][number] }> = {};
    const timeline = session.timeline;
    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i];
      if (entry?.conversationId && entry?.at) {
        const existing = map[entry.conversationId];
        if (!existing || entry.at > existing.latestAt) {
          map[entry.conversationId] = { latestAt: entry.at, latestEntry: entry };
        }
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

  // Workspaces use an explicit manual order and never move when a conversation updates.
  const sortedWorkspaces = useMemo(() => [...session.workspaces].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id)), [session.workspaces]);

  // Stable sorting for conversations: based on last message/updated time, never jumps upon clicking
  const sortedConversations = useMemo(() => {
    return [...workspaceConversations].sort((a, b) => {
      const aTime = Math.max(a.updatedAt || 0, a.createdAt || 0);
      const bTime = Math.max(b.updatedAt || 0, b.createdAt || 0);
      if (bTime !== aTime) return bTime - aTime;
      if ((b.createdAt || 0) !== (a.createdAt || 0)) return (b.createdAt || 0) - (a.createdAt || 0);
      return a.id.localeCompare(b.id);
    });
  }, [workspaceConversations, timelineInfoMap]);

  const displayedWorkspaces = useMemo(() => {
    return sortedWorkspaces.slice(0, workspaceLimit);
  }, [sortedWorkspaces, workspaceLimit]);

  const displayedConversations = useMemo(() => {
    return sortedConversations.slice(0, conversationLimit);
  }, [sortedConversations, conversationLimit]);

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

  const runContextAction = (action: 'rename' | 'fork' | 'delete') => {
    if (!contextMenu) return;
    if (contextMenu.kind === 'workspace') {
      const workspace = session.workspaces.find((item) => item.id === contextMenu.id);
      if (!workspace) return;
      if (action === 'rename') {
        const name = window.prompt('新的工作区名称', workspace.name);
        if (name) session.renameWorkspace(workspace.id, name);
      } else if (action === 'fork') session.forkWorkspace(workspace.id);
      else session.removeWorkspace(workspace.id);
    } else {
      const conversation = session.conversations.find((item) => item.id === contextMenu.id);
      if (!conversation) return;
      if (action === 'rename') {
        const title = window.prompt('新的对话标题', conversation.title);
        if (title) session.renameConversation(conversation.id, title);
      } else if (action === 'fork') session.forkConversation(conversation.id);
      else session.removeConversation(conversation.id);
    }
    setContextMenu(null);
  };

  return (
    <Sidebar>
      <Sidebar.Header>
        <Dropdown>
          <Dropdown.Trigger
            aria-label="TodeX 菜单"
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-secondary active:bg-surface-secondary/70 transition-colors cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Badge.Anchor className="shrink-0">
              <div className="bg-accent size-8 rounded-full" aria-hidden="true" />
              <Badge color={healthColor} placement="bottom-right" size="sm" aria-label={session.connectionState === 'open' ? '后端已连接' : '后端未连接'} />
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
              if (key === 'usage') onOpenUsage();
              if (key === 'about') onOpenAbout();
            }}>
              <Dropdown.Item id="settings" textValue="设置"><RiSettings3Line className="text-muted size-4 shrink-0" /><Label>设置</Label></Dropdown.Item>
              <Dropdown.Item id="capabilities" textValue="MCP / Skill 管理"><RiPuzzle2Line className="text-muted size-4 shrink-0" /><Label>MCP / Skill 管理</Label></Dropdown.Item>
              <Dropdown.Item id="cli-manager" textValue="CLI 管理"><RiTerminalBoxLine className="text-muted size-4 shrink-0" /><Label>CLI 管理</Label></Dropdown.Item>
              <Dropdown.Item id="usage" textValue="使用统计"><RiBarChartBoxLine className="text-muted size-4 shrink-0" /><Label>使用统计</Label></Dropdown.Item>
              <Dropdown.Item id="about" textValue="关于"><RiInformationLine className="text-muted size-4 shrink-0" /><Label>关于</Label></Dropdown.Item>
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
          <span data-sidebar="label">增加对话</span>
        </Button>
        <Button className="mt-1 w-full justify-start" variant="ghost" onPress={onOpenKanban}>
          <RiKanbanView2 className="size-4" />
          <span data-sidebar="label">今日看板</span>
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
            aria-label={workspacesCollapsed ? '展开工作区' : '收起工作区'}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <RiArrowDownSLine
                className={`size-4 text-muted transition-transform duration-200 ${
                  workspacesCollapsed ? '-rotate-90' : ''
                }`}
              />
              <Sidebar.GroupLabel className="cursor-pointer p-0 font-medium text-foreground text-xs">
                工作区
              </Sidebar.GroupLabel>
              <span className="text-[11px] text-muted font-normal">
                ({session.workspaces.length})
              </span>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="新建工作区"
              className="size-6 text-muted hover:text-foreground"
              onPress={() => onCreateWorkspace()}
              onClick={(e) => e.stopPropagation()}
            >
              <RiAddLine className="size-4" />
            </Button>
          </div>

          {!workspacesCollapsed && (
            session.workspaces.length === 0 ? (
              <p className="text-muted px-3 py-2 text-xs">还没有工作区。</p>
            ) : (
              <>
                <ChatListView
                  key={`workspaces_${workspaceLimit}`}
                  aria-label="工作区"
                  density="compact"
                  className="sidebar-chat-list"
                  onAction={(key) => session.selectWorkspace(String(key))}
                >
                  {displayedWorkspaces.map((workspace) => {
                    const isSelected = workspace.id === session.activeWorkspaceId;
                    return (
                      <ChatListView.Item
                        key={workspace.id}
                        id={workspace.id}
                        className={`sidebar-item ${isSelected ? 'is-selected' : ''}`}
                        textValue={workspaceDisplayName(workspace)}
                        {...({ draggable: true, onDragStart: (event: DragEvent) => { event.dataTransfer?.setData('text/plain', workspace.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; setDraggedWorkspaceId(workspace.id); }, onDragOver: (event: DragEvent) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; }, onDrop: (event: DragEvent) => { event.preventDefault(); const sourceId = draggedWorkspaceId || event.dataTransfer?.getData('text/plain'); if (!sourceId || sourceId === workspace.id) { setDraggedWorkspaceId(null); return; } const from = orderedWorkspaces.findIndex((item) => item.id === sourceId); const to = orderedWorkspaces.findIndex((item) => item.id === workspace.id); if (from < 0 || to < 0) { setDraggedWorkspaceId(null); return; } const next = [...orderedWorkspaces]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); next.forEach((item, index) => session.updateWorkspace(item.id, { sortOrder: index })); setDraggedWorkspaceId(null); }, onDragEnd: () => setDraggedWorkspaceId(null) } as any)} onContextMenu={(event) => openContextMenu(event, 'workspace', workspace.id)}
                      >
                        <ChatListView.ItemContent>
                          <ChatListView.Icon>
                            <RiFolder3Line className={`size-4 ${isSelected ? 'text-accent' : ''}`} />
                          </ChatListView.Icon>
                          <ChatListView.Text>
                            <ChatListView.Title className={isSelected ? 'text-accent font-semibold' : ''}>
                              {workspaceDisplayName(workspace)}
                            </ChatListView.Title>
                            <ChatListView.Preview>{workspace.path}</ChatListView.Preview>
                          </ChatListView.Text>
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
                        <span>显示更多 (+5)</span>
                      </Button>
                    ) : <span />}
                    {workspaceLimit > 5 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted hover:text-foreground font-normal"
                        onPress={() => setWorkspaceLimit(5)}
                      >
                        <span>收起</span>
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
            aria-label={conversationsCollapsed ? '展开对话' : '收起对话'}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <RiArrowDownSLine
                className={`size-4 text-muted transition-transform duration-200 ${
                  conversationsCollapsed ? '-rotate-90' : ''
                }`}
              />
              <Sidebar.GroupLabel className="cursor-pointer p-0 font-medium text-foreground text-xs">
                对话
              </Sidebar.GroupLabel>
              <span className="text-[11px] text-muted font-normal">
                ({workspaceConversations.length})
              </span>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="新建对话"
              className="size-6 text-muted hover:text-foreground"
              isDisabled={!session.activeWorkspaceId}
              onPress={() => onCreateConversation()}
              onClick={(e) => e.stopPropagation()}
            >
              <RiAddLine className="size-4" />
            </Button>
          </div>

          {!conversationsCollapsed && (
            workspaceConversations.length === 0 ? (
              <p className="text-muted px-3 py-2 text-xs">
                {session.activeWorkspaceId ? '这个工作区还没有对话。' : '选择工作区后可创建对话。'}
              </p>
            ) : (
              <>
                <ChatListView
                  key={`${session.activeWorkspaceId || 'no-workspace'}_${conversationLimit}`}
                  aria-label="对话"
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
                    const status = getConversationStatus(session, conversation, timelineInfoMap[conversation.id]?.latestEntry);
                    return (
                      <ChatListView.Item
                        key={conversation.id}
                        id={conversation.id}
                        className={`sidebar-item ${isSelected ? 'is-selected' : ''}`}
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
                            <ChatListView.Title className={isSelected ? 'text-accent font-semibold' : ''}>
                              {conversationDisplayTitle(conversation, session.timeline)}
                            </ChatListView.Title>
                            <ChatListView.Preview>{conversation.preview || '还没有消息'}</ChatListView.Preview>
                          </ChatListView.Text>
                          <ChatListView.Meta>{isConversationHighlighted(conversation, session.activeConversationId, session.turnIds) ? '运行中' : ''}</ChatListView.Meta>
                        </ChatListView.ItemContent>
                        {isConversationHighlighted(conversation, session.activeConversationId, session.turnIds) ? (
                          <span className="sr-only">运行中</span>
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
                        <span>显示更多 (+5)</span>
                      </Button>
                    ) : <span />}
                    {conversationLimit > 5 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted hover:text-foreground font-normal"
                        onPress={() => setConversationLimit(5)}
                      >
                        <span>收起</span>
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
        <div
          role="menu"
          aria-label="上下文菜单"
          className="fixed z-50 min-w-36 rounded-lg border border-separator bg-surface p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" className="context-menu-item" onClick={() => runContextAction('rename')}>改名</button>
          <button type="button" role="menuitem" className="context-menu-item" onClick={() => runContextAction('fork')}>Fork</button>
          <button type="button" role="menuitem" className="context-menu-item text-danger" onClick={() => runContextAction('delete')}>删除</button>
        </div>
      ) : null}
    </Sidebar>
  );
}

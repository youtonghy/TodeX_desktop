import { RiAddLine, RiBarChartBoxLine, RiFolder3Line, RiInformationLine, RiKanbanView2, RiPuzzle2Line, RiSettings3Line } from '@remixicon/react';
import { Badge, Button, Chip, Dropdown, Label } from '@heroui/react';
import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { ChatListView, Sidebar } from '@heroui-pro/react';
import { ProviderIcon } from './ProviderIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import { conversationDisplayTitle, isConversationHighlighted, workspaceDisplayName } from '../session/helpers';

type Props = {
  session: TodeXSession;
  onCreateWorkspace: () => void;
  onCreateConversation: () => void;
  onOpenSettings: () => void;
  onOpenCapabilities: () => void;
  onOpenUsage: () => void;
  onOpenAbout: () => void;
  onOpenKanban: () => void;
};

type ContextMenu = { kind: 'workspace' | 'conversation'; id: string; x: number; y: number } | null;

function conversationStatus(session: TodeXSession, conversation: TodeXSession['conversations'][number]): { color: string; label: string } | null {
  const latest = session.timeline
    .filter((entry) => entry.conversationId === conversation.id)
    .sort((left, right) => right.at - left.at)[0];
  if (isConversationHighlighted(conversation, session.activeConversationId, session.turnIds)) {
    return { color: 'bg-green-500', label: '正在工作' };
  }
  if (/error|failed|异常|失败/i.test(conversation.nativeStatus || '') || /error|failed|异常|失败/i.test(latest?.title || '')) {
    return { color: 'bg-amber-500', label: '遇到问题' };
  }
  if (conversation.id !== session.activeConversationId && latest?.kind === 'incoming') {
    return { color: 'bg-blue-500', label: '有未读回复' };
  }
  return null;
}

export function AppSidebar({ session, onCreateWorkspace, onCreateConversation, onOpenSettings, onOpenCapabilities, onOpenUsage, onOpenAbout, onOpenKanban }: Props) {
  const workspaceConversations = session.conversations.filter(
    (conversation) => conversation.workspaceId === session.activeWorkspaceId && !conversation.archived,
  );
  const healthColor = session.connectionState !== 'open'
    ? 'danger'
    : session.connectionHealth.latencyMs !== null && session.connectionHealth.latencyMs <= 100
      ? 'success'
      : 'warning';
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);

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
          <Dropdown.Trigger aria-label="TodeX 菜单" className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left">
            <Badge.Anchor className="shrink-0">
              <div className="bg-accent size-8 rounded-full" aria-hidden="true" />
              <Badge color={healthColor} placement="bottom-right" size="sm" aria-label={session.connectionState === 'open' ? '后端已连接' : '后端未连接'} />
            </Badge.Anchor>
            <span className="flex min-w-0 flex-1 items-center gap-1.5" data-sidebar="label">
              <span className="text-foreground truncate text-sm font-semibold">TodeX</span>
              <Chip size="sm" variant="soft">V2</Chip>
            </span>
            <RiSettings3Line className="size-4 shrink-0" />
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu onAction={(key) => {
              if (key === 'settings') onOpenSettings();
              if (key === 'capabilities') onOpenCapabilities();
              if (key === 'usage') onOpenUsage();
              if (key === 'about') onOpenAbout();
            }}>
              <Dropdown.Item id="settings" textValue="设置"><RiSettings3Line className="text-muted size-4 shrink-0" /><Label>设置</Label></Dropdown.Item>
              <Dropdown.Item id="capabilities" textValue="MCP / Skill 管理"><RiPuzzle2Line className="text-muted size-4 shrink-0" /><Label>MCP / Skill 管理</Label></Dropdown.Item>
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
        <Sidebar.Group>
          <div className="flex items-center justify-between px-2">
            <Sidebar.GroupLabel>工作区</Sidebar.GroupLabel>
            <Button isIconOnly size="sm" variant="ghost" aria-label="新建工作区" onPress={onCreateWorkspace}>
              <RiAddLine className="size-4" />
            </Button>
          </div>
          {session.workspaces.length === 0 ? (
            <p className="text-muted px-3 py-2 text-xs">还没有工作区。</p>
          ) : (
            <ChatListView
              aria-label="工作区"
              density="compact"
              items={session.workspaces}
              onAction={(key) => session.selectWorkspace(String(key))}
            >
              {(workspace) => (
              <ChatListView.Item key={workspace.id} id={workspace.id} textValue={workspaceDisplayName(workspace)} onContextMenu={(event) => openContextMenu(event, 'workspace', workspace.id)}>
                <ChatListView.ItemContent>
                  <ChatListView.Icon><RiFolder3Line className="size-4" /></ChatListView.Icon>
                  <ChatListView.Text>
                    <ChatListView.Title>{workspaceDisplayName(workspace)}</ChatListView.Title>
                    <ChatListView.Preview>{workspace.path}</ChatListView.Preview>
                  </ChatListView.Text>
                </ChatListView.ItemContent>
              </ChatListView.Item>
            )}
            </ChatListView>
          )}
        </Sidebar.Group>
        <Sidebar.Group>
          <div className="flex items-center justify-between px-2">
            <Sidebar.GroupLabel>对话</Sidebar.GroupLabel>
            <Button isIconOnly size="sm" variant="ghost" aria-label="新建对话" isDisabled={!session.activeWorkspaceId} onPress={onCreateConversation}>
              <RiAddLine className="size-4" />
            </Button>
          </div>
          {workspaceConversations.length === 0 ? (
            <p className="text-muted px-3 py-2 text-xs">
              {session.activeWorkspaceId ? '这个工作区还没有对话。' : '选择工作区后可创建对话。'}
            </p>
          ) : (
            <ChatListView
              aria-label="对话"
              density="compact"
              items={workspaceConversations}
              onAction={(key) => {
                const conversation = workspaceConversations.find((item) => item.id === String(key));
                if (conversation) session.selectConversation(conversation.workspaceId, conversation.id);
              }}
            >
            {(conversation) => (
              <ChatListView.Item key={conversation.id} id={conversation.id} textValue={conversationDisplayTitle(conversation, session.timeline)} onContextMenu={(event) => openContextMenu(event, 'conversation', conversation.id)}>
                <ChatListView.ItemContent>
                  <ChatListView.Icon>
                    {(() => {
                      const status = conversationStatus(session, conversation);
                      return <span className="relative flex size-5 items-center justify-center"><ProviderIcon className="size-4" provider={conversation.provider} /><span className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-surface ${status?.color || 'hidden'}`} aria-label={status?.label} /></span>;
                    })()}
                  </ChatListView.Icon>
                  <ChatListView.Text>
                    <ChatListView.Title>{conversationDisplayTitle(conversation, session.timeline)}</ChatListView.Title>
                    <ChatListView.Preview>{conversation.preview || '还没有消息'}</ChatListView.Preview>
                  </ChatListView.Text>
                  <ChatListView.Meta>{isConversationHighlighted(conversation, session.activeConversationId, session.turnIds) ? '运行中' : ''}</ChatListView.Meta>
                </ChatListView.ItemContent>
                {isConversationHighlighted(conversation, session.activeConversationId, session.turnIds) ? (
                  <span className="sr-only">运行中</span>
                ) : null}
              </ChatListView.Item>
            )}
            </ChatListView>
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

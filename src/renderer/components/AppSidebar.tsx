import { Folder, Gear, Plus } from '@gravity-ui/icons';
import { Badge, Button, Dropdown } from '@heroui/react';
import { ChatListView, Sidebar } from '@heroui-pro/react';
import type { TodeXSession } from '../session/useTodeXSession';
import { isConversationHighlighted } from '../session/helpers';

type Props = {
  session: TodeXSession;
  onCreateWorkspace: () => void;
  onCreateConversation: () => void;
  onOpenSettings: () => void;
};

export function AppSidebar({ session, onCreateWorkspace, onCreateConversation, onOpenSettings }: Props) {
  const workspaceConversations = session.conversations.filter(
    (conversation) => conversation.workspaceId === session.activeWorkspaceId && !conversation.archived,
  );
  const healthColor = session.connectionState !== 'open'
    ? 'danger'
    : session.connectionHealth.latencyMs !== null && session.connectionHealth.latencyMs <= 100
      ? 'success'
      : 'warning';

  return (
    <Sidebar>
      <Sidebar.Header>
        <div className="flex items-center gap-2 px-1 py-2">
          <Badge.Anchor className="shrink-0">
            <div className="bg-accent size-8 rounded-full" aria-hidden="true" />
            <Badge
              color={healthColor}
              placement="bottom-right"
              size="sm"
              aria-label={session.connectionState === 'open' ? '后端已连接' : '后端未连接'}
            />
          </Badge.Anchor>
          <span className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold" data-sidebar="label">TodeX</span>
          <Button isIconOnly size="sm" variant="ghost" aria-label="设置" onPress={onOpenSettings}>
            <Gear className="size-4" />
          </Button>
        </div>
        <Button
          className="connection-create-button mt-1 w-full justify-start"
          variant="secondary"
          isDisabled={!session.activeWorkspaceId}
          onPress={onCreateConversation}
        >
          <Plus className="size-4" />
          <span data-sidebar="label">增加对话</span>
        </Button>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <div className="flex items-center justify-between px-2">
            <Sidebar.GroupLabel>工作区</Sidebar.GroupLabel>
            <Button isIconOnly size="sm" variant="ghost" aria-label="新建工作区" onPress={onCreateWorkspace}>
              <Plus className="size-4" />
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
              <ChatListView.Item key={workspace.id} id={workspace.id} textValue={workspace.name}>
                <ChatListView.ItemContent>
                  <ChatListView.Icon><Folder className="size-4" /></ChatListView.Icon>
                  <ChatListView.Text>
                    <ChatListView.Title>{workspace.name}</ChatListView.Title>
                    <ChatListView.Preview>{workspace.path}</ChatListView.Preview>
                  </ChatListView.Text>
                  <Dropdown>
                    <Dropdown.Trigger aria-label="工作区操作" className="inline-flex size-7 items-center justify-center rounded-md">
                      ···
                    </Dropdown.Trigger>
                    <Dropdown.Popover>
                      <Dropdown.Menu
                        onAction={(key) => {
                          if (key === 'rename') {
                            const name = window.prompt('新的工作区名称', workspace.name);
                            if (name) session.renameWorkspace(workspace.id, name);
                          }
                          if (key === 'fork') session.forkWorkspace(workspace.id);
                          if (key === 'delete') session.removeWorkspace(workspace.id);
                        }}
                      >
                        <Dropdown.Item id="rename" textValue="改名">改名</Dropdown.Item>
                        <Dropdown.Item id="fork" textValue="Fork">Fork</Dropdown.Item>
                        <Dropdown.Item id="delete" textValue="删除">删除</Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
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
              <Plus className="size-4" />
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
              <ChatListView.Item key={conversation.id} id={conversation.id} textValue={conversation.title}>
                <ChatListView.ItemContent>
                  <ChatListView.Icon><span className="text-xs font-semibold">{conversation.provider?.slice(0, 1).toUpperCase() || 'C'}</span></ChatListView.Icon>
                  <ChatListView.Text>
                    <ChatListView.Title>{conversation.title}</ChatListView.Title>
                    <ChatListView.Preview>{conversation.preview || '还没有消息'}</ChatListView.Preview>
                  </ChatListView.Text>
                  <ChatListView.Meta>{isConversationHighlighted(conversation, session.activeConversationId, session.turnIds) ? '运行中' : ''}</ChatListView.Meta>
                  <Dropdown>
                    <Dropdown.Trigger aria-label="对话操作" className="inline-flex size-7 items-center justify-center rounded-md">
                      ···
                    </Dropdown.Trigger>
                    <Dropdown.Popover>
                      <Dropdown.Menu
                        onAction={(key) => {
                          if (key === 'rename') {
                            const title = window.prompt('新的对话标题', conversation.title);
                            if (title) session.renameConversation(conversation.id, title);
                          }
                          if (key === 'fork') session.forkConversation(conversation.id);
                          if (key === 'delete') session.removeConversation(conversation.id);
                        }}
                      >
                        <Dropdown.Item id="rename" textValue="改名">改名</Dropdown.Item>
                        <Dropdown.Item id="fork" textValue="Fork">Fork</Dropdown.Item>
                        <Dropdown.Item id="delete" textValue="删除">删除</Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
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
    </Sidebar>
  );
}

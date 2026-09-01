import { FaceRobot, Folder, Gear, Plus } from '@gravity-ui/icons';
import { Badge, Button, Dropdown, Label, ListBox, Select } from '@heroui/react';
import { Sidebar } from '@heroui-pro/react';
import type { TodeXSession } from '../session/useTodeXSession';
import { connectionStateLabel, isConversationHighlighted } from '../session/helpers';
import type { ProviderKind } from '@todex/protocol/v2';

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
  const activeProvider = session.activeConversation?.provider || '';
  const availableProviders = session.v2Providers.filter((item) => item.available);
  const healthColor = session.connectionState !== 'open'
    ? 'danger'
    : session.connectionHealth.latencyMs !== null && session.connectionHealth.latencyMs <= 100
      ? 'success'
      : 'warning';
  const connectionLabel = session.connectionState === 'open'
    ? session.connectionHealth.latencyMs === null ? '在线' : `${session.connectionHealth.latencyMs} ms`
    : connectionStateLabel(session.connectionState);

  return (
    <Sidebar>
      <Sidebar.Header>
        <div className="flex items-center gap-2 px-1 py-2">
          <Badge.Anchor className="shrink-0">
            <div className="bg-accent text-accent-foreground flex size-8 items-center justify-center rounded-full">
              <FaceRobot className="size-4" />
            </div>
            <Badge color={healthColor} placement="bottom-right" size="sm">{connectionLabel}</Badge>
          </Badge.Anchor>
          <span className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold" data-sidebar="label">TodeX</span>
          <Button isIconOnly size="sm" variant="ghost" aria-label="设置" onPress={onOpenSettings}>
            <Gear className="size-4" />
          </Button>
        </div>
        <Select
          className="connection-select mt-1"
          selectedKey={activeProvider || null}
          isDisabled={!session.activeConversation || availableProviders.length === 0}
          aria-label="选择连接 Agent"
          onSelectionChange={(key) => {
            if (typeof key === 'string' && key && session.activeConversation && key !== activeProvider) {
              session.switchConversationAgent(session.activeConversation.id, key as ProviderKind);
            }
          }}
        >
          <Label className="hidden">选择连接 Agent</Label>
          <Select.Trigger className="connection-select__trigger">
            <Select.Value>
              <FaceRobot className="size-4 shrink-0" />
              <span data-sidebar="label" className="truncate">{activeProvider || '选择连接'}</span>
            </Select.Value>
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {availableProviders.map((provider) => (
                <ListBox.Item key={provider.id} id={provider.id} textValue={provider.displayName}>
                  <FaceRobot className="size-4" />
                  <span>{provider.displayName}</span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
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
            <Sidebar.Menu aria-label="工作区">
              {session.workspaces.map((workspace) => (
              <Sidebar.MenuItem
                key={workspace.id}
                id={workspace.id}
                isCurrent={workspace.id === session.activeWorkspaceId}
                textValue={workspace.name}
                onAction={() => session.selectWorkspace(workspace.id)}
              >
                <Sidebar.MenuIcon>
                  <Folder className="size-4" />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{workspace.name}</Sidebar.MenuLabel>
                <Sidebar.MenuActions>
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
                </Sidebar.MenuActions>
              </Sidebar.MenuItem>
            ))}
          </Sidebar.Menu>
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
            <Sidebar.Menu aria-label="对话">
            {workspaceConversations.map((conversation) => (
              <Sidebar.MenuItem
                key={conversation.id}
                id={conversation.id}
                isCurrent={conversation.id === session.activeConversationId}
                textValue={conversation.title}
                onAction={() => session.selectConversation(conversation.workspaceId, conversation.id)}
              >
                <Sidebar.MenuLabel>{conversation.title}</Sidebar.MenuLabel>
                {isConversationHighlighted(conversation, session.activeConversationId, session.turnIds) ? (
                  <Sidebar.MenuChip>运行中</Sidebar.MenuChip>
                ) : null}
                <Sidebar.MenuActions>
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
                </Sidebar.MenuActions>
              </Sidebar.MenuItem>
            ))}
          </Sidebar.Menu>
          )}
        </Sidebar.Group>
      </Sidebar.Content>
    </Sidebar>
  );
}

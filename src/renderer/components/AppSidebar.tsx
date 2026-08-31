import { Folder, Plus } from '@gravity-ui/icons';
import { Button, Dropdown } from '@heroui/react';
import { Sidebar } from '@heroui-pro/react';
import type { TodeXSession } from '../session/useTodeXSession';
import { isConversationHighlighted } from '../session/helpers';

type Props = {
  session: TodeXSession;
  onCreateWorkspace: () => void;
  onCreateConversation: () => void;
};

export function AppSidebar({ session, onCreateWorkspace, onCreateConversation }: Props) {
  const workspaceConversations = session.conversations.filter(
    (conversation) => conversation.workspaceId === session.activeWorkspaceId && !conversation.archived,
  );

  return (
    <Sidebar>
      <Sidebar.Header>
        <div className="flex items-center gap-3 px-1 py-2">
          <div className="bg-accent flex size-7 shrink-0 items-center justify-center rounded-md">
            <span className="text-accent-foreground text-sm font-bold">T</span>
          </div>
          <span className="text-foreground text-sm font-semibold" data-sidebar="label">
            TodeX
          </span>
        </div>
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

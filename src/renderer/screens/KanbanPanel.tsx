import { useState, type Key } from 'react';
import { Plus } from '@gravity-ui/icons';
import { RiArrowRightLine, RiChat3Line, RiFolder3Line, RiMoreFill, RiPushpinLine } from '@remixicon/react';
import { Button, Chip, Dropdown, Input, Label, TextField, Tooltip } from '@heroui/react';
import { EmptyState, Kanban } from '@heroui-pro/react';
import type { WorkspaceRecord } from '@todex/protocol/todex';
import { conversationDisplayTitle, workspaceDisplayName, type ConversationRecord } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';
import {
  addKanbanTask,
  attachKanbanTask,
  kanbanTaskStatusLabels,
  kanbanTaskStatuses,
  kanbanTasksForWorkspace,
  removeKanbanTask,
  renameKanbanTask,
  setKanbanTaskStatus,
  useKanbanTasks,
  type KanbanTask,
  type KanbanTaskStatus,
} from '../session/kanbanTasks';

type Props = { session: TodeXSession; onOpenConversation: () => void };

type ChipColor = 'accent' | 'danger' | 'default' | 'success' | 'warning';

type ColumnMeta = {
  bodyBg: string;
  btnStyle: string;
  countColor: string;
  indicator: string;
  pillBg: string;
};

const COLUMN_META: ColumnMeta[] = [
  {
    bodyBg: 'bg-accent/8',
    btnStyle: 'text-accent border-accent/30 hover:bg-accent/10',
    countColor: 'text-accent',
    indicator: 'bg-accent',
    pillBg: 'bg-accent/15',
  },
  {
    bodyBg: 'bg-warning/8',
    btnStyle: 'text-warning border-warning/30 hover:bg-warning/10',
    countColor: 'text-warning',
    indicator: 'bg-warning',
    pillBg: 'bg-warning/15',
  },
  {
    bodyBg: 'bg-danger/8',
    btnStyle: 'text-danger border-danger/30 hover:bg-danger/10',
    countColor: 'text-danger',
    indicator: 'bg-danger',
    pillBg: 'bg-danger/15',
  },
  {
    bodyBg: 'bg-success/8',
    btnStyle: 'text-success border-success/30 hover:bg-success/10',
    countColor: 'text-success',
    indicator: 'bg-success',
    pillBg: 'bg-success/15',
  },
];

const STATUS_META: Record<KanbanTaskStatus, { chip: ChipColor; dot: string }> = {
  planned: { chip: 'accent', dot: 'bg-accent' },
  'in-progress': { chip: 'warning', dot: 'bg-warning' },
  done: { chip: 'success', dot: 'bg-success' },
};

const ATTACH_LIMIT = 12;

function TaskCard({ task, session, conversations, onOpen }: {
  task: KanbanTask;
  session: TodeXSession;
  conversations: ConversationRecord[];
  onOpen: (workspaceId: string, conversationId: string) => void;
}) {
  const linked = task.conversationId
    ? conversations.find((conversation) => conversation.id === task.conversationId) ?? null
    : null;
  const staleLink = Boolean(task.conversationId && !linked);

  const runTaskAction = (key: Key) => {
    const value = String(key);
    const separator = value.indexOf(':');
    const action = separator < 0 ? value : value.slice(0, separator);
    const argument = separator < 0 ? '' : value.slice(separator + 1);
    if (action === 'status') {
      setKanbanTaskStatus(task.id, argument as KanbanTaskStatus);
    } else if (action === 'attach') {
      attachKanbanTask(task.id, argument);
    } else if (action === 'detach') {
      attachKanbanTask(task.id, undefined);
    } else if (action === 'draft' && linked) {
      session.setConversationChatDraft(linked.id, (current) => (
        current.trim() ? `${current}\n任务：${task.title}` : `任务：${task.title}`
      ));
      onOpen(task.workspaceId, linked.id);
    } else if (action === 'rename') {
      const title = window.prompt('新的任务标题', task.title);
      if (title) renameKanbanTask(task.id, title);
    } else if (action === 'delete') {
      removeKanbanTask(task.id);
    }
  };

  return (
    <Kanban.Card id={task.id} textValue={task.title}>
      <div className="flex items-start gap-2">
        <span className={`mt-1 size-2.5 shrink-0 rounded-sm ${STATUS_META[task.status].dot}`} />
        <span className="text-foreground min-w-0 break-all font-semibold leading-snug">{task.title}</span>
      </div>

      {task.conversationId ? (
        <div className="flex min-w-0 items-center gap-1">
          <RiChat3Line className="text-muted size-3.5 shrink-0" />
          {linked ? (
            <button
              type="button"
              className="text-accent min-w-0 truncate text-xs hover:underline"
              onClick={(event) => { event.stopPropagation(); onOpen(task.workspaceId, linked.id); }}
            >
              {conversationDisplayTitle(linked, session.timeline)}
            </button>
          ) : (
            <span className="text-muted min-w-0 truncate text-xs">对话已失效</span>
          )}
        </div>
      ) : null}

      <div className="flex items-center gap-1">
        <Dropdown>
          <Dropdown.Trigger
            aria-label={`任务状态：${kanbanTaskStatusLabels[task.status]}`}
            className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Chip color={STATUS_META[task.status].chip} size="sm" variant="soft">
              {kanbanTaskStatusLabels[task.status]}
            </Chip>
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu aria-label="设置任务状态" onAction={runTaskAction}>
              {kanbanTaskStatuses.map((status) => (
                <Dropdown.Item key={status} id={`status:${status}`} textValue={kanbanTaskStatusLabels[status]}>
                  <Label>{kanbanTaskStatusLabels[status]}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>

        <span className="flex-1" />

        <Dropdown>
          <Dropdown.Trigger
            aria-label="贴到对话"
            className="text-muted hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <RiPushpinLine className="size-3.5" />
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu aria-label="贴到对话" onAction={runTaskAction}>
              {conversations.length === 0 ? (
                <Dropdown.Item id="noop" textValue="没有可关联的对话" isDisabled>
                  <Label>这个工作区还没有对话</Label>
                </Dropdown.Item>
              ) : conversations.slice(0, ATTACH_LIMIT).map((conversation) => (
                <Dropdown.Item
                  key={conversation.id}
                  id={`attach:${conversation.id}`}
                  textValue={conversationDisplayTitle(conversation, session.timeline)}
                >
                  <Label className="truncate">{conversationDisplayTitle(conversation, session.timeline)}</Label>
                </Dropdown.Item>
              ))}
              {task.conversationId ? (
                <Dropdown.Item id="detach" textValue="取消关联对话">
                  <Label>取消关联</Label>
                </Dropdown.Item>
              ) : null}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>

        <Dropdown>
          <Dropdown.Trigger
            aria-label="任务操作"
            className="text-muted hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <RiMoreFill className="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu aria-label="任务操作" onAction={runTaskAction}>
              {linked ? (
                <Dropdown.Item id="draft" textValue="写入对话草稿">
                  <Label>写入对话草稿</Label>
                </Dropdown.Item>
              ) : null}
              {task.conversationId ? (
                <Dropdown.Item id="detach" textValue="取消关联对话">
                  <Label>{staleLink ? '移除失效关联' : '取消关联对话'}</Label>
                </Dropdown.Item>
              ) : null}
              <Dropdown.Item id="rename" textValue="重命名任务">
                <Label>重命名</Label>
              </Dropdown.Item>
              <Dropdown.Item id="delete" textValue="删除任务" variant="danger">
                <Label className="text-danger">删除任务</Label>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
    </Kanban.Card>
  );
}

function WorkspaceColumn({ workspace, meta, tasks, session, creating, onCreate, onCancelCreate, onOpenConversation }: {
  workspace: WorkspaceRecord;
  meta: ColumnMeta;
  tasks: KanbanTask[];
  session: TodeXSession;
  creating: boolean;
  onCreate: () => void;
  onCancelCreate: () => void;
  onOpenConversation: (workspaceId: string, conversationId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const conversations = session.conversations
    .filter((conversation) => conversation.workspaceId === workspace.id && !conversation.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const submit = () => {
    const created = addKanbanTask(workspace.id, title);
    if (created) {
      setTitle('');
      onCancelCreate();
    }
  };

  return (
    <Kanban.Column className="gap-0">
      <div className="bg-background sticky top-0 z-10 pt-2">
        <Kanban.ColumnHeader
          className={`rounded-t-[calc(var(--radius-2xl)_+_var(--radius-sm))] px-3 py-2.5 ${meta.bodyBg}`}
        >
          <span className={`flex min-w-0 items-center gap-2 rounded-[calc(var(--radius)*infinity)] px-3 py-1 ${meta.pillBg}`}>
            <Kanban.ColumnIndicator className={meta.indicator} />
            <Tooltip delay={300}>
              <Tooltip.Trigger className="min-w-0 cursor-default outline-none">
                <Kanban.ColumnTitle className="truncate">{workspaceDisplayName(workspace)}</Kanban.ColumnTitle>
              </Tooltip.Trigger>
              <Tooltip.Content className="max-w-xs break-all">{workspace.path}</Tooltip.Content>
            </Tooltip>
          </span>
          <Kanban.ColumnCount className={meta.countColor}>{tasks.length}</Kanban.ColumnCount>
          <Kanban.ColumnActions>
            <Tooltip delay={300}>
              <Button
                isIconOnly
                aria-label="进入工作区"
                className={meta.countColor}
                size="sm"
                variant="ghost"
                onPress={() => onOpenConversation(workspace.id, '')}
              >
                <RiArrowRightLine />
              </Button>
              <Tooltip.Content>进入工作区</Tooltip.Content>
            </Tooltip>
          </Kanban.ColumnActions>
        </Kanban.ColumnHeader>
      </div>
      <Kanban.ColumnBody className={`rounded-t-none ${meta.bodyBg}`}>
        {tasks.length === 0 ? (
          <p className="text-muted px-3 py-8 text-center text-xs">暂无任务，点击下方新建</p>
        ) : kanbanTaskStatuses.map((status) => {
          const items = tasks.filter((task) => task.status === status);
          if (!items.length) return null;
          return (
            <div key={status}>
              <p className="text-muted px-3 pt-2 text-xs">
                {kanbanTaskStatusLabels[status]} · {items.length}
              </p>
              <Kanban.CardList
                aria-label={`${workspaceDisplayName(workspace)} ${kanbanTaskStatusLabels[status]}任务`}
                className="pb-1 pt-1"
                items={items}
                onAction={(key) => {
                  const task = items.find((item) => item.id === String(key));
                  const linked = task?.conversationId
                    ? conversations.find((conversation) => conversation.id === task.conversationId)
                    : undefined;
                  if (task && linked) onOpenConversation(task.workspaceId, linked.id);
                }}
              >
                {(task: KanbanTask) => (
                  <TaskCard
                    task={task}
                    session={session}
                    conversations={conversations}
                    onOpen={onOpenConversation}
                  />
                )}
              </Kanban.CardList>
            </div>
          );
        })}
        <div className="p-2 pt-0">
          {creating ? (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <TextField value={title} onChange={setTitle}>
                <Input autoFocus placeholder="任务标题" maxLength={200} />
              </TextField>
              <div className="flex gap-2">
                <Button size="sm" type="submit" isDisabled={!title.trim()}>添加</Button>
                <Button size="sm" variant="ghost" onPress={() => { setTitle(''); onCancelCreate(); }}>取消</Button>
              </div>
            </form>
          ) : (
            <Button fullWidth className={meta.btnStyle} variant="outline" onPress={onCreate}>
              <Plus />
              新建任务
            </Button>
          )}
        </div>
      </Kanban.ColumnBody>
    </Kanban.Column>
  );
}

export function KanbanPanel({ session, onOpenConversation }: Props) {
  const allTasks = useKanbanTasks();
  const [creatingWorkspaceId, setCreatingWorkspaceId] = useState<string | null>(null);
  const columns = session.workspaces.map((workspace) => ({
    workspace,
    tasks: kanbanTasksForWorkspace(allTasks, workspace.id),
  }));
  const total = columns.reduce((count, column) => count + column.tasks.length, 0);

  const openConversation = (workspaceId: string, conversationId: string) => {
    if (conversationId) session.selectConversation(workspaceId, conversationId);
    else session.selectWorkspace(workspaceId);
    onOpenConversation();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-8 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RiChat3Line className="text-accent size-5" />
            <h1 className="truncate text-lg font-semibold">任务看板</h1>
            <Chip color="accent" size="sm" variant="soft">{total} 个任务</Chip>
          </div>
          <p className="text-muted mt-1 text-sm">按工作区管理任务，可把任务贴到对应工作区的对话上</p>
        </div>
        <Button size="sm" variant="secondary" onPress={onOpenConversation}>
          返回对话
          <RiArrowRightLine />
        </Button>
      </div>
      {columns.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState>
            <EmptyState.Header>
              <EmptyState.Media variant="icon">
                <RiFolder3Line />
              </EmptyState.Media>
              <EmptyState.Title>还没有工作区</EmptyState.Title>
              <EmptyState.Description>创建工作区后，可以在这里按工作区管理任务。</EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pr-3">
          <Kanban hideScrollBar className="items-start overflow-visible px-5 pb-5" isEnabled={false}>
            {columns.map(({ workspace, tasks }, index) => (
              <WorkspaceColumn
                key={workspace.id}
                workspace={workspace}
                meta={COLUMN_META[index % COLUMN_META.length]}
                tasks={tasks}
                session={session}
                creating={creatingWorkspaceId === workspace.id}
                onCreate={() => setCreatingWorkspaceId(workspace.id)}
                onCancelCreate={() => setCreatingWorkspaceId(null)}
                onOpenConversation={openConversation}
              />
            ))}
          </Kanban>
        </div>
      )}
    </div>
  );
}

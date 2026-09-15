import { useMemo, useState, type Key } from 'react';
import { Plus } from '@gravity-ui/icons';
import { RiArrowRightLine, RiCalendarLine, RiChat3Line, RiCheckLine, RiFolder3Line, RiMoreFill, RiPushpinLine } from '@remixicon/react';
import { Button, Chip, Dropdown, Input, Label, TextArea, TextField, Tooltip } from '@heroui/react';
import { EmptyState, Kanban } from '@heroui-pro/react';
import type { WorkspaceRecord } from '@todex/protocol/todex';
import { conversationDisplayTitle, getConversationStatus, workspaceDisplayName, type ConversationRecord, type TimelineEntry } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import {
  addKanbanTask,
  attachKanbanTask,
  isKanbanTaskOverdue,
  kanbanTaskDraftText,
  kanbanTaskStatusLabel,
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

const STATUS_META: Record<KanbanTaskStatus, { chip: ChipColor }> = {
  planned: { chip: 'accent' },
  'in-progress': { chip: 'warning' },
  done: { chip: 'default' },
};

const ATTACH_LIMIT = 12;

function TaskCard({ task, session, conversations, latestEntries, onOpen }: {
  task: KanbanTask;
  session: TodeXSession;
  conversations: ConversationRecord[];
  latestEntries: Record<string, TimelineEntry>;
  onOpen: (workspaceId: string, conversationId: string) => void;
}) {
  const t = useT();
  const linked = task.conversationId
    ? conversations.find((conversation) => conversation.id === task.conversationId) ?? null
    : null;
  const staleLink = Boolean(task.conversationId && !linked);
  const done = task.status === 'done';
  const conversationStatus = !done && linked
    ? getConversationStatus(session, linked, latestEntries[linked.id])
    : null;

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
      const draft = kanbanTaskDraftText(task);
      session.setConversationChatDraft(linked.id, (current) => (
        current.trim() ? `${current}\n${draft}` : draft
      ));
      onOpen(task.workspaceId, linked.id);
    } else if (action === 'rename') {
      const title = window.prompt(t('kanban.renamePrompt'), task.title);
      if (title) renameKanbanTask(task.id, title);
    } else if (action === 'delete') {
      removeKanbanTask(task.id);
    }
  };

  return (
    <Kanban.Card id={task.id} textValue={task.title}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label={done ? t('kanban.markUndone') : t('kanban.markDone')}
          title={done ? t('kanban.markUndone') : t('kanban.markDone')}
          className={`group/check mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 ${
            done
              ? 'border-muted bg-muted text-background'
              : conversationStatus
                ? conversationStatus.border
                : 'border-separator hover:border-muted'
          }`}
          onClick={(event) => {
            event.stopPropagation();
            setKanbanTaskStatus(task.id, done ? 'planned' : 'done');
          }}
        >
          <RiCheckLine className={`size-2.5 ${done ? '' : 'text-muted opacity-0 transition-opacity group-hover/check:opacity-100'}`} />
        </button>
        <span className={`min-w-0 break-all font-semibold leading-snug ${done ? 'text-muted' : 'text-foreground'}`}>{task.title}</span>
      </div>

      {task.description ? (
        <p className="text-muted break-all text-xs leading-snug line-clamp-2">{task.description}</p>
      ) : null}

      {task.dueDate ? (
        <div className={`flex min-w-0 items-center gap-1 text-xs ${isKanbanTaskOverdue(task) ? 'text-danger' : 'text-muted'}`}>
          <RiCalendarLine className="size-3.5 shrink-0" />
          <span className="truncate">
            {task.dueDate}{isKanbanTaskOverdue(task) ? t('kanban.overdue') : ''}
          </span>
        </div>
      ) : null}

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
            <span className="text-muted min-w-0 truncate text-xs">{t('kanban.linkStale')}</span>
          )}
        </div>
      ) : null}

      <div className="flex items-center gap-1">
        <Dropdown>
          <Dropdown.Trigger
            aria-label={t('kanban.taskStatus', { status: kanbanTaskStatusLabel(task.status) })}
            className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Chip color={STATUS_META[task.status].chip} size="sm" variant="soft">
              {kanbanTaskStatusLabel(task.status)}
            </Chip>
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu aria-label={t('kanban.setStatus')} onAction={runTaskAction}>
              {kanbanTaskStatuses.map((status) => (
                <Dropdown.Item key={status} id={`status:${status}`} textValue={kanbanTaskStatusLabel(status)}>
                  <Label>{kanbanTaskStatusLabel(status)}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>

        <span className="flex-1" />

        <Dropdown>
          <Dropdown.Trigger
            aria-label={t('kanban.attach')}
            className="text-muted hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <RiPushpinLine className="size-3.5" />
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu aria-label={t('kanban.attach')} onAction={runTaskAction}>
              {conversations.length === 0 ? (
                <Dropdown.Item id="noop" textValue={t('kanban.noConversations')} isDisabled>
                  <Label>{t('kanban.noConversations')}</Label>
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
                <Dropdown.Item id="detach" textValue={t('kanban.detachAria')}>
                  <Label>{t('kanban.detach')}</Label>
                </Dropdown.Item>
              ) : null}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>

        <Dropdown>
          <Dropdown.Trigger
            aria-label={t('kanban.taskActions')}
            className="text-muted hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <RiMoreFill className="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu aria-label={t('kanban.taskActions')} onAction={runTaskAction}>
              {linked ? (
                <Dropdown.Item id="draft" textValue={t('kanban.draftToChat')}>
                  <Label>{t('kanban.draftToChat')}</Label>
                </Dropdown.Item>
              ) : null}
              {task.conversationId ? (
                <Dropdown.Item id="detach" textValue={t('kanban.detachAria')}>
                  <Label>{staleLink ? t('kanban.removeStale') : t('kanban.detachAria')}</Label>
                </Dropdown.Item>
              ) : null}
              <Dropdown.Item id="rename" textValue={t('kanban.renameAria')}>
                <Label>{t('kanban.rename')}</Label>
              </Dropdown.Item>
              <Dropdown.Item id="delete" textValue={t('kanban.delete')} variant="danger">
                <Label className="text-danger">{t('kanban.delete')}</Label>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
    </Kanban.Card>
  );
}

function WorkspaceColumn({ workspace, meta, tasks, session, latestEntries, creating, onCreate, onCancelCreate, onOpenConversation }: {
  workspace: WorkspaceRecord;
  meta: ColumnMeta;
  tasks: KanbanTask[];
  session: TodeXSession;
  latestEntries: Record<string, TimelineEntry>;
  creating: boolean;
  onCreate: () => void;
  onCancelCreate: () => void;
  onOpenConversation: (workspaceId: string, conversationId: string) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const conversations = session.conversations
    .filter((conversation) => conversation.workspaceId === workspace.id && !conversation.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setDueDate('');
  };

  const submit = () => {
    const created = addKanbanTask(workspace.id, title, { description, dueDate });
    if (created) {
      resetForm();
      onCancelCreate();
    }
  };

  const openTaskConversation = (task: KanbanTask) => {
    const linked = task.conversationId
      ? conversations.find((conversation) => conversation.id === task.conversationId)
      : undefined;
    if (linked) {
      onOpenConversation(task.workspaceId, linked.id);
      return;
    }
    if (task.conversationId) attachKanbanTask(task.id, undefined);
    const created = session.createConversation(task.workspaceId, { title: task.title });
    if (!created) return;
    attachKanbanTask(task.id, created.id);
    session.setConversationChatDraft(created.id, kanbanTaskDraftText(task));
    onOpenConversation(task.workspaceId, created.id);
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
                aria-label={t('kanban.enterWorkspace')}
                className={meta.countColor}
                size="sm"
                variant="ghost"
                onPress={() => onOpenConversation(workspace.id, '')}
              >
                <RiArrowRightLine />
              </Button>
              <Tooltip.Content>{t('kanban.enterWorkspace')}</Tooltip.Content>
            </Tooltip>
          </Kanban.ColumnActions>
        </Kanban.ColumnHeader>
      </div>
      <Kanban.ColumnBody className={`rounded-t-none ${meta.bodyBg}`}>
        {tasks.length === 0 ? (
          <p className="text-muted px-3 py-8 text-center text-xs">{t('kanban.empty')}</p>
        ) : kanbanTaskStatuses.map((status) => {
          const items = tasks.filter((task) => task.status === status);
          if (!items.length) return null;
          return (
            <div key={status}>
              <p className="text-muted px-3 pt-2 text-xs">
                {kanbanTaskStatusLabel(status)} · {items.length}
              </p>
              <Kanban.CardList
                aria-label={t('kanban.columnAria', { workspace: workspaceDisplayName(workspace), status: kanbanTaskStatusLabel(status) })}
                className="pb-1 pt-1"
                items={items}
                onAction={(key) => {
                  const task = items.find((item) => item.id === String(key));
                  if (task) openTaskConversation(task);
                }}
              >
                {(task: KanbanTask) => (
                  <TaskCard
                    task={task}
                    session={session}
                    conversations={conversations}
                    latestEntries={latestEntries}
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
                <Input autoFocus placeholder={t('kanban.titlePlaceholder')} maxLength={200} />
              </TextField>
              <TextField value={description} onChange={setDescription}>
                <TextArea placeholder={t('kanban.descPlaceholder')} rows={2} maxLength={2000} />
              </TextField>
              <TextField value={dueDate} onChange={setDueDate}>
                <Input type="date" aria-label={t('kanban.dueDateAria')} />
              </TextField>
              <div className="flex gap-2">
                <Button size="sm" type="submit" isDisabled={!title.trim()}>{t('kanban.add')}</Button>
                <Button size="sm" variant="ghost" onPress={() => { resetForm(); onCancelCreate(); }}>{t('common.cancel')}</Button>
              </div>
            </form>
          ) : (
            <Button fullWidth className={meta.btnStyle} variant="outline" onPress={onCreate}>
              <Plus />
              {t('kanban.newTask')}
            </Button>
          )}
        </div>
      </Kanban.ColumnBody>
    </Kanban.Column>
  );
}

export function KanbanPanel({ session, onOpenConversation }: Props) {
  const t = useT();
  const allTasks = useKanbanTasks();
  const [creatingWorkspaceId, setCreatingWorkspaceId] = useState<string | null>(null);
  const columns = session.workspaces.map((workspace) => ({
    workspace,
    tasks: kanbanTasksForWorkspace(
      allTasks,
      workspace.id,
      workspace.backendConnectionId ?? session.activeBackendConnectionId,
    ),
  }));
  const total = columns.reduce((count, column) => count + column.tasks.length, 0);

  const latestEntries = useMemo(() => {
    const map: Record<string, TimelineEntry> = {};
    for (const entry of session.timeline) {
      if (!entry.conversationId) continue;
      const existing = map[entry.conversationId];
      if (!existing || entry.at > existing.at) map[entry.conversationId] = entry;
    }
    return map;
  }, [session.timeline]);

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
            <h1 className="truncate text-lg font-semibold">{t('sidebar.kanban')}</h1>
            <Chip color="accent" size="sm" variant="soft">{t('kanban.taskCount', { count: total })}</Chip>
          </div>
          <p className="text-muted mt-1 text-sm">{t('kanban.subtitle')}</p>
        </div>
        <Button size="sm" variant="secondary" onPress={onOpenConversation}>
          {t('kanban.backToChat')}
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
              <EmptyState.Title>{t('kanban.noWorkspaces')}</EmptyState.Title>
              <EmptyState.Description>{t('kanban.noWorkspacesHint')}</EmptyState.Description>
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
                latestEntries={latestEntries}
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

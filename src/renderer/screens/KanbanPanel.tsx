import { useMemo, useState, type DragEvent, type Key, type ReactNode } from 'react';
import { isTextDropItem, useDragAndDrop, type Selection } from 'react-aria-components';
import { Plus } from '@gravity-ui/icons';
import { RiArrowDownSLine, RiArrowRightLine, RiCalendarLine, RiChat3Line, RiCheckLine, RiDraggable, RiFolder3Line, RiMoreFill } from '@remixicon/react';
import { Button, Chip, Dropdown, Header, Label, ListBox, Modal, Select, Separator, TextArea, TextField, Tooltip } from '@heroui/react';
import { ContextMenu, EmptyState, Kanban } from '@heroui-pro/react';
import type { WorkspaceRecord } from '@todex/protocol/todex';
import { conversationDisplayTitle, getConversationStatus, workspaceDisplayName, type ConversationRecord, type TimelineEntry } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';
import { Field } from '../components/Field';
import { useT } from '../i18n';
import {
  addKanbanTask,
  isKanbanTaskOverdue,
  kanbanTaskConversationIds,
  kanbanTaskDraftText,
  kanbanTaskStatusLabel,
  kanbanTaskStatuses,
  kanbanTasksForWorkspace,
  moveKanbanTasks,
  removeKanbanTask,
  renameKanbanTask,
  setKanbanTaskConversations,
  setKanbanTaskStatus,
  useKanbanTasks,
  type KanbanTask,
  type KanbanTaskStatus,
} from '../session/kanbanTasks';

type Props = { session: TodeXSession; onOpenConversation: () => void };

type ChipColor = 'accent' | 'danger' | 'default' | 'success' | 'warning';

type ColumnMeta = {
  bodyBg: string;
  countColor: string;
  indicator: string;
  pillBg: string;
};

const COLUMN_META: ColumnMeta[] = [
  {
    bodyBg: 'bg-accent/8',
    countColor: 'text-accent',
    indicator: 'bg-accent',
    pillBg: 'bg-accent/15',
  },
  {
    bodyBg: 'bg-warning/8',
    countColor: 'text-warning',
    indicator: 'bg-warning',
    pillBg: 'bg-warning/15',
  },
  {
    bodyBg: 'bg-danger/8',
    countColor: 'text-danger',
    indicator: 'bg-danger',
    pillBg: 'bg-danger/15',
  },
  {
    bodyBg: 'bg-success/8',
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
// Custom mime so task drags never collide with the column drag (text/plain).
const TASK_DRAG_TYPE = 'application/x-todex-kanban-task';

type ConversationGroupKind = 'working' | 'issue' | 'unread' | 'plain' | 'stale';

const CONVERSATION_GROUP_ORDER: ConversationGroupKind[] = ['working', 'issue', 'unread', 'plain', 'stale'];

type LatestEntries = Record<string, { latest: TimelineEntry | undefined; latestIncomingAt: number }>;

type LinkedConversation = { conversation: ConversationRecord; status: ConversationGroupKind; label: string; dot: string };

function groupLinkedConversations(
  task: KanbanTask,
  session: TodeXSession,
  conversations: ConversationRecord[],
  latestEntries: LatestEntries,
  plainLabel: string,
  staleLabel: string,
): { groups: { kind: ConversationGroupKind; label: string; items: LinkedConversation[] }[]; staleCount: number; linked: LinkedConversation[] } {
  const done = task.status === 'done';
  const linked: LinkedConversation[] = [];
  let staleCount = 0;
  for (const id of kanbanTaskConversationIds(task)) {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) {
      staleCount += 1;
      continue;
    }
    const status = done ? null : getConversationStatus(
      session,
      conversation,
      latestEntries[conversation.id]?.latest,
      latestEntries[conversation.id]?.latestIncomingAt,
    );
    linked.push({
      conversation,
      status: status?.kind ?? 'plain',
      label: status?.label ?? plainLabel,
      dot: status?.color ?? 'bg-muted',
    });
  }
  const groups = CONVERSATION_GROUP_ORDER
    .map((kind) => ({
      kind,
      label: kind === 'stale' ? staleLabel : kind === 'plain' ? plainLabel : linked.find((item) => item.status === kind)?.label ?? '',
      items: linked.filter((item) => item.status === kind),
    }))
    .filter((group) => group.items.length > 0 || group.kind === 'stale' && staleCount > 0);
  return { groups, staleCount, linked };
}

function TaskCard({ task, session, conversations, latestEntries, onOpen }: {
  task: KanbanTask;
  session: TodeXSession;
  conversations: ConversationRecord[];
  latestEntries: LatestEntries;
  onOpen: (workspaceId: string, conversationId: string) => void;
}) {
  const t = useT();
  const done = task.status === 'done';
  const { groups, staleCount, linked } = groupLinkedConversations(
    task, session, conversations, latestEntries, t('kanban.groupPlain'), t('kanban.linkStale'),
  );

  const applyConversationSelection = (selection: Selection) => {
    const visible = new Set(conversations.map((conversation) => conversation.id));
    const picked = selection === 'all'
      ? conversations.map((conversation) => conversation.id)
      : [...selection].map(String).filter((id) => visible.has(id));
    // Keep ids that are stale or beyond the menu limit so toggles don't drop them.
    const hidden = kanbanTaskConversationIds(task).filter((id) => !visible.has(id));
    setKanbanTaskConversations(task.id, [...picked, ...hidden]);
  };

  const applyStatusSelection = (selection: Selection) => {
    if (selection === 'all') return;
    const status = [...selection][0];
    if (status) setKanbanTaskStatus(task.id, String(status) as KanbanTaskStatus);
  };

  const runTaskAction = (key: Key) => {
    const value = String(key);
    const separator = value.indexOf(':');
    const action = separator < 0 ? value : value.slice(0, separator);
    const argument = separator < 0 ? '' : value.slice(separator + 1);
    if (action === 'open') {
      onOpen(task.workspaceId, linked[0]?.conversation.id ?? '');
    } else if (action === 'draft' && argument) {
      const target = conversations.find((conversation) => conversation.id === argument);
      if (!target) return;
      const draft = kanbanTaskDraftText(task);
      session.setConversationChatDraft(target.id, (current) => (
        current.trim() ? `${current}\n${draft}` : draft
      ));
      onOpen(task.workspaceId, target.id);
    } else if (action === 'clear-stale') {
      const visible = new Set(conversations.map((conversation) => conversation.id));
      setKanbanTaskConversations(task.id, kanbanTaskConversationIds(task).filter((id) => visible.has(id)));
    } else if (action === 'rename') {
      const title = window.prompt(t('kanban.renamePrompt'), task.title);
      if (title) renameKanbanTask(task.id, title);
    } else if (action === 'delete') {
      removeKanbanTask(task.id);
    }
  };

  // ContextMenu.Item and friends re-export the Dropdown parts, so one JSX
  // block can serve both the right-click menu and the "…" dropdown.
  const menuItems: ReactNode = (
    <>
      <Dropdown.Section
        selectionMode="single"
        selectedKeys={new Set([task.status])}
        onSelectionChange={applyStatusSelection}
      >
        <Header>{t('kanban.setStatus')}</Header>
        {kanbanTaskStatuses.map((status) => (
          <Dropdown.Item key={status} id={status} textValue={kanbanTaskStatusLabel(status)}>
            <Dropdown.ItemIndicator type="dot" />
            <Label>{kanbanTaskStatusLabel(status)}</Label>
          </Dropdown.Item>
        ))}
      </Dropdown.Section>
      <Dropdown.Section
        selectionMode="multiple"
        selectedKeys={new Set(kanbanTaskConversationIds(task).filter((id) => conversations.some((conversation) => conversation.id === id)))}
        onSelectionChange={applyConversationSelection}
      >
        <Header>{t('kanban.attachSection')}</Header>
        {conversations.length === 0 ? (
          <Dropdown.Item id="noop" textValue={t('kanban.noConversations')} isDisabled>
            <Label>{t('kanban.noConversations')}</Label>
          </Dropdown.Item>
        ) : conversations.slice(0, ATTACH_LIMIT).map((conversation) => (
          <Dropdown.Item
            key={conversation.id}
            id={conversation.id}
            textValue={conversationDisplayTitle(conversation, session.timeline)}
          >
            <Dropdown.ItemIndicator />
            <Label className="truncate">{conversationDisplayTitle(conversation, session.timeline)}</Label>
          </Dropdown.Item>
        ))}
      </Dropdown.Section>
      <Separator />
      <Dropdown.Item id="open" textValue={t('kanban.openConversation')}>
        <Label>{t('kanban.openConversation')}</Label>
      </Dropdown.Item>
      {linked.length ? (
        <Dropdown.SubmenuTrigger>
          <Dropdown.Item id="draft" textValue={t('kanban.draftToChat')}>
            <Label>{t('kanban.draftToChat')}</Label>
            <Dropdown.SubmenuIndicator />
          </Dropdown.Item>
          <Dropdown.Popover>
            <Dropdown.Menu aria-label={t('kanban.draftToChat')} onAction={runTaskAction}>
              {linked.map(({ conversation }) => (
                <Dropdown.Item
                  key={conversation.id}
                  id={`draft:${conversation.id}`}
                  textValue={conversationDisplayTitle(conversation, session.timeline)}
                >
                  <Label className="truncate">{conversationDisplayTitle(conversation, session.timeline)}</Label>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown.SubmenuTrigger>
      ) : null}
      {staleCount ? (
        <Dropdown.Item id="clear-stale" textValue={t('kanban.clearStale')}>
          <Label>{t('kanban.clearStale')}</Label>
        </Dropdown.Item>
      ) : null}
      <Dropdown.Item id="rename" textValue={t('kanban.renameAria')}>
        <Label>{t('kanban.rename')}</Label>
      </Dropdown.Item>
      <Dropdown.Item id="delete" textValue={t('kanban.delete')} variant="danger">
        <Label className="text-danger">{t('kanban.delete')}</Label>
      </Dropdown.Item>
    </>
  );

  return (
    <Kanban.Card id={task.id} textValue={task.title} className="group/card">
      <ContextMenu>
        <ContextMenu.Trigger className="min-w-0">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-start gap-2">
              <button
                type="button"
                aria-label={done ? t('kanban.markUndone') : t('kanban.markDone')}
                title={done ? t('kanban.markUndone') : t('kanban.markDone')}
                className={`group/check mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  done
                    ? 'border-muted bg-muted text-background'
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

            {groups.map((group) => (
              <div key={group.kind} className="flex min-w-0 flex-col gap-0.5">
                {groups.length > 1 || group.kind !== 'plain' ? (
                  <span className="text-muted flex items-center gap-1.5 text-[11px] leading-snug">
                    <span className={`size-1.5 shrink-0 rounded-full ${group.kind === 'stale' ? 'bg-muted' : group.items[0]?.dot ?? 'bg-muted'}`} />
                    {group.label} · {group.kind === 'stale' ? staleCount : group.items.length}
                  </span>
                ) : null}
                {group.kind === 'stale' ? null : group.items.map(({ conversation }) => (
                  <button
                    key={conversation.id}
                    type="button"
                    className="text-accent flex min-w-0 items-center gap-1.5 truncate text-left text-xs outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
                    onClick={(event) => { event.stopPropagation(); onOpen(task.workspaceId, conversation.id); }}
                  >
                    <RiChat3Line className="text-muted size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{conversationDisplayTitle(conversation, session.timeline)}</span>
                  </button>
                ))}
              </div>
            ))}

            <div className="flex items-center gap-1">
              <Chip color={STATUS_META[task.status].chip} size="sm" variant="soft">
                {kanbanTaskStatusLabel(task.status)}
              </Chip>

              <span className="flex-1" />

              {/* Pointer users drag the card itself; this icon hints at it. */}
              <RiDraggable aria-hidden className="text-muted size-3.5 opacity-0 transition-opacity group-hover/card:opacity-100" />
              {/* Keyboard-operable drag trigger; visually hidden until focused. */}
              <Kanban.DragHandle aria-label={t('kanban.reorderTask')} />

              <Dropdown>
                <Dropdown.Trigger
                  aria-label={t('kanban.taskActions')}
                  className="text-muted hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <RiMoreFill className="size-4" />
                </Dropdown.Trigger>
                <Dropdown.Popover>
                  <Dropdown.Menu aria-label={t('kanban.taskActions')} onAction={runTaskAction}>
                    {menuItems}
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Popover>
          <ContextMenu.Menu aria-label={t('kanban.taskActions')} onAction={runTaskAction}>
            {menuItems}
          </ContextMenu.Menu>
        </ContextMenu.Popover>
      </ContextMenu>
    </Kanban.Card>
  );
}

function StatusSection({ workspace, status, items, collapsed, onToggleCollapsed, onOpenTask, children }: {
  workspace: WorkspaceRecord;
  status: KanbanTaskStatus;
  items: KanbanTask[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenTask: (task: KanbanTask) => void;
  children: (task: KanbanTask) => ReactNode;
}) {
  const t = useT();
  const dropIndex = (target: { key: Key; dropPosition: 'before' | 'after' | 'on' }, excluding: Set<string>) => {
    const remaining = items.filter((item) => !excluding.has(item.id));
    const index = remaining.findIndex((item) => item.id === String(target.key));
    return index < 0 ? remaining.length : index + (target.dropPosition === 'before' ? 0 : 1);
  };
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ [TASK_DRAG_TYPE]: String(key) })),
    acceptedDragTypes: [TASK_DRAG_TYPE],
    getDropOperation: () => 'move',
    renderDropIndicator: (target) => <Kanban.DropIndicator target={target} />,
    onReorder: (event) => {
      if (event.target.type !== 'item') return;
      const ids = [...event.keys].map(String);
      moveKanbanTasks(ids, {
        workspaceId: workspace.id,
        status,
        index: dropIndex(event.target, new Set(ids)),
      });
    },
    onInsert: async (event) => {
      if (event.target.type !== 'item') return;
      const ids = (await Promise.all(
        event.items.filter(isTextDropItem).map((item) => item.getText(TASK_DRAG_TYPE)),
      )).filter(Boolean);
      if (!ids.length) return;
      moveKanbanTasks(ids, {
        workspaceId: workspace.id,
        status,
        index: dropIndex(event.target, new Set()),
      });
    },
    onRootDrop: async (event) => {
      const ids = (await Promise.all(
        event.items.filter(isTextDropItem).map((item) => item.getText(TASK_DRAG_TYPE)),
      )).filter(Boolean);
      if (!ids.length) return;
      moveKanbanTasks(ids, { workspaceId: workspace.id, status, index: items.length });
    },
  });

  return (
    <div>
      <button
        type="button"
        aria-expanded={!collapsed}
        className="text-muted hover:text-foreground flex w-full items-center gap-1 px-3 pt-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        onClick={onToggleCollapsed}
      >
        <RiArrowDownSLine className={`size-3.5 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        {kanbanTaskStatusLabel(status)} · {items.length}
      </button>
      {collapsed ? null : (
        <Kanban.CardList
          aria-label={t('kanban.columnAria', { workspace: workspaceDisplayName(workspace), status: kanbanTaskStatusLabel(status) })}
          className="pb-1 pt-1"
          dragAndDropHooks={dragAndDropHooks}
          items={items}
          onAction={(key) => {
            const task = items.find((item) => item.id === String(key));
            if (task) onOpenTask(task);
          }}
        >
          {(task: KanbanTask) => children(task)}
        </Kanban.CardList>
      )}
    </div>
  );
}

type ColumnDropPosition = 'before' | 'after';

function WorkspaceColumn({ workspace, meta, tasks, session, latestEntries, onOpenConversation, dragging, dropPosition, onHandleDragStart, onColumnDragOver, onColumnDrop, onColumnDragEnd }: {
  workspace: WorkspaceRecord;
  meta: ColumnMeta;
  tasks: KanbanTask[];
  session: TodeXSession;
  latestEntries: LatestEntries;
  onOpenConversation: (workspaceId: string, conversationId: string) => void;
  dragging: boolean;
  dropPosition: ColumnDropPosition | null;
  onHandleDragStart: (event: DragEvent<HTMLElement>) => void;
  onColumnDragOver: (event: DragEvent<HTMLElement>) => void;
  onColumnDrop: (event: DragEvent<HTMLElement>) => void;
  onColumnDragEnd: () => void;
}) {
  const t = useT();
  const [collapsedStatuses, setCollapsedStatuses] = useState<Partial<Record<KanbanTaskStatus, boolean>>>({});
  const conversations = session.conversations
    .filter((conversation) => conversation.workspaceId === workspace.id && !conversation.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const openTaskConversation = (task: KanbanTask) => {
    const [firstId] = kanbanTaskConversationIds(task);
    const linked = firstId
      ? conversations.find((conversation) => conversation.id === firstId)
      : undefined;
    if (linked) {
      onOpenConversation(task.workspaceId, linked.id);
      return;
    }
    if (firstId) setKanbanTaskConversations(task.id, []);
    const created = session.createConversation(task.workspaceId, { title: task.title });
    if (!created) return;
    setKanbanTaskConversations(task.id, [created.id]);
    session.setConversationChatDraft(created.id, kanbanTaskDraftText(task));
    onOpenConversation(task.workspaceId, created.id);
  };

  return (
    <Kanban.Column
      className={`relative gap-0 transition-opacity ${dragging ? 'opacity-50' : ''}`}
      onDragOver={onColumnDragOver}
      onDrop={onColumnDrop}
    >
      {dropPosition ? (
        <span
          aria-hidden
          className={`bg-accent pointer-events-none absolute inset-y-1 z-20 w-1 rounded-full ${dropPosition === 'before' ? '-left-2.5' : '-right-2.5'}`}
        />
      ) : null}
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
              <Tooltip.Trigger
                aria-label={t('kanban.reorderColumn')}
                className="text-muted hover:text-foreground flex size-6 cursor-grab items-center justify-center rounded-md outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent/40 active:cursor-grabbing"
              >
                <span draggable onDragStart={onHandleDragStart} onDragEnd={onColumnDragEnd} className="flex">
                  <RiDraggable className="size-4" />
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content>{t('kanban.reorderColumn')}</Tooltip.Content>
            </Tooltip>
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
        {kanbanTaskStatuses.map((status) => {
          const items = tasks.filter((task) => task.status === status);
          if (!items.length) return null;
          const collapsed = collapsedStatuses[status] ?? status === 'done';
          return (
            <StatusSection
              key={status}
              workspace={workspace}
              status={status}
              items={items}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsedStatuses((current) => ({ ...current, [status]: !collapsed }))}
              onOpenTask={openTaskConversation}
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
            </StatusSection>
          );
        })}
      </Kanban.ColumnBody>
    </Kanban.Column>
  );
}

function NewTaskDialog({ session, workspaces, open, onOpenChange }: {
  session: TodeXSession;
  workspaces: WorkspaceRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [workspaceId, setWorkspaceId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const effectiveWorkspaceId = workspaceId || session.activeWorkspaceId || workspaces[0]?.id || '';

  const close = () => {
    setWorkspaceId('');
    setTitle('');
    setDescription('');
    setDueDate('');
    onOpenChange(false);
  };

  const submit = () => {
    if (!addKanbanTask(effectiveWorkspaceId, title, { description, dueDate })) return;
    close();
  };

  return (
    <Modal isOpen={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t('kanban.newTask')}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <Select
                selectedKey={effectiveWorkspaceId}
                onSelectionChange={(key) => setWorkspaceId(String(key))}
              >
                <Label>{t('kanban.workspace')}</Label>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {workspaces.map((workspace) => (
                      <ListBox.Item key={workspace.id} id={workspace.id} textValue={workspaceDisplayName(workspace)}>
                        {workspaceDisplayName(workspace)}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Field label={t('kanban.titlePlaceholder')} value={title} onChange={setTitle} />
              <TextField value={description} onChange={setDescription}>
                <Label>{t('kanban.descLabel')}</Label>
                <TextArea placeholder={t('kanban.descPlaceholder')} rows={3} maxLength={2000} />
              </TextField>
              <Field label={t('kanban.dueDateAria')} value={dueDate} onChange={setDueDate} type="date" />
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={close}>{t('common.cancel')}</Button>
              <Button onPress={submit} isDisabled={!title.trim() || !effectiveWorkspaceId}>{t('kanban.add')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

export function KanbanPanel({ session, onOpenConversation }: Props) {
  const t = useT();
  const allTasks = useKanbanTasks();
  const [creating, setCreating] = useState(false);
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);
  const [columnDrop, setColumnDrop] = useState<{ id: string; position: ColumnDropPosition } | null>(null);
  // Columns follow the same manual order as the sidebar workspace list.
  const orderedWorkspaces = useMemo(() => [...session.workspaces].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id),
  ), [session.workspaces]);
  // Only workspaces that actually hold tasks get a column; the rest are still
  // reachable through the new-task dialog's workspace picker.
  const columns = orderedWorkspaces
    .map((workspace) => ({
      workspace,
      tasks: kanbanTasksForWorkspace(
        allTasks,
        workspace.id,
        workspace.backendConnectionId ?? session.activeBackendConnectionId,
      ),
    }))
    .filter((column) => column.tasks.length > 0);
  const total = columns.reduce((count, column) => count + column.tasks.length, 0);

  const clearColumnDrag = () => {
    setDraggedColumnId(null);
    setColumnDrop(null);
  };

  const moveColumn = (sourceId: string, targetId: string, position: ColumnDropPosition) => {
    if (sourceId === targetId) return;
    const moved = orderedWorkspaces.find((workspace) => workspace.id === sourceId);
    if (!moved) return;
    const next = orderedWorkspaces.filter((workspace) => workspace.id !== sourceId);
    let index = next.findIndex((workspace) => workspace.id === targetId);
    if (index < 0) return;
    if (position === 'after') index += 1;
    next.splice(index, 0, moved);
    next.forEach((workspace, order) => session.updateWorkspace(workspace.id, { sortOrder: order }));
  };

  const latestEntries = useMemo(() => {
    const map: LatestEntries = {};
    for (const entry of session.timeline) {
      if (!entry.conversationId) continue;
      const existing = map[entry.conversationId] ??= { latest: undefined, latestIncomingAt: 0 };
      if (!existing.latest || entry.at > existing.latest.at) existing.latest = entry;
      if (entry.kind === 'incoming' && entry.at > existing.latestIncomingAt) existing.latestIncomingAt = entry.at;
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
      <div className="window-drag flex shrink-0 items-center justify-between gap-3 px-6 pt-8 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RiChat3Line className="text-accent size-5" />
            <h1 className="truncate text-lg font-semibold">{t('sidebar.kanban')}</h1>
            <Chip color="accent" size="sm" variant="soft">{t('kanban.taskCount', { count: total })}</Chip>
          </div>
          <p className="text-muted mt-1 text-sm">{t('kanban.subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {orderedWorkspaces.length ? (
            <Button size="sm" onPress={() => setCreating(true)}>
              <Plus />
              {t('kanban.newTask')}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onPress={onOpenConversation}>
            {t('kanban.backToChat')}
            <RiArrowRightLine />
          </Button>
        </div>
      </div>
      {orderedWorkspaces.length === 0 ? (
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
      ) : columns.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState>
            <EmptyState.Header>
              <EmptyState.Media variant="icon">
                <RiChat3Line />
              </EmptyState.Media>
              <EmptyState.Title>{t('kanban.noTasksYet')}</EmptyState.Title>
              <EmptyState.Description>{t('kanban.noTasksHint')}</EmptyState.Description>
            </EmptyState.Header>
            <EmptyState.Content>
              <Button size="sm" onPress={() => setCreating(true)}>
                <Plus />
                {t('kanban.newTask')}
              </Button>
            </EmptyState.Content>
          </EmptyState>
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-auto pr-3"
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setColumnDrop(null);
            }
          }}
        >
          {/* Cap column width so a lone workspace doesn't stretch full-width. */}
          <Kanban hideScrollBar className="auto-cols-[minmax(280px,360px)] items-start overflow-visible px-5 pb-5" isEnabled={false}>
            {columns.map(({ workspace, tasks }, index) => (
              <WorkspaceColumn
                key={workspace.id}
                workspace={workspace}
                meta={COLUMN_META[index % COLUMN_META.length]}
                tasks={tasks}
                session={session}
                latestEntries={latestEntries}
                onOpenConversation={openConversation}
                dragging={draggedColumnId === workspace.id}
                dropPosition={columnDrop?.id === workspace.id ? columnDrop.position : null}
                onHandleDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', workspace.id);
                  event.dataTransfer.effectAllowed = 'move';
                  const column = event.currentTarget.closest('section');
                  if (column) event.dataTransfer.setDragImage(column, 24, 24);
                  setDraggedColumnId(workspace.id);
                }}
                onColumnDragOver={(event) => {
                  if (!draggedColumnId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  if (draggedColumnId === workspace.id) {
                    if (columnDrop) setColumnDrop(null);
                    return;
                  }
                  const rect = event.currentTarget.getBoundingClientRect();
                  const position: ColumnDropPosition = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                  if (columnDrop?.id !== workspace.id || columnDrop.position !== position) {
                    setColumnDrop({ id: workspace.id, position });
                  }
                }}
                onColumnDrop={(event) => {
                  if (!draggedColumnId) return;
                  event.preventDefault();
                  const sourceId = draggedColumnId;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const position: ColumnDropPosition = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                  clearColumnDrag();
                  moveColumn(sourceId, workspace.id, position);
                }}
                onColumnDragEnd={clearColumnDrag}
              />
            ))}
          </Kanban>
        </div>
      )}
      <NewTaskDialog
        session={session}
        workspaces={orderedWorkspaces}
        open={creating}
        onOpenChange={setCreating}
      />
    </div>
  );
}

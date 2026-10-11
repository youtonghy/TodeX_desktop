import { useCallback, useMemo, useState, type DragEvent, type Key, type ReactNode } from 'react';
import {
  Button as AriaButton,
  DropIndicator,
  Focusable,
  GridList,
  GridListItem,
  SubmenuTrigger,
  isTextDropItem,
  useDragAndDrop,
  type Selection,
} from 'react-aria-components';
import { motion, useReducedMotion } from 'motion/react';
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightLine,
  RiArrowRightSLine,
  RiCalendarLine,
  RiChat3Line,
  RiCheckLine,
  RiDraggable,
  RiFolder3Line,
  RiKanbanView2,
  RiMoreFill,
  RiTimerLine,
} from '@remixicon/react';
import type { WorkspaceRecord } from '@todex/protocol/todex';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Textarea } from '@/components/base/textarea/textarea';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAction } from '@/components/ui/icon-action';
import { ContextMenu, Menu, MenuItem, MenuPopover, MenuSection, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Modal } from '@/components/ui/modal';
import { cx } from '@/utils/cx';
import { conversationDisplayTitle, getConversationStatus, workspaceDisplayName, type ConversationRecord, type TimelineEntry } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import {
  addKanbanTask,
  attachKanbanTask,
  cancelKanbanTaskSchedule,
  isKanbanTaskOverdue,
  kanbanBackendLocalTime,
  kanbanTaskConversationIds,
  kanbanTaskDraftText,
  kanbanTaskStatusLabel,
  kanbanTaskStatuses,
  kanbanTasksForWorkspace,
  kanbanTimeZoneLabel,
  moveKanbanTasks,
  removeKanbanTask,
  renameKanbanTask,
  replaceKanbanTaskConversation,
  setKanbanTaskConversations,
  setKanbanTaskSchedule,
  setKanbanTaskStatus,
  useKanbanTasks,
  useKanbanTimeZone,
  type KanbanTask,
  type KanbanTaskSchedule,
  type KanbanTaskStatus,
} from '../session/kanbanTasks';

type Props = { session: TodeXSession; onOpenConversation: () => void };

type ChipColor = 'blue' | 'yellow' | 'neutral';

/** Column identity dots, cycling through the chart hues so neighbouring
 * workspaces stay apart (blue, yellow, pink, emerald). */
const COLUMN_INDICATORS = ['bg-chart-6', 'bg-chart-8', 'bg-chart-3', 'bg-chart-7'];

const STATUS_META: Record<KanbanTaskStatus, { chip: ChipColor }> = {
  planned: { chip: 'blue' },
  'in-progress': { chip: 'yellow' },
  done: { chip: 'neutral' },
};

// Custom mime so task drags never collide with the column drag (text/plain).
const TASK_DRAG_TYPE = 'application/x-todex-kanban-task';

/** Borderless 24px icon trigger used on cards and column headers. */
const ICON_TRIGGER = cx(
  'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary',
  'transition-colors duration-150 ease hover:bg-background-tertiary-default hover:text-foreground-icon-primary',
  'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
);

/** Spring the cards settle with when a drop reorders them. */
const CARD_LAYOUT_TRANSITION = { layout: { type: 'spring' as const, bounce: 0.15, duration: 0.35 } };

type ConversationGroupKind = 'working' | 'issue' | 'unread' | 'plain' | 'stale';

const CONVERSATION_GROUP_ORDER: ConversationGroupKind[] = ['working', 'issue', 'unread', 'plain', 'stale'];

const CONVERSATION_GROUP_DOT: Record<ConversationGroupKind, string> = {
  working: 'bg-chart-7',
  issue: 'bg-chart-8',
  unread: 'bg-chart-6',
  plain: 'bg-foreground-icon-quaternary',
  stale: 'bg-foreground-icon-quaternary',
};

type LatestEntries = Record<string, { latest: TimelineEntry | undefined; latestIncomingAt: number }>;

type LinkedConversation = { conversation: ConversationRecord; status: ConversationGroupKind; label: string };

/** Task links hold the local id of a conversation started on this device, or
 * the backend id of one started elsewhere (another device, a schedule). */
function findTaskConversation(conversations: ConversationRecord[], id: string): ConversationRecord | undefined {
  return conversations.find((item) => item.id === id || item.v2ConversationId === id);
}

/** Linked ids worth keeping when clearing stale links: a conversation a
 * schedule just started may not be in the polled conversation list yet. */
function keptTaskConversationIds(task: KanbanTask, conversations: ConversationRecord[]): string[] {
  const pending = task.schedule?.resultConversationId;
  return kanbanTaskConversationIds(task)
    .filter((id) => id === pending || findTaskConversation(conversations, id));
}

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
    const conversation = findTaskConversation(conversations, id);
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

function TaskScheduleLine({ schedule }: { schedule: KanbanTaskSchedule }) {
  const t = useT();
  const at = schedule.at.replace('T', ' ');
  const action = schedule.action === 'start' ? t('kanban.scheduleStart') : t('kanban.scheduleSend');
  if (schedule.status === 'cancelled') return null;
  const text = schedule.status === 'pending'
    ? t('kanban.schedulePending', { at, action })
    : schedule.status === 'running'
      ? t('kanban.scheduleRunning')
      : schedule.status === 'done'
        ? t(schedule.turnId || schedule.action === 'start' ? 'kanban.scheduleDone' : 'kanban.scheduleQueued', { at })
        : t('kanban.scheduleFailed', { error: schedule.error ?? '' });
  return (
    <div
      className={cx(
        'flex min-w-0 items-center gap-1 text-caption-1-regular',
        schedule.status === 'failed' ? 'text-text-error-primary' : schedule.status === 'done' ? 'text-text-tertiary' : 'text-text-accent',
      )}
      title={schedule.status === 'failed' ? schedule.error : undefined}
    >
      <RiTimerLine className="size-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </div>
  );
}

type TaskCardProps = {
  task: KanbanTask;
  session: TodeXSession;
  conversations: ConversationRecord[];
  latestEntries: LatestEntries;
  onOpen: (workspaceId: string, conversationId: string) => void;
  onNewConversation: (task: KanbanTask) => void;
  onSchedule: (task: KanbanTask) => void;
};

/** The grid-list row of one task. Its content (and the menu state) renders
 * inside the row, outside react-aria's collection wrapper. */
function TaskCard(props: TaskCardProps) {
  return (
    <GridListItem
      id={props.task.id}
      textValue={props.task.title}
      className={({ isDragging, isFocusVisible }) => cx(
        'group/card relative cursor-pointer rounded-xl outline-none select-none',
        'transition-opacity duration-200 ease-out motion-reduce:transition-none',
        isDragging && 'opacity-50',
        isFocusVisible && 'ring-[2.5px] ring-border-focus-ring',
      )}
    >
      <TaskCardContent {...props} />
    </GridListItem>
  );
}

function TaskCardContent({ task, session, conversations, latestEntries, onOpen, onNewConversation, onSchedule }: TaskCardProps) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const done = task.status === 'done';
  const { groups, staleCount, linked } = groupLinkedConversations(
    task, session, conversations, latestEntries, t('kanban.groupPlain'), t('kanban.linkStale'),
  );

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
    } else if (action === 'new') {
      onNewConversation(task);
    } else if (action === 'schedule') {
      onSchedule(task);
    } else if (action === 'cancel-schedule') {
      cancelKanbanTaskSchedule(task.id);
    } else if (action === 'draft' && argument) {
      const target = conversations.find((conversation) => conversation.id === argument);
      if (!target) return;
      const draft = kanbanTaskDraftText(task);
      session.setConversationChatDraft(target.id, (current) => (
        current.trim() ? `${current}\n${draft}` : draft
      ));
      onOpen(task.workspaceId, target.id);
    } else if (action === 'clear-stale') {
      setKanbanTaskConversations(task.id, keptTaskConversationIds(task, conversations));
    } else if (action === 'rename') {
      const title = window.prompt(t('kanban.renamePrompt'), task.title);
      if (title) renameKanbanTask(task.id, title);
    } else if (action === 'delete') {
      removeKanbanTask(task.id);
    }
  };

  // One block of items serves both the right-click menu and the "…" menu.
  const menuItems = (): ReactNode => (
    <>
      <MenuSection
        title={t('kanban.setStatus')}
        selectionMode="single"
        selectedKeys={new Set([task.status])}
        onSelectionChange={applyStatusSelection}
      >
        {kanbanTaskStatuses.map((status) => (
          <MenuItem key={status} id={status} textValue={kanbanTaskStatusLabel(status)}>
            {kanbanTaskStatusLabel(status)}
          </MenuItem>
        ))}
      </MenuSection>
      <MenuSeparator />
      <MenuItem id="new" textValue={t('kanban.newConversation')}>{t('kanban.newConversation')}</MenuItem>
      {linked.length ? (
        <MenuItem id="open" textValue={t('kanban.openConversation')}>{t('kanban.openConversation')}</MenuItem>
      ) : null}
      {linked.length ? (
        <SubmenuTrigger>
          <MenuItem
            id="draft"
            textValue={t('kanban.draftToChat')}
            trailing={<RiArrowRightSLine aria-hidden className="size-4 text-foreground-icon-tertiary rtl:rotate-180" />}
          >
            {t('kanban.draftToChat')}
          </MenuItem>
          <MenuPopover placement="end top" offset={2}>
            {/* Outside a MenuTrigger the submenu cannot close the pointer
                menu itself, so close it here. */}
            <Menu aria-label={t('kanban.draftToChat')} onAction={(key) => { closeContextMenu(); runTaskAction(key); }}>
              {linked.map(({ conversation }) => (
                <MenuItem
                  key={conversation.id}
                  id={`draft:${conversation.id}`}
                  textValue={conversationDisplayTitle(conversation, session.timeline)}
                >
                  {conversationDisplayTitle(conversation, session.timeline)}
                </MenuItem>
              ))}
            </Menu>
          </MenuPopover>
        </SubmenuTrigger>
      ) : null}
      <MenuItem id="schedule" textValue={t('kanban.schedule')}>{t('kanban.schedule')}</MenuItem>
      {task.schedule?.status === 'pending' ? (
        <MenuItem id="cancel-schedule" textValue={t('kanban.scheduleCancel')}>{t('kanban.scheduleCancel')}</MenuItem>
      ) : null}
      {staleCount ? (
        <MenuItem id="clear-stale" textValue={t('kanban.clearStale')}>{t('kanban.clearStale')}</MenuItem>
      ) : null}
      <MenuSeparator />
      <MenuItem id="rename" textValue={t('kanban.renameAria')}>{t('kanban.rename')}</MenuItem>
      <MenuItem id="delete" textValue={t('kanban.delete')} tone="danger">{t('kanban.delete')}</MenuItem>
    </>
  );

  return (
    <>
      <motion.div
        layout={!reduceMotion}
        transition={CARD_LAYOUT_TRANSITION}
        className={cx(
          'flex min-w-0 flex-col gap-2 rounded-xl bg-background-primary-default p-3 text-start shadow-card',
          'ring-[2.5px] ring-transparent transition-[box-shadow] duration-200 ease-out motion-reduce:transition-none',
          'hover:shadow-sm hover:ring-border-button-hover',
        )}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-label={done ? t('kanban.markUndone') : t('kanban.markDone')}
            title={done ? t('kanban.markUndone') : t('kanban.markDone')}
            className={cx(
              'group/check mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border-2',
              'transition-colors duration-150 ease outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
              done
                ? 'border-foreground-icon-tertiary bg-foreground-icon-tertiary text-text-white'
                : 'border-border-button-hover hover:border-foreground-icon-tertiary',
            )}
            onClick={(event) => {
              event.stopPropagation();
              setKanbanTaskStatus(task.id, done ? 'planned' : 'done');
            }}
          >
            <RiCheckLine
              className={cx(
                'size-2.5',
                !done && 'text-foreground-icon-tertiary opacity-0 transition-opacity duration-150 group-hover/check:opacity-100',
              )}
            />
          </button>
          <span className={cx('min-w-0 break-all text-body-medium', done ? 'text-text-tertiary' : 'text-text-primary')}>{task.title}</span>
        </div>

        {task.description ? (
          <p className="line-clamp-2 break-all text-caption-1-regular text-text-secondary">{task.description}</p>
        ) : null}

        {task.dueDate ? (
          <div className={cx('flex min-w-0 items-center gap-1 text-caption-1-regular', isKanbanTaskOverdue(task) ? 'text-text-error-primary' : 'text-text-tertiary')}>
            <RiCalendarLine className="size-3.5 shrink-0" />
            <span className="truncate">
              {task.dueDate}{isKanbanTaskOverdue(task) ? t('kanban.overdue') : ''}
            </span>
          </div>
        ) : null}

        {task.schedule ? <TaskScheduleLine schedule={task.schedule} /> : null}

        {groups.map((group) => (
          <div key={group.kind} className="flex min-w-0 flex-col gap-0.5">
            {groups.length > 1 || group.kind !== 'plain' ? (
              <span className="flex items-center gap-1.5 text-caption-2-regular text-text-tertiary">
                <span className={cx('size-1.5 shrink-0 rounded-full', CONVERSATION_GROUP_DOT[group.kind])} />
                {group.label} · {group.kind === 'stale' ? staleCount : group.items.length}
              </span>
            ) : null}
            {group.kind === 'stale' ? null : group.items.map(({ conversation }) => (
              <button
                key={conversation.id}
                type="button"
                className="flex min-w-0 items-center gap-1.5 truncate rounded-sm text-start text-caption-1-regular text-text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                onClick={(event) => { event.stopPropagation(); onOpen(task.workspaceId, conversation.id); }}
              >
                <RiChat3Line className="size-3.5 shrink-0 text-foreground-icon-tertiary" />
                <span className="min-w-0 truncate">{conversationDisplayTitle(conversation, session.timeline)}</span>
              </button>
            ))}
          </div>
        ))}

        <div className="flex items-center gap-1">
          <Chip color={STATUS_META[task.status].chip} variant="caption">
            {kanbanTaskStatusLabel(task.status)}
          </Chip>

          <span className="flex-1" />

          {/* Pointer users drag the card itself, so the grip only hints at it
              on hover; keyboard users focus it to start a drag. */}
          <AriaButton
            slot="drag"
            aria-label={t('kanban.reorderTask')}
            className={cx(
              ICON_TRIGGER,
              'cursor-grab opacity-0 transition-[opacity,background-color,color] group-hover/card:opacity-100',
              'group-data-[focus-visible]/card:opacity-100 data-[focus-visible]:opacity-100',
            )}
          >
            <RiDraggable aria-hidden className="size-3.5" />
          </AriaButton>

          <MenuTrigger>
            <AriaButton aria-label={t('kanban.taskActions')} className={ICON_TRIGGER}>
              <RiMoreFill aria-hidden className="size-4" />
            </AriaButton>
            <MenuPopover placement="bottom end">
              <Menu aria-label={t('kanban.taskActions')} onAction={runTaskAction}>
                {menuItems()}
              </Menu>
            </MenuPopover>
          </MenuTrigger>
        </div>
      </motion.div>
      <ContextMenu position={contextMenu} onClose={closeContextMenu}>
        <Menu aria-label={t('kanban.taskActions')} onAction={runTaskAction}>
          {menuItems()}
        </Menu>
      </ContextMenu>
    </>
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
    renderDropIndicator: (target) => (
      <DropIndicator
        target={target}
        className={({ isDropTarget }) => cx(
          'outline-none',
          isDropTarget && 'h-10 shrink-0 rounded-xl border border-dashed border-border-button-hover bg-background-tertiary-default transition-[height] duration-150 ease-out motion-reduce:transition-none',
        )}
      />
    ),
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
        className="flex w-full cursor-pointer items-center gap-1 rounded-md px-1.5 pt-2 text-start text-caption-1-medium text-text-secondary transition-colors duration-150 ease outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        onClick={onToggleCollapsed}
      >
        <RiArrowDownSLine className={cx('size-3.5 shrink-0 transition-transform duration-150 ease', collapsed && '-rotate-90')} />
        {kanbanTaskStatusLabel(status)} · {items.length}
      </button>
      {collapsed ? null : (
        <GridList
          aria-label={t('kanban.columnAria', { workspace: workspaceDisplayName(workspace), status: kanbanTaskStatusLabel(status) })}
          className={({ isFocusVisible, isDropTarget }) => cx(
            'flex flex-col gap-1.5 rounded-xl py-1.5 outline-none',
            isFocusVisible && 'ring-2 ring-inset ring-border-focus-ring',
            isDropTarget && 'bg-background-secondary-hover',
          )}
          dragAndDropHooks={dragAndDropHooks}
          items={items}
          onAction={(key) => {
            const task = items.find((item) => item.id === String(key));
            if (task) onOpenTask(task);
          }}
        >
          {(task: KanbanTask) => children(task)}
        </GridList>
      )}
    </div>
  );
}

type ColumnDropPosition = 'before' | 'after';

function WorkspaceColumn({ workspace, indicator, tasks, session, latestEntries, onOpenConversation, onScheduleTask, dragging, dropPosition, onHandleDragStart, onColumnDragOver, onColumnDrop, onColumnDragEnd }: {
  workspace: WorkspaceRecord;
  indicator: string;
  tasks: KanbanTask[];
  session: TodeXSession;
  latestEntries: LatestEntries;
  onOpenConversation: (workspaceId: string, conversationId: string) => void;
  onScheduleTask: (task: KanbanTask) => void;
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

  /** Starts another conversation for the task, prefilled with its draft. It
   * is created on the backend right away: an unsent local draft is dropped
   * as soon as another one opens, and only the backend id resolves on other
   * devices and for schedules. */
  const startTaskConversation = (task: KanbanTask) => {
    const created = session.createConversation(task.workspaceId, { title: task.title, fresh: true });
    if (!created) return;
    attachKanbanTask(task.id, created.id);
    session.setConversationChatDraft(created.id, kanbanTaskDraftText(task));
    onOpenConversation(task.workspaceId, created.id);
    void session.materializeConversation(created.id, task.title).then((record) => {
      if (record?.v2ConversationId) replaceKanbanTaskConversation(task.id, created.id, record.v2ConversationId);
    });
  };

  const openTaskConversation = (task: KanbanTask) => {
    const linked = kanbanTaskConversationIds(task)
      .map((id) => findTaskConversation(conversations, id))
      .find(Boolean);
    if (linked) onOpenConversation(task.workspaceId, linked.id);
    else startTaskConversation(task);
  };

  return (
    <section
      className={cx('group/column relative flex min-w-0 flex-col transition-opacity duration-150 ease', dragging && 'opacity-50')}
      onDragOver={onColumnDragOver}
      onDrop={onColumnDrop}
    >
      {dropPosition ? (
        <span
          aria-hidden
          className={cx(
            'pointer-events-none absolute inset-y-1 z-20 w-1 rounded-full bg-accent-500',
            dropPosition === 'before' ? '-left-2' : '-right-2',
          )}
        />
      ) : null}
      <div className="sticky top-0 z-10 bg-background-full pt-2">
        <header className="flex items-center gap-2 rounded-t-2-5xl bg-background-secondary-default px-3 pt-3 pb-1">
          <span aria-hidden className={cx('size-2.5 shrink-0 rounded-full', indicator)} />
          <TooltipTrigger delay={300}>
            <Focusable>
              <span role="button" tabIndex={0} className="min-w-0 cursor-default truncate rounded-sm text-body-medium text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                {workspaceDisplayName(workspace)}
              </span>
            </Focusable>
            <Tooltip placement="bottom" className="max-w-xs break-all">{workspace.path}</Tooltip>
          </TooltipTrigger>
          <span className="shrink-0 text-body-medium text-text-secondary">{tasks.length}</span>
          <div
            className={cx(
              'ms-auto flex shrink-0 items-center gap-0.5 transition-opacity duration-150 ease motion-reduce:transition-none',
              'opacity-0 group-hover/column:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100',
            )}
          >
            <TooltipTrigger delay={300}>
              <Focusable>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={t('kanban.reorderColumn')}
                  draggable
                  onDragStart={onHandleDragStart}
                  onDragEnd={onColumnDragEnd}
                  className={cx(ICON_TRIGGER, 'cursor-grab active:cursor-grabbing')}
                >
                  <RiDraggable aria-hidden className="size-4" />
                </span>
              </Focusable>
              <Tooltip placement="bottom">{t('kanban.reorderColumn')}</Tooltip>
            </TooltipTrigger>
            <IconAction
              icon={RiArrowRightLine}
              size="xs"
              aria-label={t('kanban.enterWorkspace')}
              tooltip
              className="hover:bg-background-tertiary-default"
              iconClassName="rtl:rotate-180"
              onClick={() => onOpenConversation(workspace.id, '')}
            />
          </div>
        </header>
      </div>
      <div className="flex min-h-16 flex-col rounded-b-2-5xl bg-background-secondary-default px-1.5 pb-1.5">
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
                  onNewConversation={startTaskConversation}
                  onSchedule={onScheduleTask}
                />
              )}
            </StatusSection>
          );
        })}
      </div>
    </section>
  );
}

/** Arms a task schedule. The time is wall-clock in the backend's zone, which
 * is where it runs; the send settings are snapshotted now, as the backend
 * cannot ask this device for them later. */
function ScheduleTaskDialog({ session, task, onClose }: {
  session: TodeXSession;
  task: KanbanTask | null;
  onClose: () => void;
}) {
  const t = useT();
  const zone = useKanbanTimeZone();
  const [action, setAction] = useState<KanbanTaskSchedule['action']>('start');
  const [conversationId, setConversationId] = useState('');
  const [at, setAt] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  // Sendable targets: linked conversations that exist on the backend.
  const targets = (task ? kanbanTaskConversationIds(task) : [])
    .map((id) => findTaskConversation(session.conversations, id))
    .filter((conversation): conversation is ConversationRecord => Boolean(conversation?.v2ConversationId && !conversation.archived));

  // Reset the form whenever the dialog opens for a task.
  if (task && openedFor !== task.id) {
    const previous = task.schedule?.status === 'pending' ? task.schedule : undefined;
    const target = previous?.action === 'send'
      ? targets.find((conversation) => conversation.v2ConversationId === previous.conversationId)
      : undefined;
    setOpenedFor(task.id);
    setAction(target ? 'send' : 'start');
    setConversationId(target?.id ?? targets[0]?.id ?? '');
    setAt(previous?.at ?? (zone ? kanbanBackendLocalTime(zone, Date.now() + 60 * 60_000).slice(0, 14) + '00' : ''));
    setText(previous?.text ?? kanbanTaskDraftText(task));
    setError('');
  } else if (!task && openedFor !== null) {
    setOpenedFor(null);
  }

  const submit = () => {
    if (!task || !zone) return;
    if (!at || at <= kanbanBackendLocalTime(zone)) {
      setError(t('kanban.schedulePast'));
      return;
    }
    const target = action === 'send' ? targets.find((conversation) => conversation.id === conversationId) : undefined;
    if (action === 'send' && !target?.v2ConversationId) {
      setError(t('kanban.scheduleNoConversations'));
      return;
    }
    const settings = session.kanbanScheduleSettings(task.workspaceId, target?.id);
    if (!settings) {
      setError(t('kanban.scheduleNoAgent'));
      return;
    }
    setKanbanTaskSchedule(task.id, {
      ...settings,
      at,
      action,
      text: text.trim(),
      ...(target?.v2ConversationId ? { conversationId: target.v2ConversationId } : {}),
    });
    onClose();
  };

  return (
    <Modal
      isOpen={Boolean(task)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('kanban.scheduleTitle')}
      size="lg"
      bodyClassName="flex flex-col gap-4"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={!zone || !at || !text.trim()}>{t('kanban.scheduleSave')}</Button>
        </>
      )}
    >
      <Select
        label={t('kanban.scheduleAction')}
        className="w-full"
        popoverClassName="w-(--trigger-width)"
        selectedKey={action}
        disabledKeys={targets.length ? [] : ['send']}
        onSelectionChange={(key) => setAction(String(key) === 'send' ? 'send' : 'start')}
      >
        <SelectItem id="start" textValue={t('kanban.scheduleStart')}>{t('kanban.scheduleStart')}</SelectItem>
        <SelectItem id="send" textValue={t('kanban.scheduleSend')}>{t('kanban.scheduleSend')}</SelectItem>
      </Select>
      {action === 'send' ? (
        <Select
          label={t('kanban.scheduleConversation')}
          className="w-full"
          popoverClassName="w-(--trigger-width)"
          selectedKey={conversationId}
          onSelectionChange={(key) => setConversationId(String(key))}
        >
          {targets.map((conversation) => (
            <SelectItem
              key={conversation.id}
              id={conversation.id}
              textValue={conversationDisplayTitle(conversation, session.timeline)}
            >
              {conversationDisplayTitle(conversation, session.timeline)}
            </SelectItem>
          ))}
        </Select>
      ) : null}
      <Input
        label={t('kanban.scheduleAt')}
        name="schedule-at"
        type="datetime-local"
        value={at}
        onChange={(value) => { setAt(value); setError(''); }}
        hint={zone ? t('kanban.scheduleZone', { zone: kanbanTimeZoneLabel(zone) }) : t('kanban.scheduleZoneUnknown')}
      />
      <Textarea label={t('kanban.scheduleText')} value={text} onChange={setText} rows={4} maxLength={20000} />
      {error ? <p className="text-body-regular text-text-error-primary">{error}</p> : null}
    </Modal>
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
    <Modal
      isOpen={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t('kanban.newTask')}
      size="lg"
      bodyClassName="flex flex-col gap-4"
      footer={(
        <>
          <Button variant="secondary" onClick={close}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={!title.trim() || !effectiveWorkspaceId}>{t('kanban.add')}</Button>
        </>
      )}
    >
      <Select
        label={t('kanban.workspace')}
        className="w-full"
        popoverClassName="w-(--trigger-width)"
        selectedKey={effectiveWorkspaceId}
        onSelectionChange={(key) => setWorkspaceId(String(key))}
      >
        {workspaces.map((workspace) => (
          <SelectItem key={workspace.id} id={workspace.id} textValue={workspaceDisplayName(workspace)}>
            {workspaceDisplayName(workspace)}
          </SelectItem>
        ))}
      </Select>
      <Input label={t('kanban.titlePlaceholder')} name="task-title" value={title} onChange={setTitle} />
      <Textarea
        label={t('kanban.descLabel')}
        placeholder={t('kanban.descPlaceholder')}
        value={description}
        onChange={setDescription}
        rows={3}
        maxLength={2000}
      />
      <Input label={t('kanban.dueDateAria')} name="task-due-date" type="date" value={dueDate} onChange={setDueDate} />
    </Modal>
  );
}

export function KanbanPanel({ session, onOpenConversation }: Props) {
  const t = useT();
  const allTasks = useKanbanTasks();
  const [creating, setCreating] = useState(false);
  const [schedulingTaskId, setSchedulingTaskId] = useState<string | null>(null);
  const schedulingTask = allTasks.find((task) => task.id === schedulingTaskId && !task.deletedAt) ?? null;
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
    <div className="flex h-full min-h-0 flex-col bg-background-full">
      <div className="window-drag flex shrink-0 items-center justify-between gap-3 px-6 pt-8 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RiKanbanView2 className="size-5 shrink-0 text-text-accent" />
            <h1 className="truncate text-title-3-semibold text-text-primary">{t('sidebar.kanban')}</h1>
            <Chip color="blue" variant="caption">{t('kanban.taskCount', { count: total })}</Chip>
          </div>
          <p className="mt-1 text-body-regular text-text-secondary">{t('kanban.subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {columns.length ? (
            <Button size="small" leadingIcon={RiAddLine} onClick={() => setCreating(true)}>
              {t('kanban.newTask')}
            </Button>
          ) : null}
          <Button size="small" variant="secondary" trailingIcon={RiArrowRightLine} onClick={onOpenConversation}>
            {t('kanban.backToChat')}
          </Button>
        </div>
      </div>
      {orderedWorkspaces.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState icon={RiFolder3Line} title={t('kanban.noWorkspaces')} description={t('kanban.noWorkspacesHint')} />
        </div>
      ) : columns.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState icon={RiKanbanView2} title={t('kanban.noTasksYet')} description={t('kanban.noTasksHint')}>
            <Button size="small" leadingIcon={RiAddLine} onClick={() => setCreating(true)}>
              {t('kanban.newTask')}
            </Button>
          </EmptyState>
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-auto overscroll-contain pe-3 [scrollbar-width:thin]"
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setColumnDrop(null);
            }
          }}
        >
          {/* Cap column width so a lone workspace doesn't stretch full-width. */}
          <div className="grid w-max min-w-full auto-cols-[minmax(280px,360px)] grid-flow-col items-start justify-start gap-3 px-5 pb-5">
            {columns.map(({ workspace, tasks }, index) => (
              <WorkspaceColumn
                key={workspace.id}
                workspace={workspace}
                indicator={COLUMN_INDICATORS[index % COLUMN_INDICATORS.length]}
                tasks={tasks}
                session={session}
                latestEntries={latestEntries}
                onOpenConversation={openConversation}
                onScheduleTask={(task) => setSchedulingTaskId(task.id)}
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
          </div>
        </div>
      )}
      <ScheduleTaskDialog
        session={session}
        task={schedulingTask}
        onClose={() => setSchedulingTaskId(null)}
      />
      <NewTaskDialog
        session={session}
        workspaces={orderedWorkspaces}
        open={creating}
        onOpenChange={setCreating}
      />
    </div>
  );
}

"use client";

import { useDirection } from "@/components/foundations/direction/direction";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Focusable as AriaFocusable } from "react-aria-components";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  MeasuringStrategy,
  closestCenter,
  closestCorners,
  pointerWithin,
  defaultDropAnimationSideEffects,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WorkspaceRecord } from "@todex/protocol/todex";
import { RiAddLine, RiArrowRightLine, RiCalendarLine, RiFolder6Line, RiTimerLine } from "@remixicon/react";

import { ProviderIcon } from "@/components/ProviderIcon";
import { Chip } from "@/components/base/badges/chip";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { Button } from "@/components/base/buttons/button";
import { ContextMenu, Menu } from "@/components/ui/menu";
import { getLocale, useT } from "@/i18n";
import { isV2Conversation, workspaceDisplayName, type ConversationRecord } from "@/session/helpers";
import {
  addKanbanTask,
  isKanbanTaskOverdue,
  kanbanSubtasks,
  kanbanTaskConversationIds,
  kanbanTaskStatusLabel,
  moveKanbanTasks,
  setKanbanTaskStatus,
  useKanbanTasks,
  type KanbanTask,
  type KanbanTaskStatus,
} from "@/session/kanbanTasks";
import { cx } from "@/utils/cx";
import { ProjectBoardEmptyState } from "./project-board-empty-state";
import { CreateTicketModal, type NewBoardTask } from "./create-ticket-modal";
import { PriorityChip, TicketDetailModal } from "./ticket-detail-modal";
import { ProjectBoardControls } from "./project-board-controls";
import { CONVERSATION_GROUP_DOT, buildBoardColumns, findTaskConversation, type BoardColumn, type BoardSort, type LinkedConversation, type WorkspaceTasks } from "./project-board-data";
import { useTaskActions, type TaskBoardHandlers } from "./task-actions";
import { scheduleTone, useScheduleText } from "./task-schedule";

const subscribeToDocument = () => () => {};
const NO_SUBTASKS: KanbanTask[] = [];
const getPortalRoot = () => document.body;
const getServerPortalRoot = () => null;
const SORT_TRANSITION = { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
const DROP_TRANSITION = { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
const DROP_SIDE_EFFECTS = defaultDropAnimationSideEffects({
  styles: { active: { opacity: "0" } },
});

// Pick the column under the pointer first. Comparing every card's corners
// across columns makes short lists steal the drop from a neighbouring list.
const boardCollisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCorners(args);
  const columnHit = pointerWithin({
    ...args,
    droppableContainers: args.droppableContainers.filter((item) => item.data.current?.type === "column"),
  })[0];
  if (!columnHit) return [];
  const tasks = args.droppableContainers.filter(
    (item) => item.data.current?.type === "ticket" && item.data.current.columnId === columnHit.id,
  );
  if (!tasks.length) return [columnHit];
  return closestCenter({ ...args, droppableContainers: tasks });
};

function cloneColumns(columns: BoardColumn[]): BoardColumn[] {
  return columns.map((column) => ({ ...column, tasks: [...column.tasks] }));
}

function columnFor(columns: BoardColumn[], id: UniqueIdentifier | null): KanbanTaskStatus | null {
  if (id === null) return null;
  const key = String(id);
  return (
    columns.find((column) => column.id === key)?.id ??
    columns.find((column) => column.tasks.some((task) => task.id === key))?.id ??
    null
  );
}

function taskFor(columns: BoardColumn[], id: UniqueIdentifier | null) {
  if (id === null) return null;
  return columns.flatMap((column) => column.tasks).find((task) => task.id === String(id)) ?? null;
}

/** The agents working on the task: one avatar per linked conversation, its
 * sidebar status as a dot (the template's assignee stack). */
function ConversationAvatars({ linked }: { linked: LinkedConversation[] }) {
  if (!linked.length) return null;
  return (
    <div className="flex shrink-0 items-center ps-1" aria-label={linked.map((item) => item.label).join(", ")}>
      {linked.slice(0, 3).map(({ conversation, status }, index) => (
        <span
          key={conversation.id}
          className={cx("relative flex size-[22px] items-center justify-center rounded-full bg-background-tertiary-default ring-2 ring-background-primary-default", index > 0 && "-ms-1.5")}
        >
          <ProviderIcon className="size-3" provider={isV2Conversation(conversation) ? conversation.provider : "codex"} />
          {status !== "plain" ? (
            <span aria-hidden className={cx("absolute -end-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background-primary-default", CONVERSATION_GROUP_DOT[status])} />
          ) : null}
        </span>
      ))}
    </div>
  );
}

function shortDate(timestamp: number | string): string {
  const date = typeof timestamp === "string" ? new Date(`${timestamp}T00:00`) : new Date(timestamp);
  return new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric" }).format(date);
}

/** Small ring showing the share of finished subtasks. */
function SubtaskRing({ done, total }: { done: number; total: number }) {
  const share = total ? done / total : 0;
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 -rotate-90">
      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-border-button-default)" strokeWidth="2.5" />
      {share > 0 ? (
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-agent-progress-ring)" strokeWidth="2.5" strokeLinecap="round" pathLength={1} strokeDasharray={`${share} 1`} />
      ) : null}
    </svg>
  );
}

/** A board card, laid out like the BoardUI project board: priority and
 * workspace chips with the working agents, the title, then since/completed
 * with the subtask, due date and schedule markers. */
function TaskCard({ task, workspaceName, linked, subtasks, overlay = false }: {
  task: KanbanTask;
  workspaceName: string;
  linked: LinkedConversation[];
  subtasks: readonly KanbanTask[];
  overlay?: boolean;
}) {
  const t = useT();
  const overdue = isKanbanTaskOverdue(task);
  const scheduleText = useScheduleText(task.schedule);
  const doneSubtasks = subtasks.filter((item) => item.status === "done").length;
  return (
    <article
      className={cx(
        "relative flex w-full flex-col gap-2 rounded-xl bg-background-primary-default p-3 text-start shadow-card",
        "ring-[2.5px] ring-transparent transition-[box-shadow,opacity] duration-200 ease-out motion-reduce:transition-none",
        overlay
          ? "cursor-grabbing"
          : "cursor-grab hover:shadow-sm hover:ring-border-button-hover active:cursor-grabbing",
      )}
    >
      <div className="flex min-h-[22px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {task.priority ? <PriorityChip priority={task.priority} className="shrink-0" /> : null}
          <span className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-body-2-medium text-text-secondary ring-1 ring-inset ring-border-button-default">
            <RiFolder6Line className="size-[13px] shrink-0 text-foreground-icon-tertiary" aria-hidden />
            <span className="truncate">{workspaceName}</span>
          </span>
        </div>
        <ConversationAvatars linked={linked} />
      </div>
      <h3 className={cx("text-body-medium wrap-anywhere", task.status === "done" ? "text-text-secondary" : "text-text-primary")}>{task.title}</h3>
      <div className="flex min-w-0 items-center justify-between gap-2 text-body-2-medium text-text-secondary">
        <span className="truncate">
          {task.status === "done"
            ? t("kanban.completedOn", { date: shortDate(task.updatedAt) })
            : t("kanban.since", { date: shortDate(task.createdAt) })}
        </span>
        <span className="flex shrink-0 items-center gap-2.5">
          {subtasks.length ? (
            <span className="flex items-center gap-1 tabular-nums" aria-label={t("kanban.subtaskProgress", { done: doneSubtasks, total: subtasks.length })}>
              <SubtaskRing done={doneSubtasks} total={subtasks.length} />
              {doneSubtasks}/{subtasks.length}
            </span>
          ) : null}
          {task.dueDate ? (
            <span className={cx("flex items-center gap-1", overdue && "text-text-error-primary")}>
              <RiCalendarLine className="size-[13px] shrink-0" aria-hidden />
              {shortDate(task.dueDate)}{overdue ? t("kanban.overdue") : ""}
            </span>
          ) : null}
          {task.schedule && scheduleText ? (
            <TooltipTrigger delay={200}>
              <AriaFocusable>
                <span role="img" aria-label={scheduleText} className={cx("flex", scheduleTone(task.schedule))}>
                  <RiTimerLine className="size-[14px]" aria-hidden />
                </span>
              </AriaFocusable>
              <Tooltip placement="bottom">{scheduleText}</Tooltip>
            </TooltipTrigger>
          ) : null}
        </span>
      </div>
    </article>
  );
}

type CardContext = {
  handlers: TaskBoardHandlers;
  workspaceName: (task: KanbanTask) => string;
  /** Active subtasks of a task, in order. */
  subtasks: (task: KanbanTask) => KanbanTask[];
  onOpen: (id: string, options?: { editTitle?: boolean }) => void;
};

/** The task's own agents followed by one per subtask conversation. */
function withSubtaskAgents(linked: LinkedConversation[], subtasks: readonly KanbanTask[], conversations: readonly ConversationRecord[]): LinkedConversation[] {
  const seen = new Set(linked.map((item) => item.conversation.id));
  const extra: LinkedConversation[] = [];
  for (const subtask of subtasks) {
    for (const id of kanbanTaskConversationIds(subtask)) {
      const conversation = findTaskConversation(conversations, id);
      if (!conversation || seen.has(conversation.id)) continue;
      seen.add(conversation.id);
      extra.push({ conversation, status: "plain", label: subtask.title });
    }
  }
  return [...linked, ...extra];
}

function SortableTask({ task, columnId, context }: { task: KanbanTask; columnId: KanbanTaskStatus; context: CardContext }) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const actions = useTaskActions(task, context.handlers, { onRename: () => context.onOpen(task.id, { editTitle: true }) });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: {
      type: "ticket",
      columnId,
      getDragDimensions: () => {
        const node = cardRef.current;
        if (!node) return null;
        return { layoutWidth: node.offsetWidth, renderedWidth: node.getBoundingClientRect().width };
      },
    },
    transition: reduceMotion ? null : SORT_TRANSITION,
    animateLayoutChanges: ({ isSorting, wasDragging }) => isSorting || wasDragging,
  });
  const setCardRef = useCallback((node: HTMLDivElement | null) => {
    cardRef.current = node;
    setNodeRef(node);
  }, [setNodeRef]);

  return (
    <>
      <div
        ref={setCardRef}
        data-task-id={task.id}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cx("shrink-0 touch-manipulation rounded-xl outline-none focus-visible:ring-[2.5px] focus-visible:ring-border-button-hover", isDragging && "opacity-20")}
        {...attributes}
        {...listeners}
        aria-label={t("kanban.openTask", { title: task.title })}
        aria-haspopup="dialog"
        onClick={(event) => { event.currentTarget.focus(); context.onOpen(task.id); }}
        onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); context.onOpen(task.id); }
          else listeners?.onKeyDown?.(event);
        }}
      >
        {/* Animate inside the measured node so scaling never changes the drop target. */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.7, filter: "blur(6px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          <TaskCard task={task} workspaceName={context.workspaceName(task)} linked={withSubtaskAgents(actions.linked, context.subtasks(task), context.handlers.conversations)} subtasks={context.subtasks(task)} />
        </motion.div>
      </div>
      <ContextMenu position={menu} onClose={closeMenu}>
        <Menu aria-label={t("kanban.taskActions")} onAction={actions.run}>
          {actions.items(closeMenu)}
        </Menu>
      </ContextMenu>
    </>
  );
}

function TaskPresence({ task, columnId, context }: { task: KanbanTask; columnId: KanbanTaskStatus; context: CardContext }) {
  const isPresent = useIsPresent();
  const reduceMotion = useReducedMotion();
  const { measureDroppableContainers } = useDndContext();
  const transition = { duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <motion.div
      initial={reduceMotion ? false : { height: 0, paddingBottom: 0 }}
      animate={{ height: "auto", paddingBottom: 6 }}
      exit={{ height: 0, paddingBottom: 0 }}
      transition={transition}
      // The cards keep their own size while this slot resizes, so their
      // ResizeObservers cannot detect the changing positions of their siblings.
      onUpdate={() => measureDroppableContainers([])}
      onAnimationComplete={() => measureDroppableContainers([])}
      className="relative shrink-0 pb-1.5"
      aria-hidden={!isPresent || undefined}
      inert={!isPresent}
    >
      <motion.div
        initial={false}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.7, filter: reduceMotion ? "blur(0px)" : "blur(6px)" }}
        transition={transition}
      >
        {isPresent ? (
          <SortableTask task={task} columnId={columnId} context={context} />
        ) : (
          // Unregister the old sortable immediately; only its visual ghost remains.
          <div className="pointer-events-none opacity-20">
            <TaskCard task={task} workspaceName={context.workspaceName(task)} linked={[]} subtasks={context.subtasks(task)} overlay />
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function StatusColumn({ column, context, onAdd }: {
  column: BoardColumn;
  context: CardContext;
  onAdd: (status: KanbanTaskStatus) => void;
}) {
  const t = useT();
  const [scrollFade, setScrollFade] = useState(0);
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: "column", columnId: column.id },
  });
  const title = kanbanTaskStatusLabel(column.id);

  return (
    <section
      ref={setNodeRef}
      className={cx(
        "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2-5xl bg-background-secondary-default pt-3",
        "ring-2 ring-inset ring-transparent transition-[box-shadow,background-color] duration-150 ease-out",
        isOver && "bg-background-secondary-hover ring-border-button-hover",
      )}
    >
      <div className="flex h-5 shrink-0 items-center justify-between px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="truncate text-body-medium text-text-primary">{title}</h2>
          <span className="text-body-medium text-text-secondary">{column.tasks.length}</span>
        </div>
        <button
          type="button"
          aria-label={t("kanban.addToColumn", { status: title })}
          onClick={() => onAdd(column.id)}
          className="flex size-5 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary transition-colors duration-150 hover:bg-background-tertiary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >
          <RiAddLine className="size-5" aria-hidden />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* Keep the items reference stable during pointer updates so reorder transitions stay enabled. */}
        <SortableContext items={column.tasks} strategy={verticalListSortingStrategy}>
          <div
            role="region"
            aria-label={t("kanban.columnRegion", { status: title })}
            tabIndex={0}
            onScroll={(event) => setScrollFade(Math.min(1, Math.max(0, event.currentTarget.scrollTop) / 24))}
            className="flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain px-1.5 pt-2 [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-button-hover"
          >
            <AnimatePresence initial={false}>
              {column.tasks.map((task) => (
                <TaskPresence key={task.id} task={task} columnId={column.id} context={context} />
              ))}
            </AnimatePresence>
          </div>
        </SortableContext>
        {/* Fade each layer separately: parent opacity creates a backdrop root that hides the cards from the blur. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6">
          <div className="absolute inset-0 backdrop-blur-[1px] [mask-image:linear-gradient(to_bottom,black,transparent)]" style={{ opacity: scrollFade }} />
          <div className="absolute inset-x-0 top-0 h-4 backdrop-blur-[4px] [mask-image:linear-gradient(to_bottom,black,transparent)]" style={{ opacity: scrollFade }} />
          <div className={cx("absolute inset-0 bg-linear-to-b to-transparent", isOver ? "from-background-secondary-hover" : "from-background-secondary-default")} style={{ opacity: scrollFade }} />
        </div>
      </div>
      <AnimatePresence>
        {column.tasks.length === 0 ? <ProjectBoardEmptyState key="empty" /> : null}
      </AnimatePresence>
    </section>
  );
}

/**
 * The TodeX task board on the BoardUI project-board template: status columns
 * with sortable cards and cross-column drag and drop, a detail sheet per
 * task, and the create-task dialog. Data comes from the kanban store.
 */
export function ProjectBoard({ groups, workspaces, total, handlers, defaultWorkspaceId, toolbar, onBack }: {
  /** Workspaces in sidebar order with their (sorted) tasks. */
  groups: readonly WorkspaceTasks[];
  /** Every workspace in sidebar order, for filters, moves and new tasks. */
  workspaces: readonly WorkspaceRecord[];
  total: number;
  handlers: TaskBoardHandlers;
  defaultWorkspaceId?: string;
  /** Extra controls at the start of the toolbar (the backend filter). */
  toolbar?: ReactNode;
  onBack: () => void;
}) {
  const t = useT();
  const direction = useDirection();
  const dndId = useId();
  const reduceMotion = useReducedMotion();
  const [sort, setSort] = useState<BoardSort>("manual");
  const [workspaceFilter, setWorkspaceFilter] = useState("all");
  const [showDone, setShowDone] = useState(true);
  const [fillColumns, setFillColumns] = useState(true);
  const [activeTask, setActiveTask] = useState<KanbanTask | null>(null);
  const [dragScale, setDragScale] = useState(1);
  const [dragWidth, setDragWidth] = useState(261);
  const portalRoot = useSyncExternalStore<HTMLElement | null>(subscribeToDocument, getPortalRoot, getServerPortalRoot);
  const boardRef = useRef<HTMLDivElement>(null);
  const lastDragEnd = useRef(0);

  // The filtered workspace may disappear (deleted elsewhere): fall back to all.
  const filter = workspaceFilter !== "all" && workspaces.some((workspace) => workspace.id === workspaceFilter) ? workspaceFilter : "all";
  const boardColumns = useMemo(
    () => buildBoardColumns(filter === "all" ? groups : groups.filter((group) => group.workspace.id === filter), sort),
    [groups, filter, sort],
  );
  // While a card is dragged the board shows a local copy the drag reshapes;
  // the drop writes the result to the store and the copy is dropped.
  const [dragColumns, setDragColumnsState] = useState<BoardColumn[] | null>(null);
  const dragColumnsRef = useRef<BoardColumn[] | null>(null);
  const setDragColumns = (next: BoardColumn[] | null | ((current: BoardColumn[]) => BoardColumn[])) => {
    const value = typeof next === "function" ? (dragColumnsRef.current ? next(dragColumnsRef.current) : null) : next;
    dragColumnsRef.current = value;
    setDragColumnsState(value);
  };
  const columns = dragColumns ?? boardColumns;
  const visibleColumns = columns.filter((column) => showDone || column.id !== "done");

  const workspaceNames = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspaceDisplayName(workspace)])), [workspaces]);
  const allTasks = useMemo(() => groups.flatMap((group) => group.tasks), [groups]);
  const storeTasks = useKanbanTasks();
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, KanbanTask[]>();
    for (const task of storeTasks) {
      if (!task.parentId || task.deletedAt || map.has(task.parentId)) continue;
      map.set(task.parentId, kanbanSubtasks(storeTasks, task.parentId));
    }
    return map;
  }, [storeTasks]);

  const [createModal, setCreateModal] = useState({ open: false, session: 0, status: undefined as KanbanTaskStatus | undefined });
  const [detail, setDetail] = useState({ id: null as string | null, open: false, session: 0, editTitle: false });
  // The sheet also shows subtasks, which are not on the board itself.
  const detailTask = storeTasks.find((task) => task.id === detail.id && !task.deletedAt);

  const openDetail = (id: string, options?: { editTitle?: boolean }) => {
    if (dragColumnsRef.current || performance.now() - lastDragEnd.current < 350) return;
    setDetail((current) => ({ id, open: true, session: current.session + 1, editTitle: Boolean(options?.editTitle) }));
  };
  const context: CardContext = {
    handlers,
    workspaceName: (task) => workspaceNames.get(task.workspaceId) ?? "",
    subtasks: (task) => subtasksByParent.get(task.id) ?? NO_SUBTASKS,
    onOpen: openDetail,
  };

  const openCreateModal = (status?: KanbanTaskStatus) => {
    setCreateModal((current) => ({ open: true, session: current.session + 1, status }));
  };
  const closeCreateModal = () => setCreateModal((current) => ({ ...current, open: false }));

  const createTask = (draft: NewBoardTask) => {
    const task = addKanbanTask(draft.workspaceId, draft.title, { description: draft.description, dueDate: draft.dueDate, priority: draft.priority ?? undefined });
    if (!task) return false;
    if (draft.status !== "planned") setKanbanTaskStatus(task.id, draft.status);
    if (filter !== "all" && filter !== draft.workspaceId) setWorkspaceFilter("all");
    if (!showDone && draft.status === "done") setShowDone(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const card = boardRef.current?.querySelector(`[data-task-id="${CSS_ESCAPE(task.id)}"]`);
      card?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduceMotion ? "instant" : "smooth" });
    }));
    return true;
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    setDragColumns(cloneColumns(boardColumns));
    setActiveTask(taskFor(boardColumns, active.id));
    // The overlay is portaled outside scaled previews. Measure the source
    // directly: dnd-kit's initial rect is not populated until after drag start.
    const dimensions = active.data.current?.getDragDimensions?.();
    const width = dimensions?.layoutWidth || 261;
    setDragWidth(width);
    setDragScale((dimensions?.renderedWidth || width) / width);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDragColumns((current) => {
      const fromId = columnFor(current, active.id);
      const toId = columnFor(current, over.id);
      if (!fromId || !toId || fromId === toId) return current;

      const from = current.find((column) => column.id === fromId)!;
      const to = current.find((column) => column.id === toId)!;
      const fromIndex = from.tasks.findIndex((task) => task.id === active.id);
      if (fromIndex < 0) return current;

      const moving = from.tasks[fromIndex];
      const overIndex = to.tasks.findIndex((task) => task.id === over.id);
      const belowTarget = active.rect.current.translated &&
        active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
      const insertAt = overIndex < 0 ? to.tasks.length : overIndex + (belowTarget ? 1 : 0);

      return current.map((column) => {
        if (column.id === fromId) return { ...column, tasks: column.tasks.filter((task) => task.id !== active.id) };
        if (column.id === toId) {
          const tasks = [...column.tasks];
          tasks.splice(insertAt, 0, moving);
          return { ...column, tasks };
        }
        return column;
      });
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    lastDragEnd.current = performance.now();
    setActiveTask(null);
    let final = dragColumnsRef.current;
    setDragColumns(null);
    if (!over || !final) return;
    const columnId = columnFor(final, active.id);
    const overColumnId = columnFor(final, over.id);
    if (columnId && columnId === overColumnId && active.id !== over.id) {
      final = final.map((column) => {
        if (column.id !== columnId) return column;
        const oldIndex = column.tasks.findIndex((task) => task.id === active.id);
        const newIndex = column.tasks.findIndex((task) => task.id === over.id);
        return oldIndex < 0 || newIndex < 0 ? column : { ...column, tasks: arrayMove(column.tasks, oldIndex, newIndex) };
      });
    }
    const column = final.find((item) => item.id === columnId);
    const task = column?.tasks.find((item) => item.id === String(active.id));
    const original = allTasks.find((item) => item.id === String(active.id));
    if (!column || !task || !original) return;
    // A sorted board only changes status; manual order is kept per workspace.
    if (sort !== "manual") {
      if (original.status !== column.id) setKanbanTaskStatus(task.id, column.id);
      return;
    }
    const sameWorkspace = (items: KanbanTask[]) => items.filter((item) => item.workspaceId === task.workspaceId);
    const index = sameWorkspace(column.tasks).findIndex((item) => item.id === task.id);
    const before = sameWorkspace(boardColumns.find((item) => item.id === original.status)?.tasks ?? []).findIndex((item) => item.id === task.id);
    if (original.status === column.id && index === before) return;
    moveKanbanTasks([task.id], { workspaceId: task.workspaceId, status: column.id, index });
  };

  const onDragCancel = () => {
    lastDragEnd.current = performance.now();
    setDragColumns(null);
    setActiveTask(null);
  };

  // A task deleted from its own detail sheet closes the sheet.
  useEffect(() => {
    if (detail.open && detail.id && !detailTask) setDetail((current) => ({ ...current, open: false }));
  }, [detail.open, detail.id, detailTask]);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2.5">
      {/* The page title lives in the app header above the board. */}
      <header className="flex w-full shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Chip color="blue" variant="caption">{t("kanban.taskCount", { count: total })}</Chip>
          <p className="truncate text-body-regular text-text-secondary">{t("kanban.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 sm:justify-end">
          {toolbar}
          <ProjectBoardControls
            sort={sort} onSort={setSort}
            workspaceId={filter} onWorkspace={setWorkspaceFilter} workspaces={workspaces}
            showDone={showDone} onShowDone={setShowDone}
            fillColumns={fillColumns} onFillColumns={setFillColumns}
          />
          <Button variant="primary" size="medium" leadingIcon={RiAddLine} onClick={() => openCreateModal()}>
            {t("kanban.newTask")}
          </Button>
          <Button variant="secondary" size="medium" trailingIcon={RiArrowRightLine} onClick={onBack}>
            {t("kanban.backToChat")}
          </Button>
        </div>
      </header>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={boardCollisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        autoScroll={{ acceleration: 5, threshold: { x: 0.12, y: 0.12 } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{ screenReaderInstructions: { draggable: t("kanban.dragHint") } }}
      >
        <div ref={boardRef} className="-mx-3 min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:thin] sm:-mx-6" role="region" aria-label={t("kanban.columnsAria")} tabIndex={0}>
          <div className={cx(
            "grid h-full grid-flow-col gap-2 px-3 sm:px-6",
            fillColumns ? "w-full min-w-max auto-cols-[minmax(273px,1fr)]" : "w-max auto-cols-[273px]",
          )}>
            {visibleColumns.map((column) => (
              <StatusColumn key={column.id} column={column} context={context} onAdd={openCreateModal} />
            ))}
          </div>
        </div>
        {portalRoot
          ? createPortal(
              <DragOverlay dropAnimation={reduceMotion ? null : { ...DROP_TRANSITION, sideEffects: DROP_SIDE_EFFECTS }}>
                {activeTask ? (
                  <div dir={direction} className="origin-top-left" style={{ width: dragWidth, transform: `scale(${dragScale})` }}>
                    <TaskCard task={activeTask} workspaceName={context.workspaceName(activeTask)} linked={[]} subtasks={context.subtasks(activeTask)} overlay />
                  </div>
                ) : null}
              </DragOverlay>,
              portalRoot,
            )
          : null}
      </DndContext>
      {detailTask ? (
        <TicketDetailModal
          key={detail.session}
          isOpen={detail.open}
          task={detailTask}
          workspaces={workspaces}
          handlers={handlers}
          editTitle={detail.editTitle}
          onOpenTask={(id) => setDetail((current) => ({ ...current, id, editTitle: false }))}
          onClose={() => setDetail((current) => ({ ...current, open: false }))}
        />
      ) : null}
      <CreateTicketModal
        key={createModal.session}
        isOpen={createModal.open}
        onClose={closeCreateModal}
        initialStatus={createModal.status}
        initialWorkspaceId={filter !== "all" ? filter : defaultWorkspaceId && workspaces.some((workspace) => workspace.id === defaultWorkspaceId) ? defaultWorkspaceId : workspaces[0]?.id}
        workspaces={workspaces}
        onCreate={createTask}
      />
    </div>
  );
}

// `CSS` above is dnd-kit's helper; the selector escape lives on the global one.
const CSS_ESCAPE = (value: string) => globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value;

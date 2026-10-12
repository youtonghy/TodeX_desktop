"use client";

import { useDirection } from "@/components/foundations/direction/direction";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, Focusable, Heading, Input as AriaInput, Modal, ModalOverlay, Pressable, TextField } from "react-aria-components";
import { parseDate } from "@internationalized/date";
import type { WorkspaceRecord } from "@todex/protocol/todex";
import { RiAddLine, RiArrowRightSLine, RiCalendarLine, RiChat3Line, RiCloseLine, RiEditLine, RiFlag2Fill, RiFlag2Line, RiFolder6Line, RiMore2Fill, RiTimerLine } from "@remixicon/react";
import { ProviderIcon } from "@/components/ProviderIcon";
import { TaskProgress, type TaskProgressItem } from "@/components/application/agent-progress/agent-progress";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { IconButton } from "@/components/base/buttons/icon-button";
import { DatePicker } from "@/components/base/date-picker/date-picker";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { Textarea } from "@/components/base/textarea/textarea";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { Menu, MenuItem, MenuPopover, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useT } from "@/i18n";
import { conversationDisplayTitle, isV2Conversation, workspaceDisplayName } from "@/session/helpers";
import {
  addKanbanTask,
  isKanbanTaskOverdue,
  kanbanSubtasks,
  kanbanTaskConversationIds,
  kanbanTaskPriorities,
  kanbanTaskPriorityLabel,
  kanbanTaskStatusLabel,
  kanbanTaskStatuses,
  moveKanbanTasks,
  renameKanbanTask,
  setKanbanTaskPriority,
  setKanbanTaskStatus,
  updateKanbanTaskDetails,
  useKanbanTasks,
  type KanbanTask,
  type KanbanTaskPriority,
  type KanbanTaskStatus,
} from "@/session/kanbanTasks";
import { cx } from "@/utils/cx";
import { CONVERSATION_GROUP_DOT, PRIORITY_CHIP_COLOR, PRIORITY_FLAG_CLASS, findTaskConversation, localDate } from "./project-board-data";
import { TaskStatusIcon } from "./project-board-icons";
import { useTaskActions, type TaskBoardHandlers } from "./task-actions";
import { TaskActivity } from "./task-activity";
import { TaskScheduleLine, scheduleTone } from "./task-schedule";
import { TicketCornerGenieSurface } from "./ticket-corner-genie-surface";
import styles from "./ticket-detail-modal.module.css";

const TOOL_BUTTON = "size-6 rounded-lg text-foreground-icon-secondary [&>svg]:size-[18px]";
const PROPERTY_PILL = "-m-1 flex cursor-pointer items-center gap-1.5 rounded-md p-1 text-body-medium text-text-primary outline-none transition-colors duration-150 ease hover:bg-background-primary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring";

function PropertySelect({ label, value, options, onChange, renderValue }: {
  label: string;
  value: string;
  options: { id: string; label: string; icon?: ReactNode }[];
  onChange: (value: string) => void;
  renderValue?: ReactNode;
}) {
  return (
    <Select
      aria-label={label} selectedKey={value}
      onSelectionChange={(key) => key !== null && onChange(String(key))}
      size="sm" renderValue={renderValue} className="-m-1"
      triggerClassName="w-auto min-w-0 justify-start rounded-md border-0 bg-transparent p-1 text-body-medium text-text-primary shadow-none hover:bg-background-primary-hover [&>svg]:hidden"
      popoverClassName="w-[220px] rounded-[14px] p-1"
    >
      {options.map((option) => <SelectItem id={option.id} key={option.id} textValue={option.label} className="px-2 py-1.5 text-body-medium">{option.icon}{option.label}</SelectItem>)}
    </Select>
  );
}

/** Due date property: a pill that opens the BoardUI date picker, plus a clear button. */
function DueDateProperty({ task }: { task: KanbanTask }) {
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const overdue = isKanbanTaskOverdue(task);
  return (
    <span className="flex items-center gap-0.5">
      <button ref={triggerRef} type="button" aria-label={t("kanban.dueDate")} className={PROPERTY_PILL} onClick={() => setOpen(!open)}>
        <RiCalendarLine className={cx("size-[18px] shrink-0", overdue ? "text-foreground-icon-error" : "text-foreground-icon-secondary")} aria-hidden />
        <span className={cx(task.dueDate ? (overdue ? "text-text-error-primary" : "text-text-primary") : "text-text-tertiary")}>
          {task.dueDate ? `${task.dueDate}${overdue ? t("kanban.overdue") : ""}` : t("kanban.noDueDate")}
        </span>
      </button>
      {task.dueDate ? (
        <button
          type="button"
          aria-label={t("kanban.clearDueDate")}
          onClick={() => updateKanbanTaskDetails(task.id, { dueDate: "" })}
          className="flex size-5 cursor-pointer items-center justify-center rounded-md text-foreground-icon-tertiary outline-none transition-colors duration-150 hover:bg-background-primary-hover hover:text-foreground-icon-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >
          <RiCloseLine className="size-4" aria-hidden />
        </button>
      ) : null}
      <DatePicker
        aria-label={t("kanban.dueDate")}
        triggerRef={triggerRef}
        isOpen={open}
        onOpenChange={setOpen}
        value={task.dueDate ? parseDate(task.dueDate) : null}
        onChange={(date) => updateKanbanTaskDetails(task.id, { dueDate: date ? date.toString() : "" })}
      />
    </span>
  );
}

const NO_PRIORITY = "none";

export function PriorityChip({ priority, className }: { priority: KanbanTaskPriority; className?: string }) {
  return (
    <Chip color={PRIORITY_CHIP_COLOR[priority]} variant="caption" className={cx("py-0.5 text-body-2-medium", className)}>
      {kanbanTaskPriorityLabel(priority)}
    </Chip>
  );
}

/** Subtasks as the agent-progress module, with an add field under the list. */
function SubtaskList({ task, subtasks, handlers, onOpenTask }: {
  task: KanbanTask;
  subtasks: KanbanTask[];
  handlers: TaskBoardHandlers;
  onOpenTask: (id: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const remaining = subtasks.filter((item) => item.status !== "done").length;
  const items: TaskProgressItem[] = subtasks.map((item) => {
    const conversation = kanbanTaskConversationIds(item)
      .map((id) => findTaskConversation(handlers.conversations, id))
      .find(Boolean);
    const schedule = item.schedule && item.schedule.status !== "cancelled" && item.schedule.status !== "done" ? item.schedule : undefined;
    return {
      id: item.id,
      label: item.title,
      state: item.status === "done" ? "done" : item.status === "in-progress" ? "active" : "pending",
      trailing: (
        <>
          {item.priority ? <PriorityChip priority={item.priority} /> : null}
          {schedule ? <RiTimerLine className={cx("size-4", scheduleTone(schedule))} aria-label={t("kanban.schedule")} /> : null}
          {conversation ? (
            <span className="flex size-[22px] items-center justify-center rounded-full bg-background-tertiary-default" aria-label={t("kanban.conversationCount", { count: 1 })}>
              <ProviderIcon className="size-3" provider={isV2Conversation(conversation) ? conversation.provider : "codex"} />
            </span>
          ) : null}
        </>
      ),
    };
  });
  return (
    <TaskProgress
      label={t("kanban.subtasks")}
      status={!subtasks.length ? t("kanban.subtasksEmpty") : remaining ? t("kanban.subtasksLeft", { count: remaining }) : t("kanban.subtasksDone")}
      items={items}
      onSelect={onOpenTask}
      footer={(
        <form
          className="flex items-center gap-2 ps-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (addKanbanTask(task.workspaceId, draft, { parentId: task.id })) setDraft("");
          }}
        >
          <RiAddLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
          <TextField aria-label={t("kanban.addSubtask")} value={draft} onChange={setDraft} maxLength={200} className="flex min-w-0 flex-1">
            <AriaInput placeholder={t("kanban.addSubtask")} className="h-8 min-w-0 flex-1 bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-tertiary" />
          </TextField>
          {draft.trim() ? <Button type="submit" size="small" variant="secondary">{t("kanban.add")}</Button> : null}
        </form>
      )}
    />
  );
}

/** Figma 4509:12272: the task opened from the board, as a sheet on the right.
 * A subtask opens in the same sheet, with its parent in the breadcrumb. */
export function TicketDetailModal({ isOpen, task, workspaces, handlers, editTitle, onOpenTask, onClose }: {
  isOpen: boolean;
  task: KanbanTask;
  workspaces: readonly WorkspaceRecord[];
  handlers: TaskBoardHandlers;
  /** Opens with the title in edit mode (the "rename" action). */
  editTitle?: boolean;
  /** Shows another task (a subtask or the parent) in the sheet. */
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const direction = useDirection();
  return (
    <ModalOverlay dir={direction} isOpen={isOpen} onOpenChange={(open) => !open && onClose()} isDismissable
      className="fixed inset-0 z-100 flex items-stretch justify-end overflow-hidden p-3 max-sm:p-2">
      <Modal className={cx("h-full w-full max-w-[609px] outline-none", styles.panel)}>
        <TicketCornerGenieSurface exiting={!isOpen}>
        <Dialog aria-label={t("kanban.taskDetails")} className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl bg-ticket-detail-surface outline-none">
          <TicketDetailBody
            key={task.id}
            task={task}
            workspaces={workspaces}
            handlers={handlers}
            editTitle={editTitle}
            onOpenTask={onOpenTask}
            onClose={onClose}
          />
        </Dialog>
        </TicketCornerGenieSurface>
      </Modal>
    </ModalOverlay>
  );
}

function TicketDetailBody({ task, workspaces, handlers, editTitle, onOpenTask, onClose }: {
  task: KanbanTask;
  workspaces: readonly WorkspaceRecord[];
  handlers: TaskBoardHandlers;
  editTitle?: boolean;
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const allTasks = useKanbanTasks();
  const workspace = workspaces.find((item) => item.id === task.workspaceId);
  const parent = task.parentId ? allTasks.find((item) => item.id === task.parentId && !item.deletedAt) : undefined;
  const subtasks = useMemo(() => (parent ? [] : kanbanSubtasks(allTasks, task.id)), [allTasks, parent, task.id]);
  const [editingTitle, setEditingTitle] = useState(Boolean(editTitle));
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? "");
  const [scrollFade, setScrollFade] = useState(0);
  const startTitleEdit = () => { setTitleDraft(task.title); setEditingTitle(true); };
  const actions = useTaskActions(task, handlers, { onRename: startTitleEdit });
  const { groups, staleCount, linked, run, canStart, canSchedule, hasSubtasks } = actions;
  const { session, conversations, onOpenConversation, onStartConversation, onSchedule } = handlers;
  // A subtask's description is the prompt its conversation starts with.
  const descriptionLabel = parent ? t("kanban.promptLabel") : t("kanban.descLabel");

  // Activity across the task's own conversations and its subtasks'.
  const activityIds = useMemo(() => [task, ...subtasks]
    .flatMap((item) => kanbanTaskConversationIds(item))
    .flatMap((id) => {
      const conversation = findTaskConversation(conversations, id);
      return conversation ? [conversation.id, conversation.v2ConversationId ?? ""] : [id];
    })
    .filter(Boolean), [task, subtasks, conversations]);

  const moveToWorkspace = (workspaceId: string) => {
    if (workspaceId === task.workspaceId) return;
    moveKanbanTasks([task.id], { workspaceId, status: task.status, index: Number.MAX_SAFE_INTEGER });
  };

  return (
    <>
          <header className="flex shrink-0 items-center justify-between gap-3 px-6 pt-6 pb-5 max-sm:px-4 max-sm:pt-4">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <div className="flex min-w-0 items-center gap-0.5 text-body-2-medium text-text-secondary">
                <span className="truncate">{workspace ? workspaceDisplayName(workspace) : t("kanban.workspace")}</span>
                <RiArrowRightSLine className="size-[15px] shrink-0 rtl:rotate-180" aria-hidden />
                {parent ? (
                  <>
                    <button type="button" onClick={() => onOpenTask(parent.id)} className="max-w-[180px] cursor-pointer truncate rounded-sm outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                      {parent.title}
                    </button>
                    <RiArrowRightSLine className="size-[15px] shrink-0 rtl:rotate-180" aria-hidden />
                  </>
                ) : null}
                <span className="shrink-0">{kanbanTaskStatusLabel(task.status)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {linked.length ? (
                  <TooltipTrigger delay={200}>
                    <Focusable>
                      <IconButton icon={RiChat3Line} size="small" className={TOOL_BUTTON} aria-label={t("kanban.openConversation")} onClick={() => run("open")} />
                    </Focusable>
                    <Tooltip placement="bottom">{t("kanban.openConversation")}</Tooltip>
                  </TooltipTrigger>
                ) : null}
                <MenuTrigger>
                  <Pressable>
                    <IconButton icon={RiMore2Fill} size="small" className={TOOL_BUTTON} aria-label={t("kanban.taskActions")} />
                  </Pressable>
                  <MenuPopover placement="bottom end">
                    <Menu aria-label={t("kanban.taskActions")} onAction={(key) => {
                      if (key === "edit-description") { setDescriptionDraft(task.description ?? ""); setEditingDescription(true); }
                      else run(key);
                    }}>
                      <MenuItem id="edit-description" icon={RiEditLine} textValue={parent ? t("kanban.editPrompt") : t("kanban.editDescription")}>{parent ? t("kanban.editPrompt") : t("kanban.editDescription")}</MenuItem>
                      <MenuSeparator />
                      {actions.items()}
                    </Menu>
                  </MenuPopover>
                </MenuTrigger>
              </div>
            </div>
            <CloseButton size="sm" className="self-start" aria-label={t("common.close")} onClick={onClose} />
          </header>

          <div className="relative min-h-0 flex-1">
          <div
            role="region"
            aria-label={t("kanban.taskDetails")}
            tabIndex={0}
            onScroll={(event) => setScrollFade(Math.min(1, Math.max(0, event.currentTarget.scrollTop) / 24))}
            className="h-full min-h-0 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring"
          >
            <div className="flex min-h-full flex-col">
              <div className="flex flex-col gap-5 px-6 max-sm:px-4">
                <section className="flex flex-col gap-3" aria-label={descriptionLabel}>
                  <p className="text-body-medium text-text-secondary">{t("kanban.createdAt", { date: localDate(task.createdAt) })}</p>
                  <div className="flex flex-col gap-1.5">
                    {editingTitle ? (
                      <form className="flex flex-col gap-3" onSubmit={(event) => {
                        event.preventDefault();
                        if (!titleDraft.trim()) return;
                        renameKanbanTask(task.id, titleDraft);
                        setEditingTitle(false);
                      }}>
                        <Input aria-label={t("kanban.titlePlaceholder")} value={titleDraft} onChange={setTitleDraft} autoFocus maxLength={200} />
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" size="small" onClick={() => setEditingTitle(false)}>{t("common.cancel")}</Button>
                          <Button type="submit" size="small" disabled={!titleDraft.trim()}>{t("common.save")}</Button>
                        </div>
                      </form>
                    ) : (
                      <Heading slot="title" className="text-headline-medium text-text-primary wrap-anywhere">{task.title}</Heading>
                    )}
                    {editingDescription ? (
                      <form className="flex flex-col gap-3" onSubmit={(event) => {
                        event.preventDefault();
                        updateKanbanTaskDetails(task.id, { description: descriptionDraft });
                        setEditingDescription(false);
                      }}>
                        <Textarea aria-label={descriptionLabel} placeholder={parent ? t("kanban.promptPlaceholder") : t("kanban.descPlaceholder")} value={descriptionDraft} onChange={setDescriptionDraft} rows={parent ? 6 : 4} maxLength={2000} autoFocus />
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" size="small" onClick={() => setEditingDescription(false)}>{t("common.cancel")}</Button>
                          <Button type="submit" size="small">{t("common.save")}</Button>
                        </div>
                      </form>
                    ) : task.description ? (
                      <p className="whitespace-pre-wrap text-body-regular text-text-secondary wrap-anywhere">{task.description}</p>
                    ) : (
                      <button type="button" onClick={() => { setDescriptionDraft(""); setEditingDescription(true); }} className="w-fit cursor-pointer rounded-sm text-start text-body-regular text-text-tertiary outline-none hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                        {parent ? t("kanban.noPrompt") : t("kanban.noDescription")}
                      </button>
                    )}
                  </div>
                </section>

                <div role="group" aria-label={t("kanban.properties")} className="flex items-start gap-5 max-sm:flex-col max-sm:gap-2">
                  <span className="w-[70px] shrink-0 pt-0.5 text-body-medium text-text-secondary">{t("kanban.properties")}</span>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
                    <PropertySelect
                      label={t("kanban.setStatus")}
                      value={task.status}
                      options={kanbanTaskStatuses.map((status) => ({ id: status, label: kanbanTaskStatusLabel(status), icon: <TaskStatusIcon status={status} className="text-foreground-icon-secondary" /> }))}
                      onChange={(status) => setKanbanTaskStatus(task.id, status as KanbanTaskStatus)}
                      renderValue={<span className="flex items-center gap-1.5"><TaskStatusIcon status={task.status} className="text-foreground-icon-secondary" />{kanbanTaskStatusLabel(task.status)}</span>}
                    />
                    <PropertySelect
                      label={t("kanban.priority")}
                      value={task.priority ?? NO_PRIORITY}
                      options={[
                        { id: NO_PRIORITY, label: t("kanban.priorityNone"), icon: <RiFlag2Line className="size-[18px] text-foreground-icon-tertiary" aria-hidden /> },
                        ...kanbanTaskPriorities.map((priority) => ({ id: priority, label: kanbanTaskPriorityLabel(priority), icon: <RiFlag2Fill className={cx("size-[18px]", PRIORITY_FLAG_CLASS[priority])} aria-hidden /> })),
                      ]}
                      onChange={(value) => setKanbanTaskPriority(task.id, value === NO_PRIORITY ? null : value as KanbanTaskPriority)}
                      renderValue={task.priority
                        ? <PriorityChip priority={task.priority} />
                        : <span className="flex items-center gap-1.5 text-text-tertiary"><RiFlag2Line className="size-[18px] text-foreground-icon-secondary" aria-hidden />{t("kanban.priority")}</span>}
                    />
                    {parent ? null : (
                      <PropertySelect
                        label={t("kanban.workspace")}
                        value={task.workspaceId}
                        options={workspaces.map((item) => ({ id: item.id, label: workspaceDisplayName(item), icon: <RiFolder6Line className="size-[18px] text-foreground-icon-secondary" aria-hidden /> }))}
                        onChange={moveToWorkspace}
                        renderValue={<span className="flex items-center gap-1.5"><RiFolder6Line className="size-[18px] text-foreground-icon-secondary" aria-hidden />{workspace ? workspaceDisplayName(workspace) : t("kanban.workspace")}</span>}
                      />
                    )}
                    <DueDateProperty task={task} />
                    {/* Schedules from before scheduled conversations still show
                        (and run); new ones are scheduled conversations. */}
                    {task.schedule && task.schedule.status !== "cancelled" ? (
                      <span className={PROPERTY_PILL}>
                        <TaskScheduleLine schedule={task.schedule} className="text-body-medium" />
                      </span>
                    ) : canSchedule ? (
                      <button type="button" className={PROPERTY_PILL} onClick={() => onSchedule(task)}>
                        <RiTimerLine className="size-[18px] shrink-0 text-foreground-icon-secondary" aria-hidden /><span className="text-text-tertiary">{t("kanban.schedule")}</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {parent ? null : (
                  <div className="flex items-start gap-5 max-sm:flex-col max-sm:gap-2" role="group" aria-label={t("kanban.subtasks")}>
                    <span className="w-[70px] shrink-0 pt-2.5 text-body-medium text-text-secondary">{t("kanban.subtasks")}</span>
                    <SubtaskList task={task} subtasks={subtasks} handlers={handlers} onOpenTask={onOpenTask} />
                  </div>
                )}

                <div className="flex items-start gap-5 max-sm:flex-col max-sm:gap-2" role="group" aria-label={t("kanban.conversations")}>
                  <span className="w-[70px] shrink-0 pt-0.5 text-body-medium text-text-secondary">{t("kanban.conversation")}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {groups.length === 0 ? (
                      <p className="pt-0.5 text-body-medium text-text-tertiary">{hasSubtasks ? t("kanban.conversationsInSubtasks") : t("kanban.noConversations")}</p>
                    ) : null}
                    {groups.map((group) => (
                      <div key={group.kind} className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-1.5 text-body-2-medium text-text-tertiary">
                          <span className={cx("size-1.5 shrink-0 rounded-full", CONVERSATION_GROUP_DOT[group.kind])} aria-hidden />
                          {group.label} · {group.kind === "stale" ? staleCount : group.items.length}
                        </span>
                        {group.kind === "stale" ? (
                          <button type="button" onClick={() => run("clear-stale")} className="w-fit cursor-pointer rounded-sm text-body-2-medium text-text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                            {t("kanban.clearStale")}
                          </button>
                        ) : group.items.map(({ conversation }) => (
                          <button
                            key={conversation.id}
                            type="button"
                            onClick={() => onOpenConversation(task.workspaceId, conversation.id)}
                            className="-mx-2 flex min-w-0 cursor-pointer items-center gap-2 rounded-2lg px-2 py-1.5 text-start outline-none transition-colors duration-150 ease hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                          >
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background-tertiary-default">
                              <ProviderIcon className="size-3.5" provider={isV2Conversation(conversation) ? conversation.provider : "codex"} />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-body-medium text-text-primary">{conversationDisplayTitle(conversation, session.timeline)}</span>
                            <RiArrowRightSLine className="size-4 shrink-0 text-foreground-icon-tertiary rtl:rotate-180" aria-hidden />
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                <TaskActivity conversationIds={activityIds} timeline={session.timeline} usageRecords={session.usageRecords} />
              </div>

              <div className="mt-auto flex flex-wrap items-center justify-end gap-2.5 px-6 pt-6 pb-6 max-sm:px-4">
                {canStart ? <Button variant={linked.length ? "secondary" : "primary"} leadingIcon={RiChat3Line} onClick={() => onStartConversation(task)}>{t("kanban.startConversation")}</Button> : null}
                {linked.length ? <Button onClick={() => run("open")}>{t("kanban.openConversation")}</Button> : null}
              </div>
            </div>
          </div>
          {/* Keep opacity on each layer: fading the parent prevents backdrop blur from sampling the content. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6">
            <div className="absolute inset-0 backdrop-blur-[1px] [mask-image:linear-gradient(to_bottom,black,transparent)]" style={{ opacity: scrollFade }} />
            <div className="absolute inset-x-0 top-0 h-4 backdrop-blur-[4px] [mask-image:linear-gradient(to_bottom,black,transparent)]" style={{ opacity: scrollFade }} />
            <div className="absolute inset-0 bg-linear-to-b from-ticket-detail-surface to-transparent" style={{ opacity: scrollFade }} />
          </div>
          </div>
    </>
  );
}

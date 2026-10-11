"use client";

import { useDirection } from "@/components/foundations/direction/direction";
import { useRef, useState, type ReactNode } from "react";
import { Dialog, Form, Modal, ModalOverlay, TextArea, TextField } from "react-aria-components";
import { parseDate } from "@internationalized/date";
import type { WorkspaceRecord } from "@todex/protocol/todex";
import { RiArrowRightSLine, RiCalendarLine, RiFlag2Fill, RiFlag2Line, RiFolder6Line } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { DatePicker } from "@/components/base/date-picker/date-picker";
import { Select, SelectItem } from "@/components/base/select/select";
import { Switch } from "@/components/base/switch/switch";
import { useT } from "@/i18n";
import { workspaceDisplayName } from "@/session/helpers";
import { kanbanTaskPriorities, kanbanTaskPriorityLabel, kanbanTaskStatusLabel, kanbanTaskStatuses, type KanbanTaskPriority, type KanbanTaskStatus } from "@/session/kanbanTasks";
import { cx } from "@/utils/cx";
import { PRIORITY_FLAG_CLASS } from "./project-board-data";
import { TaskStatusIcon } from "./project-board-icons";
import { PriorityChip } from "./ticket-detail-modal";
import { TicketGenieSurface } from "./ticket-genie-surface";
import styles from "./create-ticket-modal.module.css";

export type NewBoardTask = {
  title: string;
  description: string;
  status: KanbanTaskStatus;
  workspaceId: string;
  dueDate: string;
  priority: KanbanTaskPriority | null;
};

const NO_PRIORITY = "none";

const PILL_TRIGGER = "w-auto justify-start rounded-md border-0 bg-transparent p-0 text-body-medium text-text-secondary shadow-none hover:bg-background-primary-hover [&>svg]:hidden";

function TaskSelect({ label, value, onChange, renderValue, children }: {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  renderValue: ReactNode;
  children: ReactNode;
}) {
  return (
    <Select
      aria-label={label}
      selectedKey={value}
      onSelectionChange={(key) => key != null && onChange(String(key))}
      renderValue={<span className="flex items-center gap-1.5">{renderValue}</span>}
      triggerClassName={PILL_TRIGGER}
      popoverClassName="w-[220px]"
    >
      {children}
    </Select>
  );
}

/** Figma default 4491:12600 and filled 4492:12735: a new task, rising in from the bottom. */
export function CreateTicketModal({ isOpen, onClose, initialStatus, initialWorkspaceId, workspaces, onCreate }: {
  isOpen: boolean;
  onClose: () => void;
  initialStatus?: KanbanTaskStatus;
  initialWorkspaceId?: string;
  workspaces: readonly WorkspaceRecord[];
  /** Returns false when the task could not be created (kept open). */
  onCreate: (task: NewBoardTask) => boolean;
}) {
  const t = useT();
  const direction = useDirection();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<KanbanTaskStatus>(initialStatus ?? "planned");
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId ?? workspaces[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<KanbanTaskPriority | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [keepCreating, setKeepCreating] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLButtonElement>(null);
  const workspace = workspaces.find((item) => item.id === workspaceId);

  return (
    <ModalOverlay dir={direction}
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      isDismissable
      className="fixed inset-0 z-100 flex items-end justify-center overflow-clip px-4 pt-4 pb-10"
    >
      <Modal className={cx("w-[560px] max-w-full outline-none", styles.panel)}>
        <TicketGenieSurface exiting={!isOpen}>
        <Dialog aria-label={t("kanban.newTask")} className="max-h-[calc(100dvh-56px)] overflow-y-auto rounded-3xl bg-background-primary-default p-4 outline-none">
          <Form
            className="flex flex-col gap-12"
            onSubmit={(event) => {
              event.preventDefault();
              if (!title.trim() || !workspaceId) {
                titleRef.current?.focus();
                return;
              }
              if (!onCreate({ title: title.trim(), description: description.trim(), status, workspaceId, dueDate, priority })) return;
              if (keepCreating) {
                setTitle("");
                setDescription("");
                setDueDate("");
                titleRef.current?.focus();
              } else onClose();
            }}
          >
            <div className="flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-0.5 text-body-2-medium text-text-secondary">
                  <span className="truncate">{workspace ? workspaceDisplayName(workspace) : t("kanban.workspace")}</span>
                  <RiArrowRightSLine className="size-[15px] shrink-0 text-foreground-icon-tertiary rtl:rotate-180" aria-hidden />
                  <span className="whitespace-nowrap">{t("kanban.newTask")}</span>
                </div>
                <CloseButton size="sm" aria-label={t("common.close")} onClick={onClose} />
              </div>
              <div className="flex flex-col gap-1.5">
                <TextField aria-label={t("kanban.titlePlaceholder")} name="title" value={title} onChange={setTitle} isRequired className="relative grid text-headline-medium text-text-primary">
                  <span aria-hidden className="invisible min-h-[22px] whitespace-pre-wrap wrap-anywhere">{title || t("kanban.titlePlaceholder")}{"\u200b"}</span>
                  <TextArea ref={titleRef} autoFocus rows={1} maxLength={200} placeholder={t("kanban.titlePlaceholder")} className="absolute inset-0 size-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-text-secondary" />
                </TextField>
                <TextField aria-label={t("kanban.descLabel")} name="description" value={description} onChange={setDescription} className="relative grid max-h-[200px] text-body-medium text-text-secondary max-sm:text-[16px]">
                  <span aria-hidden className="invisible min-h-5 whitespace-pre-wrap wrap-anywhere">{description || t("kanban.descPlaceholder")}{"\u200b"}</span>
                  <TextArea rows={1} maxLength={2000} placeholder={t("kanban.descPlaceholder")} className="absolute inset-0 size-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-text-tertiary" />
                </TextField>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <TaskSelect label={t("kanban.setStatus")} value={status} onChange={(value) => setStatus(value as KanbanTaskStatus)} renderValue={<><TaskStatusIcon status={status} />{kanbanTaskStatusLabel(status)}</>}>
                  {kanbanTaskStatuses.map((item) => <SelectItem key={item} id={item} textValue={kanbanTaskStatusLabel(item)}><TaskStatusIcon status={item} className="text-foreground-icon-secondary" />{kanbanTaskStatusLabel(item)}</SelectItem>)}
                </TaskSelect>
                <TaskSelect
                  label={t("kanban.priority")}
                  value={priority ?? NO_PRIORITY}
                  onChange={(value) => setPriority(value === NO_PRIORITY ? null : value as KanbanTaskPriority)}
                  renderValue={priority ? <PriorityChip priority={priority} /> : <><RiFlag2Line className="size-[18px] text-text-primary opacity-30" aria-hidden /><span className="text-text-tertiary">{t("kanban.priority")}</span></>}
                >
                  <SelectItem id={NO_PRIORITY} textValue={t("kanban.priorityNone")}><RiFlag2Line className="size-[18px] text-foreground-icon-tertiary" aria-hidden />{t("kanban.priorityNone")}</SelectItem>
                  {kanbanTaskPriorities.map((item) => <SelectItem key={item} id={item} textValue={kanbanTaskPriorityLabel(item)}><RiFlag2Fill className={cx("size-[18px]", PRIORITY_FLAG_CLASS[item])} aria-hidden />{kanbanTaskPriorityLabel(item)}</SelectItem>)}
                </TaskSelect>
                <TaskSelect label={t("kanban.workspace")} value={workspaceId || null} onChange={setWorkspaceId} renderValue={<><RiFolder6Line className="size-[18px] text-text-primary opacity-30" aria-hidden /><span className={workspace ? "text-text-secondary" : "text-text-tertiary"}>{workspace ? workspaceDisplayName(workspace) : t("kanban.workspace")}</span></>}>
                  {workspaces.map((item) => <SelectItem key={item.id} id={item.id} textValue={workspaceDisplayName(item)}><RiFolder6Line className="size-[18px] text-foreground-icon-secondary" aria-hidden />{workspaceDisplayName(item)}</SelectItem>)}
                </TaskSelect>
                <button
                  ref={dateRef}
                  type="button"
                  aria-label={t("kanban.dueDateAria")}
                  onClick={() => setDateOpen(!dateOpen)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md text-body-medium outline-none transition-colors duration-150 ease hover:bg-background-primary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                >
                  <RiCalendarLine className="size-[18px] text-foreground-icon-tertiary" aria-hidden />
                  <span className={dueDate ? "text-text-secondary" : "text-text-tertiary"}>{dueDate || t("kanban.dueDate")}</span>
                </button>
                <DatePicker
                  aria-label={t("kanban.dueDate")}
                  triggerRef={dateRef}
                  isOpen={dateOpen}
                  onOpenChange={setDateOpen}
                  value={dueDate ? parseDate(dueDate) : null}
                  onChange={(date) => setDueDate(date ? date.toString() : "")}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Switch size="sm" isSelected={keepCreating} onChange={setKeepCreating}>
                  <span className="text-body-2-medium text-text-tertiary">{t("kanban.keepCreating")}</span>
                </Switch>
                <div className="ms-auto flex gap-2.5">
                  <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
                  <Button type="submit" disabled={!title.trim() || !workspaceId}>{t("kanban.newTask")}</Button>
                </div>
              </div>
            </div>
          </Form>
        </Dialog>
        </TicketGenieSurface>
      </Modal>
    </ModalOverlay>
  );
}

"use client";

import { useMemo, useState } from "react";
import { getLocalTimeZone, startOfMonth, today as todayIn, type CalendarDate } from "@internationalized/date";
import { Button } from "@/components/base/buttons/button";
import { CalendarMonthGrid, type CalendarGridLabels } from "@/components/application/calendar/calendar-month-grid";
import { CalendarMonthSwitcher } from "@/components/application/calendar/calendar-month-switcher";
import type { CalendarEvent, CalendarEventColor } from "@/components/application/calendar/calendar-data";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocale, useT } from "@/i18n";
import { isKanbanTaskOverdue, type KanbanTask } from "@/session/kanbanTasks";

/** The tint a task reads in: finished green, late or failed pink, running purple, else blue. */
function taskColor(task: KanbanTask): CalendarEventColor {
  if (task.status === "done") return "emerald";
  if (isKanbanTaskOverdue(task) || task.schedule?.status === "failed") return "pink";
  if (task.status === "in-progress") return "purple";
  return "blue";
}

/** Calendar entries per day: a task shows on its schedule's day (timed) and
 * on its due date (all day), once if both fall on the same day. */
export function taskCalendarEvents(tasks: readonly KanbanTask[]): Record<string, CalendarEvent[]> {
  const days: Record<string, CalendarEvent[]> = {};
  const push = (key: string, event: CalendarEvent) => (days[key] ??= []).push(event);
  for (const task of tasks) {
    const base = { title: task.title, color: taskColor(task), done: task.status === "done" };
    const schedule = task.schedule && task.schedule.status !== "cancelled" ? task.schedule : undefined;
    const scheduleDay = schedule?.at.slice(0, 10);
    if (schedule && scheduleDay) push(scheduleDay, { ...base, id: task.id, time: schedule.at.slice(11, 16) || undefined });
    if (task.dueDate && task.dueDate !== scheduleDay) push(task.dueDate, { ...base, id: task.id });
  }
  for (const events of Object.values(days)) {
    // All-day entries first, then by time; `undefined ?? ""` sorts ahead of any "HH:mm".
    events.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
  }
  return days;
}

/**
 * The plan's calendar view: the BoardUI month grid over the board's tasks.
 * Clicking a task opens its detail sheet; a day's add button starts a task
 * due that day.
 */
export function TaskCalendar({ tasks, onOpen, onAdd }: {
  /** The board's (filtered) top-level tasks. */
  tasks: readonly KanbanTask[];
  onOpen: (id: string) => void;
  onAdd: (dueDate: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const today = todayIn(getLocalTimeZone());
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [highlightedDate, setHighlightedDate] = useState<CalendarDate | null>(null);
  const events = useMemo(() => taskCalendarEvents(tasks), [tasks]);
  const undated = tasks.filter((task) => !task.dueDate && (!task.schedule || task.schedule.status === "cancelled")).length;
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(month.toDate("UTC"));
  const labels: CalendarGridLabels = {
    more: (count) => t("kanban.calendarMore", { count }),
    add: (date) => t("kanban.calendarAdd", { date }),
    dayEvents: (date) => t("kanban.calendarDayTasks", { date }),
  };
  const jumpTo = (date: CalendarDate) => {
    setMonth(startOfMonth(date));
    setHighlightedDate(date);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex shrink-0 flex-wrap items-center gap-2.5">
        <CalendarMonthSwitcher
          month={month}
          monthLabel={monthLabel}
          locale={locale}
          labels={{ previous: t("usage.previousMonth"), next: t("usage.nextMonth"), jumpToDate: t("kanban.calendarJump") }}
          onPrevMonth={() => setMonth((current) => current.subtract({ months: 1 }))}
          onNextMonth={() => setMonth((current) => current.add({ months: 1 }))}
          onSelectDate={jumpTo}
        />
        <Button variant="secondary" size="medium" onClick={() => jumpTo(today)}>{t("kanban.calendarToday")}</Button>
        {undated > 0 && <p className="text-body-2-regular text-text-tertiary">{t("kanban.calendarUndated", { count: undated })}</p>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col rounded-3xl bg-background-secondary-default p-2 sm:p-3">
        <ScrollArea surface="secondary" className="flex min-h-0 flex-1 flex-col" contentClassName="[scrollbar-width:thin]">
          <CalendarMonthGrid
            month={month}
            locale={locale}
            today={today}
            events={events}
            labels={labels}
            highlightedDate={highlightedDate}
            onHighlightEnd={() => setHighlightedDate(null)}
            onSelectEvent={onOpen}
            onAddEvent={(date) => onAdd(date.toString())}
            aria-label={t("kanban.calendarAria", { month: monthLabel })}
          />
        </ScrollArea>
      </div>
    </div>
  );
}

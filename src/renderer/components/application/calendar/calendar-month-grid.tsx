"use client";

import { useState } from "react";
import type { CalendarDate } from "@internationalized/date";
import { isSameDay, isSameMonth } from "@internationalized/date";
import { motion } from "motion/react";
import { RiAddLine } from "@remixicon/react";
import { Dropdown, DropdownItem, DropdownPopover, DropdownTrigger } from "@/components/base/dropdown/dropdown";
import {
  dateKey,
  monthGrid,
  weekdayLabels,
  type CalendarEvent,
  type CalendarEventColor,
} from "@/components/application/calendar/calendar-data";
import { cx } from "@/utils/cx";

/**
 * The BoardUI calendar month grid: a weekday header row and a 6-week grid of
 * day cells with event chips. Fed by `events` (keyed by `dateKey`, in display
 * order) instead of the template's showcase data; a day with more than three
 * events shows the first two plus a "+N more" menu of all of them.
 */

const MAX_VISIBLE_EVENTS = 3;
const OVERFLOW_VISIBLE_EVENTS = 2;

const CHIP_STYLES: Record<CalendarEventColor, { bg: string; title: string; time: string; dot: string }> = {
  blue: {
    bg: "bg-calendar-event-blue-background",
    title: "text-calendar-event-blue-title",
    time: "text-calendar-event-blue-time",
    dot: "bg-calendar-event-blue-time",
  },
  pink: {
    bg: "bg-calendar-event-pink-background",
    title: "text-calendar-event-pink-title",
    time: "text-calendar-event-pink-time",
    dot: "bg-calendar-event-pink-time",
  },
  purple: {
    bg: "bg-calendar-event-purple-background",
    title: "text-calendar-event-purple-title",
    time: "text-calendar-event-purple-time",
    dot: "bg-calendar-event-purple-time",
  },
  lime: {
    bg: "bg-calendar-event-lime-background",
    title: "text-calendar-event-lime-title",
    time: "text-calendar-event-lime-time",
    dot: "bg-calendar-event-lime-time",
  },
  emerald: {
    bg: "bg-calendar-event-emerald-background",
    title: "text-calendar-event-emerald-title",
    time: "text-calendar-event-emerald-time",
    dot: "bg-calendar-event-emerald-time",
  },
};

export type CalendarGridLabels = {
  /** "+N more" overflow trigger. */
  more: (count: number) => string;
  /** Accessible name of a day's add button. */
  add: (date: string) => string;
  /** Accessible name of a day's overflow menu. */
  dayEvents: (date: string) => string;
};

function EventChip({ event, onSelect }: { event: CalendarEvent; onSelect: () => void }) {
  const c = CHIP_STYLES[event.color];
  return (
    <button
      type="button"
      onClick={onSelect}
      data-calendar-event={event.id}
      className={cx(
        "flex min-w-0 cursor-pointer items-center justify-between gap-0.5 rounded-sm px-1 py-0.5 outline-none sm:gap-1 sm:rounded-md sm:px-1.5",
        "transition-[filter] duration-150 ease hover:brightness-95 focus-visible:ring-2 focus-visible:ring-border-focus-ring",
        c.bg,
      )}
    >
      <span className={cx("truncate text-[10px] leading-3 sm:text-body-2-medium", c.title, event.done && "line-through opacity-70")}>
        {event.title}
      </span>
      {event.time && (
        <span className={cx("hidden shrink-0 opacity-70 sm:inline sm:text-caption-1-medium", c.time)}>
          {event.time}
        </span>
      )}
    </button>
  );
}

function OverflowMenu({ events, count, label, menuLabel, onSelectEvent }: {
  events: CalendarEvent[];
  count: number;
  label: string;
  menuLabel: string;
  onSelectEvent: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
      <DropdownTrigger
        aria-label={menuLabel}
        className="w-fit cursor-pointer rounded-sm text-start text-[10px] leading-3 font-medium text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring sm:text-body-2-medium"
      >
        {label}
        <span className="sr-only">{` (${count})`}</span>
      </DropdownTrigger>
      <DropdownPopover aria-label={menuLabel} placement="bottom start" className="w-[240px] rounded-[14px] p-1" dialogClassName="max-h-[50vh] overflow-y-auto">
        {events.map((event) => (
          <DropdownItem
            key={event.id}
            className="rounded-2lg px-2 py-1.5 text-body-medium"
            onSelect={() => { setIsOpen(false); onSelectEvent(event.id); }}
          >
            <span aria-hidden className={cx("size-2 shrink-0 rounded-full", CHIP_STYLES[event.color].dot)} />
            <span className={cx("min-w-0 flex-1 truncate", event.done && "text-text-secondary line-through")}>{event.title}</span>
            {event.time && <span className="shrink-0 text-body-2-regular text-text-tertiary">{event.time}</span>}
          </DropdownItem>
        ))}
      </DropdownPopover>
    </Dropdown>
  );
}

function DayCell({
  date,
  events,
  isCurrentMonth,
  isToday,
  isHighlighted,
  dateLabel,
  labels,
  onHighlightEnd,
  onSelectEvent,
  onAddEvent,
}: {
  date: CalendarDate;
  events: CalendarEvent[];
  isCurrentMonth: boolean;
  isToday: boolean;
  isHighlighted: boolean;
  dateLabel: string;
  labels: CalendarGridLabels;
  onHighlightEnd: () => void;
  onSelectEvent: (id: string) => void;
  onAddEvent?: (date: CalendarDate) => void;
}) {
  const overflow = events.length > MAX_VISIBLE_EVENTS;
  const visible = overflow ? events.slice(0, OVERFLOW_VISIBLE_EVENTS) : events;
  const hiddenCount = events.length - visible.length;

  return (
    <div
      role="group"
      aria-label={dateLabel}
      aria-current={isToday ? "date" : undefined}
      data-date={dateKey(date)}
      className="group relative h-full border-e border-b border-separator-border-strong dark:border-separator-border last:border-b-0 nth-[7n]:border-e-0 nth-[n+36]:border-b-0 sm:border-0"
    >
      {/* Sibling of the card, not a child, so the card's overflow-hidden never clips it. */}
      {isHighlighted && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 ring-2 ring-inset ring-accent-500 sm:rounded-xl"
          initial={{ opacity: 0, scale: 1 }}
          animate={{ opacity: [0, 1, 0.35, 1, 0.35, 1, 0], scale: [1, 1.015, 1, 1.015, 1, 1, 1] }}
          transition={{ duration: 3, times: [0, 0.08, 0.28, 0.4, 0.6, 0.72, 1], ease: "easeInOut" }}
          onAnimationComplete={onHighlightEnd}
        />
      )}
      <div
        className={cx(
          "relative flex h-full flex-col overflow-hidden sm:rounded-xl",
          "min-h-[72px] sm:min-h-0",
          // In the dense (mobile) grid, dark mode holds every cell on the same
          // surface as the out-of-month ones, so the current month never reads as disabled.
          isCurrentMonth
            ? "bg-background-primary-default max-sm:dark:bg-background-secondary-default sm:shadow-card"
            : "bg-background-secondary-default sm:bg-background-tertiary-default",
        )}
      >
        <div className="flex items-center justify-between gap-1 pt-1 ps-1 pe-1 sm:pt-1.5 sm:ps-1.5 sm:pe-1.5">
          <span
            className={cx(
              "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-4 font-medium sm:h-6 sm:min-w-6 sm:text-body-2-medium",
              isToday ? "bg-accent-500 text-text-white" : isCurrentMonth ? "text-text-primary" : "text-text-secondary",
            )}
          >
            {date.day}
          </span>
          {onAddEvent && (
            <button
              type="button"
              aria-label={labels.add(dateLabel)}
              onClick={() => onAddEvent(date)}
              className="hidden size-6 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary opacity-0 outline-none transition-[opacity,background-color] duration-150 group-hover:opacity-100 hover:bg-background-secondary-hover focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-border-focus-ring sm:flex"
            >
              <RiAddLine className="size-4" aria-hidden />
            </button>
          )}
        </div>
        {events.length > 0 && (
          <div className="mt-auto flex flex-col gap-0.5 px-1 pb-1 sm:gap-[5px] sm:px-2 sm:pb-2">
            {visible.map((event) => (
              <EventChip key={event.id} event={event} onSelect={() => onSelectEvent(event.id)} />
            ))}
            {hiddenCount > 0 && (
              <OverflowMenu
                events={events}
                count={events.length}
                label={labels.more(hiddenCount)}
                menuLabel={labels.dayEvents(dateLabel)}
                onSelectEvent={onSelectEvent}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CalendarMonthGrid({
  month,
  locale,
  today,
  events,
  labels,
  highlightedDate = null,
  onHighlightEnd,
  onSelectEvent,
  onAddEvent,
  "aria-label": ariaLabel,
}: {
  month: CalendarDate;
  /** BCP 47 locale for weekday names, day labels and the first weekday. */
  locale: string;
  today: CalendarDate;
  /** Events per `dateKey`, already in display order. */
  events: Readonly<Record<string, CalendarEvent[]>>;
  labels: CalendarGridLabels;
  /** Pulses this day's ring for ~3s then fades it out (not a persistent selection). */
  highlightedDate?: CalendarDate | null;
  onHighlightEnd?: () => void;
  onSelectEvent: (id: string) => void;
  /** Shows a per-day add button. */
  onAddEvent?: (date: CalendarDate) => void;
  "aria-label"?: string;
}) {
  const days = monthGrid(month, locale);
  const dayFormat = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });

  // The dense (mobile) grid rules use separator/border-strong: the button
  // border drew a bright lattice over the dark day cells.
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex h-full min-h-0 w-full flex-col gap-0 overflow-hidden border-y border-separator-border-strong dark:border-separator-border sm:h-auto sm:min-h-full sm:gap-2 sm:overflow-visible sm:rounded-none sm:border-0"
    >
      <div aria-hidden className="grid grid-cols-7 gap-0 border-b border-separator-border-strong dark:border-separator-border sm:gap-2 sm:border-0">
        {weekdayLabels(month, locale).map((label) => (
          <div
            key={label}
            className="flex items-center justify-center border-e border-separator-border-strong dark:border-separator-border bg-background-secondary-default px-0.5 py-1 text-center text-[11px] leading-4 text-text-secondary last:border-e-0 sm:rounded-xl sm:border-0 sm:px-2.5 sm:py-[5px] sm:text-body-2-regular"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[repeat(6,minmax(0,1fr))] gap-0 sm:min-h-auto sm:grid-rows-[repeat(6,minmax(88px,1fr))] sm:gap-2">
        {days.map((date) => (
          <DayCell
            key={date.toString()}
            date={date}
            events={events[dateKey(date)] ?? []}
            isCurrentMonth={isSameMonth(date, month)}
            isToday={isSameDay(date, today)}
            isHighlighted={highlightedDate !== null && isSameDay(date, highlightedDate)}
            dateLabel={dayFormat.format(date.toDate("UTC"))}
            labels={labels}
            onHighlightEnd={() => onHighlightEnd?.()}
            onSelectEvent={onSelectEvent}
            onAddEvent={onAddEvent}
          />
        ))}
      </div>
    </div>
  );
}

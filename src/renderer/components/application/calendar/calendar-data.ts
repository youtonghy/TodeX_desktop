import { CalendarDate, startOfMonth, startOfWeek } from "@internationalized/date";

/** Chip tint; each pairs with the `calendar-event-*` theme tokens. */
export type CalendarEventColor = "blue" | "pink" | "lime" | "purple" | "emerald";

export interface CalendarEvent {
  id: string;
  title: string;
  /** 24h "HH:mm"; omitted for all-day events. */
  time?: string;
  color: CalendarEventColor;
  /** Finished items read struck through. */
  done?: boolean;
}

/** `YYYY-MM-DD`, the key of `CalendarMonthGrid`'s `events`. */
export function dateKey(date: CalendarDate) {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

const ROWS = 6;

/**
 * Always-6-row (42-day) month grid starting on the locale's first weekday,
 * so the grid keeps the same height across months. Days outside the shown
 * month are greyed out by `CalendarMonthGrid`, not here.
 */
export function monthGrid(month: CalendarDate, locale: string): CalendarDate[] {
  const gridStart = startOfWeek(startOfMonth(month), locale);
  return Array.from({ length: ROWS * 7 }, (_, index) => gridStart.add({ days: index }));
}

/** Short weekday names in grid order. */
export function weekdayLabels(month: CalendarDate, locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return monthGrid(month, locale).slice(0, 7).map((date) => format.format(date.toDate("UTC")));
}

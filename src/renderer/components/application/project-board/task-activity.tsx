import { useMemo } from "react";
import { ContributionsGrid, type ContributionCell } from "@/components/application/dashboard/contributions-card";
import { getLocale, useT } from "@/i18n";
import type { TimelineEntry, UsageRecord } from "@/session/helpers";

const WEEKS = 38;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Activity tier 0–5 from a day's turn count. */
function tierFor(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  if (count <= 10) return 4;
  return 5;
}

/**
 * The task's contribution heatmap (BoardUI contributions card): one cell per
 * day over the last 38 weeks, colored by the agent turns run in the
 * conversations of the task and its subtasks. Turns come from the stored
 * usage records plus loaded history, counted once per turn id. Columns are
 * weeks (Monday first), the last one holding today.
 */
export function TaskActivity({ conversationIds, timeline, usageRecords }: {
  /** Local and backend ids of the linked conversations. */
  conversationIds: readonly string[];
  timeline: readonly TimelineEntry[];
  usageRecords: readonly UsageRecord[];
}) {
  const t = useT();
  const { cells, total, start } = useMemo(() => {
    const ids = new Set(conversationIds);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekday = (today.getDay() + 6) % 7;
    const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday - (WEEKS - 1) * 7);
    // Turn key → when it ran (the earliest sighting).
    const turns = new Map<string, number>();
    const note = (key: string, at: number) => {
      const seen = turns.get(key);
      if (seen === undefined || at < seen) turns.set(key, at);
    };
    for (const record of usageRecords) {
      if (record.conversationId && ids.has(record.conversationId)) note(record.turnId || record.id, record.updatedAt);
    }
    for (const entry of timeline) {
      if (!entry.conversationId || !ids.has(entry.conversationId)) continue;
      if (entry.turnId) note(entry.turnId, entry.at);
      else if (entry.kind === "outgoing") note(entry.id, entry.at);
    }
    const counts = new Map<number, number>();
    let sum = 0;
    for (const at of turns.values()) {
      const day = new Date(at);
      day.setHours(0, 0, 0, 0);
      if (day < first || day > today) continue;
      const index = Math.round((day.getTime() - first.getTime()) / DAY_MS);
      counts.set(index, (counts.get(index) ?? 0) + 1);
      sum += 1;
    }
    const format = new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric" });
    const grid: ContributionCell[][] = Array.from({ length: 7 }, (_, row) => Array.from({ length: WEEKS }, (_, col) => {
      const index = col * 7 + row;
      const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
      if (date > today) return { tier: 0, label: format.format(date) };
      const count = counts.get(index) ?? 0;
      return {
        tier: tierFor(count),
        label: count
          ? t("kanban.activityOn", { count, date: format.format(date) })
          : t("kanban.activityNone", { date: format.format(date) }),
      };
    }));
    return { cells: grid, total: sum, start: format.format(first) };
  }, [conversationIds, timeline, usageRecords, t]);

  return (
    <section aria-label={t("kanban.activity")} className="flex flex-col gap-3 rounded-2xl bg-background-secondary-default p-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-body-medium text-text-secondary">{t("kanban.activity")}</p>
          <p className="text-title-2-medium text-text-primary tabular-nums">{t("kanban.activityTotal", { count: total })}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <ContributionsGrid columns={WEEKS} cells={cells} animateIn />
        <div className="flex justify-between text-caption-2-medium text-text-tertiary">
          <span>{start}</span>
          <span>{t("kanban.activityToday")}</span>
        </div>
      </div>
    </section>
  );
}

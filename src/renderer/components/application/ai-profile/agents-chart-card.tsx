"use client";

import { useState } from "react";
import { WeekRangePill } from "@/components/application/medical/week-range-pill";
import { AGENTS_MAX_BAR, AGENTS_TRACK_HEIGHT, AGENTS_ZERO_BAR } from "@/components/application/ai-profile/ai-profile-data";
import { useCountUp } from "@/hooks/use-count-up";
import { cx } from "@/utils/cx";

/**
 * Figma source: Board UI → ai profile → Agents card (node 4065:8615).
 *
 *   card    bg background/secondary, radius 20px (radius/2,5xl), px 10 py 12
 *   header  label (Body 1/Medium secondary) over the headline figure
 *           (Title 2/Medium), period switcher pill pinned top-right
 *   bars    one bar per day in a 206px track, 7px gap, radius/sm, scaled to
 *           the busiest day. Zero days collapse to a 4px neutral stub.
 *   x axis  start / end labels (Caption 2, text/tertiary)
 *
 * Hovering a bar rolls the headline to that day's value (via `useCountUp`)
 * and swaps the label to the day — like the dashboard's earnings/steps cards.
 */
export function AgentsChartCard({
  title,
  total,
  days,
  formatValue,
  dayLabel,
  periodLabel,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  startLabel,
  endLabel,
  className,
}: {
  /** Label over the headline when no bar is hovered. */
  title: string;
  /** Headline when no bar is hovered (e.g. the month's total). */
  total: number;
  /** One value per day. */
  days: number[];
  formatValue: (value: number) => string;
  dayLabel: (index: number) => string;
  /** The switcher pill's label (e.g. the month). */
  periodLabel: string;
  onPrev: () => void;
  onNext: () => void;
  prevLabel?: string;
  nextLabel?: string;
  startLabel: string;
  endLabel: string;
  className?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const hovering = activeIndex !== null && activeIndex < days.length;
  const display = useCountUp(hovering ? days[activeIndex] : total);
  const max = Math.max(1, ...days);
  const heightFor = (value: number) => (value === 0 ? 0 : Math.max(8, Math.round((value / max) * AGENTS_MAX_BAR)));

  return (
    <section
      className={cx(
        "relative flex w-full flex-col gap-2.5 rounded-[20px] bg-background-secondary-default px-2.5 py-3",
        className,
      )}
    >
      {/* Header */}
      <div className="flex w-full px-1.5 pt-1">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pe-36">
          <p className="w-full truncate text-body-medium text-text-secondary">{hovering ? dayLabel(activeIndex) : title}</p>
          <p
            key={`${periodLabel}:${activeIndex}`}
            className="animate-number-fade text-title-2-medium whitespace-nowrap text-text-primary tabular-nums"
          >
            {formatValue(display)}
          </p>
        </div>
      </div>

      <WeekRangePill
        label={periodLabel}
        onPrev={onPrev}
        onNext={onNext}
        prevLabel={prevLabel}
        nextLabel={nextLabel}
        className="absolute top-4 end-4 w-[128px]"
      />

      {/* Bars — one per day */}
      <div
        className="flex w-full items-end gap-[7px]"
        style={{ height: AGENTS_TRACK_HEIGHT }}
        onMouseLeave={() => setActiveIndex(null)}
      >
        {days.map((value, day) => {
          const height = heightFor(value);
          return (
            <div
              key={`${periodLabel}:${day}`}
              onMouseEnter={() => setActiveIndex(day)}
              className="flex h-full min-w-0 flex-1 items-end rounded-sm"
            >
              <div
                className={cx(
                  "animate-bar-rise w-full rounded-sm transition-[height,background-color] duration-300 ease",
                  height === 0
                    ? day === activeIndex ? "bg-chart-cursor" : "bg-chart-track"
                    : day === activeIndex ? "bg-chart-agents-bar-active" : "bg-chart-agents-bar",
                )}
                style={{
                  height: height === 0 ? AGENTS_ZERO_BAR : height,
                  // Consecutive left→right stagger; replays on period switch
                  // since the key includes the period.
                  animationDelay: `${day * 22}ms`,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* X axis */}
      <div className="flex w-full items-start justify-between px-1.5 text-caption-2-medium whitespace-nowrap text-text-tertiary">
        <p>{startLabel}</p>
        <p>{endLabel}</p>
      </div>
    </section>
  );
}

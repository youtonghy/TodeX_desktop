"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ContributionsGrid, type ContributionCell } from "@/components/application/dashboard/contributions-card";
import { useCountUp } from "@/hooks/use-count-up";
import { cx } from "@/utils/cx";

/**
 * Figma source: Board UI → ai profile → profile card (node 4063:5759).
 *
 *   card      radius/3xl (24px), 1px border, px 16, pb 16, pt 124 — the cover
 *             overlays the top 165px and the 80px avatar overlaps its edge
 *   actions   pinned 20px under the cover, right-aligned
 *   name      Title 2/Medium + a secondary line with an optional badge
 *   value     headline label + count-up figure (Title 1/Medium) + chip
 *   stats     tiles on the secondary surface (radius/2lg p-10): value Body 1/
 *             Medium over label Body 2/Medium secondary
 *   activity  label (+ optional control), then the shared `ContributionsGrid`
 *             heatmap (38 columns) fed with real cells
 *
 * Content is all props; the cover is a soft token gradient (it follows the
 * theme) unless a `cover` node is supplied.
 */

export type AiProfileStat = { value: string; label: string };

export function AiProfileCard({
  avatar,
  name,
  subtitle,
  badge,
  actions,
  headlineLabel,
  headline,
  formatHeadline = (value) => value.toLocaleString(),
  chip,
  stats,
  activityLabel,
  activityControl,
  cells,
  cover,
  className,
}: {
  avatar: ReactNode;
  name: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  headlineLabel: ReactNode;
  /** Counts up from 0 on mount and rolls on change. */
  headline: number;
  formatHeadline?: (value: number) => string;
  chip?: ReactNode;
  stats: AiProfileStat[];
  activityLabel: ReactNode;
  activityControl?: ReactNode;
  /** Heatmap cells, `cells[row][col]` (7 rows × 38 columns). */
  cells: ContributionCell[][];
  cover?: ReactNode;
  className?: string;
}) {
  // The target flips after the first render so `useCountUp` (which starts at
  // its initial target) has 0 to roll from. 1.6s keeps the roll readable.
  const [target, setTarget] = useState(0);
  useEffect(() => setTarget(headline), [headline]);
  const value = useCountUp(target, 1600);

  return (
    <section
      className={cx(
        "relative w-full overflow-hidden rounded-3xl border border-border-ai-profile-card",
        className,
      )}
    >
      {/* Cover — overlays the top of the card, clipped by its radius */}
      <div className="absolute inset-x-0 top-0 h-[165px] overflow-hidden rounded-t-[23px] bg-linear-to-br from-pill-tab-blue-selected-background via-background-secondary-default to-notification-information-background">
        {cover}
      </div>

      <div className="relative flex w-full flex-col gap-[15px] px-4 pt-[124px] pb-4">
        {/* Avatar — overlaps the cover's bottom edge */}
        <span className="flex size-20 items-center justify-center overflow-hidden rounded-full bg-background-primary-default ring-4 ring-background-full">
          {avatar}
        </span>

        {/* Name row + actions pinned 20px under the cover */}
        <div className="relative flex w-full items-start gap-[15px]">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate text-title-2-medium text-text-primary">{name}</p>
            {subtitle || badge ? (
              <div className="flex min-w-0 items-center gap-1.5">
                {subtitle ? <p className="truncate text-headline-medium text-text-secondary">{subtitle}</p> : null}
                {badge}
              </div>
            ) : null}
          </div>
          {actions ? (
            <div className="absolute -top-[34px] end-1 flex items-center justify-end gap-2.5">{actions}</div>
          ) : null}
        </div>

        <div className="flex w-full flex-col gap-2">
          {/* Headline */}
          <div className="flex flex-col gap-0.5">
            <p className="text-body-medium text-text-secondary">{headlineLabel}</p>
            <div className="flex items-center gap-2">
              <p className="text-title-1-medium whitespace-nowrap text-text-primary tabular-nums">
                {formatHeadline(value)}
              </p>
              {chip}
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-stretch">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex min-w-0 flex-col items-start rounded-2lg bg-background-secondary-default p-2.5 sm:flex-1"
              >
                <p className="w-full truncate text-body-medium text-text-primary tabular-nums">{stat.value}</p>
                <p className="w-full truncate text-body-2-medium text-text-secondary">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Activity header */}
          <div className="flex w-full items-center justify-between pt-1.5 ps-0.5">
            <p className="text-body-2-medium text-text-secondary">{activityLabel}</p>
            {activityControl}
          </div>

          {/* Heatmap — the shared contributions pattern (violet ramp + hover
              tooltips), 38 columns wide. Narrow widths scroll horizontally. */}
          <div className="flex w-full overflow-x-auto sm:overflow-visible">
            <ContributionsGrid columns={38} cells={cells} animateIn className="w-max sm:w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}

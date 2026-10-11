import type { ReactNode } from 'react';
import { Meter as AriaMeter, ProgressBar as AriaProgressBar } from 'react-aria-components';
import { cx } from '@/utils/cx';

/**
 * Usage bars in the agent-limits recipe: a 6px chart-track rail with a
 * rounded fill that eases its width. Labels sit above, value on the right.
 */

type Tone = 'accent' | 'success' | 'warning' | 'danger';

const FILL: Record<Tone, string> = {
  accent: 'bg-accent-500',
  success: 'bg-chart-7',
  warning: 'bg-chart-8',
  danger: 'bg-foreground-icon-error',
};

function Track({ percent, tone, indeterminate, className }: { percent: number; tone: Tone; indeterminate?: boolean; className?: string }) {
  return (
    <div className={cx('relative h-1.5 w-full overflow-hidden rounded-full bg-chart-track', className)}>
      <div
        className={cx(
          'h-full rounded-full transition-[width] duration-500 ease-out',
          FILL[tone],
          indeterminate && 'absolute inset-y-0 w-1/3 animate-[progress-indeterminate_1.2s_ease-in-out_infinite] motion-reduce:animate-none',
        )}
        style={indeterminate ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}

type BarProps = {
  label?: ReactNode;
  /** Text on the right of the label row; defaults to the percentage. */
  valueLabel?: ReactNode;
  showValue?: boolean;
  value?: number;
  minValue?: number;
  maxValue?: number;
  tone?: Tone;
  className?: string;
  trackClassName?: string;
  'aria-label'?: string;
};

function Header({ label, valueText }: { label?: ReactNode; valueText?: ReactNode }) {
  if (!label && valueText == null) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      {label ? <span className="min-w-0 truncate text-body-medium text-text-primary">{label}</span> : <span />}
      {valueText != null ? <span className="shrink-0 text-body-medium text-text-primary tabular-nums">{valueText}</span> : null}
    </div>
  );
}

/** Task progress; omit `value` for an indeterminate bar. */
export function ProgressBar({ label, valueLabel, showValue = true, value, minValue = 0, maxValue = 100, tone = 'accent', className, trackClassName, 'aria-label': ariaLabel }: BarProps) {
  return (
    <AriaProgressBar
      value={value}
      minValue={minValue}
      maxValue={maxValue}
      isIndeterminate={value === undefined}
      aria-label={ariaLabel}
      className={cx('flex w-full flex-col gap-1.5', className)}
    >
      {({ percentage, valueText, isIndeterminate }) => (
        <>
          <Header label={label} valueText={showValue && !isIndeterminate ? valueLabel ?? valueText : undefined} />
          <Track percent={percentage ?? 0} tone={tone} indeterminate={isIndeterminate} className={trackClassName} />
        </>
      )}
    </AriaProgressBar>
  );
}

/** A quantity within a known range (quota, disk, context window). */
export function Meter({ label, valueLabel, showValue = true, value = 0, minValue = 0, maxValue = 100, tone = 'accent', className, trackClassName, 'aria-label': ariaLabel }: BarProps) {
  return (
    <AriaMeter value={value} minValue={minValue} maxValue={maxValue} aria-label={ariaLabel} className={cx('flex w-full flex-col gap-1.5', className)}>
      {({ percentage, valueText }) => (
        <>
          <Header label={label} valueText={showValue ? valueLabel ?? valueText : undefined} />
          <Track percent={percentage} tone={tone} className={trackClassName} />
        </>
      )}
    </AriaMeter>
  );
}

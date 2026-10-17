import { useNow } from '@/components/ConversationSchedule';
import { cx } from '@/utils/cx';

/**
 * Elapsed time of a tool call, from the daemon's event times
 * (`TimelineEntry.firstAt` / `at`; docs/API.md "工具事件" in TodeX_backend).
 */

const SECOND = 1_000;

/** `12s`, `3m 05s`, `1h 02m`. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / SECOND));
  const pad = (value: number) => String(value).padStart(2, '0');
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

/** Live while running, then the final duration up to the last event. */
export function ToolElapsed({ startedAt, endedAt, running, className }: {
  startedAt: number | undefined;
  endedAt: number | undefined;
  running: boolean;
  className?: string;
}) {
  const now = useNow(running, SECOND);
  if (!startedAt || !Number.isFinite(startedAt)) return null;
  const end = running ? now : endedAt;
  if (!end || !Number.isFinite(end)) return null;
  return (
    <span className={cx('shrink-0 text-caption-1-regular text-text-tertiary tabular-nums', className)}>
      {formatElapsed(end - startedAt)}
    </span>
  );
}

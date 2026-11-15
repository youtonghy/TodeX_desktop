import { useNow } from '@/components/useNow';
import { cx } from '@/utils/cx';
import { formatElapsed } from './formatElapsed';

/**
 * Elapsed time of a tool call, from the daemon's event times
 * (`TimelineEntry.firstAt` / `at`; docs/API.md "工具事件" in TodeX_backend).
 */

const SECOND = 1_000;

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

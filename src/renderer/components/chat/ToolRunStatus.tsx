import { RiStopCircleLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { useNow } from '@/components/ConversationSchedule';
import { useT } from '@/i18n';
import { cx } from '@/utils/cx';

/**
 * Elapsed time and the "no output" notice of a tool call. Times are the
 * daemon's event times (`TimelineEntry.firstAt` / `at`); providers send
 * nothing while a command is silent, so the client measures the quiet itself
 * (docs/API.md "工具事件" in TodeX_backend).
 */

const SECOND = 1_000;
/** Same threshold as the turn-level stale notice (ConversationRunStatus). */
export const TOOL_SILENT_AFTER_MS = 120 * SECOND;

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

/** Shown once a running tool has sent nothing for `TOOL_SILENT_AFTER_MS`.
 * Providers cancel per turn, not per tool, so the action stops the turn. */
export function ToolSilentNotice({ lastEventAt, running, onStop, className }: {
  lastEventAt: number | undefined;
  running: boolean;
  onStop?: () => void;
  className?: string;
}) {
  const t = useT();
  const now = useNow(running, SECOND);
  if (!running || !lastEventAt || !Number.isFinite(lastEventAt)) return null;
  const quiet = now - lastEventAt;
  if (quiet < TOOL_SILENT_AFTER_MS) return null;
  return (
    <div role="status" className={cx('flex min-w-0 flex-wrap items-center gap-2 py-1', className)}>
      <span className="min-w-0 text-caption-1-regular text-text-tertiary">
        {t('chat.toolSilent', { minutes: Math.floor(quiet / (60 * SECOND)) })}
      </span>
      {onStop ? (
        <Button size="small" variant="secondary" leadingIcon={RiStopCircleLine} onClick={onStop}>
          {t('chat.stopTurn')}
        </Button>
      ) : null}
    </div>
  );
}

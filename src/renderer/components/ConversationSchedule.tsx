import { useEffect, useState } from 'react';
import { RiTimerLine } from '@remixicon/react';
import { Focusable } from 'react-aria-components';
import type { ConversationSchedule } from '@todex/protocol/v2';
import { Button } from '@/components/base/buttons/button';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { Alert } from '@/components/ui/alert';
import { cx } from '@/utils/cx';
import { formatResetInstant } from '../session/helpers';
import { useT } from '../i18n';
import { ScheduleConversationDialog } from './ScheduleConversationDialog';

const MINUTE = 60_000;

/** Re-renders every `interval` ms while `active`, for countdowns. */
export function useNow(active: boolean, interval = MINUTE): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [active, interval]);
  return now;
}

/** "2 days 3 hours" style time left; under a minute reads as "sending soon". */
export function useScheduleTimeLeft() {
  const t = useT();
  return (ms: number) => {
    const minutes = Math.floor(ms / MINUTE);
    if (minutes < 1) return t('schedule.dueSoon');
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    if (days > 0) return t('schedule.leftDays', { days, hours });
    if (hours > 0) return t('schedule.leftHours', { hours, minutes: minutes % 60 });
    return t('schedule.leftMinutes', { minutes });
  };
}

/** The sidebar's countdown icon for a scheduled conversation. */
export function ConversationScheduleIcon({ schedule, className }: { schedule: ConversationSchedule; className?: string }) {
  const t = useT();
  const now = useNow(!schedule.interrupted);
  const timeLeft = useScheduleTimeLeft();
  const at = Date.parse(schedule.at);
  const label = schedule.interrupted
    ? t('schedule.tooltipInterrupted')
    : t('schedule.tooltip', { at: formatResetInstant(at), left: timeLeft(at - now) });
  return (
    <TooltipTrigger delay={300}>
      <Focusable>
        <span role="img" tabIndex={-1} aria-label={label} className={cx('inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring', className)}>
          <RiTimerLine className={cx('size-3.5', schedule.interrupted ? 'text-text-error-primary' : 'text-text-accent')} aria-hidden="true" />
        </span>
      </Focusable>
      <Tooltip placement="top" className="max-w-xs">{label}</Tooltip>
    </TooltipTrigger>
  );
}

/** Above the composer of a scheduled conversation: when it sends, what is
 * held, and send now / change time / cancel. */
export function ConversationScheduleBar({ schedule, heldCount, onSendNow, onReschedule, onCancel, className }: {
  schedule: ConversationSchedule;
  heldCount: number;
  onSendNow: () => void;
  onReschedule: (at: string) => Promise<boolean>;
  onCancel: () => void;
  className?: string;
}) {
  const t = useT();
  const now = useNow(!schedule.interrupted);
  const timeLeft = useScheduleTimeLeft();
  const [rescheduling, setRescheduling] = useState(false);
  const at = Date.parse(schedule.at);
  return (
    <>
      <Alert
        status={schedule.interrupted ? 'danger' : 'info'}
        icon={RiTimerLine}
        className={className}
        title={schedule.interrupted ? t('schedule.interrupted') : t('schedule.banner', { at: formatResetInstant(at) })}
        description={schedule.interrupted ? undefined : `${timeLeft(at - now)} · ${t('schedule.held', { count: heldCount })}`}
        actions={(
          <>
            {schedule.interrupted ? null : (
              <Button size="xs" variant="secondary" onClick={onSendNow} disabled={heldCount === 0}>{t('schedule.sendNow')}</Button>
            )}
            <Button size="xs" variant="secondary" onClick={() => setRescheduling(true)}>
              {schedule.interrupted ? t('schedule.rearm') : t('schedule.reschedule')}
            </Button>
            <Button size="xs" variant="ghost" onClick={onCancel}>{t('schedule.cancel')}</Button>
          </>
        )}
      />
      <ScheduleConversationDialog
        isOpen={rescheduling}
        mode="reschedule"
        initialAt={schedule.at}
        onConfirm={onReschedule}
        onClose={() => setRescheduling(false)}
      />
    </>
  );
}

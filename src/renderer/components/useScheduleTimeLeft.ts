import { useT } from '../i18n';

const MINUTE = 60_000;

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

import { RiTimerLine } from '@remixicon/react';
import { useT } from '@/i18n';
import type { KanbanTaskSchedule } from '@/session/kanbanTasks';
import { cx } from '@/utils/cx';

/** The schedule's one-line summary, or null once it was cancelled. */
export function useScheduleText(schedule: KanbanTaskSchedule | undefined): string | null {
  const t = useT();
  if (!schedule || schedule.status === 'cancelled') return null;
  const at = schedule.at.replace('T', ' ');
  const action = schedule.action === 'start' ? t('kanban.scheduleStart') : t('kanban.scheduleSend');
  if (schedule.status === 'pending') return t('kanban.schedulePending', { at, action });
  if (schedule.status === 'running') return t('kanban.scheduleRunning');
  if (schedule.status === 'done') return t(schedule.turnId || schedule.action === 'start' ? 'kanban.scheduleDone' : 'kanban.scheduleQueued', { at });
  return t('kanban.scheduleFailed', { error: schedule.error ?? '' });
}

/** Text color per schedule state: failures read as errors, finished runs recede. */
export function scheduleTone(schedule: KanbanTaskSchedule): string {
  return schedule.status === 'failed' ? 'text-text-error-primary' : schedule.status === 'done' ? 'text-text-tertiary' : 'text-text-accent';
}

export function TaskScheduleLine({ schedule, className }: { schedule: KanbanTaskSchedule | undefined; className?: string }) {
  const text = useScheduleText(schedule);
  if (!schedule || !text) return null;
  return (
    <div
      className={cx('flex min-w-0 items-center gap-1 text-body-2-medium', scheduleTone(schedule), className)}
      title={schedule.status === 'failed' ? schedule.error : undefined}
    >
      <RiTimerLine className="size-[15px] shrink-0" aria-hidden />
      <span className="truncate">{text}</span>
    </div>
  );
}

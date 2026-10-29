import { useState } from 'react';
import { RiFlag2Line } from '@remixicon/react';
import type { RuntimeGoal } from '@todex/protocol/conversationRuntime';
import { Button } from '@/components/base/buttons/button';
import { Alert, type AlertStatus } from '@/components/ui/alert';
import { useT } from '../i18n';

const GOAL_STATUS: Record<string, AlertStatus> = {
  active: 'info', paused: 'neutral', complete: 'success',
  blocked: 'warning', usageLimited: 'warning', budgetLimited: 'warning',
};
const STATUS_LABELS = ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'] as const;

/** The goal the agent pursues on its own across turns, above the composer. */
export function ConversationGoalBar({ goal, onChange, className }: {
  goal: RuntimeGoal;
  /** Resolves once the backend answered; the bar follows the next `goal.updated`. */
  onChange: (action: 'pause' | 'resume' | 'clear') => Promise<boolean>;
  className?: string;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const run = (action: 'pause' | 'resume' | 'clear') => {
    setPending(true);
    void onChange(action).finally(() => setPending(false));
  };
  const known = STATUS_LABELS.find(status => status === goal.status);
  const usage = t('goal.usage', { tokens: goal.tokensUsed.toLocaleString(), minutes: Math.round(goal.timeUsedSeconds / 60) });
  return (
    <Alert
      status={GOAL_STATUS[goal.status] ?? 'info'}
      icon={RiFlag2Line}
      className={className}
      title={t('goal.title', { objective: goal.objective })}
      description={`${known ? t(`goal.status.${known}`) : goal.status} · ${usage}`}
      actions={(
        <>
          {goal.status === 'complete' ? null : goal.status === 'active' ? (
            <Button size="xs" variant="secondary" disabled={pending} onClick={() => run('pause')}>{t('goal.pause')}</Button>
          ) : (
            <Button size="xs" variant="secondary" disabled={pending} onClick={() => run('resume')}>{t('goal.resume')}</Button>
          )}
          <Button size="xs" variant="ghost" disabled={pending} onClick={() => run('clear')}>{t('goal.clear')}</Button>
        </>
      )}
    />
  );
}

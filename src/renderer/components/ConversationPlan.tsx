import { useState } from 'react';
import type { RuntimePlan, RuntimePlanStep } from '@todex/protocol/conversationRuntime';
import { TaskProgress, type TaskProgressItem } from '@/components/application/agent-progress/agent-progress';
import { useT } from '../i18n';

const STEP_STATE: Record<RuntimePlanStep['status'], TaskProgressItem['state']> = {
  completed: 'done', in_progress: 'active', pending: 'pending',
};

/** The agent's latest plan for the current turn, above the composer; the
 * header reads "Plan" with the done/total count TaskProgress shows. */
export function ConversationPlanBar({ plan, className }: { plan: RuntimePlan; className?: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(true);
  const items = plan.steps.map((step, index): TaskProgressItem => ({
    id: String(index), label: step.text, state: STEP_STATE[step.status],
  }));
  return (
    <TaskProgress
      className={className}
      items={items}
      status={t('plan.title')}
      label={t('plan.label')}
      description={plan.explanation}
      expanded={expanded}
      onExpandedChange={setExpanded}
    />
  );
}

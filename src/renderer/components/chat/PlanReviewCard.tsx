import { RiFileList3Line } from '@remixicon/react';
import { Markdown, type MarkdownComponents } from '@/components/ui/markdown';
import { useT } from '@/i18n';

/**
 * A plan the agent handed in for approval (Claude Code's `ExitPlanMode`, a
 * plan review), as its own timeline row: the plan stays readable above the
 * composer's approval card and after it is answered, instead of hiding as
 * tool arguments inside the folded work steps.
 */
export function PlanReviewCard({ id, plan, components }: {
  id: string;
  plan: string;
  components?: MarkdownComponents;
}) {
  const t = useT();
  return (
    <section
      aria-label={t('chat.planReview')}
      className="flex w-full min-w-0 flex-col gap-2 rounded-2xl border border-border-button-default bg-background-primary-default px-4 py-3"
    >
      <p className="flex items-center gap-1.5 text-caption-1-semibold text-text-secondary">
        <RiFileList3Line aria-hidden className="size-4 shrink-0 text-foreground-icon-secondary" />
        {t('chat.planReview')}
      </p>
      <Markdown id={id} components={components} className="w-full min-w-0 text-body-regular text-text-primary">
        {plan}
      </Markdown>
    </section>
  );
}

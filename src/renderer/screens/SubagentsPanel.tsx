import { useState, type ComponentType, type ReactNode } from 'react';
import {
  RiCheckLine,
  RiExportLine,
  RiFileCopyLine,
  RiHashtag,
  RiImportLine,
  RiRobot2Line,
  RiTimeLine,
  RiToolsLine,
} from '@remixicon/react';
import type { SubagentRun, SubagentStatus } from '@todex/protocol/v2';
import { Badge } from '@/components/base/badges/badge';
import { Chip, type ChipProps } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { IconAction } from '@/components/ui/icon-action';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cx } from '@/utils/cx';
import { ToolCallCard, ToolCallText, type ToolCallState } from '../components/chat/ToolCallCard';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT, type MessageKey } from '../i18n';

type Props = {
  session: TodeXSession;
  conversationId?: string;
};

const STATUS_LABELS: Record<SubagentStatus, MessageKey> = {
  queued: 'aside.subagentQueued',
  running: 'aside.subagentRunning',
  completed: 'aside.subagentCompleted',
  failed: 'aside.subagentFailed',
  cancelled: 'aside.subagentCancelled',
};

const STATUS_COLORS: Record<SubagentStatus, NonNullable<ChipProps['color']>> = {
  queued: 'neutral',
  running: 'blue',
  completed: 'lime',
  failed: 'rose',
  cancelled: 'yellow',
};

/** Runs render like the chat's tool cards: collapsed by default, status icon
 * plus summary in the trigger, task/result/error folded into the body. */
const STATUS_TOOL_STATE: Record<SubagentStatus, ToolCallState> = {
  queued: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'completed',
};

function timeLabel(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function durationLabel(run: SubagentRun): string {
  if (!run.startedAt || !run.finishedAt) return '';
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return !Number.isFinite(ms) || ms < 0 ? '' : ms < 1000 ? '<1s' : formatMs(ms);
}

function CopyValue({ value, label, pill = false }: { value: string; label: string; pill?: boolean }) {
  const [copied, setCopied] = useState(false);
  const onPress = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  };
  const icon = copied ? RiCheckLine : RiFileCopyLine;
  return pill
    ? <Button size="xs" variant="secondary" leadingIcon={icon} aria-label={label} onClick={onPress}>{label}</Button>
    : <IconAction size="xs" icon={icon} aria-label={label} onClick={onPress} />;
}

function DetailRow({ label, children }: { label: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-caption-1-regular text-text-secondary">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1 text-caption-1-regular text-text-primary">{children}</dd>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="mb-1 text-caption-2-medium uppercase tracking-wide text-text-tertiary">{children}</div>;
}

type UsageStat = {
  key: string;
  label: string;
  text: string;
  tone: 'accent' | 'success' | 'warning' | 'default';
  Icon?: ComponentType<{ className?: string }>;
};

const USAGE_TONE_CLASS: Record<UsageStat['tone'], { chip: string; value: string }> = {
  accent: { chip: 'bg-badge-new-background text-badge-new-text', value: '' },
  success: { chip: 'bg-status-lime-background text-status-lime-text', value: '' },
  warning: { chip: 'bg-status-yellow-background text-status-yellow-text', value: '' },
  default: { chip: 'bg-background-secondary-default text-text-secondary', value: 'text-text-primary' },
};

function usageStats(usage: SubagentRun['usage'], t: ReturnType<typeof useT>): UsageStat[] {
  return Object.entries(usage ?? {})
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => {
      const k = key.toLowerCase();
      if (/tool/.test(k)) {
        return { key, label: t('aside.subagentUsageTools'), text: value.toLocaleString(), tone: 'warning' as const, Icon: RiToolsLine };
      }
      if (/duration|elapsed|_ms$/.test(k)) {
        return { key, label: t('aside.subagentDuration'), text: formatMs(value), tone: 'default' as const, Icon: RiTimeLine };
      }
      if (/^(input|prompt)(_tokens?)?$/.test(k)) {
        return { key, label: t('aside.subagentUsageInput'), text: value.toLocaleString(), tone: 'accent' as const, Icon: RiImportLine };
      }
      if (/^(output|completion)(_tokens?)?$/.test(k)) {
        return { key, label: t('aside.subagentUsageOutput'), text: value.toLocaleString(), tone: 'success' as const, Icon: RiExportLine };
      }
      if (/^(total_)?tokens?$/.test(k)) {
        return { key, label: t('aside.subagentUsageTokens'), text: value.toLocaleString(), tone: 'accent' as const, Icon: RiHashtag };
      }
      return { key, label: key, text: value.toLocaleString(), tone: 'default' as const };
    });
}

function SubagentCard({ run }: { run: SubagentRun }) {
  const t = useT();
  const duration = durationLabel(run);
  const stats = usageStats(run.usage, t);
  // A failed run's result is surfaced as its error text — same convention
  // as the chat tool cards.
  const errorText = run.error || (run.status === 'failed' ? run.result ?? '' : '');
  const resultText = run.status === 'failed' ? '' : run.result ?? '';
  const agentId = run.agentId || run.id;
  // What a running agent is doing right now, when its provider reports it.
  const activity = run.status === 'running' && typeof run.metadata?.activity === 'string' ? run.metadata.activity.trim() : '';
  const started = timeLabel(run.startedAt);
  const finished = timeLabel(run.finishedAt);
  const hasContent = Boolean(
    agentId || started || finished || duration || run.outputFile || stats.length
      || run.task || resultText || errorText || run.providerItemId,
  );

  return (
    <ToolCallCard
      variant="card"
      state={STATUS_TOOL_STATE[run.status]}
      active={run.status === 'running'}
      title={run.title}
      isExpandable={hasContent}
      toolCallId={run.providerItemId}
      footer={activity ? <p className="truncate text-caption-1-regular text-text-tertiary" title={activity}>{activity}</p> : undefined}
      meta={(
        <>
          {duration ? <span className="shrink-0 text-caption-1-regular text-text-tertiary">{duration}</span> : null}
          <Chip variant="caption" color={STATUS_COLORS[run.status]} className="shrink-0">{t(STATUS_LABELS[run.status])}</Chip>
        </>
      )}
    >
      {run.task ? <ToolCallText label={t('aside.subagentTask')}>{run.task}</ToolCallText> : null}
      {resultText ? <ToolCallText label={t('aside.subagentResult')}>{resultText}</ToolCallText> : null}
      {errorText ? <ToolCallText label={t('aside.subagentError')} tone="error">{errorText}</ToolCallText> : null}
      <div>
        <SectionLabel>{t('aside.subagentDetails')}</SectionLabel>
        <dl className="m-0 divide-y divide-separator-border rounded-xl bg-background-secondary-default px-3">
          <DetailRow label={t('aside.subagentId')}>
            <span className="truncate font-mono">{agentId}</span>
            <CopyValue value={agentId} label={t('common.copy')} />
          </DetailRow>
          <DetailRow label={t('aside.subagentStarted')}>
            {started ? <span>{started}</span> : null}
          </DetailRow>
          <DetailRow label={t('aside.subagentFinished')}>
            {finished ? <span>{finished}</span> : null}
          </DetailRow>
          <DetailRow label={t('aside.subagentDuration')}>
            {duration ? <span>{duration}</span> : null}
          </DetailRow>
          <DetailRow label={t('aside.subagentOutput')}>
            {run.outputFile ? <CopyValue pill value={run.outputFile} label={t('aside.subagentCopyPath')} /> : null}
          </DetailRow>
        </dl>
      </div>
      {stats.length ? (
        <div>
          <SectionLabel>{t('aside.subagentUsage')}</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {stats.map((stat) => {
              const tone = USAGE_TONE_CLASS[stat.tone];
              const Icon = stat.Icon;
              return (
                <span key={stat.key} className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-caption-1-regular', tone.chip)}>
                  {Icon ? <Icon className="size-3 shrink-0" /> : null}
                  <b className={cx('text-caption-1-semibold tabular-nums', tone.value)}>{stat.text}</b>
                  <span className="text-caption-2-regular">{stat.label}</span>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </ToolCallCard>
  );
}

export function SubagentsPanel({ session, conversationId }: Props) {
  const t = useT();
  const runs = conversationId ? session.subagentsByConversation[conversationId] ?? [] : [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-title-3-semibold text-text-primary">
          <RiRobot2Line aria-hidden className="size-5 text-foreground-icon-secondary" />
          {t('aside.subagentsTitle')}
        </h2>
        {runs.length ? <Badge>{runs.length}</Badge> : null}
      </div>
      <ScrollArea className="flex-1" contentClassName="flex flex-col gap-2" surface="secondary">
        {runs.length ? (
          runs.map((run) => <SubagentCard key={run.id} run={run} />)
        ) : (
          <p className="text-body-regular text-text-secondary">{t('aside.subagentEmpty')}</p>
        )}
      </ScrollArea>
    </div>
  );
}

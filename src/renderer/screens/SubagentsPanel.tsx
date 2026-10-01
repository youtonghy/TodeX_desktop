import { useState, type ComponentType, type ReactNode } from 'react';
import { Button, Chip, ScrollShadow } from '@heroui/react';
import { ChatTool, type ToolPartState } from '@heroui-pro/react/chat-tool';
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

const STATUS_COLORS: Record<SubagentStatus, 'default' | 'accent' | 'success' | 'danger' | 'warning'> = {
  queued: 'default',
  running: 'accent',
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning',
};

/** Runs render like the chat's tool cards: collapsed by default, status icon
 * plus summary in the trigger, task/result/error folded into the body. */
const STATUS_TOOL_STATE: Record<SubagentStatus, ToolPartState> = {
  queued: 'input-available',
  running: 'input-available',
  completed: 'output-available',
  failed: 'output-error',
  cancelled: 'output-available',
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
  const icon = copied ? <RiCheckLine className="size-3.5" /> : <RiFileCopyLine className="size-3.5" />;
  return pill
    ? <Button size="sm" variant="tertiary" aria-label={label} onPress={onPress}>{icon}{label}</Button>
    : <Button isIconOnly size="sm" variant="ghost" aria-label={label} onPress={onPress}>{icon}</Button>;
}

function DetailRow({ label, children }: { label: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-muted shrink-0 text-xs">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1">{children}</dd>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">{children}</div>;
}

type UsageStat = {
  key: string;
  label: string;
  text: string;
  tone: 'accent' | 'success' | 'warning' | 'default';
  Icon?: ComponentType<{ className?: string }>;
};

const USAGE_TONE_CLASS: Record<UsageStat['tone'], { chip: string; value: string }> = {
  accent: { chip: 'bg-accent-soft text-accent-soft-foreground', value: '' },
  success: { chip: 'bg-success-soft text-success-soft-foreground', value: '' },
  warning: { chip: 'bg-warning-soft text-warning-soft-foreground', value: '' },
  default: { chip: 'bg-surface-secondary text-muted', value: 'text-foreground' },
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
  // ChatTool hides the result section in the error state, so a failed run's
  // result is surfaced as its error text — same convention as chat tool cards.
  const errorText = run.error || (run.status === 'failed' ? run.result ?? '' : '');
  const resultText = run.status === 'failed' ? '' : run.result ?? '';
  const agentId = run.agentId || run.id;
  const started = timeLabel(run.startedAt);
  const finished = timeLabel(run.finishedAt);
  const hasContent = Boolean(
    agentId || started || finished || duration || run.outputFile || stats.length
      || run.task || resultText || errorText || run.providerItemId,
  );

  return (
    <ChatTool
      defaultExpanded={false}
      state={STATUS_TOOL_STATE[run.status]}
      active={run.status === 'running'}
      isExpandable={hasContent}
      className="mb-2"
    >
      <ChatTool.Trigger>
        <ChatTool.StatusIcon />
        <span className="min-w-0 truncate font-medium">{run.title}</span>
        {duration ? <span className="text-muted shrink-0">{duration}</span> : null}
        <Chip size="sm" variant="soft" color={STATUS_COLORS[run.status]}>{t(STATUS_LABELS[run.status])}</Chip>
      </ChatTool.Trigger>
      <ChatTool.Content>
        {run.task ? (
          <ChatTool.Args label={t('aside.subagentTask')}>
            <p className="max-h-52 overflow-y-auto whitespace-pre-wrap wrap-anywhere px-1">{run.task}</p>
          </ChatTool.Args>
        ) : null}
        {resultText ? (
          <ChatTool.Result label={t('aside.subagentResult')}>
            <p className="max-h-52 overflow-y-auto whitespace-pre-wrap wrap-anywhere px-1">{resultText}</p>
          </ChatTool.Result>
        ) : null}
        {errorText ? (
          <ChatTool.Error label={t('aside.subagentError')}>
            <p className="whitespace-pre-wrap wrap-anywhere px-1">{errorText}</p>
          </ChatTool.Error>
        ) : null}
        <div className="px-1 py-1">
          <SectionLabel>{t('aside.subagentDetails')}</SectionLabel>
          <dl className="bg-surface-secondary divide-separator m-0 divide-y rounded-xl px-3">
            <DetailRow label={t('aside.subagentId')}>
              <span className="truncate font-mono text-xs">{agentId}</span>
              <CopyValue value={agentId} label={t('common.copy')} />
            </DetailRow>
            <DetailRow label={t('aside.subagentStarted')}>
              {started ? <span className="text-xs">{started}</span> : null}
            </DetailRow>
            <DetailRow label={t('aside.subagentFinished')}>
              {finished ? <span className="text-xs">{finished}</span> : null}
            </DetailRow>
            <DetailRow label={t('aside.subagentDuration')}>
              {duration ? <span className="text-xs">{duration}</span> : null}
            </DetailRow>
            <DetailRow label={t('aside.subagentOutput')}>
              {run.outputFile ? <CopyValue pill value={run.outputFile} label={t('aside.subagentCopyPath')} /> : null}
            </DetailRow>
          </dl>
        </div>
        {stats.length ? (
          <div className="px-1 py-1">
            <SectionLabel>{t('aside.subagentUsage')}</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {stats.map((stat) => {
                const tone = USAGE_TONE_CLASS[stat.tone];
                const Icon = stat.Icon;
                return (
                  <span key={stat.key} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${tone.chip}`}>
                    {Icon ? <Icon className="size-3 shrink-0" /> : null}
                    <b className={`font-semibold tabular-nums ${tone.value}`}>{stat.text}</b>
                    <span className="text-[11px]">{stat.label}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}
        {run.providerItemId ? <ChatTool.Meta toolCallId={run.providerItemId} /> : null}
      </ChatTool.Content>
    </ChatTool>
  );
}

export function SubagentsPanel({ session, conversationId }: Props) {
  const t = useT();
  const runs = conversationId ? session.subagentsByConversation[conversationId] ?? [] : [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <RiRobot2Line className="size-5" />
          {t('aside.subagentsTitle')}
        </h2>
        {runs.length ? <Chip size="sm" variant="soft">{runs.length}</Chip> : null}
      </div>
      <ScrollShadow className="min-h-0 flex-1">
        {runs.length ? (
          runs.map((run) => <SubagentCard key={run.id} run={run} />)
        ) : (
          <p className="text-muted text-sm">{t('aside.subagentEmpty')}</p>
        )}
      </ScrollShadow>
    </div>
  );
}

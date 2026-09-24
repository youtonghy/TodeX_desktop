import { Chip, ScrollShadow } from '@heroui/react';
import { ChatTool, type ToolPartState } from '@heroui-pro/react/chat-tool';
import { RiRobot2Line } from '@remixicon/react';
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

function durationLabel(run: SubagentRun): string {
  if (!run.startedAt || !run.finishedAt) return '';
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return '<1s';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted shrink-0">{label}</span>
      <span className="min-w-0 break-all text-right font-mono">{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">{children}</div>;
}

function SubagentCard({ run }: { run: SubagentRun }) {
  const t = useT();
  const duration = durationLabel(run);
  const usageTokens = run.usage
    ? Object.entries(run.usage)
        .filter(([, value]) => typeof value === 'number')
        .map(([key, value]) => `${key} ${value}`)
        .join(' · ')
    : '';
  // ChatTool hides the result section in the error state, so a failed run's
  // result is surfaced as its error text — same convention as chat tool cards.
  const errorText = run.error || (run.status === 'failed' ? run.result ?? '' : '');
  const resultText = run.status === 'failed' ? '' : run.result ?? '';
  const details: Array<[string, string | undefined]> = [
    [t('aside.subagentKind'), run.agentKind],
    ['Agent', run.agentId],
    ['Parent', run.parentId],
    [t('aside.subagentStarted'), timeLabel(run.startedAt)],
    [t('aside.subagentFinished'), timeLabel(run.finishedAt)],
    [t('aside.subagentOutput'), run.outputFile],
    [t('aside.subagentUsage'), usageTokens],
  ];
  const hasContent = Boolean(
    run.task || resultText || errorText || run.metadata || run.providerItemId
      || details.some(([, value]) => value),
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
        {details.some(([, value]) => value) ? (
          <div className="px-1 py-1">
            <SectionLabel>{t('aside.subagentDetails')}</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {details.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
            </div>
          </div>
        ) : null}
        {run.metadata ? (
          <pre className="text-muted max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-secondary p-2 font-mono">
            {JSON.stringify(run.metadata, null, 2)}
          </pre>
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

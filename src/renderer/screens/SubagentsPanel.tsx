import { useState } from 'react';
import { Button, Card, Chip, ScrollShadow } from '@heroui/react';
import { RiArrowDownSLine, RiRobot2Line } from '@remixicon/react';
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

function SubagentCard({ run }: { run: SubagentRun }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const duration = durationLabel(run);
  const usageTokens = run.usage
    ? Object.entries(run.usage)
        .filter(([, value]) => typeof value === 'number')
        .map(([key, value]) => `${key} ${value}`)
        .join(' · ')
    : '';
  const hasDetails = Boolean(
    run.result || run.error || run.agentKind || run.agentId || run.providerItemId
      || run.parentId || run.outputFile || usageTokens || run.metadata,
  );

  return (
    <Card className="mb-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{run.title}</span>
        <div className="flex shrink-0 items-center gap-2">
          {duration ? <span className="text-muted text-xs">{duration}</span> : null}
          <Chip size="sm" variant="soft" color={STATUS_COLORS[run.status]}>{t(STATUS_LABELS[run.status])}</Chip>
          {hasDetails ? (
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={t('aside.subagentDetails')}
              aria-expanded={expanded}
              onPress={() => setExpanded((open) => !open)}
            >
              <RiArrowDownSLine className={`size-4 transition-transform${expanded ? ' rotate-180' : ''}`} />
            </Button>
          ) : null}
        </div>
      </div>
      {run.task ? <p className="text-muted mt-1 text-xs whitespace-pre-wrap">{run.task}</p> : null}
      {expanded ? (
        <div className="border-separator mt-2 flex flex-col gap-2 border-t pt-2 text-xs">
          {run.result ? (
            <div>
              <p className="text-muted mb-1">{t('aside.subagentResult')}</p>
              <p className="whitespace-pre-wrap">{run.result}</p>
            </div>
          ) : null}
          {run.error ? <p className="text-danger whitespace-pre-wrap">{run.error}</p> : null}
          <DetailRow label={t('aside.subagentKind')} value={run.agentKind} />
          <DetailRow label="Agent" value={run.agentId} />
          <DetailRow label="Item" value={run.providerItemId} />
          <DetailRow label="Parent" value={run.parentId} />
          <DetailRow label={t('aside.subagentStarted')} value={timeLabel(run.startedAt)} />
          <DetailRow label={t('aside.subagentFinished')} value={timeLabel(run.finishedAt)} />
          <DetailRow label={t('aside.subagentOutput')} value={run.outputFile} />
          {usageTokens ? <DetailRow label={t('aside.subagentUsage')} value={usageTokens} /> : null}
          {run.metadata ? (
            <pre className="text-muted max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-secondary p-2 font-mono">
              {JSON.stringify(run.metadata, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </Card>
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

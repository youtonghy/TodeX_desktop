import { useState } from 'react';
import { RiChatSmile2Line, RiStopCircleLine, RiTeamLine } from '@remixicon/react';
import { isActiveAgentCallStatus, type AgentCallSession, type AgentCallStatus, type AgentCallTurn } from '@todex/protocol/agentCalling';
import { providerDisplayName } from '@todex/protocol/v2';
import { Badge } from '@/components/base/badges/badge';
import { Chip, type ChipProps } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import { ProviderIcon } from '../components/ProviderIcon';
import { ToolCallCard, ToolCallText, type ToolCallState } from '../components/chat/ToolCallCard';
import { ToolElapsed } from '../components/chat/ToolRunStatus';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT, type MessageKey } from '../i18n';
import { SubagentText } from './SubagentsPanel';

type Props = {
  session: TodeXSession;
  /** Local id of the calling (parent) conversation. */
  conversationId?: string;
};

const NO_CALLS: AgentCallSession[] = [];

export const AGENT_CALL_STATUS_LABELS: Record<AgentCallStatus, MessageKey> = {
  running: 'agentCalls.statusRunning',
  waiting_permission: 'agentCalls.statusWaitingPermission',
  completed: 'agentCalls.statusCompleted',
  failed: 'agentCalls.statusFailed',
  cancelled: 'agentCalls.statusCancelled',
  interrupted: 'agentCalls.statusInterrupted',
};

export const AGENT_CALL_STATUS_COLORS: Record<AgentCallStatus, NonNullable<ChipProps['color']>> = {
  running: 'blue',
  waiting_permission: 'yellow',
  completed: 'lime',
  failed: 'rose',
  cancelled: 'neutral',
  interrupted: 'yellow',
};

const STATUS_TOOL_STATE: Record<AgentCallStatus, ToolCallState> = {
  running: 'running',
  waiting_permission: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'completed',
  interrupted: 'failed',
};

/** `startedAt` → epoch ms, and the end implied by `durationMs`. */
function turnTimes(turn: AgentCallTurn | undefined): { start?: number; end?: number } {
  const start = turn?.startedAt ? Date.parse(turn.startedAt) : NaN;
  if (!Number.isFinite(start)) return {};
  return { start, end: turn?.durationMs !== undefined ? start + turn.durationMs : undefined };
}

function TurnElapsed({ turn }: { turn: AgentCallTurn | undefined }) {
  const { start, end } = turnTimes(turn);
  return <ToolElapsed startedAt={start} endedAt={end} running={Boolean(turn && isActiveAgentCallStatus(turn.status))} />;
}

function StatusChip({ status }: { status: AgentCallStatus }) {
  const t = useT();
  return <Chip variant="caption" color={AGENT_CALL_STATUS_COLORS[status]} className="shrink-0">{t(AGENT_CALL_STATUS_LABELS[status])}</Chip>;
}

function errorText(turn: AgentCallTurn, t: ReturnType<typeof useT>): string {
  if (!turn.error) return '';
  if (turn.error.code === 'DAEMON_RESTARTED') return t('agentCalls.daemonRestarted');
  return turn.error.code && turn.error.code !== turn.error.message ? `${turn.error.code}: ${turn.error.message}` : turn.error.message;
}

function TurnBlock({ turn, index, count }: { turn: AgentCallTurn; index: number; count: number }) {
  const t = useT();
  const details = [turn.model, turn.reasoningEffort].filter(Boolean).join(' · ');
  const error = errorText(turn, t);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {count > 1 ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-caption-1-semibold text-text-secondary">{t('agentCalls.turn', { n: index + 1 })}</span>
          {details ? <span className="min-w-0 truncate text-caption-1-regular text-text-tertiary">{details}</span> : null}
          <span className="flex-1" />
          <TurnElapsed turn={turn} />
          <StatusChip status={turn.status} />
        </div>
      ) : null}
      {turn.text ? <SubagentText label={t('agentCalls.task')} text={turn.text} /> : null}
      {turn.output ? <SubagentText label={t('agentCalls.result')} text={turn.output} /> : null}
      {error ? <ToolCallText label={t('agentCalls.error')} tone="error">{error}</ToolCallText> : null}
    </div>
  );
}

/** One child conversation: the agent, its latest turn's model and status,
 * and every turn's task and result. */
export function AgentCallCard({ call, agentName, onOpen, onCancel }: {
  call: AgentCallSession;
  agentName: string;
  onOpen: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const t = useT();
  const [pending, setPending] = useState<'open' | 'cancel' | null>(null);
  const latest = call.turns[call.turns.length - 1];
  const active = isActiveAgentCallStatus(call.status);
  const details = [latest?.model, latest?.reasoningEffort].filter(Boolean).join(' · ');
  const run = (kind: 'open' | 'cancel', work: () => Promise<void>, failure: MessageKey) => {
    setPending(kind);
    void work()
      .catch((error: unknown) => toast.danger(t(failure), { description: error instanceof Error ? error.message : undefined }))
      .finally(() => setPending(null));
  };
  // The daemon's default title ("Agent call · <agent>") only repeats the agent.
  const customTitle = call.title && !call.title.startsWith('Agent call') && call.title !== agentName ? call.title : '';
  const title = customTitle ? `${agentName} · ${customTitle}` : agentName;
  return (
    <ToolCallCard
      variant="card"
      state={STATUS_TOOL_STATE[call.status]}
      active={active}
      leading={<ProviderIcon provider={call.agent} className="size-4 shrink-0 text-foreground-icon-secondary" />}
      title={title}
      isExpandable={call.turns.some(turn => turn.text || turn.output || turn.error)}
      defaultExpanded={active}
      footer={(
        <div className="flex min-w-0 flex-col gap-1.5 pb-1.5">
          {/* The header carries only the agent name, which stays readable in
              the narrow aside; status, model, effort, turns and elapsed time
              share this meta line. */}
          <div className="flex min-w-0 items-center gap-2">
            <StatusChip status={call.status} />
            <span
              className={cx('min-w-0 flex-1 truncate text-caption-1-regular', details ? 'text-text-tertiary' : 'text-text-placeholder')}
              title={details || undefined}
            >
              {details || t('agentCalls.defaultModel')}
              {call.turns.length > 1 ? ` · ${t('agentCalls.turns', { count: call.turns.length })}` : ''}
            </span>
            <TurnElapsed turn={latest} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {active ? (
              <Button
                size="xs"
                variant="secondary"
                leadingIcon={RiStopCircleLine}
                disabled={pending !== null}
                aria-busy={pending === 'cancel' || undefined}
                onClick={() => run('cancel', onCancel, 'agentCalls.cancelFailed')}
              >
                {t('agentCalls.cancel')}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="secondary"
              leadingIcon={RiChatSmile2Line}
              disabled={pending !== null}
              aria-busy={pending === 'open' || undefined}
              onClick={() => run('open', onOpen, 'agentCalls.openFailed')}
            >
              {t('agentCalls.open')}
            </Button>
          </div>
        </div>
      )}
    >
      {call.turns.map((turn, index) => (
        <TurnBlock key={turn.childTurnId} turn={turn} index={index} count={call.turns.length} />
      ))}
    </ToolCallCard>
  );
}

/** Workbench tab: the agents a conversation's agent called through the
 * `todex_agents` MCP server (Agent Calling), running ones first. */
export function AgentCallsPanel({ session, conversationId }: Props) {
  const t = useT();
  const calls = conversationId ? session.agentCallsByConversation[conversationId] ?? NO_CALLS : NO_CALLS;
  const conversation = session.conversations.find(item => item.id === conversationId);
  const providers = session.v2ProvidersByBackend[conversation?.backendConnectionId ?? session.activeBackendConnectionId] ?? session.v2Providers;
  const agentName = (agent: string) => (agent
    ? providers.find(item => item.id === agent)?.displayName || providerDisplayName(agent)
    : t('agentCalls.unknownAgent'));
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-title-3-semibold text-text-primary">
          <RiTeamLine aria-hidden className="size-5 text-foreground-icon-secondary" />
          {t('agentCalls.title')}
        </h2>
        {calls.length ? <Badge>{calls.length}</Badge> : null}
      </div>
      <ScrollArea className="flex-1" contentClassName="flex flex-col gap-2" surface="secondary">
        {calls.length && conversationId ? (
          calls.map((call) => (
            <AgentCallCard
              key={call.childConversationId}
              call={call}
              agentName={agentName(call.agent)}
              onOpen={() => session.openAgentCallConversation(conversationId, call.childConversationId, call.title)}
              onCancel={async () => {
                const latest = call.turns[call.turns.length - 1];
                await session.cancelAgentCall(conversationId, call.childConversationId, latest && isActiveAgentCallStatus(latest.status) ? latest.childTurnId : undefined);
              }}
            />
          ))
        ) : (
          <p className="text-body-regular text-text-secondary">{t('agentCalls.empty')}</p>
        )}
      </ScrollArea>
    </div>
  );
}

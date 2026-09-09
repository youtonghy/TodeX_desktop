import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';
import type { ContextCompactionState } from '@todex/protocol/v2';

/** Evidence of known work in the current turn, independent of output frequency. */
export function hasActiveConversationWork(
  runtime: ConversationRuntime, compaction?: ContextCompactionState,
): boolean {
  const turnId = runtime.activeTurnId;
  if (runtime.status !== 'running' || !turnId) return false;
  if (runtime.pendingPermissions.some(permission => permission.turnId === turnId)) return true;
  if (runtime.timeline.some(entry => entry.turnId === turnId && entry.category === 'tool'
    && (entry.phase === 'started' || entry.phase === 'delta'))) return true;

  // These projections carry no turn identity and survive turn completion. Use
  // the current user message's timestamp to exclude previous-turn leftovers.
  const starts = runtime.timeline.filter(entry => entry.kind === 'outgoing' && entry.turnId === turnId
    && Number.isFinite(entry.at) && entry.at > 0).map(entry => entry.at);
  if (!starts.length) return false;
  const turnStartedAt = Math.min(...starts);
  const inCurrentTurn = (time: string | undefined): boolean => {
    const parsed = Date.parse(time ?? '');
    return Number.isFinite(parsed) && parsed >= turnStartedAt;
  };
  if (runtime.subagents.some(agent => (agent.status === 'running' || agent.status === 'queued')
    && inCurrentTurn(agent.startedAt))) return true;
  const currentCompaction = compaction ?? runtime.compaction;
  return currentCompaction.status === 'running' && inCurrentTurn(currentCompaction.updatedAt);
}

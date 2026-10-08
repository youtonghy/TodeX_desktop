import type { FollowUpQueueState } from '@todex/protocol/conversationRuntime';

/** Item id prefix of the continuation a daemon with its own follow-up queue
 * inserts at the head when a turn fails on an exhausted plan window. */
export const BACKEND_RATE_LIMIT_CONTINUE_PREFIX = 'rate-limit-continue-';

/** Rate-limit state of a conversation whose daemon holds the follow-up queue.
 * It comes only from the queue snapshot (`followups.updated` or
 * `conversation.queue.list`), never from provider error text:
 * - `waiting`: paused `rate_limited`, so the daemon starts the head by itself
 *   at `resumeAt` (epoch ms, NaN when unknown);
 * - `continues`: the head is the daemon's continuation, so a failed prompt is
 *   being continued and must not return to the composer. A queue already
 *   paused for another reason keeps that reason but still gets the
 *   continuation. */
export function backendRateLimitState(queue: FollowUpQueueState | undefined): {
  waiting: boolean;
  resumeAt: number;
  continues: boolean;
} {
  const waiting = Boolean(queue?.paused && queue.pauseReason === 'rate_limited');
  return {
    waiting,
    resumeAt: waiting ? Date.parse(queue!.resumeAt) : Number.NaN,
    continues: queue?.items[0]?.id.startsWith(BACKEND_RATE_LIMIT_CONTINUE_PREFIX) === true,
  };
}

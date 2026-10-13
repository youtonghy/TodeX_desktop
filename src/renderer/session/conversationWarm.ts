/** Best-effort `conversation.warm`: asks the backend to start a conversation's
 * agent process before its first prompt, so that prompt starts faster. Older
 * backends reject the command; replies are recognized by request-id prefix
 * and dropped without reaching the user. */

/** Request-id prefix of `conversation.warm`. */
export const CONVERSATION_WARM_ID_PREFIX = 'warm';

/** A conversation is warmed at most once per this interval. */
export const CONVERSATION_WARM_INTERVAL_MS = 30_000;

/** Whether a `server.result` / `server.error` id belongs to a warm request. */
export function isConversationWarmRequestId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(`${CONVERSATION_WARM_ID_PREFIX}-`);
}

/** Whether to warm `conversationId` now: not while it runs a turn (its agent
 * is already up), and not again within the interval. */
export function shouldWarmConversation(
  conversationId: string,
  now: number,
  lastSentAt: ReadonlyMap<string, number>,
  busy: boolean,
): boolean {
  if (!conversationId || busy) return false;
  const last = lastSentAt.get(conversationId);
  return last === undefined || now - last >= CONVERSATION_WARM_INTERVAL_MS;
}

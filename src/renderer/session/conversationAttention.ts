import type { ConversationRecord, TimelineEntry } from './helpers';

type AttentionRecord = Pick<ConversationRecord, 'nativeStatus' | 'updatedAt' | 'lastCompletedAt' | 'lastReadAt'>;
type AttentionEntry = Pick<TimelineEntry, 'at' | 'kind' | 'marker' | 'title'>;

const FAILED = /error|failed|异常|失败/i;

/**
 * What an idle conversation still asks of the user once seen: a failure
 * (`issue`) or a reply (`unread`), or null when it has been seen.
 *
 * `sharedUnseen` is set when the conversation shares its read position
 * across the owner's devices (TodeX_backend docs/API.md "已读位置"): whether
 * it holds events after that position, as the protocol's `hasUnseenEvents`
 * tells. Seen then means seen on any device. Left undefined (a backend
 * without `readSync`), this device's own `lastReadAt` decides.
 */
export function conversationAttention(
  conversation: AttentionRecord,
  latestEntry: AttentionEntry | undefined,
  latestIncomingAt: number | undefined,
  sharedUnseen?: boolean,
): 'issue' | 'unread' | null {
  if (sharedUnseen !== undefined) {
    if (!sharedUnseen) return null;
    return latestEntry?.marker === 'error' || FAILED.test(conversation.nativeStatus || '') || FAILED.test(latestEntry?.title || '')
      ? 'issue'
      : 'unread';
  }
  // The dot is an attention marker: it clears once the conversation has been
  // seen (lastReadAt), regardless of which state produced it.
  const lastReadAt = conversation.lastReadAt ?? 0;
  const latestEntryUnread = Boolean(latestEntry && latestEntry.at > lastReadAt);
  if (
    (latestEntry?.marker === 'error' && latestEntryUnread) ||
    (FAILED.test(conversation.nativeStatus || '') && conversation.updatedAt > lastReadAt) ||
    (FAILED.test(latestEntry?.title || '') && latestEntryUnread)
  ) {
    return 'issue';
  }
  // Timeline rows of an idle background conversation are released from
  // memory, so the persisted turn completion keeps a reply unread until seen.
  const incomingAt = Math.max(latestIncomingAt ?? (latestEntry?.kind === 'incoming' ? latestEntry.at : 0), conversation.lastCompletedAt ?? 0);
  return incomingAt > lastReadAt ? 'unread' : null;
}

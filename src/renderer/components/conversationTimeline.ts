import { isStepProgressEntry, latestIncomingEntryIds } from '@todex/protocol/mobileParity';
import { matchesMessage } from '../i18n';
import type { TimelineEntry } from '../session/helpers';

export { latestIncomingEntryIds };

/** Both clients render semantic errors and tools from the same projection. */
export function isChatTimelineEntry(entry: TimelineEntry): boolean {
  return entry.kind !== 'system' || isStepProgressEntry(entry) || entry.category === 'error' || entry.detailLocked === true
    || entry.title === 'turn.failed';
}

export function isChatToolEntry(entry: TimelineEntry): boolean {
  return entry.category ? entry.category === 'tool' : entry.kind === 'system' && matchesMessage('chat.toolCall', entry.title);
}

/** Display order of chat rows: journal sequence when both rows carry one,
 * then time, then id. */
export function compareChatEntries(left: TimelineEntry, right: TimelineEntry): number {
  if (left.sequence !== undefined && right.sequence !== undefined && left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  if (left.at !== right.at) return left.at - right.at;
  return left.id.localeCompare(right.id);
}

/** `entries` in display order. A runtime projection already arrives in that
 * order, so it is returned as is unless an adjacent pair is out of order —
 * the stable sort would leave such an input unchanged anyway. */
export function sortChatEntries(entries: TimelineEntry[]): TimelineEntry[] {
  for (let index = 1; index < entries.length; index += 1) {
    if (compareChatEntries(entries[index - 1], entries[index]) > 0) return entries.slice().sort(compareChatEntries);
  }
  return entries;
}

/** True when both lists hold the same row objects in the same order, so a
 * frame for another conversation keeps this one's derived rows. */
export function sameTimelineEntries(left: readonly TimelineEntry[], right: readonly TimelineEntry[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

// Rows are immutable (an update replaces the object), so their grouping keys
// are computed once per row instead of once per rebuild.
const turnKeyCache = new WeakMap<TimelineEntry, string>();
const userKeyCache = new WeakMap<TimelineEntry, string>();

function chatTurnKey(entry: TimelineEntry): string {
  let key = turnKeyCache.get(entry);
  if (key === undefined) {
    key = JSON.stringify([entry.conversationId ?? '', 'turn', entry.turnId]);
    turnKeyCache.set(entry, key);
  }
  return key;
}

function chatUserKey(entry: TimelineEntry): string {
  if (entry.turnId) return chatTurnKey(entry);
  let key = userKeyCache.get(entry);
  if (key === undefined) {
    key = JSON.stringify([entry.conversationId ?? '', 'user', entry.id]);
    userKeyCache.set(entry, key);
  }
  return key;
}

export type ChatRenderItem =
  | { type: 'entry'; entry: TimelineEntry }
  | { type: 'executionGroup'; id: string; entries: TimelineEntry[]; turnId?: string; userMessageId?: string };

/** Steps that fold into the collapsed trace. `assistant_progress` narration is
 * deliberately excluded: progress text reads like a message and stays visible
 * as a standalone line, while still splitting adjacent tool runs. */
function isFoldedStepEntry(entry: TimelineEntry): boolean {
  return isStepProgressEntry(entry) && entry.category !== 'assistant_progress';
}

/** Consecutive steps fold into one trace; text between two runs starts a new
 * trace so the working notes stay interleaved with the narration they belong
 * to. Unattributed startup statuses are not conversation content. */
export function buildChatRenderItems(entries: readonly TimelineEntry[]): ChatRenderItem[] {
  const turnKey = chatTurnKey;
  const userKey = chatUserKey;
  const anchors = new Map<string, TimelineEntry>();
  for (const entry of entries) {
    if (entry.kind === 'outgoing' && !anchors.has(userKey(entry))) anchors.set(userKey(entry), entry);
  }
  const groups = new Map<string, Extract<ChatRenderItem, { type: 'executionGroup' }>>();
  const groupAnchors = new Map<string, string>();
  const entryGroup = new Map<TimelineEntry, string>();
  const runCounts = new Map<string, number>();
  let currentUser: TimelineEntry | undefined;
  let orphanKey = '';
  let openKey = '';
  let openGroupId = '';
  for (const entry of entries) {
    if (entry.kind === 'outgoing') { currentUser = entry; orphanKey = ''; openKey = ''; }
    if (!isFoldedStepEntry(entry)) { openKey = ''; continue; }
    if (!entry.turnId && !currentUser && entry.category === 'status') continue;
    const key = entry.turnId ? turnKey(entry) : currentUser ? userKey(currentUser)
      : (orphanKey ||= JSON.stringify([entry.conversationId ?? '', 'orphan', entry.id]));
    if (openKey !== key) {
      openKey = key;
      const run = (runCounts.get(key) ?? 0) + 1;
      runCounts.set(key, run);
      openGroupId = `${key}#${run}`;
      groups.set(openGroupId, {
        type: 'executionGroup', id: `chat-process-${openGroupId}`, entries: [],
        turnId: entry.turnId || anchors.get(key)?.turnId || undefined, userMessageId: anchors.get(key)?.id,
      });
      groupAnchors.set(openGroupId, key);
    }
    entryGroup.set(entry, openGroupId);
    groups.get(openGroupId)!.entries.push(entry);
  }
  const items: ChatRenderItem[] = [];
  const emitted = new Set<string>();
  const emittedAnchors = new Set<string>();
  const pendingByAnchor = new Map<string, string[]>();
  let lastGroupAnchor = '';
  const emit = (groupId: string, anchor: string) => {
    const group = groups.get(groupId);
    if (!group || emitted.has(groupId)) return;
    // Runs that end up adjacent with no text between them fold back into a
    // single trace; only runs separated by messages stay interleaved.
    const last = items[items.length - 1];
    if (last?.type === 'executionGroup' && lastGroupAnchor === anchor) {
      last.entries.push(...group.entries);
    } else {
      items.push(group);
      lastGroupAnchor = anchor;
    }
    emitted.add(groupId);
  };
  for (const entry of entries) {
    const groupId = entryGroup.get(entry);
    if (groupId) {
      const group = groups.get(groupId)!;
      if (group.entries[0] === entry) {
        const anchor = groupAnchors.get(groupId)!;
        // A trace whose steps precede its prompt in replay order still emits
        // with that prompt; later runs sit between the texts they separate.
        if (anchors.has(anchor) && !emittedAnchors.has(anchor)) {
          const pending = pendingByAnchor.get(anchor) ?? [];
          pending.push(groupId);
          pendingByAnchor.set(anchor, pending);
        } else {
          emit(groupId, anchor);
        }
      }
      continue;
    }
    if (isFoldedStepEntry(entry)) continue;
    items.push({ type: 'entry', entry });
    lastGroupAnchor = '';
    if (entry.kind === 'outgoing') {
      const anchor = userKey(entry);
      emittedAnchors.add(anchor);
      for (const groupId of pendingByAnchor.get(anchor) ?? []) emit(groupId, anchor);
      pendingByAnchor.delete(anchor);
    }
  }
  return items;
}

/// The execution group that is still live for the running turn. A group the
/// agent has already replied after is finished — its tools may still run in
/// the background, but the live status belongs below the newest reply.
export function activeChatProcessId(items: readonly ChatRenderItem[], activeTurnId?: string): string {
  // Runs on every render: scan from the end without copying the rows.
  let user: TimelineEntry | undefined;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === 'entry' && item.entry.kind === 'outgoing') { user = item.entry; break; }
  }
  let groupIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === 'executionGroup' && (
      activeTurnId ? item.turnId === activeTurnId : !item.turnId && Boolean(user) && item.userMessageId === user?.id
    )) { groupIndex = index; break; }
  }
  const group = items[groupIndex];
  if (group?.type !== 'executionGroup') return '';
  if (user && group.userMessageId !== user.id && user.turnId !== group.turnId) return '';
  for (let index = groupIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (item.type === 'entry' && item.entry.kind === 'incoming') return '';
  }
  return group.id;
}

import { isStepProgressEntry, latestIncomingEntryIds } from '@todex/protocol/mobileParity';
import type { TimelineEntry } from '../session/helpers';

export { latestIncomingEntryIds };

/** Both clients render semantic errors and tools from the same projection. */
export function isChatTimelineEntry(entry: TimelineEntry): boolean {
  return entry.kind !== 'system' || isStepProgressEntry(entry) || entry.category === 'error'
    || entry.title === 'turn.failed';
}

export function isChatToolEntry(entry: TimelineEntry): boolean {
  return entry.category ? entry.category === 'tool' : entry.kind === 'system' && entry.title === '工具调用';
}

export type ChatRenderItem =
  | { type: 'entry'; entry: TimelineEntry }
  | { type: 'executionGroup'; id: string; entries: TimelineEntry[]; turnId?: string; userMessageId?: string };

/** Consecutive steps fold into one trace; text between two runs starts a new
 * trace so the working notes stay interleaved with the narration they belong
 * to. Unattributed startup statuses are not conversation content. */
export function buildChatRenderItems(entries: readonly TimelineEntry[]): ChatRenderItem[] {
  const turnKey = (entry: TimelineEntry) => JSON.stringify([entry.conversationId ?? '', 'turn', entry.turnId]);
  const userKey = (entry: TimelineEntry) => entry.turnId ? turnKey(entry) : JSON.stringify([entry.conversationId ?? '', 'user', entry.id]);
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
    if (!isStepProgressEntry(entry)) { openKey = ''; continue; }
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
    if (isStepProgressEntry(entry)) continue;
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

export function activeChatProcessId(items: readonly ChatRenderItem[], activeTurnId?: string): string {
  const latestUser = [...items].reverse().find(item => item.type === 'entry' && item.entry.kind === 'outgoing');
  const user = latestUser?.type === 'entry' ? latestUser.entry : undefined;
  const group = [...items].reverse().find(item => item.type === 'executionGroup' && (
    activeTurnId ? item.turnId === activeTurnId : !item.turnId && Boolean(user) && item.userMessageId === user?.id
  ));
  if (group?.type !== 'executionGroup') return '';
  if (user && group.userMessageId !== user.id && user.turnId !== group.turnId) return '';
  return group.id;
}

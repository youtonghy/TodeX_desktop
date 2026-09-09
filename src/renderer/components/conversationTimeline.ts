import { isStepProgressEntry } from '@todex/protocol/mobileParity';
import type { TimelineEntry } from '../session/helpers';

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

/** One trace per turn, anchored after its prompt, rather than per adjacent run
 * of events. Unattributed startup statuses are not conversation content. */
export function buildChatRenderItems(entries: readonly TimelineEntry[]): ChatRenderItem[] {
  const turnKey = (entry: TimelineEntry) => JSON.stringify([entry.conversationId ?? '', 'turn', entry.turnId]);
  const userKey = (entry: TimelineEntry) => entry.turnId ? turnKey(entry) : JSON.stringify([entry.conversationId ?? '', 'user', entry.id]);
  const anchors = new Map<string, TimelineEntry>();
  for (const entry of entries) {
    if (entry.kind === 'outgoing' && !anchors.has(userKey(entry))) anchors.set(userKey(entry), entry);
  }
  const groups = new Map<string, Extract<ChatRenderItem, { type: 'executionGroup' }>>();
  const keys = new Map<TimelineEntry, string>();
  let currentUser: TimelineEntry | undefined;
  let orphanKey = '';
  for (const entry of entries) {
    if (entry.kind === 'outgoing') { currentUser = entry; orphanKey = ''; }
    if (!isStepProgressEntry(entry)) continue;
    if (!entry.turnId && !currentUser && entry.category === 'status') continue;
    const key = entry.turnId ? turnKey(entry) : currentUser ? userKey(currentUser)
      : (orphanKey ||= JSON.stringify([entry.conversationId ?? '', 'orphan', entry.id]));
    keys.set(entry, key);
    let group = groups.get(key);
    if (!group) {
      group = { type: 'executionGroup', id: `chat-process-${key}`, entries: [],
        turnId: entry.turnId || anchors.get(key)?.turnId || undefined, userMessageId: anchors.get(key)?.id };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  const items: ChatRenderItem[] = [];
  const emitted = new Set<string>();
  const emit = (key: string) => {
    const group = groups.get(key);
    if (group && !emitted.has(key)) { items.push(group); emitted.add(key); }
  };
  for (const entry of entries) {
    if (isStepProgressEntry(entry)) {
      const key = keys.get(entry);
      // An anchored trace is emitted with its user message, even if a replay
      // places its first status event before that message.
      if (key && !anchors.has(key)) emit(key);
    } else {
      items.push({ type: 'entry', entry });
      if (entry.kind === 'outgoing') emit(userKey(entry));
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

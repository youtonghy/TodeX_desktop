import { useSyncExternalStore } from 'react';

// In-app notification history for the sidebar's notification center: app
// notices (every toast) and conversations that finished while the user was
// elsewhere. Kept in localStorage so it survives a restart, except entries
// about private conversations, which stay in memory. An entry about a
// conversation is stored without its title and text (reply excerpts, the
// command an approval asks about): those are history content, which is
// end-to-end encrypted and must not sit in plain text on disk.

export type FeedStatus = 'neutral' | 'information' | 'success' | 'error';

export type FeedItem = {
  id: string;
  /** `conversation`: a finished turn (opens it); `system`: app notices. */
  kind: 'conversation' | 'system';
  status: FeedStatus;
  title: string;
  description: string;
  at: number;
  read: boolean;
  workspaceId?: string;
  conversationId?: string;
  /** About a private conversation: shown this session, never stored. */
  ephemeral?: boolean;
  /** Read back from storage without its title and description (it is
   * about a conversation): the view names the conversation instead. */
  restored?: true;
};

const STORAGE_KEY = 'todex.notificationFeed.v2';
/** v1 stored the title and text of conversation entries. */
const LEGACY_STORAGE_KEY = 'todex.notificationFeed.v1';

/** What is stored of an entry: conversation entries lose their content. */
function stored(item: FeedItem): FeedItem {
  return item.conversationId ? { ...item, title: '', description: '', restored: true } : item;
}

function parse(raw: string | null): FeedItem[] {
  const value = raw ? JSON.parse(raw) as unknown : [];
  return Array.isArray(value) ? value.filter((item): item is FeedItem => typeof item?.id === 'string' && !item.ephemeral).slice(0, LIMIT) : [];
}
const LIMIT = 50;

let items: FeedItem[] = load();
let counter = 0;
const listeners = new Set<() => void>();

function load(): FeedItem[] {
  try {
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      // Carry the history over without the content v1 kept.
      const migrated = parse(legacy).map(stored);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      return migrated;
    }
    return parse(window.localStorage.getItem(STORAGE_KEY)).map((item) => (item.conversationId ? stored(item) : item));
  } catch {
    return [];
  }
}

function commit(next: FeedItem[]) {
  items = next.slice(0, LIMIT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.filter((item) => !item.ephemeral).map(stored)));
  } catch {
    // The feed still works for this session.
  }
  listeners.forEach((listener) => listener());
}

/** Newest first; an identical unread entry within a minute is not repeated. */
export function addNotification(entry: Omit<FeedItem, 'id' | 'at' | 'read'>): void {
  const now = Date.now();
  const duplicate = items.find((item) => !item.read && now - item.at < 60_000
    && item.title === entry.title && item.description === entry.description);
  if (duplicate) return;
  counter += 1;
  commit([{ ...entry, id: `${now.toString(36)}-${counter}`, at: now, read: false }, ...items]);
}

export function markNotificationRead(id: string): void {
  if (!items.some((item) => item.id === id && !item.read)) return;
  commit(items.map((item) => item.id === id ? { ...item, read: true } : item));
}

export function markAllNotificationsRead(): void {
  if (!items.some((item) => !item.read)) return;
  commit(items.map((item) => item.read ? item : { ...item, read: true }));
}

/** Drops the entries of conversations that are gone (deleted, or a private
 * conversation cleared with its daemon). */
export function forgetConversationNotifications(conversationIds: ReadonlySet<string>): void {
  if (!items.some((item) => item.conversationId && conversationIds.has(item.conversationId))) return;
  commit(items.filter((item) => !item.conversationId || !conversationIds.has(item.conversationId)));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useNotificationFeed(): FeedItem[] {
  return useSyncExternalStore(subscribe, () => items);
}

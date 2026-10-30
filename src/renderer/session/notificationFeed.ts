import { useSyncExternalStore } from 'react';

// In-app notification history for the sidebar's notification center: app
// notices (every toast) and conversations that finished while the user was
// elsewhere. Kept in localStorage so it survives a restart, except entries
// about private conversations, which stay in memory.

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
};

const STORAGE_KEY = 'todex.notificationFeed.v1';
const LIMIT = 50;

let items: FeedItem[] = load();
let counter = 0;
const listeners = new Set<() => void>();

function load(): FeedItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(value) ? value.filter((item): item is FeedItem => typeof item?.id === 'string' && !item.ephemeral).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

function commit(next: FeedItem[]) {
  items = next.slice(0, LIMIT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.filter((item) => !item.ephemeral)));
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

/** Drops the entries of conversations that are gone (a private
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

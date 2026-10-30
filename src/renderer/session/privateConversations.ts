import type { ConversationManifest, ProviderDescriptor } from '@todex/protocol/v2';
import type { WorkspaceRecord } from '@todex/protocol/todex';
import { isPrivateConversation, type ConversationRecord } from './helpers';

// Private (RAM-only) conversations live only in their daemon's memory. This
// client keeps them in memory too: nothing of them reaches local storage,
// the history cache or the persisted notification feed, and they vanish
// here when their daemon restarts.

/** Local and backend ids of the private conversations among `conversations`. */
export function privateConversationIds(conversations: readonly ConversationRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const conversation of conversations) {
    if (!isPrivateConversation(conversation)) continue;
    ids.add(conversation.id);
    if (conversation.v2ConversationId) ids.add(conversation.v2ConversationId);
  }
  return ids;
}

/** The records that may be written to local storage. */
export function persistableConversations(conversations: readonly ConversationRecord[]): ConversationRecord[] {
  return conversations.some(isPrivateConversation) ? conversations.filter((item) => !isPrivateConversation(item)) : [...conversations];
}

/** Drops entries keyed by a private conversation (receipts, usage, timeline). */
export function withoutPrivateEntries<T extends { conversationId?: string }>(entries: readonly T[], privateIds: ReadonlySet<string>): T[] {
  if (privateIds.size === 0) return [...entries];
  return entries.filter((entry) => !entry.conversationId || !privateIds.has(entry.conversationId));
}

/** How the provider keeps a private conversation (`native` or `scrubbed`),
 * or null when it cannot hold one. */
export function providerPrivateMode(provider: Pick<ProviderDescriptor, 'capabilities'> | undefined): 'native' | 'scrubbed' | null {
  const mode = provider?.capabilities.privateConversations;
  return mode === 'native' || mode === 'scrubbed' ? mode : null;
}

/** Private conversations of `backendId` its complete list no longer has:
 * the daemon restarted (or deleted them), so they are gone for good. */
export function vanishedPrivateConversations(
  current: readonly ConversationRecord[],
  manifests: readonly ConversationManifest[],
  workspaces: readonly WorkspaceRecord[],
  backendId: string,
): ConversationRecord[] {
  const listed = new Set(manifests.map((manifest) => manifest.id));
  return current.filter((item) => {
    if (!isPrivateConversation(item) || !item.v2ConversationId || listed.has(item.v2ConversationId)) return false;
    const owner = item.backendConnectionId ?? workspaces.find((workspace) => workspace.id === item.workspaceId)?.backendConnectionId;
    return !owner || owner === backendId;
  });
}

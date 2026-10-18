// Sidebar quick search over conversations. Pure so it can be unit tested.

type SearchableConversation = {
  id: string;
  workspaceId: string;
  archived?: boolean;
  parentConversationId?: string;
};

/** Conversations whose title contains `query` (case-insensitive), across
 * every workspace. Archived conversations, Agent Calling children and
 * conversations of `hiddenWorkspaceIds` (e.g. directories missing on the
 * backend) are left out. An empty query matches nothing. */
export function searchConversations<T extends SearchableConversation>(
  conversations: readonly T[],
  query: string,
  titleOf: (conversation: T) => string,
  hiddenWorkspaceIds: ReadonlySet<string> = new Set(),
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return conversations.filter((conversation) => (
    !conversation.archived
    && !conversation.parentConversationId
    && !hiddenWorkspaceIds.has(conversation.workspaceId)
    && titleOf(conversation).toLocaleLowerCase().includes(needle)
  ));
}

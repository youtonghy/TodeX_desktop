// Sidebar quick search over conversations. Pure so it can be unit tested.

type SearchableConversation = {
  id: string;
  workspaceId: string;
  archived?: boolean;
  parentConversationId?: string;
};

export type ConversationSearchHit<T> = {
  conversation: T;
  /** Excerpt around the first content match; absent for a title match. */
  snippet?: string;
};

const SNIPPET_BEFORE = 8;
const SNIPPET_LENGTH = 64;

/** One line of `text` around the first occurrence of `needle` (already
 * lowercased), with ellipses where it was cut. */
export function searchSnippet(text: string, needle: string): string | undefined {
  const compact = text.replace(/\s+/g, ' ').trim();
  const index = compact.toLocaleLowerCase().indexOf(needle);
  if (index < 0) return undefined;
  const start = Math.max(0, index - SNIPPET_BEFORE);
  const end = Math.min(compact.length, start + SNIPPET_LENGTH);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

/** Conversations whose title, or one of the texts `textsOf` returns (preview,
 * cached messages), contains `query` (case-insensitive), across every
 * workspace. Title matches come first, keeping input order within each
 * group; content matches carry a snippet. Archived conversations, Agent
 * Calling children and conversations of `hiddenWorkspaceIds` (e.g.
 * directories missing on the backend) are left out. An empty query matches
 * nothing. */
export function searchConversations<T extends SearchableConversation>(
  conversations: readonly T[],
  query: string,
  titleOf: (conversation: T) => string,
  hiddenWorkspaceIds: ReadonlySet<string> = new Set(),
  textsOf: (conversation: T) => readonly string[] = () => [],
): ConversationSearchHit<T>[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const titleHits: ConversationSearchHit<T>[] = [];
  const contentHits: ConversationSearchHit<T>[] = [];
  for (const conversation of conversations) {
    if (conversation.archived || conversation.parentConversationId || hiddenWorkspaceIds.has(conversation.workspaceId)) continue;
    if (titleOf(conversation).toLocaleLowerCase().includes(needle)) {
      titleHits.push({ conversation });
      continue;
    }
    for (const text of textsOf(conversation)) {
      const snippet = searchSnippet(text, needle);
      if (snippet) {
        contentHits.push({ conversation, snippet });
        break;
      }
    }
  }
  return [...titleHits, ...contentHits];
}

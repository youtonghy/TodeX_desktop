import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';

/** Tracks which agent-browser tab lifetime of the viewed conversation was already known. */
export type AgentBrowserWatch = { conversationId: string; seeded: boolean; sequence: number; tabSince: string };

export function createAgentBrowserWatch(): AgentBrowserWatch {
  return { conversationId: '', seeded: false, sequence: 0, tabSince: '' };
}

/**
 * Whether the viewed conversation's agent browser started a new tab lifetime
 * (`desktopBrowser.tabSince` changed) after it became the viewed one. The
 * first runtime seen for a conversation, recovery batches, and updates that
 * did not advance the applied sequence (history paged in below the window)
 * only record the lifetime, so replayed history, a stale open tab, a failed
 * action, or a tab the user already closed the panel on never reopen it.
 */
export function takeNewAgentBrowserTab(
  watch: AgentBrowserWatch,
  conversationId: string,
  runtime: Pick<ConversationRuntime, 'desktopBrowser' | 'appliedSequence'> | undefined,
  recovering: boolean,
): boolean {
  if (watch.conversationId !== conversationId) {
    watch.conversationId = conversationId;
    watch.seeded = false;
    watch.sequence = 0;
    watch.tabSince = '';
  }
  if (!conversationId || !runtime) return false;
  const seeding = !watch.seeded || recovering || runtime.appliedSequence <= watch.sequence;
  const tabSince = runtime.desktopBrowser.tabSince ?? '';
  const started = tabSince !== '' && tabSince !== watch.tabSince;
  watch.seeded = true;
  watch.sequence = Math.max(watch.sequence, runtime.appliedSequence);
  watch.tabSince = tabSince;
  return started && !seeding;
}

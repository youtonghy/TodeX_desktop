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

/** Tracks whether the viewed conversation's Computer Use session was already known. */
export type AgentComputerWatch = { conversationId: string; seeded: boolean; sequence: number; engaged: boolean };

export function createAgentComputerWatch(): AgentComputerWatch {
  return { conversationId: '', seeded: false, sequence: 0, engaged: false };
}

/**
 * Whether the viewed conversation's agent started using the computer (a
 * screen session started, or the first use awaits the host's confirmation)
 * after it became the viewed one. Like {@link takeNewAgentBrowserTab}, the
 * first runtime seen, recovery batches and updates that did not advance the
 * applied sequence only record the state.
 */
export function takeNewAgentComputerSession(
  watch: AgentComputerWatch,
  conversationId: string,
  runtime: Pick<ConversationRuntime, 'desktopComputer' | 'appliedSequence'> | undefined,
  recovering: boolean,
): boolean {
  if (watch.conversationId !== conversationId) {
    watch.conversationId = conversationId;
    watch.seeded = false;
    watch.sequence = 0;
    watch.engaged = false;
  }
  if (!conversationId || !runtime) return false;
  const seeding = !watch.seeded || recovering || runtime.appliedSequence <= watch.sequence;
  const engaged = runtime.desktopComputer.active || Boolean(runtime.desktopComputer.awaitingHost);
  const started = engaged && !watch.engaged;
  watch.seeded = true;
  watch.sequence = Math.max(watch.sequence, runtime.appliedSequence);
  watch.engaged = engaged;
  return started && !seeding;
}

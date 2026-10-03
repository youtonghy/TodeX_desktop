import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';
import type { SshExecRun } from '@todex/protocol/ssh';
import type { WorkbenchItem } from '../lib/panels';

/** Agent `ssh_exec` tabs kept per workbench before finished ones are closed. */
export const SSH_EXEC_TAB_LIMIT = 20;
const TITLE_COMMAND_CHARS = 24;

export function sshExecTabTitle(run: Pick<SshExecRun, 'host' | 'command'>): string {
  const command = run.command.replace(/\s+/g, ' ').trim();
  const short = command.length > TITLE_COMMAND_CHARS ? `${command.slice(0, TITLE_COMMAND_CHARS)}…` : command;
  return [run.host, short].filter(Boolean).join(' · ');
}

export function formatSshExecDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** Tracks which calls of the viewed conversation were already known. */
export type SshExecWatch = { conversationId: string; seen: Set<string> | null; sequence: number };

export function createSshExecWatch(): SshExecWatch {
  return { conversationId: '', seen: null, sequence: 0 };
}

/**
 * Returns the calls of the viewed conversation that started after it became
 * the viewed one. The first runtime seen for a conversation, recovery
 * batches, and updates that did not advance the applied sequence (history
 * paged in below the window) only mark their calls as known, so replayed
 * history never opens tabs. Each id is reported at most once per activation.
 */
export function takeNewSshExecs(
  watch: SshExecWatch,
  conversationId: string,
  runtime: Pick<ConversationRuntime, 'sshExecs' | 'appliedSequence'> | undefined,
  recovering: boolean,
): SshExecRun[] {
  if (watch.conversationId !== conversationId) {
    watch.conversationId = conversationId;
    watch.seen = null;
    watch.sequence = 0;
  }
  if (!conversationId || !runtime) return [];
  const seeding = !watch.seen || recovering || runtime.appliedSequence <= watch.sequence;
  const seen = watch.seen ?? new Set<string>();
  watch.seen = seen;
  watch.sequence = Math.max(watch.sequence, runtime.appliedSequence);
  const fresh: SshExecRun[] = [];
  for (const run of runtime.sshExecs) {
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    if (!seeding) fresh.push(run);
  }
  return fresh;
}

/** Closes the oldest finished exec tabs beyond the limit; `keep` (the tabs
 * just opened) and running calls stay, so the limit may be exceeded. */
export function capSshExecTabs(
  items: WorkbenchItem[],
  isRunning: (item: WorkbenchItem) => boolean,
  keep: ReadonlySet<string>,
): WorkbenchItem[] {
  let excess = items.filter(item => item.type === 'ssh-exec').length - SSH_EXEC_TAB_LIMIT;
  if (excess <= 0) return items;
  const evicted = new Set<string>();
  for (const item of items) {
    if (excess <= 0) break;
    if (item.type !== 'ssh-exec' || keep.has(item.id) || isRunning(item)) continue;
    evicted.add(item.id);
    excess -= 1;
  }
  return evicted.size ? items.filter(item => !evicted.has(item.id)) : items;
}

/** Exec tabs are session-only; they survive a workbench remount (switching
 * conversations and back) but are never written to the tab store. */
const sessionSshExecTabs = new Map<string, WorkbenchItem[]>();

export function sessionSshExecTabsFor(storageKey: string): WorkbenchItem[] {
  return sessionSshExecTabs.get(storageKey) ?? [];
}

export function rememberSessionSshExecTabs(storageKey: string, items: WorkbenchItem[]): void {
  const execItems = items.filter(item => item.type === 'ssh-exec');
  if (execItems.length) sessionSshExecTabs.set(storageKey, execItems);
  else sessionSshExecTabs.delete(storageKey);
}

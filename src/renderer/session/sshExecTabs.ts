import { useSyncExternalStore } from 'react';
import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';
import type { SshExecRun } from '@todex/protocol/ssh';
import type { WorkbenchItem } from '../lib/panels';

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
 * history never opens the log. Each id is reported at most once per activation.
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

/** The Agent SSH tab is session-only; it survives a workbench remount
 * (switching conversations and back) but is never written to the tab store. */
const sessionSshExecTabs = new Map<string, WorkbenchItem[]>();

export function sessionSshExecTabsFor(storageKey: string): WorkbenchItem[] {
  return sessionSshExecTabs.get(storageKey) ?? [];
}

export function rememberSessionSshExecTabs(storageKey: string, items: WorkbenchItem[]): void {
  const execItems = items.filter(item => item.type === 'ssh-exec');
  if (execItems.length) sessionSshExecTabs.set(storageKey, execItems);
  else sessionSshExecTabs.delete(storageKey);
}

/** A non-zero exit code counts as a failure, like a failed or cancelled call. */
export function isSshExecFailed(run: SshExecRun): boolean {
  return run.status === 'failed' || run.status === 'cancelled' || (run.exitCode !== undefined && run.exitCode !== 0);
}

// CSI (colours, cursor moves), OSC (titles, hyperlinks) and the remaining
// two-byte escapes. A trailing incomplete sequence of a still-growing chunk
// is dropped as well, so it never flashes as garbage.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\x1b(?:\[[0-?]*[ -/]*|\][^\x07\x1b]*)?$/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '').replace(/\r\n/g, '\n');
}

/** Lines of output as shown, ignoring a final newline. */
export function countLines(text: string): number {
  if (!text) return 0;
  let lines = 1;
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) lines += 1;
  return text.endsWith('\n') ? lines - 1 : lines;
}

export function sshExecOutputText(run: Pick<SshExecRun, 'output'>): string {
  return stripAnsi(run.output.map(chunk => chunk.data).join(''));
}

/** Plain-text transcript of the given calls, for "copy all". */
export function sshExecTranscript(runs: readonly SshExecRun[]): string {
  return runs.map((run) => {
    const output = sshExecOutputText(run).replace(/\n$/, '');
    return output ? `$ ${run.command}\n${output}` : `$ ${run.command}`;
  }).join('\n\n');
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Local wall-clock time of an ISO timestamp, `HH:MM` or `HH:MM:SS`. */
export function formatSshExecTime(iso: string | undefined, withSeconds: boolean): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withSeconds ? `${clock}:${pad(date.getSeconds())}` : clock;
}

export type SshExecTurn = { ordinal: number; startedAt?: string };

/** 1-based ordinal of each distinct turn and the start of its first call. */
export function sshExecTurns(runs: readonly SshExecRun[]): Map<string, SshExecTurn> {
  const turns = new Map<string, SshExecTurn>();
  for (const run of runs) {
    if (!run.turnId) continue;
    const turn = turns.get(run.turnId);
    if (!turn) turns.set(run.turnId, { ordinal: turns.size + 1, startedAt: run.startedAt });
    else if (!turn.startedAt && run.startedAt) turn.startedAt = run.startedAt;
  }
  return turns;
}

/** "Clear view" hides every call known at the click, plus older ones paged in
 * later (compared in the backend's clock). Client-side and session-only. */
export type SshExecClear = { ids: ReadonlySet<string>; before: number };

const sshExecClears = new Map<string, SshExecClear>();
const clearListeners = new Set<() => void>();

function subscribeSshExecClears(listener: () => void): () => void {
  clearListeners.add(listener);
  return () => { clearListeners.delete(listener); };
}

export function clearSshExecView(conversationId: string, runs: readonly SshExecRun[]): void {
  const before = runs.reduce((latest, run) => Math.max(latest, (run.startedAt && Date.parse(run.startedAt)) || 0), 0);
  sshExecClears.set(conversationId, { ids: new Set(runs.map(run => run.id)), before });
  clearListeners.forEach(listener => listener());
}

export function useSshExecClear(conversationId: string): SshExecClear | undefined {
  return useSyncExternalStore(subscribeSshExecClears, () => sshExecClears.get(conversationId));
}

export function visibleSshExecs(runs: readonly SshExecRun[], clear: SshExecClear | undefined): readonly SshExecRun[] {
  if (!clear) return runs;
  return runs.filter((run) => {
    if (clear.ids.has(run.id)) return false;
    const started = run.startedAt ? Date.parse(run.startedAt) : NaN;
    return !(Number.isFinite(started) && started <= clear.before);
  });
}

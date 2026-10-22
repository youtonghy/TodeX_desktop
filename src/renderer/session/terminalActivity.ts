import { useSyncExternalStore } from 'react';

/** What a terminal tab shows about its terminal besides the output. */
export type TerminalActivity = {
  /** Output arrived in the last moments. */
  printing: boolean;
  /** A command finished, or the bell rang, while the tab was out of sight. */
  attention: boolean;
  /** Shell integration says a command is running (not at the prompt). */
  commandRunning: boolean;
  /** Title the program or shell set (OSC 0/2). */
  title: string;
  /** Working directory the shell reported (OSC 7). */
  cwd: string;
  /** OSC 9;4 progress: state 0 none, 1 value, 2 error, 3 indeterminate, 4 paused. */
  progress: { state: number; value: number } | null;
};

const IDLE: TerminalActivity = { printing: false, attention: false, commandRunning: false, title: '', cwd: '', progress: null };

let activities: Record<string, TerminalActivity> = {};
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function terminalActivity(terminalId: string): TerminalActivity {
  return activities[terminalId] ?? IDLE;
}

export function patchTerminalActivity(terminalId: string, patch: Partial<TerminalActivity>) {
  const current = terminalActivity(terminalId);
  if ((Object.keys(patch) as Array<keyof TerminalActivity>).every((key) => current[key] === patch[key])) return;
  activities = { ...activities, [terminalId]: { ...current, ...patch } };
  listeners.forEach((listener) => listener());
}

export function forgetTerminalActivity(terminalId: string) {
  if (!(terminalId in activities)) return;
  const { [terminalId]: _removed, ...rest } = activities;
  activities = rest;
  listeners.forEach((listener) => listener());
}

export function useTerminalActivity(terminalId: string): TerminalActivity {
  return useSyncExternalStore(subscribe, () => terminalActivity(terminalId));
}

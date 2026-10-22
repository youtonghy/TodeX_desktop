import { useSyncExternalStore } from 'react';

export type TerminalCursorStyle = 'block' | 'bar' | 'underline';

/** Per-device terminal preferences; never synced to the backend. */
export type TerminalPreferences = {
  fontSize: number;
  /** Empty for the built-in monospace stack. */
  fontFamily: string;
  cursorStyle: TerminalCursorStyle;
  /** Load the TodeX bash/zsh/fish integration into new local shells. */
  shellIntegration: boolean;
};

export const TERMINAL_FONT_SIZE_MIN = 11;
export const TERMINAL_FONT_SIZE_MAX = 20;
export const DEFAULT_TERMINAL_FONT_FAMILY = '"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, monospace';

const STORAGE_KEY = 'todex.terminal.v1';
const DEFAULTS: TerminalPreferences = { fontSize: 13, fontFamily: '', cursorStyle: 'block', shellIntegration: true };

function readPreferences(): TerminalPreferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const record = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
    const fontSize = typeof record.fontSize === 'number' && Number.isFinite(record.fontSize)
      ? Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(record.fontSize)))
      : DEFAULTS.fontSize;
    const cursorStyle = record.cursorStyle === 'bar' || record.cursorStyle === 'underline' || record.cursorStyle === 'block'
      ? record.cursorStyle
      : DEFAULTS.cursorStyle;
    return {
      fontSize,
      fontFamily: typeof record.fontFamily === 'string' ? record.fontFamily.slice(0, 200) : DEFAULTS.fontFamily,
      cursorStyle,
      shellIntegration: typeof record.shellIntegration === 'boolean' ? record.shellIntegration : DEFAULTS.shellIntegration,
    };
  } catch {
    return DEFAULTS;
  }
}

// One shared snapshot, so the settings page and every terminal agree.
let preferences = readPreferences();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another window (or tab, on the web) changed the preferences.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    preferences = readPreferences();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function getTerminalPreferences(): TerminalPreferences {
  return preferences;
}

export function setTerminalPreferences(patch: Partial<TerminalPreferences>) {
  preferences = { ...preferences, ...patch };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Storage may be disabled. */ }
  preferences = readPreferences();
  listeners.forEach((listener) => listener());
}

export function useTerminalPreferences(): TerminalPreferences {
  return useSyncExternalStore(subscribe, () => preferences);
}

/** The font stack a terminal uses: the chosen family first, then the default stack. */
export function terminalFontFamily(family: string): string {
  const chosen = family.trim();
  return chosen ? `${/[\s,"']/.test(chosen) && !chosen.includes(',') ? `"${chosen.replace(/"/g, '')}"` : chosen}, ${DEFAULT_TERMINAL_FONT_FAMILY}` : DEFAULT_TERMINAL_FONT_FAMILY;
}

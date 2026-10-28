import { useEffect, useRef } from 'react';
import { Kbd } from '@/components/base/kbd/kbd';
import { cx } from '@/utils/cx';
import { platform } from '../platform';

export const isMacLike = platform.os === 'darwin' || navigator.userAgent.includes('Mac');

export type ShortcutId =
  | 'newConversation'
  | 'newWorkspace'
  | 'kanban'
  | 'sshTerminal'
  | 'gitActions'
  | 'toggleSidebar'
  | 'toggleAside'
  | 'quickSearch'
  | 'newWorkbenchTab'
  | WorkbenchTabShortcutId;

const TAB_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
type WorkbenchTabShortcutId = `workbenchTab${typeof TAB_DIGITS[number]}`;

type ShortcutCombo = {
  /** Physical key, compared against KeyboardEvent.code (e.g. 'KeyN'). */
  code: string;
  /** Label shown in the hint badge. */
  label: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Left alone while typing in a field or the terminal, which own the key
   * (Ctrl+L clears an xterm screen). */
  outsideEditors?: boolean;
};

// Browsers reserve ⌘N / ⇧⌘N (new window / incognito), so "new" actions use the
// Option modifier there. ⌘⇧T / Ctrl+Shift+T reopens a closed tab and can't be
// intercepted, so the Terminal view also uses Option. Everything else matches.
const newMod = platform.reservedNewShortcuts ? { alt: true } : { mod: true };

const COMBOS: Record<ShortcutId, ShortcutCombo> = {
  toggleSidebar: { code: 'KeyB', label: 'B', mod: true },
  toggleAside: { code: 'KeyB', label: 'B', mod: true, alt: true },
  gitActions: { code: 'KeyG', label: 'G', mod: true, shift: true },
  newConversation: { code: 'KeyN', label: 'N', ...newMod },
  newWorkspace: { code: 'KeyN', label: 'N', ...newMod, shift: true },
  kanban: { code: 'KeyK', label: 'K', mod: true, shift: true },
  sshTerminal: { code: 'KeyT', label: 'T', ...newMod, shift: true },
  quickSearch: { code: 'KeyL', label: 'L', mod: true, outsideEditors: true },
  newWorkbenchTab: { code: 'KeyN', label: 'N', mod: true, alt: true },
  // ⌘1…⌘9 / Ctrl+1…Ctrl+9 select the right panel's tabs by position; browsers
  // let pages take these over (only new/close/cycle tab keys are reserved).
  ...Object.fromEntries(TAB_DIGITS.map(digit => [`workbenchTab${digit}`, { code: `Digit${digit}`, label: String(digit), mod: true }])) as Record<WorkbenchTabShortcutId, ShortcutCombo>,
};

/** The shortcut that selects the right panel tab at `index`, for the first nine tabs. */
export function workbenchTabShortcut(index: number): ShortcutId | null {
  return index >= 0 && index < TAB_DIGITS.length ? `workbenchTab${TAB_DIGITS[index]}` : null;
}

const MODIFIER_KEY = isMacLike ? 'Meta' : 'Control';
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'AltGraph']);
const HINT_DELAY_MS = 250;

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'));
}

function isTerminalTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.xterm'));
}

function matchesCombo(event: KeyboardEvent, combo: ShortcutCombo): boolean {
  // 'mod' is ⌘ on macOS and Ctrl elsewhere; the opposite modifier must be up so
  // e.g. Ctrl+Alt+B never triggers the ⌘⌥B binding on Windows.
  if (Boolean(combo.mod) !== (isMacLike ? event.metaKey : event.ctrlKey)) return false;
  if (Boolean(combo.shift) !== event.shiftKey) return false;
  if (Boolean(combo.alt) !== event.altKey) return false;
  if (isMacLike ? event.ctrlKey : event.metaKey) return false;
  return event.code === combo.code;
}

/** Toggles `data-shortcut-hints` on <html> while the modifier key is held. */
export function useShortcutHintTracking(): void {
  useEffect(() => {
    const root = document.documentElement;
    let timer: number | null = null;
    const hide = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (root.dataset.shortcutHints) delete root.dataset.shortcutHints;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === MODIFIER_KEY && !event.repeat) {
        if (timer !== null || root.dataset.shortcutHints) return;
        // Delay so a quick chord tap never flashes the overlay.
        timer = window.setTimeout(() => {
          timer = null;
          root.dataset.shortcutHints = 'on';
        }, HINT_DELAY_MS);
        return;
      }
      // Another key during the delay makes this a chord (Ctrl+C held down),
      // not a peek at the hints.
      if (timer !== null && !MODIFIER_KEYS.has(event.key)) {
        window.clearTimeout(timer);
        timer = null;
        return;
      }
      // Safety net: if the modifier keyup was lost (menu focus, IME), the next
      // plain key press proves the modifier is no longer held.
      if (root.dataset.shortcutHints && !event.metaKey && !event.ctrlKey) hide();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === MODIFIER_KEY) hide();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', hide);
    return () => {
      hide();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
}

/** Dispatches app-level shortcuts; handlers are read through a ref so the listener stays stable. */
export function useAppShortcuts(handlers: Partial<Record<ShortcutId, () => void>>): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      for (const [id, combo] of Object.entries(COMBOS) as [ShortcutId, ShortcutCombo][]) {
        if (!matchesCombo(event, combo)) continue;
        // Option is a dead-key modifier on macOS (⌥N → ˜); never steal it while typing.
        if (combo.alt && isEditableTarget(event.target)) return;
        if (combo.outsideEditors && (isEditableTarget(event.target) || isTerminalTarget(event.target))) return;
        const handler = handlersRef.current[id];
        if (!handler) return;
        event.preventDefault();
        handler();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** The key combination as shown to the user: ⌥ ⇧ ⌘ glyphs on macOS (the
 * platform's own modifier order), Ctrl+Alt+Shift+key elsewhere. `omitMod`
 * leaves out ⌘ / Ctrl for badges that only show while it is held. */
export function shortcutKeys(id: ShortcutId, { omitMod = false }: { omitMod?: boolean } = {}): string {
  const combo = COMBOS[id];
  const mod = combo.mod && !omitMod;
  return isMacLike
    ? `${combo.alt ? '⌥' : ''}${combo.shift ? '⇧' : ''}${mod ? '⌘' : ''}${combo.label}`
    : [mod && 'Ctrl', combo.alt && 'Alt', combo.shift && 'Shift', combo.label].filter(Boolean).join('+');
}

/** `compact` drops the held modifier, for badges too small for the full combination. */
export function ShortcutHint({ id, compact = false, className }: { id: ShortcutId; compact?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cx('shortcut-hint', className)}>
      <Kbd className="shortcut-hint__kbd">{shortcutKeys(id, { omitMod: compact })}</Kbd>
    </span>
  );
}

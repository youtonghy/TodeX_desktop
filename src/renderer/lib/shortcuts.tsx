import { Kbd } from '@heroui/react';
import { useEffect, useRef } from 'react';

const isMacLike = window.todexDesktop?.shell.platform === 'darwin'
  || navigator.userAgent.includes('Mac');

export type ShortcutId =
  | 'newConversation'
  | 'newWorkspace'
  | 'kanban'
  | 'gitActions'
  | 'toggleSidebar'
  | 'toggleAside';

type ShortcutCombo = {
  /** Physical key, compared against KeyboardEvent.code (e.g. 'KeyN'). */
  code: string;
  /** Label shown in the hint badge. */
  label: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

const COMBOS: Record<ShortcutId, ShortcutCombo> = {
  toggleSidebar: { code: 'KeyB', label: 'B', mod: true },
  toggleAside: { code: 'KeyB', label: 'B', mod: true, alt: true },
  gitActions: { code: 'KeyG', label: 'G', mod: true, shift: true },
  newConversation: { code: 'KeyN', label: 'N', mod: true },
  newWorkspace: { code: 'KeyN', label: 'N', mod: true, shift: true },
  kanban: { code: 'KeyK', label: 'K', mod: true, shift: true },
};

const MODIFIER_KEY = isMacLike ? 'Meta' : 'Control';
const HINT_DELAY_MS = 250;

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'));
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

export function ShortcutHint({ id, className }: { id: ShortcutId; className?: string }) {
  const combo = COMBOS[id];
  return (
    <span aria-hidden="true" className={`shortcut-hint ${className ?? ''}`}>
      <Kbd className="shortcut-hint__kbd">
        {isMacLike ? (
          <>
            {combo.alt ? <Kbd.Abbr keyValue="option" /> : null}
            {combo.shift ? <Kbd.Abbr keyValue="shift" /> : null}
            {combo.mod ? <Kbd.Abbr keyValue="command" /> : null}
            <Kbd.Content>{combo.label}</Kbd.Content>
          </>
        ) : (
          <Kbd.Content>
            {[combo.alt && 'Alt', combo.shift && 'Shift', combo.mod && 'Ctrl', combo.label]
              .filter(Boolean).join('+')}
          </Kbd.Content>
        )}
      </Kbd>
    </span>
  );
}

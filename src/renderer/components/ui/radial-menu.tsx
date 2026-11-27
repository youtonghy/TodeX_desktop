import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Focusable } from 'react-aria-components';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { useDirection } from '@/components/foundations/direction/direction';
import { cx } from '@/utils/cx';

/**
 * A fan of actions around a trigger (the composer's send button), opened by
 * a right-click, a long press, or Shift+F10 / the Menu key. BoardUI ships no
 * radial menu; this follows its menu recipe (the popover surface, the
 * dropdown hover background, focus ring) and its entrance (fade, slight
 * scale, small blur in 150ms, none under reduced motion).
 *
 * The items fan out above the trigger towards the inline start, where there
 * is room in a bottom-end corner. After a long press, sliding onto an item
 * and releasing picks it; otherwise it stays open for a click. Arrow keys
 * move between items, Enter or Space picks, Escape or Tab closes.
 */

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

export type RadialMenuItem = {
  id: string;
  label: string;
  icon: IconComponent;
  /** What it does, shown on hover. */
  description?: string;
  /** Why it cannot be picked now; shown on hover instead. */
  disabledReason?: string;
  /** Already chosen (the current send mode). */
  selected?: boolean;
};

/** From the trigger's centre to the near edge of each item. */
const RADIUS = 34;
/** Degrees from the inline-end axis, counter-clockwise: the fan spans up and towards the start. */
const ARC_START = 172;
const ARC_END = 96;

export function RadialMenu({ open, anchorRef, items, label, dragging, onSelect, onClose }: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  items: readonly RadialMenuItem[];
  /** Accessible name of the menu. */
  label: string;
  /** Opened by a long press that is still held: releasing over an item picks it. */
  dragging: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const direction = useDirection();
  const reduceMotion = useReducedMotion();
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;

  useLayoutEffect(() => {
    if (!open) {
      setCenter(null);
      setActive(null);
      return;
    }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setCenter({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [anchorRef, open]);

  const enabled = items.filter((item) => !item.disabledReason);
  const close = (refocus: boolean) => {
    onClose();
    // The anchor may wrap the trigger.
    const anchor = anchorRef.current;
    if (refocus) (anchor?.querySelector<HTMLElement>('button, [tabindex]') ?? anchor)?.focus();
  };
  const pick = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (!item || item.disabledReason) return;
    onClose();
    onSelect(id);
  };

  // Keyboard and click opens put focus on the first item it can take.
  useEffect(() => {
    if (!open || !center || dragging) return;
    const first = enabled[0] ?? items[0];
    if (first) itemRefs.current.get(first.id)?.focus();
    // Only when it opens or is placed.
  }, [open, center]);

  // Escape closes the whole fan, before an item's open tooltip (which
  // listens on the document) takes the key for itself.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // A held long press: the item under the pointer lights, releasing picks it.
  useEffect(() => {
    if (!open || !dragging) return;
    const itemAt = (event: PointerEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      return target instanceof Element ? target.closest<HTMLElement>('[data-radial-item]')?.dataset.radialItem ?? null : null;
    };
    const move = (event: PointerEvent) => setActive(itemAt(event));
    const up = (event: PointerEvent) => {
      const id = itemAt(event);
      if (id) pick(id);
      else setActive(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // `pick` reads the current items.
  }, [open, dragging, items]);

  if (!open || !center) return null;

  const focusAt = (index: number) => {
    const item = items[(index + items.length) % items.length];
    if (item) itemRefs.current.get(item.id)?.focus();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => itemRefs.current.get(item.id) === document.activeElement);
    if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      focusAt(index + 1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      focusAt(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(items.length - 1);
    }
  };

  const mirror = direction === 'rtl' ? -1 : 1;
  const step = items.length > 1 ? (ARC_START - ARC_END) / (items.length - 1) : 0;
  return createPortal(
    <div
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      className="fixed inset-0 z-50"
      dir={direction}
      onKeyDown={onKeyDown}
      // A press outside the fan closes it.
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) close(false); }}
      onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => { event.preventDefault(); if (event.target === event.currentTarget) close(false); }}
    >
        {items.map((item, index) => {
          const angle = ((ARC_START - step * index) * Math.PI) / 180;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const x = center.x + mirror * RADIUS * cos;
          const y = center.y - RADIUS * sin;
          // The item's edge facing the trigger sits on the arc, whatever its width.
          const shift = `calc(-50% + ${mirror * 50 * cos}%) calc(-50% - ${50 * sin}%)`;
          const Icon = item.icon;
          const disabled = Boolean(item.disabledReason);
          const hint = item.disabledReason || item.description;
          const button = (
            <motion.button
              ref={(node) => { if (node) itemRefs.current.set(item.id, node); else itemRefs.current.delete(item.id); }}
              type="button"
              role="menuitem"
              data-radial-item={item.id}
              aria-disabled={disabled || undefined}
              aria-checked={item.selected ? true : undefined}
              initial={reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.9, filter: 'blur(2px)', x: center.x - x, y: center.y - y }}
              animate={{ opacity: disabled ? 0.55 : 1, scale: 1, filter: 'blur(0px)', x: 0, y: 0 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.15, ease: [0.22, 1, 0.36, 1] }}
              style={{ left: x, top: y, translate: shift }}
              onPointerEnter={() => setActive(item.id)}
              onPointerLeave={() => setActive((current) => (current === item.id ? null : current))}
              onClick={() => { if (!draggingRef.current) pick(item.id); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  pick(item.id);
                }
              }}
              className={cx(
                'absolute flex items-center gap-2 whitespace-nowrap rounded-full border py-2 ps-2.5 pe-3.5 shadow-dropdown',
                'bg-background-primary-default text-text-primary outline-none transition-colors duration-150 ease-out',
                'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                item.selected ? 'border-accent-500' : 'border-border-button-default',
                disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                active === item.id && !disabled && 'bg-dropdown-item-hover-background',
              )}
            >
              <Icon aria-hidden className={cx('size-4 shrink-0', item.selected ? 'text-text-accent' : 'text-foreground-icon-secondary')} />
              <span className="text-body-2-medium">{item.label}</span>
            </motion.button>
          );
          return hint ? (
            <TooltipTrigger key={item.id} delay={200}>
              <Focusable>{button}</Focusable>
              <Tooltip placement="top">{hint}</Tooltip>
            </TooltipTrigger>
          ) : <span key={item.id}>{button}</span>;
        })}
    </div>,
    document.body,
  );
}

const LONG_PRESS_MS = 500;

/**
 * Opens a radial menu from its trigger: right-click, a primary-button long
 * press (then `dragging` until released), or Shift+F10 / the Menu key. The
 * click that ends a long press is swallowed, so the trigger's own action
 * does not also run. Spread the returned handlers on the trigger.
 */
export function useRadialMenuTrigger(onOpen: (dragging: boolean) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallowClick = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      swallowClick.current = false;
      if (event.button !== 0) return;
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        swallowClick.current = true;
        onOpen(true);
      }, LONG_PRESS_MS);
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      // A touch long press also raises this; the timer already opened it.
      if (swallowClick.current) return;
      cancel();
      onOpen(false);
    },
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        onOpen(false);
      }
    },
  };
}

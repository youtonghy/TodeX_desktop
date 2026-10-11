import { useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx } from '@/utils/cx';

type Surface = 'primary' | 'secondary' | 'full';

/**
 * Internal vertical scroll region per the BoardUI rule: once scrolled, the
 * top edge softens under a progressive blur (24px at 1px, 16px at 4px) and a
 * fade from the enclosing surface, each layer's opacity ramping over the
 * first 24px. Pass `fadeBottom` to mirror it at the bottom edge. Keep headers
 * outside. `surface` must match the background the area sits on.
 */
export function ScrollArea({ children, className, contentClassName, surface = 'primary', fadeBottom = false, viewportRef, ...props }: {
  children: ReactNode;
  /** Classes on the relative wrapper (size it here, e.g. `flex-1` / `max-h-80`). */
  className?: string;
  /** Classes on the scrolling viewport (padding, gaps). */
  contentClassName?: string;
  surface?: Surface;
  fadeBottom?: boolean;
  viewportRef?: Ref<HTMLDivElement>;
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  const [top, setTop] = useState(0);
  const [bottom, setBottom] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(viewportRef, () => ref.current as HTMLDivElement, []);
  const update = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    setTop(Math.min(1, Math.max(0, element.scrollTop) / 24));
    if (fadeBottom) setBottom(Math.min(1, Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop) / 24));
  }, [fadeBottom]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = new ResizeObserver(update);
    resize.observe(element);
    const content = fadeBottom ? new MutationObserver(update) : null;
    content?.observe(element, { childList: true, subtree: true, characterData: true });
    const frame = requestAnimationFrame(update);
    return () => { resize.disconnect(); content?.disconnect(); cancelAnimationFrame(frame); };
  }, [fadeBottom, update]);
  const color = `var(--color-background-${surface === 'full' ? 'full' : `${surface}-default`})`;
  return (
    <div className={cx('relative min-h-0', className)}>
      <div
        {...props}
        ref={ref}
        onScroll={(event) => { update(); props.onScroll?.(event); }}
        className={cx('h-full max-h-[inherit] overflow-y-auto overscroll-contain', contentClassName)}
      >
        {children}
      </div>
      <Edge side="top" opacity={top} color={color} />
      {fadeBottom ? <Edge side="bottom" opacity={bottom} color={color} /> : null}
    </div>
  );
}

function Edge({ side, opacity, color }: { side: 'top' | 'bottom'; opacity: number; color: string }) {
  const mask = `linear-gradient(to ${side === 'top' ? 'bottom' : 'top'}, black, transparent)`;
  const anchor = side === 'top' ? 'top-0' : 'bottom-0';
  return (
    <div aria-hidden className={cx('pointer-events-none absolute inset-x-0 z-10', anchor)}>
      <div className={cx('absolute inset-x-0 h-6 backdrop-blur-[1px]', anchor)} style={{ opacity, maskImage: mask }} />
      <div className={cx('absolute inset-x-0 h-4 backdrop-blur-[4px]', anchor)} style={{ opacity, maskImage: mask }} />
      <div className={cx('absolute inset-x-0 h-6', anchor)} style={{ opacity, background: `linear-gradient(to ${side === 'top' ? 'bottom' : 'top'}, ${color}, transparent)` } as CSSProperties} />
    </div>
  );
}

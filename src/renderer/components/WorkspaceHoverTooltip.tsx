import { useEffect, useRef, useState } from 'react';
import type { ContextType, PointerEvent, ReactNode } from 'react';
import { TooltipTriggerStateContext } from 'react-aria-components';
import { Tooltip } from '@/components/base/tooltip/tooltip';

const OPEN_DELAY_MS = 500;

/**
 * One tooltip for a whole workspace list: hovering any row carrying
 * `data-workspace-id` opens it beside that row after a short delay, and
 * moving to the next row swaps it in place. Delegating from the wrapper keeps
 * the rows themselves (tree items, grid list items) untouched. Pressing,
 * scrolling or right-clicking closes it until the pointer reaches another row.
 */
export function WorkspaceHoverTooltip({
  disabled,
  renderContent,
  children,
}: {
  disabled?: boolean;
  renderContent: (workspaceId: string) => ReactNode;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const hoveredRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  // Keeps the content rendered while the tooltip animates out.
  const shownIdRef = useRef<string | null>(null);
  if (openId) shownIdRef.current = openId;

  const clearTimer = () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
  };
  const close = () => {
    clearTimer();
    setOpenId(null);
  };

  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => clearTimer, []);

  const onPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || disabled) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-workspace-id]');
    if (row === hoveredRef.current) return;
    hoveredRef.current = row;
    const id = row?.dataset.workspaceId;
    if (!row || !id) {
      close();
      return;
    }
    const show = () => {
      anchorRef.current = row;
      setOpenId(id);
    };
    clearTimer();
    // Already showing: follow the pointer from row to row without a delay.
    if (openId) show();
    else timerRef.current = window.setTimeout(show, OPEN_DELAY_MS);
  };

  // Supplied through context rather than `isOpen`: a standalone react-aria
  // Tooltip reads its open state from TooltipTriggerStateContext and throws
  // when there is none.
  const tooltipState: NonNullable<ContextType<typeof TooltipTriggerStateContext>> = {
    isOpen: Boolean(openId),
    open: () => {},
    close,
    shouldSkipAnimation: false,
  };

  const onPointerLeave = () => {
    hoveredRef.current = null;
    close();
  };

  return (
    <div onPointerOver={onPointerOver} onPointerLeave={onPointerLeave} onPointerDown={close} onWheel={close} onContextMenuCapture={close}>
      {children}
      <TooltipTriggerStateContext.Provider value={tooltipState}>
        <Tooltip triggerRef={anchorRef} placement="right" className="max-w-xs">
          {shownIdRef.current ? renderContent(shownIdRef.current) : null}
        </Tooltip>
      </TooltipTriggerStateContext.Provider>
    </div>
  );
}

import { createContext, useCallback, useContext, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  type GroupImperativeHandle,
  type Layout,
  type LayoutStorage,
  type PanelImperativeHandle,
  type PanelProps,
  type PanelSize,
} from 'react-resizable-panels';
import { useT } from '@/i18n';
import { cx } from '@/utils/cx';

export type { PanelImperativeHandle, GroupImperativeHandle };

/**
 * Resizable panel groups (react-resizable-panels) with the BoardUI drag
 * handle from the AI chat shell: an invisible hit strip on the seam whose
 * 15×25 grip pill (three hairlines) shows on hover and while dragging.
 */

type Orientation = 'horizontal' | 'vertical';
type Size = number | string;

const OrientationContext = createContext<Orientation>('horizontal');

const memoryStorage: LayoutStorage = { getItem: () => null, setItem: () => {} };
const localStorageLayout: LayoutStorage = {
  getItem: (key) => {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  setItem: (key, value) => {
    try { window.localStorage.setItem(key, value); } catch { /* quota or privacy mode */ }
  },
};

function toSize(size: Size | undefined): string | undefined {
  if (size == null) return undefined;
  return typeof size === 'number' ? `${size}%` : size;
}

function Root({ autoSaveId, children, className, handleRef, id, onLayoutChange, orientation = 'horizontal', style }: {
  /** Persists panel sizes in localStorage under this id. */
  autoSaveId?: string;
  children: ReactNode;
  className?: string;
  handleRef?: Ref<GroupImperativeHandle>;
  id?: string;
  onLayoutChange?: (layout: Layout) => void;
  orientation?: Orientation;
  style?: CSSProperties;
}) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: autoSaveId || '__no_persist__',
    storage: autoSaveId ? localStorageLayout : memoryStorage,
  });
  return (
    <OrientationContext.Provider value={orientation}>
      <Group
        className={cx('flex size-full', orientation === 'vertical' && 'flex-col', className)}
        defaultLayout={autoSaveId ? defaultLayout : undefined}
        groupRef={handleRef}
        id={id}
        orientation={orientation}
        style={style}
        onLayoutChange={onLayoutChange}
        onLayoutChanged={autoSaveId ? onLayoutChanged : undefined}
      >
        {children}
      </Group>
    </OrientationContext.Provider>
  );
}

function ResizablePanel({ children, className, collapsedSize, collapsible, defaultSize, groupResizeBehavior, handleRef, id, maxSize, minSize, onCollapse, onExpand, onResize, style }: {
  children?: ReactNode;
  className?: string;
  collapsedSize?: Size;
  collapsible?: boolean;
  defaultSize?: Size;
  groupResizeBehavior?: PanelProps['groupResizeBehavior'];
  handleRef?: Ref<PanelImperativeHandle>;
  id?: string;
  maxSize?: Size;
  minSize?: Size;
  onCollapse?: () => void;
  onExpand?: () => void;
  onResize?: (size: PanelSize, id: string | number | undefined, previous: PanelSize | undefined) => void;
  style?: CSSProperties;
}) {
  const panel = useRef<PanelImperativeHandle | null>(null);
  const wasCollapsed = useRef<boolean | undefined>(undefined);
  const setRef = useCallback((handle: PanelImperativeHandle | null) => {
    panel.current = handle;
    if (typeof handleRef === 'function') handleRef(handle);
    else if (handleRef) (handleRef as { current: PanelImperativeHandle | null }).current = handle;
  }, [handleRef]);
  const tracks = Boolean(collapsible && (onCollapse || onExpand));
  const resize = useCallback((size: PanelSize, panelId: string | number | undefined, previous: PanelSize | undefined) => {
    if (tracks && panel.current) {
      const collapsed = panel.current.isCollapsed();
      if (wasCollapsed.current !== undefined) {
        if (collapsed && !wasCollapsed.current) onCollapse?.();
        else if (!collapsed && wasCollapsed.current) onExpand?.();
      }
      wasCollapsed.current = collapsed;
    }
    onResize?.(size, panelId, previous);
  }, [tracks, onCollapse, onExpand, onResize]);
  return (
    <Panel
      className={cx('min-h-0 min-w-0', className)}
      collapsedSize={toSize(collapsedSize)}
      collapsible={collapsible}
      defaultSize={toSize(defaultSize)}
      groupResizeBehavior={groupResizeBehavior}
      id={id}
      maxSize={toSize(maxSize)}
      minSize={toSize(minSize)}
      panelRef={tracks ? setRef : handleRef}
      style={style}
      onResize={tracks ? resize : onResize}
    >
      {children}
    </Panel>
  );
}

function Handle({ 'aria-label': ariaLabel, className, disabled, id }: { 'aria-label'?: string; className?: string; disabled?: boolean; id?: string }) {
  const t = useT();
  const orientation = useContext(OrientationContext);
  const horizontal = orientation === 'horizontal';
  return (
    <Separator
      aria-label={ariaLabel ?? t('common.resizePanels')}
      disabled={disabled}
      id={id}
      className={cx(
        'group/resize relative z-10 flex shrink-0 items-center justify-center outline-none',
        horizontal ? 'w-3 cursor-col-resize' : 'h-3 cursor-row-resize',
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          'flex items-center justify-center gap-0.5 rounded-sm border border-border-button-default bg-background-primary-default shadow-xs',
          'opacity-0 transition-opacity duration-150 ease',
          'group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100 group-data-[separator=active]/resize:opacity-100',
          horizontal ? 'h-[25px] w-[15px]' : 'h-[15px] w-[25px] flex-col',
        )}
      >
        {[0, 1, 2].map((line) => (
          <span key={line} className={cx('bg-foreground-icon-quaternary', horizontal ? 'h-[13px] w-px' : 'h-px w-[13px]')} />
        ))}
      </span>
    </Separator>
  );
}

export const Resizable = Object.assign(Root, { Panel: ResizablePanel, Handle });

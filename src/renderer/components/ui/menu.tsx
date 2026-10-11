import { useEffect, useRef, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import {
  Header,
  Menu as AriaMenu,
  MenuContext,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger as AriaMenuTrigger,
  Popover as AriaPopover,
  Separator as AriaSeparator,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
} from 'react-aria-components';
import { RiCheckLine } from '@remixicon/react';
import { MENU_POPOVER_SURFACE } from '@/components/base/dropdown/menu-styles';
import { useDirection } from '@/components/foundations/direction/direction';
import { cx } from '@/utils/cx';

/**
 * Action menus with real menu semantics (arrow keys, typeahead, Escape) in
 * the BoardUI menu recipe from `menu-styles`: the shared popover surface,
 * rounded-2lg rows that take the dropdown hover background, body-medium
 * labels, muted section headers. The trigger is any pressable element:
 * wrap a BoardUI `Button` in react-aria's `Pressable`.
 *
 *   <MenuTrigger>
 *     <Pressable><Button variant="secondary">Open</Button></Pressable>
 *     <MenuPopover>
 *       <Menu aria-label="Actions" onAction={run}>
 *         <MenuItem id="rename" icon={RiPencilLine}>Rename</MenuItem>
 *         <MenuSeparator />
 *         <MenuItem id="delete" icon={RiDeleteBinLine} tone="danger">Delete</MenuItem>
 *       </Menu>
 *     </MenuPopover>
 *   </MenuTrigger>
 */

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

export const MenuTrigger = AriaMenuTrigger;

export interface MenuPopoverProps extends Omit<ComponentProps<typeof AriaPopover>, 'className' | 'children'> {
  className?: string;
  children: ReactNode;
}

export function MenuPopover({ className, children, placement = 'bottom start', offset = 4, ...props }: MenuPopoverProps) {
  const direction = useDirection();
  return (
    <AriaPopover
      dir={direction}
      placement={placement}
      offset={offset}
      {...props}
      className={cx('min-w-48 max-w-[min(20rem,calc(100vw-32px))]', MENU_POPOVER_SURFACE, 'p-1.5', className)}
    >
      {children}
    </AriaPopover>
  );
}

export function Menu<T extends object>({ className, ...props }: Omit<AriaMenuProps<T>, 'className'> & { className?: string }) {
  return <AriaMenu {...props} className={cx('flex w-full flex-col gap-0.5 outline-none', className)} />;
}

export interface MenuItemProps extends Omit<AriaMenuItemProps, 'className' | 'children'> {
  className?: string;
  /** Leading 18px glyph (component reference, e.g. `RiPencilLine`). */
  icon?: IconComponent;
  /** `danger` paints destructive actions red. */
  tone?: 'default' | 'danger';
  /** Muted trailing text, e.g. a shortcut or count. */
  trailing?: ReactNode;
  /** Muted second line under the label. */
  description?: ReactNode;
  children?: ReactNode;
}

export function MenuItem({ className, icon: Icon, tone = 'default', trailing, description, children, ...props }: MenuItemProps) {
  const danger = tone === 'danger';
  return (
    <AriaMenuItem
      {...props}
      className={(state) => cx(
        'flex w-full cursor-pointer items-center gap-2 rounded-2lg px-2 py-1.5 text-start text-body-medium outline-none',
        'transition-colors duration-150 ease',
        danger ? 'text-text-error-primary' : 'text-text-primary',
        (state.isFocused || state.isHovered) && 'bg-dropdown-item-hover-background',
        state.isDisabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {(state) => (
        <>
          {Icon ? <Icon aria-hidden className={cx('size-[18px] shrink-0', danger ? 'text-foreground-icon-error' : 'text-foreground-icon-secondary')} /> : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{children}</span>
            {description ? <span className="truncate text-caption-1-regular text-text-secondary">{description}</span> : null}
          </span>
          {trailing ? <span className="shrink-0 text-caption-1-medium text-text-tertiary">{trailing}</span> : null}
          {state.selectionMode !== 'none' && state.isSelected ? (
            <RiCheckLine aria-hidden className="size-4 shrink-0 text-foreground-icon-primary" />
          ) : null}
        </>
      )}
    </AriaMenuItem>
  );
}

export function MenuSection<T extends object>({ title, className, children, ...props }: Omit<ComponentProps<typeof AriaMenuSection<T>>, 'className' | 'children'> & { title?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <AriaMenuSection {...props} className={cx('flex flex-col gap-0.5', className)}>
      {title ? <Header className="px-2 pt-1 pb-0.5 text-caption-1-medium text-text-tertiary">{title}</Header> : null}
      {children}
    </AriaMenuSection>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <AriaSeparator className={cx('-mx-1.5 my-1 h-px shrink-0 bg-separator-border', className)} />;
}

export interface ContextMenuProps {
  /** Viewport point the menu opens at; null keeps it closed. */
  position: { x: number; y: number } | null;
  onClose: () => void;
  className?: string;
  /** A `<Menu>` with its items; choosing one closes the menu. */
  children: ReactNode;
}

/**
 * A menu opened at the pointer (right-click). The popover anchors to an
 * invisible fixed point at `position`, so it flips and shifts at the window
 * edges like any other BoardUI popover.
 */
export function ContextMenu({ position, onClose, className, children }: ContextMenuProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const last = useRef(position);
  if (position) last.current = position;
  const point = position ?? last.current;
  useEffect(() => {
    if (!position) return;
    const close = () => onClose();
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [position, onClose]);
  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden
        className="pointer-events-none fixed size-0"
        style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
      />
      <MenuPopover
        triggerRef={anchorRef}
        isOpen={Boolean(position)}
        onOpenChange={(open) => { if (!open) onClose(); }}
        placement="bottom start"
        offset={2}
        className={className}
      >
        {/* Menus close the popover themselves after an action. */}
        <MenuContext.Provider value={{ onClose, autoFocus: 'first' }}>{children}</MenuContext.Provider>
      </MenuPopover>
    </>
  );
}

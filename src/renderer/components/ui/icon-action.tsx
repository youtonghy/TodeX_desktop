import type { ButtonHTMLAttributes, ComponentType, Ref } from 'react';
import { Focusable } from 'react-aria-components';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { cx } from '@/utils/cx';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

const SIZES = {
  xs: { box: 'size-6 rounded-md', icon: 'size-3.5' },
  sm: { box: 'size-7 rounded-lg', icon: 'size-4' },
  md: { box: 'size-8 rounded-lg', icon: 'size-[18px]' },
} as const;

export interface IconActionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconComponent;
  'aria-label': string;
  size?: keyof typeof SIZES;
  /** Pressed/selected look (e.g. the panel it toggles is open). */
  active?: boolean;
  /** Tooltip copy; defaults to none. Pass `true` to reuse the aria-label. */
  tooltip?: string | boolean;
  tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right';
  iconClassName?: string;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Borderless icon action for headers, toolbars and rows: the glyph-only
 * buttons of the BoardUI chat header (secondary icon color, a soft hover
 * fill, primary icon on hover), with an optional BoardUI tooltip.
 */
export function IconAction({ icon: Icon, size = 'md', active, tooltip, tooltipPlacement = 'bottom', iconClassName, className, type = 'button', ref, ...props }: IconActionProps) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-pressed={active === undefined ? undefined : active}
      {...props}
      className={cx(
        'group relative inline-flex shrink-0 cursor-pointer items-center justify-center',
        'text-foreground-icon-secondary transition-colors duration-150 ease',
        'hover:bg-background-secondary-hover hover:text-foreground-icon-primary',
        'active:bg-background-tertiary-default',
        'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
        active && 'bg-background-secondary-hover text-foreground-icon-primary',
        SIZES[size].box,
        className,
      )}
    >
      <Icon aria-hidden className={cx(SIZES[size].icon, iconClassName)} />
    </button>
  );
  if (!tooltip) return button;
  return (
    <TooltipTrigger delay={200}>
      <Focusable>{button}</Focusable>
      <Tooltip placement={tooltipPlacement}>{tooltip === true ? props['aria-label'] : tooltip}</Tooltip>
    </TooltipTrigger>
  );
}

import type { ComponentType, ReactNode } from 'react';
import { RiCheckLine, RiFileCopyLine } from '@remixicon/react';
import { Focusable } from 'react-aria-components';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { cx } from '@/utils/cx';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/**
 * The 28px action under an assistant turn (BoardUI AI chat FeedbackButton):
 * a tertiary square whose glyph deepens on hover, named by a tooltip.
 * `disabled` keeps the button hoverable so its tooltip can explain why.
 */
export function FeedbackButton({
  icon: Icon,
  label,
  tooltip,
  isTooltipOpen,
  onTooltipOpenChange,
  onPress,
  disabled = false,
  children,
}: {
  icon?: IconComponent;
  label: string;
  /** Tooltip content when it differs from the accessible name. */
  tooltip?: ReactNode;
  isTooltipOpen?: boolean;
  onTooltipOpenChange?: (open: boolean) => void;
  onPress?: () => void;
  disabled?: boolean;
  /** Custom glyph (e.g. the copy → check crossfade); wins over `icon`. */
  children?: ReactNode;
}) {
  return (
    <TooltipTrigger delay={200} isOpen={isTooltipOpen} onOpenChange={onTooltipOpenChange}>
      <Focusable>
        <button
          type="button"
          aria-label={label}
          aria-disabled={disabled || undefined}
          onClick={disabled ? undefined : onPress}
          className={cx(
            'group flex items-center rounded-lg bg-background-tertiary-default p-1.5 outline-none',
            'transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-background-secondary-hover',
          )}
        >
          {children ?? (Icon ? (
            <Icon
              aria-hidden
              className={cx(
                'size-4 text-foreground-icon-secondary transition-colors duration-150 ease',
                !disabled && 'group-hover:text-foreground-icon-primary',
              )}
            />
          ) : null)}
        </button>
      </Focusable>
      <Tooltip size="sm">{tooltip ?? label}</Tooltip>
    </TooltipTrigger>
  );
}

/** Copy → check crossfade: each glyph blurs, scales and fades as it flips. */
export function CopyGlyph({ copied }: { copied: boolean }) {
  const glyph = 'absolute size-4 text-foreground-icon-secondary transition-all duration-200 ease-out group-hover:text-foreground-icon-primary';
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <RiFileCopyLine aria-hidden className={cx(glyph, copied ? 'scale-75 opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-0')} />
      <RiCheckLine aria-hidden className={cx(glyph, copied ? 'scale-100 opacity-100 blur-0' : 'scale-75 opacity-0 blur-[2px]')} />
    </span>
  );
}

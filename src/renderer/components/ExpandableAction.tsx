import type { ButtonHTMLAttributes, ComponentType } from 'react';
import { cx } from '@/utils/cx';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

const EXPANDABLE_TONES = {
  secondary: 'border-border-button-default bg-background-primary-default text-text-primary shadow-xs enabled:hover:border-border-button-hover enabled:hover:bg-background-primary-hover enabled:active:bg-background-primary-active',
  primary: 'border-transparent bg-accent-500 text-text-white shadow-xs enabled:hover:bg-accent-600 enabled:active:bg-accent-700',
  danger: 'border-transparent bg-background-tertiary-error text-text-error-primary enabled:hover:bg-background-quaternary-error enabled:active:bg-background-quaternary-error',
} as const;

/** Toolbar pill that shows its icon and slides its label open on hover or
 * keyboard focus. */
export function ExpandableAction({ icon: Icon, label, tone = 'secondary', iconClassName, className, type = 'button', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconComponent;
  label: string;
  tone?: keyof typeof EXPANDABLE_TONES;
  iconClassName?: string;
}) {
  return (
    <button
      type={type}
      {...props}
      className={cx(
        'group/expand inline-flex h-8 shrink-0 cursor-pointer items-center overflow-hidden rounded-full border',
        'outline-none transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        EXPANDABLE_TONES[tone],
        className,
      )}
    >
      <span className="inline-flex size-[30px] shrink-0 items-center justify-center">
        <Icon aria-hidden className={cx('size-4', iconClassName)} />
      </span>
      <span
        className={cx(
          'max-w-0 overflow-hidden whitespace-nowrap text-caption-1-medium opacity-0',
          'transition-[max-width,opacity,padding] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
          'group-hover/expand:max-w-24 group-hover/expand:pe-2.5 group-hover/expand:opacity-100',
          'group-focus-visible/expand:max-w-24 group-focus-visible/expand:pe-2.5 group-focus-visible/expand:opacity-100',
        )}
      >
        {label}
      </span>
    </button>
  );
}

import { RiLoader4Line } from '@remixicon/react';
import { cx } from '@/utils/cx';

const SIZES = { xs: 'size-3.5', sm: 'size-4', md: 'size-5', lg: 'size-6' } as const;

/** Indeterminate busy glyph; inherits the surrounding icon color. */
export function Spinner({ size = 'sm', className, 'aria-label': ariaLabel }: { size?: keyof typeof SIZES; className?: string; 'aria-label'?: string }) {
  return (
    <RiLoader4Line
      role={ariaLabel ? 'status' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cx('shrink-0 animate-spin text-foreground-icon-secondary motion-reduce:animate-none', SIZES[size], className)}
    />
  );
}

/** Spinner as an icon component, for slots that take a component reference
 *  (`<Button leadingIcon={isPending ? SpinnerIcon : RiSaveLine}>`). */
export function SpinnerIcon({ className, ...props }: { className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }) {
  return <RiLoader4Line {...props} className={cx('animate-spin motion-reduce:animate-none', className)} />;
}

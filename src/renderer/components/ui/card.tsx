import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '@/utils/cx';

/**
 * BoardUI panel: radius/3xl, 1px border/button/default on the primary
 * surface. `variant="secondary"` is the grouped settings card (secondary
 * fill, no border) used inside dialogs and panels that already sit on white.
 */
export function Card({ variant = 'primary', className, ...props }: HTMLAttributes<HTMLDivElement> & { variant?: 'primary' | 'secondary' }) {
  return (
    <div
      {...props}
      className={cx(
        'flex flex-col gap-3 p-4',
        variant === 'primary'
          ? 'rounded-3xl border border-border-button-default bg-background-primary-default shadow-card'
          : 'rounded-2xl bg-background-secondary-default',
        className,
      )}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx('flex min-w-0 flex-col gap-0.5', className)} />;
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h3 className={cx('text-headline-medium text-text-primary', className)}>{children}</h3>;
}

export function CardDescription({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cx('text-body-regular text-text-secondary', className)}>{children}</p>;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx('flex min-w-0 flex-col gap-3', className)} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx('flex flex-wrap items-center gap-2', className)} />;
}

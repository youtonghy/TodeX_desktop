import type { ComponentType, ReactNode } from 'react';
import { cx } from '@/utils/cx';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/** Centered placeholder: tinted icon disc, headline, muted copy, actions. */
export function EmptyState({ icon: Icon, title, description, children, className, size = 'md' }: {
  icon?: IconComponent;
  title: ReactNode;
  description?: ReactNode;
  /** Actions under the copy. */
  children?: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 text-center', size === 'md' ? 'p-8' : 'p-4', className)}>
      {Icon ? (
        <span className={cx('flex items-center justify-center rounded-full bg-background-tertiary-default', size === 'md' ? 'size-12' : 'size-10')}>
          <Icon aria-hidden className={cx('text-foreground-icon-secondary', size === 'md' ? 'size-6' : 'size-5')} />
        </span>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1">
        <p className={cx('text-text-primary', size === 'md' ? 'text-headline-medium' : 'text-body-medium')}>{title}</p>
        {description ? <p className="text-body-regular text-text-secondary">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  );
}

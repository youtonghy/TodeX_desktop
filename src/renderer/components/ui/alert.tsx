import type { ComponentType, ReactNode } from 'react';
import { RiAlertFill, RiCheckboxCircleFill, RiErrorWarningFill, RiInformationFill } from '@remixicon/react';
import { cx, sortCx } from '@/utils/cx';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

export type AlertStatus = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const ICONS: Record<AlertStatus, IconComponent> = {
  info: RiInformationFill,
  success: RiCheckboxCircleFill,
  warning: RiAlertFill,
  danger: RiErrorWarningFill,
  neutral: RiInformationFill,
};

const styles = sortCx({
  visual: {
    info: 'bg-notification-information-background text-notification-information-foreground',
    success: 'bg-notification-success-background text-notification-success-foreground',
    warning: 'bg-status-yellow-background text-status-yellow-text',
    danger: 'bg-notification-error-background text-notification-error-foreground',
    neutral: 'bg-background-tertiary-default text-text-secondary',
  },
});

/**
 * Inline callout in the BoardUI notification-card recipe (tinted status
 * disc, body-medium title, muted description), sitting flat in the layout.
 */
export function Alert({ status = 'info', title, description, icon, actions, className, children }: {
  status?: AlertStatus;
  title?: ReactNode;
  description?: ReactNode;
  icon?: IconComponent;
  /** Trailing actions (small buttons). */
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const Icon = icon ?? ICONS[status];
  return (
    <div
      role={status === 'danger' ? 'alert' : 'status'}
      className={cx('flex w-full items-start gap-3 rounded-2xl border border-border-button-default bg-background-primary-default p-3', className)}
    >
      <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-full', styles.visual[status])}>
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 self-center">
        {title ? <p className="text-body-medium text-text-primary">{title}</p> : null}
        {description ? <div className="text-body-regular text-text-secondary">{description}</div> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 self-center">{actions}</div> : null}
    </div>
  );
}

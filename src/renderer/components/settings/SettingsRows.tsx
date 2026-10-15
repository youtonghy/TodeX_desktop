import type { ComponentType, ElementType, ReactNode, Ref } from 'react';
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react';
import { cx } from '@/utils/cx';
import { useT } from '../../i18n';
import { IconAction } from '../ui/icon-action';

/**
 * Row chrome for the settings pages, after the BoardUI settings modal
 * (application/settings/settings-rows):
 *   card   bg background/secondary, radius/2xl, ps-3: each row's bottom
 *          hairline stops 12px short of the card's left edge.
 *   row    py-2.5 pe-2.5, min-height 52, hairline under every row but the
 *          last; label + description on the left, the control on the right.
 */

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/** The divider/padding part of a row, for custom rows (list items, blocks). */
export const SETTINGS_ROW = 'w-full border-b border-separator-border py-2.5 pe-2.5 last:border-b-0';

/** Grouped card; rows divide themselves. */
export function SettingsCard({ className, children, ref }: { className?: string; children: ReactNode; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx('flex w-full flex-col rounded-2xl bg-background-secondary-default ps-3', className)}>
      {children}
    </div>
  );
}

/** Muted heading above a card. */
export function SettingsSectionLabel({ className, children, as: Component = 'h3' }: { className?: string; children: ReactNode; as?: ElementType }) {
  return <Component className={cx('w-full text-body-2-medium text-text-secondary', className)}>{children}</Component>;
}

/** A card (or several) under a muted heading, with an optional hint and trailing action. */
export function SettingsGroup({ label, description, action, as, className, children }: {
  label?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx('flex w-full flex-col gap-2', className)}>
      {label || description || action ? (
        <div className="flex items-end justify-between gap-3 px-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {label ? <SettingsSectionLabel as={as}>{label}</SettingsSectionLabel> : null}
            {description ? <p className="text-body-2-regular text-text-secondary">{description}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** One label + control row. */
export function SettingsRow({ label, description, icon: Icon, children, align = 'center', className }: {
  label?: ReactNode;
  description?: ReactNode;
  icon?: IconComponent;
  children?: ReactNode;
  /** `start` pins the control to the first line of a long description. */
  align?: 'center' | 'start';
  className?: string;
}) {
  return (
    <div className={cx('flex min-h-[52px] justify-between gap-4', align === 'start' ? 'items-start' : 'items-center', SETTINGS_ROW, className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {Icon ? <Icon aria-hidden className="size-5 shrink-0 text-foreground-icon-secondary" /> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          {label != null ? <div className="text-body-regular text-text-primary">{label}</div> : null}
          {description != null ? <div className="text-body-2-regular text-text-secondary">{description}</div> : null}
        </div>
      </div>
      {children != null ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

const NOTE_TONES = {
  muted: 'text-text-secondary',
  warning: 'text-status-yellow-text',
  danger: 'text-text-error-primary',
} as const;

/** A full-width line or block inside a card (status text, progress, a form). */
export function SettingsNote({ tone = 'muted', role, className, children }: {
  tone?: keyof typeof NOTE_TONES;
  role?: string;
  className?: string;
  children: ReactNode;
}) {
  return <div role={role} className={cx(SETTINGS_ROW, 'text-body-2-regular', NOTE_TONES[tone], className)}>{children}</div>;
}

/** The grey read-only value field. `wrap` lets long values (fingerprints) break instead of truncating. */
export function SettingsValueField({ icon: Icon, children, muted = false, mono = false, wrap = false, title, className }: {
  icon?: IconComponent;
  children: ReactNode;
  muted?: boolean;
  mono?: boolean;
  wrap?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <div
      title={title}
      className={cx(
        'flex min-h-8 w-[202px] shrink-0 items-center gap-0.5 rounded-2lg bg-background-tertiary-default px-1.5',
        wrap && 'py-1.5',
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className="size-5 shrink-0 text-foreground-icon-secondary" /> : null}
      <span
        className={cx(
          'min-w-0 ps-1',
          mono ? 'font-mono text-body-2-regular' : 'text-body-regular',
          wrap ? 'break-all' : 'truncate',
          muted ? 'text-text-secondary' : 'text-text-primary',
        )}
      >
        {children}
      </span>
    </div>
  );
}

/** A card row that opens its own settings page (shown in place of the
 * overview); `leading` is an icon or any small element. */
export function SettingsEntry({ icon: Icon, leading, title, description, trailing, isDisabled = false, onPress, ...data }: {
  icon?: IconComponent;
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  isDisabled?: boolean;
  onPress: () => void;
} & { [key: `data-${string}`]: string }) {
  return (
    <button
      type="button"
      {...data}
      disabled={isDisabled}
      onClick={onPress}
      className={cx(
        'group flex w-full cursor-pointer items-center gap-3 ps-3 text-start',
        'outline-none transition-colors duration-150 ease hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring',
        'disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
      )}
    >
      {Icon ? <Icon aria-hidden className="size-5 shrink-0 text-foreground-icon-secondary" /> : leading}
      <span className="flex min-h-[52px] min-w-0 flex-1 items-center gap-4 border-b border-separator-border py-2.5 pe-2.5 group-last:border-b-0">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-regular text-text-primary">{title}</span>
          {description != null ? <span className="truncate text-body-2-regular text-text-secondary">{description}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {trailing}
          <RiArrowRightSLine className="size-4 text-foreground-icon-tertiary rtl:-scale-x-100" aria-hidden />
        </span>
      </span>
    </button>
  );
}

/** A settings page shown in place of its overview, with a back button. */
export function SettingsSubpage({ title, description, onBack, children }: {
  title: ReactNode;
  description?: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2">
        <IconAction icon={RiArrowLeftSLine} size="sm" className="-ms-1.5 shrink-0" iconClassName="size-5 rtl:-scale-x-100" aria-label={t('settings.back')} onClick={onBack} />
        <div className="min-w-0 pt-0.5">
          <h3 className="text-headline-medium text-text-primary">{title}</h3>
          {description ? <p className="mt-1 text-body-regular text-text-secondary">{description}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

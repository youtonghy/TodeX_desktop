import type { ComponentProps, ReactNode } from 'react';
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react';
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover as AriaPopover,
  Select as AriaSelect,
} from 'react-aria-components';
import { cx } from '@/utils/cx';

/**
 * Controls on the composer's second row, in the BoardUI composer-panel
 * recipe: pills that only paint their surface on hover, press or while their
 * menu is open, opening an upward panel. The `composer-control*` classes in
 * global.css let a pill rest icon-only and reveal its label on hover/focus
 * once the toolbar is wide enough (a container query).
 */

export const COMPOSER_CONTROL = cx(
  'composer-control cursor-pointer rounded-full text-body-medium text-text-secondary outline-none',
  'transition-colors duration-150 ease',
  'data-[hovered]:bg-background-primary-hover data-[pressed]:bg-background-primary-active aria-expanded:bg-background-primary-hover',
  'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring',
  'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
);

export const COMPOSER_CONTROL_ICON = 'composer-control__icon text-foreground-icon-secondary';

/** The upward panel shared by the composer menus (PermissionMenu recipe). */
export const COMPOSER_POPOVER = cx(
  'max-w-[calc(100vw-32px)] rounded-[20px] border border-border-button-default bg-background-primary-default shadow-dropdown outline-none',
  'transition duration-150 ease-out',
  'data-[entering]:scale-95 data-[entering]:opacity-0 data-[entering]:blur-[2px]',
  'data-[exiting]:scale-95 data-[exiting]:opacity-0 data-[exiting]:blur-[2px]',
  'data-[placement=bottom]:origin-top-left data-[placement=top]:origin-bottom-left rtl:data-[placement=bottom]:origin-top-right rtl:data-[placement=top]:origin-bottom-right',
);

export function ComposerControlIndicator() {
  return <RiArrowDownSLine aria-hidden className="composer-control__indicator text-foreground-icon-tertiary" />;
}

export interface ComposerSelectOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

/**
 * Pick-one composer control (agent, permission, work mode): a pill trigger
 * and a listbox panel with the menu's name and an optional hint on top.
 */
export function ComposerSelect({
  label,
  hint,
  icon,
  text,
  textTitle,
  selectedKey,
  options,
  onChange,
  isDisabled,
  showIndicator = true,
}: {
  /** Accessible name and the panel heading. */
  label: string;
  /** Muted line under the heading. */
  hint?: string;
  icon: ReactNode;
  text: ReactNode;
  textTitle?: string;
  selectedKey: string | null;
  options: ComposerSelectOption[];
  onChange: (key: string) => void;
  isDisabled?: boolean;
  showIndicator?: boolean;
}) {
  return (
    <AriaSelect
      aria-label={label}
      selectedKey={selectedKey}
      isDisabled={isDisabled}
      onSelectionChange={(key) => { if (key !== null) onChange(String(key)); }}
      className="flex shrink-0"
    >
      <AriaButton className={COMPOSER_CONTROL}>
        {icon}
        <span className="composer-control__text" title={textTitle}>{text}</span>
        {showIndicator ? <ComposerControlIndicator /> : null}
      </AriaButton>
      <AriaPopover placement="top start" offset={8} className={cx(COMPOSER_POPOVER, 'w-72 p-1.5')}>
        <div className="flex flex-col gap-1.5 pt-1">
          <div className="flex flex-col gap-0.5 px-2">
            <span className="text-body-medium text-text-tertiary">{label}</span>
            {hint ? <span className="text-caption-1-regular text-text-tertiary">{hint}</span> : null}
          </div>
          <AriaListBox aria-label={label} className="flex max-h-72 flex-col gap-1 overflow-y-auto outline-none">
            {options.map((option) => (
              <AriaListBoxItem
                key={option.id}
                id={option.id}
                textValue={option.label}
                className={({ isFocused, isHovered, isSelected, isDisabled: disabled }) => cx(
                  'flex w-full cursor-pointer items-center gap-2 rounded-[14px] p-2 text-start outline-none transition-colors duration-150 ease',
                  (isFocused || isHovered || isSelected) && 'bg-background-primary-hover',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                {({ isSelected }) => (
                  <>
                    {option.icon}
                    <span className={cx('min-w-0 flex-1 truncate text-body-medium', isSelected ? 'text-text-primary' : 'text-text-secondary')}>
                      {option.label}
                    </span>
                    {isSelected ? <RiCheckLine aria-hidden className="size-4 shrink-0 text-foreground-icon-primary" /> : null}
                  </>
                )}
              </AriaListBoxItem>
            ))}
          </AriaListBox>
        </div>
      </AriaPopover>
    </AriaSelect>
  );
}

/** A composer pill that opens a free-form panel (the model card). */
export function ComposerPopover({
  label,
  dialogLabel,
  trigger,
  triggerClassName,
  isDisabled,
  popoverClassName,
  children,
  ...buttonProps
}: Omit<ComponentProps<typeof AriaButton>, 'children' | 'className'> & {
  /** Accessible name of the trigger (and of the panel unless `dialogLabel` is set). */
  label: string;
  dialogLabel?: string;
  trigger: ReactNode;
  triggerClassName?: string;
  popoverClassName?: string;
  children: ReactNode;
}) {
  return (
    <AriaDialogTrigger>
      <AriaButton {...buttonProps} aria-label={label} isDisabled={isDisabled} className={cx(COMPOSER_CONTROL, triggerClassName)}>
        {trigger}
      </AriaButton>
      <AriaPopover placement="top start" offset={8} className={cx(COMPOSER_POPOVER, 'overflow-hidden', popoverClassName)}>
        <AriaDialog aria-label={dialogLabel ?? label} className="outline-none">
          {children}
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}

const ROUND_BUTTON = cx(
  'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none',
  'focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed',
);

/** Send, in the composer-panel recipe: the round primary button. */
export function ComposerSendButton({ className, children, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className={cx(ROUND_BUTTON, 'bg-button-primary p-2 text-text-white transition-opacity duration-200 ease disabled:opacity-40', className)}
    >
      {children}
    </button>
  );
}

/** Secondary round action next to send (stop), in the mic-button recipe. */
export function ComposerRoundButton({ className, children, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        ROUND_BUTTON,
        'border border-border-button-default bg-background-primary-default p-2 text-foreground-icon-primary shadow-xs',
        'transition-colors duration-150 ease hover:bg-background-primary-hover active:bg-background-primary-active disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

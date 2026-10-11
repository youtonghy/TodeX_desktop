import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  ComboBox as AriaComboBox,
  Group,
  Input as AriaInput,
  ListBox,
  ListBoxItem,
  Popover,
  type ComboBoxProps as AriaComboBoxProps,
  type ListBoxItemProps,
} from 'react-aria-components';
import { HintText } from '@/components/base/input/hint-text';
import { Label } from '@/components/base/input/label';
import { MENU_ITEM, MENU_ITEM_ACTIVE, MENU_ITEMS_CONTAINER, MENU_POPOVER_SURFACE } from '@/components/base/dropdown/menu-styles';
import { ChevronDownSmall } from '@/components/foundations/icons/chevrons';
import { cx } from '@/utils/cx';

/**
 * Searchable select: the BoardUI Input field shell (tertiary fill, inset
 * ring on hover/focus) with the Select listbox popover below it.
 */
export interface ComboBoxProps<T extends object> extends Omit<AriaComboBoxProps<T>, 'children' | 'className'> {
  label?: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  className?: string;
  popoverClassName?: string;
  children: ReactNode | ((item: T) => ReactNode);
}

export function ComboBox<T extends object>({ label, hint, placeholder, className, popoverClassName, children, ...props }: ComboBoxProps<T>) {
  return (
    <AriaComboBox {...props} className={cx('group flex w-full flex-col gap-1', className)}>
      {({ isRequired, isInvalid, isOpen }) => (
        <>
          {label ? <Label isRequired={isRequired} isInvalid={isInvalid}>{label}</Label> : null}
          <Group
            className={({ isFocusWithin, isHovered, isDisabled }) => cx(
              'relative flex w-full items-center gap-2 rounded-2lg bg-background-tertiary-default p-2 ring-2 ring-inset ring-transparent',
              'transition-[background-color,box-shadow,color] duration-[var(--input-transition-ms)] ease',
              isHovered && !isFocusWithin && !isDisabled && 'ring-border-button-hover',
              isFocusWithin && !isDisabled && 'ring-border-button-active',
              isDisabled && 'bg-input-disabled-background',
              isInvalid && 'bg-background-tertiary-error',
            )}
          >
            <AriaInput
              placeholder={placeholder}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 ps-1 text-body-regular text-text-primary outline-none placeholder:text-text-tertiary disabled:cursor-not-allowed disabled:text-input-disabled-text"
            />
            <AriaButton className="flex shrink-0 cursor-pointer items-center rounded-md text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
              <ChevronDownSmall className={cx('size-4 transition-transform duration-200 ease', isOpen && 'rotate-180')} />
            </AriaButton>
          </Group>
          {hint ? <HintText isInvalid={isInvalid}>{hint}</HintText> : null}
          <Popover offset={4} className={cx('w-(--trigger-width) min-w-48', MENU_POPOVER_SURFACE, 'p-2', popoverClassName)}>
            <ListBox className={cx(MENU_ITEMS_CONTAINER, 'max-h-[240px] overflow-auto')}>
              {children}
            </ListBox>
          </Popover>
        </>
      )}
    </AriaComboBox>
  );
}

export function ComboBoxItem({ className, children, ...props }: Omit<ListBoxItemProps, 'className' | 'children'> & { className?: string; children?: ReactNode }) {
  return (
    <ListBoxItem
      {...props}
      className={(state) => cx(
        MENU_ITEM,
        'text-body-medium',
        (state.isFocused || state.isSelected) && MENU_ITEM_ACTIVE,
        state.isDisabled && 'cursor-not-allowed text-text-disabled',
        className,
      )}
    >
      {children}
    </ListBoxItem>
  );
}

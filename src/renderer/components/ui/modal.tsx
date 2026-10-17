import type { ReactNode } from 'react';
import { Dialog, Heading, Modal as AriaModal, ModalOverlay } from 'react-aria-components';
import { RiCloseLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { useDirection } from '@/components/foundations/direction/direction';
import { useT } from '@/i18n';
import { cx } from '@/utils/cx';

/**
 * Dialog shell in the BoardUI settings-modal recipe: black/70 backdrop that
 * cross-fades over 300ms, a radius/3xl panel that condenses in from
 * scale-[0.85] + 4px blur on the modal easing, a title row with the round
 * close button, then a body that scrolls on its own.
 */

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
  '4xl': 'sm:max-w-4xl',
  '5xl': 'sm:max-w-5xl',
} as const;

export type ModalSize = keyof typeof SIZES;

export interface ModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Title row text; also the dialog's accessible name. */
  title?: ReactNode;
  /** Muted line under the title. */
  description?: ReactNode;
  /** Accessible name when there is no visible title. */
  'aria-label'?: string;
  size?: ModalSize;
  /** Backdrop click closes (Escape always closes unless keyboard dismiss is off). */
  isDismissable?: boolean;
  isKeyboardDismissDisabled?: boolean;
  hideCloseButton?: boolean;
  closeLabel?: string;
  /** Classes on the panel (e.g. a fixed height). */
  className?: string;
  /** Classes on the scrolling body. */
  bodyClassName?: string;
  /** Right-aligned action row under the body. */
  footer?: ReactNode;
  children?: ReactNode;
}

const OVERLAY = [
  // No-drag so title-bar drag strips underneath don't swallow clicks (Electron).
  'window-no-drag fixed inset-0 z-100 flex items-center justify-center bg-black/70 p-4',
  'transition-opacity duration-300 ease-out',
  'data-[entering]:opacity-0 data-[exiting]:opacity-0',
].join(' ');

const PANEL = [
  'relative flex max-h-[calc(100dvh-32px)] w-full flex-col overflow-clip outline-none',
  'rounded-3xl bg-background-full text-text-primary shadow-xs',
  'transform-gpu transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-[opacity,transform,filter]',
  'data-[entering]:scale-[0.85] data-[entering]:opacity-0 data-[entering]:blur-[4px]',
  'data-[exiting]:scale-[0.85] data-[exiting]:opacity-0 data-[exiting]:blur-[4px]',
].join(' ');

/** The round tertiary close button from the settings modal title row. */
export function ModalCloseButton({ label, onPress, className }: { label?: string; onPress: () => void; className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={label ?? t('common.close')}
      onClick={onPress}
      className={cx(
        'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full',
        'bg-background-tertiary-default text-foreground-icon-secondary',
        'transition-colors duration-150 ease hover:bg-background-tertiary-hover',
        'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        className,
      )}
    >
      <RiCloseLine className="size-4" aria-hidden />
    </button>
  );
}

export function Modal({
  isOpen,
  onOpenChange,
  title,
  description,
  'aria-label': ariaLabel,
  size = 'lg',
  isDismissable = true,
  isKeyboardDismissDisabled,
  hideCloseButton,
  closeLabel,
  className,
  bodyClassName,
  footer,
  children,
}: ModalProps) {
  const direction = useDirection();
  const close = () => onOpenChange(false);
  return (
    <ModalOverlay
      dir={direction}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      className={OVERLAY}
    >
      <AriaModal className={cx(PANEL, SIZES[size], className)}>
        <Dialog aria-label={ariaLabel} className="flex min-h-0 flex-1 flex-col outline-none">
          {title || !hideCloseButton ? (
            <div className="flex shrink-0 items-start justify-between gap-3 px-6 pt-6 pb-3">
              <div className="flex min-w-0 flex-col gap-1">
                {title ? <Heading slot="title" className="text-title-3-medium text-text-primary">{title}</Heading> : null}
                {description ? <p className="text-body-regular text-text-secondary">{description}</p> : null}
              </div>
              {hideCloseButton ? null : <ModalCloseButton label={closeLabel} onPress={close} />}
            </div>
          ) : null}
          <div className={cx('min-h-0 flex-1 overflow-y-auto px-6', footer ? 'pb-2' : 'pb-6', !title && hideCloseButton && 'pt-6', bodyClassName)}>
            {children}
          </div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 px-6 pt-4 pb-6">
              {footer}
            </div>
          ) : null}
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}

export interface ConfirmDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra content between the description and the actions. */
  children?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  /** `danger` paints the confirm action red (destructive actions). */
  tone?: 'default' | 'danger';
  isPending?: boolean;
  isConfirmDisabled?: boolean;
  onConfirm: () => void;
}

/** Small confirmation dialog: title, copy, Cancel + a primary/danger action. */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  isPending,
  isConfirmDisabled,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="md"
      isDismissable={!isPending}
      isKeyboardDismissDisabled={isPending}
      hideCloseButton
      bodyClassName={children ? undefined : 'pb-0'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isPending}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={isPending || isConfirmDisabled} aria-busy={isPending || undefined}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

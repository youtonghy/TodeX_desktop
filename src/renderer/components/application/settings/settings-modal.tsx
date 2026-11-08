import { useId, type ComponentType, type ReactNode } from 'react';
import { Dialog, Modal as AriaModal, ModalOverlay } from 'react-aria-components';
import { useDirection } from '@/components/foundations/direction/direction';
import { MODAL_OVERLAY, MODAL_PANEL, ModalCloseButton } from '@/components/ui/modal';
import { cx } from '@/utils/cx';

/**
 * The app-wide settings modal, after BoardUI's settings-modal
 * (`boardui add settings-modal`, application/settings/settings-modal):
 *
 *   panel     radius/3xl, bg full, shadow/xs; the backdrop cross-fade and the
 *             panel's scale + blur entrance are the shared modal recipe.
 *   rail      240px desktop / 192px compact / 56px icon-only, bg
 *             background/secondary, 1px end border, p 10. Sections sit in
 *             labelled groups (label ps-8, items p-8 radius/2lg icon-20 +
 *             body-medium); the icon-only rail drops the labels and keeps
 *             the gap between groups. Selected row bg background/secondary/hover.
 *   content   px 32, the current page's title row fixed, each page scrolls
 *             on its own below it.
 *
 * BoardUI's own shell handles Escape on the document and has no focus
 * containment, so a nested popover's Escape closed the whole modal; this
 * one runs on React Aria's modal instead. The close button belongs to the
 * shell, so it stays reachable while a lazy page is loading or has failed.
 */

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

export interface SettingsNavItem<K extends string> {
  id: K;
  label: string;
  icon: IconComponent;
}

export interface SettingsNavGroup<K extends string> {
  id: string;
  label: string;
  items: SettingsNavItem<K>[];
}

export interface SettingsModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  'aria-label': string;
  /** Classes on the panel (size it here). */
  className?: string;
  /** One row holding the rail and the content pane (or a loading/error state). */
  children: ReactNode;
}

export function SettingsModal({ isOpen, onOpenChange, 'aria-label': ariaLabel, className, children }: SettingsModalProps) {
  const direction = useDirection();
  return (
    <ModalOverlay dir={direction} isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className={MODAL_OVERLAY}>
      <AriaModal className={cx(MODAL_PANEL, 'flex-row', className)}>
        <Dialog aria-label={ariaLabel} className="relative flex min-h-0 min-w-0 flex-1 flex-col outline-none">
          {children}
          {/* Level with the 26px title row's centre (pt-8 + 1px). */}
          <ModalCloseButton onPress={() => onOpenChange(false)} className="absolute end-8 top-[33px]" />
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}

/** The section rail: grouped rows, one selected. */
export function SettingsNav<K extends string>({ 'aria-label': ariaLabel, groups, selected, onSelect }: {
  'aria-label': string;
  groups: SettingsNavGroup<K>[];
  selected: K;
  onSelect: (id: K) => void;
}) {
  const baseId = useId();
  return (
    <nav
      aria-label={ariaLabel}
      className="flex w-14 shrink-0 flex-col gap-5 overflow-y-auto border-e border-separator-border bg-background-secondary-default p-2.5 sm:w-48 lg:w-60"
    >
      {groups.filter((group) => group.items.length > 0).map((group) => {
        const labelId = `${baseId}-${group.id}`;
        return (
          <div key={group.id} role="group" aria-labelledby={labelId} className="flex w-full flex-col gap-1.5 pt-1">
            <span id={labelId} className="hidden ps-2 text-body-medium text-text-secondary sm:block">{group.label}</span>
            <div className="flex w-full flex-col gap-1">
              {group.items.map(({ id, label, icon: Icon }) => {
                const isSelected = id === selected;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-label={label}
                    title={label}
                    aria-current={isSelected ? 'page' : undefined}
                    onClick={() => onSelect(id)}
                    className={cx(
                      'flex w-full cursor-pointer items-center gap-2 rounded-2lg p-2 text-start',
                      'outline-none transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                      isSelected ? 'bg-background-secondary-hover' : 'hover:bg-background-secondary-hover/60',
                    )}
                  >
                    <Icon aria-hidden className="size-5 shrink-0 text-foreground-icon-secondary" />
                    <span className={cx('hidden truncate text-body-medium sm:block', isSelected ? 'text-text-primary' : 'text-text-secondary')}>
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** The content pane: the current page's title, then its pages. */
export function SettingsContent({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* pe-16 keeps a long title clear of the shell's close button. */}
      <h2 className="shrink-0 truncate ps-8 pe-16 pt-8 pb-3 text-title-3-medium text-text-primary">{title}</h2>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

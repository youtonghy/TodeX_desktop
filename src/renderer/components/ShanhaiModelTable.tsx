import { useState, type RefObject } from 'react';
import {
  Dialog as AriaDialog,
  Popover as AriaPopover,
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
} from 'react-aria-components';
import type { ProviderModelDescriptor } from '@todex/protocol/v2';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { MENU_POPOVER_SURFACE } from '@/components/base/dropdown/menu-styles';
import { cx } from '@/utils/cx';
import { assignShanhaiModels, SHANHAI_CELLS } from './shanhaiModels';

const TITLE = '山海经模型周期表';

interface ShanhaiModelTableProps {
  models: ProviderModelDescriptor[];
  currentModel: string;
  onSelectModel: (modelId: string) => void;
}

/** The table itself. Models are dealt once per mount, so every opening of
 *  the popover deals a fresh table. */
function ShanhaiModelTable({ models, currentModel, onSelectModel }: ShanhaiModelTableProps) {
  const [dealt] = useState(() => assignShanhaiModels(models));
  const [selected, setSelected] = useState(() => Math.max(0, dealt.findIndex((model) => model.id === currentModel)));
  const cell = SHANHAI_CELLS[selected];
  const model = dealt[selected];
  if (!model) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 className="text-headline-semibold text-text-primary">{TITLE}</h2>
        <p className="text-caption-1-regular text-text-secondary">每只异兽都对应一个模型，每次打开重新匹配。</p>
      </div>

      <AriaRadioGroup
        aria-label={TITLE}
        value={String(selected)}
        onChange={(value) => setSelected(Number(value))}
        className="grid grid-cols-18 gap-0.5 outline-none"
      >
        {SHANHAI_CELLS.map((item, index) => (
          <AriaRadio
            key={item.number}
            value={String(index)}
            aria-label={`${item.number} ${item.name}：${dealt[index]?.displayName ?? ''}`}
            style={{ gridColumn: item.column, gridRow: item.row }}
            className={({ isSelected, isHovered, isFocusVisible }) => cx(
              'flex h-10 cursor-pointer flex-col items-center justify-center rounded-md outline-none select-none',
              'transition-colors duration-150 ease',
              isSelected
                ? 'bg-accent-500 text-text-white'
                : cx('text-text-primary', isHovered ? 'bg-background-secondary-hover' : 'bg-background-secondary-default'),
              isFocusVisible && 'ring-2 ring-border-focus-ring',
            )}
          >
            {({ isSelected }) => (
              <>
                <span className={cx('text-caption-2-regular', isSelected ? 'text-text-white' : 'text-text-tertiary')}>
                  {item.number}
                </span>
                <span className="text-body-medium">{item.glyph}</span>
              </>
            )}
          </AriaRadio>
        ))}
      </AriaRadioGroup>

      <div className="flex items-center gap-3 rounded-2xl bg-background-secondary-default p-3">
        <div
          aria-hidden="true"
          className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl bg-background-primary-default"
        >
          <span className="text-caption-2-regular text-text-tertiary">{cell.number}</span>
          <span className="text-title-2-semibold text-text-primary">{cell.glyph}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-title-3-semibold text-text-primary">{cell.name}</span>
            <Chip variant="caption" color="neutral" className="min-w-0 truncate">{model.displayName}</Chip>
          </div>
          <p className="line-clamp-2 text-body-2-regular text-text-secondary">{model.description || model.id}</p>
        </div>
        <Button size="small" className="shrink-0" onClick={() => onSelectModel(model.id)}>
          选择模型
        </Button>
      </div>
    </div>
  );
}

interface ShanhaiModelPopoverProps extends ShanhaiModelTableProps {
  triggerRef: RefObject<HTMLElement | null>;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/** Easter egg: the model picker as a 山海经 periodic table, opened by a long
 *  press on the model picker trigger. */
export function ShanhaiModelPopover({ triggerRef, isOpen, onOpenChange, ...table }: ShanhaiModelPopoverProps) {
  return (
    <AriaPopover
      triggerRef={triggerRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      placement="bottom"
      offset={8}
      className={cx(MENU_POPOVER_SURFACE, 'w-[min(40rem,calc(100vw-2rem))] p-3')}
    >
      <AriaDialog aria-label={TITLE} className="outline-none">
        <ShanhaiModelTable {...table} />
      </AriaDialog>
    </AriaPopover>
  );
}

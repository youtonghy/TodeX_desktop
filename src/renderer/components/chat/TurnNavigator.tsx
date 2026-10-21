import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react';
import { Focusable } from 'react-aria-components';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { IconAction } from '@/components/ui/icon-action';
import { cx } from '@/utils/cx';
import { t } from '../../i18n';

export interface ChatTurn {
  /** `data-message-id` of the user message that opens the turn. */
  id: string;
  preview: string;
}

/** Turn buttons shown at once; longer conversations slide a window around the active turn. */
const MAX_VISIBLE_TURNS = 9;

/**
 * Vertical quick switcher for the user messages of a conversation:
 * previous · turn 1 … turn N · next. Picking a turn scrolls its message to the top.
 */
export function TurnNavigator({ turns, activeId, onSelect, className }: {
  turns: ChatTurn[];
  activeId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  if (turns.length < 2) return null;
  const found = turns.findIndex((turn) => turn.id === activeId);
  const active = found >= 0 ? found : turns.length - 1;
  const start = Math.min(Math.max(0, active - Math.floor(MAX_VISIBLE_TURNS / 2)), Math.max(0, turns.length - MAX_VISIBLE_TURNS));
  const visible = turns.slice(start, start + MAX_VISIBLE_TURNS);
  const hiddenAbove = start;
  const hiddenBelow = turns.length - start - visible.length;

  return (
    <nav aria-label={t('chat.turnNav')} className={cx('flex flex-col items-center gap-1', className)}>
      <IconAction
        icon={RiArrowUpSLine}
        size="sm"
        aria-label={t('chat.turnNavPrevious')}
        tooltip
        tooltipPlacement="right"
        disabled={active === 0}
        onClick={() => onSelect(turns[active - 1].id)}
      />
      {hiddenAbove > 0 ? <span aria-hidden className="text-caption-2-regular text-text-placeholder">+{hiddenAbove}</span> : null}
      {visible.map((turn, offset) => {
        const index = start + offset;
        const current = index === active;
        return (
          <TooltipTrigger key={turn.id} delay={200}>
            <Focusable>
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                aria-label={t('chat.turnNavItem', { index: index + 1 })}
                onClick={() => onSelect(turn.id)}
                className={cx(
                  'inline-flex h-7 min-w-14 cursor-pointer items-center justify-center rounded-full px-2.5 text-caption-1-medium tabular-nums',
                  'transition-colors duration-150 ease outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                  current
                    ? 'bg-background-primary-default text-text-primary shadow-card'
                    : 'text-text-tertiary hover:bg-background-secondary-hover hover:text-text-primary',
                )}
              >
                {t('chat.turnNavItem', { index: index + 1 })}
              </button>
            </Focusable>
            <Tooltip placement="right">
              <span className="line-clamp-3 max-w-64 wrap-anywhere">{turn.preview || t('chat.turnNavItem', { index: index + 1 })}</span>
            </Tooltip>
          </TooltipTrigger>
        );
      })}
      {hiddenBelow > 0 ? <span aria-hidden className="text-caption-2-regular text-text-placeholder">+{hiddenBelow}</span> : null}
      <IconAction
        icon={RiArrowDownSLine}
        size="sm"
        aria-label={t('chat.turnNavNext')}
        tooltip
        tooltipPlacement="right"
        disabled={active >= turns.length - 1}
        onClick={() => onSelect(turns[active + 1].id)}
      />
    </nav>
  );
}

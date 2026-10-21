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

/** Turn dots shown at once; longer conversations slide a window around the active turn. */
const MAX_VISIBLE_TURNS = 12;

/**
 * Vertical quick switcher for the user messages of a conversation:
 * previous · one dot per turn · next. Picking a turn scrolls its message to the top.
 *
 * Needs an `@container` ancestor: in a container narrower than 48rem the rail
 * would cover the messages, so it hides until the pointer reaches the start
 * edge (or keyboard focus lands in it) and then floats on a surface.
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
  const moreAbove = start > 0;
  const moreBelow = start + visible.length < turns.length;
  const overflowDot = <span aria-hidden className="size-1 rounded-full bg-foreground-icon-quaternary opacity-50" />;

  return (
    <div className={cx('group/turns pointer-events-none flex items-center', className)}>
      {/* Hover strip along the start edge that reveals the collapsed rail. */}
      <div aria-hidden className="pointer-events-auto absolute inset-y-0 start-0 w-5 @3xl:hidden" />
      <nav
        aria-label={t('chat.turnNav')}
        className={cx(
          'relative flex flex-col items-center gap-0.5 rounded-full py-1',
          'transition-opacity duration-150 ease',
          'pointer-events-none bg-background-primary-default opacity-0 shadow-card',
          'group-hover/turns:pointer-events-auto group-hover/turns:opacity-100 has-focus-visible:pointer-events-auto has-focus-visible:opacity-100',
          '@3xl:pointer-events-auto @3xl:bg-transparent @3xl:opacity-100 @3xl:shadow-none',
        )}
      >
        <IconAction
          icon={RiArrowUpSLine}
          size="sm"
          aria-label={t('chat.turnNavPrevious')}
          tooltip
          tooltipPlacement="right"
          disabled={active === 0}
          onClick={() => onSelect(turns[active - 1].id)}
        />
        {moreAbove ? overflowDot : null}
        {visible.map((turn, offset) => {
          const index = start + offset;
          const current = index === active;
          const label = t('chat.turnNavItem', { index: index + 1 });
          return (
            <TooltipTrigger key={turn.id} delay={200}>
              <Focusable>
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  aria-label={label}
                  onClick={() => onSelect(turn.id)}
                  className="group/dot inline-flex size-6 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                >
                  <span
                    aria-hidden
                    className={cx(
                      'rounded-full transition-[width,height,background-color] duration-150 ease',
                      current
                        ? 'size-2 bg-foreground-icon-primary'
                        : 'size-1.5 bg-foreground-icon-quaternary group-hover/dot:bg-foreground-icon-secondary',
                    )}
                  />
                </button>
              </Focusable>
              <Tooltip placement="right">
                <span className="line-clamp-3 max-w-64 wrap-anywhere">{turn.preview || label}</span>
              </Tooltip>
            </TooltipTrigger>
          );
        })}
        {moreBelow ? overflowDot : null}
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
    </div>
  );
}

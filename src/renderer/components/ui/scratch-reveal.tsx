import { useState, type KeyboardEvent } from 'react';
import { Focusable } from 'react-aria-components';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { cx } from '@/utils/cx';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A value kept from view behind a silver scratch-card foil until the user
 * clicks it (or presses Enter/Space): the foil wipes away left to right and
 * the text shows where it was scratched off (`.scratch-cover` in global.css).
 * The covered text keeps its width so the surrounding layout does not move;
 * it cannot be selected, and its accessible name is `label`, never the text.
 * Remount (change the `key`) to cover it again.
 */
export function ScratchReveal({ text, label, hint, tone = 'default', onReveal }: {
  text: string;
  /** Accessible name and tooltip title while covered. */
  label: string;
  /** Tooltip line under the title, e.g. how to reveal. */
  hint?: string;
  /** Ink of the revealed text: the color of the text around it. */
  tone?: 'default' | 'error';
  /** Called once, when the user starts revealing it. */
  onReveal?: () => void;
}) {
  const [state, setState] = useState<'covered' | 'scratching' | 'revealed'>('covered');
  if (state === 'revealed') {
    return <span className="underline decoration-text-tertiary decoration-dotted underline-offset-2">{text}</span>;
  }
  const reveal = () => {
    if (state !== 'covered') return;
    // Without the wipe there is no animationend to wait for.
    setState(reducedMotion() ? 'revealed' : 'scratching');
    onReveal?.();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    reveal();
  };
  return (
    <TooltipTrigger delay={200} isDisabled={state !== 'covered'}>
      <Focusable>
        <span
          role="button"
          tabIndex={0}
          aria-label={label}
          data-scratching={state === 'scratching' || undefined}
          data-tone={tone}
          className={cx(
            'scratch-cover cursor-pointer select-none rounded-sm',
            'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
          )}
          onClick={reveal}
          onKeyDown={onKeyDown}
          onAnimationEnd={() => setState('revealed')}
        >
          {text}
        </span>
      </Focusable>
      <Tooltip placement="top">
        <span className="block text-caption-1-semibold">{label}</span>
        {hint ? <span className="block text-caption-1-regular text-text-secondary">{hint}</span> : null}
      </Tooltip>
    </TooltipTrigger>
  );
}

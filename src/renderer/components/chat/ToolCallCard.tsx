import { useState, type ReactNode } from 'react';
import { RiArrowDownSLine, RiCheckboxCircleLine, RiErrorWarningLine, RiLoader4Line, RiTimeLine } from '@remixicon/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ShimmerText } from '@/components/application/agent-log/agent-log';
import { CodeBlock } from '@/components/ui/code-block';
import { useT } from '@/i18n';
import { cx } from '@/utils/cx';

/**
 * A tool call in the chat thread, in the BoardUI task-list row recipe: status
 * glyph, tool name (shimmering while it runs), and a body that folds open
 * with the arguments, the result and the error. Subagent runs reuse it as a
 * bordered card with their own body.
 */

/** Where a tool call is in its lifecycle. */
export type ToolCallState = 'pending' | 'running' | 'completed' | 'failed';

const SOFT_EASE = [0.22, 1, 0.36, 1] as const;

const GLYPHS = {
  pending: { icon: RiTimeLine, className: 'text-foreground-icon-tertiary' },
  running: { icon: RiLoader4Line, className: 'animate-spin text-foreground-icon-secondary motion-reduce:animate-none' },
  completed: { icon: RiCheckboxCircleLine, className: 'text-foreground-icon-tertiary' },
  failed: { icon: RiErrorWarningLine, className: 'text-foreground-icon-error' },
} as const satisfies Record<ToolCallState, unknown>;

export function ToolCallStatusGlyph({ state, className }: { state: ToolCallState; className?: string }) {
  const { icon: Icon, className: tone } = GLYPHS[state];
  return <Icon aria-hidden className={cx('size-4 shrink-0', tone, className)} />;
}

function codeLanguage(text: string): string {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return 'plaintext';
  try {
    JSON.parse(trimmed);
    return 'json';
  } catch {
    return 'plaintext';
  }
}

/** Arguments or output, highlighted, with the copy action in its caption. */
export function ToolCallCode({ label, code }: { label: string; code: string }) {
  return (
    <CodeBlock
      code={code}
      language={codeLanguage(code)}
      title={label}
      className="my-0 rounded-xl"
      codeClassName="max-h-72 overflow-y-auto"
    />
  );
}

/** A labelled block of plain text (task, result, error). */
export function ToolCallText({ label, tone = 'default', children }: { label: string; tone?: 'default' | 'error'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'flex min-w-0 flex-col gap-1 rounded-xl px-3 py-2',
        tone === 'error' ? 'bg-notification-error-background' : 'bg-background-secondary-default',
      )}
    >
      <span className={cx('text-caption-1-medium uppercase', tone === 'error' ? 'text-notification-error-foreground' : 'text-text-tertiary')}>
        {label}
      </span>
      <div
        className={cx(
          'max-h-52 overflow-y-auto whitespace-pre-wrap wrap-anywhere text-body-2-regular',
          tone === 'error' ? 'text-notification-error-foreground' : 'text-text-primary',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export interface ToolCallCardProps {
  state: ToolCallState;
  /** Tool name, or name and key argument. */
  title: string;
  /** Muted lead-in before the title, e.g. "Calling: ". */
  prefix?: string;
  /** Small element between the status glyph and the title (an agent icon). */
  leading?: ReactNode;
  /** Shimmers the title; defaults to `state === 'running'`. */
  active?: boolean;
  /** Trailing content in the header (duration, status chip). */
  meta?: ReactNode;
  /** Always-visible line under the header, outside its button, for notices
   * that carry their own actions. */
  footer?: ReactNode;
  argsText?: string;
  output?: string;
  errorText?: string;
  /** Provider id of the call, shown as a footnote. */
  toolCallId?: string;
  /** Custom body; replaces the arguments/output/error sections. */
  children?: ReactNode;
  /** Whether the row folds open. Defaults to "has something to show". */
  isExpandable?: boolean;
  defaultExpanded?: boolean;
  /** `row` sits flat in the thread; `card` is a bordered panel (aside lists). */
  variant?: 'row' | 'card';
  className?: string;
}

export function ToolCallCard({
  state,
  title,
  prefix,
  leading,
  active,
  meta,
  footer,
  argsText,
  output,
  errorText,
  toolCallId,
  children,
  isExpandable,
  defaultExpanded = false,
  variant = 'row',
  className,
}: ToolCallCardProps) {
  const t = useT();
  const reduce = useReducedMotion() ?? false;
  const [open, setOpen] = useState(defaultExpanded);
  const hasArgs = Boolean(argsText?.trim());
  const hasOutput = Boolean(output?.trim());
  const hasError = Boolean(errorText?.trim());
  const expandable = isExpandable ?? Boolean(children || hasArgs || hasOutput || hasError || toolCallId);
  const expanded = expandable && open;
  const shimmer = active ?? state === 'running';

  return (
    <div
      className={cx(
        'min-w-0',
        variant === 'card' && 'rounded-2xl border border-border-button-default bg-background-primary-default px-3 py-1.5',
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={expandable ? expanded : undefined}
        disabled={!expandable}
        onClick={() => setOpen((current) => !current)}
        className={cx(
          'group flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-start outline-none',
          'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
          expandable ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        <ToolCallStatusGlyph state={state} />
        {leading}
        <span className="flex min-w-0 flex-1 items-baseline gap-1 text-body-regular text-text-secondary">
          {prefix ? <span className="shrink-0 text-text-tertiary">{prefix}</span> : null}
          <span className="min-w-0 truncate">{shimmer ? <ShimmerText>{title}</ShimmerText> : title}</span>
        </span>
        {meta}
        {expandable ? (
          <RiArrowDownSLine
            aria-hidden
            className={cx(
              'size-4 shrink-0 text-foreground-icon-tertiary transition-[transform,color] duration-300 ease group-hover:text-foreground-icon-secondary',
              expanded ? 'rotate-180' : 'rotate-0',
            )}
          />
        ) : null}
      </button>
      {footer ? <div className="ps-6">{footer}</div> : null}
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { height: { duration: 0.3, ease: SOFT_EASE }, opacity: { duration: 0.22, ease: 'easeOut' } }}
            className="overflow-hidden"
          >
            <div className="flex min-w-0 flex-col gap-2 pt-1 pb-2 ps-6">
              {children ?? (
                <>
                  {hasArgs ? <ToolCallCode label={t('aside.slashArgs')} code={argsText!} /> : null}
                  {hasOutput ? <ToolCallCode label={t('aside.subagentResult')} code={output!} /> : null}
                  {hasError ? <ToolCallText label={t('aside.subagentError')} tone="error">{errorText}</ToolCallText> : null}
                </>
              )}
              {toolCallId ? <p className="truncate font-mono text-caption-1-regular text-text-tertiary">{toolCallId}</p> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

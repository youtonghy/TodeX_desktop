import { useState, type ComponentType, type ReactNode } from 'react';
import { RiArrowDownSLine } from '@remixicon/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ShimmerText } from '@/components/application/agent-log/agent-log';
import { cx } from '@/utils/cx';

/**
 * The agent's "work process" in the BoardUI task-list recipe: a quiet header
 * (icon, title that shimmers while the work runs and cross-fades when it
 * changes, chevron) over a list of steps hanging off a curved guide.
 */

const SOFT_EASE = [0.22, 1, 0.36, 1] as const;

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/** Cross-fades the title in place when it changes (Thinking → Executing). */
function ProcessTitle({ label, running, reduce }: { label: string; running: boolean; reduce: boolean }) {
  return (
    <span className="relative flex min-w-0 overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={label}
          initial={reduce ? false : { opacity: 0, y: 4, filter: 'blur(3px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, filter: 'blur(3px)' }}
          transition={{ duration: reduce ? 0 : 0.26, ease: SOFT_EASE }}
          className="block truncate"
        >
          {running ? <ShimmerText>{label}</ShimmerText> : label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export interface ProcessDisclosureProps {
  title: string;
  icon?: IconComponent;
  /** Shimmers the title while the work is still running. */
  running?: boolean;
  /** Trailing content in the header, before the chevron. */
  meta?: ReactNode;
  /** Always-visible line under the header, outside its button. */
  footer?: ReactNode;
  /** Controlled open state; leave out to let the disclosure keep its own. */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Rendered only while open. */
  children?: ReactNode;
  className?: string;
}

export function ProcessDisclosure({
  title,
  icon: Icon,
  running = false,
  meta,
  footer,
  expanded: controlled,
  defaultExpanded = false,
  onExpandedChange,
  children,
  className,
}: ProcessDisclosureProps) {
  const reduce = useReducedMotion() ?? false;
  const [uncontrolled, setUncontrolled] = useState(defaultExpanded);
  const open = controlled ?? uncontrolled;
  const toggle = () => {
    const next = !open;
    if (controlled === undefined) setUncontrolled(next);
    onExpandedChange?.(next);
  };
  return (
    <section className={cx('min-w-0', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md py-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-foreground-icon-secondary" /> : null}
        <span className="min-w-0 flex-1 text-body-medium text-text-secondary">
          <ProcessTitle label={title} running={running} reduce={reduce} />
        </span>
        {meta}
        <RiArrowDownSLine
          aria-hidden
          className={cx(
            'size-4 shrink-0 text-foreground-icon-tertiary transition-[transform,color] duration-300 ease group-hover:text-foreground-icon-secondary',
            open ? 'rotate-180' : 'rotate-0',
          )}
        />
      </button>
      {footer ? <div className="ps-6">{footer}</div> : null}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="steps"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { height: { duration: 0.3, ease: SOFT_EASE }, opacity: { duration: 0.22, ease: 'easeOut' } }}
            className="overflow-hidden"
          >
            <div className="pt-0.5 pb-1">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

/** The step list; its trunk sits under the centre of the header's icon. */
export function ProcessSteps({ children, className }: { children: ReactNode; className?: string }) {
  return <ul aria-live="polite" className={cx('ms-2 flex min-w-0 flex-col', className)}>{children}</ul>;
}

/**
 * One step on the guide: a curved branch from the trunk to the step's first
 * line (14px down, the middle of a 20px line under 4px of padding), and the
 * trunk running on to the next step unless this is the last one.
 */
export function ProcessStep({ last = false, children, className }: { last?: boolean; children: ReactNode; className?: string }) {
  return (
    <li className={cx('relative min-w-0 ps-4', className)}>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 start-0 w-3 text-foreground-icon-quaternary">
        <svg width={12} height={15} viewBox="0 0 12 15" fill="none" className="absolute start-0 top-0 rtl:-scale-x-100">
          <path d="M0.5 0 V8 Q0.5 14 6.5 14 H11.5" stroke="currentColor" strokeWidth="1" />
        </svg>
        {last ? null : <span className="absolute start-0 top-2 bottom-0 w-px bg-current" />}
      </span>
      {children}
    </li>
  );
}

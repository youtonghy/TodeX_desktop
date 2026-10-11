"use client";

import { useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { RiArrowDownSLine } from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import {
  LogRow,
  SOFT_EASE,
  ShimmerText,
  UNIT_ANIMATE,
  UNIT_INITIAL,
  UNIT_TRANSITION,
  WorkingRow,
  useLogMotion,
  useRevealMask,
  useRevealTicker,
} from "@/components/application/agent-log/agent-log";
import { cx } from "@/utils/cx";

/**
 * Task List — the agent's working log as it happens.
 *
 * One entry per task ("Found project files"), each holding the steps the agent
 * actually took underneath a hairline rule. Unlike Agent Progress, which owns a
 * fixed module and runs on a timer, this is a data-driven transcript meant to
 * sit inline in a chat thread: it streams its own units in, one per tick, so
 * the thread grows the way the work does.
 *
 * A task shows its `runningTitle` with a travelling shimmer while its steps are
 * still arriving, then cross-fades to `title` once they have all landed.
 *
 * The reveal, the clipping edge and the curved guide all come from Agent Log,
 * which Web Search shares — see that file for why the motion is timed the way
 * it is. Everything falls back to a static render under
 * `prefers-reduced-motion`.
 */

/* ----------------------------------------------------------------- types */

export interface TaskListChip {
  /** Chip label, e.g. a file name. */
  label: string;
  /** Optional leading glyph — a file-type or product mark. */
  icon?: ReactNode;
}

export interface TaskListStep {
  /** The line of text, e.g. `Scanning 52 files`. */
  label: string;
  /** Resource chips rendered inline after the label. */
  chips?: TaskListChip[];
}

export interface TaskListTask {
  /** Title once every step has landed, e.g. `Found project files`. */
  title: string;
  /** Title while steps are still arriving. Falls back to `title`. */
  runningTitle?: string;
  /** Leading glyph for the task header. */
  icon?: ComponentType<{ className?: string }>;
  steps: TaskListStep[];
}

export interface TaskListProps {
  tasks: TaskListTask[];
  /**
   * Pauses and resumes the reveal. Hold it false to keep the log from starting
   * on mount, then flip it true when the user sends. Toggling it back resumes
   * where it stopped; to replay from the top, change the element `key`.
   */
  run?: boolean;
  /** Milliseconds between reveals. Default 850. */
  stepInterval?: number;
  /** Milliseconds before the first reveal. Default 320. */
  startDelay?: number;
  /**
   * Drive the reveal yourself from real agent events. Counts units, where each
   * task contributes one header plus one per step. Disables the internal timer.
   */
  revealed?: number;
  /**
   * Collapse finished tasks down to their headers. `true` collapses each task
   * the moment its own steps have landed, so the log tidies itself as it runs.
   * `"all"` instead holds every task open until the whole run lands, then
   * collapses them together as one motion. Default false.
   */
  collapseOnComplete?: boolean | "all";
  /**
   * The indicator that sits at the tail of the log while it is still running,
   * so it always ends on the thing being worked on rather than on the last
   * thing finished. Pass a label to change it, or `false` to drop it.
   */
  working?: string | false;
  /** Fires once, after the last step lands. */
  onComplete?: () => void;
  className?: string;
}

/* ------------------------------------------------------------- internals */

/** A task header plus its steps, flattened so one ticker can walk everything. */
interface TaskSpan {
  task: TaskListTask;
  headIndex: number;
  /** Index one past the task's final step. */
  endIndex: number;
}

/** Cross-fades the running title to the settled one in place. */
function TaskTitle({ label, running }: { label: string; running: boolean }) {
  return (
    <span className="relative flex min-w-0 overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 4, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -4, filter: "blur(3px)" }}
          transition={{ duration: 0.26, ease: SOFT_EASE }}
          className="block truncate"
        >
          {running ? <ShimmerText>{label}</ShimmerText> : label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Chip({ chip }: { chip: TaskListChip }) {
  return (
    <span
      className={cx(
        "me-0.5 ms-[3px] inline-flex max-w-full -translate-y-px items-center gap-1 rounded-md border py-0.5 pe-1.5 align-middle",
        // Quiet at rest so a row of chips does not out-shout the step text,
        // then the border and surface firm up together under the cursor so the
        // chip reads as something you can act on.
        "border-border-button-default/50 bg-background-secondary-default",
        "transition-colors duration-150 ease hover:border-border-button-hover hover:bg-background-tertiary-default",
        chip.icon ? "ps-1" : "ps-1.5",
      )}
    >
      {chip.icon ? (
        <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
          {chip.icon}
        </span>
      ) : null}
      <span className="truncate text-caption-2-medium text-text-primary">{chip.label}</span>
    </span>
  );
}

function StepRow({
  step,
  active,
  first,
  last,
  reduce,
}: {
  step: TaskListStep;
  active: boolean;
  first: boolean;
  last: boolean;
  reduce: boolean;
}) {
  return (
    <LogRow first={first} last={last} reduce={reduce}>
      <span className="block py-1 text-body-regular text-text-secondary">
        {active ? <ShimmerText>{step.label}</ShimmerText> : step.label}
        {step.chips?.map((chip, index) => (
          <Chip key={`${chip.label}-${index}`} chip={chip} />
        ))}
      </span>
    </LogRow>
  );
}

/** The task header and its steps, sharing the row reveal but not the guide —
 *  a header is the source the guide descends from, not a branch off it. */
function TaskHeaderRow({ reduce, children }: { reduce: boolean; children: ReactNode }) {
  const mask = useRevealMask(reduce);
  return (
    <motion.section
      initial={reduce ? false : UNIT_INITIAL}
      animate={UNIT_ANIMATE}
      transition={UNIT_TRANSITION}
      {...mask}
      className="overflow-hidden"
    >
      {children}
    </motion.section>
  );
}

/**
 * One task: its header, and the steps that reveal beneath it. Split out of the
 * list's map so it can hold the per-task state a hook cannot own inside a
 * callback — its own reveal mask, and whether the reader has collapsed it.
 */
function TaskSection({
  task,
  headIndex,
  endIndex,
  revealed,
  total,
  collapseOnComplete,
  reduce,
}: {
  task: TaskListTask;
  headIndex: number;
  endIndex: number;
  revealed: number;
  total: number;
  collapseOnComplete: boolean | "all";
  reduce: boolean;
}) {
  // null until the reader touches it, so `collapseOnComplete` stays in charge
  // right up to the moment they decide otherwise.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);

  const done = revealed >= endIndex;
  const Icon = task.icon;
  // "all" waits for the whole log rather than this task, so a stack of tasks
  // closes as a single movement instead of shrinking out from under the reader
  // one at a time while later tasks are still arriving.
  const collapsed =
    collapseOnComplete === "all" ? revealed >= total : collapseOnComplete && done;
  const open = manualOpen ?? !collapsed;
  const label = done ? task.title : (task.runningTitle ?? task.title);

  return (
    <TaskHeaderRow reduce={reduce}>
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        aria-expanded={open}
        className="group flex w-full cursor-pointer items-center gap-2 rounded-md py-0.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        {Icon ? <Icon className="size-4 shrink-0 text-foreground-icon-secondary" /> : null}
        <span className="min-w-0 flex-1 text-body-medium text-text-secondary">
          <TaskTitle label={label} running={!done} />
        </span>
        <RiArrowDownSLine
          aria-hidden
          className={cx(
            "size-4 shrink-0 text-foreground-icon-tertiary transition-transform duration-300 ease group-hover:text-foreground-icon-secondary",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      {/* Collapse is animated on this element directly rather than through
          AnimatePresence: a presence context propagates `initial: false` to
          every descendant, which silently cancels the blur-in on each step row
          as it mounts. Omitting `initial` here also means the wrapper renders
          at its target on mount and only animates when `open` changes. */}
      <motion.div
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{
          height: { duration: 0.3, ease: SOFT_EASE },
          opacity: { duration: 0.22, ease: "easeOut" },
        }}
        className="overflow-hidden"
      >
        {/* ml-2 puts the trunk under the centre of the header's 16px icon, so
            the guide reads as descending from the task itself. */}
        <ul aria-live="polite" className="mt-0.5 ms-2 flex flex-col">
          {task.steps.map((step, stepIndex) => {
            const unit = headIndex + 1 + stepIndex;
            if (revealed <= unit) return null;
            // Last *revealed* step, not last in the data: the guide ends on the
            // newest branch and extends as the log grows.
            const lastShown =
              stepIndex === Math.min(revealed - headIndex - 2, task.steps.length - 1);
            return (
              <StepRow
                key={`${step.label}-${stepIndex}`}
                step={step}
                active={!reduce && revealed === unit + 1 && revealed < total}
                first={stepIndex === 0}
                last={lastShown}
                reduce={reduce}
              />
            );
          })}
        </ul>
      </motion.div>
    </TaskHeaderRow>
  );
}

/* ------------------------------------------------------------ component */

export function TaskList({
  tasks,
  run = true,
  stepInterval = 850,
  startDelay = 320,
  revealed: controlledRevealed,
  collapseOnComplete = false,
  working = "Working",
  onComplete,
  className,
}: TaskListProps) {
  const reduce = useLogMotion();

  // Each task contributes a header unit and one unit per step, so a single
  // counter can walk the whole log and the header always lands a tick ahead of
  // the steps it introduces.
  const spans = useMemo<TaskSpan[]>(() => {
    // Running unit offsets: one boundary per task, plus the final total.
    const offsets = tasks.reduce<number[]>(
      (acc, task) => [...acc, acc[acc.length - 1] + 1 + task.steps.length],
      [0],
    );
    return tasks.map((task, index) => ({
      task,
      headIndex: offsets[index],
      endIndex: offsets[index + 1],
    }));
  }, [tasks]);
  const rowCount = spans.length > 0 ? spans[spans.length - 1].endIndex : 0;
  /* One tick past the last row, so the final step holds and shimmers rather
   * than stopping on the frame it appears. Skipped when controlled, where the
   * caller knows when the work is genuinely done. */
  const total = rowCount + (controlledRevealed === undefined ? 1 : 0);

  const revealed = useRevealTicker({
    total,
    run,
    stepInterval,
    startDelay,
    revealed: controlledRevealed,
    onComplete,
  });

  // gap-[5px], not a scale step: the tasks want to read as one column of
  // headers once collapsed, and 4px closes it up while 8px still reads as
  // separate blocks.
  return (
    <div className={cx("flex w-full flex-col gap-[5px]", className)}>
      {spans.map(({ task, headIndex, endIndex }, taskIndex) =>
        revealed <= headIndex ? null : (
          <TaskSection
            key={`${task.title}-${taskIndex}`}
            task={task}
            headIndex={headIndex}
            endIndex={endIndex}
            revealed={revealed}
            total={total}
            collapseOnComplete={collapseOnComplete}
            reduce={reduce}
          />
        ),
      )}
      {working !== false && revealed > 0 && revealed < total ? (
        <WorkingRow label={working} reduce={reduce} />
      ) : null}
    </div>
  );
}

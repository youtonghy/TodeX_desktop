"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Button as AriaButton,
  Checkbox as AriaCheckbox,
  Input as AriaInput,
} from "react-aria-components";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { CheckboxGlyph } from "@/components/base/checkbox/checkbox-glyph";
import { PillTab, PillTabList } from "@/components/base/tabs/pill-tab";
import { cx } from "@/utils/cx";
import { useDirection } from "@/components/foundations/direction/direction";

/**
 * Figma source: Board UI → "plan mode multiple select" (node 4435:14749) and
 * "plan mode single select" (node 4435:15042).
 *
 * The questions an agent asks before it commits to a plan, as a card in the
 * chat thread. One question at a time: the prompt across the top with a
 * dismiss in the corner, the answers as bordered rows, and a footer with a
 * step pill per question next to Previous / Next.
 *
 *   card      radius 20, background/primary/default, p 12, gap 10,
 *             two-layer shadow (4px 2% + 1px 5%, raw Figma effect)
 *   surfaces  rows share the card's background/primary in both modes and
 *             separate by border alone
 *   prompt    Body 1/Medium text/primary, inset 2px, 20px Dismiss (xs)
 *   rows      radius/2xl (16), 1px border/button/default, pl 12 pr 20 py 10,
 *             gap 8 between rows; Body 1/Medium title over Body 1/Regular
 *             text/secondary description
 *   multiple  16px checkbox in a 4px vertical inset; Next advances
 *   single    Body 2/Medium number key (radius/sm, px 5 py 2) on
 *             background/secondary in light mode and one tone lighter than
 *             the row in dark mode; picking a row advances after
 *             `advanceDelay`, and the digit keys pick too
 *   other     "Other" row: Body 1/Medium label over a bare Body 1/Regular
 *             text field where the description would be, no box or ring, so
 *             it reads like the other rows until you type; typing selects
 *             it, Enter continues, and focus lifts the row like hover
 *   footer    pt 2; blue pill tabs "Step N" (px 8 py 5, gap 8) and small
 *             Previous (secondary) / Next (primary) buttons
 *
 * Questions cross-fade and slide in the direction of travel (28px, soft blur)
 * while the card animates to the next question's height, so the footer glides
 * rather than jumps. Answers are keyed by question id: the selected option
 * values in option order, plus `other` when the free-text row is chosen.
 */

export type QuestionnaireSelect = "single" | "multiple";

export type QuestionnaireOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
};

export type QuestionnaireQuestion = {
  id: string;
  /** The question itself, shown across the top of the card. */
  question: string;
  /** Overrides the card-level `select` for this question. */
  select?: QuestionnaireSelect;
  options: QuestionnaireOption[];
  /** Adds a free-text "Other" row after the options; pass an object to reword it. */
  other?: boolean | { label?: string; placeholder?: string };
  /** Label for this question's step pill; "Step N" by default. */
  stepLabel?: string;
};

export type QuestionnaireAnswer = {
  /** Selected option values, in the question's option order. */
  values: string[];
  /** The free-text answer; present only while the "Other" row is selected. */
  other?: string;
};

export type QuestionnaireAnswers = Record<string, QuestionnaireAnswer>;

export interface QuestionnaireLabels {
  previous?: string;
  next?: string;
  /** Replaces Next on the last question. */
  complete?: string;
  other?: string;
  otherPlaceholder?: string;
}

export interface QuestionnaireProps {
  questions: QuestionnaireQuestion[];
  /** Selection mode for questions that do not set their own. */
  select?: QuestionnaireSelect;
  /** Zero-based index of the visible question (controlled). */
  step?: number;
  defaultStep?: number;
  onStepChange?: (step: number) => void;
  answers?: QuestionnaireAnswers;
  defaultAnswers?: QuestionnaireAnswers;
  onAnswersChange?: (answers: QuestionnaireAnswers) => void;
  /** Fires with every answer once the last question is answered. */
  onComplete?: (answers: QuestionnaireAnswers) => void;
  /** Shows the dismiss control in the corner and receives its press. */
  onDismiss?: () => void;
  /** How long a single-select pick stays visible before the next question slides in (ms). */
  advanceDelay?: number;
  labels?: QuestionnaireLabels;
  className?: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const SLIDE = 28;
const EMPTY_ANSWER: QuestionnaireAnswer = { values: [] };

const DEFAULT_LABELS: Required<QuestionnaireLabels> = {
  previous: "Previous",
  next: "Next",
  complete: "Done",
  other: "Other",
  otherPlaceholder: "Enter your custom answer here",
};

const PANEL_VARIANTS = {
  enter: (direction: number) => ({ opacity: 0, x: SLIDE * direction, filter: "blur(4px)" }),
  center: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: (direction: number) => ({ opacity: 0, x: -SLIDE * direction, filter: "blur(4px)" }),
};

const ROW = [
  "group flex w-full items-center gap-4 rounded-2xl border border-border-button-default",
  // Figma pads 10 / 12 / 20 with the 1px stroke drawn inside; CSS puts the
  // border outside the padding, so each side gives back a pixel to land the
  // content, and the 60px row, where the design has them.
  "bg-background-primary-default py-[9px] pe-[19px] ps-[11px] text-start",
  "transition-colors duration-150 ease outline-none",
].join(" ");
const ROW_HOVER = "bg-background-primary-hover";
const ROW_PRESSED = "border-border-button-hover bg-background-primary-active";
const ROW_SELECTED = "border-border-button-hover bg-background-primary-hover";
const ROW_FOCUS = "ring-2 ring-border-focus-ring";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function OptionText({ label, description }: { label: ReactNode; description?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-body-medium text-text-primary">{label}</span>
      {description !== undefined && description !== null && (
        <span className="text-body-regular text-text-secondary">{description}</span>
      )}
    </span>
  );
}

/**
 * The number key on single-select rows: press it to pick the row. It steps one
 * tone further whenever the row itself is lifted (hover, or the remembered
 * pick), since the row's lifted fill is the key's resting one.
 */
function OptionKey({ index, raised = false }: { index: number; raised?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-sm px-[5px] py-0.5 text-body-2-medium text-text-primary",
        "bg-questionnaire-key-background transition-colors duration-150 ease group-hover:bg-questionnaire-key-hover-background",
        raised && "bg-questionnaire-key-hover-background",
      )}
    >
      {index + 1}
    </span>
  );
}

function CheckboxRow({
  option,
  isSelected,
  onChange,
}: {
  option: QuestionnaireOption;
  isSelected: boolean;
  onChange: (selected: boolean) => void;
}) {
  return (
    <AriaCheckbox
      isSelected={isSelected}
      onChange={onChange}
      className={(state) =>
        cx(
          ROW,
          "cursor-pointer select-none",
          state.isPressed ? ROW_PRESSED : state.isHovered && ROW_HOVER,
        )
      }
    >
      {(state) => (
        <>
          <OptionText label={option.label} description={option.description} />
          <span className="flex shrink-0 items-center py-1">
            <CheckboxGlyph state={state} />
          </span>
        </>
      )}
    </AriaCheckbox>
  );
}

function PickRow({
  option,
  index,
  isSelected,
  onPick,
}: {
  option: QuestionnaireOption;
  index: number;
  isSelected: boolean;
  onPick: () => void;
}) {
  return (
    <AriaButton
      onPress={onPick}
      aria-pressed={isSelected}
      aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
      className={(state) =>
        cx(
          ROW,
          "cursor-pointer select-none",
          isSelected
            ? ROW_SELECTED
            : state.isPressed
              ? ROW_PRESSED
              : state.isHovered && ROW_HOVER,
          state.isFocusVisible && ROW_FOCUS,
        )
      }
    >
      <OptionText label={option.label} description={option.description} />
      <OptionKey index={index} raised={isSelected} />
    </AriaButton>
  );
}

function OtherRow({
  mode,
  index,
  label,
  placeholder,
  draft,
  isSelected,
  inputRef,
  onDraftChange,
  onSelectedChange,
  onSubmit,
}: {
  mode: QuestionnaireSelect;
  index: number;
  label: string;
  placeholder: string;
  draft: string;
  isSelected: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDraftChange: (text: string) => void;
  onSelectedChange: (selected: boolean) => void;
  onSubmit: () => void;
}) {
  // A press on the row itself lands in the field; the field and the checkbox
  // keep their own behaviour.
  const focusField = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, label")) return;
    inputRef.current?.focus();
  };

  return (
    <div
      className={cx(
        ROW,
        "cursor-text hover:bg-background-primary-hover",
        "has-[input:focus]:border-border-button-hover has-[input:focus]:bg-background-primary-hover",
        mode === "single" && isSelected && ROW_SELECTED,
      )}
      onClick={focusField}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-medium text-text-primary">{label}</span>
        <AriaInput
          ref={inputRef}
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onSubmit();
          }}
          className="m-0 h-5 w-full min-w-0 border-0 bg-transparent p-0 font-sans text-body-regular text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </span>
      {mode === "multiple" ? (
        <AriaCheckbox
          isSelected={isSelected}
          onChange={onSelectedChange}
          aria-label={label}
          className="flex shrink-0 cursor-pointer items-center py-1"
        >
          {(state) => <CheckboxGlyph state={state} />}
        </AriaCheckbox>
      ) : (
        <OptionKey index={index} raised={isSelected} />
      )}
    </div>
  );
}

export function Questionnaire({
  questions,
  select = "multiple",
  step: stepProp,
  defaultStep = 0,
  onStepChange,
  answers: answersProp,
  defaultAnswers,
  onAnswersChange,
  onComplete,
  onDismiss,
  advanceDelay = 180,
  labels,
  className,
}: QuestionnaireProps) {
  const reduce = useReducedMotion();
  const headingId = useId();
  const text = { ...DEFAULT_LABELS, ...labels };
  const total = questions.length;
  const lastIndex = Math.max(total - 1, 0);

  const [stepState, setStepState] = useState(() => clamp(defaultStep, 0, lastIndex));
  const step = clamp(stepProp ?? stepState, 0, lastIndex);

  const [answersState, setAnswersState] = useState<QuestionnaireAnswers>(defaultAnswers ?? {});
  const answers = answersProp ?? answersState;

  // Free text survives unticking the row and coming back to the question.
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {};
    for (const [id, answer] of Object.entries(defaultAnswers ?? {})) {
      if (answer.other !== undefined) seeded[id] = answer.other;
    }
    return seeded;
  });

  // Direction of travel for the slide, derived as the step changes so it stays
  // put while the previous question is still animating out.
  const [travel, setTravel] = useState({ step, direction: 1 });
  if (travel.step !== step) {
    setTravel({ step, direction: step > travel.step ? 1 : -1 });
  }
  const layoutDirection = useDirection();
  const direction = (travel.step === step ? travel.direction : step > travel.step ? 1 : -1) * (layoutDirection === "rtl" ? -1 : 1);

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);
  const advanceTimer = useRef<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  const setPanel = useCallback((node: HTMLDivElement | null) => {
    if (node) panelRef.current = node;
  }, []);

  const question = questions[step];
  const questionId = question?.id;

  // The card follows the visible question's height; the wrapper adds 4px of
  // breathing room above and below for the rows' focus rings.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => setHeight(panel.offsetHeight + 8);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [questionId]);

  // When the picked row unmounts with the old question, focus would fall to
  // the page; park it on the new question so the number keys keep working.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const root = rootRef.current;
    const panel = panelRef.current;
    const active = document.activeElement;
    if (root && panel && (!active || active === document.body || !root.contains(active))) {
      panel.focus({ preventScroll: true });
    }
  }, [questionId]);

  const clearAdvance = () => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  };
  useEffect(() => clearAdvance, [step]);

  if (!question) return null;

  const mode: QuestionnaireSelect = question.select ?? select;
  const answer = answers[question.id] ?? EMPTY_ANSWER;
  const draft = drafts[question.id] ?? "";
  const otherSelected = answer.other !== undefined;
  const hasOther = Boolean(question.other);
  const otherConfig = typeof question.other === "object" ? question.other : undefined;
  const otherLabel = otherConfig?.label ?? text.other;
  const otherPlaceholder = otherConfig?.placeholder ?? text.otherPlaceholder;
  const isLast = step === lastIndex;

  const commitAnswers = (next: QuestionnaireAnswers) => {
    if (answersProp === undefined) setAnswersState(next);
    onAnswersChange?.(next);
    return next;
  };
  const updateAnswer = (next: QuestionnaireAnswer) =>
    commitAnswers({ ...answers, [question.id]: next });

  const goTo = (index: number) => {
    const target = clamp(index, 0, lastIndex);
    if (target === step) return;
    clearAdvance();
    if (stepProp === undefined) setStepState(target);
    onStepChange?.(target);
  };

  const finish = (latest: QuestionnaireAnswers) => {
    if (isLast) onComplete?.(latest);
    else goTo(step + 1);
  };

  const scheduleAdvance = (latest: QuestionnaireAnswers) => {
    clearAdvance();
    advanceTimer.current = window.setTimeout(() => {
      advanceTimer.current = null;
      finish(latest);
    }, reduce ? 0 : advanceDelay);
  };

  const pick = (value: string) => scheduleAdvance(updateAnswer({ values: [value] }));

  const toggle = (value: string, selected: boolean) => {
    const chosen = new Set(answer.values);
    if (selected) chosen.add(value);
    else chosen.delete(value);
    const values = question.options.filter((o) => chosen.has(o.value)).map((o) => o.value);
    updateAnswer(otherSelected ? { values, other: answer.other } : { values });
  };

  const setOtherSelected = (selected: boolean) =>
    updateAnswer(selected ? { values: answer.values, other: draft } : { values: answer.values });

  const setDraft = (value: string) => {
    setDrafts((current) => ({ ...current, [question.id]: value }));
    if (mode === "single") {
      updateAnswer(value ? { values: [], other: value } : { values: [] });
    } else if (value) {
      updateAnswer({ values: answer.values, other: value });
    } else if (otherSelected) {
      updateAnswer({ values: answer.values });
    }
  };

  const submitOther = () => {
    if (mode === "single") {
      if (!draft.trim()) return;
      finish(updateAnswer({ values: [], other: draft }));
    } else {
      finish(answers);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== "single" || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    if (!/^[1-9]$/.test(event.key)) return;
    const index = Number(event.key) - 1;
    if (index < question.options.length) {
      event.preventDefault();
      pick(question.options[index].value);
    } else if (hasOther && index === question.options.length) {
      event.preventDefault();
      otherInputRef.current?.focus();
    }
  };

  const panelTransition = { duration: reduce ? 0 : 0.32, ease: EASE };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      className={cx(
        "relative flex w-full flex-col gap-2.5 overflow-hidden rounded-[20px] bg-background-primary-default p-3",
        // raw Figma effect, no token yet: 0 4px 2px 2% over 0 1px 0.5px 5%
        "shadow-[0_4px_2px_rgba(0,0,0,0.02),0_1px_0.5px_rgba(0,0,0,0.05)]",
        className,
      )}
    >
      <motion.div
        initial={false}
        animate={{ height: height ?? "auto" }}
        transition={{ duration: reduce ? 0 : 0.38, ease: EASE }}
        className="relative -mx-3 -my-1 overflow-hidden px-3 py-1"
      >
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={question.id}
            ref={setPanel}
            tabIndex={-1}
            custom={direction}
            variants={PANEL_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={panelTransition}
            className="flex flex-col gap-2.5 outline-none"
          >
            <div className={cx("flex min-h-5 items-start ps-0.5", onDismiss && "pe-7")}>
              <p id={headingId} className="text-body-medium text-text-primary">
                {question.question}
              </p>
            </div>
            <div role="group" aria-labelledby={headingId} className="flex flex-col gap-2">
              {question.options.map((option, index) =>
                mode === "multiple" ? (
                  <CheckboxRow
                    key={option.value}
                    option={option}
                    isSelected={answer.values.includes(option.value)}
                    onChange={(selected) => toggle(option.value, selected)}
                  />
                ) : (
                  <PickRow
                    key={option.value}
                    option={option}
                    index={index}
                    isSelected={answer.values.includes(option.value)}
                    onPick={() => pick(option.value)}
                  />
                ),
              )}
              {hasOther && (
                <OtherRow
                  mode={mode}
                  index={question.options.length}
                  label={otherLabel}
                  placeholder={otherPlaceholder}
                  draft={draft}
                  isSelected={otherSelected}
                  inputRef={otherInputRef}
                  onDraftChange={setDraft}
                  onSelectedChange={setOtherSelected}
                  onSubmit={submitOther}
                />
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {onDismiss && (
        <CloseButton
          size="xs"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="absolute top-3 end-3"
        />
      )}

      <div className="flex items-start justify-between gap-4 pt-0.5">
        <PillTabList aria-label="Steps" className="flex-wrap gap-2">
          {questions.map((entry, index) => (
            <PillTab key={entry.id} isSelected={index === step} onSelect={() => goTo(index)}>
              {entry.stepLabel ?? `Step ${index + 1}`}
            </PillTab>
          ))}
        </PillTabList>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <Button variant="secondary" size="small" disabled={step === 0} onClick={() => goTo(step - 1)}>
            {text.previous}
          </Button>
          <Button variant="primary" size="small" onClick={() => finish(answers)}>
            {isLast ? text.complete : text.next}
          </Button>
        </div>
      </div>
    </div>
  );
}

import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { RiArrowLeftSLine, RiArrowRightSLine, RiCheckLine, RiCloseLine, RiExternalLinkLine, RiShieldFlashLine, RiTerminalBoxLine } from '@remixicon/react';
import { Form } from 'react-aria-components';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { usageTotalTokens, type ConversationRuntime } from '@todex/protocol/conversationRuntime';
import type { ContextCompactionState } from '@todex/protocol/v2';
import { permissionActions, permissionDeviceGate, permissionRequestSummary, type PendingRequest, type PermissionOption } from '@todex/protocol/todex';
import { DESKTOP_BROWSER_ACTION_KIND, DESKTOP_BROWSER_GRANT_KIND } from '@todex/protocol/agentDesktop';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import type { UsageRecord } from '@todex/protocol/mobileParity';
import { ShimmerText } from '@/components/application/agent-log/agent-log';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { LinkButton } from '@/components/base/buttons/link-button';
import { CheckboxGlyph } from '@/components/base/checkbox/checkbox-glyph';
import { Input } from '@/components/base/input/input';
import { Kbd } from '@/components/base/kbd/kbd';
import { RadioDot } from '@/components/base/radio/radio';
import { Select, SelectItem } from '@/components/base/select/select';
import { Textarea } from '@/components/base/textarea/textarea';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import { useNoticeToast } from './NoticeToast';
import { getLocale, t, useLocale, useT } from '../i18n';
import { isMacLike } from '../lib/shortcuts';

type SubmissionStatus = 'sending' | 'running' | 'unknown' | undefined;
type Props = {
  submissionStatus?: SubmissionStatus;
  runtime?: ConversationRuntime;
  compaction?: ContextCompactionState & { recommended?: boolean };
  onRecover: () => Promise<void>;
  /** Codex performs context compaction automatically when its window fills. */
  automaticCompaction?: boolean;
};

export function ConversationRunStatus({ submissionStatus, runtime, compaction, onRecover, automaticCompaction = false }: Props) {
  const t = useT();
  const [recovering, setRecovering] = useState(false);
  const unknown = submissionStatus === 'unknown';
  useNoticeToast(unknown ? t('runStatus.unknown') : null, {
    description: t('runStatus.unknownHint'),
    scope: runtime?.conversationId,
  });
  useNoticeToast(compaction?.status === 'failed' ? t('runStatus.compactionFailed')
    : compaction?.status === 'completed' ? t('runStatus.compactionDone')
      : !automaticCompaction && compaction?.recommended && compaction.status !== 'running' ? t('runStatus.compactionSuggested') : null, {
    variant: compaction?.status === 'failed' ? 'danger' : compaction?.status === 'completed' ? 'success' : 'info',
    description: compaction?.status === 'failed' ? compaction.error : undefined,
    scope: runtime?.conversationId,
  });
  const recover = async () => {
    if (recovering) return;
    setRecovering(true);
    try { await onRecover(); }
    catch (error) { toast.danger(error instanceof Error ? error.message : t('runStatus.recoverFailed')); }
    finally { setRecovering(false); }
  };
  return <>
    {unknown ? <Button className="mb-2" size="small" variant="secondary" disabled={recovering} aria-busy={recovering || undefined}
      leadingIcon={recovering ? SpinnerIcon : undefined}
      onClick={() => { void recover(); }}>{t('runStatus.review')}</Button> : null}
    {compaction?.status === 'running' ? <div className="mb-2 flex items-center text-caption-1-medium" role="status">
      <ShimmerText>{t('runStatus.compacting')}</ShimmerText>
    </div> : null}
  </>;
}

type PromptStatus = 'ready' | 'submitted' | 'streaming' | 'error';

type ConversationPromptInputContextValue = {
  value: string;
  status: PromptStatus;
  isDisabled: boolean;
  /** Submits through the composer's submission guard. */
  submit: () => void;
  stop?: () => void;
  setValue: (value: string) => void;
};

const ConversationPromptInputContext = createContext<ConversationPromptInputContextValue | null>(null);

/** The composer state for controls inside `ConversationPromptInput` (send / stop buttons, fields). */
export function useConversationPromptInput() {
  return useContext(ConversationPromptInputContext);
}

export type ConversationPromptInputProps = Omit<ComponentPropsWithRef<'div'>, 'onSubmit'> & {
  submissionStatus?: SubmissionStatus;
  value?: string;
  status?: PromptStatus;
  isDisabled?: boolean;
  onSubmit?: () => void;
  onStop?: () => void;
  onValueChange?: (value: string) => void;
  children: ReactNode;
};

/** Keep the submission guard at the actual composer boundary, including Enter.
 * The root is a plain wrapper; the composer card surface (BoardUI composer
 * panel recipe) belongs to the shell rendered inside it. */
export function ConversationPromptInput({ submissionStatus, onSubmit, isDisabled, status, value = '', onStop, onValueChange, className, children, ...props }:
  ConversationPromptInputProps) {
  const blocked = submissionStatus === 'unknown' || submissionStatus === 'sending';
  const resolvedStatus: PromptStatus = submissionStatus === 'sending' ? 'submitted' : status ?? 'ready';
  const disabled = Boolean(isDisabled || submissionStatus === 'unknown');
  const context = useMemo<ConversationPromptInputContextValue>(() => ({
    value,
    status: resolvedStatus,
    isDisabled: disabled,
    submit: () => { if (!blocked) onSubmit?.(); },
    stop: onStop,
    setValue: (next) => onValueChange?.(next),
  }), [value, resolvedStatus, disabled, blocked, onSubmit, onStop, onValueChange]);
  return <ConversationPromptInputContext.Provider value={context}>
    <div {...props} data-status={resolvedStatus} data-disabled={disabled || undefined} className={cx('flex w-full min-w-0 flex-col', className)}>
      {children}
    </div>
  </ConversationPromptInputContext.Provider>;
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat(getLocale(), { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}
export function TurnUsageSummary({ records }: { records: readonly UsageRecord[] }) {
  const t = useT();
  const locale = useLocale();
  const listSeparator = locale === 'zh-CN' || locale === 'ja' ? '、' : ', ';
  const totals = records.reduce((sum, record) => ({
    input: sum.input + record.inputTokens, output: sum.output + record.outputTokens,
    cacheRead: sum.cacheRead + record.cachedInputTokens, cacheWrite: sum.cacheWrite + record.cacheWriteTokens,
    total: sum.total + usageTotalTokens(record),
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  return <div className="flex min-w-52 flex-col gap-1 p-1 text-caption-1-regular text-text-primary">
    <p className="text-caption-1-medium">{t('runStatus.turnStats')}</p>
    {records.length ? <>
      <p className="text-text-secondary">{t('runStatus.models', { models: [...new Set(records.map(record => record.model))].join(listSeparator) })}</p>
      <p className="tabular-nums">{t('runStatus.inOut', { input: formatTokenCount(totals.input), output: formatTokenCount(totals.output) })}</p>
      <p className="tabular-nums">{t('runStatus.cache', { read: formatTokenCount(totals.cacheRead), write: formatTokenCount(totals.cacheWrite) })}</p>
      <p className="tabular-nums">{t('runStatus.total', { total: formatTokenCount(totals.total) })}</p>
    </> : <p className="text-text-secondary">{t('runStatus.noUsage')}</p>}
  </div>;
}


type PermissionAnswerData = Record<string, unknown>;
type PermissionField = {
  id: string;
  label: string;
  /** Short chip title of a `user_input` question (Claude `header`). */
  header?: string;
  description?: string;
  type: 'string' | 'number' | 'integer' | 'boolean';
  required: boolean;
  multiline?: boolean;
  secret?: boolean;
  choices?: { label: string; value: string | number | boolean; description?: string }[];
  /** Choices accept several picks (Claude `multiSelect`); the value holds
   * comma-joined choice indices. */
  multiple?: boolean;
  /** Choices also accept a free-text answer (`isOther`): added to the picks
   * of a multi-select, and used only when nothing is picked otherwise. */
  other?: boolean;
  initial?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
};
type PermissionForm = {
  fields: PermissionField[];
  mode: 'elicitation' | 'user_input' | 'extension_ui' | 'url';
  method?: string;
  url?: string;
  unsupported?: boolean;
};
const permissionObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const permissionString = (value: unknown): string => typeof value === 'string' ? value : '';

function permissionForm(request: PendingRequest): PermissionForm | null {
  const details = permissionObject(request.data.details);
  const kind = permissionString(request.data.kind);
  if (kind === 'elicitation' && details.mode === 'url') {
    let url: string | undefined;
    try { const parsed = new URL(permissionString(details.url)); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href; } catch { /* invalid links are not opened */ }
    return { mode: 'url', fields: [], url, unsupported: !url };
  }
  if (kind === 'elicitation') {
    const schema = permissionObject(details.requestedSchema ?? details.schema);
    const properties = permissionObject(schema.properties);
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [];
    let unsupported = (!Object.keys(schema).length) || (schema.type !== undefined && schema.type !== 'object')
      || required.some(key => !Object.hasOwn(properties, key));
    const fields = Object.entries(properties).flatMap(([id, raw]): PermissionField[] => {
      const property = permissionObject(raw);
      const enumValues = Array.isArray(property.enum) ? property.enum : property.const !== undefined ? [property.const] : undefined;
      const type = property.type ?? (enumValues?.length ? typeof enumValues[0] : 'string');
      if (!['string', 'number', 'integer', 'boolean'].includes(String(type))
        || enumValues?.some(value => !['string', 'number', 'boolean'].includes(typeof value))) {
        unsupported = true;
        return [];
      }
      const choices = enumValues?.map(value => ({ label: String(value), value: value as string | number | boolean }));
      const field: PermissionField = {
        id, label: permissionString(property.title) || id, description: permissionString(property.description),
        type: type as PermissionField['type'], required: required.includes(id), choices,
        minimum: typeof property.minimum === 'number' ? property.minimum : undefined,
        maximum: typeof property.maximum === 'number' ? property.maximum : undefined,
        minLength: typeof property.minLength === 'number' ? property.minLength : undefined,
        maxLength: typeof property.maxLength === 'number' ? property.maxLength : undefined,
      };
      if (property.default !== undefined) {
        const index = choices?.findIndex(choice => choice.value === property.default);
        field.initial = choices ? index !== undefined && index >= 0 ? String(index) : '' : String(property.default);
      }
      return [field];
    });
    return { mode: 'elicitation', fields, unsupported };
  }
  if (kind === 'user_input') {
    const questions = Array.isArray(details.questions) ? details.questions : [];
    let unsupported = !questions.length;
    const fields = questions.flatMap((raw): PermissionField[] => {
      const question = permissionObject(raw);
      const id = permissionString(question.id);
      if (!id) { unsupported = true; return []; }
      // `isOther` adds a free-form answer next to the options; without
      // options the text field is the whole answer.
      const choices = Array.isArray(question.options) ? question.options.map(option => {
        const item = permissionObject(option); const label = permissionString(item.label) || permissionString(option);
        return { label, value: label, description: permissionString(item.description) || undefined };
      }).filter(option => option.label) : [];
      return [{ id, label: permissionString(question.question) || permissionString(question.header) || id,
        header: permissionString(question.header) || undefined,
        type: 'string', required: true, secret: question.isSecret === true,
        choices: choices.length ? choices : undefined,
        multiple: choices.length > 0 && question.multiSelect === true,
        other: choices.length > 0 && question.isOther === true }];
    });
    return { mode: 'user_input', fields, unsupported };
  }
  if (kind === 'extension_ui') {
    const method = permissionString(details.method);
    if (!['confirm', 'select', 'input', 'editor'].includes(method)) return { mode: 'extension_ui', method, fields: [], unsupported: true };
    const choices = method === 'select' && Array.isArray(details.options)
      ? details.options.filter((value): value is string => typeof value === 'string').map(value => ({ label: value, value })) : undefined;
    return { mode: 'extension_ui', method, unsupported: method === 'select' && !choices?.length,
      fields: [{ id: method === 'confirm' ? 'confirmed' : 'value', label: permissionString(details.message) || permissionString(details.title) || (method === 'confirm' ? t('runStatus.confirmQuestion') : t('runStatus.yourAnswer')),
        type: method === 'confirm' ? 'boolean' : 'string', required: true, choices,
        multiline: method === 'editor', initial: method === 'editor' ? permissionString(details.prefill) : undefined }] };
  }
  return null;
}

function permissionFormAnswer(form: PermissionForm, values: Record<string, string>, others: Record<string, string> = {}): { data?: PermissionAnswerData; error?: string } {
  if (form.unsupported) return { error: t('runStatus.unsupportedForm') };
  if (form.mode === 'url') return { data: { completed: true } };
  const data: PermissionAnswerData = Object.create(null) as PermissionAnswerData;
  for (const field of form.fields) {
    const text = values[field.id] ?? field.initial ?? '';
    const otherText = field.other ? (others[field.id] ?? '').trim() : '';
    if (!text.trim()) {
      if (otherText) { data[field.id] = [otherText]; continue; }
      if (field.required) return { error: t('runStatus.fieldRequired', { label: field.label }) };
      continue;
    }
    if (field.multiple && field.choices) {
      const choices = field.choices;
      const indices = text.split(',').map(Number);
      if (indices.some(index => !Number.isInteger(index) || !choices[index])) return { error: t('runStatus.fieldChoose', { label: field.label }) };
      data[field.id] = [...indices.map(index => choices[index].value), ...(otherText ? [otherText] : [])];
      continue;
    }
    let value: string | number | boolean = text;
    if (field.choices) {
      const index = Number(text);
      if (!Number.isInteger(index) || !field.choices[index]) return { error: t('runStatus.fieldChoose', { label: field.label }) };
      value = field.choices[index].value;
    } else if (field.type === 'boolean') {
      if (!['true', 'false'].includes(text)) return { error: t('runStatus.fieldChoose', { label: field.label }) };
      value = text === 'true';
    } else if (field.type === 'number' || field.type === 'integer') {
      value = Number(text);
      if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) return { error: t(field.type === 'integer' ? 'runStatus.fieldInteger' : 'runStatus.fieldNumber', { label: field.label }) };
      if ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)) return { error: t('runStatus.fieldRange', { label: field.label }) };
    }
    if (typeof value === 'string' && ((field.minLength !== undefined && value.length < field.minLength) || (field.maxLength !== undefined && value.length > field.maxLength))) return { error: t('runStatus.fieldLength', { label: field.label }) };
    data[field.id] = value;
  }
  if (form.mode === 'user_input') return { data: { answers: Object.fromEntries(Object.entries(data).map(([id, value]) => [id, { answers: Array.isArray(value) ? value.map(String) : [String(value)] }])) } };
  return { data };
}

const isRejectOption = (option: boolean | PermissionOption) =>
  typeof option === 'boolean' ? !option : option.kind.startsWith('reject') || option.kind === 'abort_turn';
const rejectLabel = (option: boolean | PermissionOption) =>
  typeof option === 'boolean' ? t('runStatus.reject') : option.kind === 'abort_turn' ? t('runStatus.rejectStop') : option.name;

function PermissionResponseForm({ request, form, onSelect }: { request: PendingRequest; form: PermissionForm;
  onSelect: (option: boolean | PermissionOption, data?: PermissionAnswerData) => void }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const options = permissionActions(request);
  const submit = options.find(option => typeof option !== 'boolean' && option.kind === 'answer');
  const update = (id: string, value: string) => setValues(previous => ({ ...previous, [id]: value }));
  const permissionFieldInput = (field: PermissionField) => {
    const value = values[field.id] ?? field.initial ?? '';
    return field.choices || field.type === 'boolean' ? <Select
      key={field.id}
      className="w-full min-w-0"
      triggerClassName="min-w-0"
      popoverClassName="w-(--trigger-width)"
      label={field.label}
      hint={field.description || undefined}
      placeholder={t('runStatus.selectPlaceholder')}
      isRequired={field.required}
      selectedKey={value || null}
      onSelectionChange={key => update(field.id, key === null ? '' : String(key))}
    >
      {field.choices ? field.choices.map((choice, choiceIndex) => <SelectItem key={choiceIndex} id={String(choiceIndex)} textValue={choice.label}>{choice.label}</SelectItem>)
        : [<SelectItem key="true" id="true" textValue={t('runStatus.yes')}>{t('runStatus.yes')}</SelectItem>,
          <SelectItem key="false" id="false" textValue={t('runStatus.no')}>{t('runStatus.no')}</SelectItem>]}
    </Select> : field.multiline ? <Textarea
      key={field.id}
      className="w-full"
      label={field.label}
      hint={field.description || undefined}
      rows={4}
      value={value}
      onChange={text => update(field.id, text)}
      isRequired={field.required}
    /> : <Input
      key={field.id}
      className="w-full"
      label={field.label}
      hint={field.description || undefined}
      type={field.secret ? 'password' : 'text'}
      inputMode={field.type === 'number' || field.type === 'integer' ? 'decimal' : undefined}
      autoComplete="off"
      value={value}
      onChange={text => update(field.id, text)}
      isRequired={field.required}
    />;
  };
  useNoticeToast(form.unsupported ? t('runStatus.unsupportedForm') : null);
  return <Form className="flex w-full min-w-0 flex-col gap-3 py-2" onSubmit={event => {
    event.preventDefault();
    if (!submit) return;
    const answer = permissionFormAnswer(form, values);
    if (answer.error) { toast.danger(answer.error); return; }
    onSelect(submit, answer.data);
  }}>
    {form.mode === 'url' && form.url ? <div className="flex flex-col items-start gap-1">
      <LinkButton href={form.url} target="_blank" rel="noopener noreferrer" trailingIcon={RiExternalLinkLine}>{t('runStatus.openVerify')}</LinkButton>
      {/* The agent picks this address: show where it leads before it opens. */}
      <bdi dir="ltr" className="text-caption-1-regular text-text-tertiary">{new URL(form.url).host}</bdi>
      <p className="text-body-2-regular text-text-secondary">{t('runStatus.verifyHint')}</p>
    </div> : null}
    {form.fields.map(permissionFieldInput)}
    <div className="flex flex-wrap gap-2">
      {submit ? <Button size="small" type="submit" disabled={form.unsupported}>{form.mode === 'url' ? t('runStatus.urlDone') : t('runStatus.submitAnswer')}</Button> : null}
      {options.filter(isRejectOption).map(option => <Button
        key={typeof option === 'boolean' ? String(option) : option.optionId} type="button" size="small" variant="danger" onClick={() => onSelect(option)}
      >{rejectLabel(option)}</Button>)}
    </div>
  </Form>;
}

const DECK_EASE = [0.32, 0.72, 0, 1] as const;
const DECK_OFF_LEFT = { x: '-55%', y: 0, scale: 1, rotate: -4, opacity: 0 };
const DECK_IN_STACK = { x: 0, y: 8, scale: 0.965, rotate: 0 };
/** `custom` is the paging direction. Forward: the card leaves to the left and
 * the next one rises out of the stack beneath. Backward: the previous card
 * returns from the left while the current one sinks back into the stack. */
const deckCardVariants: Variants = {
  enter: (direction: number) => direction > 0 ? { ...DECK_IN_STACK, opacity: 0.4 } : DECK_OFF_LEFT,
  center: { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, transition: { duration: 0.34, ease: DECK_EASE } },
  exit: (direction: number) => ({ ...(direction > 0 ? DECK_OFF_LEFT : { ...DECK_IN_STACK, opacity: 0 }),
    transition: { duration: 0.28, ease: DECK_EASE } }),
};
const deckFadeVariants: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/* Answer rows in the BoardUI Questionnaire recipe: bordered radius-2xl rows on
 * the card surface, lifted when hovered, focused or chosen. */
const DECK_ROW = 'group flex w-full items-center gap-3 rounded-2xl border border-border-button-default bg-background-primary-default py-[9px] ps-[11px] pe-[15px] text-start outline-none transition-colors duration-150 ease';
const DECK_ROW_SELECTED = 'border-border-button-hover bg-background-primary-hover';
/* The cards waiting beneath the current one peek out of the stack. */
const DECK_GHOST = 'absolute inset-x-0 top-0 bottom-3 origin-bottom rounded-[20px] border border-border-button-default bg-background-primary-default transition-[translate,scale,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none';

/** The number key that picks a row; one tone further when the row is chosen. */
function DeckOptionKey({ index, raised }: { index: number; raised: boolean }) {
  return <span aria-hidden="true" className={cx(
    'inline-flex min-w-5 shrink-0 items-center justify-center rounded-sm px-[5px] py-0.5 text-body-2-medium text-text-primary',
    'bg-questionnaire-key-background transition-colors duration-150 ease group-hover:bg-questionnaire-key-hover-background',
    raised && 'bg-questionnaire-key-hover-background',
  )}>{index + 1}</span>;
}

function DeckKey({ children }: { children: ReactNode }) {
  return <Kbd className="min-w-5 px-1.5 py-0 text-caption-2-semibold">{children}</Kbd>;
}

const questionPicks = (value: string | undefined) => new Set((value ?? '').split(',').filter(Boolean).map(Number));
const questionAnswered = (field: PermissionField, values: Record<string, string>, others: Record<string, string>) =>
  Boolean((values[field.id] ?? '').trim()) || Boolean(field.other && (others[field.id] ?? '').trim());

/** `user_input` questions shown one card at a time: the options, then the
 * optional custom answer as the last row. For single-choice questions the
 * custom answer and the options are mutually exclusive. */
function UserInputQuestions({ request, form, onSelect }: { request: PendingRequest; form: PermissionForm;
  onSelect: (option: boolean | PermissionOption, data?: PermissionAnswerData) => void }) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const { fields } = form;
  const [[index, direction], setPage] = useState<[number, number]>([0, 1]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [others, setOthers] = useState<Record<string, string>>({});
  const [switching, setSwitching] = useState(false);
  const [height, setHeight] = useState<number>();
  const viewportRef = useRef<HTMLDivElement>(null);
  const focusAfterSwitch = useRef(false);
  const idPrefix = React.useId();
  const options = permissionActions(request);
  const submit = options.find(option => typeof option !== 'boolean' && option.kind === 'answer');
  const field = fields[index];
  const last = index === fields.length - 1;
  const answered = fields.map(item => questionAnswered(item, values, others));
  const picks = questionPicks(values[field.id]);
  const otherText = others[field.id] ?? '';
  const otherSelected = Boolean(field.other && otherText.trim() && (field.multiple || !picks.size));
  const choiceCount = (field.choices?.length ?? 0) + (field.other ? 1 : 0);
  const questionId = `${idPrefix}-question`;
  const cardSelector = `[data-question-index="${index}"]`;

  // The viewport follows the current card's height; the exiting card is popped
  // out of flow, so it cannot be measured from layout alone.
  useLayoutEffect(() => {
    const card = viewportRef.current?.querySelector<HTMLElement>(cardSelector);
    if (!card || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(card.offsetHeight));
    observer.observe(card);
    return () => observer.disconnect();
  }, [cardSelector]);
  useEffect(() => {
    if (!focusAfterSwitch.current) return;
    focusAfterSwitch.current = false;
    const card = viewportRef.current?.querySelector<HTMLElement>(cardSelector);
    const target = card?.querySelector<HTMLElement>('[data-selected="true"] input') ?? card?.querySelector<HTMLElement>('input, textarea');
    target?.focus({ preventScroll: true });
  }, [cardSelector]);

  const goTo = (target: number, focus = true) => {
    if (target === index || target < 0 || target >= fields.length) return;
    focusAfterSwitch.current = focus;
    setSwitching(true);
    setPage([target, target > index ? 1 : -1]);
  };
  const pick = (choice: number) => {
    if (!field.choices) return;
    if (choice === field.choices.length && field.other) {
      viewportRef.current?.querySelector<HTMLInputElement>(`${cardSelector} [data-other-answer]`)?.focus();
      return;
    }
    if (!field.choices[choice]) return;
    setValues(previous => {
      if (!field.multiple) return { ...previous, [field.id]: String(choice) };
      const next = questionPicks(previous[field.id]);
      if (next.has(choice)) next.delete(choice); else next.add(choice);
      return { ...previous, [field.id]: [...next].sort((a, b) => a - b).join(',') };
    });
  };
  // Typing or returning to a custom answer selects it in place of a single pick.
  const selectOther = (text: string) => {
    if (!field.multiple && text.trim() && values[field.id]) setValues(previous => ({ ...previous, [field.id]: '' }));
  };
  const advance = () => {
    if (!answered[index]) return;
    if (!last) { goTo(index + 1); return; }
    const missing = answered.indexOf(false);
    if (missing >= 0) { goTo(missing); return; }
    if (!submit) return;
    const answer = permissionFormAnswer(form, values, others);
    if (answer.error) { toast.danger(answer.error); return; }
    onSelect(submit, answer.data);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    const multiline = target instanceof HTMLTextAreaElement;
    const typing = multiline || (target instanceof HTMLInputElement && target.type !== 'radio' && target.type !== 'checkbox');
    if (event.key === 'Enter' && !event.shiftKey) {
      // Buttons (steps, paging, reject) keep their own Enter activation.
      if (target.closest('button') || (multiline && !(isMacLike ? event.metaKey : event.ctrlKey))) return;
      event.preventDefault();
      advance();
      return;
    }
    if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(index + (event.key === 'ArrowRight' ? 1 : -1));
    } else if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      pick(Number(event.key) - 1);
    }
  };

  const headerOf = (item: PermissionField, position: number) => item.header || t('runStatus.questionNumber', { index: position + 1 });
  const remaining = fields.length - 1 - index;
  const mark = (selected: boolean) => field.multiple
    ? <CheckboxGlyph state={{ isSelected: selected, isIndeterminate: false, isFocusVisible: false, isDisabled: false, isHovered: false }} />
    : <RadioDot size="sm" selected={selected} />;
  const body = field.choices ? <div className="flex flex-col gap-2" role={field.multiple ? 'group' : 'radiogroup'}
    aria-labelledby={questionId} data-multiple={field.multiple || undefined}>
    {field.choices.map((choice, choiceIndex) => {
      const selected = picks.has(choiceIndex);
      return <label key={choiceIndex} data-selected={selected || undefined} className={cx(
        DECK_ROW, 'cursor-pointer select-none hover:bg-background-primary-hover active:bg-background-primary-active',
        'has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-border-focus-ring',
        selected && DECK_ROW_SELECTED,
      )}>
        <input className="sr-only" type={field.multiple ? 'checkbox' : 'radio'} name={`${idPrefix}-${field.id}`}
          checked={selected} onChange={() => pick(choiceIndex)} />
        <DeckOptionKey index={choiceIndex} raised={selected} />
        <span className="flex min-w-0 flex-1 flex-col wrap-anywhere">
          <span className="text-body-medium text-text-primary">{choice.label}</span>
          {choice.description ? <span className="text-body-regular text-text-secondary">{choice.description}</span> : null}
        </span>
        {mark(selected)}
      </label>;
    })}
    {field.other ? <label data-selected={otherSelected || undefined} className={cx(
      DECK_ROW, 'cursor-text hover:bg-background-primary-hover',
      'has-[input:focus]:border-border-button-hover has-[input:focus]:bg-background-primary-hover',
      otherSelected && DECK_ROW_SELECTED,
    )}>
      <DeckOptionKey index={field.choices.length} raised={otherSelected} />
      <input data-other-answer type="text" autoComplete="off" value={otherText}
        className="m-0 h-5 min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-body-regular text-text-primary outline-none placeholder:text-text-tertiary"
        aria-label={t('runStatus.customAnswer')} placeholder={field.multiple ? t('runStatus.customAnswerExtra') : t('runStatus.customAnswerPlaceholder')}
        onFocus={() => selectOther(otherText)}
        onChange={event => { setOthers(previous => ({ ...previous, [field.id]: event.target.value })); selectOther(event.target.value); }} />
      {mark(otherSelected)}
    </label> : null}
  </div> : field.secret ? <Input className="w-full" aria-labelledby={questionId} type="password" autoComplete="off"
    value={values[field.id] ?? ''} onChange={text => setValues(previous => ({ ...previous, [field.id]: text }))} />
    : <Textarea className="w-full" aria-labelledby={questionId} rows={3} placeholder={t('runStatus.freeAnswerPlaceholder')}
      value={values[field.id] ?? ''} onChange={text => setValues(previous => ({ ...previous, [field.id]: text }))} />;
  const multilineAnswer = !field.choices && !field.secret;

  return <div className="flex w-full min-w-0 flex-col gap-2.5 py-1" onKeyDown={onKeyDown}>
    {fields.length > 1 ? <div className="flex items-center gap-2">
      <nav className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={t('runStatus.questionList')}>
        {fields.map((item, position) => {
          const current = position === index;
          return <button key={item.id} type="button" aria-current={current ? 'step' : undefined} data-answered={answered[position] || undefined}
            onClick={() => goTo(position, false)}
            className={cx(
              'flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-[5px] text-body-medium whitespace-nowrap outline-none',
              'transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring',
              current ? 'bg-pill-tab-blue-selected-background text-accent-500'
                : cx('hover:bg-pill-tab-blue-hover-background', answered[position] ? 'text-text-primary' : 'text-text-secondary'),
            )}>
            {answered[position]
              ? <RiCheckLine aria-hidden="true" className="size-4 shrink-0 text-status-lime-text" />
              : <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full bg-current', !current && 'opacity-50')} />}
            {headerOf(item, position)}
          </button>;
        })}
      </nav>
      <span className="shrink-0 text-caption-1-regular text-text-secondary tabular-nums" aria-live="polite">{index + 1} / {fields.length}</span>
    </div> : null}
    <div className="relative pb-3">
      <div aria-hidden="true" className={cx(DECK_GHOST, remaining >= 2 ? 'translate-y-3 scale-[0.93] opacity-45' : 'scale-90 opacity-0')} />
      <div aria-hidden="true" className={cx(DECK_GHOST, remaining >= 1 ? 'translate-y-1.5 scale-[0.965] opacity-75' : 'scale-90 opacity-0')} />
      {/* Clip only while cards fly in and out so the resting card keeps its shadow. */}
      <motion.div ref={viewportRef} className="relative rounded-[20px] data-[switching]:overflow-clip" data-switching={switching || undefined}
        initial={false} animate={height === undefined ? undefined : { height }}
        transition={switching && !reduceMotion ? { duration: 0.34, ease: DECK_EASE } : { duration: 0 }}>
        <AnimatePresence initial={false} mode="popLayout" custom={direction} onExitComplete={() => setSwitching(false)}>
          <motion.section key={field.id} data-question-index={index} aria-labelledby={questionId}
            className="relative rounded-[20px] border border-border-button-default bg-background-primary-default p-3 shadow-card"
            custom={direction} variants={reduceMotion ? deckFadeVariants : deckCardVariants} initial="enter" animate="center" exit="exit">
            <div className="mb-1.5 flex items-center gap-2 text-caption-1-regular text-text-secondary">
              <Chip variant="caption" color="blue" className="py-0.5">{headerOf(field, index)}</Chip>
              <span>{!field.choices ? t('runStatus.freeAnswer') : field.multiple ? t('runStatus.multiChoice') : t('runStatus.singleChoice')}</span>
            </div>
            <h3 id={questionId} className="mb-3 text-body-medium text-pretty wrap-anywhere text-text-primary">{field.label}</h3>
            {body}
            {/* Key hints only help with a keyboard at hand. */}
            <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-caption-1-regular text-text-secondary pointer-coarse:hidden" aria-hidden="true">
              {choiceCount ? <span className="inline-flex items-center gap-1"><DeckKey>1</DeckKey>–<DeckKey>{choiceCount}</DeckKey> {t('runStatus.hintChoose')}</span> : null}
              {fields.length > 1 ? <span className="inline-flex items-center gap-1"><DeckKey>←</DeckKey><DeckKey>→</DeckKey> {t('runStatus.hintPage')}</span> : null}
              <span className="inline-flex items-center gap-1"><DeckKey>{multilineAnswer ? (isMacLike ? '⌘' : 'Ctrl ') : null}↵</DeckKey> {last ? t('runStatus.hintSubmit') : t('runStatus.hintNext')}</span>
            </p>
          </motion.section>
        </AnimatePresence>
      </motion.div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1">
        {options.filter(isRejectOption).map(option => <button key={typeof option === 'boolean' ? String(option) : option.optionId} type="button"
          className="cursor-pointer rounded-2lg px-2 py-1.5 text-body-medium text-text-error-primary outline-none transition-colors duration-150 ease hover:bg-background-tertiary-error focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          onClick={() => onSelect(option)}>{rejectLabel(option)}</button>)}
      </div>
      <div className="ms-auto flex gap-2">
        {fields.length > 1 ? <Button size="small" variant="secondary" disabled={index === 0} leadingIcon={RiArrowLeftSLine} onClick={() => goTo(index - 1)}>
          {t('runStatus.prevQuestion')}
        </Button> : null}
        {!last ? <Button size="small" disabled={!answered[index]} trailingIcon={RiArrowRightSLine} onClick={advance}>{t('runStatus.nextQuestion')}</Button>
          : submit ? <Button size="small" disabled={!answered.every(Boolean)} onClick={advance}>{t('runStatus.submitAnswer')}</Button> : null}
      </div>
    </div>
  </div>;
}

export function ConversationPermissionActions({ request, deviceSecret, onSelect }:
  { request: PendingRequest; deviceSecret?: string; onSelect: (option: boolean | PermissionOption, data?: PermissionAnswerData) => void }) {
  const t = useT();
  // Only requests that name their answering devices need this device's id.
  const gate = useMemo(() => permissionDeviceGate(request, Array.isArray(request.data.allowedDeviceIds)
    ? deviceIdentityFromSecret(deviceSecret)?.deviceId
    : undefined), [deviceSecret, request]);
  if (!gate.allowed) {
    return <p className="text-caption-1-regular text-text-secondary">{gate.deviceNames.length
      ? t('runStatus.answerOnDevice', { devices: gate.deviceNames.join(', ') })
      : t('runStatus.answerOnOtherDevice')}</p>;
  }
  const form = permissionForm(request);
  if (form?.mode === 'user_input' && !form.unsupported) return <UserInputQuestions key={request.requestId} request={request} form={form} onSelect={onSelect} />;
  if (form) return <PermissionResponseForm key={request.requestId} request={request} form={form} onSelect={onSelect} />;
  return <div className="flex flex-wrap gap-2">{permissionActions(request).map(option => {
    const allow = typeof option === 'boolean' ? option : option.kind.startsWith('allow');
    const reject = typeof option === 'boolean' ? !option : option.kind.startsWith('reject') || option.kind === 'abort_turn';
    return <Button
      key={typeof option === 'boolean' ? String(option) : option.optionId}
      size="small"
      // Allow / reject carry their glyph so they read at a glance; other kinds keep the accent.
      variant={reject ? 'danger' : 'primary'}
      leadingIcon={allow ? RiCheckLine : reject ? RiCloseLine : undefined}
      onClick={() => onSelect(option)}
    >
      {permissionOptionLabel(option, t)}
    </Button>;
  })}</div>;
}

/// Backends send English option names; localize the shared approval ones and
/// keep provider-specific names (plan review, elicitation) as sent.
function permissionOptionLabel(option: boolean | PermissionOption, t: ReturnType<typeof useT>): string {
  if (typeof option === 'boolean') return option ? t('runStatus.approve') : t('runStatus.reject');
  if (option.kind === 'abort_turn') return t('runStatus.rejectStop');
  switch (option.name) {
    case 'Allow once': return t('runStatus.allowOnce');
    case 'Allow for session': return t('runStatus.allowSession');
    // The agent tools' own approvals (MCP tool, desktop browser grant).
    case 'Always allow in this conversation':
    case 'Allow for this conversation': return t('runStatus.allowConversation');
    case 'Reject':
    case 'Deny':
    case 'Decline': return t('runStatus.reject');
    default: return option.name;
  }
}

/// The backend titles its desktop browser approvals in English; build them
/// from the structured details instead.
function desktopBrowserTitle(request: PendingRequest, t: ReturnType<typeof useT>): string | undefined {
  const kind = permissionString(request.data.kind);
  const details = permissionObject(request.data.details);
  if (kind === DESKTOP_BROWSER_GRANT_KIND && permissionString(details.host)) return t('agentBrowser.grantTitle', { host: permissionString(details.host) });
  if (kind === DESKTOP_BROWSER_ACTION_KIND && permissionString(details.action)) return t('agentBrowser.actionTitle', { action: permissionString(details.action) });
  return undefined;
}

/// Composer-side approval card: says what will run (the full command, never
/// clipped) and why the provider asked before offering the actions.
export function PermissionRequestCard({ request, fallbackTitle, deviceSecret, onSelect }: {
  request: PendingRequest;
  fallbackTitle: string;
  deviceSecret?: string;
  onSelect: (option: boolean | PermissionOption, data?: PermissionAnswerData) => void;
}) {
  const t = useT();
  const summary = useMemo(() => permissionRequestSummary(request), [request]);
  const heading = summary.command ? t('runStatus.runCommand')
    : summary.tool ? t('runStatus.useTool', { tool: summary.tool })
      : desktopBrowserTitle(request, t) ?? fallbackTitle;
  return <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-border-button-default bg-background-primary-default p-3 shadow-xs">
    <div className="flex items-start gap-2">
      {summary.command ? <RiTerminalBoxLine className="mt-0.5 size-4 shrink-0 text-foreground-icon-secondary" aria-hidden /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-body-medium text-text-primary">{heading}</p>
        {summary.description ? <p className="mt-0.5 text-body-2-regular text-text-secondary">{summary.description}</p> : null}
      </div>
      {summary.tool && summary.command ? <code className="shrink-0 rounded-md bg-background-tertiary-default px-1.5 py-0.5 font-mono text-caption-2-medium text-text-secondary">{summary.tool}</code> : null}
    </div>
    {summary.reason ? <div className="flex items-start gap-1.5 rounded-lg bg-status-yellow-background px-2 py-1.5 text-caption-1-regular text-text-primary">
      <RiShieldFlashLine className="mt-px size-3.5 shrink-0 text-status-yellow-text" aria-hidden />
      <p className="min-w-0 wrap-anywhere">
        {summary.safetyCheck ? <span className="text-caption-1-semibold text-status-yellow-text">{t('runStatus.safetyCheck')} · </span> : null}
        {summary.reason}
        {summary.safetyCheck ? <span className="text-text-secondary"> {t('runStatus.safetyCheckHint')}</span> : null}
      </p>
    </div> : null}
    {summary.command ? <pre className="max-h-60 overflow-auto rounded-lg bg-background-secondary-default px-3 py-2 font-mono text-caption-1-regular whitespace-pre-wrap wrap-anywhere text-text-primary select-text">{summary.command}</pre> : null}
    {summary.cwd ? <p className="font-mono text-caption-2-regular wrap-anywhere text-text-secondary">{t('runStatus.cwd')}: {summary.cwd}</p> : null}
    <ConversationPermissionActions request={request} deviceSecret={deviceSecret} onSelect={onSelect} />
  </div>;
}

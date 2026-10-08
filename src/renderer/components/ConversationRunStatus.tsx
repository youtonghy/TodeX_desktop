import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { toast, Button, Description, Form, Input, Kbd, Label, Link, TextArea, TextField } from '@heroui/react';
import { Check, ChevronLeft, ChevronRight, ShieldExclamation, Terminal, Xmark } from '@gravity-ui/icons';
import { NativeSelect } from '@heroui-pro/react/native-select';
import { PromptInput } from '@heroui-pro/react/prompt-input';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { usageTotalTokens, type ConversationRuntime } from '@todex/protocol/conversationRuntime';
import type { ContextCompactionState } from '@todex/protocol/v2';
import { permissionActions, permissionDeviceGate, permissionRequestSummary, type PendingRequest, type PermissionOption } from '@todex/protocol/todex';
import { DESKTOP_BROWSER_ACTION_KIND, DESKTOP_BROWSER_GRANT_KIND } from '@todex/protocol/agentDesktop';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import type { UsageRecord } from '@todex/protocol/mobileParity';
import { hasActiveConversationWork } from './conversationProgress';
import { useNoticeToast } from './NoticeToast';
import { getLocale, t, useLocale, useT } from '../i18n';
import { isMacLike } from '../lib/shortcuts';

type SubmissionStatus = 'sending' | 'running' | 'unknown' | undefined;
type Props = {
  submissionStatus?: SubmissionStatus;
  runtime?: ConversationRuntime;
  isRecovering?: boolean;
  isConnected?: boolean;
  compaction?: ContextCompactionState & { recommended?: boolean };
  onRecover: () => Promise<void>;
};

export function ConversationRunStatus({ submissionStatus, runtime, compaction, onRecover, isRecovering = false, isConnected = true }: Props) {
  const t = useT();
  const progressToastRef = useRef<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const unknown = submissionStatus === 'unknown';
  const running = runtime?.status === 'running';
  const activeWork = runtime ? hasActiveConversationWork(runtime, compaction) : false;
  const observeQuiet = running && !unknown && !activeWork && !isRecovering && isConnected;
  useEffect(() => {
    if (!observeQuiet) return;
    // Measure time observed on this client, so replayed timestamps and server
    // clock differences cannot produce an immediate stale warning.
    const observedAt = Date.now();
    let notified = false;
    const timer = window.setInterval(() => {
      if (notified || Date.now() - observedAt < 120_000) return;
      notified = true;
      progressToastRef.current = toast.info(t('runStatus.stale'), {
        description: t('runStatus.staleHint'),
        timeout: 6000,
      });
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      if (progressToastRef.current !== null) {
        toast.close(progressToastRef.current);
        progressToastRef.current = null;
      }
    };
  }, [observeQuiet, runtime?.conversationId, runtime?.activeTurnId, runtime?.lastProgressAt]);
  useNoticeToast(unknown ? t('runStatus.unknown') : null, {
    description: t('runStatus.unknownHint'),
    scope: runtime?.conversationId,
  });
  useNoticeToast(compaction?.status === 'failed' ? t('runStatus.compactionFailed')
    : compaction?.status === 'completed' ? t('runStatus.compactionDone')
      : compaction?.recommended && compaction.status !== 'running' ? t('runStatus.compactionSuggested') : null, {
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
    {unknown ? <Button className="mb-2" size="sm" variant="secondary" isPending={recovering}
      onPress={() => { void recover(); }}>{t('runStatus.review')}</Button> : null}
    {compaction?.status === 'running' ? <div className="text-muted mb-2 text-xs" role="status">{t('runStatus.compacting')}</div> : null}
  </>;
}

/** Keep the submission guard at the actual composer boundary, including Enter. */
export function ConversationPromptInput({ submissionStatus, onSubmit, isDisabled, status, ...props }:
  ComponentProps<typeof PromptInput> & { submissionStatus?: SubmissionStatus }) {
  const blocked = submissionStatus === 'unknown' || submissionStatus === 'sending';
  return <PromptInput {...props} status={submissionStatus === 'sending' ? 'submitted' : status}
    isDisabled={isDisabled || submissionStatus === 'unknown'}
    onSubmit={() => { if (!blocked) onSubmit?.(); }} />;
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
  return <div className="min-w-52 space-y-1 p-1 text-xs">
    <p className="font-medium">{t('runStatus.turnStats')}</p>
    {records.length ? <>
      <p className="text-muted">{t('runStatus.models', { models: [...new Set(records.map(record => record.model))].join(listSeparator) })}</p>
      <p>{t('runStatus.inOut', { input: formatTokenCount(totals.input), output: formatTokenCount(totals.output) })}</p>
      <p>{t('runStatus.cache', { read: formatTokenCount(totals.cacheRead), write: formatTokenCount(totals.cacheWrite) })}</p>
      <p>{t('runStatus.total', { total: formatTokenCount(totals.total) })}</p>
    </> : <p className="text-muted">{t('runStatus.noUsage')}</p>}
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
  const inputPrefix = React.useId();
  const options = permissionActions(request);
  const submit = options.find(option => typeof option !== 'boolean' && option.kind === 'answer');
  const update = (id: string, value: string) => setValues(previous => ({ ...previous, [id]: value }));
  const permissionFieldInput = (field: PermissionField, index: number) => {
    const value = values[field.id] ?? field.initial ?? '';
    const inputId = `${inputPrefix}-${index}`;
    return field.choices || field.type === 'boolean' ? <div key={field.id} className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={inputId}>{field.label}{field.required ? ' *' : ''}</Label>
      <NativeSelect fullWidth>
        <NativeSelect.Trigger id={inputId} value={value} required={field.required} onChange={event => update(field.id, event.target.value)}>
          <NativeSelect.Option value="">{t('runStatus.selectPlaceholder')}</NativeSelect.Option>
          {field.choices ? field.choices.map((choice, choiceIndex) => <NativeSelect.Option key={choiceIndex} value={String(choiceIndex)}>{choice.label}</NativeSelect.Option>)
            : <><NativeSelect.Option value="true">{t('runStatus.yes')}</NativeSelect.Option><NativeSelect.Option value="false">{t('runStatus.no')}</NativeSelect.Option></>}
        </NativeSelect.Trigger>
      </NativeSelect>
      {field.description ? <Description>{field.description}</Description> : null}
    </div> : <TextField key={field.id} className="w-full" value={value} onChange={text => update(field.id, text)} isRequired={field.required}>
      <Label>{field.label}</Label>
      {field.multiline ? <TextArea rows={4} /> : <Input type={field.secret ? 'password' : 'text'} inputMode={field.type === 'number' || field.type === 'integer' ? 'decimal' : undefined} autoComplete="off" />}
      {field.description ? <Description>{field.description}</Description> : null}
    </TextField>;
  };
  useNoticeToast(form.unsupported ? t('runStatus.unsupportedForm') : null);
  return <Form className="flex w-full min-w-0 flex-col gap-3 py-2" onSubmit={event => {
    event.preventDefault();
    if (!submit) return;
    const answer = permissionFormAnswer(form, values);
    if (answer.error) { toast.danger(answer.error); return; }
    onSelect(submit, answer.data);
  }}>
    {form.mode === 'url' && form.url ? <div className="space-y-2 text-sm">
      <Link href={form.url} target="_blank" rel="noopener noreferrer">{t('runStatus.openVerify')}<Link.Icon /></Link>
      <p className="text-muted">{t('runStatus.verifyHint')}</p>
    </div> : null}
    {form.fields.map(permissionFieldInput)}
    <div className="flex flex-wrap gap-2">
      {submit ? <Button size="sm" type="submit" isDisabled={form.unsupported}>{form.mode === 'url' ? t('runStatus.urlDone') : t('runStatus.submitAnswer')}</Button> : null}
      {options.filter(isRejectOption).map(option => <Button
        key={typeof option === 'boolean' ? String(option) : option.optionId} type="button" size="sm" variant="danger-soft" onPress={() => onSelect(option)}
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
  const body = field.choices ? <div className="question-deck__options" role={field.multiple ? 'group' : 'radiogroup'}
    aria-labelledby={questionId} data-multiple={field.multiple || undefined}>
    {field.choices.map((choice, choiceIndex) => <label key={choiceIndex} className="question-deck__option" data-selected={picks.has(choiceIndex) || undefined}>
      <input className="sr-only" type={field.multiple ? 'checkbox' : 'radio'} name={`${idPrefix}-${field.id}`}
        checked={picks.has(choiceIndex)} onChange={() => pick(choiceIndex)} />
      <span className="question-deck__key" aria-hidden="true">{choiceIndex + 1}</span>
      <span className="question-deck__text">
        <span className="question-deck__label">{choice.label}</span>
        {choice.description ? <span className="question-deck__description">{choice.description}</span> : null}
      </span>
      <span className="question-deck__mark" aria-hidden="true"><Check /></span>
    </label>)}
    {field.other ? <label className="question-deck__option question-deck__option--other" data-selected={otherSelected || undefined}>
      <span className="question-deck__key" aria-hidden="true">{field.choices.length + 1}</span>
      <input data-other-answer className="question-deck__other" type="text" autoComplete="off" value={otherText}
        aria-label={t('runStatus.customAnswer')} placeholder={field.multiple ? t('runStatus.customAnswerExtra') : t('runStatus.customAnswerPlaceholder')}
        onFocus={() => selectOther(otherText)}
        onChange={event => { setOthers(previous => ({ ...previous, [field.id]: event.target.value })); selectOther(event.target.value); }} />
      <span className="question-deck__mark" aria-hidden="true"><Check /></span>
    </label> : null}
  </div> : <TextField className="w-full" aria-labelledby={questionId} value={values[field.id] ?? ''}
    onChange={text => setValues(previous => ({ ...previous, [field.id]: text }))}>
    {field.secret ? <Input type="password" autoComplete="off" /> : <TextArea rows={3} placeholder={t('runStatus.freeAnswerPlaceholder')} />}
  </TextField>;
  const multilineAnswer = !field.choices && !field.secret;

  return <div className="question-deck" onKeyDown={onKeyDown}>
    {fields.length > 1 ? <div className="question-deck__bar">
      <nav className="question-deck__steps" aria-label={t('runStatus.questionList')}>
        {fields.map((item, position) => <button key={item.id} type="button" className="question-deck__step"
          aria-current={position === index ? 'step' : undefined} data-answered={answered[position] || undefined}
          onClick={() => goTo(position, false)}>
          {answered[position] ? <Check className="question-deck__step-check" /> : <span className="question-deck__step-dot" />}
          {headerOf(item, position)}
        </button>)}
      </nav>
      <span className="question-deck__count" aria-live="polite">{index + 1} / {fields.length}</span>
    </div> : null}
    <div className="question-deck__stack">
      <div className="question-deck__ghost question-deck__ghost--2" data-visible={remaining >= 2 || undefined} aria-hidden="true" />
      <div className="question-deck__ghost question-deck__ghost--1" data-visible={remaining >= 1 || undefined} aria-hidden="true" />
      <motion.div ref={viewportRef} className="question-deck__viewport" data-switching={switching || undefined}
        initial={false} animate={height === undefined ? undefined : { height }}
        transition={switching && !reduceMotion ? { duration: 0.34, ease: DECK_EASE } : { duration: 0 }}>
        <AnimatePresence initial={false} mode="popLayout" custom={direction} onExitComplete={() => setSwitching(false)}>
          <motion.section key={field.id} data-question-index={index} className="question-deck__card" aria-labelledby={questionId}
            custom={direction} variants={reduceMotion ? deckFadeVariants : deckCardVariants} initial="enter" animate="center" exit="exit">
            <div className="question-deck__meta">
              <span className="question-deck__chip">{headerOf(field, index)}</span>
              <span>{!field.choices ? t('runStatus.freeAnswer') : field.multiple ? t('runStatus.multiChoice') : t('runStatus.singleChoice')}</span>
            </div>
            <h3 id={questionId} className="question-deck__question">{field.label}</h3>
            {body}
            <p className="question-deck__hint" aria-hidden="true">
              {choiceCount ? <span><Kbd><Kbd.Content>1</Kbd.Content></Kbd>–<Kbd><Kbd.Content>{choiceCount}</Kbd.Content></Kbd> {t('runStatus.hintChoose')}</span> : null}
              {fields.length > 1 ? <span><Kbd><Kbd.Abbr keyValue="left" /></Kbd> <Kbd><Kbd.Abbr keyValue="right" /></Kbd> {t('runStatus.hintPage')}</span> : null}
              <span><Kbd>{multilineAnswer ? <Kbd.Abbr keyValue={isMacLike ? 'command' : 'ctrl'} /> : null}<Kbd.Abbr keyValue="enter" /></Kbd> {last ? t('runStatus.hintSubmit') : t('runStatus.hintNext')}</span>
            </p>
          </motion.section>
        </AnimatePresence>
      </motion.div>
    </div>
    <div className="question-deck__footer">
      <div className="flex flex-wrap gap-1">
        {options.filter(isRejectOption).map(option => <Button key={typeof option === 'boolean' ? String(option) : option.optionId}
          size="sm" variant="ghost" className="text-danger" onPress={() => onSelect(option)}>{rejectLabel(option)}</Button>)}
      </div>
      <div className="ml-auto flex gap-2">
        {fields.length > 1 ? <Button size="sm" variant="secondary" isDisabled={index === 0} onPress={() => goTo(index - 1)}>
          <ChevronLeft />{t('runStatus.prevQuestion')}
        </Button> : null}
        {!last ? <Button size="sm" isDisabled={!answered[index]} onPress={advance}>{t('runStatus.nextQuestion')}<ChevronRight /></Button>
          : submit ? <Button size="sm" isDisabled={!answered.every(Boolean)} onPress={advance}>{t('runStatus.submitAnswer')}</Button> : null}
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
    return <p className="text-muted text-xs">{gate.deviceNames.length
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
      size="sm"
      variant={reject ? 'danger' : 'primary'}
      // Green allow / red reject reads at a glance; other kinds keep the accent.
      className={allow ? 'bg-success text-success-foreground' : undefined}
      onPress={() => onSelect(option)}
    >
      {allow ? <Check aria-hidden /> : reject ? <Xmark aria-hidden /> : null}
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
  return <div className="mb-3 rounded-xl border border-separator p-3">
    <div className="mb-2 flex items-start gap-2">
      {summary.command ? <Terminal className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{heading}</p>
        {summary.description ? <p className="text-muted mt-0.5 text-xs">{summary.description}</p> : null}
      </div>
      {summary.tool && summary.command ? <code className="shrink-0 rounded bg-default px-1.5 py-0.5 text-[11px] text-muted">{summary.tool}</code> : null}
    </div>
    {summary.reason ? <div className="mb-2 flex items-start gap-1.5 rounded-lg bg-warning/10 px-2 py-1.5 text-xs">
      <ShieldExclamation className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 wrap-anywhere">
        {summary.safetyCheck ? <span className="font-medium text-warning">{t('runStatus.safetyCheck')} · </span> : null}
        {summary.reason}
        {summary.safetyCheck ? <span className="text-muted"> {t('runStatus.safetyCheckHint')}</span> : null}
      </p>
    </div> : null}
    {summary.command ? <pre className="mb-2 max-h-60 overflow-auto rounded-lg bg-default px-3 py-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere select-text">{summary.command}</pre> : null}
    {summary.cwd ? <p className="text-muted mb-2 font-mono text-[11px] wrap-anywhere">{t('runStatus.cwd')}: {summary.cwd}</p> : null}
    <ConversationPermissionActions request={request} deviceSecret={deviceSecret} onSelect={onSelect} />
  </div>;
}

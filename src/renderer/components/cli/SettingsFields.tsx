import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { RiAddLine, RiArrowDownLine, RiArrowUpLine, RiCloseLine, RiDeleteBin6Line } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { Textarea } from '@/components/base/textarea/textarea';
import { IconAction } from '@/components/ui/icon-action';
import { SettingsRow, SETTINGS_ROW } from '@/components/settings/SettingsRows';
import { useT, type MessageKey } from '@/i18n';
import { cx } from '@/utils/cx';
import { UNSET, fieldId, optionId, type FieldSpec, type OptionValue } from '@/lib/cliSettings';

/**
 * The form controls of the CLI settings panels, one per `FieldSpec` kind.
 * Labels come from `<keyPrefix>.field.<id>`, descriptions from
 * `<keyPrefix>.hint.<id>`, option labels from `<keyPrefix>.option.<id>.<value>`.
 */

const key = (value: string) => value as MessageKey;

export const COMPACT_SELECT = { className: 'w-44', triggerClassName: 'h-8 rounded-lg px-2 py-1.5', popoverClassName: 'w-(--trigger-width)' } as const;

/** What `model` fields offer: `provider/model-id` strings. */
export const SettingsFieldModels = createContext<string[]>([]);

export function SettingsField({ field, keyPrefix, value, onChange }: {
  field: FieldSpec; keyPrefix: string; value: unknown; onChange: (value: unknown) => void;
}) {
  const t = useT();
  const id = fieldId(field.path);
  const label = t(key(`${keyPrefix}.field.${id}`));
  const hint = t(key(`${keyPrefix}.hint.${id}`));
  const description = (
    <>
      {hint}
      <span className={cx('font-mono text-caption-1-regular text-text-tertiary', hint && 'ms-1.5')} dir="ltr">{id}</span>
    </>
  );
  const unsetLabel = t('cliSettings.unset');
  const optionText = (option: OptionValue) => t(key(`${keyPrefix}.option.${id}.${String(option)}`));

  switch (field.kind) {
    case 'lines':
      return <LinesField label={label} description={description} placeholder={field.placeholder} value={value} onChange={onChange} />;
    case 'integer':
      return (
        <IntegerField label={label} description={description} placeholder={field.default === undefined ? unsetLabel : t('cliSettings.defaultValue', { value: String(field.default) })}
          min={field.min} max={field.max} value={value} onChange={onChange} />
      );
    case 'limit':
      return <LimitField label={label} description={description} field={field} nullLabel={optionText('null')} value={value} onChange={onChange} />;
    case 'attribution':
      return <AttributionField label={label} description={description} value={value} onChange={onChange} />;
    case 'rules':
      return <RulesField label={label} description={description} field={field} actionLabel={optionText} value={value} onChange={onChange} />;
    case 'longtext':
      return (
        <div className={cx(SETTINGS_ROW, 'flex flex-col gap-2')}>
          <div className="flex min-w-0 flex-col">
            <div className="text-body-regular text-text-primary">{label}</div>
            <div className="text-body-2-regular text-text-secondary">{description}</div>
          </div>
          <Textarea
            className="w-full"
            aria-label={label}
            value={typeof value === 'string' ? value : ''}
            rows={3}
            autoResize
            maxRows={12}
            placeholder={field.placeholder}
            onChange={(next) => onChange(next.trim() ? next : undefined)}
          />
        </div>
      );
    default:
      return <SettingsRow label={label} description={description}><FieldControl field={field} label={label} optionText={optionText} value={value} onChange={onChange} /></SettingsRow>;
  }
}

/** The right-hand control of a single-row field. */
function FieldControl({ field, label, optionText, value, onChange }: {
  field: Extract<FieldSpec, { kind: 'bool' | 'switch' | 'enum' | 'disable' | 'text' | 'secret' | 'model' }>;
  label: string;
  optionText: (option: OptionValue) => string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = useT();
  const unsetLabel = t('cliSettings.unset');
  switch (field.kind) {
    case 'switch':
      return <Switch size="sm" aria-label={label} isSelected={typeof value === 'boolean' ? value : field.default} onChange={onChange} />;
    case 'bool':
    case 'enum': {
      const options: OptionValue[] = field.kind === 'bool' ? [true, false] : field.options;
      const optionLabel = (option: OptionValue) => (field.kind === 'bool' ? t(option ? 'cliSettings.on' : 'cliSettings.off') : optionText(option));
      const fallback = field.kind === 'enum' ? field.default : undefined;
      const unsetText = fallback === undefined ? unsetLabel : t('cliSettings.defaultValue', { value: optionLabel(fallback) });
      // A value the CLI accepts but the list lacks (a custom theme, a
      // notification event list, a granular approval table) stays
      // selectable so it is shown and kept as is.
      const known = value === undefined || options.some((option) => option === value);
      const custom = known ? null : optionId(value);
      return (
        <Select
          aria-label={label}
          {...COMPACT_SELECT}
          selectedKey={value === undefined ? UNSET : optionId(value)}
          onSelectionChange={(next) => {
            if (next === UNSET || next == null) onChange(undefined);
            else if (next !== custom) onChange(options.find((option) => optionId(option) === next));
          }}
        >
          <SelectItem id={UNSET} textValue={unsetText}>{unsetText}</SelectItem>
          {options.map((option) => (
            <SelectItem key={optionId(option)} id={optionId(option)} textValue={optionLabel(option)}>{optionLabel(option)}</SelectItem>
          ))}
          {custom ? (
            <SelectItem id={custom} textValue={typeof value === 'string' ? value : custom}>
              <span className="truncate" dir="ltr">{typeof value === 'string' ? value : custom}</span>
            </SelectItem>
          ) : null}
        </Select>
      );
    }
    case 'disable':
      return (
        <Select aria-label={label} {...COMPACT_SELECT} selectedKey={value === 'disable' ? 'disable' : UNSET} onSelectionChange={(next) => onChange(next === 'disable' ? 'disable' : undefined)}>
          <SelectItem id={UNSET} textValue={t('cliSettings.allowed')}>{t('cliSettings.allowed')}</SelectItem>
          <SelectItem id="disable" textValue={t('cliSettings.disabled')}>{t('cliSettings.disabled')}</SelectItem>
        </Select>
      );
    case 'text':
      return (
        <Input aria-label={label} size="small" className="w-44" inputDir="ltr" placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''} onChange={(next) => onChange(next.trim() ? next : undefined)} />
      );
    case 'secret':
      return <SecretControl label={label} placeholder={field.secretPlaceholder} value={value} onChange={onChange} />;
    case 'model':
      return <ModelControl field={field} label={label} optionText={optionText} value={value} onChange={onChange} />;
  }
}

function SecretControl({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: unknown; onChange: (value: unknown) => void;
}) {
  const t = useT();
  const stored = value === placeholder;
  // `$ENV` and `!command` references name where the secret lives; they are shown.
  const reference = typeof value === 'string' && (value.startsWith('$') || value.startsWith('!'));
  return (
    <>
      <Input
        aria-label={label}
        size="small"
        className="w-44"
        inputDir="ltr"
        type={reference ? 'text' : 'password'}
        autoComplete="off"
        placeholder={stored ? t('cliSettings.secretStored') : t('cliSettings.unset')}
        value={typeof value === 'string' && !stored ? value : ''}
        // Emptying a replaced value goes back to what is stored.
        onChange={(next) => onChange(next ? next : stored ? placeholder : undefined)}
      />
      {value !== undefined ? (
        <IconAction icon={RiCloseLine} size="sm" tooltip={t('cliSettings.secretClear')} aria-label={t('cliSettings.secretClear')} onClick={() => onChange(undefined)} />
      ) : null}
    </>
  );
}

function modelKey(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const { provider, modelId } = value as { provider?: unknown; modelId?: unknown };
    if (typeof provider === 'string' && typeof modelId === 'string') return `${provider}/${modelId}`;
  }
  return undefined;
}

function ModelControl({ field, label, optionText, value, onChange }: {
  field: Extract<FieldSpec, { kind: 'model' }>;
  label: string;
  optionText: (option: OptionValue) => string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = useT();
  const models = useContext(SettingsFieldModels);
  const extra = field.extra ?? [];
  const current = modelKey(value);
  const choices = [...extra, ...models.filter((model) => !extra.includes(model))];
  if (current && !choices.includes(current)) choices.push(current);
  const toValue = (choice: string) => {
    if (field.format === 'string' || extra.includes(choice)) return choice;
    const slash = choice.indexOf('/');
    return { provider: choice.slice(0, slash), modelId: choice.slice(slash + 1) };
  };
  return (
    <Select
      aria-label={label}
      {...COMPACT_SELECT}
      selectedKey={current ?? UNSET}
      onSelectionChange={(next) => {
        if (next === UNSET || next == null) onChange(undefined);
        else if (next !== current) onChange(toValue(String(next)));
      }}
    >
      <SelectItem id={UNSET} textValue={t('cliSettings.unset')}>{t('cliSettings.unset')}</SelectItem>
      {choices.map((choice) => {
        const text = extra.includes(choice) ? optionText(choice) : choice;
        return (
          <SelectItem key={choice} id={choice} textValue={text}>
            <span className="truncate" dir={extra.includes(choice) ? undefined : 'ltr'}>{text}</span>
          </SelectItem>
        );
      })}
    </Select>
  );
}

const LIMIT_CUSTOM = 'custom';

function LimitField({ label, description, field, nullLabel, value, onChange }: {
  label: string; description: ReactNode; field: Extract<FieldSpec, { kind: 'limit' }>; nullLabel: string; value: unknown; onChange: (value: unknown) => void;
}) {
  const t = useT();
  const mode = value === undefined ? UNSET : value === null ? 'null' : LIMIT_CUSTOM;
  const defaultText = t('cliSettings.defaultValue', { value: String(field.default) });
  return (
    <div className={SETTINGS_ROW}>
      <SettingsRow label={label} description={description} className="border-b-0 py-0 pe-0">
        <Select
          aria-label={label}
          {...COMPACT_SELECT}
          selectedKey={mode}
          onSelectionChange={(next) => {
            if (next === mode) return;
            onChange(next === 'null' ? null : next === LIMIT_CUSTOM ? field.default : undefined);
          }}
        >
          <SelectItem id={UNSET} textValue={defaultText}>{defaultText}</SelectItem>
          <SelectItem id="null" textValue={nullLabel}>{nullLabel}</SelectItem>
          <SelectItem id={LIMIT_CUSTOM} textValue={t('cliSettings.limitCustom')}>{t('cliSettings.limitCustom')}</SelectItem>
        </Select>
      </SettingsRow>
      {mode === LIMIT_CUSTOM ? (
        <IntegerField
          bare
          label={label}
          description={null}
          placeholder=""
          min={field.min}
          max={field.max}
          value={value}
          onChange={(next) => onChange(next === undefined ? field.default : next)}
        />
      ) : null}
    </div>
  );
}

type RuleRow = { key: number; pattern: string; action: unknown };

let nextRuleKey = 0;

function ruleRows(value: unknown): RuleRow[] {
  // A plain action applies to everything, like a lone `*` pattern.
  if (typeof value === 'string') return [{ key: nextRuleKey++, pattern: '*', action: value }];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([pattern, action]) => ({ key: nextRuleKey++, pattern, action }));
}

function ruleAction(action: unknown): string {
  if (typeof action === 'string') return action;
  const named = action && typeof action === 'object' ? (action as { action?: unknown }).action : undefined;
  return typeof named === 'string' ? named : '';
}

function ruleReason(action: unknown): string | undefined {
  const reason = action && typeof action === 'object' ? (action as { reason?: unknown }).reason : undefined;
  return typeof reason === 'string' ? reason : undefined;
}

function RulesField({ label, description, field, actionLabel, value, onChange }: {
  label: string;
  description: ReactNode;
  field: Extract<FieldSpec, { kind: 'rules' }>;
  actionLabel: (action: string) => string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState(() => ruleRows(value));
  const toValue = (list: RuleRow[]) => {
    const kept = list.filter((row) => row.pattern.trim() !== '');
    return kept.length > 0 ? Object.fromEntries(kept.map((row) => [row.pattern.trim(), row.action])) : undefined;
  };
  useEffect(() => {
    // Follow outside changes (a reload) without fighting the user's typing.
    if (JSON.stringify(toValue(rows)) !== JSON.stringify(typeof value === 'string' ? { '*': value } : value)) setRows(ruleRows(value));
  }, [value]);
  const commit = (next: RuleRow[]) => {
    setRows(next);
    onChange(toValue(next));
  };
  const update = (rowKey: number, changes: Partial<RuleRow>) => commit(rows.map((row) => (row.key === rowKey ? { ...row, ...changes } : row)));
  const move = (index: number, by: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    commit(next);
  };
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.pattern.trim(), (seen.get(row.pattern.trim()) ?? 0) + 1);
  return (
    <div className={cx(SETTINGS_ROW, 'flex flex-col gap-2')}>
      <div className="flex min-w-0 flex-col">
        <div className="text-body-regular text-text-primary">{label}</div>
        <div className="text-body-2-regular text-text-secondary">{description}</div>
      </div>
      {rows.map((row, index) => {
        const duplicate = row.pattern.trim() !== '' && (seen.get(row.pattern.trim()) ?? 0) > 1;
        const reason = ruleReason(row.action);
        const selected = ruleAction(row.action);
        return (
          <div key={row.key} className="flex flex-col gap-1">
            <div className="flex items-start gap-1.5">
              <Input
                aria-label={t('cliSettings.rulePattern')}
                size="small"
                className="min-w-0 flex-1"
                inputDir="ltr"
                placeholder={field.placeholder}
                value={row.pattern}
                isInvalid={duplicate}
                hint={duplicate ? t('cliSettings.ruleDuplicate') : undefined}
                onChange={(pattern) => update(row.key, { pattern })}
                inputClassName="font-mono"
              />
              <Select
                aria-label={t('cliSettings.ruleAction')}
                {...COMPACT_SELECT}
                className="w-28 shrink-0"
                selectedKey={selected || null}
                onSelectionChange={(next) => {
                  if (next == null || next === selected) return;
                  const action = String(next);
                  const keepsReason = row.action && typeof row.action === 'object' && (field.reasonAction === undefined || action === field.reasonAction);
                  update(row.key, { action: keepsReason ? { ...(row.action as object), action } : action });
                }}
              >
                {field.actions.map((action) => <SelectItem key={action} id={action} textValue={actionLabel(action)}>{actionLabel(action)}</SelectItem>)}
              </Select>
              <IconAction icon={RiArrowUpLine} size="md" aria-label={t('cliSettings.ruleMoveUp')} disabled={index === 0} onClick={() => move(index, -1)} />
              <IconAction icon={RiArrowDownLine} size="md" aria-label={t('cliSettings.ruleMoveDown')} disabled={index === rows.length - 1} onClick={() => move(index, 1)} />
              <IconAction icon={RiDeleteBin6Line} size="md" aria-label={t('cliSettings.ruleRemove')} onClick={() => commit(rows.filter((item) => item.key !== row.key))} />
            </div>
            {reason ? <p className="ps-1 text-caption-1-regular text-text-tertiary">{t('cliSettings.ruleReason', { reason })}</p> : null}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="small" variant="ghost" leadingIcon={RiAddLine} onClick={() => commit([...rows, { key: nextRuleKey++, pattern: '', action: field.actions[0] }])}>
          {t('cliSettings.ruleAdd')}
        </Button>
        {rows.length > 1 ? <span className="text-caption-1-regular text-text-tertiary">{t('cliSettings.ruleOrderHint')}</span> : null}
      </div>
    </div>
  );
}

function IntegerField({ label, description, placeholder, min, max, value, onChange, bare = false }: {
  label: string; description: ReactNode; placeholder: string; min: number; max: number; value: unknown; onChange: (value: unknown) => void;
  /** Only the input, under another control. */
  bare?: boolean;
}) {
  const t = useT();
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '');
  const parsed = Number(text);
  const invalid = text.trim() !== '' && !(Number.isInteger(parsed) && parsed >= min && parsed <= max);
  useEffect(() => {
    // Follow outside changes (a reload) without fighting the user's typing.
    if (value !== (text.trim() === '' ? undefined : parsed)) setText(typeof value === 'number' ? String(value) : '');
  }, [value]);
  const input = (
    <Input
      aria-label={label}
      size="small"
      className="w-44"
      inputMode="numeric"
      inputDir="ltr"
      placeholder={placeholder}
      value={text}
      isInvalid={invalid}
      hint={invalid ? t('cliSettings.integerRange', { min, max }) : undefined}
      onChange={(next) => {
        setText(next);
        const number = Number(next);
        if (next.trim() === '') onChange(undefined);
        else if (Number.isInteger(number) && number >= min && number <= max) onChange(number);
      }}
    />
  );
  if (bare) return <div className="mt-2 flex justify-end">{input}</div>;
  return <SettingsRow label={label} description={description}>{input}</SettingsRow>;
}

type AttributionMode = 'default' | 'hidden' | 'custom';

function AttributionField({ label, description, value, onChange }: {
  label: string; description: ReactNode; value: unknown; onChange: (value: unknown) => void;
}) {
  const t = useT();
  // An empty string is both "hidden" and a custom text being typed, so the
  // mode is kept here rather than derived from the value alone.
  const [mode, setMode] = useState<AttributionMode>(typeof value !== 'string' ? 'default' : value === '' ? 'hidden' : 'custom');
  useEffect(() => {
    if (typeof value !== 'string') setMode('default');
    else if (value !== '') setMode('custom');
    else setMode((current) => (current === 'default' ? 'hidden' : current));
  }, [value]);
  const text = typeof value === 'string' ? value : '';
  const choose = (next: AttributionMode) => {
    setMode(next);
    onChange(next === 'default' ? undefined : next === 'hidden' ? '' : text);
  };
  return (
    <div className={SETTINGS_ROW}>
      <SettingsRow label={label} description={description} className="border-b-0 py-0 pe-0">
        <Select aria-label={label} {...COMPACT_SELECT} selectedKey={mode} onSelectionChange={(next) => choose(next === 'hidden' || next === 'custom' ? next : 'default')}>
          <SelectItem id="default" textValue={t('cliSettings.attributionDefault')}>{t('cliSettings.attributionDefault')}</SelectItem>
          <SelectItem id="hidden" textValue={t('cliSettings.attributionHidden')}>{t('cliSettings.attributionHidden')}</SelectItem>
          <SelectItem id="custom" textValue={t('cliSettings.attributionCustom')}>{t('cliSettings.attributionCustom')}</SelectItem>
        </Select>
      </SettingsRow>
      {mode === 'custom' ? (
        <Textarea
          className="mt-2 w-full"
          aria-label={label}
          value={text}
          rows={3}
          spellCheck="false"
          onChange={onChange}
          inputClassName="font-mono text-caption-1-regular"
        />
      ) : null}
    </div>
  );
}

function LinesField({ label, description, placeholder, value, onChange }: {
  label: string; description: ReactNode; placeholder?: string; value: unknown; onChange: (value: unknown) => void;
}) {
  const toText = (current: unknown) => (Array.isArray(current) ? current.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n') : '');
  const [text, setText] = useState(() => toText(value));
  const lines = (source: string) => source.split('\n').map((line) => line.trim()).filter(Boolean);
  useEffect(() => {
    if (JSON.stringify(lines(text)) !== JSON.stringify(Array.isArray(value) ? value : [])) setText(toText(value));
  }, [value]);
  return (
    <div className={cx(SETTINGS_ROW, 'flex flex-col gap-2')}>
      <div className="flex min-w-0 flex-col">
        <div className="text-body-regular text-text-primary">{label}</div>
        <div className="text-body-2-regular text-text-secondary">{description}</div>
      </div>
      <Textarea
        className="w-full"
        aria-label={label}
        value={text}
        rows={3}
        autoResize
        maxRows={10}
        spellCheck="false"
        placeholder={placeholder}
        onChange={(next) => {
          setText(next);
          const items = lines(next);
          onChange(items.length > 0 ? items : undefined);
        }}
        inputClassName="font-mono text-caption-1-regular"
      />
    </div>
  );
}


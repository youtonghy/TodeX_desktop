import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RiAddLine, RiDeleteBin6Line, RiEyeLine, RiEyeOffLine } from '@remixicon/react';
import type { CliSettingsDocument, CliSettingsProvider, V2ApiClient } from '@todex/protocol/v2';
import { isConflictError } from '@todex/protocol/connectionError';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Tab, TabList, TabPanel, Tabs } from '@/components/base/tabs/tabs';
import { Textarea } from '@/components/base/textarea/textarea';
import { Alert } from '@/components/ui/alert';
import { IconAction } from '@/components/ui/icon-action';
import { Modal } from '@/components/ui/modal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { SettingsCard, SettingsGroup, SettingsRow, SETTINGS_ROW } from '@/components/settings/SettingsRows';
import { useT, type MessageKey } from '@/i18n';
import { cx } from '@/utils/cx';
import {
  CLI_SETTINGS,
  ENV_NAME,
  UNSET,
  applyMergePatch,
  envFromRows,
  envRows,
  fieldId,
  getAt,
  mergePatch,
  optionId,
  setAt,
  type CliSettingsSchema,
  type FieldSpec,
  type OptionValue,
  type SettingsObject,
} from '@/lib/cliSettings';
import { CliInstructionsPanel, useCliInstructions } from './CliInstructionsTab';

type TabId = 'form' | 'env' | 'raw' | 'agents';
const TAB_IDS: TabId[] = ['form', 'env', 'raw', 'agents'];
type EnvRow = { key: number; name: string; value: string; revealed: boolean };

const key = (value: string) => value as MessageKey;

/** A CLI's user settings file on the backend host; open while `provider` is set. */
export function CliSettingsModal({ provider, onClose, api }: {
  provider: CliSettingsProvider | null;
  onClose: () => void;
  api: () => V2ApiClient;
}) {
  const t = useT();
  // Keeps the last schema while the modal animates out.
  const lastProvider = useRef<CliSettingsProvider>('claude-code');
  if (provider) lastProvider.current = provider;
  const schema = CLI_SETTINGS[lastProvider.current];
  return (
    <Modal
      isOpen={provider !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('cliSettings.title', { name: schema.name })}
      size="2xl"
      className="h-[min(760px,calc(100dvh-32px))]"
      isDismissable={false}
      bodyClassName="flex flex-col overflow-hidden pb-0"
    >
      {provider ? <CliSettingsEditor key={provider} schema={schema} api={api} onClose={onClose} /> : null}
    </Modal>
  );
}

function CliSettingsEditor({ schema, api, onClose }: { schema: CliSettingsSchema; api: () => V2ApiClient; onClose: () => void }) {
  const { provider, envPath } = schema;
  const t = useT();
  const [doc, setDoc] = useState<CliSettingsDocument>();
  const [loadError, setLoadError] = useState<string>();
  const [draft, setDraft] = useState<SettingsObject>({});
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [rawText, setRawText] = useState('');
  const [rawRevealed, setRawRevealed] = useState(false);
  const [tab, setTab] = useState<TabId>('form');
  const [saving, setSaving] = useState(false);
  const nextEnvKey = useRef(0);
  const instructions = useCliInstructions(provider, api);

  const toEnvRows = (settings: SettingsObject) => (envPath ? envRows(settings, envPath) : []).map((row) => ({ ...row, key: nextEnvKey.current++, revealed: false }));

  /** Takes in a document; `draft` replaces the form state (default: the saved settings). */
  const adopt = useCallback((next: CliSettingsDocument, draftSettings?: SettingsObject) => {
    setDoc(next);
    const settings = draftSettings ?? next.settings ?? {};
    setDraft(settings);
    setEnv(toEnvRows(settings));
    setRawText(next.text);
    if (!next.settings) setTab('raw');
  }, []);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      adopt(await api().getCliSettings(provider));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('cliSettings.readFailed'));
    }
  }, [adopt, api, provider]);

  useEffect(() => { void load(); }, [load]);

  const saved = doc?.settings ?? null;
  // The form and the env tab edit one draft; env rows are folded in on save.
  const formNext = useMemo(() => (envPath ? setAt(draft, envPath, envFromRows(env)) : draft), [draft, env, envPath]);
  const patch = useMemo(() => (saved ? mergePatch(saved, formNext) : {}), [saved, formNext]);
  const formDirty = Object.keys(patch).length > 0;
  const rawDirty = Boolean(doc) && rawText !== doc?.text;
  // TOML is checked by the backend on save.
  const rawError = useMemo(() => (doc?.format === 'toml' ? null : rawObjectError(rawText)), [doc?.format, rawText]);
  const fileName = doc?.path.split(/[\\/]/).pop() || doc?.path || '';
  const envInvalid = env.some((row) => row.name.trim() !== '' && !ENV_NAME.test(row.name.trim()));
  const editingRaw = tab === 'raw';
  const editingAgents = tab === 'agents';
  const canSave = editingAgents
    ? instructions.canSave
    : Boolean(doc) && !saving && (editingRaw ? rawDirty && !rawError : formDirty && !envInvalid);
  // Edits left unsaved on a tab other than the one shown.
  const unsavedElsewhere = editingAgents
    ? (formDirty || rawDirty) && 'cliSettings.settingsUnsaved'
    : (editingRaw ? formDirty : rawDirty) ? (editingRaw ? 'cliSettings.formUnsaved' : 'cliSettings.rawUnsaved')
      : instructions.dirty && 'cliSettings.agentsUnsaved';

  const save = async () => {
    if (editingAgents) {
      await instructions.save();
      return;
    }
    if (!doc) return;
    setSaving(true);
    try {
      const next = editingRaw
        ? await api().replaceCliSettings(provider, doc.revision, rawText)
        : await api().patchCliSettings(provider, doc.revision, patch);
      adopt(next);
      toast.success(t('cliSettings.saved', { name: schema.name }));
    } catch (error) {
      if (!isConflictError(error)) {
        toast.danger(error instanceof Error ? error.message : t('cliSettings.saveFailed'));
        return;
      }
      // Someone else wrote the file: reload it and replay the form edits on
      // top (the raw text is kept as typed), so nothing is lost or silently
      // overwritten; the user reviews and saves again.
      try {
        const latest = await api().getCliSettings(provider);
        if (editingRaw) {
          setDoc(latest);
        } else {
          adopt(latest, latest.settings ? applyMergePatch(latest.settings, patch) : undefined);
        }
        toast.warning(t('cliSettings.conflict'));
      } catch (reloadError) {
        toast.danger(reloadError instanceof Error ? reloadError.message : t('cliSettings.readFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <Alert
        status="danger"
        title={t('cliSettings.readFailed')}
        description={loadError}
        actions={<Button size="small" variant="secondary" onClick={() => void load()}>{t('cliSettings.retry')}</Button>}
      />
    );
  }
  if (!doc) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('cliSettings.reading')} /></div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* The AGENTS.md tab names its own file. */}
      <p className={cx('truncate text-body-2-regular text-text-secondary', editingAgents && 'invisible')} dir="ltr" title={doc.path}>{doc.path}</p>
      <Tabs selectedKey={tab} onSelectionChange={(next) => setTab(TAB_IDS.find((id) => id === next) ?? 'form')} className="min-h-0 flex-1 gap-0">
        <TabList aria-label={t('cliSettings.tabsLabel')}>
          <Tab id="form" isDisabled={!saved}>{t('cliSettings.tabForm')}</Tab>
          {envPath ? <Tab id="env" isDisabled={!saved} count={env.length || undefined}>{t('cliSettings.tabEnv')}</Tab> : null}
          <Tab id="raw">{t('cliSettings.tabRaw')}</Tab>
          <Tab id="agents">AGENTS.md</Tab>
        </TabList>
        <ScrollArea surface="full" className="-mx-6 flex-1" contentClassName="px-6 pt-4 pb-4">
          <TabPanel id="form" className="flex flex-col gap-5">
            <p className="px-3 text-body-2-regular text-text-secondary">
              {doc.exists ? t(schema.hints.scope) : t('cliSettings.missingHint')}
            </p>
            {schema.groups.map((group) => (
              <SettingsGroup key={group.id} label={t(key(`${schema.keyPrefix}.group.${group.id}`))}>
                <SettingsCard>
                  {group.fields.map((field) => (
                    <SettingsField
                      key={fieldId(field.path)}
                      field={field}
                      keyPrefix={schema.keyPrefix}
                      value={getAt(draft, field.path)}
                      onChange={(value) => setDraft((current) => setAt(current, field.path, value))}
                    />
                  ))}
                </SettingsCard>
              </SettingsGroup>
            ))}
            <p className="px-3 text-body-2-regular text-text-secondary">{t(schema.hints.moreInRaw)}</p>
          </TabPanel>
          {envPath ? (
            <TabPanel id="env" className="flex flex-col gap-3">
              {schema.hints.env ? <p className="px-3 text-body-2-regular text-text-secondary">{t(schema.hints.env)}</p> : null}
              <EnvEditor rows={env} onChange={setEnv} nextKey={() => nextEnvKey.current++} />
            </TabPanel>
          ) : null}
          <TabPanel id="raw" className="flex flex-col gap-3">
            {doc.parseError ? <Alert status="warning" title={t('cliSettings.parseError', { file: fileName })} description={doc.parseError} /> : null}
            {rawRevealed || !doc.exists ? (
              <Textarea
                className="w-full"
                aria-label={fileName}
                value={rawText}
                onChange={setRawText}
                rows={22}
                spellCheck="false"
                isInvalid={Boolean(rawError)}
                hint={rawError ?? t(doc.format === 'toml' ? 'cliSettings.rawHintToml' : 'cliSettings.rawHintJson')}
                inputClassName="font-mono text-caption-1-regular"
              />
            ) : (
              <Alert
                status="neutral"
                title={t('cliSettings.rawHiddenTitle')}
                description={t(schema.hints.rawHidden)}
                actions={<Button size="small" variant="secondary" leadingIcon={RiEyeLine} onClick={() => setRawRevealed(true)}>{t('cliSettings.reveal')}</Button>}
              />
            )}
          </TabPanel>
          <TabPanel id="agents">
            <CliInstructionsPanel state={instructions} />
          </TabPanel>
        </ScrollArea>
      </Tabs>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-separator-border pt-4 pb-6">
        {unsavedElsewhere ? (
          <span className="me-auto text-body-2-regular text-text-secondary">{t(unsavedElsewhere)}</span>
        ) : null}
        <Button variant="secondary" onClick={onClose} disabled={saving || instructions.busy}>{t('common.close')}</Button>
        <Button onClick={() => void save()} disabled={!canSave} aria-busy={(editingAgents ? instructions.busy : saving) || undefined}>{t('common.save')}</Button>
      </div>
    </div>
  );
}

function rawObjectError(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? null : 'settings.json must contain a JSON object';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const COMPACT_SELECT = { className: 'w-44', triggerClassName: 'h-8 rounded-lg px-2 py-1.5', popoverClassName: 'w-(--trigger-width)' } as const;

function SettingsField({ field, keyPrefix, value, onChange }: {
  field: FieldSpec; keyPrefix: string; value: unknown; onChange: (value: unknown) => void;
}) {
  const t = useT();
  const id = fieldId(field.path);
  const label = t(key(`${keyPrefix}.field.${id}`));
  const description = (
    <>
      {t(key(`${keyPrefix}.hint.${id}`))}
      <span className="ms-1.5 font-mono text-caption-1-regular text-text-tertiary" dir="ltr">{id}</span>
    </>
  );
  const unsetLabel = t('cliSettings.unset');

  if (field.kind === 'lines') {
    return <LinesField label={label} description={description} placeholder={field.placeholder} value={value} onChange={onChange} />;
  }

  let control;
  switch (field.kind) {
    case 'bool':
    case 'enum': {
      const options: OptionValue[] = field.kind === 'bool' ? [true, false] : field.options;
      const optionLabel = (option: OptionValue) => (field.kind === 'bool'
        ? t(option ? 'cliSettings.on' : 'cliSettings.off')
        : t(key(`${keyPrefix}.option.${id}.${String(option)}`)));
      // A value the CLI accepts but the list lacks (a custom theme, a
      // notification event list, a granular approval table) stays
      // selectable so it is shown and kept as is.
      const known = value === undefined || options.some((option) => option === value);
      const custom = known ? null : optionId(value);
      control = (
        <Select
          aria-label={label}
          {...COMPACT_SELECT}
          selectedKey={value === undefined ? UNSET : optionId(value)}
          onSelectionChange={(next) => {
            if (next === UNSET || next == null) onChange(undefined);
            else if (next !== custom) onChange(options.find((option) => optionId(option) === next));
          }}
        >
          <SelectItem id={UNSET} textValue={unsetLabel}>{unsetLabel}</SelectItem>
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
      break;
    }
    case 'disable':
      control = (
        <Select aria-label={label} {...COMPACT_SELECT} selectedKey={value === 'disable' ? 'disable' : UNSET} onSelectionChange={(next) => onChange(next === 'disable' ? 'disable' : undefined)}>
          <SelectItem id={UNSET} textValue={t('cliSettings.allowed')}>{t('cliSettings.allowed')}</SelectItem>
          <SelectItem id="disable" textValue={t('cliSettings.disabled')}>{t('cliSettings.disabled')}</SelectItem>
        </Select>
      );
      break;
    case 'text':
      control = (
        <Input aria-label={label} size="small" className="w-44" inputDir="ltr" placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''} onChange={(next) => onChange(next.trim() ? next : undefined)} />
      );
      break;
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
    case 'integer':
      return <IntegerField label={label} description={description} placeholder={unsetLabel} min={field.min} max={field.max} value={value} onChange={onChange} />;
    case 'attribution':
      return <AttributionField label={label} description={description} value={value} onChange={onChange} />;
  }
  return <SettingsRow label={label} description={description}>{control}</SettingsRow>;
}

function IntegerField({ label, description, placeholder, min, max, value, onChange }: {
  label: string; description: ReactNode; placeholder: string; min: number; max: number; value: unknown; onChange: (value: unknown) => void;
}) {
  const t = useT();
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '');
  const parsed = Number(text);
  const invalid = text.trim() !== '' && !(Number.isInteger(parsed) && parsed >= min && parsed <= max);
  useEffect(() => {
    // Follow outside changes (a reload) without fighting the user's typing.
    if (value !== (text.trim() === '' ? undefined : parsed)) setText(typeof value === 'number' ? String(value) : '');
  }, [value]);
  return (
    <SettingsRow label={label} description={description}>
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
    </SettingsRow>
  );
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

function EnvEditor({ rows, onChange, nextKey }: { rows: EnvRow[]; onChange: (rows: EnvRow[]) => void; nextKey: () => number }) {
  const t = useT();
  const update = (rowKey: number, changes: Partial<EnvRow>) => onChange(rows.map((row) => (row.key === rowKey ? { ...row, ...changes } : row)));
  return (
    <SettingsCard>
      {rows.map((row) => {
        const invalid = row.name.trim() !== '' && !ENV_NAME.test(row.name.trim());
        return (
          <div key={row.key} className={cx(SETTINGS_ROW, 'flex items-start gap-2')}>
            <Input
              aria-label={t('cliSettings.envName')}
              size="small"
              className="w-56 shrink-0"
              inputDir="ltr"
              placeholder="NAME"
              value={row.name}
              isInvalid={invalid}
              hint={invalid ? t('cliSettings.envNameInvalid') : undefined}
              onChange={(name) => update(row.key, { name })}
              inputClassName="font-mono"
            />
            <Input
              aria-label={t('cliSettings.envValue', { name: row.name })}
              size="small"
              className="min-w-0 flex-1"
              inputDir="ltr"
              type={row.revealed ? 'text' : 'password'}
              autoComplete="off"
              value={row.value}
              onChange={(value) => update(row.key, { value })}
              inputClassName="font-mono"
            />
            <IconAction
              icon={row.revealed ? RiEyeOffLine : RiEyeLine}
              size="md"
              aria-label={t(row.revealed ? 'cliSettings.hideValue' : 'cliSettings.showValue')}
              onClick={() => update(row.key, { revealed: !row.revealed })}
            />
            <IconAction
              icon={RiDeleteBin6Line}
              size="md"
              aria-label={t('cliSettings.removeEnv', { name: row.name })}
              onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
            />
          </div>
        );
      })}
      <div className={SETTINGS_ROW}>
        <Button size="small" variant="ghost" leadingIcon={RiAddLine} onClick={() => onChange([...rows, { key: nextKey(), name: '', value: '', revealed: true }])}>
          {t('cliSettings.addEnv')}
        </Button>
      </div>
    </SettingsCard>
  );
}

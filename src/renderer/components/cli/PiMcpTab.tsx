import { useCallback, useEffect, useState } from 'react';
import { RiAddLine, RiDeleteBin6Line, RiEditLine } from '@remixicon/react';
import type { PiMcpDocument, PiMcpServerConfig, V2ApiClient } from '@todex/protocol/v2';
import { isConflictError } from '@todex/protocol/connectionError';
import { Button } from '@/components/base/buttons/button';
import { Chip } from '@/components/base/badges/chip';
import { Input } from '@/components/base/input/input';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { Textarea } from '@/components/base/textarea/textarea';
import { Alert } from '@/components/ui/alert';
import { IconAction } from '@/components/ui/icon-action';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { SettingsCard, SettingsGroup, SettingsRow } from '@/components/settings/SettingsRows';
import { useT, type MessageKey } from '@/i18n';
import {
  PI_MCP_EXPOSURES,
  PI_MCP_TEMPLATE,
  piMcpEntry,
  piMcpForm,
  piMcpFormError,
  piMcpTarget,
  piMcpTransport,
  type PiMcpForm,
} from '@/lib/piMcp';

const key = (value: string) => value as MessageKey;
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

type PiMcpPatch = Parameters<V2ApiClient['patchPiMcp']>[1];

/**
 * Pi's global `mcp.json`. Every change is written at once; a stale
 * revision reloads the file and asks the user to redo the change.
 * Reloads each time the tab becomes `active`, as the Plugins tab can
 * switch `builtin:mcp` meanwhile.
 */
export function usePiMcp(active: boolean, api: () => V2ApiClient) {
  const t = useT();
  const [doc, setDoc] = useState<PiMcpDocument>();
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      setDoc(await api().getPiMcp());
    } catch (error) {
      setLoadError(errorText(error, t('piMcp.readFailed')));
    }
  }, [api]);

  useEffect(() => { if (active) void load(); }, [active, load]);

  /** Applies `patch`; resolves `false` when it was not written. */
  const apply = async (patch: PiMcpPatch) => {
    if (!doc) return false;
    setBusy(true);
    try {
      setDoc(await api().patchPiMcp(doc.revision, patch));
      return true;
    } catch (error) {
      if (isConflictError(error)) {
        toast.warning(t('piMcp.conflict'));
        await load();
      } else {
        toast.danger(errorText(error, t('piMcp.saveFailed')));
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { doc, loadError, load, busy, apply };
}

export type PiMcpState = ReturnType<typeof usePiMcp>;

type EditorTarget = { name: string | null; entry: PiMcpServerConfig };

export function PiMcpPanel({ state, onEnableBuiltin, builtinBusy }: {
  state: PiMcpState;
  /** Turns `builtin:mcp` on in `settings.json`. */
  onEnableBuiltin: () => Promise<void>;
  builtinBusy: boolean;
}) {
  const t = useT();
  const { doc, loadError, busy } = state;
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  if (loadError) {
    return (
      <Alert
        status="danger"
        title={t('piMcp.readFailed')}
        description={loadError}
        actions={<Button size="small" variant="secondary" onClick={() => void state.load()}>{t('cliSettings.retry')}</Button>}
      />
    );
  }
  if (!doc) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('piMcp.reading')} /></div>;
  }

  const servers = Object.entries(doc.config?.mcpServers ?? {});
  const names = servers.map(([name]) => name);
  const autoCodemode = doc.config?.autoEnableCodemode !== false;

  return (
    <div className="flex flex-col gap-5">
      <p className="px-3 text-body-2-regular text-text-secondary">{t('piMcp.intro')}</p>
      <p className="truncate px-3 font-mono text-caption-1-regular text-text-tertiary" dir="ltr" title={doc.path}>{doc.path}</p>
      {!doc.builtinEnabled ? (
        <Alert
          status="warning"
          title={t('piMcp.builtinOff')}
          description={t('piMcp.builtinOffHint')}
          actions={<Button size="small" variant="secondary" disabled={builtinBusy} onClick={() => void onEnableBuiltin()}>{t('piMcp.enableBuiltin')}</Button>}
        />
      ) : null}
      {doc.adapterInstalled ? <Alert status="neutral" title={t('piMcp.adapter')} description={t('piMcp.adapterHint')} /> : null}
      {doc.parseError ? <Alert status="warning" title={t('piMcp.parseError')} description={doc.parseError} /> : null}
      {doc.config ? (
        <>
          <SettingsGroup
            label={t('piMcp.servers')}
            action={(
              <Button size="small" variant="secondary" leadingIcon={RiAddLine} disabled={busy} onClick={() => setEditing({ name: null, entry: PI_MCP_TEMPLATE })}>
                {t('piMcp.add')}
              </Button>
            )}
          >
            <SettingsCard>
              {servers.length === 0 ? (
                <SettingsRow description={t(doc.exists ? 'piMcp.empty' : 'piMcp.missing')} />
              ) : servers.map(([name, entry]) => (
                <ServerRow
                  key={name}
                  name={name}
                  entry={entry}
                  busy={busy}
                  onEdit={() => setEditing({ name, entry })}
                  onRemove={() => setRemoving(name)}
                  onToggle={(enabled) => {
                    const next = { ...entry };
                    if (enabled) delete next.enabled;
                    else next.enabled = false;
                    void state.apply({ mcpServers: { [name]: next } });
                  }}
                />
              ))}
            </SettingsCard>
          </SettingsGroup>
          <SettingsGroup label={t('piMcp.options')}>
            <SettingsCard>
              <SettingsRow label={t('piMcp.autoCodemode')} description={t('piMcp.autoCodemodeHint')}>
                <Switch
                  size="sm"
                  aria-label={t('piMcp.autoCodemode')}
                  isSelected={autoCodemode}
                  isDisabled={busy}
                  onChange={(enabled) => void state.apply({ autoEnableCodemode: enabled ? null : false })}
                />
              </SettingsRow>
            </SettingsCard>
          </SettingsGroup>
          <p className="px-3 text-body-2-regular text-text-secondary">{t('piMcp.applies')}</p>
        </>
      ) : null}
      <Modal
        isOpen={Boolean(editing)}
        onOpenChange={(open) => { if (!open) setEditing(null); }}
        aria-label="MCP"
        size="xl"
        hideCloseButton
        isDismissable={false}
      >
        {editing ? (
          <ServerEditor
            key={editing.name ?? ''}
            target={editing}
            others={names.filter((name) => name !== editing.name)}
            onClose={() => setEditing(null)}
            onSubmit={async (name, entry) => {
              const patch: Record<string, PiMcpServerConfig | null> = { [name]: entry };
              if (editing.name && editing.name !== name) patch[editing.name] = null;
              if (!(await state.apply({ mcpServers: patch }))) return;
              toast.success(t(editing.name ? 'piMcp.saved' : 'piMcp.created', { name }));
              setEditing(null);
            }}
          />
        ) : null}
      </Modal>
      <ConfirmDialog
        isOpen={Boolean(removing)}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={t('piMcp.removeTitle')}
        description={removing ? t('piMcp.removeBody', { name: removing }) : null}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('piMcp.remove')}
        tone="danger"
        isPending={busy}
        onConfirm={async () => {
          if (!removing) return;
          if (await state.apply({ mcpServers: { [removing]: null } })) toast.success(t('piMcp.removed', { name: removing }));
          setRemoving(null);
        }}
      />
    </div>
  );
}

function ServerRow({ name, entry, busy, onEdit, onRemove, onToggle }: {
  name: string;
  entry: PiMcpServerConfig;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useT();
  const target = piMcpTarget(entry);
  const exposure = entry.exposure === 'codemode-deferred' ? 'codemode' : entry.exposure;
  return (
    <SettingsRow
      label={<span className="block truncate font-mono text-body-2-medium" dir="ltr">{name}</span>}
      description={(
        <span className="flex min-w-0 flex-col">
          {entry.description ? <span className="truncate">{entry.description}</span> : null}
          <span className="truncate font-mono text-caption-1-regular text-text-tertiary" dir="ltr" title={target}>{target}</span>
        </span>
      )}
    >
      {exposure && exposure !== 'codemode' ? <Chip variant="caption" color="blue">{t(key(`piMcp.exposure.${exposure}`))}</Chip> : null}
      <Chip variant="caption" color="neutral">{piMcpTransport(entry) === 'http' ? 'HTTP' : 'stdio'}</Chip>
      <IconAction icon={RiEditLine} size="sm" tooltip={t('piMcp.edit')} aria-label={t('piMcp.editOf', { name })} disabled={busy} onClick={onEdit} />
      <IconAction icon={RiDeleteBin6Line} size="sm" tooltip={t('piMcp.remove')} aria-label={t('piMcp.removeOf', { name })} disabled={busy} onClick={onRemove} />
      <Switch
        size="sm"
        aria-label={t('piMcp.enable', { name })}
        isSelected={entry.enabled !== false}
        isDisabled={busy}
        onChange={onToggle}
      />
    </SettingsRow>
  );
}

type Mode = 'form' | 'json';

function parseEntry(text: string): PiMcpServerConfig | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as PiMcpServerConfig : null;
  } catch {
    return null;
  }
}

function ServerEditor({ target, others, onClose, onSubmit }: {
  target: EditorTarget;
  others: string[];
  onClose: () => void;
  onSubmit: (name: string, entry: PiMcpServerConfig) => Promise<void>;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>('form');
  // Keys the form does not edit ride along on `base`.
  const [base, setBase] = useState(target.entry);
  const [form, setForm] = useState<PiMcpForm>(() => piMcpForm(target.name ?? '', target.entry));
  const [json, setJson] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (changes: Partial<PiMcpForm>) => setForm((current) => ({ ...current, ...changes }));

  const parsed = mode === 'json' ? parseEntry(json) : null;
  const formError = piMcpFormError(mode === 'json' && parsed ? { ...piMcpForm(form.name, parsed), name: form.name } : form, others);
  const nameError = formError === 'name' || formError === 'nameTaken' ? formError : null;
  const canSave = !saving && (mode === 'json' ? Boolean(parsed) && !nameError : !formError);
  const fieldHint = (field: string, hint?: string) => (formError === field ? t(key(`piMcp.invalid.${field}`)) : hint);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === 'json') {
      setJson(JSON.stringify(piMcpEntry(form, base), null, 2));
    } else {
      if (!parsed) return;
      setBase(parsed);
      setForm(piMcpForm(form.name, parsed));
    }
    setMode(next);
  };

  const save = async () => {
    const entry = mode === 'json' ? parsed : piMcpEntry(form, base);
    if (!entry) return;
    setSaving(true);
    try {
      await onSubmit(form.name, entry);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 truncate text-title-3-medium text-text-primary">
          {target.name ? t('piMcp.editOf', { name: target.name }) : t('piMcp.add')}
        </h2>
        <SegmentedControl
          aria-label={t('piMcp.editorMode')}
          selectedKeys={new Set([mode])}
          onSelectionChange={(keys) => { const next = [...keys][0]; if (next === 'form' || next === 'json') switchMode(next); }}
        >
          <SegmentedControlItem id="form">{t('piMcp.modeForm')}</SegmentedControlItem>
          <SegmentedControlItem id="json" isDisabled={mode === 'form' && formError !== null && formError !== 'name' && formError !== 'nameTaken'}>JSON</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <Input
        label={t('piMcp.name')}
        placeholder="my-server"
        value={form.name}
        onChange={(name) => update({ name })}
        inputDir="ltr"
        inputClassName="font-mono"
        isInvalid={Boolean(nameError) && form.name !== ''}
        hint={nameError && form.name !== '' ? t(key(`piMcp.invalid.${nameError}`)) : t('piMcp.nameHint')}
      />
      {mode === 'json' ? (
        <Textarea
          className="w-full"
          label={t('piMcp.json')}
          value={json}
          onChange={setJson}
          rows={16}
          spellCheck="false"
          isInvalid={!parsed}
          hint={parsed ? t('piMcp.jsonHint') : t('piMcp.jsonInvalid')}
          inputClassName="font-mono text-caption-1-regular"
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={t('piMcp.transport')}
              selectedKey={form.transport}
              onSelectionChange={(next) => update({ transport: next === 'http' ? 'http' : 'stdio' })}
            >
              <SelectItem id="stdio" textValue={t('piMcp.transportStdio')}>{t('piMcp.transportStdio')}</SelectItem>
              <SelectItem id="http" textValue={t('piMcp.transportHttp')}>{t('piMcp.transportHttp')}</SelectItem>
            </Select>
            <Select
              label={t('piMcp.exposureLabel')}
              selectedKey={form.exposure}
              onSelectionChange={(next) => update({ exposure: PI_MCP_EXPOSURES.find((item) => item === next) ?? 'codemode' })}
            >
              {PI_MCP_EXPOSURES.map((item) => (
                <SelectItem key={item} id={item} textValue={t(key(`piMcp.exposure.${item}`))}>{t(key(`piMcp.exposure.${item}`))}</SelectItem>
              ))}
            </Select>
          </div>
          {form.transport === 'stdio' ? (
            <>
              <Input label={t('piMcp.command')} placeholder="npx" value={form.command} onChange={(command) => update({ command })} inputDir="ltr" inputClassName="font-mono"
                isInvalid={formError === 'command' && form.command !== ''} hint={fieldHint('command', t('piMcp.commandHint'))} />
              <Textarea className="w-full" label={t('piMcp.args')} value={form.args} onChange={(args) => update({ args })} rows={3} spellCheck="false"
                hint={t('piMcp.argsHint')} inputClassName="font-mono text-caption-1-regular" />
              <Textarea className="w-full" label={t('piMcp.env')} placeholder="API_KEY=..." value={form.env} onChange={(env) => update({ env })} rows={3} spellCheck="false"
                isInvalid={formError === 'env'} hint={fieldHint('env', t('piMcp.keyValueHint'))} inputClassName="font-mono text-caption-1-regular" />
              <Input label={t('piMcp.cwd')} value={form.cwd} onChange={(cwd) => update({ cwd })} inputDir="ltr" inputClassName="font-mono" />
            </>
          ) : (
            <>
              <Input label="URL" placeholder="https://example.com/mcp" value={form.url} onChange={(url) => update({ url })} inputDir="ltr" inputClassName="font-mono"
                isInvalid={formError === 'url' && form.url !== ''} hint={fieldHint('url')} />
              <Textarea className="w-full" label={t('piMcp.headers')} placeholder="Authorization=Bearer ${TOKEN}" value={form.headers} onChange={(headers) => update({ headers })} rows={3} spellCheck="false"
                isInvalid={formError === 'headers'} hint={fieldHint('headers', t('piMcp.keyValueHint'))} inputClassName="font-mono text-caption-1-regular" />
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Input label={t('piMcp.description')} value={form.description} onChange={(description) => update({ description })} />
            <Input label={t('piMcp.timeout')} placeholder="60" value={form.timeout} onChange={(timeout) => update({ timeout })} inputDir="ltr"
              isInvalid={formError === 'timeout'} hint={fieldHint('timeout')} />
          </div>
          <p className="text-body-2-regular text-text-secondary">{t('piMcp.advancedHint')}</p>
        </>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="secondary" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button onClick={() => void save()} disabled={!canSave} aria-busy={saving || undefined}>{t('common.save')}</Button>
      </div>
    </div>
  );
}

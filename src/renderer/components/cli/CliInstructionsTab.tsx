import { useCallback, useEffect, useState } from 'react';
import { RiAddLine } from '@remixicon/react';
import type { CliInstructionsDocument, CliSettingsProvider, InstructionPreset, InstructionPresetSync, V2ApiClient } from '@todex/protocol/v2';
import { isConflictError } from '@todex/protocol/connectionError';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Textarea } from '@/components/base/textarea/textarea';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { CLI_SETTINGS } from '@/lib/cliSettings';

/** Select key for "the file keeps its own text". */
const OWN = '__own';

type Translate = ReturnType<typeof useT>;

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export const cliDisplayName = (provider: string) => CLI_SETTINGS[provider as CliSettingsProvider]?.name ?? provider;

/** Toasts what a preset edit did to the files that follow it. */
export function reportPresetSync(t: Translate, name: string, sync: InstructionPresetSync[]) {
  const names = (status: InstructionPresetSync['status']) => sync.filter((item) => item.status === status).map((item) => cliDisplayName(item.provider)).join(', ');
  toast.success(t('cliInstructions.presetSaved', { name }));
  const drifted = names('drifted');
  if (drifted) toast.warning(t('cliInstructions.syncDrifted', { names: drifted }));
  for (const item of sync.filter((entry) => entry.status === 'failed')) {
    toast.danger(t('cliInstructions.syncFailed', { name: cliDisplayName(item.provider), message: item.message ?? '' }));
  }
}

/**
 * A CLI's global instruction file and the preset it may follow. Its own text
 * is edited in place; a followed preset is edited for every CLI following it.
 */
export function useCliInstructions(provider: CliSettingsProvider, api: () => V2ApiClient) {
  const t = useT();
  const [doc, setDoc] = useState<CliInstructionsDocument>();
  const [presets, setPresets] = useState<InstructionPreset[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** A preset waiting for the user to confirm it may overwrite the file. */
  const [pendingPreset, setPendingPreset] = useState<string>();

  const preset = doc?.presetId ? presets.find((item) => item.id === doc.presetId) : undefined;
  // A drifted file shows its current text; preset edits leave it alone.
  const editingPreset = Boolean(preset) && !doc?.drifted;
  const base = editingPreset && preset ? preset.text : doc?.text ?? '';
  const dirty = Boolean(doc) && draft !== base;

  /** Takes in the file and presets; `keepDraft` keeps unsaved edits (after a conflict). */
  const adopt = useCallback((next: CliInstructionsDocument, nextPresets: InstructionPreset[], keepDraft = false) => {
    setDoc(next);
    setPresets(nextPresets);
    setPendingPreset(undefined);
    if (keepDraft) return;
    const followed = next.presetId && !next.drifted ? nextPresets.find((item) => item.id === next.presetId) : undefined;
    setDraft(followed ? followed.text : next.text);
  }, []);

  const reload = useCallback(async (keepDraft = false) => {
    const [next, list] = await Promise.all([api().getCliInstructions(provider), api().listInstructionPresets()]);
    adopt(next, list.presets, keepDraft);
  }, [adopt, api, provider]);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      await reload();
    } catch (error) {
      setLoadError(errorText(error, t('cliInstructions.readFailed')));
    }
  }, [reload]);

  useEffect(() => { void load(); }, [load]);

  /** Runs a write and tells whether it succeeded; a conflict reloads with the draft kept so nothing typed is lost. */
  const run = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await work();
      return true;
    } catch (error) {
      if (!isConflictError(error)) {
        toast.danger(errorText(error, failure));
        return false;
      }
      try {
        await reload(true);
        toast.warning(t('cliInstructions.conflict'));
      } catch (reloadError) {
        toast.danger(errorText(reloadError, t('cliInstructions.readFailed')));
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(async () => {
    if (!doc) return;
    if (editingPreset && preset) {
      const { sync } = await api().updateInstructionPreset(preset.id, preset.revision, preset.name, draft);
      await reload();
      reportPresetSync(t, preset.name, sync);
    } else {
      const next = await api().writeCliInstructions(provider, doc.revision, draft);
      adopt(next, presets);
      toast.success(t('cliInstructions.saved', { file: fileName(next.path) }));
    }
  }, t('cliInstructions.saveFailed'));

  const applySource = (presetId: string | null) => run(async () => {
    if (!doc) return;
    const next = await api().setCliInstructionsSource(provider, doc.revision, presetId);
    const list = await api().listInstructionPresets();
    // Unsaved preset edits stay in the editor as the file's own unsaved text.
    adopt(next, list.presets, presetId === null && dirty);
  }, t('cliInstructions.saveFailed'));

  /** Follows a preset, after a confirmation when that would replace text of the file's own or unsaved edits. */
  const chooseSource = (key: string) => {
    if (!doc) return;
    if (key === OWN) {
      if (doc.presetId) void applySource(null);
      return;
    }
    if (key === doc.presetId && !doc.drifted) return;
    const target = presets.find((item) => item.id === key);
    const replacesOwnText = !doc.presetId && doc.text.trim() !== '' && doc.text !== target?.text;
    if (replacesOwnText || dirty || doc.drifted) setPendingPreset(key);
    else void applySource(key);
  };

  const saveAsPreset = (name: string) => run(async () => {
    if (!doc) return;
    const created = await api().createInstructionPreset(name, draft);
    const next = await api().setCliInstructionsSource(provider, doc.revision, created.id);
    const list = await api().listInstructionPresets();
    adopt(next, list.presets);
    toast.success(t('cliInstructions.presetCreated', { name: created.name }));
  }, t('cliInstructions.saveFailed'));

  return {
    doc, presets, preset, loadError, draft, setDraft, busy, dirty, editingPreset, pendingPreset,
    canSave: Boolean(doc) && !busy && dirty && !doc?.drifted,
    load, save, chooseSource, applySource, saveAsPreset,
    cancelPending: () => setPendingPreset(undefined),
  };
}

export type CliInstructionsState = ReturnType<typeof useCliInstructions>;

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

export function CliInstructionsPanel({ state }: { state: CliInstructionsState }) {
  const t = useT();
  const { doc, presets, preset, loadError, draft, setDraft, busy, editingPreset, pendingPreset } = state;
  const [newName, setNewName] = useState<string | null>(null);

  if (loadError) {
    return (
      <Alert
        status="danger"
        title={t('cliInstructions.readFailed')}
        description={loadError}
        actions={<Button size="small" variant="secondary" onClick={() => void state.load()}>{t('cliSettings.retry')}</Button>}
      />
    );
  }
  if (!doc) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('cliInstructions.reading')} /></div>;
  }

  const file = fileName(doc.path);
  const pending = pendingPreset ? presets.find((item) => item.id === pendingPreset) : undefined;
  const others = preset ? preset.usedBy.map(cliDisplayName).join(', ') : '';
  const trimmedName = newName?.trim() ?? '';

  return (
    <div className="flex flex-col gap-3">
      <p className="truncate px-3 text-body-2-regular text-text-secondary" dir="ltr" title={doc.path}>{doc.path}</p>
      {doc.overridePath ? (
        <Alert status="warning" title={t('cliInstructions.overrideTitle')} description={t('cliInstructions.overrideHint', { path: doc.overridePath, file })} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2 px-3">
        <span className="text-body-regular text-text-primary">{t('cliInstructions.source')}</span>
        <Select
          aria-label={t('cliInstructions.source')}
          className="w-56"
          triggerClassName="h-8 rounded-lg px-2 py-1.5"
          popoverClassName="w-(--trigger-width)"
          isDisabled={busy}
          selectedKey={pendingPreset ?? doc.presetId ?? OWN}
          onSelectionChange={(key) => { if (key != null) state.chooseSource(String(key)); }}
        >
          <SelectItem id={OWN} textValue={t('cliInstructions.sourceOwn')}>{t('cliInstructions.sourceOwn')}</SelectItem>
          {presets.map((item) => (
            <SelectItem key={item.id} id={item.id} textValue={item.name}>{item.name}</SelectItem>
          ))}
        </Select>
        {!doc.presetId && newName === null ? (
          <Button size="small" variant="ghost" leadingIcon={RiAddLine} disabled={busy} onClick={() => setNewName('')}>
            {t('cliInstructions.saveAsPreset')}
          </Button>
        ) : null}
      </div>
      {newName !== null ? (
        <div className="flex flex-wrap items-start gap-2 px-3">
          <Input
            aria-label={t('cliInstructions.presetName')}
            size="small"
            className="w-56"
            placeholder={t('cliInstructions.presetName')}
            value={newName}
            onChange={setNewName}
            autoFocus
          />
          <Button
            size="small"
            disabled={busy || trimmedName === ''}
            onClick={() => { void state.saveAsPreset(trimmedName).then((created) => { if (created) setNewName(null); }); }}
          >
            {t('cliInstructions.createAndFollow')}
          </Button>
          <Button size="small" variant="secondary" onClick={() => setNewName(null)}>{t('common.cancel')}</Button>
        </div>
      ) : null}
      {pending ? (
        <Alert
          status="warning"
          title={t('cliInstructions.confirmTitle', { name: pending.name, file })}
          description={t('cliInstructions.confirmHint')}
          actions={(
            <>
              <Button size="small" variant="danger" disabled={busy} onClick={() => void state.applySource(pending.id)}>{t('cliInstructions.confirmReplace')}</Button>
              <Button size="small" variant="secondary" onClick={state.cancelPending}>{t('common.cancel')}</Button>
            </>
          )}
        />
      ) : null}
      {doc.drifted && preset ? (
        <Alert
          status="warning"
          title={t('cliInstructions.driftedTitle', { name: preset.name })}
          description={t('cliInstructions.driftedHint', { file })}
          actions={(
            <>
              <Button size="small" variant="secondary" disabled={busy} onClick={() => void state.applySource(preset.id)}>{t('cliInstructions.overwrite')}</Button>
              <Button size="small" variant="secondary" disabled={busy} onClick={() => void state.applySource(null)}>{t('cliInstructions.keepOwn')}</Button>
            </>
          )}
        />
      ) : null}
      <p className="px-3 text-body-2-regular text-text-secondary">
        {editingPreset && preset
          ? t('cliInstructions.editingPreset', { name: preset.name, names: others })
          : doc.exists ? t('cliInstructions.ownHint', { file }) : t('cliInstructions.missingHint', { file })}
      </p>
      <Textarea
        className="w-full"
        aria-label={editingPreset && preset ? preset.name : file}
        value={draft}
        onChange={setDraft}
        isReadOnly={doc.drifted}
        rows={20}
        spellCheck="false"
        inputClassName="font-mono text-caption-1-regular"
      />
    </div>
  );
}

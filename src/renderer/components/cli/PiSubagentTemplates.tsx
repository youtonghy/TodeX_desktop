import { useCallback, useEffect, useMemo, useState } from 'react';
import { RiAddLine, RiDeleteBin6Line, RiEditLine } from '@remixicon/react';
import type { PiSubagentTemplateDocument, PiSubagentTemplateList, PiSubagentTemplateSummary, V2ApiClient } from '@todex/protocol/v2';
import { ConnectionError, isConflictError } from '@todex/protocol/connectionError';
import { Button } from '@/components/base/buttons/button';
import { Chip } from '@/components/base/badges/chip';
import { Input } from '@/components/base/input/input';
import { Switch } from '@/components/base/switch/switch';
import { Tab, TabList, TabPanel, Tabs } from '@/components/base/tabs/tabs';
import { Textarea } from '@/components/base/textarea/textarea';
import { Alert } from '@/components/ui/alert';
import { IconAction } from '@/components/ui/icon-action';
import { ConfirmDialog } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { SettingsCard, SettingsGroup, SettingsRow, SettingsSubpage } from '@/components/settings/SettingsRows';
import { useT, type MessageKey } from '@/i18n';
import { applyMergePatch, fieldId, getAt, mergePatch, setAt, type SettingsObject } from '@/lib/cliSettings';
import { PI_SUBAGENT_TEMPLATE_FILE, PI_SUBAGENT_TEMPLATE_GROUPS, PI_SUBAGENT_TEMPLATE_SKELETON } from '@/lib/piPlugins';
import { SettingsField } from './SettingsFields';

/**
 * The global agent types of `@tintinweb/pi-subagents`
 * (`<pi_dir>/agents/*.md`), listed on its plugin page: built-in agents
 * switched on and off, custom templates created, edited and deleted. A
 * template opens in an editor with a form view (front matter fields plus the
 * system prompt) and a source view (the file as text); the settings page's
 * Save button saves the view shown.
 */

const key = (value: string) => value as MessageKey;
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const PREFIX = 'piSubagentTemplates';

type Mode = 'form' | 'source';

type Editor = {
  /** Unset while creating. */
  file?: string;
  doc?: PiSubagentTemplateDocument;
  loadError?: string;
  mode: Mode;
  /** The new template's file name. */
  fileName: string;
  /** The front matter the form started from, and its edits. */
  saved: SettingsObject;
  draft: SettingsObject;
  body: string;
  source: string;
};

/** The form shows `tools` as one comma-separated line; a YAML list is joined the same way on both sides, so it only changes when edited. */
function formFrontMatter(frontMatter: Record<string, unknown> | null | undefined): SettingsObject {
  const next: SettingsObject = { ...frontMatter };
  if (Array.isArray(next.tools)) next.tools = next.tools.map(String).join(', ');
  return next;
}

function editorFor(doc: PiSubagentTemplateDocument): Editor {
  const saved = formFrontMatter(doc.frontMatter);
  return { file: doc.file, doc, mode: doc.frontMatter ? 'form' : 'source', fileName: doc.file, saved, draft: saved, body: doc.body, source: doc.content };
}

export function usePiSubagentTemplates(active: boolean, api: () => V2ApiClient) {
  const t = useT();
  const [list, setList] = useState<PiSubagentTemplateList>();
  const [loadError, setLoadError] = useState<string>();
  /** The daemon predates template management. */
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      setList(await api().listPiSubagentTemplates());
    } catch (error) {
      if (error instanceof ConnectionError && error.httpStatus === 404) setUnsupported(true);
      else setLoadError(errorText(error, t('piPlugins.readFailed')));
    }
  }, [api]);

  useEffect(() => {
    if (!active) {
      setEditor(null);
      return;
    }
    void load();
  }, [active, load]);

  const open = async (file?: string) => {
    if (!file) {
      setEditor({ mode: 'form', fileName: '', saved: {}, draft: {}, body: '', source: PI_SUBAGENT_TEMPLATE_SKELETON });
      return;
    }
    setEditor({ file, mode: 'form', fileName: file, saved: {}, draft: {}, body: '', source: '' });
    try {
      const doc = await api().getPiSubagentTemplate(file);
      setEditor((current) => (current?.file === file ? editorFor(doc) : current));
    } catch (error) {
      setEditor((current) => (current?.file === file ? { ...current, loadError: errorText(error, t('piPlugins.readFailed')) } : current));
    }
  };

  const patch = useMemo(() => (editor ? mergePatch(editor.saved, editor.draft) : {}), [editor]);
  const formDirty = Boolean(editor) && (Object.keys(patch).length > 0 || editor!.body.trim() !== (editor!.doc?.body ?? ''));
  const sourceDirty = Boolean(editor) && editor!.source !== (editor!.doc?.content ?? PI_SUBAGENT_TEMPLATE_SKELETON);
  const dirty = Boolean(editor) && (editor!.mode === 'form' ? formDirty : sourceDirty);
  const fileNameValid = Boolean(editor?.file) || PI_SUBAGENT_TEMPLATE_FILE.test(editor?.fileName ?? '');
  const ready = Boolean(editor) && (editor!.file ? Boolean(editor!.doc) : true);
  const canSave = ready && !saving && fileNameValid && (editor!.file ? dirty : true);

  const save = async () => {
    if (!editor || !canSave) return;
    const input = editor.mode === 'form'
      ? { frontMatter: editor.file ? patch : editor.draft, body: editor.body }
      : { content: editor.source };
    setSaving(true);
    try {
      const doc = editor.file && editor.doc
        ? await api().updatePiSubagentTemplate(editor.file, editor.doc.revision, input)
        : await api().createPiSubagentTemplate(editor.fileName, input);
      setEditor({ ...editorFor(doc), mode: editor.mode });
      toast.success(t('piSubagentTemplates.saved', { name: doc.file }));
      void load();
    } catch (error) {
      if (!isConflictError(error) || !editor.file) {
        toast.danger(errorText(error, t('piPlugins.saveFailed')));
        return;
      }
      // Changed elsewhere: take the new revision in and replay the edits on top for review.
      try {
        const latest = await api().getPiSubagentTemplate(editor.file);
        const saved = formFrontMatter(latest.frontMatter);
        setEditor({ ...editor, doc: latest, saved, draft: latest.frontMatter ? applyMergePatch(saved, patch) : editor.draft });
        toast.warning(t('piPlugins.conflict'));
      } catch (reloadError) {
        toast.danger(errorText(reloadError, t('piPlugins.readFailed')));
      }
    } finally {
      setSaving(false);
    }
  };

  const run = async (id: string, work: () => Promise<void>) => {
    setBusy(id);
    try {
      await work();
    } catch (error) {
      toast.danger(errorText(error, t('piPlugins.saveFailed')));
      await load();
    } finally {
      setBusy(undefined);
    }
  };

  const setBuiltIn = (name: string, enabled: boolean) => run(`builtin:${name}`, async () => {
    setList(await api().setPiBuiltInSubagent(name, enabled));
  });

  const setEnabled = (template: PiSubagentTemplateSummary, enabled: boolean) => run(template.file, async () => {
    const doc = await api().getPiSubagentTemplate(template.file);
    await api().updatePiSubagentTemplate(template.file, doc.revision, { frontMatter: { enabled: enabled ? null : false }, body: doc.body });
    await load();
  });

  const remove = (file: string) => run(file, async () => {
    await api().deletePiSubagentTemplate(file);
    toast.success(t('piSubagentTemplates.deleted', { name: file }));
    await load();
  });

  return {
    list,
    loadError,
    unsupported,
    load,
    busy,
    setBuiltIn,
    setEnabled,
    remove,
    editor,
    open,
    close: () => setEditor(null),
    update: (change: (editor: Editor) => Editor) => setEditor((current) => (current ? change(current) : current)),
    formDirty,
    sourceDirty,
    dirty: Boolean(editor) && (formDirty || sourceDirty),
    saving,
    canSave,
    save,
  };
}

export type PiSubagentTemplatesState = ReturnType<typeof usePiSubagentTemplates>;

/** The template list on the subagents plugin page. */
export function PiSubagentTemplatesSection({ state }: { state: PiSubagentTemplatesState }) {
  const t = useT();
  const [confirm, setConfirm] = useState<string | null>(null);
  const { list } = state;
  if (state.unsupported) return null;
  const action = (
    <Button size="small" variant="secondary" leadingIcon={RiAddLine} disabled={!list} onClick={() => void state.open()}>
      {t('piSubagentTemplates.create')}
    </Button>
  );
  return (
    <SettingsGroup label={t('piSubagentTemplates.title')} description={t('piSubagentTemplates.description')} action={action}>
      {state.loadError ? (
        <Alert
          status="danger"
          title={t('piPlugins.readFailed')}
          description={state.loadError}
          actions={<Button size="small" variant="secondary" onClick={() => void state.load()}>{t('cliSettings.retry')}</Button>}
        />
      ) : !list ? (
        <div className="flex min-h-24 items-center justify-center"><Spinner size="md" aria-label={t('piPlugins.reading')} /></div>
      ) : (
        <>
          <p className="truncate px-3 font-mono text-caption-1-regular text-text-tertiary" dir="ltr" title={list.dir}>{list.dir}</p>
          <SettingsCard>
            {list.builtIns.map((builtIn) => (
              <SettingsRow
                key={builtIn.name}
                label={(
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-mono text-body-2-medium" dir="ltr">{builtIn.name}</span>
                    <Chip variant="caption" color="neutral">{t('piSubagentTemplates.builtIn')}</Chip>
                  </span>
                )}
                description={builtIn.state === 'overridden'
                  ? t('piSubagentTemplates.overriddenBy', { file: `${builtIn.file}.md` })
                  : t(key(`piSubagentTemplates.builtInSummary.${builtIn.name}`))}
              >
                <Switch
                  size="sm"
                  aria-label={t('piPlugins.enable', { name: builtIn.name })}
                  isSelected={builtIn.state !== 'disabled'}
                  isDisabled={builtIn.state === 'overridden' || Boolean(state.busy)}
                  onChange={(enabled) => void state.setBuiltIn(builtIn.name, enabled)}
                />
              </SettingsRow>
            ))}
            {list.templates.map((template) => (
              <TemplateRow key={template.file} template={template} state={state} onDelete={() => setConfirm(template.file)} />
            ))}
          </SettingsCard>
          {list.templates.length === 0 ? <p className="px-3 text-body-2-regular text-text-secondary">{t('piSubagentTemplates.empty')}</p> : null}
        </>
      )}
      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={t('piSubagentTemplates.deleteTitle')}
        description={confirm ? t('piSubagentTemplates.deleteBody', { name: `${confirm}.md` }) : null}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('piSubagentTemplates.delete')}
        tone="danger"
        onConfirm={async () => {
          if (confirm) await state.remove(confirm);
          setConfirm(null);
        }}
      />
    </SettingsGroup>
  );
}

function TemplateRow({ template, state, onDelete }: { template: PiSubagentTemplateSummary; state: PiSubagentTemplatesState; onDelete: () => void }) {
  const t = useT();
  const label = template.displayName ?? template.name;
  return (
    <SettingsRow
      label={(
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-body-2-medium" dir="auto">{label}</span>
          <span className="shrink-0 font-mono text-caption-1-regular text-text-tertiary" dir="ltr">{template.file}.md</span>
        </span>
      )}
      description={template.parseError ?? template.description}
    >
      {template.parseError ? <Chip variant="caption" color="orange">{t('piSubagentTemplates.parseError')}</Chip> : null}
      {template.overridesBuiltIn ? <Chip variant="caption" color="blue">{t('piSubagentTemplates.overridesBuiltIn')}</Chip> : null}
      {template.model ? <Chip variant="caption" color="neutral"><span dir="ltr">{template.model}</span></Chip> : null}
      <IconAction icon={RiEditLine} size="sm" tooltip={t('piSubagentTemplates.edit')} aria-label={t('piSubagentTemplates.editOf', { name: template.file })}
        onClick={() => void state.open(template.file)} />
      <IconAction icon={RiDeleteBin6Line} size="sm" tooltip={t('piSubagentTemplates.delete')} aria-label={t('piSubagentTemplates.deleteOf', { name: template.file })}
        disabled={Boolean(state.busy)} onClick={onDelete} />
      <Switch
        size="sm"
        aria-label={t('piPlugins.enable', { name: template.file })}
        isSelected={template.enabled}
        isDisabled={Boolean(template.parseError) || Boolean(state.busy)}
        onChange={(enabled) => void state.setEnabled(template, enabled)}
      />
    </SettingsRow>
  );
}

/** One template's editor, shown in place of the plugin page. */
export function PiSubagentTemplateEditor({ state }: { state: PiSubagentTemplatesState }) {
  const t = useT();
  const { editor } = state;
  if (!editor) return null;
  const creating = !editor.file;
  const parseError = editor.doc?.parseError;
  const fileInvalid = creating && editor.fileName !== '' && !PI_SUBAGENT_TEMPLATE_FILE.test(editor.fileName);
  return (
    <SettingsSubpage
      title={creating ? t('piSubagentTemplates.createTitle') : <span className="font-mono" dir="ltr">{editor.file}.md</span>}
      description={t('piSubagentTemplates.editorHint')}
      onBack={() => {
        if (state.dirty) toast.warning(t('piPlugins.discarded'));
        state.close();
      }}
    >
      {editor.loadError ? (
        <Alert
          status="danger"
          title={t('piPlugins.readFailed')}
          description={editor.loadError}
          actions={<Button size="small" variant="secondary" onClick={() => void state.open(editor.file)}>{t('cliSettings.retry')}</Button>}
        />
      ) : !creating && !editor.doc ? (
        <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('piPlugins.reading')} /></div>
      ) : (
        <>
          {editor.doc ? <p className="truncate px-3 font-mono text-caption-1-regular text-text-tertiary" dir="ltr" title={editor.doc.path}>{editor.doc.path}</p> : null}
          {creating ? (
            <SettingsCard>
              <SettingsRow label={t('piSubagentTemplates.fileName')} description={t('piSubagentTemplates.fileNameHint')}>
                <Input
                  aria-label={t('piSubagentTemplates.fileName')}
                  size="small"
                  className="w-44"
                  inputDir="ltr"
                  placeholder="auditor"
                  isInvalid={fileInvalid}
                  value={editor.fileName}
                  onChange={(fileName) => state.update((current) => ({ ...current, fileName: fileName.trim() }))}
                />
              </SettingsRow>
            </SettingsCard>
          ) : null}
          {parseError ? <Alert status="warning" title={t('piSubagentTemplates.parseErrorTitle')} description={parseError} /> : null}
          <Tabs
            selectedKey={editor.mode}
            onSelectionChange={(mode) => state.update((current) => ({ ...current, mode: mode === 'source' ? 'source' : 'form' }))}
            className="gap-0"
          >
            <TabList aria-label={t('piSubagentTemplates.viewsLabel')}>
              {/* Each view saves its own edits; switching waits until they are saved or undone. */}
              <Tab id="form" isDisabled={Boolean(parseError) || (editor.mode === 'source' && state.sourceDirty)}>{t('piSubagentTemplates.formView')}</Tab>
              <Tab id="source" isDisabled={editor.mode === 'form' && state.formDirty}>{t('piSubagentTemplates.sourceView')}</Tab>
            </TabList>
            <TabPanel id="form" className="flex flex-col gap-5 pt-4">
              {PI_SUBAGENT_TEMPLATE_GROUPS.map((group) => (
                <SettingsGroup key={group.id} label={t(key(`${PREFIX}.group.${group.id}`))}>
                  <SettingsCard>
                    {group.fields.map((field) => (
                      <SettingsField
                        key={fieldId(field.path)}
                        field={field}
                        keyPrefix={PREFIX}
                        value={getAt(editor.draft, field.path)}
                        onChange={(value) => state.update((current) => ({ ...current, draft: setAt(current.draft, field.path, value) }))}
                      />
                    ))}
                  </SettingsCard>
                </SettingsGroup>
              ))}
              <SettingsGroup label={t('piSubagentTemplates.prompt')} description={t('piSubagentTemplates.promptHint')}>
                <Textarea
                  className="w-full"
                  aria-label={t('piSubagentTemplates.prompt')}
                  value={editor.body}
                  rows={10}
                  autoResize
                  maxRows={30}
                  placeholder={t('piSubagentTemplates.promptPlaceholder')}
                  onChange={(body) => state.update((current) => ({ ...current, body }))}
                />
              </SettingsGroup>
              <p className="px-3 text-body-2-regular text-text-secondary">{t('piSubagentTemplates.formHint')}</p>
            </TabPanel>
            <TabPanel id="source" className="flex flex-col gap-3 pt-4">
              <Textarea
                className="w-full"
                aria-label={t('piSubagentTemplates.sourceView')}
                value={editor.source}
                rows={22}
                spellCheck="false"
                hint={t('piSubagentTemplates.sourceHint')}
                inputClassName="font-mono text-caption-1-regular"
                onChange={(source) => state.update((current) => ({ ...current, source }))}
              />
            </TabPanel>
          </Tabs>
        </>
      )}
    </SettingsSubpage>
  );
}

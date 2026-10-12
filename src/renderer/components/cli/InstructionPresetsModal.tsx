import { useCallback, useEffect, useState } from 'react';
import { RiAddLine, RiDeleteBin6Line } from '@remixicon/react';
import type { InstructionPreset, V2ApiClient } from '@todex/protocol/v2';
import { isConflictError } from '@todex/protocol/connectionError';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Textarea } from '@/components/base/textarea/textarea';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { cx } from '@/utils/cx';
import { cliDisplayName, reportPresetSync } from './CliInstructionsTab';

/** Selection key of a preset not created yet. */
const NEW = '__new';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** The global AGENTS.md preset library that CLIs can follow. */
export function InstructionPresetsModal({ isOpen, onClose, api }: { isOpen: boolean; onClose: () => void; api: () => V2ApiClient }) {
  const t = useT();
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('instructionPresets.title')}
      description={t('instructionPresets.description')}
      size="2xl"
      className="h-[min(760px,calc(100dvh-32px))]"
      isDismissable={false}
      bodyClassName="flex flex-col overflow-hidden pb-0"
    >
      {isOpen ? <PresetsEditor api={api} onClose={onClose} /> : null}
    </Modal>
  );
}

function PresetsEditor({ api, onClose }: { api: () => V2ApiClient; onClose: () => void }) {
  const t = useT();
  const [presets, setPresets] = useState<InstructionPreset[]>();
  const [loadError, setLoadError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const current = presets?.find((item) => item.id === selected);
  const isNew = selected === NEW;
  const dirty = isNew ? name.trim() !== '' || text !== '' : Boolean(current) && (name !== current?.name || text !== current?.text);

  const select = (id: string | undefined, list = presets ?? []) => {
    const preset = list.find((item) => item.id === id);
    setSelected(id);
    setName(preset?.name ?? '');
    setText(preset?.text ?? '');
    setConfirmDelete(false);
  };

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      const { presets: list } = await api().listInstructionPresets();
      setPresets(list);
      return list;
    } catch (error) {
      setLoadError(errorText(error, t('instructionPresets.readFailed')));
      return undefined;
    }
  }, [api]);

  useEffect(() => {
    void load().then((list) => { if (list) select(list[0]?.id, list); });
  }, [load]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      if (isConflictError(error)) {
        // Someone else edited the preset: take theirs in, keep the typed text.
        await load();
        toast.warning(t('cliInstructions.conflict'));
      } else {
        toast.danger(errorText(error, t('cliInstructions.saveFailed')));
      }
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(async () => {
    const trimmed = name.trim();
    if (isNew) {
      const created = await api().createInstructionPreset(trimmed, text);
      const list = await load();
      select(created.id, list);
      toast.success(t('cliInstructions.presetCreated', { name: created.name }));
    } else if (current) {
      const { preset, sync } = await api().updateInstructionPreset(current.id, current.revision, trimmed, text);
      const list = await load();
      select(preset.id, list);
      reportPresetSync(t, preset.name, sync);
    }
  });

  const remove = () => run(async () => {
    if (!current) return;
    await api().deleteInstructionPreset(current.id);
    const list = await load();
    select(list?.[0]?.id, list);
    toast.success(t('instructionPresets.deleted', { name: current.name }));
  });

  if (loadError) {
    return (
      <Alert
        status="danger"
        title={t('instructionPresets.readFailed')}
        description={loadError}
        actions={<Button size="small" variant="secondary" onClick={() => void load()}>{t('cliSettings.retry')}</Button>}
      />
    );
  }
  if (!presets) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('instructionPresets.reading')} /></div>;
  }

  const editing = isNew || current;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex w-52 shrink-0 flex-col gap-2">
          <Button size="small" variant="secondary" leadingIcon={RiAddLine} disabled={busy} onClick={() => select(NEW)}>
            {t('instructionPresets.new')}
          </Button>
          <ScrollArea surface="full" className="flex-1" contentClassName="flex flex-col gap-1">
            {presets.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => select(item.id)}
                className={cx(
                  'flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-start outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                  item.id === selected ? 'bg-background-secondary-default' : 'hover:bg-background-secondary-hover',
                )}
              >
                <span className="w-full truncate text-body-medium text-text-primary">{item.name}</span>
                <span className="w-full truncate text-caption-1-regular text-text-secondary">
                  {item.usedBy.length > 0 ? item.usedBy.map(cliDisplayName).join(', ') : t('instructionPresets.unused')}
                </span>
              </button>
            ))}
          </ScrollArea>
        </div>
        <ScrollArea surface="full" className="min-w-0 flex-1" contentClassName="flex flex-col gap-3 pb-4">
          {editing ? (
            <>
              <Input
                label={t('cliInstructions.presetName')}
                size="small"
                value={name}
                onChange={setName}
                autoFocus={isNew}
              />
              {current ? (
                <p className="text-body-2-regular text-text-secondary">
                  {current.usedBy.length > 0
                    ? t('instructionPresets.usedBy', { names: current.usedBy.map(cliDisplayName).join(', ') })
                    : t('instructionPresets.notUsed')}
                </p>
              ) : null}
              <Textarea
                className="w-full"
                aria-label={t('instructionPresets.content')}
                value={text}
                onChange={setText}
                rows={18}
                spellCheck="false"
                inputClassName="font-mono text-caption-1-regular"
              />
              {confirmDelete && current ? (
                <Alert
                  status="warning"
                  title={t('instructionPresets.confirmDelete', { name: current.name })}
                  description={t('instructionPresets.confirmDeleteHint')}
                  actions={(
                    <>
                      <Button size="small" variant="danger" disabled={busy} onClick={() => void remove()}>{t('common.delete')}</Button>
                      <Button size="small" variant="secondary" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
                    </>
                  )}
                />
              ) : null}
            </>
          ) : (
            <EmptyState title={t('instructionPresets.emptyTitle')} description={t('instructionPresets.emptyHint')} />
          )}
        </ScrollArea>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-separator-border pt-4 pb-6">
        {current && !confirmDelete ? (
          <Button variant="ghost" leadingIcon={RiDeleteBin6Line} className="me-auto" disabled={busy} onClick={() => setConfirmDelete(true)}>
            {t('common.delete')}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.close')}</Button>
        <Button onClick={() => void save()} disabled={!editing || busy || !dirty || name.trim() === ''} aria-busy={busy || undefined}>
          {isNew ? t('instructionPresets.create') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

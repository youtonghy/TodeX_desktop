import { useEffect, useState } from 'react';
import { RiDeleteBinLine, RiFolderAddLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Switch } from '@/components/base/switch/switch';
import { useT } from '../../i18n';
import { SettingsCard, SettingsNote, SettingsRow } from '../settings/SettingsRows';
import { Modal } from '../ui/modal';

const NAME = /^[a-z0-9_-]{1,48}$/;

/** Settings → TodeX Container → New container: name, mounted folders, SSH agent. */
export function CreateContainerDialog({ isOpen, onOpenChange, onCreated }: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useT();
  const api = window.todexDesktop.container;
  const [name, setName] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [sshAgent, setSshAgent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const sshSupported = window.todexDesktop.shell.platform !== 'win32';

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setFolders([]);
    setSshAgent(false);
    setError('');
    setProgress('');
  }, [isOpen]);
  useEffect(() => api.onProgress((event) => setProgress(event.line ?? '')), [api]);

  const addFolder = async () => {
    const path = await window.todexDesktop.dialog.openDirectory();
    if (path && !folders.includes(path)) setFolders((current) => [...current, path]);
  };

  const nameValid = !name || NAME.test(name);
  const create = async () => {
    setCreating(true);
    setError('');
    try {
      await api.create({ name: name || undefined, mounts: folders, sshAgent });
      onCreated();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => !creating && onOpenChange(open)}
      title={t('container.create.title')}
      size="lg"
      isDismissable={!creating}
      bodyClassName="flex flex-col gap-4"
      footer={(
        <>
          <Button variant="secondary" disabled={creating} onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button disabled={creating || !folders.length || !nameValid} onClick={() => void create()}>{creating ? t('container.create.creating') : t('container.create.confirm')}</Button>
        </>
      )}
    >
      <Input
        label={t('container.create.name')}
        placeholder={t('container.create.namePlaceholder')}
        hint={nameValid ? t('container.create.nameHint') : t('container.create.nameInvalid')}
        isInvalid={!nameValid}
        isDisabled={creating}
        value={name}
        onChange={(value) => setName(value.trim().toLowerCase())}
      />
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-body-2-medium text-text-primary">{t('container.create.folders')}</span>
          <Button size="small" variant="secondary" leadingIcon={RiFolderAddLine} disabled={creating} onClick={() => void addFolder()}>{t('container.mountAdd')}</Button>
        </div>
        <SettingsCard>
          {folders.length ? folders.map((folder) => (
            <SettingsRow key={folder} label={<span className="font-mono text-body-2-regular">{folder}</span>}>
              <Button size="small" variant="secondary" iconOnly leadingIcon={RiDeleteBinLine} aria-label={t('container.mountRemove')} disabled={creating} onClick={() => setFolders((current) => current.filter((item) => item !== folder))} />
            </SettingsRow>
          )) : <SettingsNote>{t('container.create.foldersEmpty')}</SettingsNote>}
        </SettingsCard>
      </div>
      {sshSupported ? (
        <SettingsCard>
          <SettingsRow label={t('container.create.sshAgent')} description={t('container.create.sshAgentHint')}>
            <Switch size="sm" aria-label={t('container.create.sshAgent')} isDisabled={creating} isSelected={sshAgent} onChange={setSshAgent} />
          </SettingsRow>
        </SettingsCard>
      ) : null}
      {creating ? <SettingsNote>{progress ? <span className="block truncate font-mono text-caption-1-regular">{progress}</span> : t('container.flow.firstPullHint')}</SettingsNote> : null}
      {error ? <SettingsNote tone="danger" role="alert"><span className="whitespace-pre-wrap">{error}</span></SettingsNote> : null}
    </Modal>
  );
}

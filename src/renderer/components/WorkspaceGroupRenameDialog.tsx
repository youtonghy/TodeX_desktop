import { useState } from 'react';
import { WORKSPACE_GROUP_FIELD_MAX } from '@todex/protocol/todex';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Modal } from '@/components/ui/modal';
import { useT } from '../i18n';

/** Names a workspace group. Electron has no window.prompt, so this is a modal. */
export function WorkspaceGroupRenameDialog({ initialName, onSubmit, onClose }: {
  initialName: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const submit = () => {
    if (name.trim()) onSubmit(name);
    onClose();
  };
  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('sidebar.renameGroup')}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="workspace-group-rename" disabled={!name.trim()}>{t('common.save')}</Button>
        </>
      )}
    >
      <form id="workspace-group-rename" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Input
          className="w-full"
          label={t('sidebar.groupNameLabel')}
          value={name}
          onChange={setName}
          autoFocus
          maxLength={WORKSPACE_GROUP_FIELD_MAX}
          onFocus={(event) => (event.target as HTMLInputElement).select()}
        />
      </form>
    </Modal>
  );
}

import { useState } from 'react';
import { Button, Input, Label, Modal, TextField } from '@heroui/react';
import { WORKSPACE_GROUP_FIELD_MAX } from '@todex/protocol/todex';
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
    <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-sm">
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>{t('sidebar.renameGroup')}</Modal.Heading></Modal.Header>
          <Modal.Body>
            <form id="workspace-group-rename" onSubmit={(event) => { event.preventDefault(); submit(); }}>
              <TextField className="w-full" value={name} onChange={setName} autoFocus>
                <Label>{t('sidebar.groupNameLabel')}</Label>
                <Input className="w-full" maxLength={WORKSPACE_GROUP_FIELD_MAX} onFocus={(event) => event.currentTarget.select()} />
              </TextField>
            </form>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
            <Button type="submit" form="workspace-group-rename" isDisabled={!name.trim()}>{t('common.save')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

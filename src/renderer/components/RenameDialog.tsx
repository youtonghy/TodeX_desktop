import { useId, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Modal } from '@/components/ui/modal';
import { useT } from '../i18n';

/** Names something (a workspace group, workspace or conversation). Electron
 * has no window.prompt, so renaming goes through this modal. */
export function RenameDialog({ title, label, initialName, maxLength, onSubmit, onClose }: {
  title: string;
  label: string;
  initialName: string;
  maxLength?: number;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const formId = useId();
  const [name, setName] = useState(initialName);
  const submit = () => {
    if (name.trim()) onSubmit(name);
    onClose();
  };
  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={title}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} disabled={!name.trim()}>{t('common.save')}</Button>
        </>
      )}
    >
      <form id={formId} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <Input
          className="w-full"
          label={label}
          value={name}
          onChange={setName}
          autoFocus
          maxLength={maxLength}
          onFocus={(event) => (event.target as HTMLInputElement).select()}
        />
      </form>
    </Modal>
  );
}

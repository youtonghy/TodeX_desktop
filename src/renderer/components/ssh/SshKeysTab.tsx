import { useRef, useState, type ReactNode } from 'react';
import { RiAddLine, RiFileCopyLine, RiFolderOpenLine, RiKey2Line, RiUpload2Line } from '@remixicon/react';
import { SSH_KEY_ALGORITHMS, isValidSshKeyName, type SshKeyAlgorithm, type SshKeysResponse } from '@todex/protocol/ssh';
import { Field } from '../Field';
import { useT } from '../../i18n';
import { errorMessage, type SshApi } from './sshShared';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import { Textarea } from '@/components/base/textarea/textarea';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAction } from '@/components/ui/icon-action';
import { Modal } from '@/components/ui/modal';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

type Props = {
  api: SshApi;
  keys: SshKeysResponse | null;
  onReload: () => void;
};

export function SshKeysTab({ api, keys, onReload }: Props) {
  const t = useT();
  const [dialog, setDialog] = useState<'import' | 'generate' | null>(null);

  const copyPublicKey = async (publicKey: string) => {
    try {
      await navigator.clipboard.writeText(publicKey);
      toast.success(t('ssh.keys.copied'));
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.keys.copyFailed')));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-body-semibold text-text-primary">{t('ssh.keys.title')}</h3>
          {keys ? (
            <p className="truncate text-caption-1-regular text-text-secondary">
              {keys.sshDirectory} · {keys.agentAvailable ? t('ssh.keys.agentAvailable') : t('ssh.keys.agentUnavailable')}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button size="small" variant="secondary" leadingIcon={RiUpload2Line} onClick={() => setDialog('import')}>{t('ssh.keys.import')}</Button>
          <Button size="small" leadingIcon={RiAddLine} onClick={() => setDialog('generate')}>{t('ssh.keys.generate')}</Button>
        </div>
      </div>
      {!keys?.keys.length ? (
        <EmptyState size="sm" icon={RiKey2Line} title={t('ssh.keys.emptyTitle')} description={t('ssh.keys.emptyHint')} />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {keys.keys.map((key) => (
            <Card key={key.name} className="min-w-0">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background-secondary-default text-foreground-icon-secondary">
                  <RiKey2Line className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-body-semibold text-text-primary">{key.name}</h4>
                    <Chip variant="caption" color="neutral">{key.algorithm}{key.bits ? ` · ${key.bits}` : ''}</Chip>
                    {key.encrypted ? <Chip variant="caption" color="blue">{t('ssh.keys.encrypted')}</Chip> : null}
                    {key.loadedInAgent ? <Chip variant="caption" color="lime">{t('ssh.keys.inAgent')}</Chip> : null}
                    {!key.privateKeyPath ? <Chip variant="caption" color="yellow">{t('ssh.keys.publicOnly')}</Chip> : null}
                  </div>
                  <p className="mt-1 truncate font-mono text-caption-1-regular text-text-secondary" title={key.fingerprint}>{key.fingerprint}</p>
                  {key.comment ? <p className="mt-0.5 truncate text-caption-1-regular text-text-tertiary">{key.comment}</p> : null}
                  <p className="mt-0.5 truncate text-caption-1-regular text-text-tertiary">
                    {key.usedBy.length ? t('ssh.keys.usedBy', { hosts: key.usedBy.join(', ') }) : t('ssh.keys.unused')}
                  </p>
                </div>
                {key.publicKey ? (
                  <IconAction
                    icon={RiFileCopyLine}
                    size="sm"
                    aria-label={t('ssh.keys.copyPublic', { name: key.name })}
                    tooltip
                    onClick={() => void copyPublicKey(key.publicKey ?? '')}
                  />
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
      {/* Mounted only while open so secrets never outlive the dialog. */}
      {dialog === 'import' ? <ImportKeyDialog api={api} onClose={() => setDialog(null)} onSaved={onReload} /> : null}
      {dialog === 'generate' ? <GenerateKeyDialog api={api} onClose={() => setDialog(null)} onSaved={onReload} /> : null}
    </div>
  );
}

function KeyDialogShell({ title, onClose, onSubmit, saving, children }: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  saving: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={title}
      size="lg"
      className="max-h-[90vh]"
      bodyClassName="flex flex-col gap-4"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={saving} leadingIcon={saving ? SpinnerIcon : undefined} aria-busy={saving || undefined} onClick={onSubmit}>
            {t('common.save')}
          </Button>
        </>
      )}
    >
      {children}
    </Modal>
  );
}

function ImportKeyDialog({ api, onClose, onSaved }: { api: SshApi; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pickFile = async (file: File) => {
    try {
      setPrivateKey(await file.text());
      if (!name.trim() && isValidSshKeyName(file.name)) setName(file.name);
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.files.readLocalFailed')));
    }
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (!isValidSshKeyName(trimmedName)) return toast.danger(t('ssh.keys.nameInvalid'));
    if (!privateKey.trim()) return toast.danger(t('ssh.keys.privateKeyRequired'));
    setSaving(true);
    try {
      const { key } = await api().importSshKey({ name: trimmedName, privateKey, ...(passphrase ? { passphrase } : {}) });
      // Drop the secret material as soon as the backend has it.
      setPrivateKey('');
      setPassphrase('');
      toast.success(t('ssh.keys.imported', { name: key.name }));
      onSaved();
      onClose();
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.keys.importFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyDialogShell title={t('ssh.keys.importTitle')} onClose={onClose} onSubmit={() => void submit()} saving={saving}>
      <Field label={t('ssh.keys.name')} value={name} onChange={setName} description={t('ssh.keys.nameHint')} />
      <Textarea
        label={t('ssh.keys.privateKey')}
        value={privateKey}
        onChange={setPrivateKey}
        rows={8}
        spellCheck="false"
        autoComplete="off"
        inputClassName="font-mono text-caption-1-regular"
        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
      />
      <div>
        <Button size="small" variant="secondary" leadingIcon={RiFolderOpenLine} onClick={() => fileInputRef.current?.click()}>{t('ssh.keys.pickFile')}</Button>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void pickFile(file);
          }}
        />
      </div>
      <Field label={t('ssh.keys.passphraseOptional')} type="password" value={passphrase} onChange={setPassphrase} description={t('ssh.keys.passphraseImportHint')} />
    </KeyDialogShell>
  );
}

function GenerateKeyDialog({ api, onClose, onSaved }: { api: SshApi; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [name, setName] = useState('id_ed25519');
  const [algorithm, setAlgorithm] = useState<SshKeyAlgorithm>('ed25519');
  const [comment, setComment] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    if (!isValidSshKeyName(trimmedName)) return toast.danger(t('ssh.keys.nameInvalid'));
    if (passphrase !== confirm) return toast.danger(t('ssh.keys.passphraseMismatch'));
    setSaving(true);
    try {
      const { key } = await api().generateSshKey({
        name: trimmedName,
        algorithm,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(passphrase ? { passphrase } : {}),
      });
      setPassphrase('');
      setConfirm('');
      toast.success(t('ssh.keys.generated', { name: key.name }));
      onSaved();
      onClose();
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.keys.generateFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyDialogShell title={t('ssh.keys.generateTitle')} onClose={onClose} onSubmit={() => void submit()} saving={saving}>
      <Field label={t('ssh.keys.name')} value={name} onChange={setName} description={t('ssh.keys.nameHint')} />
      <Select
        label={t('ssh.keys.algorithm')}
        className="w-full"
        popoverClassName="w-(--trigger-width)"
        selectedKey={algorithm}
        onSelectionChange={(key) => {
          const next = SSH_KEY_ALGORITHMS.find((item) => item === key);
          if (!next) return;
          setAlgorithm(next);
          // Follow the algorithm while the name is still a default one.
          if (/^id_(ed25519|rsa|ecdsa)$/.test(name)) setName(`id_${next}`);
        }}
      >
        <SelectItem id="ed25519" textValue="Ed25519">Ed25519 ({t('ssh.keys.recommended')})</SelectItem>
        <SelectItem id="rsa" textValue="RSA 4096">RSA 4096</SelectItem>
        <SelectItem id="ecdsa" textValue="ECDSA P-256">ECDSA P-256</SelectItem>
      </Select>
      <Field label={t('ssh.keys.comment')} value={comment} onChange={setComment} />
      <Field label={t('ssh.keys.passphraseOptional')} type="password" value={passphrase} onChange={setPassphrase} />
      <Field label={t('ssh.keys.passphraseConfirm')} type="password" value={confirm} onChange={setConfirm} />
      <Alert status="neutral" description={t('ssh.keys.passphraseNotStored')} />
    </KeyDialogShell>
  );
}

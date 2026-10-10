import { useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Card, Chip, Label, ListBox, Modal, Select, Spinner, TextArea, TextField, Tooltip, toast } from '@heroui/react';
import { EmptyState } from '@heroui-pro/react';
import { RiAddLine, RiFileCopyLine, RiFolderOpenLine, RiKey2Line, RiUpload2Line } from '@remixicon/react';
import { SSH_KEY_ALGORITHMS, isValidSshKeyName, type SshKeyAlgorithm, type SshKeysResponse } from '@todex/protocol/ssh';
import { Field } from '../Field';
import { useT } from '../../i18n';
import { errorMessage, type SshApi } from './sshShared';

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
          <h3 className="text-sm font-semibold">{t('ssh.keys.title')}</h3>
          {keys ? (
            <p className="text-muted truncate text-xs">
              {keys.sshDirectory} · {keys.agentAvailable ? t('ssh.keys.agentAvailable') : t('ssh.keys.agentUnavailable')}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onPress={() => setDialog('import')}><RiUpload2Line className="size-4" />{t('ssh.keys.import')}</Button>
          <Button size="sm" onPress={() => setDialog('generate')}><RiAddLine className="size-4" />{t('ssh.keys.generate')}</Button>
        </div>
      </div>
      {!keys?.keys.length ? (
        <EmptyState size="sm">
          <EmptyState.Header>
            <EmptyState.Media variant="icon"><RiKey2Line /></EmptyState.Media>
            <EmptyState.Title>{t('ssh.keys.emptyTitle')}</EmptyState.Title>
            <EmptyState.Description>{t('ssh.keys.emptyHint')}</EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {keys.keys.map((key) => (
            <Card key={key.name} className="min-w-0 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="bg-surface-secondary flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <RiKey2Line className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-sm font-semibold">{key.name}</h4>
                    <Chip size="sm" variant="soft">{key.algorithm}{key.bits ? ` · ${key.bits}` : ''}</Chip>
                    {key.encrypted ? <Chip size="sm" variant="soft" color="accent">{t('ssh.keys.encrypted')}</Chip> : null}
                    {key.loadedInAgent ? <Chip size="sm" variant="soft" color="success">{t('ssh.keys.inAgent')}</Chip> : null}
                    {!key.privateKeyPath ? <Chip size="sm" variant="soft" color="warning">{t('ssh.keys.publicOnly')}</Chip> : null}
                  </div>
                  <p className="text-muted mt-1 truncate font-mono text-xs" title={key.fingerprint}>{key.fingerprint}</p>
                  {key.comment ? <p className="text-muted mt-0.5 truncate text-xs">{key.comment}</p> : null}
                  <p className="text-muted mt-0.5 truncate text-xs">
                    {key.usedBy.length ? t('ssh.keys.usedBy', { hosts: key.usedBy.join(', ') }) : t('ssh.keys.unused')}
                  </p>
                </div>
                {key.publicKey ? (
                  <Tooltip delay={200}>
                    <Button isIconOnly size="sm" variant="ghost" aria-label={t('ssh.keys.copyPublic', { name: key.name })} onPress={() => void copyPublicKey(key.publicKey ?? '')}>
                      <RiFileCopyLine className="size-4" />
                    </Button>
                    <Tooltip.Content className="text-xs">{t('ssh.keys.copyPublic', { name: key.name })}</Tooltip.Content>
                  </Tooltip>
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
    <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Container>
        <Modal.Dialog className="max-h-[90vh] sm:max-w-lg">
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>{title}</Modal.Heading></Modal.Header>
          <Modal.Body className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">{children}</Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
            <Button isDisabled={saving} onPress={onSubmit}>{saving ? <Spinner size="sm" /> : null}{t('common.save')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
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
      <TextField className="w-full" value={privateKey} onChange={setPrivateKey}>
        <Label>{t('ssh.keys.privateKey')}</Label>
        <TextArea className="w-full font-mono text-xs" rows={8} spellCheck={false} autoComplete="off" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
      </TextField>
      <div>
        <Button size="sm" variant="tertiary" onPress={() => fileInputRef.current?.click()}><RiFolderOpenLine className="size-4" />{t('ssh.keys.pickFile')}</Button>
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
      <Select selectedKey={algorithm} onSelectionChange={(key) => {
        const next = SSH_KEY_ALGORITHMS.find((item) => item === key);
        if (!next) return;
        setAlgorithm(next);
        // Follow the algorithm while the name is still a default one.
        if (/^id_(ed25519|rsa|ecdsa)$/.test(name)) setName(`id_${next}`);
      }}>
        <Label>{t('ssh.keys.algorithm')}</Label>
        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="ed25519" textValue="Ed25519">Ed25519 ({t('ssh.keys.recommended')})<ListBox.ItemIndicator /></ListBox.Item>
            <ListBox.Item id="rsa" textValue="RSA 4096">RSA 4096<ListBox.ItemIndicator /></ListBox.Item>
            <ListBox.Item id="ecdsa" textValue="ECDSA P-256">ECDSA P-256<ListBox.ItemIndicator /></ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>
      <Field label={t('ssh.keys.comment')} value={comment} onChange={setComment} />
      <Field label={t('ssh.keys.passphraseOptional')} type="password" value={passphrase} onChange={setPassphrase} />
      <Field label={t('ssh.keys.passphraseConfirm')} type="password" value={confirm} onChange={setConfirm} />
      <Alert>
        <Alert.Indicator />
        <Alert.Content><Alert.Description>{t('ssh.keys.passphraseNotStored')}</Alert.Description></Alert.Content>
      </Alert>
    </KeyDialogShell>
  );
}

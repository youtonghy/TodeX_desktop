import { useState, type ReactNode } from 'react';
import { Alert, Button, Dropdown, Label, ListBox, Modal, Select, Spinner, TextArea, TextField, toast } from '@heroui/react';
import { RiKey2Line } from '@remixicon/react';
import type { FtpProtocol, FtpSite, FtpSiteInput, ManagedHost, SshHostImportResult, SshKey } from '@todex/protocol/ssh';
import { Field } from '../Field';
import { useT } from '../../i18n';
import { errorMessage, parsePort, type SshApi } from './sshShared';

function DialogShell({ title, onClose, footer, children, wide = false }: {
  title: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className={`max-h-[90vh] ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}>
            <Modal.CloseTrigger />
            <Modal.Header><Modal.Heading>{title}</Modal.Heading></Modal.Header>
            <Modal.Body className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">{children}</Modal.Body>
            <Modal.Footer>{footer}</Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/** Add or edit a TodeX-managed host (`$DATA_DIR/ssh/hosts.conf`). */
export function SshHostFormDialog({ api, host, keys, onClose, onSaved }: {
  api: SshApi;
  /** Editing when set; the alias is the route key and stays fixed. */
  host?: ManagedHost;
  keys: SshKey[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [alias, setAlias] = useState(host?.alias ?? '');
  const [hostName, setHostName] = useState(host?.hostName ?? '');
  const [port, setPort] = useState(host?.port ? String(host.port) : '');
  const [user, setUser] = useState(host?.user ?? '');
  const [identityFile, setIdentityFile] = useState(host?.identityFile ?? '');
  const [proxyJump, setProxyJump] = useState(host?.proxyJump ?? '');
  const [saving, setSaving] = useState(false);
  const privateKeys = keys.filter((key) => key.privateKeyPath);

  const submit = async () => {
    const trimmedAlias = alias.trim();
    const parsedPort = parsePort(port);
    if (!trimmedAlias || /\s/.test(trimmedAlias)) return toast.danger(t('ssh.hostForm.aliasInvalid'));
    if (!hostName.trim()) return toast.danger(t('ssh.hostForm.hostNameRequired'));
    if (parsedPort === null) return toast.danger(t('ssh.portInvalid'));
    const next: ManagedHost = {
      alias: trimmedAlias,
      hostName: hostName.trim(),
      ...(user.trim() ? { user: user.trim() } : {}),
      ...(parsedPort ? { port: parsedPort } : {}),
      ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}),
      ...(proxyJump.trim() ? { proxyJump: proxyJump.trim() } : {}),
      // Extra ssh_config options are not editable here; keep them intact.
      ...(host?.options?.length ? { options: host.options } : {}),
    };
    setSaving(true);
    try {
      if (host) await api().updateSshHost(host.alias, next);
      else await api().createSshHost(next);
      toast.success(t(host ? 'ssh.hostForm.updated' : 'ssh.hostForm.created', { alias: next.alias }));
      onSaved();
      onClose();
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.hostForm.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={host ? t('ssh.hostForm.editTitle', { alias: host.alias }) : t('ssh.hostForm.addTitle')}
      onClose={onClose}
      footer={(
        <>
          <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
          <Button isDisabled={saving} onPress={() => void submit()}>{saving ? <Spinner size="sm" /> : null}{t('common.save')}</Button>
        </>
      )}
    >
      {host ? null : <Field label={t('ssh.hostForm.alias')} value={alias} onChange={setAlias} description={t('ssh.hostForm.aliasHint')} />}
      <Field label={t('ssh.hostForm.hostName')} value={hostName} onChange={setHostName} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('ssh.hostForm.user')} value={user} onChange={setUser} />
        <Field label={t('ssh.hostForm.port')} value={port} onChange={setPort} description={t('ssh.hostForm.portHint')} />
      </div>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label={t('ssh.hostForm.identityFile')} value={identityFile} onChange={setIdentityFile} />
        </div>
        <Dropdown>
          <Dropdown.Trigger
            isDisabled={!privateKeys.length}
            aria-label={t('ssh.hostForm.pickKey')}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm text-muted hover:bg-surface-secondary hover:text-foreground cursor-pointer"
          >
            <RiKey2Line className="size-4" />{t('ssh.hostForm.pickKey')}
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu onAction={(key) => setIdentityFile(String(key))}>
              {privateKeys.map((key) => (
                <Dropdown.Item key={key.name} id={key.privateKeyPath ?? key.name} textValue={key.name}>
                  <Label>{key.name}</Label>
                  <span className="text-muted ml-auto text-xs">{key.algorithm}</span>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
      <Field label={t('ssh.hostForm.proxyJump')} value={proxyJump} onChange={setProxyJump} description={t('ssh.hostForm.proxyJumpHint')} />
    </DialogShell>
  );
}

/** Paste an ssh_config snippet; each `Host` block becomes a managed host. */
export function SshImportDialog({ api, onClose, onImported }: { api: SshApi; onClose: () => void; onImported: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [result, setResult] = useState<SshHostImportResult | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const next = await api().importSshHosts(text);
      setResult(next);
      if (next.hosts.length) onImported();
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.import.failed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      wide
      title={t('ssh.import.title')}
      onClose={onClose}
      footer={result ? (
        <Button onPress={onClose}>{t('ssh.done')}</Button>
      ) : (
        <>
          <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
          <Button isDisabled={saving || !text.trim()} onPress={() => void submit()}>{saving ? <Spinner size="sm" /> : null}{t('ssh.import.submit')}</Button>
        </>
      )}
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t('ssh.import.created', { count: result.hosts.length })}</p>
          {result.hosts.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {result.hosts.map((host) => <li key={host.alias} className="font-mono text-xs">{host.alias} → {host.user ? `${host.user}@` : ''}{host.hostName}{host.port ? `:${host.port}` : ''}</li>)}
            </ul>
          ) : null}
          {result.errors.length ? (
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{t('ssh.import.errors', { count: result.errors.length })}</Alert.Title>
                <Alert.Description>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
                    {result.errors.map((error, index) => <li key={index}>{error}</li>)}
                  </ul>
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
        </div>
      ) : (
        <TextField className="w-full" value={text} onChange={setText}>
          <Label>{t('ssh.import.label')}</Label>
          <TextArea className="w-full font-mono text-xs" rows={12} placeholder={'Host prod\n  HostName 203.0.113.10\n  User deploy\n  Port 2222'} />
          <p className="text-muted mt-1 text-xs">{t('ssh.import.hint')}</p>
        </TextField>
      )}
    </DialogShell>
  );
}

/** Add or edit an FTP/FTPS site. Passwords are never part of the site. */
export function FtpSiteFormDialog({ api, site, onClose, onSaved }: {
  api: SshApi;
  site?: FtpSite;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(site?.name ?? '');
  const [protocol, setProtocol] = useState<FtpProtocol>(site?.protocol ?? 'ftps');
  const [host, setHost] = useState(site?.host ?? '');
  const [port, setPort] = useState(site?.port ? String(site.port) : '');
  const [user, setUser] = useState(site?.user ?? '');
  const [initialDirectory, setInitialDirectory] = useState(site?.initialDirectory ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const parsedPort = parsePort(port);
    if (!name.trim() || !host.trim()) return toast.danger(t('ssh.ftpForm.required'));
    if (parsedPort === null) return toast.danger(t('ssh.portInvalid'));
    const input: FtpSiteInput = {
      name: name.trim(),
      protocol,
      host: host.trim(),
      ...(parsedPort ? { port: parsedPort } : {}),
      ...(user.trim() ? { user: user.trim() } : {}),
      ...(initialDirectory.trim() ? { initialDirectory: initialDirectory.trim() } : {}),
    };
    setSaving(true);
    try {
      if (site) await api().updateFtpSite(site.id, input);
      else await api().createFtpSite(input);
      onSaved();
      onClose();
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.ftpForm.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={site ? t('ssh.ftpForm.editTitle', { name: site.name }) : t('ssh.ftpForm.addTitle')}
      onClose={onClose}
      footer={(
        <>
          <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
          <Button isDisabled={saving} onPress={() => void submit()}>{saving ? <Spinner size="sm" /> : null}{t('common.save')}</Button>
        </>
      )}
    >
      <Field label={t('ssh.ftpForm.name')} value={name} onChange={setName} />
      <Select selectedKey={protocol} onSelectionChange={(key) => { if (key === 'ftp' || key === 'ftps') setProtocol(key); }}>
        <Label>{t('ssh.ftpForm.protocol')}</Label>
        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="ftps" textValue="FTPS">FTPS<ListBox.ItemIndicator /></ListBox.Item>
            <ListBox.Item id="ftp" textValue="FTP">FTP<ListBox.ItemIndicator /></ListBox.Item>
          </ListBox>
        </Select.Popover>
      </Select>
      {protocol === 'ftp' ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content><Alert.Description>{t('ssh.ftp.cleartextWarning')}</Alert.Description></Alert.Content>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label={t('ssh.ftpForm.host')} value={host} onChange={setHost} />
        <Field label={t('ssh.hostForm.port')} value={port} onChange={setPort} />
      </div>
      <Field label={t('ssh.hostForm.user')} value={user} onChange={setUser} description={t('ssh.ftpForm.userHint')} />
      <Field label={t('ssh.ftpForm.initialDirectory')} value={initialDirectory} onChange={setInitialDirectory} />
    </DialogShell>
  );
}

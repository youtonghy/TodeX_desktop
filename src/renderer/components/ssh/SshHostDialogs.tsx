import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { RiKey2Line } from '@remixicon/react';
import type { FtpProtocol, FtpSite, FtpSiteInput, ManagedHost, SshAuthMethod, SshHostImportResult, SshKey } from '@todex/protocol/ssh';
import { Field } from '../Field';
import { useT } from '../../i18n';
import { canRememberSshPasswords, loadSshPassword, saveSshPassword, sshPasswordsRememberable } from '../../lib/sshPasswordStore';
import { errorMessage, parsePort, type SshApi } from './sshShared';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Select, SelectItem } from '@/components/base/select/select';
import { Textarea } from '@/components/base/textarea/textarea';
import { Alert } from '@/components/ui/alert';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from '@/components/ui/menu';
import { Modal } from '@/components/ui/modal';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';

function SaveButton({ saving, disabled, onClick, children }: { saving: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button disabled={saving || disabled} leadingIcon={saving ? SpinnerIcon : undefined} aria-busy={saving || undefined} onClick={onClick}>
      {children}
    </Button>
  );
}

function DialogShell({ title, onClose, footer, children, wide = false }: {
  title: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={title}
      size={wide ? '2xl' : 'lg'}
      className="max-h-[90vh]"
      bodyClassName="flex flex-col gap-4"
      footer={footer}
    >
      {children}
    </Modal>
  );
}

/** Add or edit a TodeX-managed host (`$DATA_DIR/ssh/hosts.conf`). */
export function SshHostFormDialog({ api, backendId, host, keys, onClose, onSaved }: {
  api: SshApi;
  /** Backend profile the host belongs to; saved passwords are kept per profile. */
  backendId: string;
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
  const [authMethod, setAuthMethod] = useState<SshAuthMethod>(host?.authMethod ?? 'key');
  // Saved passwords live in this client's keychain, never in the host itself.
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [keychainReady, setKeychainReady] = useState(false);
  const [remember, setRemember] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const authLabelId = useId();
  const privateKeys = keys.filter((key) => key.privateKeyPath);

  useEffect(() => {
    if (!sshPasswordsRememberable) return;
    let cancelled = false;
    void canRememberSshPasswords().then((ready) => { if (!cancelled) setKeychainReady(ready); });
    if (host) {
      void loadSshPassword(backendId, host.alias).then((saved) => {
        if (cancelled || !saved) return;
        setHasSavedPassword(true);
        setRemember(true);
      });
    }
    return () => { cancelled = true; };
  }, [backendId, host]);

  /** Applies the password choices once the host itself is saved. */
  const savePassword = async (savedAlias: string) => {
    if (!sshPasswordsRememberable) return;
    const keep = authMethod === 'password' && remember;
    if (keep && password) await saveSshPassword(backendId, savedAlias, password);
    else if (!keep && hasSavedPassword) await saveSshPassword(backendId, savedAlias, null);
  };

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
      ...(authMethod === 'key' && identityFile.trim() ? { identityFile: identityFile.trim() } : {}),
      ...(proxyJump.trim() ? { proxyJump: proxyJump.trim() } : {}),
      ...(authMethod === 'password' ? { authMethod } : {}),
      // Extra ssh_config options are not editable here; keep them intact.
      ...(host?.options?.length ? { options: host.options } : {}),
    };
    setSaving(true);
    try {
      if (host) await api().updateSshHost(host.alias, next);
      else await api().createSshHost(next);
      toast.success(t(host ? 'ssh.hostForm.updated' : 'ssh.hostForm.created', { alias: next.alias }));
      await savePassword(next.alias).catch((error: unknown) => toast.danger(errorMessage(error, t('ssh.password.saveFailed'))));
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
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <SaveButton saving={saving} onClick={() => void submit()}>{t('common.save')}</SaveButton>
        </>
      )}
    >
      {host ? null : <Field label={t('ssh.hostForm.alias')} value={alias} onChange={setAlias} description={t('ssh.hostForm.aliasHint')} />}
      <Field label={t('ssh.hostForm.hostName')} value={hostName} onChange={setHostName} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('ssh.hostForm.user')} value={user} onChange={setUser} />
        <Field label={t('ssh.hostForm.port')} value={port} onChange={setPort} description={t('ssh.hostForm.portHint')} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span id={authLabelId} className="text-body-medium text-text-primary">{t('ssh.hostForm.authMethod')}</span>
        <SegmentedControl
          aria-labelledby={authLabelId}
          className="self-start"
          selectedKeys={[authMethod]}
          onSelectionChange={(keys) => {
            const [next] = [...keys] as SshAuthMethod[];
            if (next) setAuthMethod(next);
          }}
        >
          <SegmentedControlItem id="key">{t('ssh.hostForm.authKey')}</SegmentedControlItem>
          <SegmentedControlItem id="password">{t('ssh.hostForm.authPassword')}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      {authMethod === 'key' ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={t('ssh.hostForm.identityFile')} value={identityFile} onChange={setIdentityFile} />
          </div>
          <MenuTrigger>
            <AriaButton
              isDisabled={!privateKeys.length}
              aria-label={t('ssh.hostForm.pickKey')}
              className={cx(
                'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-2lg px-3 text-body-medium text-text-secondary',
                'transition-colors duration-150 ease hover:bg-background-secondary-hover hover:text-text-primary',
                'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent data-[disabled]:hover:text-text-secondary',
              )}
            >
              <RiKey2Line aria-hidden className="size-4 text-foreground-icon-secondary" />{t('ssh.hostForm.pickKey')}
            </AriaButton>
            <MenuPopover placement="bottom end">
              <Menu aria-label={t('ssh.hostForm.pickKey')} onAction={(key) => setIdentityFile(String(key))}>
                {privateKeys.map((key) => (
                  <MenuItem key={key.name} id={key.privateKeyPath ?? key.name} textValue={key.name} trailing={key.algorithm}>
                    {key.name}
                  </MenuItem>
                ))}
              </Menu>
            </MenuPopover>
          </MenuTrigger>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-caption-1-regular text-text-tertiary">{t('ssh.hostForm.authPasswordHint')}</p>
          {sshPasswordsRememberable ? (
            <>
              <div className="flex flex-col gap-1">
                <Checkbox isSelected={remember} isDisabled={!keychainReady} onChange={setRemember}>{t('ssh.password.remember')}</Checkbox>
                {!keychainReady ? <p className="text-caption-1-regular text-text-tertiary">{t('ssh.password.keychainUnavailable')}</p> : null}
              </div>
              {remember ? (
                <Field
                  label={t('ssh.remote.password')}
                  type="password"
                  value={password}
                  onChange={setPassword}
                  description={hasSavedPassword ? t('ssh.password.savedKeep') : t('ssh.password.rememberHint')}
                />
              ) : null}
            </>
          ) : null}
        </div>
      )}
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
        <Button onClick={onClose}>{t('ssh.done')}</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <SaveButton saving={saving} disabled={!text.trim()} onClick={() => void submit()}>{t('ssh.import.submit')}</SaveButton>
        </>
      )}
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <p className="text-body-regular text-text-primary">{t('ssh.import.created', { count: result.hosts.length })}</p>
          {result.hosts.length ? (
            <ul className="flex flex-col gap-1 text-text-primary">
              {result.hosts.map((host) => <li key={host.alias} className="font-mono text-caption-1-regular">{host.alias} → {host.user ? `${host.user}@` : ''}{host.hostName}{host.port ? `:${host.port}` : ''}</li>)}
            </ul>
          ) : null}
          {result.errors.length ? (
            <Alert
              status="warning"
              title={t('ssh.import.errors', { count: result.errors.length })}
              description={(
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-caption-1-regular">
                  {result.errors.map((error, index) => <li key={index}>{error}</li>)}
                </ul>
              )}
            />
          ) : null}
        </div>
      ) : (
        <Textarea
          label={t('ssh.import.label')}
          hint={t('ssh.import.hint')}
          value={text}
          onChange={setText}
          rows={12}
          inputClassName="font-mono text-caption-1-regular"
          placeholder={'Host prod\n  HostName 203.0.113.10\n  User deploy\n  Port 2222'}
        />
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
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <SaveButton saving={saving} onClick={() => void submit()}>{t('common.save')}</SaveButton>
        </>
      )}
    >
      <Field label={t('ssh.ftpForm.name')} value={name} onChange={setName} />
      <Select
        label={t('ssh.ftpForm.protocol')}
        className="w-full"
        popoverClassName="w-(--trigger-width)"
        selectedKey={protocol}
        onSelectionChange={(key) => { if (key === 'ftp' || key === 'ftps') setProtocol(key); }}
      >
        <SelectItem id="ftps" textValue="FTPS">FTPS</SelectItem>
        <SelectItem id="ftp" textValue="FTP">FTP</SelectItem>
      </Select>
      {protocol === 'ftp' ? (
        <Alert status="warning" description={t('ssh.ftp.cleartextWarning')} />
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

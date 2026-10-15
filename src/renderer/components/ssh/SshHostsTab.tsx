import { useState } from 'react';
import { Button as AriaButton, Focusable } from 'react-aria-components';
import {
  RiAddLine, RiDeleteBinLine, RiEdit2Line, RiFileCopyLine, RiFolder3Line, RiLinkUnlink, RiMore2Line,
  RiPlugLine, RiPulseLine, RiServerLine, RiTerminalBoxLine,
} from '@remixicon/react';
import { sshHostEndpoint, type FtpSite, type SshHost, type SshKey, type SshTestResult } from '@todex/protocol/ssh';
import { useT } from '../../i18n';
import { FtpSiteFormDialog, SshHostFormDialog, SshImportDialog } from './SshHostDialogs';
import type { EnteredPassword, RemoteConnectTarget } from './useRemoteConnector';
import { loadSshPassword, saveSshPassword } from '../../lib/sshPasswordStore';
import { SSH_FAILURE_HINT_KEYS, SSH_FAILURE_LABEL_KEYS, errorMessage, type SshApi } from './sshShared';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Switch } from '@/components/base/switch/switch';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from '@/components/ui/menu';
import { ConfirmDialog } from '@/components/ui/modal';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';

/** Rounded tile holding a card's leading glyph. */
const ICON_TILE = 'flex size-9 shrink-0 items-center justify-center rounded-xl bg-background-secondary-default text-foreground-icon-secondary';

type Props = {
  api: SshApi;
  /** Backend profile the hosts belong to; saved passwords are kept per profile. */
  backendId: string;
  askPassword: (label: string, sshHost?: boolean) => Promise<EnteredPassword | null>;
  rememberPassword: (alias: string, entered: EnteredPassword) => Promise<void>;
  hosts: SshHost[];
  ftpSites: FtpSite[];
  keys: SshKey[];
  onReload: () => void;
  onConnect: (host: string) => void;
  onOpenFiles: (target: RemoteConnectTarget) => void;
};

type PendingDelete = { kind: 'host'; alias: string } | { kind: 'ftp'; site: FtpSite };

export function SshHostsTab({ api, backendId, askPassword, rememberPassword, hosts, ftpSites, keys, onReload, onConnect, onOpenFiles }: Props) {
  const t = useT();
  const [hostDialog, setHostDialog] = useState<{ host?: SshHost } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [ftpDialog, setFtpDialog] = useState<{ site?: FtpSite } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, SshTestResult>>({});
  const [accessPending, setAccessPending] = useState<Record<string, boolean>>({});

  /** Password hosts test with the saved password, else one entered now;
   * `promptPassword` always asks (to retry or replace a wrong one). */
  const testHost = async (host: SshHost, promptPassword = false) => {
    const { alias } = host;
    let entered: EnteredPassword | null = null;
    let password: string | undefined;
    if (promptPassword || host.managed?.authMethod === 'password') {
      if (!promptPassword) password = (await loadSshPassword(backendId, alias)) ?? undefined;
      if (!password) {
        entered = await askPassword(alias, true);
        if (!entered) return;
        password = entered.password;
      }
    }
    setTesting((current) => ({ ...current, [alias]: true }));
    try {
      const result = await api().testSshHost(alias, password);
      setTestResults((current) => ({ ...current, [alias]: result }));
      if (result.ok && entered) await rememberPassword(alias, entered);
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.hosts.testFailed')));
    } finally {
      setTesting((current) => ({ ...current, [alias]: false }));
    }
  };

  const setAgentAccess = async (alias: string, enabled: boolean) => {
    setAccessPending((current) => ({ ...current, [alias]: true }));
    try {
      await api().setSshHostAgentAccess(alias, enabled);
      onReload();
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.hosts.agentAccessFailed')));
    } finally {
      setAccessPending((current) => ({ ...current, [alias]: false }));
    }
  };

  const disconnect = async (alias: string) => {
    try {
      const result = await api().disconnectSshHost(alias);
      toast.success(t(result.disconnected ? 'ssh.hosts.disconnected' : 'ssh.hosts.notConnected', { alias }));
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.hosts.disconnectFailed')));
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      if (target.kind === 'host') {
        await api().deleteSshHost(target.alias);
        await saveSshPassword(backendId, target.alias, null).catch(() => undefined);
      } else await api().deleteFtpSite(target.site.id);
      onReload();
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.deleteFailed')));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-body-semibold text-text-primary">{t('ssh.hosts.title')}</h3>
          <div className="flex gap-2">
            <Button size="small" variant="secondary" leadingIcon={RiFileCopyLine} onClick={() => setImportOpen(true)}>{t('ssh.hosts.import')}</Button>
            <Button size="small" leadingIcon={RiAddLine} onClick={() => setHostDialog({})}>{t('ssh.hosts.add')}</Button>
          </div>
        </div>
        {hosts.length === 0 ? (
          <EmptyState size="sm" icon={RiServerLine} title={t('ssh.hosts.emptyTitle')} description={t('ssh.hosts.emptyHint')} />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {hosts.map((host) => {
              const result = testResults[host.alias];
              const managed = host.source === 'managed';
              const passwordAuth = host.managed?.authMethod === 'password';
              return (
                <Card key={host.alias} className="min-w-0">
                  <div className="flex items-start gap-3">
                    <div className={ICON_TILE}>
                      <RiServerLine className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-body-semibold text-text-primary">{host.alias}</h4>
                        <TooltipTrigger delay={200}>
                          <Focusable>
                            <span role="button" tabIndex={0} className="cursor-default rounded-md outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                              <Chip variant="caption" color={managed ? 'blue' : 'neutral'}>{managed ? t('ssh.hosts.sourceManaged') : '~/.ssh/config'}</Chip>
                            </span>
                          </Focusable>
                          <Tooltip className="max-w-sm break-all">
                            {managed ? t('ssh.hosts.sourceManagedHint') : t('ssh.hosts.sourceConfigHint', { path: host.sourcePath || '~/.ssh/config' })}
                          </Tooltip>
                        </TooltipTrigger>
                        {passwordAuth ? <Chip variant="caption" color="neutral">{t('ssh.hosts.passwordAuth')}</Chip> : null}
                      </div>
                      <p className="mt-1 truncate font-mono text-caption-1-regular text-text-secondary" title={sshHostEndpoint(host)}>{sshHostEndpoint(host)}</p>
                      {host.resolved?.proxyJump ? <p className="mt-0.5 truncate text-caption-1-regular text-text-tertiary">{t('ssh.hosts.via', { jump: host.resolved.proxyJump })}</p> : null}
                      {host.resolveError ? <p className="mt-1 break-words text-caption-1-regular text-text-error-primary">{host.resolveError}</p> : null}
                    </div>
                    <MenuTrigger>
                      <AriaButton
                        aria-label={t('ssh.hosts.more', { alias: host.alias })}
                        className={cx(
                          'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary',
                          'transition-colors duration-150 ease hover:bg-background-secondary-hover hover:text-foreground-icon-primary',
                          'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                        )}
                      >
                        <RiMore2Line aria-hidden className="size-4" />
                      </AriaButton>
                      <MenuPopover placement="bottom end">
                        <Menu aria-label={t('ssh.hosts.more', { alias: host.alias })} onAction={(key) => {
                          if (key === 'edit') setHostDialog({ host });
                          if (key === 'delete') setPendingDelete({ kind: 'host', alias: host.alias });
                          if (key === 'disconnect') void disconnect(host.alias);
                        }}>
                          <MenuItem id="disconnect" icon={RiLinkUnlink} textValue={t('ssh.hosts.disconnect')}>{t('ssh.hosts.disconnect')}</MenuItem>
                          {managed ? <MenuItem id="edit" icon={RiEdit2Line} textValue={t('ssh.edit')}>{t('ssh.edit')}</MenuItem> : null}
                          {managed ? <MenuItem id="delete" icon={RiDeleteBinLine} tone="danger" textValue={t('common.delete')}>{t('common.delete')}</MenuItem> : null}
                        </Menu>
                      </MenuPopover>
                    </MenuTrigger>
                  </div>
                  {result ? (
                    <Alert
                      status={result.ok ? 'success' : 'danger'}
                      title={result.ok
                        ? t('ssh.hosts.testOk', { ms: result.durationMs })
                        : t(SSH_FAILURE_LABEL_KEYS[result.failure ?? 'other'])}
                      description={!result.ok ? (
                        <>
                          {passwordAuth && result.failure === 'authenticationFailed'
                            ? t('ssh.hint.passwordFailed')
                            : t(SSH_FAILURE_HINT_KEYS[result.failure ?? 'other'])}
                          {result.detail ? <span className="mt-1 block break-words font-mono text-caption-1-regular opacity-80">{result.detail}</span> : null}
                        </>
                      ) : undefined}
                      actions={!result.ok && result.failure === 'authenticationFailed' ? (
                        <Button size="small" variant="secondary" disabled={testing[host.alias]} onClick={() => void testHost(host, true)}>
                          {t('ssh.hosts.testWithPassword')}
                        </Button>
                      ) : undefined}
                    />
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="small" leadingIcon={RiTerminalBoxLine} onClick={() => onConnect(host.alias)}>{t('ssh.hosts.connect')}</Button>
                    <Button size="small" variant="secondary" leadingIcon={RiFolder3Line} onClick={() => onOpenFiles({ kind: 'sftp', host: host.alias, label: host.alias })}>{t('ssh.hosts.files')}</Button>
                    <Button
                      size="small"
                      variant="secondary"
                      leadingIcon={testing[host.alias] ? SpinnerIcon : RiPulseLine}
                      disabled={testing[host.alias]}
                      aria-busy={testing[host.alias] || undefined}
                      onClick={() => void testHost(host)}
                    >
                      {t('ssh.hosts.test')}
                    </Button>
                    <TooltipTrigger delay={200}>
                      <Focusable>
                        <span role="button" tabIndex={-1} className="ms-auto outline-none">
                          <Switch
                            size="sm"
                            isSelected={host.agentAccess}
                            isDisabled={accessPending[host.alias]}
                            onChange={(enabled) => void setAgentAccess(host.alias, enabled)}
                          >
                            {t('ssh.hosts.agentAccess')}
                          </Switch>
                        </span>
                      </Focusable>
                      <Tooltip className="max-w-xs">{t('ssh.hosts.agentAccessHint')}</Tooltip>
                    </TooltipTrigger>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-body-semibold text-text-primary">{t('ssh.ftp.title')}</h3>
          <Button size="small" variant="secondary" leadingIcon={RiAddLine} onClick={() => setFtpDialog({})}>{t('ssh.ftp.add')}</Button>
        </div>
        {ftpSites.length === 0 ? (
          <p className="text-caption-1-regular text-text-tertiary">{t('ssh.ftp.empty')}</p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {ftpSites.map((site) => (
              <Card key={site.id} className="min-w-0">
                <div className="flex items-start gap-3">
                  <div className={ICON_TILE}>
                    <RiPlugLine className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-body-semibold text-text-primary">{site.name}</h4>
                      <Chip variant="caption" color={site.protocol === 'ftp' ? 'yellow' : 'lime'}>{site.protocol.toUpperCase()}</Chip>
                    </div>
                    <p className="mt-1 truncate font-mono text-caption-1-regular text-text-secondary">{site.user ? `${site.user}@` : ''}{site.host}:{site.port}{site.initialDirectory ? ` ${site.initialDirectory}` : ''}</p>
                    {site.protocol === 'ftp' ? <p className="mt-1 text-caption-1-regular text-status-yellow-text">{t('ssh.ftp.cleartextWarning')}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="small" variant="secondary" leadingIcon={RiFolder3Line} onClick={() => onOpenFiles({ kind: 'ftp', siteId: site.id, label: site.name, askPassword: Boolean(site.user) })}>
                    {t('ssh.hosts.files')}
                  </Button>
                  <Button size="small" variant="secondary" leadingIcon={RiEdit2Line} onClick={() => setFtpDialog({ site })}>{t('ssh.edit')}</Button>
                  <Button size="small" variant="danger" leadingIcon={RiDeleteBinLine} onClick={() => setPendingDelete({ kind: 'ftp', site })}>{t('common.delete')}</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {hostDialog ? (
        <SshHostFormDialog api={api} backendId={backendId} host={hostDialog.host?.managed} keys={keys} onClose={() => setHostDialog(null)} onSaved={onReload} />
      ) : null}
      {importOpen ? <SshImportDialog api={api} onClose={() => setImportOpen(false)} onImported={onReload} /> : null}
      {ftpDialog ? <FtpSiteFormDialog api={api} site={ftpDialog.site} onClose={() => setFtpDialog(null)} onSaved={onReload} /> : null}
      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={t('ssh.deleteTitle')}
        description={pendingDelete?.kind === 'host'
          ? t('ssh.hosts.deleteBody', { alias: pendingDelete.alias })
          : pendingDelete ? t('ssh.ftp.deleteBody', { name: pendingDelete.site.name }) : null}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        tone="danger"
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

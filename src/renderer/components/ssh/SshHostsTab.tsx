import { useState } from 'react';
import { Alert, AlertDialog, Button, Card, Chip, Dropdown, Label, Spinner, Switch, Tooltip, toast } from '@heroui/react';
import { EmptyState } from '@heroui-pro/react';
import {
  RiAddLine, RiDeleteBinLine, RiEdit2Line, RiFileCopyLine, RiFolder3Line, RiLinkUnlink, RiMore2Line,
  RiPlugLine, RiPulseLine, RiServerLine, RiTerminalBoxLine,
} from '@remixicon/react';
import { sshHostEndpoint, type FtpSite, type SshHost, type SshKey, type SshTestResult } from '@todex/protocol/ssh';
import { useT } from '../../i18n';
import { FtpSiteFormDialog, SshHostFormDialog, SshImportDialog } from './SshHostDialogs';
import type { RemoteConnectTarget } from './useRemoteConnector';
import { SSH_FAILURE_HINT_KEYS, SSH_FAILURE_LABEL_KEYS, errorMessage, type SshApi } from './sshShared';

type Props = {
  api: SshApi;
  hosts: SshHost[];
  ftpSites: FtpSite[];
  keys: SshKey[];
  onReload: () => void;
  onConnect: (host: string) => void;
  onOpenFiles: (target: RemoteConnectTarget) => void;
};

type PendingDelete = { kind: 'host'; alias: string } | { kind: 'ftp'; site: FtpSite };

export function SshHostsTab({ api, hosts, ftpSites, keys, onReload, onConnect, onOpenFiles }: Props) {
  const t = useT();
  const [hostDialog, setHostDialog] = useState<{ host?: SshHost } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [ftpDialog, setFtpDialog] = useState<{ site?: FtpSite } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, SshTestResult>>({});
  const [accessPending, setAccessPending] = useState<Record<string, boolean>>({});

  const testHost = async (alias: string) => {
    setTesting((current) => ({ ...current, [alias]: true }));
    try {
      const result = await api().testSshHost(alias);
      setTestResults((current) => ({ ...current, [alias]: result }));
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
      if (target.kind === 'host') await api().deleteSshHost(target.alias);
      else await api().deleteFtpSite(target.site.id);
      onReload();
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.deleteFailed')));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('ssh.hosts.title')}</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onPress={() => setImportOpen(true)}><RiFileCopyLine className="size-4" />{t('ssh.hosts.import')}</Button>
            <Button size="sm" onPress={() => setHostDialog({})}><RiAddLine className="size-4" />{t('ssh.hosts.add')}</Button>
          </div>
        </div>
        {hosts.length === 0 ? (
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Media variant="icon"><RiServerLine /></EmptyState.Media>
              <EmptyState.Title>{t('ssh.hosts.emptyTitle')}</EmptyState.Title>
              <EmptyState.Description>{t('ssh.hosts.emptyHint')}</EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {hosts.map((host) => {
              const result = testResults[host.alias];
              const managed = host.source === 'managed';
              return (
                <Card key={host.alias} className="min-w-0 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-surface-secondary flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <RiServerLine className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate text-sm font-semibold">{host.alias}</h4>
                        <Tooltip delay={200}>
                          <Tooltip.Trigger className="cursor-default outline-none">
                            <Chip size="sm" variant="soft" color={managed ? 'accent' : 'default'}>{managed ? t('ssh.hosts.sourceManaged') : '~/.ssh/config'}</Chip>
                          </Tooltip.Trigger>
                          <Tooltip.Content className="max-w-sm break-all text-xs">
                            {managed ? t('ssh.hosts.sourceManagedHint') : t('ssh.hosts.sourceConfigHint', { path: host.sourcePath || '~/.ssh/config' })}
                          </Tooltip.Content>
                        </Tooltip>
                      </div>
                      <p className="text-muted mt-1 truncate font-mono text-xs" title={sshHostEndpoint(host)}>{sshHostEndpoint(host)}</p>
                      {host.resolved?.proxyJump ? <p className="text-muted mt-0.5 truncate text-xs">{t('ssh.hosts.via', { jump: host.resolved.proxyJump })}</p> : null}
                      {host.resolveError ? <p className="text-danger mt-1 break-words text-xs">{host.resolveError}</p> : null}
                    </div>
                    <Dropdown>
                      <Dropdown.Trigger aria-label={t('ssh.hosts.more', { alias: host.alias })} className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-secondary hover:text-foreground cursor-pointer">
                        <RiMore2Line className="size-4" />
                      </Dropdown.Trigger>
                      <Dropdown.Popover>
                        <Dropdown.Menu onAction={(key) => {
                          if (key === 'edit') setHostDialog({ host });
                          if (key === 'delete') setPendingDelete({ kind: 'host', alias: host.alias });
                          if (key === 'disconnect') void disconnect(host.alias);
                        }}>
                          <Dropdown.Item id="disconnect" textValue={t('ssh.hosts.disconnect')}><RiLinkUnlink className="text-muted size-4" /><Label>{t('ssh.hosts.disconnect')}</Label></Dropdown.Item>
                          {managed ? <Dropdown.Item id="edit" textValue={t('ssh.edit')}><RiEdit2Line className="text-muted size-4" /><Label>{t('ssh.edit')}</Label></Dropdown.Item> : null}
                          {managed ? <Dropdown.Item id="delete" textValue={t('common.delete')} variant="danger"><RiDeleteBinLine className="size-4" /><Label>{t('common.delete')}</Label></Dropdown.Item> : null}
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown>
                  </div>
                  {result ? (
                    <Alert status={result.ok ? 'success' : 'danger'} className="mt-3">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>
                          {result.ok
                            ? t('ssh.hosts.testOk', { ms: result.durationMs })
                            : t(SSH_FAILURE_LABEL_KEYS[result.failure ?? 'other'])}
                        </Alert.Title>
                        {!result.ok ? (
                          <Alert.Description>
                            {t(SSH_FAILURE_HINT_KEYS[result.failure ?? 'other'])}
                            {result.detail ? <span className="mt-1 block break-words font-mono text-xs opacity-80">{result.detail}</span> : null}
                          </Alert.Description>
                        ) : null}
                      </Alert.Content>
                    </Alert>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" onPress={() => onConnect(host.alias)}><RiTerminalBoxLine className="size-4" />{t('ssh.hosts.connect')}</Button>
                    <Button size="sm" variant="secondary" onPress={() => onOpenFiles({ kind: 'sftp', host: host.alias, label: host.alias })}><RiFolder3Line className="size-4" />{t('ssh.hosts.files')}</Button>
                    <Button size="sm" variant="tertiary" isDisabled={testing[host.alias]} onPress={() => void testHost(host.alias)}>
                      {testing[host.alias] ? <Spinner size="sm" /> : <RiPulseLine className="size-4" />}{t('ssh.hosts.test')}
                    </Button>
                    <Tooltip delay={200}>
                      <Tooltip.Trigger className="ml-auto outline-none">
                        <Switch
                          size="sm"
                          isSelected={host.agentAccess}
                          isDisabled={accessPending[host.alias]}
                          onChange={(enabled) => void setAgentAccess(host.alias, enabled)}
                        >
                          <Switch.Content>
                            <Switch.Control><Switch.Thumb /></Switch.Control>
                            <span className="text-xs">{t('ssh.hosts.agentAccess')}</span>
                          </Switch.Content>
                        </Switch>
                      </Tooltip.Trigger>
                      <Tooltip.Content className="max-w-xs text-xs">{t('ssh.hosts.agentAccessHint')}</Tooltip.Content>
                    </Tooltip>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('ssh.ftp.title')}</h3>
          <Button size="sm" variant="secondary" onPress={() => setFtpDialog({})}><RiAddLine className="size-4" />{t('ssh.ftp.add')}</Button>
        </div>
        {ftpSites.length === 0 ? (
          <p className="text-muted text-xs">{t('ssh.ftp.empty')}</p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {ftpSites.map((site) => (
              <Card key={site.id} className="min-w-0 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="bg-surface-secondary flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <RiPlugLine className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-semibold">{site.name}</h4>
                      <Chip size="sm" variant="soft" color={site.protocol === 'ftp' ? 'warning' : 'success'}>{site.protocol.toUpperCase()}</Chip>
                    </div>
                    <p className="text-muted mt-1 truncate font-mono text-xs">{site.user ? `${site.user}@` : ''}{site.host}:{site.port}{site.initialDirectory ? ` ${site.initialDirectory}` : ''}</p>
                    {site.protocol === 'ftp' ? <p className="text-warning mt-1 text-xs">{t('ssh.ftp.cleartextWarning')}</p> : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onPress={() => onOpenFiles({ kind: 'ftp', siteId: site.id, label: site.name, askPassword: Boolean(site.user) })}>
                    <RiFolder3Line className="size-4" />{t('ssh.hosts.files')}
                  </Button>
                  <Button size="sm" variant="tertiary" onPress={() => setFtpDialog({ site })}><RiEdit2Line className="size-4" />{t('ssh.edit')}</Button>
                  <Button size="sm" variant="danger-soft" onPress={() => setPendingDelete({ kind: 'ftp', site })}><RiDeleteBinLine className="size-4" />{t('common.delete')}</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {hostDialog ? (
        <SshHostFormDialog api={api} host={hostDialog.host?.managed} keys={keys} onClose={() => setHostDialog(null)} onSaved={onReload} />
      ) : null}
      {importOpen ? <SshImportDialog api={api} onClose={() => setImportOpen(false)} onImported={onReload} /> : null}
      {ftpDialog ? <FtpSiteFormDialog api={api} site={ftpDialog.site} onClose={() => setFtpDialog(null)} onSaved={onReload} /> : null}
      <AlertDialog isOpen={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-md">
              <AlertDialog.Header>
                <AlertDialog.Heading>{t('ssh.deleteTitle')}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-muted text-sm">
                  {pendingDelete?.kind === 'host'
                    ? t('ssh.hosts.deleteBody', { alias: pendingDelete.alias })
                    : pendingDelete ? t('ssh.ftp.deleteBody', { name: pendingDelete.site.name }) : null}
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
                <Button variant="danger" onPress={() => void confirmDelete()}>{t('common.delete')}</Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}

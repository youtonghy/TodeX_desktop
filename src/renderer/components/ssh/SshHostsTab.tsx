import { useRef, useState, type ComponentType, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { Focusable, Pressable, type Key } from 'react-aria-components';
import {
  RiAddLine, RiArrowLeftRightLine, RiComputerLine, RiDeleteBinLine, RiEdit2Line, RiFileCopyLine, RiFolder3Line, RiLinkUnlink, RiMore2Line,
  RiErrorWarningLine, RiFileTextLine, RiInformationLine, RiLockPasswordLine, RiPlugLine, RiPulseLine, RiRobot2Line, RiRouteLine, RiRouterLine, RiServerLine, RiTerminalBoxLine,
} from '@remixicon/react';
import { LOCAL_TERMINAL_HOST, isLocalTerminalHost, type FtpSite, type SshHost, type SshKey, type SshTestResult } from '@todex/protocol/ssh';
import { useT } from '../../i18n';
import { FtpSiteFormDialog, SshHostFormDialog, SshImportDialog } from './SshHostDialogs';
import type { EnteredPassword, RemoteConnectTarget } from './useRemoteConnector';
import { loadSshPassword, saveSshPassword } from '../../lib/sshPasswordStore';
import { SSH_FAILURE_HINT_KEYS, SSH_FAILURE_LABEL_KEYS, errorMessage, type SshApi } from './sshShared';
import { Button } from '@/components/base/buttons/button';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAction } from '@/components/ui/icon-action';
import { ContextMenu, Menu, MenuItem, MenuPopover, MenuSection, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { ConfirmDialog } from '@/components/ui/modal';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';

/** Rounded tile holding a card's leading glyph. */
const ICON_TILE = 'flex size-12 shrink-0 items-center justify-center rounded-xl bg-background-secondary-default text-foreground-icon-secondary';

type Props = {
  api: SshApi;
  /** Backend profile the hosts belong to; saved passwords are kept per profile. */
  backendId: string;
  askPassword: (label: string, sshHost?: boolean) => Promise<EnteredPassword | null>;
  rememberPassword: (alias: string, entered: EnteredPassword) => Promise<void>;
  hosts: SshHost[];
  ftpSites: FtpSite[];
  keys: SshKey[];
  /** The backend offers the `Local` terminal (its own login shell). */
  localTerminal: boolean;
  onReload: () => void;
  onConnect: (host: string) => void;
  onOpenFiles: (target: RemoteConnectTarget) => void;
  /** Opens the new port forward dialog for the host (Port forwarding tab). */
  onNewForward: (alias: string) => void;
  /** Opens the loopback IP assignment dialog for the host. */
  onAssignIp: (alias: string) => void;
};

type PendingDelete = { kind: 'host'; alias: string } | { kind: 'ftp'; site: FtpSite };

export function SshHostsTab({ api, backendId, askPassword, rememberPassword, hosts, ftpSites, keys, localTerminal, onReload, onConnect, onOpenFiles, onNewForward, onAssignIp }: Props) {
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
          <div className="flex min-w-0 flex-col">
            <h3 className="text-body-semibold text-text-primary">{t('ssh.hosts.title')}</h3>
            <p className="text-caption-1-regular text-text-tertiary">{t('ssh.hosts.listHint')}</p>
          </div>
          <div className="flex gap-2">
            <Button size="small" variant="secondary" leadingIcon={RiFileCopyLine} onClick={() => setImportOpen(true)}>{t('ssh.hosts.import')}</Button>
            <Button size="small" leadingIcon={RiAddLine} onClick={() => setHostDialog({})}>{t('ssh.hosts.add')}</Button>
          </div>
        </div>
        {localTerminal || hosts.length > 0 ? (
          <HostGrid>
            {localTerminal ? (
              <HostRow
                name={LOCAL_TERMINAL_HOST}
                icon={RiComputerLine}
                moreLabel={t('ssh.hosts.more', { alias: LOCAL_TERMINAL_HOST })}
                onActivate={() => onConnect(LOCAL_TERMINAL_HOST)}
                subtitle={hostSubtitle('ssh', t('ssh.hosts.localChip'))}
                badges={<HintIcon icon={RiInformationLine} hint={t('ssh.hosts.localHint')} />}
                menu={(
                  <Menu aria-label={t('ssh.hosts.more', { alias: LOCAL_TERMINAL_HOST })} onAction={() => onConnect(LOCAL_TERMINAL_HOST)}>
                    <MenuItem id="connect" icon={RiTerminalBoxLine} textValue={t('ssh.hosts.connect')}>{t('ssh.hosts.connect')}</MenuItem>
                  </Menu>
                )}
              />
            ) : null}
            {hosts.map((host) => {
              const result = testResults[host.alias];
              const managed = host.source === 'managed';
              const passwordAuth = host.managed?.authMethod === 'password';
              // The backend opens the Local terminal for this alias instead.
              const shadowed = localTerminal && isLocalTerminalHost(host.alias);
              const runAction = (key: Key) => {
                if (key === 'connect') onConnect(host.alias);
                if (key === 'files') onOpenFiles({ kind: 'sftp', host: host.alias, label: host.alias });
                if (key === 'test') void testHost(host);
                if (key === 'edit') setHostDialog({ host });
                if (key === 'delete') setPendingDelete({ kind: 'host', alias: host.alias });
                if (key === 'disconnect') void disconnect(host.alias);
                if (key === 'forward') onNewForward(host.alias);
                if (key === 'assignIp') onAssignIp(host.alias);
              };
              return (
                <HostRow
                  key={host.alias}
                  name={host.alias}
                  icon={RiServerLine}
                  busy={testing[host.alias]}
                  busyLabel={t('ssh.hosts.test')}
                  moreLabel={t('ssh.hosts.more', { alias: host.alias })}
                  editLabel={managed ? t('ssh.hosts.editHost', { alias: host.alias }) : undefined}
                  onEdit={managed ? () => setHostDialog({ host }) : undefined}
                  onActivate={() => onConnect(host.alias)}
                  // Name and login user only: addresses stay out of the list.
                  subtitle={hostSubtitle('ssh', host.resolved?.user ?? host.managed?.user)}
                  badges={(
                    <>
                      {managed ? null : <HintIcon icon={RiFileTextLine} hint={t('ssh.hosts.sourceConfigHint', { path: host.sourcePath || '~/.ssh/config' })} />}
                      {passwordAuth ? <HintIcon icon={RiLockPasswordLine} hint={t('ssh.hosts.passwordAuth')} /> : null}
                      {host.resolved?.proxyJump ? <HintIcon icon={RiRouteLine} hint={t('ssh.hosts.via', { jump: host.resolved.proxyJump })} /> : null}
                      {host.agentAccess ? <HintIcon icon={RiRobot2Line} tone="accent" label={t('ssh.hosts.agentAccess')} hint={t('ssh.hosts.agentAccessHint')} /> : null}
                      {host.resolveError ? <HintIcon icon={RiErrorWarningLine} tone="error" hint={host.resolveError} /> : null}
                    </>
                  )}
                  menu={(
                    <Menu aria-label={t('ssh.hosts.more', { alias: host.alias })} onAction={runAction}>
                      <MenuSection>
                        <MenuItem id="connect" icon={RiTerminalBoxLine} textValue={t('ssh.hosts.connect')}>{t('ssh.hosts.connect')}</MenuItem>
                        <MenuItem id="files" icon={RiFolder3Line} textValue={t('ssh.hosts.files')}>{t('ssh.hosts.files')}</MenuItem>
                        <MenuItem id="test" icon={RiPulseLine} isDisabled={testing[host.alias]} textValue={t('ssh.hosts.test')}>{t('ssh.hosts.test')}</MenuItem>
                      </MenuSection>
                      <MenuSeparator />
                      <MenuSection
                        selectionMode="multiple"
                        selectedKeys={host.agentAccess ? ['agentAccess'] : []}
                        onSelectionChange={(keys) => void setAgentAccess(host.alias, keys === 'all' || keys.has('agentAccess'))}
                      >
                        <MenuItem id="agentAccess" icon={RiRobot2Line} isDisabled={accessPending[host.alias]} textValue={t('ssh.hosts.agentAccess')}>{t('ssh.hosts.agentAccess')}</MenuItem>
                      </MenuSection>
                      <MenuSeparator />
                      <MenuSection>
                        <MenuItem id="disconnect" icon={RiLinkUnlink} textValue={t('ssh.hosts.disconnect')}>{t('ssh.hosts.disconnect')}</MenuItem>
                        <MenuItem id="forward" icon={RiArrowLeftRightLine} textValue={t('ssh.hosts.newForward')}>{t('ssh.hosts.newForward')}</MenuItem>
                        <MenuItem id="assignIp" icon={RiRouterLine} textValue={t('ssh.hosts.assignIp')}>{t('ssh.hosts.assignIp')}</MenuItem>
                      </MenuSection>
                      {managed ? <MenuSeparator /> : null}
                      {managed ? (
                        <MenuSection>
                          <MenuItem id="edit" icon={RiEdit2Line} textValue={t('ssh.edit')}>{t('ssh.edit')}</MenuItem>
                          <MenuItem id="delete" icon={RiDeleteBinLine} tone="danger" textValue={t('common.delete')}>{t('common.delete')}</MenuItem>
                        </MenuSection>
                      ) : null}
                    </Menu>
                  )}
                >
                  {shadowed ? <Alert status="warning" title={t('ssh.hosts.localShadowed')} /> : null}
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
                </HostRow>
              );
            })}
          </HostGrid>
        ) : null}
        {hosts.length === 0 ? (
          <EmptyState size="sm" icon={RiServerLine} title={t('ssh.hosts.emptyTitle')} description={t('ssh.hosts.emptyHint')} />
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-body-semibold text-text-primary">{t('ssh.ftp.title')}</h3>
          <Button size="small" variant="secondary" leadingIcon={RiAddLine} onClick={() => setFtpDialog({})}>{t('ssh.ftp.add')}</Button>
        </div>
        {ftpSites.length === 0 ? (
          <p className="text-caption-1-regular text-text-tertiary">{t('ssh.ftp.empty')}</p>
        ) : (
          <HostGrid>
            {ftpSites.map((site) => {
              const openFiles = () => onOpenFiles({ kind: 'ftp', siteId: site.id, label: site.name, askPassword: Boolean(site.user) });
              return (
                <HostRow
                  key={site.id}
                  name={site.name}
                  icon={RiPlugLine}
                  moreLabel={t('ssh.hosts.more', { alias: site.name })}
                  editLabel={t('ssh.hosts.editHost', { alias: site.name })}
                  onEdit={() => setFtpDialog({ site })}
                  onActivate={openFiles}
                  subtitle={hostSubtitle(site.protocol, site.user)}
                  badges={site.protocol === 'ftp' ? <HintIcon icon={RiErrorWarningLine} tone="warning" hint={t('ssh.ftp.cleartextWarning')} /> : null}
                  menu={(
                    <Menu aria-label={t('ssh.hosts.more', { alias: site.name })} onAction={(key) => {
                      if (key === 'files') openFiles();
                      if (key === 'edit') setFtpDialog({ site });
                      if (key === 'delete') setPendingDelete({ kind: 'ftp', site });
                    }}>
                      <MenuItem id="files" icon={RiFolder3Line} textValue={t('ssh.hosts.files')}>{t('ssh.hosts.files')}</MenuItem>
                      <MenuSeparator />
                      <MenuItem id="edit" icon={RiEdit2Line} textValue={t('ssh.edit')}>{t('ssh.edit')}</MenuItem>
                      <MenuItem id="delete" icon={RiDeleteBinLine} tone="danger" textValue={t('common.delete')}>{t('common.delete')}</MenuItem>
                    </Menu>
                  )}
                />
              );
            })}
          </HostGrid>
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

/** `ssh, root` style second line: protocol and login user, never the address. */
function hostSubtitle(protocol: string, user?: string): string {
  return user ? `${protocol}, ${user}` : protocol;
}

const HINT_TONES = {
  default: 'text-foreground-icon-tertiary',
  accent: 'text-accent-600',
  warning: 'text-status-yellow-text',
  error: 'text-foreground-icon-error',
} as const;

/** Small status glyph after a host name that explains itself in a tooltip. */
function HintIcon({ icon: Icon, label, hint, tone = 'default' }: { icon: ComponentType<{ className?: string }>; label?: string; hint: string; tone?: keyof typeof HINT_TONES }) {
  return (
    <TooltipTrigger delay={200}>
      <Focusable>
        <span role="img" aria-label={label ? `${label}. ${hint}` : hint} tabIndex={0} className="inline-flex shrink-0 cursor-default rounded-md outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
          <Icon aria-hidden className={cx('size-4', HINT_TONES[tone])} />
        </span>
      </Focusable>
      <Tooltip className="max-w-sm break-words">
        {label ? <span className="block text-caption-1-semibold">{label}</span> : null}
        {hint}
      </Tooltip>
    </TooltipTrigger>
  );
}

/** Two-column grid of host cards once the panel is wide enough. */
function HostGrid({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div role="list" className="grid gap-3 @xl:grid-cols-2">
        {children}
      </div>
    </div>
  );
}

type HostRowProps = {
  name: string;
  icon: ComponentType<{ className?: string }>;
  /** Muted second line, e.g. `ssh, root`. */
  subtitle: string;
  /** Status icons after the name. */
  badges?: ReactNode;
  /** Double-click or Enter: the row's primary action (connect, open files). */
  onActivate: () => void;
  /** Hover action next to the menu button; omitted for read-only rows. */
  onEdit?: () => void;
  editLabel?: string;
  moreLabel: string;
  /** The row's actions, shown from the more button and on right-click. */
  menu: ReactElement;
  /** Keeps a spinner visible while a background action runs. */
  busy?: boolean;
  busyLabel?: string;
  /** Status shown under the row (test results, warnings). */
  children?: ReactNode;
};

/**
 * One host card: double-click (or Enter) runs the primary action,
 * hovering or focusing reveals the edit and more buttons, right-click (or
 * Shift+F10) opens the same menu at the pointer.
 */
function HostRow({ name, icon: Icon, subtitle, badges, onActivate, onEdit, editLabel, moreLabel, menu, busy, busyLabel, children }: HostRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const menuOpen = Boolean(menuAt) || moreOpen;
  // Menus render in portals, so their events bubble here through React too.
  const ignored = (event: MouseEvent) => !(event.target instanceof Element)
    || !event.currentTarget.contains(event.target)
    || event.target.closest('[data-row-actions]') !== null;

  const openContextMenu = (event: MouseEvent) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    // Keyboard-invoked context menus report no pointer position.
    if (event.clientX === 0 && event.clientY === 0) {
      const rect = rowRef.current?.getBoundingClientRect();
      if (rect) setMenuAt({ x: rect.left + 12, y: rect.bottom });
      return;
    }
    setMenuAt({ x: event.clientX, y: event.clientY });
  };

  return (
    <div
      ref={rowRef}
      role="listitem"
      tabIndex={0}
      aria-label={name}
      className={cx(
        'group flex min-w-0 cursor-default flex-col gap-3 rounded-2xl border border-border-button-default bg-background-primary-default p-3 shadow-card outline-none',
        'transition-colors duration-150 ease hover:border-border-button-hover',
        'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        menuOpen && 'border-border-button-hover',
      )}
      // A double-click should connect, not select the word under the pointer.
      onMouseDown={(event) => { if (event.detail > 1 && !ignored(event)) event.preventDefault(); }}
      onDoubleClick={(event) => { if (!ignored(event)) onActivate(); }}
      onContextMenu={openContextMenu}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.key !== 'Enter') return;
        event.preventDefault();
        onActivate();
      }}
    >
      <div className="flex items-center gap-3">
        <div className={ICON_TILE}>
          <Icon className="size-6" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <h4 className="truncate text-body-medium text-text-primary">{name}</h4>
            {badges}
          </div>
          <p className="truncate text-caption-1-regular text-text-secondary">{subtitle}</p>
        </div>
        <div data-row-actions className="flex shrink-0 items-center gap-0.5">
          {busy ? <span role="status" aria-label={busyLabel} className="flex size-7 items-center justify-center"><SpinnerIcon aria-hidden className="size-4 text-foreground-icon-secondary" /></span> : null}
          <div
            className={cx(
              'flex items-center gap-0.5 opacity-0 transition-opacity duration-150 ease',
              'group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100',
              menuOpen && 'opacity-100',
            )}
          >
            {onEdit && editLabel ? <IconAction icon={RiEdit2Line} size="sm" aria-label={editLabel} tooltip onClick={onEdit} /> : null}
            <MenuTrigger isOpen={moreOpen} onOpenChange={setMoreOpen}>
              <Pressable>
                <IconAction icon={RiMore2Line} size="sm" aria-label={moreLabel} active={moreOpen} />
              </Pressable>
              <MenuPopover placement="bottom end">{menu}</MenuPopover>
            </MenuTrigger>
          </div>
        </div>
      </div>
      {children}
      <ContextMenu position={menuAt} onClose={() => setMenuAt(null)}>{menu}</ContextMenu>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { RiArrowLeftRightLine, RiKey2Line, RiLinksLine, RiRefreshLine, RiServerLine, RiTerminalLine } from '@remixicon/react';
import { isNotFoundError, type SshHostsResponse, type SshKeysResponse } from '@todex/protocol/ssh';
import type { TodeXSession } from '../session/useTodeXSession';
import type { WorkbenchItem } from '../lib/panels';
import { remoteFilesBinding, type RemoteFilesBinding } from '../session/fileSources';
import { SshHostsTab } from '../components/ssh/SshHostsTab';
import { SshKeysTab } from '../components/ssh/SshKeysTab';
import { SshConnectionsTab } from '../components/ssh/SshConnectionsTab';
import { SshForwardsTab, type SshForwardsRequest } from '../components/ssh/SshForwardsTab';
import { useRemoteConnector, type RemoteConnectTarget } from '../components/ssh/useRemoteConnector';
import { errorMessage } from '../components/ssh/sshShared';
import { useT } from '../i18n';
import { backendApi } from '../session/helpers';
import { Tab, TabList, TabPanel, Tabs } from '@/components/base/tabs/tabs';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAction } from '@/components/ui/icon-action';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner, SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { BackendSelect } from '@/components/ui/backend-select';

type SshTab = 'hosts' | 'keys' | 'connections' | 'forwards';

const SSH_TABS: readonly SshTab[] = ['hosts', 'keys', 'connections', 'forwards'];

type Props = {
  session: TodeXSession;
  /** Backend the view lists and connects on. */
  backendId: string;
  onBackendChange: (backendId: string) => void;
  /** Workbench scope of the SSH view; terminal ids derive from it. */
  scopeKey: string;
  workbenchItems: WorkbenchItem[];
  onOpenSshTerminal: (host: string) => void;
  onOpenRemoteFiles: (remote: RemoteFilesBinding) => void;
  onCloseWorkbenchItem: (itemId: string) => void;
  /** Opens a loopback URL in a Workbench browser tab (routed through the active backend). */
  onOpenBrowser?: (url: string) => void;
};

/**
 * Main-content view for SSH: hosts and FTP sites, keys, and open
 * connections. Terminals and remote file tabs open in the Workbench side
 * panel under the SSH scope. Everything listed here lives on the machine
 * running the backend.
 */
export function SshPanel({ session, backendId, onBackendChange, scopeKey, workbenchItems, onOpenSshTerminal, onOpenRemoteFiles, onCloseWorkbenchItem, onOpenBrowser }: Props) {
  const t = useT();
  const { serverUrl, deviceSecret, encryptionProtocol, encryptionPublicKey, transportVerified } = session.settingsForBackend(backendId);
  const api = useCallback(() => backendApi({ serverUrl, deviceSecret, encryptionProtocol, encryptionPublicKey, transportVerified }), [deviceSecret, encryptionProtocol, encryptionPublicKey, serverUrl, transportVerified]);
  const remoteConnector = useRemoteConnector(api, backendId);
  const [tab, setTab] = useState<SshTab>('hosts');
  const [hosts, setHosts] = useState<SshHostsResponse | null>(null);
  const [keys, setKeys] = useState<SshKeysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [forwardsRequest, setForwardsRequest] = useState<SshForwardsRequest | null>(null);
  const forwardsRequestIdRef = useRef(0);
  const generationRef = useRef(0);
  const activeBackend = session.backendConnections.find((item) => item.id === backendId);

  const reloadHosts = useCallback(async () => {
    const generation = generationRef.current;
    try {
      const next = await api().listSshHosts();
      if (generation !== generationRef.current) return;
      setHosts(next);
      setUnsupported(false);
      setLoadError('');
    } catch (error) {
      if (generation !== generationRef.current) return;
      if (isNotFoundError(error)) setUnsupported(true);
      else setLoadError(errorMessage(error, t('ssh.loadFailed')));
    }
  }, [api, t]);

  const reloadKeys = useCallback(async () => {
    const generation = generationRef.current;
    try {
      const next = await api().listSshKeys();
      if (generation === generationRef.current) setKeys(next);
    } catch (error) {
      // Hosts already report an unsupported backend; only surface other failures.
      if (generation === generationRef.current && !isNotFoundError(error)) toast.danger(errorMessage(error, t('ssh.keys.loadFailed')));
    }
  }, [api, t]);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([reloadHosts(), reloadKeys()]);
    setLoading(false);
  }, [reloadHosts, reloadKeys]);

  useEffect(() => {
    // A backend switch invalidates in-flight responses from the previous one.
    generationRef.current += 1;
    setHosts(null);
    setKeys(null);
    setUnsupported(false);
    setLoadError('');
    void reloadAll();
  }, [reloadAll]);

  const openFiles = useCallback(async (target: RemoteConnectTarget) => {
    const connection = await remoteConnector.connect(target);
    if (connection) onOpenRemoteFiles(remoteFilesBinding(connection));
  }, [onOpenRemoteFiles, remoteConnector]);

  const requestForwards = useCallback((kind: SshForwardsRequest['kind'], alias: string) => {
    forwardsRequestIdRef.current += 1;
    setForwardsRequest({ id: forwardsRequestIdRef.current, kind, alias });
    setTab('forwards');
  }, []);
  const forwardsRequestHandled = useCallback(() => setForwardsRequest(null), []);
  // The preview browser reaches loopback pages through the active backend, so
  // it only shows forwards that live on that same backend.
  const browserOpener = onOpenBrowser && serverUrl === session.settings.serverUrl ? onOpenBrowser : undefined;

  const backendLabel = activeBackend?.name ? `${activeBackend.name} (${serverUrl})` : serverUrl;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 items-center gap-3 px-6 pb-3 pt-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-badge-new-background text-badge-new-text">
          <RiTerminalLine className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-headline-semibold text-text-primary">{t('ssh.title')}</h2>
          <p className="truncate text-caption-1-regular text-text-secondary" title={backendLabel}>{t('ssh.machineNote', { backend: backendLabel })}</p>
        </div>
        <BackendSelect profiles={session.backendConnections} linkStates={session.backendLinkStatus} selectedId={backendId} onChange={onBackendChange} />
        <IconAction
          icon={loading ? SpinnerIcon : RiRefreshLine}
          size="sm"
          aria-label={t('ssh.refresh')}
          tooltip
          disabled={loading}
          aria-busy={loading || undefined}
          onClick={() => void reloadAll()}
        />
      </div>
      {unsupported ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState icon={RiServerLine} title={t('ssh.unsupportedTitle')} description={t('ssh.unsupportedHint')} />
        </div>
      ) : (
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(SSH_TABS.find((item) => item === key) ?? 'hosts')} className="min-h-0 flex-1 gap-0 px-6">
          <TabList aria-label={t('ssh.title')}>
            <Tab id="hosts" icon={RiServerLine}>{t('ssh.tabHosts')}</Tab>
            <Tab id="keys" icon={RiKey2Line}>{t('ssh.tabKeys')}</Tab>
            <Tab id="connections" icon={RiLinksLine}>{t('ssh.tabConnections')}</Tab>
            <Tab id="forwards" icon={RiArrowLeftRightLine}>{t('ssh.tabForwards')}</Tab>
          </TabList>
          {loadError ? (
            <Alert status="danger" className="mt-3" title={t('ssh.loadFailed')} description={loadError} />
          ) : null}
          <TabPanel id="hosts" className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="flex-1" contentClassName="py-4" surface="secondary">
              {hosts ? (
                <SshHostsTab
                  api={api}
                  backendId={backendId}
                  askPassword={remoteConnector.askPassword}
                  rememberPassword={remoteConnector.rememberPassword}
                  hosts={hosts.hosts}
                  ftpSites={hosts.ftpSites}
                  keys={keys?.keys ?? []}
                  onReload={() => void reloadHosts()}
                  onConnect={onOpenSshTerminal}
                  onOpenFiles={(target) => void openFiles(target)}
                  onNewForward={(alias) => requestForwards('forward', alias)}
                  onAssignIp={(alias) => requestForwards('ip', alias)}
                />
              ) : loading ? <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('app.loading')} /></div> : null}
            </ScrollArea>
          </TabPanel>
          <TabPanel id="keys" className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="flex-1" contentClassName="py-4" surface="secondary">
              <SshKeysTab api={api} keys={keys} onReload={() => void reloadAll()} />
            </ScrollArea>
          </TabPanel>
          <TabPanel id="connections" className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="flex-1" contentClassName="py-4" surface="secondary">
              <SshConnectionsTab
                api={api}
                scopeKey={scopeKey}
                workbenchItems={workbenchItems}
                terminalById={session.terminalById}
                onCloseWorkbenchItem={onCloseWorkbenchItem}
              />
            </ScrollArea>
          </TabPanel>
          <TabPanel id="forwards" className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="flex-1" contentClassName="py-4" surface="secondary">
              <SshForwardsTab
                api={api}
                backendId={backendId}
                hosts={hosts?.hosts ?? []}
                askPassword={remoteConnector.askPassword}
                rememberPassword={remoteConnector.rememberPassword}
                onOpenBrowser={browserOpener}
                request={forwardsRequest}
                onRequestHandled={forwardsRequestHandled}
              />
            </ScrollArea>
          </TabPanel>
        </Tabs>
      )}
      {remoteConnector.dialog}
    </div>
  );
}

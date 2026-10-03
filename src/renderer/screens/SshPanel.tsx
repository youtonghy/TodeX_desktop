import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Spinner, Tabs, toast } from '@heroui/react';
import { EmptyState } from '@heroui-pro/react';
import { RiKey2Line, RiLinksLine, RiRefreshLine, RiServerLine, RiTerminalLine } from '@remixicon/react';
import { V2ApiClient } from '@todex/protocol/v2';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { isNotFoundError, type SshHostsResponse, type SshKeysResponse } from '@todex/protocol/ssh';
import type { TodeXSession } from '../session/useTodeXSession';
import type { WorkbenchItem } from '../lib/panels';
import { remoteFilesBinding, type RemoteFilesBinding } from '../session/fileSources';
import { SshHostsTab } from '../components/ssh/SshHostsTab';
import { SshKeysTab } from '../components/ssh/SshKeysTab';
import { SshConnectionsTab } from '../components/ssh/SshConnectionsTab';
import { useRemoteConnector, type RemoteConnectTarget } from '../components/ssh/useRemoteConnector';
import { errorMessage } from '../components/ssh/sshShared';
import { useT } from '../i18n';

type SshTab = 'hosts' | 'keys' | 'connections';

type Props = {
  session: TodeXSession;
  /** Workbench scope of the SSH view; terminal ids derive from it. */
  scopeKey: string;
  workbenchItems: WorkbenchItem[];
  onOpenSshTerminal: (host: string) => void;
  onOpenRemoteFiles: (remote: RemoteFilesBinding) => void;
  onCloseWorkbenchItem: (itemId: string) => void;
};

/**
 * Main-content view for SSH: hosts and FTP sites, keys, and open
 * connections. Terminals and remote file tabs open in the Workbench side
 * panel under the SSH scope. Everything listed here lives on the machine
 * running the backend.
 */
export function SshPanel({ session, scopeKey, workbenchItems, onOpenSshTerminal, onOpenRemoteFiles, onCloseWorkbenchItem }: Props) {
  const t = useT();
  const serverUrl = session.settings.serverUrl;
  const deviceSecret = session.settings.deviceSecret;
  const api = useCallback(() => new V2ApiClient({ serverUrl, device: deviceIdentityFromSecret(deviceSecret) }), [deviceSecret, serverUrl]);
  const remoteConnector = useRemoteConnector(api);
  const [tab, setTab] = useState<SshTab>('hosts');
  const [hosts, setHosts] = useState<SshHostsResponse | null>(null);
  const [keys, setKeys] = useState<SshKeysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [loadError, setLoadError] = useState('');
  const generationRef = useRef(0);
  const activeBackend = session.backendConnections.find((item) => item.id === session.activeBackendConnectionId);

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

  const backendLabel = activeBackend?.name ? `${activeBackend.name} (${serverUrl})` : serverUrl;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 items-center gap-3 px-6 pb-3 pt-5">
        <div className="bg-accent-soft text-accent flex size-10 shrink-0 items-center justify-center rounded-lg">
          <RiTerminalLine className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{t('ssh.title')}</h2>
          <p className="text-muted truncate text-xs" title={backendLabel}>{t('ssh.machineNote', { backend: backendLabel })}</p>
        </div>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('ssh.refresh')} isDisabled={loading} onPress={() => void reloadAll()}>
          {loading ? <Spinner size="sm" /> : <RiRefreshLine className="size-4" />}
        </Button>
      </div>
      {unsupported ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState>
            <EmptyState.Header>
              <EmptyState.Media variant="icon"><RiServerLine /></EmptyState.Media>
              <EmptyState.Title>{t('ssh.unsupportedTitle')}</EmptyState.Title>
              <EmptyState.Description>{t('ssh.unsupportedHint')}</EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        </div>
      ) : (
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key === 'keys' || key === 'connections' ? key : 'hosts')} className="flex min-h-0 flex-1 flex-col px-6">
          <Tabs.ListContainer>
            <Tabs.List aria-label={t('ssh.title')}>
              <Tabs.Tab id="hosts" className="gap-1.5"><RiServerLine className="size-4" />{t('ssh.tabHosts')}<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="keys" className="gap-1.5"><RiKey2Line className="size-4" />{t('ssh.tabKeys')}<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="connections" className="gap-1.5"><RiLinksLine className="size-4" />{t('ssh.tabConnections')}<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          {loadError ? (
            <Alert status="danger" className="mt-3">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{t('ssh.loadFailed')}</Alert.Title>
                <Alert.Description>{loadError}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <Tabs.Panel id="hosts" className="min-h-0 flex-1 overflow-y-auto py-4">
            {hosts ? (
              <SshHostsTab
                api={api}
                hosts={hosts.hosts}
                ftpSites={hosts.ftpSites}
                keys={keys?.keys ?? []}
                onReload={() => void reloadHosts()}
                onConnect={onOpenSshTerminal}
                onOpenFiles={(target) => void openFiles(target)}
              />
            ) : loading ? <div className="flex min-h-48 items-center justify-center"><Spinner aria-label={t('app.loading')} /></div> : null}
          </Tabs.Panel>
          <Tabs.Panel id="keys" className="min-h-0 flex-1 overflow-y-auto py-4">
            <SshKeysTab api={api} keys={keys} onReload={() => void reloadAll()} />
          </Tabs.Panel>
          <Tabs.Panel id="connections" className="min-h-0 flex-1 overflow-y-auto py-4">
            <SshConnectionsTab
              api={api}
              scopeKey={scopeKey}
              workbenchItems={workbenchItems}
              terminalById={session.terminalById}
              onCloseWorkbenchItem={onCloseWorkbenchItem}
            />
          </Tabs.Panel>
        </Tabs>
      )}
      {remoteConnector.dialog}
    </div>
  );
}

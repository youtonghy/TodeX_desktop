import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Chip, Spinner, Tooltip, toast } from '@heroui/react';
import { RiCloseLine, RiFolder3Line, RiRefreshLine, RiServerLine } from '@remixicon/react';
import { isNotFoundError, type RemoteConnection } from '@todex/protocol/ssh';
import type { WorkbenchItem } from '../../lib/panels';
import type { TerminalClientState } from '../../session/helpers';
import { terminalIdForConversation, terminalStatusLabel } from '../../session/helpers';
import { useT } from '../../i18n';
import { errorMessage, formatTimestamp, type SshApi } from './sshShared';

type Props = {
  api: SshApi;
  scopeKey: string;
  workbenchItems: WorkbenchItem[];
  terminalById: Record<string, TerminalClientState>;
  onCloseWorkbenchItem: (itemId: string) => void;
};

export function SshConnectionsTab({ api, scopeKey, workbenchItems, terminalById, onCloseWorkbenchItem }: Props) {
  const t = useT();
  const [connections, setConnections] = useState<RemoteConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const sshTabs = workbenchItems.filter((item) => item.ssh);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setConnections((await api().listRemoteConnections()).connections);
    } catch (error) {
      setConnections([]);
      toast.danger(errorMessage(error, t('ssh.connections.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [api, t]);

  useEffect(() => { void refresh(); }, [refresh]);

  const closeConnection = async (connection: RemoteConnection) => {
    try {
      await api().closeRemoteConnection(connection.id);
    } catch (error) {
      if (!isNotFoundError(error)) {
        toast.danger(errorMessage(error, t('ssh.connections.closeFailed')));
        return;
      }
    }
    // A files tab bound to this connection would only show errors now.
    for (const item of workbenchItems) {
      if (item.remote?.connectionId === connection.id) onCloseWorkbenchItem(item.id);
    }
    void refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('ssh.connections.remoteTitle')}</h3>
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('ssh.refresh')} isDisabled={loading} onPress={() => void refresh()}>
            {loading ? <Spinner size="sm" /> : <RiRefreshLine className="size-4" />}
          </Button>
        </div>
        {!loading && connections.length === 0 ? <p className="text-muted text-xs">{t('ssh.connections.remoteEmpty')}</p> : null}
        {connections.map((connection) => (
          <Card key={connection.id} className="flex-row items-center gap-3 rounded-lg p-3">
            <RiFolder3Line className="text-muted size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{connection.label}</span>
                <Chip size="sm" variant="soft">{connection.kind.toUpperCase()}</Chip>
              </div>
              <p className="text-muted truncate text-xs">
                {connection.homeDirectory} · {t('ssh.connections.lastUsed', { time: formatTimestamp(connection.lastUsedAt) })}
              </p>
            </div>
            <Tooltip delay={200}>
              <Button isIconOnly size="sm" variant="ghost" aria-label={t('ssh.connections.close', { label: connection.label })} onPress={() => void closeConnection(connection)}>
                <RiCloseLine className="size-4" />
              </Button>
              <Tooltip.Content className="text-xs">{t('ssh.connections.close', { label: connection.label })}</Tooltip.Content>
            </Tooltip>
          </Card>
        ))}
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t('ssh.connections.terminalsTitle')}</h3>
        {sshTabs.length === 0 ? <p className="text-muted text-xs">{t('ssh.connections.terminalsEmpty')}</p> : null}
        {sshTabs.map((item) => {
          const terminal = terminalById[terminalIdForConversation(scopeKey, item.id)];
          return (
            <Card key={item.id} className="flex-row items-center gap-3 rounded-lg p-3">
              <RiServerLine className="text-muted size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="truncate text-sm font-medium">{item.ssh?.host}</span>
                <p className="text-muted truncate text-xs">{terminal ? terminalStatusLabel(terminal.status) : t('ssh.connections.notStarted')}</p>
              </div>
              <Tooltip delay={200}>
                <Button isIconOnly size="sm" variant="ghost" aria-label={t('ssh.connections.close', { label: item.ssh?.host ?? '' })} onPress={() => onCloseWorkbenchItem(item.id)}>
                  <RiCloseLine className="size-4" />
                </Button>
                <Tooltip.Content className="text-xs">{t('ssh.connections.close', { label: item.ssh?.host ?? '' })}</Tooltip.Content>
              </Tooltip>
            </Card>
          );
        })}
      </section>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { RiCloseLine, RiFolder3Line, RiRefreshLine, RiServerLine } from '@remixicon/react';
import { isNotFoundError, type RemoteConnection } from '@todex/protocol/ssh';
import type { WorkbenchItem } from '../../lib/panels';
import type { TerminalClientState } from '../../session/helpers';
import { terminalIdForConversation, terminalStatusLabel } from '../../session/helpers';
import { useT } from '../../i18n';
import { errorMessage, formatTimestamp, type SshApi } from './sshShared';
import { Chip } from '@/components/base/badges/chip';
import { IconAction } from '@/components/ui/icon-action';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

/** BoardUI settings-row recipe: a grouped secondary card of hairline rows. */
const GROUP = 'flex flex-col rounded-2xl bg-background-secondary-default ps-3';
const ROW = 'flex min-h-[52px] min-w-0 items-center gap-3 border-b border-separator-border py-2.5 pe-2.5 last:border-b-0';

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
          <h3 className="text-body-semibold text-text-primary">{t('ssh.connections.remoteTitle')}</h3>
          <IconAction
            icon={loading ? SpinnerIcon : RiRefreshLine}
            size="sm"
            aria-label={t('ssh.refresh')}
            tooltip
            disabled={loading}
            aria-busy={loading || undefined}
            onClick={() => void refresh()}
          />
        </div>
        {!loading && connections.length === 0 ? <p className="text-caption-1-regular text-text-tertiary">{t('ssh.connections.remoteEmpty')}</p> : null}
        {connections.length ? (
          <div className={GROUP}>
            {connections.map((connection) => (
              <div key={connection.id} className={ROW}>
                <RiFolder3Line className="size-5 shrink-0 text-foreground-icon-secondary" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-body-medium text-text-primary">{connection.label}</span>
                    <Chip variant="caption" color="neutral" className="shrink-0">{connection.kind.toUpperCase()}</Chip>
                  </div>
                  <p className="truncate text-body-2-regular text-text-secondary">
                    {connection.homeDirectory} · {t('ssh.connections.lastUsed', { time: formatTimestamp(connection.lastUsedAt) })}
                  </p>
                </div>
                <IconAction
                  icon={RiCloseLine}
                  size="sm"
                  aria-label={t('ssh.connections.close', { label: connection.label })}
                  tooltip
                  onClick={() => void closeConnection(connection)}
                />
              </div>
            ))}
          </div>
        ) : null}
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-body-semibold text-text-primary">{t('ssh.connections.terminalsTitle')}</h3>
        {sshTabs.length === 0 ? <p className="text-caption-1-regular text-text-tertiary">{t('ssh.connections.terminalsEmpty')}</p> : (
          <div className={GROUP}>
            {sshTabs.map((item) => {
              const terminal = terminalById[terminalIdForConversation(scopeKey, item.id)];
              return (
                <div key={item.id} className={ROW}>
                  <RiServerLine className="size-5 shrink-0 text-foreground-icon-secondary" />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-body-medium text-text-primary">{item.ssh?.host}</span>
                    <p className="truncate text-body-2-regular text-text-secondary">{terminal ? terminalStatusLabel(terminal.status) : t('ssh.connections.notStarted')}</p>
                  </div>
                  <IconAction
                    icon={RiCloseLine}
                    size="sm"
                    aria-label={t('ssh.connections.close', { label: item.ssh?.host ?? '' })}
                    tooltip
                    onClick={() => onCloseWorkbenchItem(item.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

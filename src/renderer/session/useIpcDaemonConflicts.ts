import { useEffect, useRef } from 'react';
import { isIpcServerUrl } from '@todex/protocol/ipcServerUrl';
import { toast } from '@/components/ui/toast-store';
import { t } from '../i18n';
import { debugLog } from '../lib/debugLogger';
import { orphanedStandbyProfiles } from './backendRouting';
import { daemonConflicts } from './localPairing';
import type { TodeXSession } from './useTodeXSession';

/**
 * Keeps one enabled profile per daemon: once an IPC profile serves a daemon
 * (it pinned the same transport key, the daemon's loopback listener is
 * another profile's address, or it is a group node the IPC profile reported
 * being), the TCP profile reaching it is disabled and its records move to
 * the IPC profile. Runs after hydration (repairing profiles saved while both
 * were enabled) and whenever a profile changes address, pin or state, such
 * as an IPC pairing completing.
 *
 * A group node profile that loses stays connected as the standby link that
 * keeps this device in its group, without a notice; once no IPC profile
 * serves its daemon any more, it carries the data again.
 */
export function useIpcDaemonConflicts(session: TodeXSession): void {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const localBackend = window.todexDesktop.localBackend;
  const profilesKey = session.hydrated
    ? session.backendConnections
      .map((profile) => [profile.id, profile.serverUrl, profile.transportVerified, profile.encryptionPublicKey, profile.disabled === true, profile.mesh?.nodeId ?? ''].join('\t'))
      .join('\n')
    : '';
  const nodesKey = JSON.stringify(session.meshGroups.ipcNodeIds);

  useEffect(() => {
    if (!profilesKey) return;
    let cancelled = false;
    void (async () => {
      const endpoint = localBackend.available ? await localBackend.nativeEndpoint().catch(() => null) : null;
      if (cancelled) return;
      const current = sessionRef.current;
      const nodeOf = (profileId: string) => current.meshGroups.ipcNodeIds[profileId];
      for (const { loserId, winnerId } of daemonConflicts(current.backendConnections, endpoint, nodeOf)) {
        const loser = current.backendConnections.find((profile) => profile.id === loserId);
        const winner = current.backendConnections.find((profile) => profile.id === winnerId);
        if (!loser || !winner) continue;
        debugLog('localBackend.daemonConflict.resolved', { loserId, winnerId, standby: Boolean(loser.mesh) });
        current.replaceBackendConnection(loserId, winnerId);
        if (loser.mesh) continue;
        toast.info(t('localBackend.daemonConflictTitle'), {
          description: t('localBackend.daemonConflictBody', { name: loser.name, ipc: winner.name }),
        });
      }
      for (const standby of orphanedStandbyProfiles(current.backendConnections, isIpcServerUrl, nodeOf)) {
        debugLog('localBackend.standby.resumed', { profileId: standby.id });
        current.resumeStandbyConnection(standby.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localBackend, nodesKey, profilesKey]);
}

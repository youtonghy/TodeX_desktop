import { useEffect, useRef } from 'react';
import { toast } from '@/components/ui/toast';
import { t } from '../i18n';
import { debugLog } from '../lib/debugLogger';
import { daemonConflicts } from './localPairing';
import type { TodeXSession } from './useTodeXSession';

/**
 * Keeps one enabled profile per daemon: once an IPC profile serves a daemon
 * (it pinned the same transport key, or the daemon's loopback listener is
 * another profile's address), the TCP profile reaching it is disabled and
 * its records move to the IPC profile. Runs after hydration (repairing
 * profiles saved while both were enabled) and whenever a profile changes
 * address, pin or state, such as an IPC pairing completing.
 */
export function useIpcDaemonConflicts(session: TodeXSession): void {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const localBackend = window.todexDesktop.localBackend;
  const profilesKey = session.hydrated
    ? session.backendConnections
      .map((profile) => [profile.id, profile.serverUrl, profile.transportVerified, profile.encryptionPublicKey, profile.disabled === true].join('\t'))
      .join('\n')
    : '';

  useEffect(() => {
    if (!profilesKey) return;
    let cancelled = false;
    void (async () => {
      const endpoint = localBackend.available ? await localBackend.nativeEndpoint().catch(() => null) : null;
      if (cancelled) return;
      const current = sessionRef.current;
      for (const { loserId, winnerId } of daemonConflicts(current.backendConnections, endpoint)) {
        const loser = current.backendConnections.find((profile) => profile.id === loserId);
        const winner = current.backendConnections.find((profile) => profile.id === winnerId);
        if (!loser || !winner) continue;
        debugLog('localBackend.daemonConflict.resolved', { loserId, winnerId });
        current.replaceBackendConnection(loserId, winnerId);
        toast.info(t('localBackend.daemonConflictTitle'), {
          description: t('localBackend.daemonConflictBody', { name: loser.name, ipc: winner.name }),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localBackend, profilesKey]);
}

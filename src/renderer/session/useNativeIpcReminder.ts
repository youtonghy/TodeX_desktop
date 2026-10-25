import { useEffect, useRef } from 'react';
import { ipcServerUrl } from '@todex/protocol/ipcServerUrl';
import { toast } from '@/components/ui/toast';
import { t } from '../i18n';
import { debugLog } from '../lib/debugLogger';
import { loadJson } from '../lib/storage';
import {
  LOCAL_BACKEND_PREFS_KEY,
  NATIVE_INSTANCE,
  nativeIpcCandidate,
  switchToNativeIpc,
  type LocalBackendPrefs,
} from './localPairing';
import type { TodeXSession } from './useTodeXSession';

/**
 * Suggests, once per profile and app run, switching a connection that
 * reaches this machine's daemon over loopback TCP to the daemon's IPC socket,
 * when the daemon serves one. Off with the 本机 Backend page's
 * 「提醒切换到 IPC 连接」 preference.
 */
export function useNativeIpcReminder(session: TodeXSession, deviceName: string): void {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const asked = useRef(new Set<string>());
  const localBackend = window.todexDesktop.localBackend;
  // Re-check whenever the set of connected profiles changes.
  const connected = session.backendConnections
    .filter((profile) => session.backendLinkStatus[profile.id]?.state === 'open')
    .map((profile) => `${profile.id}=${profile.serverUrl}`)
    .join('\n');

  useEffect(() => {
    if (!localBackend.available || !connected) return;
    let cancelled = false;
    void (async () => {
      const prefs = await loadJson<LocalBackendPrefs>(LOCAL_BACKEND_PREFS_KEY, {});
      if (prefs.suggestIpc === false) return;
      const endpoint = await localBackend.nativeEndpoint();
      const current = sessionRef.current;
      const profile = nativeIpcCandidate(current.backendConnections, endpoint, (id) => current.backendLinkStatus[id]?.state === 'open');
      if (cancelled || !profile || asked.current.has(profile.id)) return;
      // Only suggest a socket that answers.
      const response = await fetch(`${ipcServerUrl(NATIVE_INSTANCE)}/v2/version`, { signal: AbortSignal.timeout(4000) });
      if (cancelled || !response.ok) return;
      asked.current.add(profile.id);
      const key = toast.info(t('localBackend.ipcSuggestTitle'), {
        description: t('localBackend.ipcSuggestBody', { name: profile.name, url: profile.serverUrl }),
        timeout: 0,
        actionProps: {
          children: t('localBackend.switchToIpc'),
          onPress: () => {
            toast.close(key);
            switchToNativeIpc(sessionRef.current, profile.id, deviceName).then(
              () => toast.success(t('localBackend.switchedToIpc')),
              (error: unknown) => toast.danger(t('localBackend.switchToIpcFailed'), { description: error instanceof Error ? error.message : String(error) }),
            );
          },
        },
      });
    })().catch((error: unknown) => debugLog('localBackend.ipcReminder.failed', { error: error instanceof Error ? error.message : String(error) }, 'warn'));
    return () => {
      cancelled = true;
    };
  }, [connected, deviceName, localBackend]);
}

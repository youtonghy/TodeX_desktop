import { useEffect, useRef } from 'react';
import type { ContainerPrefs } from '../../../preload/containerTypes';
import { useT } from '../../i18n';
import { loadJson } from '../../lib/storage';
import { enabledProfileIds, freezeContainer, isFrozenProfile, noteContainerState, wakeProfile } from '../../session/containerFreeze';
import { followMovedPort } from '../../session/containerConnection';
import { backendActive, idleExpired } from '../../session/containerIdle';
import { CONTAINER_PREFS_KEY } from '../../session/containerPrefs';
import type { TodeXSession } from '../../session/useTodeXSession';
import { toast } from '../ui/toast';

const SAMPLE_MS = 30_000;

/**
 * Samples the containers every 30 s: re-points the profiles of containers
 * moved to another host port, and runs Settings → TodeX Container →
 * Auto-freeze, which pauses a container once nothing ran on its backend (as
 * this app sees it) for the chosen time, and wakes it for a send, a terminal,
 * or opening one of its workspaces. Renders nothing.
 */
export function ContainerFreezer({ session }: { session: TodeXSession }) {
  const t = useT();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // Container name → when its backend last had activity; the count starts at launch.
  const lastActive = useRef(new Map<string, number>());

  const wake = (profileId: string) => {
    const name = session.backendConnections.find((profile) => profile.id === profileId)?.name ?? profileId;
    const notice = toast.info(t('container.freeze.waking', { name }), { timeout: 0 });
    return wakeProfile(() => sessionRef.current, profileId).finally(() => toast.close(notice));
  };
  const wakeRef = useRef(wake);
  wakeRef.current = wake;

  useEffect(() => {
    session.setBackendWakeGate({ isFrozen: isFrozenProfile, wake: (profileId) => wakeRef.current(profileId) });
    return () => session.setBackendWakeGate(null);
  }, [session.setBackendWakeGate]);

  const activeBackend = session.activeWorkspace?.backendConnectionId ?? '';
  const activeBackendRef = useRef(activeBackend);
  activeBackendRef.current = activeBackend;

  useEffect(() => {
    let cancelled = false;
    let first = true;
    const sample = async () => {
      const api = window.todexDesktop.container;
      const env = await api.environment();
      if (cancelled || env.problem) return;
      const prefs = await loadJson<ContainerPrefs>(CONTAINER_PREFS_KEY, {});
      const minutes = Number(prefs?.freezeIdleMinutes) || 0;
      const now = Date.now();
      for (const item of await api.list()) {
        if (cancelled) return;
        const current = sessionRef.current;
        noteContainerState(current, item);
        if (item.state !== 'running') continue;
        // Profiles follow a container Desktop moved off a conflicting port (e.g. at launch).
        if (item.formerPorts.length) await followMovedPort(current, item);
        const profiles = enabledProfileIds(current.backendConnections, item);
        // Only containers this app uses: it cannot see who else might.
        if (!profiles.length || !profiles.some((id) => current.backendLinkStatus[id]?.state === 'open')) {
          lastActive.current.delete(item.name);
          continue;
        }
        if (backendActive(current, profiles) || !lastActive.current.has(item.name)) {
          lastActive.current.set(item.name, now);
          continue;
        }
        if (!idleExpired(lastActive.current.get(item.name)!, now, minutes)) continue;
        lastActive.current.delete(item.name);
        await freezeContainer(current, item);
        window.todexDesktop.debug.log('info', 'container.freeze', { name: item.name, minutes });
      }
      // A container frozen before launch wakes once if its workspace is the open one.
      if (first && !cancelled) {
        first = false;
        if (isFrozenProfile(activeBackendRef.current)) await wakeRef.current(activeBackendRef.current);
      }
    };
    const tick = () => void sample().catch((error) => window.todexDesktop.debug.log('warn', 'container.freeze.failed', { error: error instanceof Error ? error.message : String(error) }));
    tick();
    const timer = window.setInterval(tick, SAMPLE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Opening a workspace of a frozen backend wakes it, so its history loads.
  useEffect(() => {
    if (!activeBackend || !isFrozenProfile(activeBackend)) return;
    void wakeRef.current(activeBackend).catch((error) => toast.danger(error instanceof Error ? error.message : String(error)));
  }, [activeBackend, session.activeConversationId]);

  return null;
}

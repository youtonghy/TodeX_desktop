import { useEffect, useRef } from 'react';
import type { ContainerPrefs } from '../../../preload/containerTypes';
import { loadJson } from '../../lib/storage';
import { backendBusy, containerProfiles } from '../../session/containerConnection';
import { CONTAINER_PREFS_KEY } from '../../session/containerPrefs';
import type { TodeXSession } from '../../session/useTodeXSession';

const INTERVAL_MS = 6 * 60 * 60 * 1000;
// Lets a burst of workspace removals settle before the container is recreated.
const SETTLE_MS = 60_000;

function inside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
}

/**
 * Settings → TodeX Container → "Unmount unused folders": once a container's
 * backend is idle, unmounts the folders no workspace of this app uses there
 * (never the last one). Renders nothing.
 */
export function ContainerMountCleanup({ session }: { session: TodeXSession }) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const workspaceKey = session.workspaces.map((workspace) => `${workspace.backendConnectionId}:${workspace.path}`).sort().join('\n');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const prefs = await loadJson<ContainerPrefs>(CONTAINER_PREFS_KEY, {});
      if (cancelled || prefs?.pruneMounts !== true) return;
      const api = window.todexDesktop.container;
      const env = await api.environment();
      if (env.problem) return;
      for (const item of await api.list()) {
        if (cancelled || !item.managed || item.state !== 'running' || item.mounts.length < 2) continue;
        const current = sessionRef.current;
        const profiles = containerProfiles(current.backendConnections, item).map((profile) => profile.id);
        // Without a profile this app cannot tell which folders are in use.
        if (!profiles.length || backendBusy(current, profiles)) continue;
        const paths = current.workspaces.filter((workspace) => workspace.backendConnectionId && profiles.includes(workspace.backendConnectionId)).map((workspace) => workspace.path);
        const used = item.mounts.filter((mount) => paths.some((path) => inside(path, mount.target)));
        if (!used.length || used.length === item.mounts.length) continue;
        const removed = await api.setMounts(item.name, used.map((mount) => mount.host));
        window.todexDesktop.debug.log('info', 'container.mounts.pruned', { name: item.name, count: removed.length });
      }
    };
    const tick = () => void run().catch((error) => window.todexDesktop.debug.log('warn', 'container.mounts.pruneFailed', { error: error instanceof Error ? error.message : String(error) }));
    const settle = window.setTimeout(tick, SETTLE_MS);
    const timer = window.setInterval(tick, INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(settle);
      window.clearInterval(timer);
    };
  }, [workspaceKey]);

  return null;
}

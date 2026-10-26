import type { ContainerInfo } from '../../preload/containerTypes';
import { containerProfiles, waitForLink } from './containerConnection';

/**
 * Automatic freeze of idle TodeX containers (`docker pause`). This app
 * disconnects a container's profiles before freezing it, so a frozen backend
 * reports no connection errors; the session's wake gate thaws it before a
 * send or terminal open, and opening one of its workspaces thaws it too.
 */

type Profile = { id: string; serverUrl: string; disabled?: boolean };

export type FreezeSession = {
  backendConnections: Profile[];
  backendLinkStatus: Record<string, { state?: string } | undefined>;
  workspaces: Array<{ id: string; backendConnectionId?: string | null }>;
  conversations: Array<{ id: string; workspaceId: string; nativeStatus?: string | null }>;
  conversationRuntimeById: Record<string, { followUps?: { items: unknown[] } } | undefined>;
  terminalById: Record<string, { backendConnectionId?: string; status: string } | undefined>;
  connect: (backendId: string) => void;
  disconnect: (backendId: string, manual?: boolean) => void;
};

/** Profile id → frozen container name, for the session's wake gate (sync lookups). */
const frozenProfiles = new Map<string, string>();
const wakes = new Map<string, Promise<void>>();

/** The enabled profiles of `container` (one per daemon once IPC/TCP conflicts are resolved). */
export function enabledProfileIds(profiles: Profile[], container: ContainerInfo): string[] {
  return containerProfiles(profiles as Parameters<typeof containerProfiles>[0], container).filter((profile) => !profile.disabled).map((profile) => profile.id);
}

export function isFrozenProfile(profileId: string): boolean {
  return frozenProfiles.has(profileId);
}

/** Records the frozen state the container list reports (frozen elsewhere, or thawed outside this app). */
export function noteContainerState(session: FreezeSession, container: ContainerInfo): void {
  const ids = enabledProfileIds(session.backendConnections, container);
  if (container.state === 'paused') {
    for (const id of ids) {
      if (frozenProfiles.has(id)) continue;
      // Frozen before this app started (or by someone else): stop reconnecting to it.
      frozenProfiles.set(id, container.name);
      session.disconnect(id, true);
    }
    return;
  }
  for (const id of ids) {
    if (frozenProfiles.get(id) !== container.name) continue;
    frozenProfiles.delete(id);
    // Thawed outside this app: the manual disconnect would keep it closed.
    if (container.state === 'running') session.connect(id);
  }
}

export async function freezeContainer(session: FreezeSession, container: ContainerInfo): Promise<void> {
  const ids = enabledProfileIds(session.backendConnections, container);
  for (const id of ids) {
    frozenProfiles.set(id, container.name);
    session.disconnect(id, true);
  }
  try {
    await window.todexDesktop.container.pause(container.name);
  } catch (error) {
    for (const id of ids) {
      frozenProfiles.delete(id);
      session.connect(id);
    }
    throw error;
  }
}

/**
 * Thaws the container behind `profileId` and reconnects its profiles;
 * resolves once that profile's link is open. Concurrent calls share one wake.
 */
export function wakeProfile(read: () => FreezeSession, profileId: string): Promise<void> {
  const name = frozenProfiles.get(profileId);
  if (!name) return Promise.resolve();
  const pending = wakes.get(name);
  if (pending) return pending;
  const wake = (async () => {
    await window.todexDesktop.container.unpause(name);
    const ids = [...frozenProfiles].filter(([, frozen]) => frozen === name).map(([id]) => id);
    for (const id of ids) {
      frozenProfiles.delete(id);
      read().connect(id);
    }
    await waitForLink(read, profileId);
  })().finally(() => wakes.delete(name));
  wakes.set(name, wake);
  return wake;
}

/** Thaws `container` (settings' Resume) and reconnects it. */
export async function wakeContainer(read: () => FreezeSession, container: ContainerInfo): Promise<void> {
  const ids = enabledProfileIds(read().backendConnections, container);
  if (!ids.some((id) => frozenProfiles.has(id))) {
    await window.todexDesktop.container.unpause(container.name);
    for (const id of ids) read().connect(id);
    return;
  }
  await wakeProfile(read, ids.find((id) => frozenProfiles.has(id))!);
}

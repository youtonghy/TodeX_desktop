import { useSyncExternalStore } from 'react';
import { ipcServerInstance, ipcServerUrl } from '@todex/protocol/ipcServerUrl';
import type { BackendConnectionProfile } from '@todex/protocol/todex';
import type { ContainerInfo } from '../../preload/containerTypes';

/**
 * The connection profiles that reach a TodeX container, as the last container
 * list reported them. The sidebar leaves the No-workspace row out for these
 * backends, and a new No-workspace conversation prefers another backend.
 */

type Profile = { id: string; serverUrl: string };

/** The loopback URL a TCP profile uses for `container` (its published port). */
export function containerTcpUrl(container: Pick<ContainerInfo, 'port'>): string | null {
  return container.port ? `http://127.0.0.1:${container.port}` : null;
}

export function sameUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left.trim());
    const b = new URL(right.trim());
    const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host);
    return a.protocol === b.protocol && a.port === b.port && (a.hostname === b.hostname || (loopback(a.hostname) && loopback(b.hostname)));
  } catch {
    return false;
  }
}

/** The connection profiles that reach `container`: its IPC instance or its loopback port. */
export function containerProfiles(profiles: BackendConnectionProfile[], container: ContainerInfo): BackendConnectionProfile[] {
  const tcp = containerTcpUrl(container);
  const ipc = ipcServerUrl(container.ipcId);
  return profiles.filter((profile) => profile.serverUrl === ipc || (tcp !== null && sameUrl(profile.serverUrl, tcp)));
}

let known: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

/** Records the profiles of `containers` (every state, frozen or stopped included). */
export function noteContainerProfiles(profiles: Parameters<typeof containerProfiles>[0], containers: ContainerInfo[]): void {
  const next = new Set(containers.flatMap((container) => containerProfiles(profiles, container).map((profile) => profile.id)));
  if (next.size === known.size && [...next].every((id) => known.has(id))) return;
  known = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useContainerProfileIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => known);
}

/** Whether `profile` reaches a container: listed by Docker, or a container's IPC instance (known before the list loads). */
export function isContainerProfile(profile: Profile, ids: ReadonlySet<string>): boolean {
  return ids.has(profile.id) || Boolean(ipcServerInstance(profile.serverUrl)?.startsWith('container-'));
}

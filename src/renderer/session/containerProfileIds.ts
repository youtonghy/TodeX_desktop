import { useSyncExternalStore } from 'react';
import { ipcServerInstance } from '@todex/protocol/ipcServerUrl';
import type { ContainerInfo } from '../../preload/containerTypes';
import { containerProfiles } from './containerConnection';

/**
 * The connection profiles that reach a TodeX container, as the last container
 * list reported them. The sidebar leaves the No-workspace row out for these
 * backends, and a new No-workspace conversation prefers another backend.
 */

type Profile = { id: string; serverUrl: string };

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

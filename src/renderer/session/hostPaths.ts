// Where a backend's paths live on this machine. Local features (the
// directory picker, Open / Open With / Reveal) only apply to a backend
// reached over loopback HTTP(S) or IPC; a container backend's paths differ
// from this machine's unless its published path mappings say how they correspond.
//
// Pure (types only from the protocol, the mapper passed in) so node can test
// it without the `@todex/protocol` alias.
import type { BackendDeployment, PathMapping, PathMappingOptions } from '@todex/protocol/pathMapping';

export type PathMapper = (path: string, mappings: readonly PathMapping[], options: PathMappingOptions) => string | null;

export type HostPathContext = {
  /** The backend URL is loopback or IPC: it runs on (or is published to) this machine. */
  loopback: boolean;
  deployment: BackendDeployment;
  pathMappings: readonly PathMapping[];
  /** This machine uses Windows paths. */
  windows: boolean;
};

/**
 * The backend path for a folder picked on this machine. `unmounted` is set
 * when the backend is a container that publishes mappings, none of which
 * covers the folder; the path is then left as picked.
 */
export function pickedHostPathToBackend(
  context: HostPathContext,
  picked: string,
  mapHostPathToBackend: PathMapper,
): { path: string; unmounted: boolean } {
  if (!context.loopback || !context.pathMappings.length) return { path: picked, unmounted: false };
  const mapped = mapHostPathToBackend(picked, context.pathMappings, { windows: context.windows });
  if (mapped) return { path: mapped, unmounted: false };
  return { path: picked, unmounted: context.deployment === 'container' };
}

/**
 * How to turn a backend path into one this machine's shell can open, or null
 * when the shell actions do not apply to this backend at all (remote, or a
 * container without mappings). The returned function gives null for a path
 * no mapping covers on a container; a host backend's unmapped paths are
 * already local.
 */
export function systemShellPathResolver(
  context: HostPathContext,
  mapBackendPathToHost: PathMapper,
): ((backendPath: string) => string | null) | null {
  if (!context.loopback) return null;
  const { pathMappings, windows, deployment } = context;
  if (pathMappings.length) {
    return (backendPath) => mapBackendPathToHost(backendPath, pathMappings, { windows })
      ?? (deployment === 'container' ? null : backendPath);
  }
  return deployment === 'container' ? null : (backendPath) => backendPath;
}

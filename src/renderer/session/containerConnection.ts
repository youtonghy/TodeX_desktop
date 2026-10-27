import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { ipcServerUrl } from '@todex/protocol/ipcServerUrl';
import type { BackendConnectionProfile } from '@todex/protocol/todex';
import type { ContainerInfo } from '../../preload/containerTypes';
import { t } from '../i18n';
import { backendTransport } from './helpers';
import { daemonPeer, ensureManagedConnection, pairWithLocalApproval } from './localPairing';

type ContainerSession = Parameters<typeof ensureManagedConnection>[0] & {
  backendLinkStatus: Record<string, { state?: string } | undefined>;
  workspaces: Array<{ id: string; path: string; backendConnectionId?: string | null }>;
  conversations: Array<{ workspaceId: string; nativeStatus?: string | null }>;
};

/** The loopback URL a TCP profile uses for `container` (its published port). */
export function containerTcpUrl(container: Pick<ContainerInfo, 'port'>): string | null {
  return container.port ? `http://127.0.0.1:${container.port}` : null;
}

function sameUrl(left: string, right: string): boolean {
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

const MOVE_PROBE_TIMEOUT_MS = 8000;
// Profile id + port pairs already checked, so a profile of another daemon is probed once per run.
const probedMoves = new Set<string>();

/**
 * Re-points the paired loopback profiles still aimed at a port Desktop moved
 * `container` off, keeping each profile (and the workspaces filed under it)
 * like `switchToNativeIpc` does. The URL alone cannot tell which daemon a
 * profile belongs to (the native backend may now own the old port), so a
 * profile only moves when a sealed request with its pinned key and device
 * succeeds against the new port. Resolves the re-pointed profile ids.
 */
export async function followMovedPort(session: ContainerSession, container: Pick<ContainerInfo, 'name' | 'port' | 'formerPorts' | 'state'>): Promise<string[]> {
  const serverUrl = containerTcpUrl(container);
  if (!serverUrl || container.state !== 'running' || !container.formerPorts.length) return [];
  if (session.backendConnections.some((profile) => sameUrl(profile.serverUrl, serverUrl))) return [];
  const formerUrls = container.formerPorts.map((port) => `http://127.0.0.1:${port}`);
  const moved: string[] = [];
  for (const profile of session.backendConnections) {
    if (profile.disabled || !profile.transportVerified || !deviceIdentityFromSecret(profile.deviceSecret)) continue;
    if (!formerUrls.some((url) => sameUrl(profile.serverUrl, url))) continue;
    const key = `${profile.id}:${container.port}`;
    if (probedMoves.has(key)) continue;
    probedMoves.add(key);
    try {
      const response = await backendTransport({ ...profile, serverUrl }).fetch({ method: 'GET', path: '/v2/version', signal: AbortSignal.timeout(MOVE_PROBE_TIMEOUT_MS) });
      if (response.status !== 200) continue;
    } catch (error) {
      // Unreachable (still starting): try again on a later pass.
      if (error instanceof TypeError) probedMoves.delete(key);
      continue;
    }
    const credentials = {
      deviceSecret: profile.deviceSecret,
      encryptionProtocol: profile.encryptionProtocol,
      encryptionPublicKey: profile.encryptionPublicKey,
      transportVerified: profile.transportVerified,
    };
    session.updateBackendConnection(profile.id, { serverUrl, ...credentials });
    // Connects once the re-pointed profile is committed.
    session.onDevicePairingApproved(profile.id, credentials);
    window.todexDesktop.debug.log('info', 'container.profile.portFollowed', { name: container.name, profileId: profile.id, port: container.port });
    moved.push(profile.id);
    break;
  }
  return moved;
}

/**
 * Connects this app to `container`'s backend, pairing when needed: over the
 * shared socket (the request is approved through local-admin) when the
 * container shares one, else over its loopback port with `docker exec … pair
 * approve`. `repair` pairs again even when paired. Resolves the profile id.
 */
export async function connectContainer(session: ContainerSession, container: ContainerInfo, deviceName: string, options: { repair?: boolean; signal?: AbortSignal } = {}): Promise<string> {
  const { repair = false, signal } = options;
  const name = t('localBackend.containerProfileName', { name: container.name });
  if (container.ipcInstance) {
    try {
      return await ensureManagedConnection(session, { instance: container.ipcInstance, name, deviceName, repair, signal });
    } catch (error) {
      // rootless Docker, Podman and userns-remap map the UID: the socket refuses this user.
      if (signal?.aborted || (!container.port && !container.managed)) throw error;
      window.todexDesktop.debug.log('warn', 'container.connect.ipcFailed', { name: container.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  // A socket-only container whose socket is missing or refuses this user gets a host port.
  if (!container.port && container.managed) {
    container = await window.todexDesktop.container.enablePublish(container.name);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }
  // The profile of a container Desktop moved to another port follows it, still paired.
  if (!repair) {
    const [followed] = await followMovedPort(session, container);
    if (followed) return followed;
  }
  const serverUrl = containerTcpUrl(container);
  if (!serverUrl || !container.container) throw new Error(t('container.noEndpoint', { name: container.name }));
  const profile = session.backendConnections.find((item) => sameUrl(item.serverUrl, serverUrl))
    ?? session.addBackendConnection({ name, serverUrl });
  // The container's IPC profile from when it shared its socket pins the same
  // daemon (its home volume keeps the key) and keeps this one disabled: hand
  // the daemon over (the IPC profile takes it back once the socket returns).
  const staleIpc = session.backendConnections.find((item) => item.serverUrl === ipcServerUrl(container.ipcId) && !item.disabled);
  const loser = staleIpc ?? (profile.disabled ? daemonPeer(session.backendConnections, profile) : undefined);
  const paired = profile.transportVerified && Boolean(deviceIdentityFromSecret(profile.deviceSecret));
  if (!repair && paired) {
    if (loser) session.replaceBackendConnection(loser.id, profile.id);
    else session.connect(profile.id);
    return profile.id;
  }
  const dockerName = container.container;
  const credentials = await pairWithLocalApproval({
    serverUrl,
    deviceName,
    deviceSecret: profile.deviceSecret,
    approve: (request) => window.todexDesktop.localBackend.dockerApprove(dockerName, request.verificationCode),
    signal,
  });
  session.onDevicePairingApproved(profile.id, credentials);
  if (loser) session.replaceBackendConnection(loser.id, profile.id);
  return profile.id;
}

/** Resolves once `profileId`'s link is open; rejects after `timeoutMs`. */
export async function waitForLink(read: () => Pick<ContainerSession, 'backendLinkStatus'>, profileId: string, timeoutMs = 30_000, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (read().backendLinkStatus[profileId]?.state !== 'open') {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (Date.now() > deadline) throw new Error(t('container.connectTimeout'));
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

/** Whether a turn runs (or waits for permission) in a workspace of one of these profiles. */
export function backendBusy(session: Pick<ContainerSession, 'conversations' | 'workspaces'>, profileIds: string[]): boolean {
  const workspaceIds = new Set(session.workspaces.filter((workspace) => workspace.backendConnectionId && profileIds.includes(workspace.backendConnectionId)).map((workspace) => workspace.id));
  return session.conversations.some((conversation) => workspaceIds.has(conversation.workspaceId)
    && (conversation.nativeStatus === 'running' || conversation.nativeStatus === 'waiting_permission'));
}

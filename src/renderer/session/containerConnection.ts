import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { ipcServerUrl } from '@todex/protocol/ipcServerUrl';
import type { BackendConnectionProfile } from '@todex/protocol/todex';
import type { ContainerInfo } from '../../preload/containerTypes';
import { t } from '../i18n';
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
      if (signal?.aborted || !container.port) throw error;
      window.todexDesktop.debug.log('warn', 'container.connect.ipcFailed', { name: container.name, error: error instanceof Error ? error.message : String(error) });
    }
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

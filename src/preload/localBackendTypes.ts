/** Shapes of the `localBackend` bridge (main: src/main/localBackend). */

export type LocalSocketEvent =
  | { id: number; type: 'open' }
  | { id: number; type: 'message'; text?: string; binary?: Uint8Array }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'close'; code: number; reason: string };

export type PairingEncryption = 'none' | 'x25519' | 'ml-kem-768';

/** `GET /v2/local-admin/status` (TodeX_backend docs/API.md). */
export type LocalAdminStatus = {
  version: string;
  deployment: 'host' | 'container';
  dataDir: string;
  pid: number;
  startedAt: string;
  listen: { host: string; port: number };
  connectUrls: Array<{ url: string; interface: string | null }>;
  advertiseUrl: string | null;
  pairingLink: string;
  transportFingerprint: string;
  pairingEncryption: PairingEncryption;
  authEnabled: boolean;
  deviceCount: number;
  pendingPairingCount: number;
  api: { enabled: boolean; host: string; port: number; listening: string | null };
  workspaceRoots: string[];
  ipcPath: string;
  autoUpdate: boolean;
  configEditable: boolean;
};

export type LocalBackendConfigPatch = {
  host: string;
  port: number;
  pairingEncryption: PairingEncryption;
  workspaceRoots: string[];
  autoUpdate: boolean;
};
export type LocalBackendConfig = LocalBackendConfigPatch & { editable: boolean; restartRequired: boolean };

export type LocalPairingRequest = {
  requestId: string;
  verificationCode: string;
  deviceName: string;
  deviceId: string | null;
  expiresAt: number;
  peerAddress: string;
  transportFingerprint: string | null;
};

export type LocalPairedDevice = { deviceId: string; name: string; publicKey: string; pairedAt: number; lastSeenAt: number | null };

export type LocalDaemonStatus = {
  running: boolean;
  pid: number | null;
  host: string | null;
  port: number | null;
  startedAt: string | null;
  executable: string | null;
  ipcPath: string | null;
  outdated: boolean;
  apiListen: string | null;
};

/** Mirror of the main process's DiscoverResult (src/main/localBackend/index.ts). */
export type LocalBackendDiscovery = {
  desktopVersion: string;
  native: {
    dataDir: string;
    platformSupported: boolean;
    expectedVersion: string | null;
    binary: { path: string; version: string | null; managed: boolean } | null;
    managedVersions: string[];
    daemon: LocalDaemonStatus | null;
    /** Why `daemon status --format json` failed (a backend without IPC support), else null. */
    statusError: string | null;
    ipcPath: string | null;
    admin: LocalAdminStatus | null;
    adminError: string | null;
    autostart: boolean | null;
  };
  containers: Array<{
    id: string;
    name: string;
    socketPath: string | null;
    container: string | null;
    admin: LocalAdminStatus | null;
    adminError: string | null;
  }>;
};

/** A running TodeX container (`io.todex.instance` label); `ports` is `docker ps`'s Ports column. */
export type LocalDockerContainer = { container: string; instance: string; ports: string };

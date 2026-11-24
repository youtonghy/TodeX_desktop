import type { TodeXDesktopApi } from '../../preload/index';
import type { LocalAdminStatus, LocalBackendConfig, LocalBackendDiscovery } from '../../preload/localBackendTypes';

type LocalBackendBridge = TodeXDesktopApi['localBackend'];

const DATA_DIR = '/Users/demo/.todex-agent';
const IPC_PATH = `${DATA_DIR}/agentd.sock`;
const ROOTS = ['/Users/demo/code'];

const admin: LocalAdminStatus = {
  version: '0.0.0-demo',
  deployment: 'host',
  dataDir: DATA_DIR,
  pid: 4242,
  startedAt: '2026-01-01T00:00:00Z',
  listen: { host: '127.0.0.1', port: 7345 },
  networkEnabled: true,
  connectUrls: [],
  advertiseUrl: null,
  pairingLink: '',
  transportFingerprint: 'SHA256:demo-transport-fingerprint',
  pairingEncryption: 'ml-kem-768',
  authEnabled: true,
  deviceCount: 0,
  pendingPairingCount: 0,
  api: { enabled: false, host: '127.0.0.1', port: 7346, listening: null },
  workspaceRoots: ROOTS,
  ipcPath: IPC_PATH,
  autoUpdate: true,
  configEditable: true,
};

/**
 * `localBackend=1`: Settings › Local backend with a running macOS daemon
 * that can keep its host awake. Config changes stay in memory.
 */
export function demoLocalBackend(base: LocalBackendBridge): LocalBackendBridge {
  let config: LocalBackendConfig = {
    host: '127.0.0.1',
    port: 7345,
    networkEnabled: true,
    pairingEncryption: 'ml-kem-768',
    workspaceRoots: ROOTS,
    autoUpdate: true,
    keepAwake: true,
    keepAwakeSupported: true,
    editable: true,
    restartRequired: false,
  };
  const discovery: LocalBackendDiscovery = {
    desktopVersion: '0.0.0-demo',
    native: {
      dataDir: DATA_DIR,
      platformSupported: true,
      expectedVersion: '0.0.0-demo',
      binary: { path: '/Users/demo/.todex/bin/todex-agentd', version: '0.0.0-demo', managed: true },
      managedVersions: ['0.0.0-demo'],
      daemon: {
        running: true, pid: 4242, host: '127.0.0.1', port: 7345, networkEnabled: true, startedAt: null,
        executable: '/Users/demo/.todex/bin/todex-agentd', ipcPath: IPC_PATH, outdated: false, apiListen: null,
      },
      ipcSupported: true,
      statusError: null,
      ipcPath: IPC_PATH,
      admin,
      adminError: null,
      autostart: true,
    },
    containers: [],
  };
  return {
    ...base,
    available: true,
    discover: async () => structuredClone(discovery),
    nativeEndpoint: async () => ({ running: true, port: 7345, ipcPath: IPC_PATH }),
    setAutostart: async () => undefined,
    logTail: async () => '',
    status: async () => structuredClone(admin),
    getConfig: async () => structuredClone(config),
    setConfig: async (_instance, patch) => {
      config = { ...config, ...patch };
      return structuredClone(config);
    },
    pairingRequests: async () => [],
    devices: async () => [],
    onProgress: () => () => undefined,
  };
}

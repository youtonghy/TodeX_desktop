// Dev-only demo preview (`?demo`): runs the real app against an in-memory
// backend with fixture data, for design reviews without a todex-agentd.
// Plain browsers only, so it can never write into a real desktop store.
import type { TodeXDesktopApi } from '../../preload/index';
import { installBrowserDesktopBridge } from '../lib/browserDesktop';
import {
  ACTIVE_SELECTION_STORAGE_KEY,
  BACKEND_CONNECTIONS_STORAGE_KEY,
  CONVERSATIONS_STORAGE_KEY,
  DEVICE_SECRET_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  USAGE_RECORDS_STORAGE_KEY,
  WORKSPACES_STORAGE_KEY,
  conversationFromManifest,
  defaultSettings,
  overrideBackendTransport,
} from '../session/helpers';
import { setLocale } from '../i18n';
import {
  DEMO_OFFLINE_BACKEND_ID,
  DEMO_OFFLINE_SERVER_URL,
  DEMO_ROOT,
  DEMO_SECOND_SERVER_URL,
  DEMO_SERVER_URL,
  demoActiveConversationId,
  demoConversationRecord,
  demoJournals,
  demoOfflineWorkspaces,
  demoUsageRecords,
  demoWorkspaces,
} from './fixtures';
import { demoOfflineTransport, demoSecondTransport, demoTransport, installDemoFetch } from './transport';
import { DEMO_MESH_DEVICE_SECRET, DEMO_MESH_NAS_ID, demoMesh } from './mesh';
import { demoLocalBackend } from './localBackend';
import { MESH_GROUPS_STORAGE_KEY, meshDeviceSecretKey } from '../session/meshGroups';

export function installDemoMode(): boolean {
  if (window.todexDesktop) {
    console.warn('[demo] the demo preview only runs in a plain browser');
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const { deviceSecret: _deviceSecret, ...settings } = { ...defaultSettings, serverUrl: DEMO_SERVER_URL, defaultWorkspacePath: DEMO_ROOT };
  const store = new Map<string, unknown>([
    [SETTINGS_STORAGE_KEY, settings],
    [WORKSPACES_STORAGE_KEY, demoWorkspaces],
    [CONVERSATIONS_STORAGE_KEY, demoJournals.map((journal) => demoConversationRecord(journal, conversationFromManifest(journal.manifest, journal.manifest.workspaceId ?? demoWorkspaces[0].id)))],
    [ACTIVE_SELECTION_STORAGE_KEY, { workspaceId: demoWorkspaces[0].id, conversationId: demoActiveConversationId }],
    [USAGE_RECORDS_STORAGE_KEY, demoUsageRecords],
  ]);

  installBrowserDesktopBridge();
  // The early return above narrowed the global; the bridge now exists.
  const bridge = window.todexDesktop as TodeXDesktopApi;
  bridge.store = {
    get: async (key) => structuredClone(store.get(key) ?? null),
    set: async (key, value) => {
      store.set(key, structuredClone(value));
    },
  };
  // `backends=2`: a second backend, both paired, for screens that need two
  // (config sync). Off by default so every other screen keeps one backend.
  // `backends=offline`: a second backend that never connects, with cached
  // workspaces, for the sidebar's hidden offline workspaces.
  const backends = params.get('backends');
  if (backends === '2' || backends === 'offline') {
    const profile = (id: string, name: string, serverUrl: string, labelColor: string) => ({
      id, name, serverUrl, labelColor, tenantId: 'default', encryptionProtocol: 'none', encryptionPublicKey: '', transportVerified: false, createdAt: 0, updatedAt: 0,
    });
    store.set(BACKEND_CONNECTIONS_STORAGE_KEY, [
      profile('default-backend', 'MBP', DEMO_SERVER_URL, '#3b82f6'),
      backends === 'offline'
        ? profile(DEMO_OFFLINE_BACKEND_ID, 'G14', DEMO_OFFLINE_SERVER_URL, '#22c55e')
        : profile('demo-g14', 'G14', DEMO_SECOND_SERVER_URL, '#22c55e'),
    ]);
    if (backends === 'offline') store.set(WORKSPACES_STORAGE_KEY, [...demoWorkspaces, ...demoOfflineWorkspaces]);
    // Never a real key: the fixtures transport neither signs nor checks.
    bridge.secureStore = {
      get: async (key) => (key.startsWith(`${DEVICE_SECRET_STORAGE_KEY}.`) ? 'demo-device-secret' : null),
      set: async () => undefined,
      available: async () => true,
    };
  }
  // `mesh=1`: the demo backend is a node of a device group this device is
  // in, with a second device and a device asking to join. `mesh=local`: the
  // same group, with the demo backend reached over IPC as this computer's
  // backend; the group's link to it is the standby.
  // `mesh=leaving`: this device is leaving that group; the demo backend
  // confirmed the final roster, an offline NAS has not.
  // `mesh=duplicates`: `local`, with what older builds left behind: the IPC
  // profile under its own name, a second standby for the same node and a
  // swapped-out loopback profile. Each backend is listed once, by its group
  // name.
  const meshMode = params.get('mesh');
  if (meshMode === '1' || meshMode === 'local' || meshMode === 'leaving' || meshMode === 'duplicates') {
    const mesh = demoMesh(DEMO_SERVER_URL);
    const node = { groupId: mesh.group.groupId, nodeId: mesh.nodeId };
    const profile = { name: 'MBP', labelColor: '#3b82f6', tenantId: 'default', encryptionProtocol: 'none', encryptionPublicKey: '', transportVerified: false, createdAt: 0, updatedAt: 0 };
    store.set(BACKEND_CONNECTIONS_STORAGE_KEY, meshMode === 'duplicates' ? [
      { ...profile, id: 'default-backend', name: '本机', serverUrl: 'todex-ipc://local' },
      { ...profile, id: 'demo-mesh-standby', serverUrl: DEMO_SERVER_URL, disabled: true, mesh: node },
      { ...profile, id: 'demo-mesh-standby-copy', serverUrl: DEMO_SERVER_URL, disabled: true, mesh: node, createdAt: 1 },
      { ...profile, id: 'demo-legacy-loopback', serverUrl: 'http://127.0.0.1:7345', disabled: true },
    ] : meshMode === 'local' ? [
      { ...profile, id: 'default-backend', serverUrl: 'todex-ipc://local' },
      { ...profile, id: 'demo-mesh-standby', serverUrl: DEMO_SERVER_URL, disabled: true, mesh: node },
    ] : meshMode === 'leaving' ? [
      { ...profile, id: 'default-backend', serverUrl: DEMO_SERVER_URL, mesh: node },
      { ...profile, id: 'demo-mesh-nas', name: 'NAS', serverUrl: DEMO_OFFLINE_SERVER_URL, mesh: { groupId: mesh.group.groupId, nodeId: DEMO_MESH_NAS_ID } },
    ] : [{ ...profile, id: 'default-backend', serverUrl: DEMO_SERVER_URL, mesh: node }]);
    store.set(MESH_GROUPS_STORAGE_KEY, [meshMode === 'leaving'
      ? { ...mesh.group, leaving: { at: 0, othersCarry: false, nodeCount: 2, pendingNodes: [DEMO_MESH_NAS_ID], nodeNames: { [mesh.nodeId]: 'MBP', [DEMO_MESH_NAS_ID]: 'NAS' } } }
      : mesh.group]);
    bridge.secureStore = {
      get: async (key) => (key.startsWith(`${DEVICE_SECRET_STORAGE_KEY}.`) || key === meshDeviceSecretKey(mesh.group.groupId) ? DEMO_MESH_DEVICE_SECRET : null),
      set: async () => undefined,
      available: async () => true,
    };
  }
  // `localBackend=1`: Settings › Local backend with a running daemon.
  if (params.get('localBackend') === '1') bridge.localBackend = demoLocalBackend(bridge.localBackend);
  const theme = params.get('theme');
  if (theme === 'dark' || theme === 'light') {
    bridge.theme = { ...bridge.theme, shouldUseDark: async () => theme === 'dark', onUpdated: () => () => undefined };
  }
  if (!params.has('lang')) setLocale('zh-CN');

  overrideBackendTransport((serverUrl) => (serverUrl === DEMO_SECOND_SERVER_URL ? demoSecondTransport
    : serverUrl === DEMO_OFFLINE_SERVER_URL ? demoOfflineTransport : demoTransport));
  installDemoFetch();
  document.title = 'TodeX · 演示预览';
  return true;
}

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
  DEMO_ROOT,
  DEMO_SECOND_SERVER_URL,
  DEMO_SERVER_URL,
  demoActiveConversationId,
  demoJournals,
  demoUsageRecords,
  demoWorkspaces,
} from './fixtures';
import { demoSecondTransport, demoTransport, installDemoFetch } from './transport';

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
    [CONVERSATIONS_STORAGE_KEY, demoJournals.map((journal) => conversationFromManifest(journal.manifest, journal.manifest.workspaceId ?? demoWorkspaces[0].id))],
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
  if (params.get('backends') === '2') {
    const profile = (id: string, name: string, serverUrl: string, labelColor: string) => ({
      id, name, serverUrl, labelColor, tenantId: 'default', encryptionProtocol: 'none', encryptionPublicKey: '', transportVerified: false, createdAt: 0, updatedAt: 0,
    });
    store.set(BACKEND_CONNECTIONS_STORAGE_KEY, [
      profile('default-backend', 'MBP', DEMO_SERVER_URL, '#3b82f6'),
      profile('demo-g14', 'G14', DEMO_SECOND_SERVER_URL, '#22c55e'),
    ]);
    // Never a real key: the fixtures transport neither signs nor checks.
    bridge.secureStore = {
      get: async (key) => (key.startsWith(`${DEVICE_SECRET_STORAGE_KEY}.`) ? 'demo-device-secret' : null),
      set: async () => undefined,
      available: async () => true,
    };
  }
  const theme = params.get('theme');
  if (theme === 'dark' || theme === 'light') {
    bridge.theme = { ...bridge.theme, shouldUseDark: async () => theme === 'dark', onUpdated: () => () => undefined };
  }
  if (!params.has('lang')) setLocale('zh-CN');

  overrideBackendTransport((serverUrl) => (serverUrl === DEMO_SECOND_SERVER_URL ? demoSecondTransport : demoTransport));
  installDemoFetch();
  document.title = 'TodeX · 演示预览';
  return true;
}

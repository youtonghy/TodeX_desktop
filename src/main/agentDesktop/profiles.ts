import { credentialMatchesOrigin } from '@todex/protocol/connectionProbe';
import { normalizeServerUrl, type ConnectionSettings } from '@todex/protocol/todex';

/** Store keys written by the renderer (`session/helpers.ts`). */
export const SETTINGS_KEY = 'todex.desktop.settings.v1';
export const BACKEND_CONNECTIONS_KEY = 'todex.desktop.backendConnections.v1';
export const DEVICE_SECRET_KEY = 'todex.desktop.deviceSecret.v1';
export const DEVICE_ORIGIN_KEY = 'todex.desktop.deviceOrigin.v1';
/** This desktop may act as an agent tool executor. Default on. */
export const EXECUTOR_ENABLED_KEY = 'todex.desktop.agentDesktopExecutor.v1';

export type ExecutorProfile = {
  id: string;
  serverUrl: string;
  deviceSecret: string;
  encryptionProtocol: ConnectionSettings['encryptionProtocol'];
  encryptionPublicKey: string;
};

const string = (value: unknown): string => (typeof value === 'string' ? value : '');
const protocol = (value: unknown): ExecutorProfile['encryptionProtocol'] =>
  value === 'x25519' || value === 'ml-kem-768' ? value : 'none';

/** This Mac may run Computer Use. Default off. */
export const COMPUTER_ENABLED_KEY = 'todex.desktop.computerUse.v1';

export function isStoreKeyRelevant(key: string): boolean {
  return key === SETTINGS_KEY || key === BACKEND_CONNECTIONS_KEY || key === EXECUTOR_ENABLED_KEY || key === COMPUTER_ENABLED_KEY
    || key === DEVICE_ORIGIN_KEY || key === DEVICE_SECRET_KEY || key.startsWith(`${DEVICE_SECRET_KEY}.`);
}

/**
 * Paired backend profiles, resolved the way the renderer hydrates them:
 * per-profile secrets, with the legacy secret standing in for the default
 * profile only when it was issued for that origin. Unpaired profiles are
 * skipped: an executor connection needs a device identity.
 */
export function readExecutorProfiles(store: Record<string, unknown>, defaultServerUrl: string): ExecutorProfile[] {
  if (store[EXECUTOR_ENABLED_KEY] === false) return [];
  const settings = (store[SETTINGS_KEY] && typeof store[SETTINGS_KEY] === 'object' ? store[SETTINGS_KEY] : {}) as Record<string, unknown>;
  const settingsUrl = string(settings.serverUrl) || defaultServerUrl;
  const legacySecret = credentialMatchesOrigin(string(store[DEVICE_ORIGIN_KEY]), settingsUrl) ? string(store[DEVICE_SECRET_KEY]) : '';
  const stored = Array.isArray(store[BACKEND_CONNECTIONS_KEY]) ? store[BACKEND_CONNECTIONS_KEY] as unknown[] : [];
  const raw = stored.length ? stored : [{ id: 'default-backend', ...settings, serverUrl: settingsUrl }];
  const profiles: ExecutorProfile[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const id = string(entry.id).trim();
    const serverUrl = string(entry.serverUrl).trim();
    if (!id || !serverUrl) continue;
    const deviceSecret = string(store[`${DEVICE_SECRET_KEY}.${id}`]) || (id === 'default-backend' ? legacySecret : '');
    if (!deviceSecret) continue;
    profiles.push({
      id,
      serverUrl: normalizeServerUrl(serverUrl),
      deviceSecret,
      encryptionProtocol: protocol(entry.encryptionProtocol),
      encryptionPublicKey: string(entry.encryptionPublicKey),
    });
  }
  return profiles;
}

export function sameProfile(a: ExecutorProfile, b: ExecutorProfile): boolean {
  return a.serverUrl === b.serverUrl && a.deviceSecret === b.deviceSecret
    && a.encryptionProtocol === b.encryptionProtocol && a.encryptionPublicKey === b.encryptionPublicKey;
}

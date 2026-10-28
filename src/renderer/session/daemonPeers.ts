// Which profile serves a daemon another profile also reaches (its IPC
// connection, say). Shared by both clients; only the desktop disables profiles.
import { ipcServerUrl, isIpcServerUrl } from '@todex/protocol/ipcServerUrl';
import type { BackendConnectionProfile } from '@todex/protocol/todex';

/** The IPC instance of the backend the desktop runs on this machine. */
export const NATIVE_INSTANCE = 'local';

/** The enabled profile serving the daemon of disabled `profile`: the one
 * pinning the same transport key, else (for a TCP profile) the enabled
 * native IPC profile. */
export function daemonPeer(profiles: BackendConnectionProfile[], profile: BackendConnectionProfile): BackendConnectionProfile | undefined {
  const enabled = profiles.filter((item) => item.id !== profile.id && !item.disabled);
  const sameKey = profile.transportVerified && profile.encryptionPublicKey
    ? enabled.find((item) => item.transportVerified && item.encryptionPublicKey === profile.encryptionPublicKey)
    : undefined;
  if (sameKey || isIpcServerUrl(profile.serverUrl)) return sameKey;
  return enabled.find((item) => item.serverUrl === ipcServerUrl(NATIVE_INSTANCE));
}

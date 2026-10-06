// Device history keys (32-byte X-Wing seeds, one per backend profile) for
// end-to-end encrypted conversation history. The desktop seals them with the
// OS keychain through Electron safeStorage (main process `secureStore:*`).

import { decodeBase64UrlBytes, encodeBase64Url } from '@todex/protocol/transportCrypto';

const seedKey = (profileId: string) => `todex.desktop.historySeed.v1.${profileId}`;

export async function loadHistorySeed(profileId: string): Promise<Uint8Array | null> {
  const stored = await window.todexDesktop.secureStore.get(seedKey(profileId));
  if (!stored) return null;
  const seed = decodeBase64UrlBytes(stored);
  if (seed.length !== 32) throw new Error('历史记录密钥已损坏，请在设置中重新登记此设备');
  return seed;
}

export async function saveHistorySeed(profileId: string, seed: Uint8Array): Promise<void> {
  await window.todexDesktop.secureStore.set(seedKey(profileId), encodeBase64Url(seed));
}

export async function deleteHistorySeed(profileId: string): Promise<void> {
  await window.todexDesktop.secureStore.set(seedKey(profileId), null);
}

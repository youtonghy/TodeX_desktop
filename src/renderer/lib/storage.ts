export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await window.todexDesktop.store.get(key);
    if (value === null || value === undefined) {
      return fallback;
    }
    return value as T;
  } catch {
    return fallback;
  }
}

export async function saveJson<T>(key: string, value: T): Promise<void> {
  await window.todexDesktop.store.set(key, value);
}

// Device secrets (Ed25519 seeds) and their bound origins are sealed by the OS
// keychain through the main process `secureStore:*` (Electron safeStorage),
// like the history keys. Older builds kept them as plaintext in the JSON
// store; reading migrates them and removes the plaintext.

/** Last value known to be in the secure store per key, so the settings
 * effects that persist on every change skip identical keychain writes. */
const persistedSecrets = new Map<string, string>();

/** Keys whose secure read failed this session. Their stored value is unknown,
 * so an empty value from the settings effects must not be taken as "delete":
 * a transient keychain failure would otherwise erase the device key for good.
 * A later successful read, a non-empty save, or `removeSecret` clears this. */
const unreadableSecrets = new Set<string>();

async function readLegacySecret(key: string): Promise<string> {
  const value = await window.todexDesktop.store.get(key);
  return typeof value === 'string' ? value : '';
}

export async function loadSecret(key: string): Promise<string> {
  let sealed: string | null;
  try {
    sealed = await window.todexDesktop.secureStore.get(key);
  } catch (error) {
    unreadableSecrets.add(key);
    // Keychain unavailable or the sealed value unreadable: a plaintext copy
    // from an older build still works; without one the failure is the caller's.
    const legacy = await readLegacySecret(key);
    if (!legacy) throw error;
    console.error(`[storage] secure read of ${key} failed; using the unmigrated plaintext copy`, error);
    return legacy;
  }
  unreadableSecrets.delete(key);
  const legacy = await readLegacySecret(key);
  if (sealed !== null) {
    if (legacy) await window.todexDesktop.store.set(key, undefined);
    persistedSecrets.set(key, sealed);
    return sealed;
  }
  if (!legacy) {
    persistedSecrets.set(key, '');
    return '';
  }
  try {
    await window.todexDesktop.secureStore.set(key, legacy);
  } catch (error) {
    // Keep the plaintext so the device key is not lost; migration retries on
    // the next launch.
    console.error(`[storage] could not move ${key} into the secure store; plaintext kept`, error);
    return legacy;
  }
  await window.todexDesktop.store.set(key, undefined);
  persistedSecrets.set(key, legacy);
  return legacy;
}

/** Seals `value` in the OS keychain (an empty value deletes it, unless the
 * key could not be read this session; use `removeSecret` to delete then).
 * Rejects when the keychain is unavailable; nothing is written in plaintext. */
export async function saveSecret(key: string, value: string): Promise<void> {
  if (!value && unreadableSecrets.has(key)) return;
  await writeSecret(key, value);
}

/** Deletes `key` for an explicit user action (removing a backend), even when
 * its current value could not be read. */
export async function removeSecret(key: string): Promise<void> {
  persistedSecrets.delete(key);
  await writeSecret(key, '');
}

async function writeSecret(key: string, value: string): Promise<void> {
  if (persistedSecrets.get(key) === value) return;
  await window.todexDesktop.secureStore.set(key, value || null);
  unreadableSecrets.delete(key);
  persistedSecrets.set(key, value);
  // Drop a plaintext copy an interrupted migration may have left behind.
  await window.todexDesktop.store.set(key, undefined);
}

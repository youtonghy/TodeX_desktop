import type { ProviderQuotaSnapshot } from '@todex/protocol/v2';

// Last plan limits each backend reported, kept for an hour so the home page
// shows them at once while it asks the backend again.

type Quotas = Record<string, ProviderQuotaSnapshot>;
type Entry = { savedAt: number; providers: Quotas };

const STORAGE_KEY = 'todex.providerQuotas.v1';
/** How long a cached answer is shown before the fresh one arrives. */
export const PROVIDER_QUOTA_CACHE_MS = 60 * 60_000;

function readAll(): Record<string, Entry> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, Entry> : {};
  } catch {
    return {};
  }
}

/** The backend's cached plan limits, or undefined if none are under an hour old. */
export function readCachedProviderQuotas(serverUrl: string, now = Date.now()): Quotas | undefined {
  const entry = readAll()[serverUrl];
  if (!entry || typeof entry.savedAt !== 'number' || !entry.providers || typeof entry.providers !== 'object') return undefined;
  const age = now - entry.savedAt;
  return age >= 0 && age < PROVIDER_QUOTA_CACHE_MS ? entry.providers : undefined;
}

/** Stores a backend's plan limits and drops entries past the cache age. */
export function writeCachedProviderQuotas(serverUrl: string, providers: Quotas, now = Date.now()): void {
  const kept = Object.fromEntries(Object.entries(readAll())
    .filter(([, entry]) => typeof entry?.savedAt === 'number' && now - entry.savedAt < PROVIDER_QUOTA_CACHE_MS));
  kept[serverUrl] = { savedAt: now, providers };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch (error) {
    // A full or unavailable storage only costs the instant display next time.
    console.warn('[todex] could not cache plan limits', error);
  }
}

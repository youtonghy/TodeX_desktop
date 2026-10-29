import type { HistoryCacheStore, HistoryTailMeta, StoredHistoryTail, StoredHistoryWrap } from '../session/historyCache';
import type { HistoryWrappedKeyJson } from '@todex/protocol/historyCrypto';

// IndexedDB backing of the history cache (session/historyCache.ts). Keys
// start with the backend id and a NUL, so a backend's records are one key
// range; tails and their metadata share a key.

const DB_NAME = 'todex-history-cache';
const DB_VERSION = 1;
const TAILS = 'tails';
const META = 'tailMeta';
const WRAPS = 'wraps';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

const backendRange = (backendId: string) => IDBKeyRange.bound(`${backendId}\u0000`, `${backendId}\u0000\uffff`);

export function createIndexedDbHistoryCacheStore(factory?: IDBFactory): HistoryCacheStore {
  let opening: Promise<IDBDatabase> | null = null;
  const db = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = (factory ?? indexedDB).open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const database = open.result;
        for (const name of [TAILS, META, WRAPS]) {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'key' });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('IndexedDB open failed'));
    }).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  };
  const transaction = async (stores: string[], mode: IDBTransactionMode) => (await db()).transaction(stores, mode);

  return {
    async getTail(key) {
      const tx = await transaction([TAILS], 'readonly');
      return (await request(tx.objectStore(TAILS).get(key))) as StoredHistoryTail | undefined;
    },
    async putTail(tail, meta) {
      const tx = await transaction([TAILS, META], 'readwrite');
      tx.objectStore(TAILS).put(tail);
      tx.objectStore(META).put(meta);
      await done(tx);
    },
    async putTailMeta(meta) {
      const tx = await transaction([META], 'readwrite');
      tx.objectStore(META).put(meta);
      await done(tx);
    },
    async listTailMeta() {
      const tx = await transaction([META], 'readonly');
      return (await request(tx.objectStore(META).getAll())) as HistoryTailMeta[];
    },
    async deleteTails(keys) {
      if (!keys.length) return;
      const tx = await transaction([TAILS, META], 'readwrite');
      for (const key of keys) {
        tx.objectStore(TAILS).delete(key);
        tx.objectStore(META).delete(key);
      }
      await done(tx);
    },
    async getWraps(keys) {
      const tx = await transaction([WRAPS], 'readonly');
      const store = tx.objectStore(WRAPS);
      const found = await Promise.all(keys.map((key) => request(store.get(key)) as Promise<StoredHistoryWrap | undefined>));
      const result: Record<string, HistoryWrappedKeyJson> = {};
      for (const entry of found) if (entry) result[entry.key] = entry.wrap;
      return result;
    },
    async putWraps(entries) {
      if (!entries.length) return;
      const tx = await transaction([WRAPS], 'readwrite');
      for (const entry of entries) tx.objectStore(WRAPS).put(entry);
      await done(tx);
    },
    async deleteWraps(keys) {
      if (!keys.length) return;
      const tx = await transaction([WRAPS], 'readwrite');
      for (const key of keys) tx.objectStore(WRAPS).delete(key);
      await done(tx);
    },
    async listWrapKeys(backendId) {
      const tx = await transaction([WRAPS], 'readonly');
      return (await request(tx.objectStore(WRAPS).getAllKeys(backendRange(backendId)))).map(String);
    },
    async deleteBackend(backendId) {
      const tx = await transaction([TAILS, META, WRAPS], 'readwrite');
      for (const name of [TAILS, META, WRAPS]) tx.objectStore(name).delete(backendRange(backendId));
      await done(tx);
    },
    async clear() {
      const tx = await transaction([TAILS, META, WRAPS], 'readwrite');
      for (const name of [TAILS, META, WRAPS]) tx.objectStore(name).clear();
      await done(tx);
    },
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HISTORY_ACCESS_REVOKED,
  HISTORY_CLIENT_UPGRADE_REQUIRED,
  HISTORY_KEY_REQUIRED,
  HISTORY_READ_ONLY,
  HISTORY_STORAGE_LOW,
  HistoryDecryptor,
  historyCommands,
  historyEventsNeedDecryption,
  historyUpdateReaction,
  historyWrapsFetcher,
  isHistoryEncryptedPayload,
  parseFrames,
  parseHistoryEncryptionState,
  parseHistoryEncryptionUpdate,
  rewrapHistoryKeys,
  type HistoryCommandFrame,
  type HistoryDetail,
  type HistoryEncryptionState,
  type HistoryGrant,
  type HistoryRewrapProgress,
  type HistoryWireEvent,
  type HistoryWirePage,
} from '@todex/protocol/historyEncryption';
import { generateHistoryRecipientKeyPair, historyRecipientId, historyRecipientKeyPairFromSeed } from '@todex/protocol/historyCrypto';
import { parseRecoveryKey, recoveryQrPayload, recoveryWordsFromSeed } from '@todex/protocol/recoveryKey';
import { createRequestId } from '@todex/protocol/todex';
import { ProtocolCommandError } from './protocolCommands';
import { decodeBase64UrlBytes, encodeBase64Url } from '@todex/protocol/transportCrypto';
import type { ConversationManifest } from '@todex/protocol/v2';
import { t } from '../i18n';
import { deleteHistorySeed, loadHistorySeed, saveHistorySeed } from '../lib/historyKeyStore';
import { historyTailCache } from './historyCache';

// End-to-end encrypted conversation history (TodeX_backend
// docs/history-encryption.md) for every connected backend. History is always
// encrypted: this device's history key is created and registered on every
// (re)connect of each backend, every history path is decrypted before
// projection, and the settings actions cover the recovery key, grants and
// restoring revoked devices. State changes are pushed
// (`history.encryption.updated`); the state is also re-read on every
// (re)connect and when settings open.

type CommandSender = (backendId: string, message: { id: string; type: string; payload: Record<string, unknown> }, timeoutMs?: number) => Promise<Record<string, unknown>>;

/** Connection facts of one backend the history hook depends on. */
export type HistoryBackendLink = {
  /** The verified socket of this backend is open. */
  connected: boolean;
  /** `/v2/version` reports `historyEncryption: 1`; `undefined` until known. */
  supported: boolean | undefined;
};

export type HistoryEncryptionView = {
  backendId: string;
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  state?: HistoryEncryptionState;
  /** This device's recipient id, once its key exists. */
  localRid?: string;
  /** Why the backend's encryption state could not be read. */
  error?: string;
  /** Why this device's history key could not be loaded or created. */
  keyError?: string;
  /** This device was revoked (`myAccess`, or a command failed with
   * HISTORY_ACCESS_REVOKED): no registration and no history actions until
   * another device restores it. */
  accessRevoked?: boolean;
};

export type HistoryGrantRun = { running: boolean; progress: HistoryRewrapProgress; error?: string };

export type RecoveryKeyDraft = { seed: Uint8Array; words: string[]; qrPayload: string };

/** Readable text for the error codes history encryption introduces. */
export function historyErrorMessage(code: string): string | null {
  if (code === HISTORY_CLIENT_UPGRADE_REQUIRED) return t('history.clientUpgradeRequired');
  if (code === HISTORY_STORAGE_LOW) return t('history.storageLow');
  if (code === HISTORY_ACCESS_REVOKED) return t('history.accessRevoked');
  if (code === HISTORY_READ_ONLY) return t('history.readOnlyError');
  if (code === HISTORY_KEY_REQUIRED) return t('history.keyRequired');
  return null;
}

/** Backends whose "no recovery key" notice the user dismissed. */
const RECOVERY_NOTICE_STORAGE_KEY = 'todex.history.recoveryNoticeDismissed.v1';

function readDismissedRecoveryNotices(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECOVERY_NOTICE_STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissedRecoveryNotices(backendIds: readonly string[]): void {
  try {
    localStorage.setItem(RECOVERY_NOTICE_STORAGE_KEY, JSON.stringify(backendIds));
  } catch {
    // Storage may be disabled: the notice then only stays hidden this session.
  }
}

const isAccessRevoked = (error: unknown) => error instanceof ProtocolCommandError && error.code === HISTORY_ACCESS_REVOKED;

const ridOf = (publicKey: Uint8Array) => encodeBase64Url(historyRecipientId(publicKey));
/** keys.wraps calls in flight while decrypting manifest titles. */
const TITLE_CONCURRENCY = 4;
/** Pushed updates arrive in bursts (one per grant batch): they are folded
 * into one state read and one unlock. */
const UPDATE_DEBOUNCE_MS = 300;
/** How long a history command waits for a connecting socket. */
const CONNECT_WAIT_MS = 15_000;

export function useHistoryEncryption({ backends, focusBackendId, sendCommand, onUnlocked }: {
  backends: Readonly<Record<string, HistoryBackendLink>>;
  /** The backend the visible conversation belongs to: notices follow it. */
  focusBackendId: string;
  sendCommand: CommandSender;
  /** Keys arrived (grant, recovery import): locked rows of these
   * conversations (all when omitted) may now open. */
  onUnlocked: (conversationIds?: readonly string[]) => void;
}) {
  const [views, setViews] = useState<Record<string, HistoryEncryptionView>>({});
  const [grantRuns, setGrantRuns] = useState<Record<string, HistoryGrantRun>>({});
  const [titleRevision, setTitleRevision] = useState(0);
  const [dismissedRecoveryNotices, setDismissedRecoveryNotices] = useState(readDismissedRecoveryNotices);
  const grantRunsRef = useRef(grantRuns);
  grantRunsRef.current = grantRuns;
  const live = useRef({ backends, sendCommand, onUnlocked, views });
  live.current = { backends, sendCommand, onUnlocked, views };
  const decryptors = useRef(new Map<string, { decryptor: HistoryDecryptor; ready: Promise<void> }>());
  const liveChains = useRef(new Map<string, Promise<void>>());
  const titles = useRef(new Map<string, string | null>());
  const grantControllers = useRef(new Map<string, AbortController>());
  /** Backends that revoked this device. */
  const revokedBackends = useRef(new Set<string>());

  const setView = useCallback((backendId: string, update: (previous: HistoryEncryptionView) => HistoryEncryptionView) => {
    setViews((current) => {
      const previous = current[backendId] ?? { backendId, status: 'idle' };
      const next = update(previous);
      return next === previous ? current : { ...current, [backendId]: next };
    });
  }, []);

  /** A revoked device keeps no unwrapped keys, fetches no wraps and keeps no
   * cached history: its encrypted rows project locked. */
  const markRevoked = useCallback((backendId: string, revoked: boolean) => {
    if (!revoked) { revokedBackends.current.delete(backendId); return; }
    if (revokedBackends.current.has(backendId)) return;
    revokedBackends.current.add(backendId);
    void historyTailCache?.forgetBackend(backendId);
    decryptors.current.get(backendId)?.decryptor.clear();
    decryptors.current.delete(backendId);
    titles.current.clear();
    setView(backendId, (previous) => ({ ...previous, accessRevoked: true }));
  }, [setView]);

  /** Resolved when the backend's verified socket opens; history pages
   * fetched over HTTP can need wraps while it is still connecting. */
  const connectedWaiters = useRef(new Map<string, Set<() => void>>());
  useEffect(() => {
    for (const [backendId, waiters] of connectedWaiters.current) {
      if (!backends[backendId]?.connected) continue;
      for (const resolve of waiters) resolve();
      connectedWaiters.current.delete(backendId);
    }
  }, [backends]);

  const waitForConnected = useCallback(async (backendId: string) => {
    if (live.current.backends[backendId]?.connected) return true;
    let resolve = () => {};
    const opened = new Promise<boolean>((done) => { resolve = () => done(true); });
    let waiters = connectedWaiters.current.get(backendId);
    if (!waiters) {
      waiters = new Set();
      connectedWaiters.current.set(backendId, waiters);
    }
    waiters.add(resolve);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((done) => { timer = setTimeout(() => done(false), CONNECT_WAIT_MS); });
    try {
      return await Promise.race([opened, timedOut]);
    } finally {
      clearTimeout(timer);
      connectedWaiters.current.get(backendId)?.delete(resolve);
    }
  }, []);

  /** History commands travel over the owning backend's own socket. */
  const send = useCallback(async (backendId: string, frame: HistoryCommandFrame) => {
    if (!await waitForConnected(backendId)) throw new Error(t('history.notConnected'));
    try {
      return await live.current.sendCommand(backendId, { id: createRequestId('history'), ...frame }, 30_000);
    } catch (error) {
      if (isAccessRevoked(error)) markRevoked(backendId, true);
      throw error;
    }
  }, [markRevoked, waitForConnected]);

  const decryptorFor = useCallback((backendId: string) => {
    let entry = decryptors.current.get(backendId);
    if (!entry) {
      const fetchFromBackend = historyWrapsFetcher((frame) => send(backendId, frame));
      // Wraps are addressed to this device's key, so the cache may keep them.
      const fetchWraps = historyTailCache?.wrapsFetcher(backendId, fetchFromBackend) ?? fetchFromBackend;
      const decryptor = new HistoryDecryptor({
        fetchWraps: async (request) => {
          if (revokedBackends.current.has(backendId)) return {};
          try {
            return await fetchWraps(request);
          } catch (error) {
            if (isAccessRevoked(error)) return {};
            throw error;
          }
        },
      });
      // A missing or unreadable key leaves the decryptor seedless: encrypted
      // events then project as locked and the settings panel shows why.
      const ready = loadHistorySeed(backendId).then((seed) => {
        if (!seed) return;
        decryptor.setSeeds([seed]);
        seed.fill(0);
      }, () => undefined);
      entry = { decryptor, ready };
      decryptors.current.set(backendId, entry);
    }
    return entry;
  }, [send]);

  /** Decrypts a history page before projection; pages without ciphertext
   * pass through untouched. */
  const decryptPage = useCallback(async <P extends HistoryWirePage>(backendId: string, conversationId: string, page: P, detail: HistoryDetail): Promise<P> => {
    if (!historyEventsNeedDecryption(page.events)) {
      if (page.frames === undefined) return page;
      const { frames: _frames, ...rest } = page;
      return rest as P;
    }
    const { decryptor, ready } = decryptorFor(backendId);
    await ready;
    return decryptor.decryptPage(page, detail, conversationId);
  }, [decryptorFor]);

  /** Live and backfilled socket events, decrypted in arrival order per
   * conversation. Plaintext and warm-cache events deliver synchronously. */
  const receiveSocketEvent = useCallback((backendId: string, conversationId: string, event: HistoryWireEvent, frames: unknown,
    detail: HistoryDetail, deliver: (event: HistoryWireEvent) => void, onError: (message: string) => void) => {
    const chainKey = `${backendId}\0${conversationId}`;
    const pending = liveChains.current.get(chainKey);
    const encrypted = isHistoryEncryptedPayload(event.payload);
    const parsedFrames = encrypted ? parseFrames(frames) : {};
    if (!pending) {
      if (!encrypted) { deliver(event); return; }
      const opened = decryptors.current.get(backendId)?.decryptor.tryDecryptEvents([event], { frames: parsedFrames, detail, conversationId });
      if (opened) { deliver(opened[0]); return; }
    }
    const next: Promise<void> = (pending ?? Promise.resolve()).then(async () => {
      if (!encrypted) { deliver(event); return; }
      const { decryptor, ready } = decryptorFor(backendId);
      await ready;
      const [opened] = await decryptor.decryptEvents([event], { frames: parsedFrames, detail, conversationId });
      deliver(opened);
    }).catch((error: unknown) => {
      // Not delivered: the sequence gap makes the runtime replay it from the
      // journal once wraps can be fetched again.
      onError(error instanceof Error ? error.message : t('history.decryptFailed'));
    }).finally(() => {
      if (liveChains.current.get(chainKey) === next) liveChains.current.delete(chainKey);
    });
    liveChains.current.set(chainKey, next);
  }, [decryptorFor]);

  const titleKey = (backendId: string, manifest: ConversationManifest) => `${backendId}\0${manifest.id}\0${manifest.titleEnc?.kid}\0${manifest.titleEnc?.ct}`;

  /** Fills `title` of manifests whose title is encrypted (§3.2) from titles
   * this device already decrypted; the rest keep an empty title. */
  const withDecryptedTitles = useCallback((backendId: string, manifests: ConversationManifest[]): ConversationManifest[] => manifests.map((manifest) => {
    if (!manifest.titleEnc || manifest.title) return manifest;
    const title = titles.current.get(titleKey(backendId, manifest));
    return title ? { ...manifest, title } : manifest;
  }), []);

  /** Decrypts the encrypted titles not tried yet; `titleRevision` bumps when
   * new ones became readable so lists re-merge. */
  const decryptManifestTitles = useCallback(async (backendId: string, manifests: ConversationManifest[]): Promise<void> => {
    const todo = manifests.filter((manifest) => manifest.titleEnc && !manifest.title && !titles.current.has(titleKey(backendId, manifest)));
    if (!todo.length || !live.current.backends[backendId]?.connected) return;
    const { decryptor, ready } = decryptorFor(backendId);
    await ready;
    let decrypted = 0;
    for (let offset = 0; offset < todo.length; offset += TITLE_CONCURRENCY) {
      await Promise.all(todo.slice(offset, offset + TITLE_CONCURRENCY).map(async (manifest) => {
        try {
          const title = await decryptor.decryptTitle(manifest.id, manifest.titleEnc);
          titles.current.set(titleKey(backendId, manifest), title);
          if (title) decrypted++;
        } catch {
          // Transport failure: the next manifest refresh asks again.
        }
      }));
    }
    if (decrypted) setTitleRevision((value) => value + 1);
  }, [decryptorFor]);

  /** Records a title this device just set, so the manifest carrying its
   * new ciphertext shows it right away (and on every later list refresh). */
  const rememberTitle = useCallback((backendId: string, manifest: ConversationManifest, title: string) => {
    if (manifest.titleEnc && title) titles.current.set(titleKey(backendId, manifest), title);
  }, []);

  /** Fills the title of one fetched manifest (a fork, a materialized draft,
   * an Agent Calling child), decrypting it when needed. Resolves the
   * manifest unchanged when the title cannot be read. */
  const withDecryptedTitle = useCallback(async (backendId: string, manifest: ConversationManifest): Promise<ConversationManifest> => {
    if (!manifest.titleEnc || manifest.title) return manifest;
    const key = titleKey(backendId, manifest);
    let title = titles.current.get(key);
    if (title === undefined) {
      if (!live.current.backends[backendId]?.connected) return manifest;
      try {
        const { decryptor, ready } = decryptorFor(backendId);
        await ready;
        title = await decryptor.decryptTitle(manifest.id, manifest.titleEnc);
        titles.current.set(key, title);
      } catch {
        return manifest;
      }
    }
    return title ? { ...manifest, title } : manifest;
  }, [decryptorFor]);

  /** Reads the backend state and, when `register`, makes sure this device's
   * history key exists and is registered (§3.3). */
  const readState = useCallback(async (backendId: string, register = false) => {
    const link = live.current.backends[backendId];
    // Nothing to ask before the socket is up; an old backend never is asked.
    if (!link?.connected || link.supported === undefined) return;
    if (!link.supported) {
      setView(backendId, () => ({ backendId, status: 'unavailable' }));
      return;
    }
    setView(backendId, (previous) => ({ ...previous, status: 'loading' }));
    let state: HistoryEncryptionState;
    try {
      state = parseHistoryEncryptionState(await send(backendId, historyCommands.get()));
    } catch (error) {
      setView(backendId, () => ({ backendId, status: 'unavailable', error: error instanceof Error ? error.message : t('history.stateFailed') }));
      return;
    }
    let localRid: string | undefined;
    let keyError: string | undefined;
    // A revoked device never registers (nor re-keys) until it is restored.
    let revoked = state.myAccess === 'revoked';
    markRevoked(backendId, revoked);
    try {
      let seed = await loadHistorySeed(backendId);
      if (!seed && register && !revoked) {
        seed = generateHistoryRecipientKeyPair().secretKey;
        await saveHistorySeed(backendId, seed);
      }
      if (seed) {
        const { publicKey } = historyRecipientKeyPairFromSeed(seed);
        localRid = ridOf(publicKey);
        const { decryptor, ready } = decryptorFor(backendId);
        await ready;
        const previousRid = decryptor.recipientIds[0];
        if (previousRid !== localRid) {
          decryptor.setSeeds([seed]);
          // History cached for another key of this device is not kept.
          if (previousRid) void historyTailCache?.forgetBackend(backendId);
        }
        decryptor.forgetMissing();
        seed.fill(0);
        if (register && !revoked && state.myRid !== localRid) {
          try {
            await send(backendId, historyCommands.register(publicKey));
          } catch (error) {
            // A revoked key can never be registered again (CONFLICT): this
            // device continues with a fresh key, which needs a new grant
            // (or the recovery key) for history wrapped before.
            if (!(error instanceof ProtocolCommandError && error.code === 'CONFLICT')) throw error;
            const fresh = generateHistoryRecipientKeyPair();
            await saveHistorySeed(backendId, fresh.secretKey);
            decryptor.setSeeds([fresh.secretKey]);
            fresh.secretKey.fill(0);
            void historyTailCache?.forgetBackend(backendId);
            localRid = ridOf(fresh.publicKey);
            await send(backendId, historyCommands.register(fresh.publicKey));
          }
          state = parseHistoryEncryptionState(await send(backendId, historyCommands.get()));
        }
      }
    } catch (error) {
      if (isAccessRevoked(error)) revoked = true;
      else keyError = error instanceof Error ? error.message : t('history.keyFailed');
    }
    setView(backendId, () => ({ backendId, status: 'ready', state, localRid, keyError, accessRevoked: revoked }));
  }, [decryptorFor, markRevoked, send, setView]);

  // Registration runs once at a time per backend: two overlapping runs could
  // each create a key for a fresh profile, and the second would replace the
  // first the backend already wrapped history for.
  const registering = useRef(new Map<string, Promise<void>>());
  const refresh = useCallback((backendId: string, register = false): Promise<void> => {
    if (!register) return readState(backendId, false);
    const running = registering.current.get(backendId);
    if (running) return running;
    const run = readState(backendId, true).finally(() => { registering.current.delete(backendId); });
    registering.current.set(backendId, run);
    return run;
  }, [readState]);

  // Register on every (re)connect of each backend: history is always
  // encrypted, so a write needs this device's key among the recipients.
  // Backend → the `supported` value it was registered with; a socket that
  // learns support later (the version read lags the probe) registers again.
  const registeredLinks = useRef(new Map<string, boolean>());
  useEffect(() => {
    for (const [backendId, link] of Object.entries(backends)) {
      const ready = link.connected && link.supported !== undefined;
      if (!ready) {
        registeredLinks.current.delete(backendId);
        continue;
      }
      if (registeredLinks.current.get(backendId) === link.supported) continue;
      registeredLinks.current.set(backendId, link.supported!);
      void refresh(backendId, true);
    }
    for (const backendId of [...registeredLinks.current.keys()]) {
      if (!backends[backendId]) registeredLinks.current.delete(backendId);
    }
  }, [backends, refresh]);

  /** A write failed with HISTORY_KEY_REQUIRED: registers this device's key
   * with that backend again (joining a registration already running). */
  const keyRequired = useCallback((backendId: string) => refresh(backendId, true), [refresh]);

  /** Runs a settings action that answers with the encryption state. */
  const applyState = useCallback(async (backendId: string, frame: HistoryCommandFrame) => {
    const state = parseHistoryEncryptionState(await send(backendId, frame));
    if (state.myAccess) markRevoked(backendId, state.myAccess === 'revoked');
    setView(backendId, (previous) => ({ ...previous, status: 'ready', state, ...(state.myAccess ? { accessRevoked: state.myAccess === 'revoked' } : {}) }));
    return state;
  }, [markRevoked, send, setView]);

  const ownSeed = useCallback(async (backendId: string) => {
    const seed = await loadHistorySeed(backendId);
    if (!seed) throw new Error(t('history.deviceKeyMissing'));
    return seed;
  }, []);

  const unlocked = useCallback((conversationIds?: readonly string[]) => {
    for (const { decryptor } of decryptors.current.values()) decryptor.forgetMissing();
    titles.current.clear();
    live.current.onUnlocked(conversationIds);
  }, []);

  // Pushed `history.encryption.updated` frames: every one re-reads the state
  // (registering once a revoked device is restored); wraps that arrived for
  // this device unlock the conversations they cover.
  const waitingGrants = useRef(new Map<string, Set<string>>());
  const pendingUpdates = useRef(new Map<string, { unlock: Set<string> | 'all' | null; timer: ReturnType<typeof setTimeout> }>());
  const flushUpdate = useCallback((backendId: string) => {
    const pending = pendingUpdates.current.get(backendId);
    pendingUpdates.current.delete(backendId);
    if (!pending || !live.current.backends[backendId]) return;
    if (pending.unlock) unlocked(pending.unlock === 'all' ? undefined : [...pending.unlock]);
    void refresh(backendId, true);
  }, [refresh, unlocked]);
  const receiveUpdate = useCallback((backendId: string, payload: unknown) => {
    if (!live.current.backends[backendId]) return;
    const update = parseHistoryEncryptionUpdate(payload);
    if (!update) return;
    const localRids = [live.current.views[backendId]?.localRid, ...(decryptors.current.get(backendId)?.decryptor.recipientIds ?? [])];
    const { unlock } = historyUpdateReaction(update, localRids);
    // Unlocked here already; the state read must not unlock it again.
    if (unlock && update.reason === 'grant.fulfilled' && update.grantId) waitingGrants.current.get(backendId)?.delete(update.grantId);
    const pending = pendingUpdates.current.get(backendId);
    const merged = !unlock ? pending?.unlock ?? null
      : unlock === 'all' || pending?.unlock === 'all' ? 'all'
      : new Set([...(pending?.unlock ?? []), ...unlock]);
    if (pending) clearTimeout(pending.timer);
    pendingUpdates.current.set(backendId, { unlock: merged, timer: setTimeout(() => flushUpdate(backendId), UPDATE_DEBOUNCE_MS) });
  }, [flushUpdate]);
  useEffect(() => () => {
    for (const pending of pendingUpdates.current.values()) clearTimeout(pending.timer);
    pendingUpdates.current.clear();
  }, []);

  // A grant this device waited for shows up fulfilled in a state read (an
  // update missed while disconnected): rows locked so far may open.
  useEffect(() => {
    let fulfilled = false;
    for (const [backendId, view] of Object.entries(views)) {
      const state = view.state;
      if (!state || !view.localRid) continue;
      const waiting = waitingGrants.current.get(backendId);
      if (waiting && state.grants.some((grant) => grant.status === 'fulfilled' && waiting.has(grant.grantId))) fulfilled = true;
      waitingGrants.current.set(backendId, new Set(state.grants
        .filter((grant) => grant.status === 'pending' && grant.rid === view.localRid)
        .map((grant) => grant.grantId)));
    }
    if (fulfilled) unlocked();
  }, [unlocked, views]);

  /** Settings actions of one backend; stable per backend id so panels can
   * depend on them. */
  const actionsByBackend = useRef(new Map<string, ReturnType<typeof createActions>>());
  const createActions = (backendId: string) => ({
    refresh: () => refresh(backendId, false),
    revoke: (rid: string) => applyState(backendId, historyCommands.revoke(rid)),
    /** Lifts another device's revocation; it registers a fresh key and
     * needs a new grant for older history. */
    restoreDevice: (deviceId: string) => applyState(backendId, historyCommands.restoreDevice(deviceId)),
    /** A fresh recovery key, shown to the user before anything is uploaded. */
    createRecoveryDraft: (): RecoveryKeyDraft => {
      const { secretKey } = generateHistoryRecipientKeyPair();
      return { seed: secretKey, words: recoveryWordsFromSeed(secretKey), qrPayload: recoveryQrPayload(secretKey) };
    },
    /** Uploads only the recovery public key; the seed is zeroed here. */
    confirmRecoveryKey: async (draft: RecoveryKeyDraft) => {
      try {
        await send(backendId, historyCommands.setRecovery(historyRecipientKeyPairFromSeed(draft.seed).publicKey));
      } finally {
        draft.seed.fill(0);
      }
      await refresh(backendId, false);
    },
    requestGrant: async () => {
      const result = await send(backendId, historyCommands.requestGrant());
      await refresh(backendId, false);
      return typeof result.grantId === 'string' ? result.grantId : '';
    },
    dismissGrant: async (grantId: string) => {
      await send(backendId, historyCommands.dismissGrant(grantId));
      await refresh(backendId, false);
    },
    /** Re-wraps every key this device holds for the grant's device; resumes
     * from where an interrupted run stopped. */
    authorizeGrant: async (grant: HistoryGrant) => {
      if (grantControllers.current.has(grant.grantId)) return;
      if (!grant.publicKey) throw new Error(t('history.grantRecipientMissing'));
      const targetPublicKey = decodeBase64UrlBytes(grant.publicKey);
      const controller = new AbortController();
      grantControllers.current.set(grant.grantId, controller);
      // An interrupted run resumes from its cursor; a finished one starts over.
      const previous = grantRunsRef.current[grant.grantId]?.progress;
      const start: HistoryRewrapProgress = previous?.cursor ? previous : { processed: 0, added: 0, skipped: 0 };
      const update = (run: HistoryGrantRun) => setGrantRuns((runs) => ({ ...runs, [grant.grantId]: run }));
      update({ running: true, progress: start });
      const seed = await ownSeed(backendId).catch((error: unknown) => {
        grantControllers.current.delete(grant.grantId);
        update({ running: false, progress: start, error: error instanceof Error ? error.message : t('history.keyFailed') });
        throw error;
      });
      let last = start;
      try {
        const result = await rewrapHistoryKeys({
          send: (frame) => send(backendId, frame), sourceSeed: seed, targetPublicKey, grantId: grant.grantId,
          cursor: start.cursor, signal: controller.signal,
          onProgress: (progress) => {
            last = { processed: start.processed + progress.processed, added: start.added + progress.added, skipped: start.skipped + progress.skipped, ...(progress.cursor ? { cursor: progress.cursor } : {}) };
            update({ running: true, progress: last });
          },
        });
        last = { processed: start.processed + result.processed, added: start.added + result.added, skipped: start.skipped + result.skipped };
        update({ running: false, progress: last });
        await refresh(backendId, false);
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError';
        update({ running: false, progress: last, error: aborted ? t('history.grantPaused') : error instanceof Error ? error.message : t('history.grantFailed') });
        if (!aborted) throw error;
      } finally {
        seed.fill(0);
        grantControllers.current.delete(grant.grantId);
      }
    },
    pauseGrant: (grantId: string) => grantControllers.current.get(grantId)?.abort(),
    /** Imports a recovery key: a self-grant from the recovery recipient to
     * this device (§3.3). The recovery seed is never stored. */
    importRecoveryKey: async (input: string, onProgress?: (progress: HistoryRewrapProgress) => void) => {
      const recoverySeed = parseRecoveryKey(input);
      try {
        const rid = ridOf(historyRecipientKeyPairFromSeed(recoverySeed).publicKey);
        if (!live.current.views[backendId]?.state?.recipients.some((item) => item.kind === 'recovery' && item.rid === rid)) {
          throw new Error(t('history.recoveryUnknown'));
        }
        const seed = await ownSeed(backendId);
        let publicKey: Uint8Array;
        try {
          publicKey = historyRecipientKeyPairFromSeed(seed).publicKey;
        } finally {
          seed.fill(0);
        }
        const result = await rewrapHistoryKeys({ send: (frame) => send(backendId, frame), sourceSeed: recoverySeed, targetPublicKey: publicKey, onProgress });
        unlocked();
        return result;
      } finally {
        recoverySeed.fill(0);
      }
    },
    /** Replaces this device's history key (lost or unreadable). History
     * wrapped for the old key needs a new grant or the recovery key. */
    resetDeviceKey: async () => {
      await deleteHistorySeed(backendId);
      const entry = decryptors.current.get(backendId);
      entry?.decryptor.clear();
      decryptors.current.delete(backendId);
      await refresh(backendId, true);
    },
  });
  // The callbacks above are stable (useCallback with stable deps), so a
  // backend's action set is built once.
  const actionsFor = (backendId: string) => {
    let actions = actionsByBackend.current.get(backendId);
    if (!actions) {
      actions = createActions(backendId);
      actionsByBackend.current.set(backendId, actions);
    }
    return actions;
  };

  /** Forgets everything held for a removed backend profile. */
  const forgetBackend = useCallback(async (backendId: string) => {
    decryptors.current.get(backendId)?.decryptor.clear();
    decryptors.current.delete(backendId);
    actionsByBackend.current.delete(backendId);
    registeredLinks.current.delete(backendId);
    setViews((current) => {
      if (!(backendId in current)) return current;
      const { [backendId]: _removed, ...rest } = current;
      return rest;
    });
    setDismissedRecoveryNotices((current) => {
      if (!current.includes(backendId)) return current;
      const next = current.filter((id) => id !== backendId);
      writeDismissedRecoveryNotices(next);
      return next;
    });
    await deleteHistorySeed(backendId);
  }, []);

  /** Hides the "no recovery key" notice for a backend (its settings page
   * keeps the warning). */
  const dismissRecoveryNotice = useCallback((backendId: string) => {
    setDismissedRecoveryNotices((current) => {
      if (current.includes(backendId)) return current;
      const next = [...current, backendId];
      writeDismissedRecoveryNotices(next);
      return next;
    });
  }, []);

  const viewOf = (backendId: string): HistoryEncryptionView => views[backendId] ?? { backendId, status: 'idle' };
  /** No active recovery recipient: losing every device loses the history. */
  const recoveryMissingOf = (backendId: string) => {
    const view = viewOf(backendId);
    return Boolean(view.state && !view.accessRevoked
      && !view.state.recipients.some((item) => item.kind === 'recovery' && !item.revokedAt));
  };
  const focusView = viewOf(focusBackendId);
  /** This device's history recipient id on a backend once its key loaded;
   * the history cache is keyed by it. */
  const localRecipientId = useCallback(async (backendId: string) => {
    const { decryptor, ready } = decryptorFor(backendId);
    await ready;
    return decryptor.recipientIds[0];
  }, [decryptorFor]);
  return {
    localRecipientId,
    /** State of the focused backend (the visible conversation's). */
    view: focusView,
    /** The non-blocking "no recovery key" notice should show for the
     * focused backend. */
    recoveryNoticeVisible: recoveryMissingOf(focusBackendId) && !dismissedRecoveryNotices.includes(focusBackendId),
    dismissRecoveryNotice: () => dismissRecoveryNotice(focusBackendId),
    /** This device's history access was revoked on the focused backend. */
    revoked: Boolean(focusView.accessRevoked),
    /** The backend writes history end-to-end encrypted. */
    e2eFor: (backendId: string) => viewOf(backendId).state?.mode === 'e2e',
    /** Backends whose state was read and which revoked this device. */
    revokedBackendIds: Object.values(views).filter((view) => view.accessRevoked).map((view) => view.backendId),
    keyRequired,
    titleRevision,
    decryptPage,
    receiveSocketEvent,
    withDecryptedTitles,
    decryptManifestTitles,
    rememberTitle,
    withDecryptedTitle,
    receiveUpdate,
    forgetBackend,
    unlocked,
    /** Everything the settings page of one backend shows and does. */
    forBackend: (backendId: string) => ({
      view: viewOf(backendId),
      recoveryMissing: recoveryMissingOf(backendId),
      grantRuns,
      ...actionsFor(backendId),
    }),
  };
}

export type HistoryEncryptionSession = ReturnType<typeof useHistoryEncryption>;
export type HistoryEncryptionBackend = ReturnType<HistoryEncryptionSession['forBackend']>;

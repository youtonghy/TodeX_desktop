import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// End-to-end encrypted conversation history (TodeX_backend
// docs/history-encryption.md) for the active backend. History is always
// encrypted: this device's history key is created and registered on every
// (re)connect, every history path is decrypted before projection, and the
// settings actions cover the recovery key, grants and restoring revoked
// devices. State changes are pushed (`history.encryption.updated`); the state
// is also re-read on every (re)connect and when settings open.

type CommandSender = (message: { id: string; type: string; payload: Record<string, unknown> }, timeoutMs?: number) => Promise<Record<string, unknown>>;

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

export function useHistoryEncryption({ activeBackendId, connected, supported, sendCommand, onUnlocked }: {
  activeBackendId: string;
  /** The verified socket of the active backend is open. */
  connected: boolean;
  /** `/v2/version` reports `historyEncryption: 1`; `undefined` until known. */
  supported: boolean | undefined;
  sendCommand: CommandSender;
  /** Keys arrived (grant, recovery import): locked rows of these
   * conversations (all when omitted) may now open. */
  onUnlocked: (conversationIds?: readonly string[]) => void;
}) {
  const [view, setView] = useState<HistoryEncryptionView>({ backendId: activeBackendId, status: 'idle' });
  const [grantRuns, setGrantRuns] = useState<Record<string, HistoryGrantRun>>({});
  const [titleRevision, setTitleRevision] = useState(0);
  const [dismissedRecoveryNotices, setDismissedRecoveryNotices] = useState(readDismissedRecoveryNotices);
  const grantRunsRef = useRef(grantRuns);
  grantRunsRef.current = grantRuns;
  const live = useRef({ activeBackendId, connected, supported, sendCommand, onUnlocked, view });
  live.current = { activeBackendId, connected, supported, sendCommand, onUnlocked, view };
  const decryptors = useRef(new Map<string, { decryptor: HistoryDecryptor; ready: Promise<void> }>());
  const liveChains = useRef(new Map<string, Promise<void>>());
  const titles = useRef(new Map<string, string | null>());
  const grantControllers = useRef(new Map<string, AbortController>());
  /** Backends that revoked this device. */
  const revokedBackends = useRef(new Set<string>());

  /** A revoked device keeps no unwrapped keys and fetches no wraps: its
   * encrypted rows project locked. */
  const markRevoked = useCallback((backendId: string, revoked: boolean) => {
    if (!revoked) { revokedBackends.current.delete(backendId); return; }
    if (revokedBackends.current.has(backendId)) return;
    revokedBackends.current.add(backendId);
    decryptors.current.get(backendId)?.decryptor.clear();
    decryptors.current.delete(backendId);
    titles.current.clear();
    setView((previous) => (previous.backendId === backendId ? { ...previous, accessRevoked: true } : previous));
  }, []);

  const send = useCallback(async (frame: HistoryCommandFrame) => {
    if (!live.current.connected) throw new Error(t('history.notConnected'));
    const backendId = live.current.activeBackendId;
    try {
      return await live.current.sendCommand({ id: createRequestId('history'), ...frame }, 30_000);
    } catch (error) {
      if (isAccessRevoked(error)) markRevoked(backendId, true);
      throw error;
    }
  }, [markRevoked]);

  /** Wraps are fetched over the active backend's socket only. */
  const sendFor = useCallback((backendId: string) => (frame: HistoryCommandFrame) => {
    if (backendId !== live.current.activeBackendId) return Promise.reject(new Error(t('history.otherBackend')));
    return send(frame);
  }, [send]);

  const decryptorFor = useCallback((backendId: string) => {
    let entry = decryptors.current.get(backendId);
    if (!entry) {
      const fetchWraps = historyWrapsFetcher(sendFor(backendId));
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
  }, [sendFor]);

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
    if (!todo.length || backendId !== live.current.activeBackendId || !live.current.connected) return;
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

  /** Reads the backend state and, when `register`, makes sure this device's
   * history key exists and is registered (§3.3). */
  const refresh = useCallback(async (register = false) => {
    const backendId = live.current.activeBackendId;
    const current = () => live.current.activeBackendId === backendId;
    // Nothing to ask before the socket is up; an old backend never is asked.
    if (!live.current.connected || live.current.supported === undefined) return;
    if (!live.current.supported) {
      setView({ backendId, status: 'unavailable' });
      return;
    }
    setView((previous) => ({ ...(previous.backendId === backendId ? previous : { backendId }), backendId, status: 'loading' }));
    let state: HistoryEncryptionState;
    try {
      state = parseHistoryEncryptionState(await send(historyCommands.get()));
    } catch (error) {
      if (current()) setView({ backendId, status: 'unavailable', error: error instanceof Error ? error.message : t('history.stateFailed') });
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
        if (decryptor.recipientIds[0] !== localRid) decryptor.setSeeds([seed]);
        decryptor.forgetMissing();
        seed.fill(0);
        if (register && !revoked && state.myRid !== localRid) {
          try {
            await send(historyCommands.register(publicKey));
          } catch (error) {
            // A revoked key can never be registered again (CONFLICT): this
            // device continues with a fresh key, which needs a new grant
            // (or the recovery key) for history wrapped before.
            if (!(error instanceof ProtocolCommandError && error.code === 'CONFLICT')) throw error;
            const fresh = generateHistoryRecipientKeyPair();
            await saveHistorySeed(backendId, fresh.secretKey);
            decryptor.setSeeds([fresh.secretKey]);
            fresh.secretKey.fill(0);
            localRid = ridOf(fresh.publicKey);
            await send(historyCommands.register(fresh.publicKey));
          }
          state = parseHistoryEncryptionState(await send(historyCommands.get()));
        }
      }
    } catch (error) {
      if (isAccessRevoked(error)) revoked = true;
      else keyError = error instanceof Error ? error.message : t('history.keyFailed');
    }
    if (current()) setView({ backendId, status: 'ready', state, localRid, keyError, accessRevoked: revoked });
  }, [decryptorFor, markRevoked, send]);

  // Register on every (re)connect: history is always encrypted, so a write
  // needs this device's key among the recipients.
  useEffect(() => {
    if (!connected || supported === undefined) return;
    void refresh(true);
  }, [activeBackendId, connected, refresh, supported]);

  /** A write failed with HISTORY_KEY_REQUIRED: registers this device's key
   * again, once at a time. */
  const reregistering = useRef<Promise<void> | null>(null);
  const keyRequired = useCallback(() => {
    if (reregistering.current) return reregistering.current;
    const run = refresh(true).finally(() => { reregistering.current = null; });
    reregistering.current = run;
    return run;
  }, [refresh]);

  /** Runs a settings action that answers with the encryption state. */
  const applyState = useCallback(async (frame: HistoryCommandFrame) => {
    const state = parseHistoryEncryptionState(await send(frame));
    const backendId = live.current.activeBackendId;
    if (state.myAccess) markRevoked(backendId, state.myAccess === 'revoked');
    setView((previous) => (previous.backendId === backendId
      ? { ...previous, status: 'ready', state, ...(state.myAccess ? { accessRevoked: state.myAccess === 'revoked' } : {}) } : previous));
    return state;
  }, [markRevoked, send]);

  const ownSeed = useCallback(async () => {
    const seed = await loadHistorySeed(live.current.activeBackendId);
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
  const waitingGrants = useRef(new Set<string>());
  const pendingUpdate = useRef<{ backendId: string; unlock: Set<string> | 'all' | null; timer: ReturnType<typeof setTimeout> } | null>(null);
  const flushUpdate = useCallback(() => {
    const pending = pendingUpdate.current;
    pendingUpdate.current = null;
    if (!pending || pending.backendId !== live.current.activeBackendId) return;
    if (pending.unlock) unlocked(pending.unlock === 'all' ? undefined : [...pending.unlock]);
    void refresh(true);
  }, [refresh, unlocked]);
  const receiveUpdate = useCallback((backendId: string, payload: unknown) => {
    if (backendId !== live.current.activeBackendId) return;
    const update = parseHistoryEncryptionUpdate(payload);
    if (!update) return;
    const localRids = [live.current.view.localRid, ...(decryptors.current.get(backendId)?.decryptor.recipientIds ?? [])];
    const { unlock } = historyUpdateReaction(update, localRids);
    // Unlocked here already; the state read must not unlock it again.
    if (unlock && update.reason === 'grant.fulfilled' && update.grantId) waitingGrants.current.delete(update.grantId);
    let pending = pendingUpdate.current;
    if (pending && pending.backendId !== backendId) { clearTimeout(pending.timer); pending = null; }
    const merged = !unlock ? pending?.unlock ?? null
      : unlock === 'all' || pending?.unlock === 'all' ? 'all'
      : new Set([...(pending?.unlock ?? []), ...unlock]);
    if (pending) clearTimeout(pending.timer);
    pendingUpdate.current = { backendId, unlock: merged, timer: setTimeout(flushUpdate, UPDATE_DEBOUNCE_MS) };
  }, [flushUpdate]);
  useEffect(() => () => {
    if (pendingUpdate.current) clearTimeout(pendingUpdate.current.timer);
    pendingUpdate.current = null;
  }, []);

  // A grant this device waited for shows up fulfilled in a state read (an
  // update missed while disconnected): rows locked so far may open.
  const ownPendingGrants = view.state?.grants
    .filter((grant) => grant.status === 'pending' && grant.rid === view.localRid)
    .map((grant) => grant.grantId).join(',') ?? '';
  useEffect(() => {
    const state = view.state;
    if (!state || !view.localRid) return;
    const fulfilled = state.grants.some((grant) => grant.status === 'fulfilled' && waitingGrants.current.has(grant.grantId));
    waitingGrants.current = new Set(ownPendingGrants ? ownPendingGrants.split(',') : []);
    if (fulfilled) unlocked();
  }, [ownPendingGrants, unlocked, view.localRid, view.state]);

  const actions = useMemo(() => ({
    refresh: () => refresh(false),
    revoke: (rid: string) => applyState(historyCommands.revoke(rid)),
    /** Lifts another device's revocation; it registers a fresh key and
     * needs a new grant for older history. */
    restoreDevice: (deviceId: string) => applyState(historyCommands.restoreDevice(deviceId)),
    /** A fresh recovery key, shown to the user before anything is uploaded. */
    createRecoveryDraft: (): RecoveryKeyDraft => {
      const { secretKey } = generateHistoryRecipientKeyPair();
      return { seed: secretKey, words: recoveryWordsFromSeed(secretKey), qrPayload: recoveryQrPayload(secretKey) };
    },
    /** Uploads only the recovery public key; the seed is zeroed here. */
    confirmRecoveryKey: async (draft: RecoveryKeyDraft) => {
      try {
        await send(historyCommands.setRecovery(historyRecipientKeyPairFromSeed(draft.seed).publicKey));
      } finally {
        draft.seed.fill(0);
      }
      await refresh(false);
    },
    requestGrant: async () => {
      const result = await send(historyCommands.requestGrant());
      await refresh(false);
      return typeof result.grantId === 'string' ? result.grantId : '';
    },
    dismissGrant: async (grantId: string) => {
      await send(historyCommands.dismissGrant(grantId));
      await refresh(false);
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
      const seed = await ownSeed().catch((error: unknown) => {
        grantControllers.current.delete(grant.grantId);
        update({ running: false, progress: start, error: error instanceof Error ? error.message : t('history.keyFailed') });
        throw error;
      });
      let last = start;
      try {
        const result = await rewrapHistoryKeys({
          send, sourceSeed: seed, targetPublicKey, grantId: grant.grantId,
          cursor: start.cursor, signal: controller.signal,
          onProgress: (progress) => {
            last = { processed: start.processed + progress.processed, added: start.added + progress.added, skipped: start.skipped + progress.skipped, ...(progress.cursor ? { cursor: progress.cursor } : {}) };
            update({ running: true, progress: last });
          },
        });
        last = { processed: start.processed + result.processed, added: start.added + result.added, skipped: start.skipped + result.skipped };
        update({ running: false, progress: last });
        await refresh(false);
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
        if (!live.current.view.state?.recipients.some((item) => item.kind === 'recovery' && item.rid === rid)) {
          throw new Error(t('history.recoveryUnknown'));
        }
        const seed = await ownSeed();
        let publicKey: Uint8Array;
        try {
          publicKey = historyRecipientKeyPairFromSeed(seed).publicKey;
        } finally {
          seed.fill(0);
        }
        const result = await rewrapHistoryKeys({ send, sourceSeed: recoverySeed, targetPublicKey: publicKey, onProgress });
        unlocked();
        return result;
      } finally {
        recoverySeed.fill(0);
      }
    },
    /** Replaces this device's history key (lost or unreadable). History
     * wrapped for the old key needs a new grant or the recovery key. */
    resetDeviceKey: async () => {
      const backendId = live.current.activeBackendId;
      await deleteHistorySeed(backendId);
      const entry = decryptors.current.get(backendId);
      entry?.decryptor.clear();
      decryptors.current.delete(backendId);
      await refresh(true);
    },
    unlocked,
  }), [applyState, ownSeed, refresh, send, unlocked]);

  /** Forgets everything held for a removed backend profile. */
  const forgetBackend = useCallback(async (backendId: string) => {
    decryptors.current.get(backendId)?.decryptor.clear();
    decryptors.current.delete(backendId);
    setDismissedRecoveryNotices((current) => {
      if (!current.includes(backendId)) return current;
      const next = current.filter((id) => id !== backendId);
      writeDismissedRecoveryNotices(next);
      return next;
    });
    await deleteHistorySeed(backendId);
  }, []);

  /** Hides the "no recovery key" notice for this backend (the settings
   * section keeps the warning). */
  const dismissRecoveryNotice = useCallback(() => {
    const backendId = live.current.activeBackendId;
    setDismissedRecoveryNotices((current) => {
      if (current.includes(backendId)) return current;
      const next = [...current, backendId];
      writeDismissedRecoveryNotices(next);
      return next;
    });
  }, []);

  const activeView = view.backendId === activeBackendId ? view : { backendId: activeBackendId, status: 'idle' as const };
  const activeState = activeView.state;
  /** No active recovery recipient: losing every device loses the history. */
  const recoveryMissing = Boolean(activeState && !activeView.accessRevoked
    && !activeState.recipients.some((item) => item.kind === 'recovery' && !item.revokedAt));
  return {
    view: activeView,
    recoveryMissing,
    /** The non-blocking "no recovery key" notice should show. */
    recoveryNoticeVisible: recoveryMissing && !dismissedRecoveryNotices.includes(activeBackendId),
    dismissRecoveryNotice,
    keyRequired,
    /** The active backend writes history end-to-end encrypted. */
    e2e: activeView.state?.mode === 'e2e',
    /** This device's history access was revoked on the active backend. */
    revoked: Boolean(activeView.accessRevoked),
    grantRuns,
    titleRevision,
    decryptPage,
    receiveSocketEvent,
    withDecryptedTitles,
    decryptManifestTitles,
    receiveUpdate,
    forgetBackend,
    ...actions,
  };
}

export type HistoryEncryptionSession = ReturnType<typeof useHistoryEncryption>;

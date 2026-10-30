import { normalizeBackendLabelColor, type BackendConnectionProfile } from './backendColors';
import { ipcDaemonConflicts, moveBackendRecords, ownerBackendId, resolveNoWorkspaceBackendId, tagLegacyBackendRecords } from './backendRouting';
import { useWorkbenchSharing } from './useWorkbenchSharing';
import {
  completionNotificationBody,
  permissionNotificationBody,
  postCompletionNotification,
  shouldNotifyCompletion,
  useCompletionNotifications,
} from './completionNotifications';
import { addNotification, forgetConversationNotifications } from './notificationFeed';
import { bindSentAttachmentEvents, prepareSentAttachments, pruneSentAttachmentRecords, type SentAttachmentRecord } from './sentAttachments';
import { ManifestEpochs, flagWorkspaceMissing, mergeWorkspaceDirectory } from './workspaceDirectorySync';
import { createConversationStores, sameRecordValues, visibleTimeline, type ConversationStores } from './conversationStore';
import { useStoreSelector } from './store/createStore';
import { uploadPromptFile } from './promptUploads';
import { uploadedPromptContent } from '@todex/protocol/promptUploads';
import { isIpcServerUrl } from '@todex/protocol/ipcServerUrl';
import { configureKanbanRouting, configureKanbanSync, syncKanbanTasksFromBackend } from './kanbanTasks';
import { t } from '../i18n';
import { toast } from '../components/ui/toast';
import { piExtensionPlainText } from '../components/piExtensionPresentation';
import { PiExtensionEffects, canApplyPluginDraft } from './piExtensionEffects';
import { commandContextKey, findPromptCommand, routePiSlashCommand, type ProviderCommandCatalog } from './providerCommands';
import { platform } from '../platform';
import { migrateLegacyFollowUps, restoreQueuedFollowUps, type LegacyAddResult, type LegacyFollowUps, type LegacyQueueTarget } from './queuedFollowUps';
import { backendRateLimitState } from './sessionRateLimit';
import { ConversationRecovery, isConversationRuntimeBusy, type ConversationOpenStatus, type EarlierHistoryResult } from './conversationRecovery';
import { CONVERSATION_WARM_ID_PREFIX, isConversationWarmRequestId, shouldWarmConversation } from './conversationWarm';
import {
  AGENT_BROWSER_UNWATCH_ID_PREFIX,
  AGENT_BROWSER_WATCH_ID_PREFIX,
  isAgentBrowserWatchRequestId,
  type AgentBrowserFrame,
} from '@todex/protocol/agentDesktop';
import type { AgentCallSession } from '@todex/protocol/agentCalling';
import { parseFollowUpQueue, type ConversationRuntime, type ExtensionEditorRequest, type FollowUpQueueState } from '@todex/protocol/conversationRuntime';
import { conversationScheduleFrame, followUpQueueFrame } from '@todex/protocol/conversationCommands';
import { conversationTranscriptMarkdown, fetchConversationTranscriptTail, transcriptEntries } from '@todex/protocol/conversationExport';
import { canonicalConversationEventType, type ConversationEvent } from '@todex/protocol/v2';
import { ConversationEventBatcher } from '@todex/protocol/frameBatch';
import { TerminalStreamStore } from '@todex/protocol/terminalStream';
import { getTerminalPreferences } from './terminalPreferences';
import { ProtocolCommands, ProtocolCommandError, type ProtocolCommand } from './protocolCommands';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import type { ConversationReplay, ProviderDescriptor, ProviderKind, PermissionMode, ConversationManifest, PromptContentRef, PromptSkillRef, SkillCatalogDescriptor, ProviderModelDescriptor, ProviderCommandDescriptor, ContextCompactionState, SubagentRun, MemoryEntry } from '@todex/protocol/v2';
import { contextCompactionStatus, parseConversationSchedule } from '@todex/protocol/v2';
import { HISTORY_ENCRYPTION_CAPABILITY, normalizeConversationEvent } from '@todex/protocol/v2';
import { verifyTransportPolicy, type SecureSocket } from '@todex/protocol/secureTransport';
import { TRANSPORT_V2_WS_CLOSE_CODE, TransportCryptoError } from '@todex/protocol/secureChannel';
import { startSocketVerification, type SocketVerification } from '@todex/protocol/socketVerification';
import { HISTORY_ENCRYPTION_UPDATED, historyRetryPrompt, historyRetryRequest, historyRetrySequence } from '@todex/protocol/historyEncryption';
import { historyErrorMessage, useHistoryEncryption, type HistoryEncryptionSession } from './useHistoryEncryption';
import { HISTORY_KEY_REQUIRED, HISTORY_READ_ONLY } from '@todex/protocol/historyEncryption';
import { retryWithDelays } from '@todex/protocol/retry';
import { probeBackendConnection, nextReconnectDelayMs, inspectServerUrl, credentialMatchesOrigin } from '@todex/protocol/connectionProbe';
import {
  ConnectionSettings,
    LocalAdapterState,
  PendingRequest,
  PermissionOption,
  ServerEvent,
  WorkspaceRecord,
  type WorkspaceSyncRejection,
  type WorkspaceTombstone,
  buildHttpUrl,
  classifyPendingRequest,
  permissionDecision,
  createRequestId,
  displayNameFromPath,
  eventPayloadData,
  normalizeReasoningEffort,
  normalizeThreadId,
  normalizeServerUrl,
  normalizeWorkspacePath,
  normalizeWorkspaceTombstone,
    nextWorkspaceSortOrder,
  remapWorkspaceScopedRecords,
  prepareWorkspaceSyncPayload,
  parseWorkspaceSyncRejected,
  parseWorkspaceSyncResponse,
  } from '@todex/protocol/todex';
import { loadJson, loadSecret, removeSecret, saveJson, saveSecret } from '../lib/storage';
import { ConnectionError } from '@todex/protocol/connectionError';
import { desktopAlert } from '../lib/desktopAlert';
import { gitDiffUnsupported, readGitWorkingTreeDiff } from '../lib/gitWorkspace';
import { loadSshPassword } from '../lib/sshPasswordStore';
import { createConcurrencyLimit } from '../lib/concurrencyLimit';
import { type OpenPanelOptions } from '../lib/panels';
import { historyTailCache } from './historyCache';
import type { CapabilityManager, CatalogState } from '../screens/CapabilitiesPanel';
import {
  DEFAULT_COMPOSER_SELECTION,
  EXPERIMENTAL_FEATURE_DEFAULTS,
  SETTINGS_STORAGE_KEY,
  WORKSPACES_STORAGE_KEY,
  CONVERSATIONS_STORAGE_KEY,
  TIMELINE_STORAGE_KEY,
  ACTIVE_SELECTION_STORAGE_KEY,
  MENTION_HISTORY_STORAGE_KEY,
  EXPERIMENTAL_FEATURES_STORAGE_KEY,
  USAGE_RECORDS_STORAGE_KEY,
  PROVIDER_MODEL_PREFERENCES_STORAGE_KEY,
  DEVICE_SECRET_STORAGE_KEY,
  DEVICE_ORIGIN_STORAGE_KEY,
  BACKEND_CONNECTIONS_STORAGE_KEY,
  JSON_SAVE_DEBOUNCE_MS,
  WORKSPACE_SYNC_DEBOUNCE_MS,
  WORKSPACE_TOMBSTONES_STORAGE_KEY,
  SOCKET_EVENT_BATCH_SIZE,
  SOCKET_FRAME_DECODE_BATCH_SIZE,
  SOCKET_FRAME_DECODE_BUDGET_MS,
  MAX_PENDING_SOCKET_FRAMES,
  nextSocketBacklogStreak,
  type SocketBacklogStreak,
    MAX_TIMELINE_ITEMS,
  capTimelinePerConversation,
  type EarlierHistoryStatus,
  mergeSequenceRanges,
  MAX_USAGE_RECORDS,
  MAX_WORKSPACE_TOMBSTONES,
  TERMINAL_ATTACH_TIMEOUT_MS,
  evictIdleTerminalStates,
  DEFAULT_TERMINAL_ROWS,
  DEFAULT_TERMINAL_COLS,
  defaultSettings,
  defaultConnectionHealth,
  normalizeBackendConnectionProfile,
  profileFromSettings,
  settingsFromProfile,
  UNPAIRED_TRANSPORT,
  PERMISSION_PRESETS,
  normalizeServerVersion,
  type ServerVersion,
  type ConversationRecord,
  type ExperimentalFeatureSettings,
  type GitDiffState,
  type TerminalClientState,
  type TerminalStartOptions,
  type TerminalTarget,
  type ComposerSelection,
  type ComposerAttachmentDraft,
  type QueuedChatSubmission,
  type PendingJsonSave,
  type PendingSocketFrame,
  type ConversationContext,
  type SelectedSkillAttachment,
  type TimelineTarget,
  type ConnectionState,
  type ConnectionHealth,
  type TerminalLifecycleState,
  type TimelineEntry,
  type WorkspaceMentionHistory,
  type MentionReference,
  type PersistedSettings,
  type ProviderModelPreferences,
  canonicalSlashCommand,
  toPersistedSettings,
  fromPersistedSettings,
  backendApi,
  backendFetch,
  readBackendError,
  backendTransport,
  describeTransportFailure,
  sendSocketText,
  type TransportFailure,
  workspaceSyncPayloadEquals,
  createSessionId,
  terminalIdForConversation,
  fetchWorkspaceDirectorySnapshot,
  isVersionMismatch,
  mergeModelCatalog,
  normalizeExperimentalFeatures,
  attachmentPrompt,
  attachmentTextBlock,
  attachmentSummary,
  liveComposerAttachments,
  expandTextCapsules,
  selectedSkillSummary,
  extractProtocolError,
  normalizeProviderModelPreferences,
  providerModelPreferenceKey,
  resolveProviderModel,
  resolveProviderReasoningEffort,
  formatResetInstant,
  parseMentionReferences,
  summarizeMentionReferences,
  permissionPresetForProfile,
  conversationPermissionCapabilities,
  conversationPermissionMode,
  rememberedRunModes,
  makeSystemEntry,
  connectionErrorText,
  conversationFromManifest,
  mergeManifestConversations,
  isReadOnlyConversation,
  isPrivateConversation,
  isV2Conversation,
  activeConversationSchedule,
  hasBackendQueue,
  providerHasBackendQueue,
  providerSupportsScheduledConversations,
  providerHasBackendQueueControl,
  canSwitchConversationAgent,
  resolveCreateConversationAgent,
  buildConversationCancelMessage,
  isStaleCancelResult,
  type ConversationContextUsage,
  type UsageRecord,
  normalizeUsageRecords,
  createDefaultConversation,
  createNoneWorkspace,
  isNoneWorkspaceId,
  withNoneWorkspace,
  workspaceForConversation,
  conversationsForWorkspaceSnapshot,
  forkConversationRecord,
  isDefaultConversationTitle,
  CONNECTION_HEALTH_INTERVAL_MS,
  CONNECTION_HEALTH_TIMEOUT_MS,
  SOCKET_WATCHDOG_INTERVAL_MS,
  SOCKET_LIVENESS_TIMEOUT_MS,
  SOCKET_VERIFICATION_TIMEOUT_MS,
  BACKEND_READY_NOTICE_DELAY_MS,
  BACKEND_READY_TIMEOUT_MS,
  SOCKET_LIVENESS_MAX_FAILURES,
  scheduleMessageTask,
  cancelMessageTask,
} from './helpers';
import { persistableConversations, privateConversationIds, providerPrivateMode, vanishedPrivateConversations, withoutPrivateEntries } from './privateConversations';

const SENT_ATTACHMENTS_STORAGE_KEY = `${TIMELINE_STORAGE_KEY}.attachments`;

// Live model discovery can outlast a request when a provider CLI is slow to
// start (Devin sweeps every model for its thinking levels); retry before
// falling back to descriptor models so the model picker is not left disabled.
const MODEL_DISCOVERY_RETRY_DELAYS_MS = [2_000, 5_000];

// A workspace switch or reconnect asks every provider for models, commands,
// skills and MCP at once (~28 requests). Chromium allows six connections per
// host, so an unbounded burst queued `/health`, git status and conversation
// polls behind multi-second provider probes until they timed out. Discovery
// shares a few slots; each request's own timeout starts once it holds one.
const discoveryLimit = createConcurrencyLimit(3);

interface DiscoveryProgress {
  scope: string;
  loaded: Set<ProviderKind>;
  pending: Set<ProviderKind>;
}

function emptyDiscoveryProgress(scope: string): DiscoveryProgress {
  return { scope, loaded: new Set(), pending: new Set() };
}

// The backend allows 128 conversation subscriptions per v2 socket. Keep a
// smaller client-side budget so explicit subscribes (activate/attach/create)
// still have headroom; least-recently-subscribed entries are unsubscribed
// to make room.
const V2_WS_SUBSCRIPTION_BUDGET = 120;
// Events a subscription backfills over the socket; the rest pages over HTTP.
const V2_SUBSCRIBE_BACKFILL_LIMIT = 500;

// Conversations whose projected history stays in memory after the user moves
// on. The next ones keep only their newest rows, so switching back shows
// them at once; older ones are released and reopen lazily from the journal
// tail (or the desktop history cache).
const RETAINED_CONVERSATION_RUNTIMES = 8;
const RETAINED_CONVERSATION_TAILS = 40;
const RETAINED_TAIL_ROWS = 100;
// How long a failed prompt waits for the daemon's queue snapshot before the
// client asks for it (`conversation.queue.list`).
const BACKEND_CONTINUATION_SETTLE_MS = 1_000;
/** An ssh exit this soon after a saved-password start is treated as a failed
 * sign-in rather than the end of a session. */
const SSH_PASSWORD_FALLBACK_WINDOW_MS = 30_000;
/** Storage keys of the client-side candidate queue and rate-limit wait older
 * builds persisted; read once to migrate / delete them. */
const LEGACY_QUEUED_FOLLOW_UPS_KEY = 'todex.queued-follow-ups.v1';
const LEGACY_RATE_LIMITS_KEY = 'todex.rate-limits.v1';

type SubmissionDraft = { text: string; skills: SelectedSkillAttachment[]; attachments: ComposerAttachmentDraft[] };
type BackendContinuation = {
  conversationId: string;
  decided: Promise<boolean>;
  decide: (queue: FollowUpQueueState | undefined) => void;
  done: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/** One backend profile's `/v2/ws` connection. Every profile with a server
 * URL keeps its own, so conversations on all backends stay live at once. */
type BackendLink = {
  socket: SecureSocket | null;
  attempt: AbortController | null;
  /** The encrypted handshake (or plaintext open) finished. */
  verified: boolean;
  /** A definitive transport failure: health probes stop overwriting it. */
  transportFailure: boolean;
  /** Bumped when the socket closes; frames of older sockets are dropped. */
  generation: number;
  commands: ProtocolCommands;
  /** v2 ids subscribed on this socket, in request order (eviction order). */
  subscriptions: Set<string>;
  /** subscribe requestId -> v2 id, so a rejected subscribe frees its slot. */
  pendingSubscribes: Map<string, string>;
  reconnectAttempt: number;
  backlogStreak: SocketBacklogStreak | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  watchdogFailures: number;
  /** The user disconnected it: no automatic reconnect until Connect. */
  manualDisconnect: boolean;
  lastFailureRetryable: boolean;
  /** The connect attempt waiting for a starting backend to answer; health
   * probes would only time out against it meanwhile. */
  readyWait: AbortController | null;
  healthProbeSeq: number;
  /** Its workspaces were pulled since the socket opened; local edits may be
   * pushed back. */
  workspaceReady: boolean;
  workspaceSyncTimer: ReturnType<typeof setTimeout> | null;
  /** Frames of this socket still waiting in the shared decode queue. */
  pendingFrames: number;
};

/** What the UI shows about one backend's connection. */
export type BackendLinkStatus = {
  state: ConnectionState;
  /** Bumped each time the socket opens; discovery retries failed providers. */
  epoch: number;
  health: ConnectionHealth;
  serverVersion: ServerVersion | null;
  /** Waiting for a starting backend to finish loading. */
  starting: boolean;
  /** Last connection failure of this backend ('' once it connects). */
  error: string;
  /** When the socket last opened (ms, this session); 0 before that. */
  openedAt: number;
};

const IDLE_BACKEND_LINK: BackendLinkStatus = { state: 'idle', epoch: 0, health: defaultConnectionHealth, serverVersion: null, starting: false, error: '', openedAt: 0 };

type ProviderModelCatalog = Partial<Record<ProviderKind, ProviderModelDescriptor[]>>;
// Stable fallbacks for a backend whose catalogs have not loaded yet, so the
// derived views keep their identity across renders.
const EMPTY_PROVIDERS: ProviderDescriptor[] = [];
const EMPTY_PROVIDER_MODELS: ProviderModelCatalog = {};
const EMPTY_PROVIDER_COMMANDS: Partial<Record<ProviderKind, ProviderCommandDescriptor[]>> = {};

export type OpenPanelFn = (name: string, params?: OpenPanelOptions) => void;

type LiveConversationControl =
  | { action: 'steer'; text: string }
  | { action: 'configure'; model?: string; reasoningEffort?: string }
  | { action: 'queueAdd'; itemId: string; text: string }
  | { action: 'queueRemove'; itemId: string }
  | { action: 'queueList' | 'queueClear' };
export type TodeXSession = ReturnType<typeof useTodeXSession>;



export type { CatalogState };
/** Lets the desktop wake a backend it froze (see setBackendWakeGate). */
export type BackendWakeGate = {
  isFrozen: (backendId: string) => boolean;
  /** Resolves once the backend is reachable again; the held action then runs. */
  wake: (backendId: string) => Promise<void>;
};

/** How often a streaming conversation's record takes its new high-water mark. */
const LAST_SEQUENCE_WRITE_MS = 2000;

/** How long an opened socket may take to become ready (hello, or open over IPC). */
const SOCKET_OPEN_TIMEOUT_MS = 20_000;

/** `record` with `key` set to `value`; the same object when nothing changes,
 * so per-event status writes skip the re-render. */
function withEntry<Value>(record: Record<string, Value>, key: string, value: Value): Record<string, Value> {
  return record[key] === value ? record : { ...record, [key]: value };
}

export function useTodeXSession(openPanel: OpenPanelFn) {
  // Session state outside React: high-frequency conversation state and the
  // records code reads synchronously (see conversationStore.ts).
  const storesRef = useRef<ConversationStores | null>(null);
  if (!storesRef.current) storesRef.current = createConversationStores();
  const stores = storesRef.current;
  const workbenchSharingState = useWorkbenchSharing();
  const completionNotificationsState = useCompletionNotifications();
  /** Live agent browser views: conversation → frame listeners. The socket
   * watches a conversation while it has listeners (re-sent on reconnect). */
  const agentBrowserWatchersRef = useRef(new Map<string, Set<(frame: AgentBrowserFrame) => void>>());
  // Every backend profile's connection, by profile id.
  const linksRef = useRef(new Map<string, BackendLink>());
  // Set during render so links created earlier send through the current code.
  const rawProtocolSenderRef = useRef<(backendId: string, message: ProtocolCommand) => boolean>(() => false);
  const linkFor = (backendId: string): BackendLink => {
    let link = linksRef.current.get(backendId);
    if (!link) {
      link = {
        socket: null, attempt: null, verified: false, transportFailure: false, generation: 0,
        commands: new ProtocolCommands((message) => rawProtocolSenderRef.current(backendId, message)),
        subscriptions: new Set(), pendingSubscribes: new Map(), reconnectAttempt: 0, backlogStreak: null,
        reconnectTimer: null, watchdogFailures: 0, manualDisconnect: false, lastFailureRetryable: true,
        readyWait: null, healthProbeSeq: 0, workspaceReady: false, workspaceSyncTimer: null, pendingFrames: 0,
      };
      linksRef.current.set(backendId, link);
    }
    return link;
  };
  useEffect(() => () => {
    for (const link of linksRef.current.values()) link.commands.dispose();
  }, []);
  const activeWorkspaceRef = useRef('');
  const activeConversationRef = useRef('');
  const v2ProvidersRef = useRef<ProviderDescriptor[]>([]);
  const turnIdsRef = useRef<Record<string, string>>({});
  const thinkingConversationsRef = useRef<Record<string, boolean>>({});
  const terminalByIdRef = useRef<Record<string, TerminalClientState>>({});
  /** Terminal output, kept out of React state: views subscribe to it. */
  const terminalStreamsRef = useRef(new TerminalStreamStore());
  /** Whether each backend replays terminal output (`terminalReplay` in
   * /v2/version); absent until its version is known. */
  const terminalReplayRef = useRef(new Map<string, boolean>());
  /** Whether each backend answers a fresh attach with a screen snapshot. */
  const terminalSnapshotRef = useRef(new Map<string, boolean>());
  /** Terminal opens waiting for their backend's version. */
  const pendingTerminalOpensRef = useRef(new Map<string, () => void>());
  /** Starts to send when `terminal.attached` reports no running terminal. */
  const startOnMissingRef = useRef(new Map<string, () => void>());
  /** When each terminal's attach went out; one at a time per terminal. */
  const attachSentAtRef = useRef(new Map<string, number>());
  // Terminal commands defined further down, used by earlier event handlers.
  const attachTerminalRef = useRef<(terminalId: string, fresh?: boolean) => boolean>(() => false);
  const reattachTerminalsRef = useRef<(backendId?: string) => void>(() => {});
  const noteTerminalReplayRef = useRef<(backendId: string, replay: boolean) => void>(() => {});
  const requestTerminalStatusRef = useRef<(target: TerminalTarget, terminalId?: string) => boolean>(() => false);
  const providerModelPreferencesRef = useRef<ProviderModelPreferences>({});
  const providerModelsByBackendRef = useRef<Record<string, ProviderModelCatalog>>({});
  const pendingV2ConversationCreatesRef = useRef(new Map<string, Promise<ConversationRecord | null>>());
  const pendingV2FirstPromptsRef = useRef(new Set<string>());
  const pendingV2SubmissionsRef = useRef(new Map<string, SubmissionDraft & {
    requestId: string;
    turnId?: string;
    phase: 'sending' | 'running' | 'unknown';
  }>());
  const backendContinuationsRef = useRef(new Map<string, BackendContinuation>());
  /** Work the session still owes a conversation: a turn shown as running, a
   * prompt awaiting its turn, or a queued message waiting for the
   * conversation's backend id. */
  const conversationHasPendingWork = (localId: string) => thinkingConversationsRef.current[localId] === true
    || pendingV2SubmissionsRef.current.has(localId)
    || (heldFollowUpsRef.current.get(localId)?.length ?? 0) > 0;
  // Set during render (like rawProtocolSenderRef) so earlier effects can reach it.
  const subscribeV2ConversationRef = useRef<(v2ConversationId: string, options?: { afterSequence?: number; limit?: number }) => boolean>(() => false);
  const pendingJsonSavesRef = useRef(new Map<string, PendingJsonSave>());
  const pendingServerEventsRef = useRef<ServerEvent[]>([]);
  const pendingServerEventFrameRef = useRef<number | null>(null);
  const pendingSocketFramesRef = useRef<PendingSocketFrame[]>([]);
  const pendingSocketFrameDrainRef = useRef<number | null>(null);
  const capabilityWorkspaceRef = useRef('');
  // Discovery progress for the current backend + workspace. Effects re-run
  // on reconnect and only query providers that neither succeeded nor are
  // still in flight, so one failed probe (for example during a daemon
  // restart) recovers without re-querying every provider. Results are dropped
  // only when the scope object is replaced, not when an effect re-runs.
  const modelDiscoveryRef = useRef<DiscoveryProgress>(emptyDiscoveryProgress(''));
  const commandDiscoveryRef = useRef<DiscoveryProgress>(emptyDiscoveryProgress(''));
  const capabilityRetryEpochRef = useRef(0);
  // Backends whose own sync just wrote the workspace list: their next save
  // would only echo it back.
  const workspaceBackendSkipNextSaveRef = useRef(new Set<string>());
  const workspaceMissingNotifiedRef = useRef(new Set<string>());

  const [hydrated, setHydrated] = useState(false);
  // A fresh install waits for the first Connect; afterwards every backend
  // with a server URL connects on its own.
  const [autoConnectEnabled, setAutoConnectEnabled] = useState(false);
  // App-wide preferences. Their transport fields only seed the first backend
  // profile of an older install; `settings` below carries the focused
  // backend's transport instead.
  const [preferences, setPreferences] = useState<ConnectionSettings>(defaultSettings);
  const [backendConnections, setBackendConnections] = useState<BackendConnectionProfile[]>([]);
  const backendConnectionsRef = useRef(backendConnections);
  backendConnectionsRef.current = backendConnections;
  // The sidebar lists None once per backend; this is the row last picked.
  const [noneBackendSelection, setNoneBackendSelection] = useState('');
  const noWorkspaceBackendIdRef = useRef('');
  const [linkStatusByBackend, setLinkStatusByBackend] = useState<Record<string, BackendLinkStatus>>({});
  const patchLinkStatus = useCallback((backendId: string, patch: Partial<BackendLinkStatus> | ((current: BackendLinkStatus) => Partial<BackendLinkStatus>)) => {
    setLinkStatusByBackend((current) => {
      const previous = current[backendId] ?? IDLE_BACKEND_LINK;
      const changes = typeof patch === 'function' ? patch(previous) : patch;
      const next = { ...previous, ...changes };
      if ((Object.keys(next) as (keyof BackendLinkStatus)[]).every((key) => next[key] === previous[key])) return current;
      return { ...current, [backendId]: next };
    });
  }, []);
  const profileFor = (backendId: string) => backendConnectionsRef.current.find((item) => item.id === backendId);
  // History reads follow the backend that owns the conversation, so a load
  // still in flight when the user switches away keeps reading the right
  // journal, and the next visit continues from where it stopped.
  const v2ApiForConversation = useCallback((conversationId: string) => {
    const profile = profileFor(backendIdForConversation(conversationId));
    // A removed backend's history is not read from another backend.
    if (!profile) throw new Error(t('sidebar.backendRemoved'));
    return backendApi(profile, { historyEncryption: true });
  }, []);
  /** Whether a backend conversation id belongs to a private conversation,
   * which the on-device history cache never stores. */
  function isPrivateBackendConversation(v2ConversationId: string): boolean {
    return stores.conversations.get().some((item) => item.v2ConversationId === v2ConversationId && isPrivateConversation(item));
  }
  /** Backend profile owning a conversation (the no-workspace backend for an
   * untagged None-workspace draft). */
  function backendIdForConversation(conversationId: string): string {
    const conversation = stores.conversations.get().find((item) => item.v2ConversationId === conversationId || item.id === conversationId);
    const workspace = stores.workspaces.get().find((item) => item.id === conversation?.workspaceId);
    return ownerBackendId(conversation, workspace, noWorkspaceBackendIdRef.current);
  }
  /** Backend a protocol frame is for, read from what it addresses: a
   * conversation, a codex session, a workspace or a terminal. Anything else
   * goes to the focused backend. */
  function backendIdForPayload(payload: Record<string, unknown> | undefined): string {
    const text = (key: string) => (typeof payload?.[key] === 'string' ? payload[key] as string : '');
    const conversationId = text('conversationId');
    if (conversationId) return backendIdForConversation(conversationId);
    const sessionId = text('codexSessionId') || text('sessionId');
    if (sessionId) {
      const conversation = stores.conversations.get().find((item) => item.sessionId === sessionId);
      if (conversation) return backendIdForConversation(conversation.id);
      const workspace = stores.workspaces.get().find((item) => item.sessionId === sessionId);
      if (workspace) return ownerBackendId(null, workspace, noWorkspaceBackendIdRef.current);
    }
    const terminal = terminalByIdRef.current[text('terminalId')];
    if (terminal?.backendConnectionId) return terminal.backendConnectionId;
    const workspace = stores.workspaces.get().find((item) => item.id === text('workspaceId'));
    if (workspace) return ownerBackendId(null, workspace, noWorkspaceBackendIdRef.current);
    return activeBackendConnectionIdRef.current;
  }
  // End-to-end encrypted history: every page is decrypted before it reaches
  // the projection (set once the hook below has run).
  const historyEncryptionRef = useRef<HistoryEncryptionSession | null>(null);
  const withDecryptedTitles = (backendId: string, manifests: ConversationManifest[]) =>
    historyEncryptionRef.current?.withDecryptedTitles(backendId, manifests) ?? manifests;
  const withDecryptedManifest = async (backendId: string, manifest: ConversationManifest): Promise<ConversationManifest> =>
    (await historyEncryptionRef.current?.withDecryptedTitle(backendId, manifest)) ?? manifest;
  /** `capture` hands a summary page's ciphertext to the history cache:
   * `start` begins a conversation's cached tail (a lazy window), `extend`
   * only grows one already captured. */
  const decryptedHistoryReplay = useCallback(async <P extends ConversationReplay>(conversationId: string, page: Promise<P>, detail: 'summary' | 'full', capture?: 'start' | 'extend'): Promise<P> => {
    const history = historyEncryptionRef.current;
    const result = await page;
    if (capture && detail === 'summary' && !isPrivateBackendConversation(conversationId)) {
      historyTailCache?.capture(backendIdForConversation(conversationId), conversationId, result.events, result.frames, { start: capture === 'start' });
    }
    return history ? history.decryptPage(backendIdForConversation(conversationId), conversationId, result, detail) : result;
  }, []);
  // Records live in the session stores (read and written synchronously);
  // the hook re-renders when they change.
  const workspaces = useStoreSelector(stores.workspaces, (value) => value);
  const setWorkspaces = stores.workspaces.set;
  const workspaceTombstones = useStoreSelector(stores.workspaceTombstones, (value) => value);
  const setWorkspaceTombstones = stores.workspaceTombstones.set;
  const conversations = useStoreSelector(stores.conversations, (value) => value);
  const setConversations = stores.conversations.set;
  const [directorySyncByBackend, setDirectorySyncByBackend] = useState<Record<string, 'loading' | 'ready' | 'error'>>({});
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [activeConversationId, setActiveConversationId] = useState('');
  const activeConversationRecord = conversations.find((item) => item.id === activeConversationId);
  // The None backend in view: the backend of the open None conversation,
  // else the None row last picked, else the first backend added that is not
  // a container (containers get no None row). New None conversations and
  // untagged None drafts belong to it.
  const enabledBackendConnections = useMemo(() => backendConnections.filter((profile) => !profile.disabled), [backendConnections]);
  const containerProfileIds = platform.containers.useProfileIds();
  const firstHostBackendId = useMemo(() => resolveNoWorkspaceBackendId(
    enabledBackendConnections.filter((profile) => !platform.containers.isContainerProfile(profile, containerProfileIds)),
  ), [containerProfileIds, enabledBackendConnections]);
  const noWorkspaceBackendId = resolveNoWorkspaceBackendId(
    enabledBackendConnections,
    isNoneWorkspaceId(activeConversationRecord?.workspaceId) ? activeConversationRecord?.backendConnectionId : null,
    noneBackendSelection,
    firstHostBackendId,
  );
  noWorkspaceBackendIdRef.current = noWorkspaceBackendId;
  // The focused backend serves the visible conversation (or workspace). It
  // only decides what the UI shows and where workspace-less panels act;
  // every backend stays connected regardless.
  const activeBackendConnectionId = ownerBackendId(
    activeConversationRecord,
    workspaces.find((item) => item.id === activeWorkspaceId),
    noWorkspaceBackendId,
  ) || (platform.deployment ? backendConnections[0]?.id : '') || 'default-backend';
  const activeBackendConnectionIdRef = useRef(activeBackendConnectionId);
  activeBackendConnectionIdRef.current = activeBackendConnectionId;
  const focusProfile = backendConnections.find((item) => item.id === activeBackendConnectionId);
  // Preferences plus the focused backend's transport, for everything that
  // talks to "the current backend" (discovery, panels, file pickers).
  const settings = useMemo(
    () => (focusProfile ? settingsFromProfile(focusProfile, preferences) : preferences),
    [focusProfile, preferences],
  );
  // The same for every backend, for panels that act on a backend picked
  // there rather than the focused one.
  const settingsByBackend = useMemo(() => {
    const map: Record<string, ConnectionSettings> = {};
    for (const profile of backendConnections) map[profile.id] = settingsFromProfile(profile, preferences);
    return map;
  }, [backendConnections, preferences]);
  const settingsForBackend = useCallback((backendId: string) => settingsByBackend[backendId] ?? settings, [settings, settingsByBackend]);
  const connectionRoutingRef = useRef(settings);
  connectionRoutingRef.current = settings;
  const focusLink = linkStatusByBackend[activeBackendConnectionId] ?? IDLE_BACKEND_LINK;
  const connectionState = focusLink.state;
  const connectionEpoch = focusLink.epoch;
  const connectionHealth = focusLink.health;
  const serverVersion = focusLink.serverVersion;
  const backendStarting = focusLink.starting;
  const [lastError, setLastErrorState] = useState('');
  // The same failure reported again within two seconds (retries, parallel
  // requests) is shown once.
  const lastErrorDedupeRef = useRef({ message: '', at: 0 });
  const setLastError = useCallback((value: string | ((current: string) => string)) => {
    setLastErrorState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      if (!next) return '';
      const now = Date.now();
      if (next === lastErrorDedupeRef.current.message && now - lastErrorDedupeRef.current.at < 2000) return current;
      lastErrorDedupeRef.current = { message: next, at: now };
      return next;
    });
  }, []);
  /** Legacy plaintext conversations are read-only: writes are refused here
   * (the backend would answer HISTORY_READ_ONLY). */
  const refuseReadOnlyWrite = (conversation: ConversationRecord | null | undefined): boolean => {
    if (!isReadOnlyConversation(conversation)) return false;
    setLastError(t(conversation?.legacyCodex ? 'sess.legacyCodexReadOnly' : 'history.readOnlyError'));
    return true;
  };
  const setTimeline = stores.timeline.set;
  const setSentAttachmentRecords = stores.sentAttachments.set;
  const sentAttachmentRecordsRef = useRef<SentAttachmentRecord[]>([]);
  const [mentionHistory, setMentionHistory] = useState<WorkspaceMentionHistory[]>([]);
  const [experimentalFeatures, setExperimentalFeatures] = useState<ExperimentalFeatureSettings>(EXPERIMENTAL_FEATURE_DEFAULTS);
  const [chatDrafts, setChatDraftsState] = useState<Record<string, string>>({});
  const chatDraftsRef = useRef<Record<string, string>>({});
  const setChatDrafts = useCallback((value: SetStateAction<Record<string, string>>) => {
    const next = typeof value === 'function' ? value(chatDraftsRef.current) : value;
    chatDraftsRef.current = next;
    setChatDraftsState(next);
  }, []);
  // Pi extensions: notices and editor drafts their events produce, and
  // runtimes being stopped from the extension panel.
  const extensionEffectsRef = useRef(new PiExtensionEffects());
  const [pendingPluginDrafts, setPendingPluginDrafts] = useState<Record<string, ExtensionEditorRequest | undefined>>({});
  const [stoppingProviderRuntimes, setStoppingProviderRuntimes] = useState<Record<string, boolean>>({});
  // Per-conversation command catalogs (Pi session commands); an epoch bump
  // after a turn refetches them.
  const [providerCommandCatalogs, setProviderCommandCatalogs] = useState<Record<string, ProviderCommandCatalog>>({});
  const [commandEpochs, setCommandEpochs] = useState<Record<string, number>>({});
  const [commandCatalogRevision, setCommandCatalogRevision] = useState(0);
  const refreshProviderCommands = useCallback(() => setCommandCatalogRevision(value => value + 1), []);
  const [controlStatusByConversation, setControlStatusByConversation] = useState<Record<string, 'pending' | 'unknown' | undefined>>({});
  const controlRequestsRef = useRef(new Map<string, string>());
  const controlDraftsRef = useRef(new Map<string, { conversationId: string; text: string }>());
  // Queued messages for a conversation that has no backend id yet (its first
  // prompt is still creating it). Memory only: they are submitted to the
  // backend queue once the id exists, or handed back to the composer.
  const heldFollowUpsRef = useRef(new Map<string, QueuedChatSubmission[]>());
  const [composerAttachments, setComposerAttachments] = useState<Record<string, ComposerAttachmentDraft[]>>({});
  const [composerSelections, setComposerSelections] = useState<Record<string, ComposerSelection>>({});
  const [selectedSkills, setSelectedSkills] = useState<Record<string, SelectedSkillAttachment[]>>({});
  const [turnIds, setTurnIds] = useState<Record<string, string>>({});
  const [thinkingConversations, setThinkingConversations] = useState<Record<string, boolean>>({});
  const [gitDiffByConversation, setGitDiffByConversation] = useState<Record<string, GitDiffState>>({});
  const [selectedGitRepoByWorkspace, setSelectedGitRepoByWorkspace] = useState<Record<string, string>>({});
  const [terminalById, setTerminalById] = useState<Record<string, TerminalClientState>>({});
  // Output goes with the terminal records evicted or removed.
  useEffect(() => {
    terminalStreamsRef.current.retain(Object.keys(terminalById));
  }, [terminalById]);
  // Agent, model and command catalogs are per backend: every workspace reads
  // the catalog of its own backend, and switching back does not refetch blind.
  const [v2ProvidersByBackend, setV2ProvidersByBackend] = useState<Record<string, ProviderDescriptor[]>>({});
  // Conversation manifests as each backend last listed them.
  const [v2ConversationsByBackend, setV2ConversationsByBackend] = useState<Record<string, ConversationManifest[]>>({});
  const v2Conversations = useMemo(() => Object.values(v2ConversationsByBackend).flat(), [v2ConversationsByBackend]);
  const setBackendManifests = useCallback((backendId: string, manifests: ConversationManifest[]) => {
    setV2ConversationsByBackend((current) => (current[backendId] === manifests ? current : { ...current, [backendId]: manifests }));
  }, []);
  /** A complete conversation list of a backend: cached history of the
   * conversations it no longer has goes. */
  const retainCachedHistory = (backendId: string, manifests: readonly ConversationManifest[]) => {
    void historyTailCache?.retainConversations(backendId, new Set(manifests.map((manifest) => manifest.id)));
    // The same complete list tells which private conversations died with a
    // daemon restart (set once forgetDeletedConversations exists below).
    forgetVanishedPrivateRef.current(backendId, manifests);
  };
  const forgetVanishedPrivateRef = useRef<(backendId: string, manifests: readonly ConversationManifest[]) => void>(() => undefined);
  const [capabilityCatalogs, setCapabilityCatalogs] = useState<Partial<Record<ProviderKind, CatalogState>>>({});
  const [providerModelsByBackend, setProviderModelsByBackend] = useState<Record<string, ProviderModelCatalog>>({});
  const [providerModelPreferences, setProviderModelPreferences] = useState<ProviderModelPreferences>({});
  const [providerCommandsByBackend, setProviderCommandsByBackend] = useState<Record<string, Partial<Record<ProviderKind, ProviderCommandDescriptor[]>>>>({});
  const v2Providers = v2ProvidersByBackend[activeBackendConnectionId] ?? EMPTY_PROVIDERS;
  const v2ProvidersByBackendRef = useRef(v2ProvidersByBackend);
  v2ProvidersByBackendRef.current = v2ProvidersByBackend;
  /** Agents of the backend serving a conversation. */
  const providersForConversation = (conversation: { id: string } | null | undefined): ProviderDescriptor[] => (
    (conversation ? v2ProvidersByBackendRef.current[backendIdForConversation(conversation.id)] : undefined) ?? v2ProvidersRef.current
  );
  /** The permission mode a conversation's next prompt runs with, so the
   * composer shows exactly what is sent. A record without its own mode
   * follows the mode last chosen for its agent on its backend. */
  const resolvePermissionMode = (
    conversation: ConversationRecord | null | undefined,
    workspace: WorkspaceRecord | null | undefined,
  ): PermissionMode | null => {
    const remembered = conversation?.provider
      ? providerModelPreferencesRef.current[
        providerModelPreferenceKey(backendIdForConversation(conversation.id), conversation.provider)
      ]?.lastPermissionMode
      : undefined;
    return conversationPermissionMode(conversation, workspace, providersForConversation(conversation), remembered);
  };
  /** Fixes the permission mode of a conversation first listed by `backendId`,
   * resolved as `resolvePermissionMode` would. */
  const manifestRunModes = (
    backendId: string,
    providers: ProviderDescriptor[] = v2ProvidersByBackendRef.current[backendId] ?? [],
  ) => (record: ConversationRecord, workspace: WorkspaceRecord) => {
    const remembered = record.provider
      ? providerModelPreferencesRef.current[providerModelPreferenceKey(backendId, record.provider)]?.lastPermissionMode
      : undefined;
    const permissionMode = conversationPermissionMode(record, workspace, providers, remembered);
    return permissionMode ? { permissionMode } : {};
  };
  const providerModels = providerModelsByBackend[activeBackendConnectionId] ?? EMPTY_PROVIDER_MODELS;
  const providerCommands = providerCommandsByBackend[activeBackendConnectionId] ?? EMPTY_PROVIDER_COMMANDS;
  const setBackendProviders = useCallback((backendId: string, providers: ProviderDescriptor[]) => {
    setV2ProvidersByBackend((current) => {
      const previous = current[backendId];
      // Every connection probe returns a fresh array; keeping the old one when
      // nothing changed stops a reconnect from re-running all discovery.
      if (previous === providers || (previous && JSON.stringify(previous) === JSON.stringify(providers))) return current;
      return { ...current, [backendId]: providers };
    });
  }, []);
  const [contextUsageByConversation, setContextUsageByConversation] = useState<Record<string, ConversationContextUsage>>({});
  const [compactionByConversation, setCompactionByConversation] = useState<Record<string, ContextCompactionState & { recommended?: boolean }>>({});
  const [subagentsByConversation, setSubagentsByConversation] = useState<Record<string, SubagentRun[]>>({});
  /** Child conversations each conversation's agent called (Agent Calling), by local id. */
  const [agentCallsByConversation, setAgentCallsByConversation] = useState<Record<string, AgentCallSession[]>>({});
  const [memoryEntriesByConversation, setMemoryEntriesByConversation] = useState<Record<string, MemoryEntry[]>>({});
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const setConversationRuntimeById = stores.runtime.set;
  const [recoveringConversations, setRecoveringConversations] = useState<Record<string, boolean>>({});
  /** Lazy history opens in flight or failed, by local conversation id; set
   * before any runtime state exists, unlike recoveringConversations. */
  const [openStatusByConversation, setOpenStatusByConversation] = useState<Record<string, ConversationOpenStatus>>({});
  // Per-conversation lazy-history flags for the chat scroll sentinel.
  const [earlierHistory, setEarlierHistory] = useState<Record<string, EarlierHistoryStatus>>({});
  const [submissionStatusByConversation, setSubmissionStatusByConversation] = useState<Record<string, 'sending' | 'running' | 'unknown' | undefined>>({});
  const settledV2TurnsRef = useRef(new Map<string, string>());
  /** Drops per-conversation state the app rebuilds when a conversation is
   * opened again (diff text, subagent and agent-call lists, memories); with
   * `drafts`, also what only a deleted conversation can lose (composer text,
   * attachments that may hold image data). Keeps long sessions bounded. */
  const pruneConversationState = useCallback((ids: readonly string[], { drafts = false }: { drafts?: boolean } = {}) => {
    if (!ids.length) return;
    const without = <T,>(current: Record<string, T>) => {
      if (!ids.some((id) => id in current)) return current;
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    };
    setGitDiffByConversation(without);
    setSubagentsByConversation(without);
    setAgentCallsByConversation(without);
    setMemoryEntriesByConversation(without);
    if (drafts) {
      setChatDrafts(without);
      setComposerSelections(without);
      setComposerAttachments(without);
      setSelectedSkills(without);
    }
  }, [setChatDrafts]);
  // Runtime entries keep their identity until an event changes them; reuse
  // the stamped copy so chat rows stay memoized while other rows stream.
  const stampedTimelineEntriesRef = useRef(new WeakMap<TimelineEntry, TimelineEntry>());
  const stampTimelineEntry = (entry: TimelineEntry, conversationId: string) => {
    const cached = stampedTimelineEntriesRef.current.get(entry);
    if (cached?.conversationId === conversationId) return cached;
    const stamped = { ...entry, conversationId };
    stampedTimelineEntriesRef.current.set(entry, stamped);
    return stamped;
  };
  const runtimeUpdateRef = useRef<(state: ConversationRuntime, applied: ConversationEvent[], recovering: boolean, live: ReadonlySet<number>) => void>(() => {});
  const notifyTurnCompletedRef = useRef<(localId: string, state: ConversationRuntime, turnId: string) => void>(() => {});
  const conversationRecoveryRef = useRef<ConversationRecovery | null>(null);
  // History replays fetch summary events only; folded process groups fetch
  // their full sequence range back when the user expands them.
  const tailCache = historyTailCache;
  if (!conversationRecoveryRef.current) conversationRecoveryRef.current = new ConversationRecovery(
    (id, after, limit) => decryptedHistoryReplay(id, v2ApiForConversation(id).replayEvents(id, after, limit, 'summary'), 'summary', 'extend'),
    (state, applied, recovering, live) => runtimeUpdateRef.current(state, applied, recovering, live), setLastError,
    (id, before, limit) => decryptedHistoryReplay(id, v2ApiForConversation(id).replayEventsBefore(id, before, limit, 'summary'), 'summary', 'start'),
    (id, status) => {
      const localId = stores.conversations.get().find((item) => item.v2ConversationId === id || item.id === id)?.id;
      if (!localId) return;
      setOpenStatusByConversation((current) => {
        if (current[localId] === status) return current;
        const next = { ...current };
        if (status) next[localId] = status;
        else delete next[localId];
        return next;
      });
    },
    (id) => {
      const localId = stores.conversations.get().find((item) => item.v2ConversationId === id || item.id === id)?.id;
      return Boolean(localId && conversationHasPendingWork(localId));
    },
    tailCache ? {
      read: async (id) => {
        const tail = await tailCache.read(backendIdForConversation(id), id);
        if (!tail) return null;
        const events = tail.events as ConversationEvent[];
        const page = await decryptedHistoryReplay(id, Promise.resolve({
          conversationId: id, fromSequence: events[0].sequence, nextSequence: events[events.length - 1].sequence + 1,
          hasMore: false, events, frames: tail.frames,
        }), 'summary');
        return page.events;
      },
      discard: (id) => { void tailCache.discard(backendIdForConversation(id), id); },
    } : undefined,
  );
  // Realtime events project once per animation frame: a streaming burst
  // costs one runtime batch and one timeline render instead of one per delta.
  const conversationEventBatcherRef = useRef<ConversationEventBatcher<ConversationEvent> | null>(null);
  if (!conversationEventBatcherRef.current) conversationEventBatcherRef.current = new ConversationEventBatcher<ConversationEvent>(
    (conversationId, workspaceId, events) => conversationRecoveryRef.current?.receive(conversationId, workspaceId, events),
    (error) => setLastError(error instanceof Error ? error.message : t('rec.submitFailed')),
  );
  // Runtime subagent and usage arrays keep their identity until an event
  // changes them; the copies stamped with local ids are only rebuilt then.
  const projectedRuntimeListsRef = useRef(new Map<string, Pick<ConversationRuntime, 'subagents' | 'agentCalls' | 'usageRecords'>>());


  useEffect(() => {
    setCompactionByConversation((current) => {
      const next = { ...current };
      for (const [conversationId, usage] of Object.entries(contextUsageByConversation)) {
        const status = contextCompactionStatus(usage.usedTokens, usage.contextWindow);
        next[conversationId] = {
          ...next[conversationId],
          status: next[conversationId]?.status && !['idle', 'recommended'].includes(next[conversationId].status) ? next[conversationId].status : status,
          recommended: status === 'recommended',
          usedTokens: usage.usedTokens,
          contextWindow: usage.contextWindow,
          updatedAt: new Date(usage.updatedAt).toISOString(),
        };
      }
      return next;
    });
  }, [contextUsageByConversation]);

  // The transport fields of every profile; list effects restart when one
  // backend is re-pointed or re-paired.
  const backendEndpointsKey = useMemo(() => JSON.stringify(backendConnections.map((profile) => [
    profile.id, profile.serverUrl, profile.deviceSecret, profile.encryptionProtocol, profile.encryptionPublicKey, profile.transportVerified,
  ])), [backendConnections]);
  const directorySyncStatus = directorySyncByBackend[activeBackendConnectionId] ?? (hydrated ? 'ready' : 'loading');

  // A conversation list requested before a create, fork or delete on its
  // backend is stale: merging it would drop the new conversation (or bring
  // the deleted one back) until the next poll, so it is skipped.
  const manifestEpochsRef = useRef(new ManifestEpochs());
  const manifestEpoch = (backendId: string) => manifestEpochsRef.current.current(backendId);
  const bumpManifestEpoch = (backendId: string) => manifestEpochsRef.current.bump(backendId);

  // Private conversations listed by a backend (created here or elsewhere)
  // are excluded from the on-device history cache before anything of them
  // could be flushed.
  useEffect(() => {
    if (!historyTailCache) return;
    for (const item of conversations) {
      if (isPrivateConversation(item) && item.v2ConversationId) historyTailCache.exclude(backendIdForConversation(item.id), item.v2ConversationId);
    }
  }, [conversations]);

  // Every backend's agents and conversation list, refreshed over HTTP.
  useEffect(() => {
    if (!hydrated) return;
    const stops: Array<() => void> = [];
    for (const profile of backendConnectionsRef.current) {
      if (!profile.serverUrl.trim()) continue;
      const api = backendApi(profile);
      const backendId = profile.id;
      let active = true;
      setDirectorySyncByBackend((current) => ({ ...current, [backendId]: 'loading' }));
      const firstEpoch = manifestEpoch(backendId);
      void Promise.all([api.listProviders(), api.listConversations()])
        .then(([providers, conversations]) => {
          if (!active) return;
          setBackendProviders(backendId, providers.providers);
          if (manifestEpoch(backendId) === firstEpoch) {
            setBackendManifests(backendId, conversations.conversations);
            retainCachedHistory(backendId, conversations.conversations);
            setConversations((current) => mergeManifestConversations(current, withDecryptedTitles(backendId, conversations.conversations), stores.workspaces.get(), backendId, manifestRunModes(backendId, providers.providers)));
          }
          setDirectorySyncByBackend((current) => ({ ...current, [backendId]: 'ready' }));
        })
        .catch(() => {
          if (!active) return;
          // Keep this backend's last known agent catalog; the status flags the failure.
          setDirectorySyncByBackend((current) => ({ ...current, [backendId]: 'error' }));
          setBackendManifests(backendId, []);
        });
      const refreshTimer = setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        const epoch = manifestEpoch(backendId);
        void api.listConversations().then((response) => {
          if (!active || manifestEpoch(backendId) !== epoch) return;
          setBackendManifests(backendId, response.conversations);
          retainCachedHistory(backendId, response.conversations);
          setConversations((current) => mergeManifestConversations(current, withDecryptedTitles(backendId, response.conversations), stores.workspaces.get(), backendId, manifestRunModes(backendId)));
        }).catch(() => undefined);
      }, 15000);
      stops.push(() => {
        active = false;
        clearInterval(refreshTimer);
      });
    }
    return () => stops.forEach((stop) => stop());
  }, [backendEndpointsKey, hydrated, setBackendManifests, setBackendProviders]);

  // Each manifest refresh re-checks running conversations: a lazily loaded
  // runtime whose turn started below its window (or whose earlier search
  // failed) would otherwise stay idle with no stop control.
  useEffect(() => {
    const recovery = conversationRecoveryRef.current;
    if (!recovery) return;
    for (const manifest of v2Conversations) {
      if (manifest.status !== 'running' && manifest.status !== 'waiting_permission') continue;
      const state = recovery.get(manifest.id);
      if (state && !state.activeTurnId) void recovery.resolveTurn(manifest.id);
    }
  }, [v2Conversations]);

  const queueV2FollowUpRef = useRef<(conversationId: string, item: QueuedChatSubmission) => Promise<'queued' | 'started' | false>>(async () => false);
  const refreshFollowUpQueueRef = useRef<(conversationId: string) => Promise<void>>(async () => undefined);
  const editFollowUpQueueRef = useRef<(conversationId: string, operation: 'remove' | 'clear' | 'resume' | 'pause', itemId?: string) => Promise<boolean>>(async () => false);
  const flushHeldFollowUpsRef = useRef<(conversationId: string) => Promise<void>>(async () => undefined);

  // Display names for model ids an agent does not describe itself.
  const modelCatalog = useMemo(
    () => mergeModelCatalog(
      [],
      [
        settings.defaultModel,
        ...workspaces.map((workspace) => workspace.model),
      ],
    ),
    [settings.defaultModel, workspaces],
  );

  // Records without a backend tag belong to whichever backend is active.
  const providerModelsFor = useCallback((backendConnectionId: string | null | undefined, provider: ProviderKind | string) => (
    providerModelsByBackendRef.current[backendConnectionId || activeBackendConnectionIdRef.current]?.[provider as ProviderKind]
  ), []);

  const resolveRememberedProviderSelection = useCallback((
    backendConnectionId: string | null | undefined,
    provider: ProviderKind,
    requestedModel?: string | null,
    requestedEffort?: string | null,
    modelsOverride?: ProviderModelDescriptor[],
  ) => {
    const preference = providerModelPreferencesRef.current[
      providerModelPreferenceKey(backendConnectionId, provider)
    ];
    const models = modelsOverride ?? providerModelsFor(backendConnectionId, provider) ?? [];
    const modelDescriptor = resolveProviderModel(models, requestedModel, preference?.lastModel);
    const model = modelDescriptor?.id ?? requestedModel?.trim() ?? preference?.lastModel ?? '';
    const reasoningEffort = modelDescriptor
      ? resolveProviderReasoningEffort(modelDescriptor, [
          requestedEffort,
          preference?.reasoningByModel[modelDescriptor.id],
          modelDescriptor.defaultReasoningEffort,
        ])
      : requestedEffort ?? (model ? preference?.reasoningByModel[model] : undefined) ?? null;
    return { model, reasoningEffort, modelDescriptor };
  }, [providerModelsFor]);

  const rememberProviderModelSelection = useCallback((
    backendConnectionId: string | null | undefined,
    provider: ProviderKind,
    model: string,
    reasoningEffort: string | null,
  ) => {
    const nextModel = model.trim();
    if (!nextModel) return;
    const key = providerModelPreferenceKey(backendConnectionId, provider);
    setProviderModelPreferences((current) => {
      const previous = current[key] ?? { reasoningByModel: {} };
      const next = {
        ...current,
        [key]: {
          ...previous,
          lastModel: nextModel,
          reasoningByModel: reasoningEffort
            ? { ...previous.reasoningByModel, [nextModel]: reasoningEffort }
            : previous.reasoningByModel,
        },
      };
      providerModelPreferencesRef.current = next;
      return next;
    });
  }, []);

  const rememberProviderRunModes = useCallback((
    backendConnectionId: string | null | undefined,
    provider: ProviderKind | string | undefined,
    modes: { permissionMode?: PermissionMode; workMode?: 'plan' | 'implement' },
  ) => {
    if (!provider || (!modes.permissionMode && !modes.workMode)) return;
    const key = providerModelPreferenceKey(backendConnectionId, provider);
    setProviderModelPreferences((current) => {
      const previous = current[key] ?? { reasoningByModel: {} };
      const next = {
        ...current,
        [key]: {
          ...previous,
          ...(modes.permissionMode ? { lastPermissionMode: modes.permissionMode } : {}),
          ...(modes.workMode ? { lastWorkMode: modes.workMode } : {}),
        },
      };
      providerModelPreferencesRef.current = next;
      return next;
    });
  }, []);

  const setConversationChatDraft = useCallback((conversationId: string, value: SetStateAction<string>) => {
    if (!conversationId) {
      return;
    }
    setChatDrafts((current) => {
      const previous = current[conversationId] ?? '';
      const next = typeof value === 'function' ? value(previous) : value;
      if (next === previous) {
        return current;
      }
      return { ...current, [conversationId]: next };
    });
  }, []);

  const setConversationAttachments = useCallback((conversationId: string, value: SetStateAction<ComposerAttachmentDraft[]>) => {
    if (!conversationId) {
      return;
    }
    setComposerAttachments((current) => {
      const previous = current[conversationId] ?? [];
      const next = typeof value === 'function' ? value(previous) : value;
      if (next === previous) {
        return current;
      }
      if (next.length === 0) {
        const { [conversationId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [conversationId]: next };
    });
  }, []);

  const setConversationSelectedSkills = useCallback((conversationId: string, value: SetStateAction<SelectedSkillAttachment[]>) => {
    if (!conversationId) {
      return;
    }
    setSelectedSkills((current) => {
      const previous = current[conversationId] ?? [];
      const next = typeof value === 'function' ? value(previous) : value;
      if (next === previous) {
        return current;
      }
      if (next.length === 0) {
        const { [conversationId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [conversationId]: next };
    });
  }, []);

  // Candidates an older build kept in the client move to the backend queue
  // once (see the migration effect further down); nothing about queued
  // messages is persisted by this client any more.
  const legacyFollowUpsRef = useRef<LegacyFollowUps<QueuedChatSubmission> | null>(null);
  const [legacyFollowUpsLoaded, setLegacyFollowUpsLoaded] = useState(false);
  useEffect(() => {
    let disposed = false;
    void loadJson<unknown>(LEGACY_QUEUED_FOLLOW_UPS_KEY, null).then((value) => {
      if (disposed) return;
      const legacy = restoreQueuedFollowUps<QueuedChatSubmission>(value);
      legacyFollowUpsRef.current = Object.keys(legacy.queues).length > 0 ? legacy : null;
      // Corrupt or empty leftovers carry nothing to migrate: drop the key.
      if (value !== null && !legacyFollowUpsRef.current) void saveJson(LEGACY_QUEUED_FOLLOW_UPS_KEY, undefined).catch(() => undefined);
      setLegacyFollowUpsLoaded(true);
    }).catch(() => {
      if (!disposed) setLegacyFollowUpsLoaded(true);
    });
    // The local rate-limit wait only served backends without a queue.
    void loadJson<unknown>(LEGACY_RATE_LIMITS_KEY, null).then((value) => {
      if (value !== null) return saveJson(LEGACY_RATE_LIMITS_KEY, undefined);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  const setConversationComposerSelection = useCallback((conversationId: string, value: SetStateAction<ComposerSelection>) => {
    if (!conversationId) {
      return;
    }
    setComposerSelections((current) => {
      const previous = current[conversationId] ?? DEFAULT_COMPOSER_SELECTION;
      const next = typeof value === 'function' ? value(previous) : value;
      if (next.start === previous.start && next.end === previous.end) {
        return current;
      }
      return { ...current, [conversationId]: next };
    });
  }, []);

  const setConversationTurnId = useCallback((conversationId: string, value: string) => {
    if (!conversationId) {
      return;
    }
    if (value) {
      turnIdsRef.current = { ...turnIdsRef.current, [conversationId]: value };
    } else {
      const { [conversationId]: _removed, ...rest } = turnIdsRef.current;
      turnIdsRef.current = rest;
    }
    setTurnIds((current) => {
      if ((current[conversationId] ?? '') === value) {
        return current;
      }
      if (!value) {
        const { [conversationId]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [conversationId]: value };
    });
  }, []);

  const setConversationThinking = useCallback((conversationId: string, value: boolean) => {
    if (!conversationId) {
      return;
    }
    thinkingConversationsRef.current = {
      ...thinkingConversationsRef.current,
      [conversationId]: value,
    };
    setThinkingConversations((current) => {
      if ((current[conversationId] === true) === value) {
        return current;
      }
      return { ...current, [conversationId]: value };
    });
  }, []);

  const flushJsonSave = useCallback((key?: string) => {
    const entries = key
      ? Array.from(pendingJsonSavesRef.current.entries()).filter(([entryKey]) => entryKey === key)
      : Array.from(pendingJsonSavesRef.current.entries());

    for (const [entryKey, pending] of entries) {
      clearTimeout(pending.timeoutId);
      pendingJsonSavesRef.current.delete(entryKey);
      void saveJson(entryKey, pending.value);
    }
  }, []);

  const scheduleJsonSave = useCallback(<T,>(key: string, value: T, delayMs = JSON_SAVE_DEBOUNCE_MS) => {
    const previous = pendingJsonSavesRef.current.get(key);
    if (previous) {
      clearTimeout(previous.timeoutId);
    }

    const timeoutId = setTimeout(() => {
      const pending = pendingJsonSavesRef.current.get(key);
      if (!pending || pending.timeoutId !== timeoutId) {
        return;
      }
      pendingJsonSavesRef.current.delete(key);
      void saveJson(key, pending.value);
    }, delayMs);

    pendingJsonSavesRef.current.set(key, { timeoutId, value });
  }, []);



  const closeSocket = useCallback((backendId: string, manual = true) => {
    const link = linksRef.current.get(backendId);
    if (!link) return;
    // Events this socket already delivered are valid; project them before
    // its generation ends.
    conversationEventBatcherRef.current?.flush();
    link.generation += 1;
    link.attempt?.abort();
    link.attempt = null;
    link.verified = false;
    link.healthProbeSeq += 1;
    link.commands.disconnect();
    if (manual) {
      link.manualDisconnect = true;
      patchLinkStatus(backendId, { state: 'closed' });
    }
    if (link.reconnectTimer) {
      clearTimeout(link.reconnectTimer);
      link.reconnectTimer = null;
    }
    if (link.workspaceSyncTimer) {
      clearTimeout(link.workspaceSyncTimer);
      link.workspaceSyncTimer = null;
    }
    link.workspaceReady = false;
    if (link.socket) {
      try {
        link.socket.close();
      } catch {
        // ignore
      }
      link.socket = null;
    }
    // Queued frames of this socket are dropped with it; other backends'
    // frames stay queued.
    pendingSocketFramesRef.current = pendingSocketFramesRef.current.filter((frame) => frame.backendId !== backendId);
    link.pendingFrames = 0;
  }, [patchLinkStatus]);

  const updateSentAttachmentRecords = useCallback((next: SentAttachmentRecord[]) => {
    const pruned = pruneSentAttachmentRecords(next);
    sentAttachmentRecordsRef.current = pruned;
    setSentAttachmentRecords(pruned);
    // Receipts of private conversations hold prompt text and previews: memory only.
    scheduleJsonSave(SENT_ATTACHMENTS_STORAGE_KEY, withoutPrivateEntries(pruned, privateConversationIds(stores.conversations.get())));
  }, [scheduleJsonSave]);

  useEffect(() => {
    return () => {
      flushJsonSave();
      conversationEventBatcherRef.current?.discard();
      pendingServerEventsRef.current = [];
      if (pendingServerEventFrameRef.current !== null) {
        cancelMessageTask(pendingServerEventFrameRef.current);
        pendingServerEventFrameRef.current = null;
      }
      pendingSocketFramesRef.current = [];
      if (pendingSocketFrameDrainRef.current !== null) {
        cancelMessageTask(pendingSocketFrameDrainRef.current);
        pendingSocketFrameDrainRef.current = null;
      }
    };
  }, [flushJsonSave]);

  useEffect(() => {
    const onHide = () => flushJsonSave();
    window.addEventListener('blur', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('blur', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [flushJsonSave]);

  /** Device keys live in the platform's secure key store; a failed read or
   * write is shown instead of silently dropping the key. */
  const reportSecretStoreError = useCallback((error: unknown) => {
    console.error('[storage] device key store failed', error);
    setLastError(error instanceof Error ? error.message : t('sess.credentialSaveFailed'));
  }, []);

  useEffect(() => {
    let alive = true;
    const loadSecretOrReport = (key: string) => loadSecret(key).catch((error: unknown) => {
      if (alive) reportSecretStoreError(error);
      return '';
    });
    (async () => {
      const [
        storedSettings,
        storedWorkspaces,
        storedConversations,
        storedTimeline,
        storedSentAttachments,
        storedActiveSelection,
        storedMentionHistory,
        storedExperimentalFeatures,
        storedUsageRecords,
        storedBackendConnections,
        storedProviderModelPreferences,
        storedWorkspaceTombstones,
        storedDeviceSecret,
        storedDeviceOrigin,
      ] = await Promise.all([
        loadJson<PersistedSettings | null>(SETTINGS_STORAGE_KEY, null),
        loadJson<WorkspaceRecord[]>(WORKSPACES_STORAGE_KEY, []),
        loadJson<ConversationRecord[]>(CONVERSATIONS_STORAGE_KEY, []),
        loadJson<TimelineEntry[]>(TIMELINE_STORAGE_KEY, []),
        loadJson<SentAttachmentRecord[]>(SENT_ATTACHMENTS_STORAGE_KEY, []),
        loadJson<{ workspaceId?: string; conversationId?: string; noneBackendId?: string } | null>(ACTIVE_SELECTION_STORAGE_KEY, null),
        loadJson<WorkspaceMentionHistory[]>(MENTION_HISTORY_STORAGE_KEY, []),
        loadJson<Partial<ExperimentalFeatureSettings> | null>(EXPERIMENTAL_FEATURES_STORAGE_KEY, null),
        loadJson<unknown>(USAGE_RECORDS_STORAGE_KEY, []),
        loadJson<BackendConnectionProfile[]>(BACKEND_CONNECTIONS_STORAGE_KEY, []),
        loadJson<unknown>(PROVIDER_MODEL_PREFERENCES_STORAGE_KEY, {}),
        loadJson<unknown>(WORKSPACE_TOMBSTONES_STORAGE_KEY, []),
        loadSecretOrReport(DEVICE_SECRET_STORAGE_KEY),
        loadSecretOrReport(DEVICE_ORIGIN_STORAGE_KEY),
      ]);

      if (!alive) {
        return;
      }

      const nextSettings = fromPersistedSettings(
        storedSettings,
        credentialMatchesOrigin(storedDeviceOrigin, storedSettings?.serverUrl || defaultSettings.serverUrl) ? storedDeviceSecret : '',
      );
      nextSettings.serverUrl = normalizeServerUrl(nextSettings.serverUrl);
      const storedProfiles = (storedBackendConnections as unknown[]).map(normalizeBackendConnectionProfile).filter((profile): profile is BackendConnectionProfile => Boolean(profile));
      const hydratedProfiles = storedProfiles.length ? await Promise.all(storedProfiles.map(async (profile) => ({ ...profile, deviceSecret: (await loadSecretOrReport(`${DEVICE_SECRET_STORAGE_KEY}.${profile.id}`)) || (profile.id === 'default-backend' ? nextSettings.deviceSecret : '') }))) : [];
      const unmanagedProfiles = hydratedProfiles.length ? hydratedProfiles : [profileFromSettings(nextSettings)];
      // A self-hosted deployment pins the backend list; keys of the profiles
      // it drops are forgotten.
      const deployment = platform.deployment;
      const profiles = deployment
        ? deployment.profiles(hydratedProfiles, profileFromSettings(nextSettings))
        : unmanagedProfiles;
      if (deployment) {
        const kept = new Set(profiles.map((profile) => profile.id));
        for (const profile of storedProfiles) {
          if (!kept.has(profile.id)) void removeSecret(`${DEVICE_SECRET_STORAGE_KEY}.${profile.id}`).catch(reportSecretStoreError);
        }
        nextSettings.serverUrl = profiles[0].serverUrl;
      }
      const normalizedWorkspaces = withNoneWorkspace(storedWorkspaces, () => createNoneWorkspace(nextSettings)).map((workspace) => ({
        ...workspace,
        reasoningEffort: normalizeReasoningEffort(workspace.reasoningEffort),
        threadId: '',
        localAdapterState: 'idle' as LocalAdapterState,
      }));
      const existingWorkspaceIds = new Set(normalizedWorkspaces.map((workspace) => workspace.id));
      const seenSessionIds = new Set<string>();
      const seenThreadIds = new Set<string>();
      // Conversations of the removed local Codex path with anything to show
      // stay as read-only history; empty drafts get an agent when opened.
      const conversationsWithHistory = new Set(storedTimeline.map((entry) => entry.conversationId).filter(Boolean));
      const normalizedConversations =
        storedConversations.length > 0
          ? storedConversations
              .filter((conversation) => existingWorkspaceIds.has(conversation.workspaceId))
              .map((conversation) => {
                const workspace = normalizedWorkspaces.find((item) => item.id === conversation.workspaceId);
                const sessionSeed = workspace ? `${workspace.name}_${conversation.title}` : conversation.title;
                let sessionId = conversation.sessionId || createSessionId(sessionSeed);
                if (seenSessionIds.has(sessionId)) {
                  sessionId = createSessionId(sessionSeed);
                }
                seenSessionIds.add(sessionId);

                let threadId = normalizeThreadId(conversation.threadId);
                if (threadId && seenThreadIds.has(threadId)) {
                  threadId = '';
                }
                if (threadId) {
                  seenThreadIds.add(threadId);
                }

                const legacyCodex = !isV2Conversation(conversation) && (conversation.legacyCodex === true
                  || Boolean(normalizeThreadId(conversation.threadId)) || Boolean(conversation.preview?.trim())
                  || conversationsWithHistory.has(conversation.id));
                return {
                  ...conversation,
                  ...(legacyCodex ? { legacyCodex: true } : {}),
                  sessionId,
                  threadId,
                  preview: conversation.preview || '',
                  nativeStatus: conversation.nativeStatus || '',
                  archived: conversation.archived === true,
                  localAdapterState: 'idle' as LocalAdapterState,
                  mode: (conversation.mode === 'plan' ? 'plan' : 'implement') as ConversationRecord['mode'],
                  goalStatus: conversation.goalStatus || '',
                  goalObjective: conversation.goalObjective || '',
                  // Records predating read tracking start out as read so the
                  // upgrade does not light up every stored conversation.
                  lastReadAt: typeof conversation.lastReadAt === 'number' && Number.isFinite(conversation.lastReadAt)
                    ? conversation.lastReadAt
                    : Date.now(),
                  labelColor: normalizeBackendLabelColor(conversation.labelColor),
                };
              })
          : normalizedWorkspaces.map((workspace) => createDefaultConversation(workspace));
      const storedConversation = normalizedConversations.find((conversation) => conversation.id === storedActiveSelection?.conversationId);
      const storedWorkspace = normalizedWorkspaces.find((workspace) => workspace.id === storedActiveSelection?.workspaceId);
      const firstWorkspaceId = storedConversation?.workspaceId ?? storedWorkspace?.id ?? normalizedWorkspaces[0]?.id ?? '';
      const firstConversationId =
        storedConversation?.id ?? normalizedConversations.find((conversation) => conversation.workspaceId === firstWorkspaceId)?.id ?? '';

      const loadedTombstones = (Array.isArray(storedWorkspaceTombstones) ? storedWorkspaceTombstones : [])
        .map(normalizeWorkspaceTombstone)
        .filter((item): item is WorkspaceTombstone => Boolean(item))
        .slice(0, MAX_WORKSPACE_TOMBSTONES);
      // Untagged records predate parallel connections and belonged to the
      // backend that was active then: the one owning the restored workspace,
      // otherwise the profile the persisted settings point at.
      const restoredWorkspace = normalizedWorkspaces.find((workspace) => workspace.id === firstWorkspaceId);
      const legacyProfile = profiles.find((profile) => profile.id === restoredWorkspace?.backendConnectionId)
        ?? profiles.find((profile) => profile.serverUrl === nextSettings.serverUrl)
        ?? profiles[0];
      const tagged = tagLegacyBackendRecords({
        workspaces: normalizedWorkspaces,
        conversations: normalizedConversations,
        tombstones: loadedTombstones,
      }, legacyProfile?.id ?? '');
      // Profiles saved while an IPC profile and a TCP profile of the same
      // daemon were both enabled list its records twice: the IPC profile
      // takes over before the first render (useIpcDaemonConflicts covers
      // later changes, and loopback profiles matched by address).
      let resolvedProfiles = profiles;
      let records: Pick<typeof tagged, 'workspaces' | 'conversations' | 'tombstones'> = tagged;
      let restoredConversationId = firstConversationId;
      let restoredNoneBackendId = typeof storedActiveSelection?.noneBackendId === 'string' ? storedActiveSelection.noneBackendId : '';
      for (const { loserId, winnerId } of ipcDaemonConflicts(profiles, isIpcServerUrl)) {
        const moved = moveBackendRecords(records, loserId, winnerId);
        records = moved;
        restoredConversationId = moved.conversationIds.get(restoredConversationId) ?? restoredConversationId;
        if (restoredNoneBackendId === loserId) restoredNoneBackendId = winnerId;
        resolvedProfiles = resolvedProfiles.map((profile) => (profile.id === loserId ? { ...profile, disabled: true } : profile));
      }
      setPreferences(nextSettings);
      setBackendConnections(resolvedProfiles);
      setWorkspaces(records.workspaces);
      setWorkspaceTombstones(records.tombstones);
      setConversations(records.conversations);
      setTimeline(storedTimeline.slice(0, MAX_TIMELINE_ITEMS));
      const attachmentRecords = pruneSentAttachmentRecords(Array.isArray(storedSentAttachments) ? storedSentAttachments : []);
      sentAttachmentRecordsRef.current = attachmentRecords;
      setSentAttachmentRecords(attachmentRecords);
      setMentionHistory(storedMentionHistory);
      setExperimentalFeatures(normalizeExperimentalFeatures(storedExperimentalFeatures));
      setUsageRecords(normalizeUsageRecords(storedUsageRecords));
      const normalizedProviderModelPreferences = normalizeProviderModelPreferences(storedProviderModelPreferences);
      providerModelPreferencesRef.current = normalizedProviderModelPreferences;
      setProviderModelPreferences(normalizedProviderModelPreferences);
      setActiveWorkspaceId(firstWorkspaceId);
      setActiveConversationId(restoredConversationId);
      setNoneBackendSelection(restoredNoneBackendId);
      setAutoConnectEnabled(hydratedProfiles.length > 0 || Boolean(storedSettings?.serverUrl?.trim()));
      setHydrated(true);
    })();

    return () => {
      alive = false;
      for (const backendId of linksRef.current.keys()) closeSocket(backendId, false);
    };
  }, [closeSocket, reportSecretStoreError]);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);




  useEffect(() => {
    v2ProvidersRef.current = v2Providers;
  }, [v2Providers]);

  useEffect(() => {
    turnIdsRef.current = turnIds;
  }, [turnIds]);

  useEffect(() => {
    thinkingConversationsRef.current = thinkingConversations;
  }, [thinkingConversations]);

  useEffect(() => {
    terminalByIdRef.current = terminalById;
  }, [terminalById]);

  useEffect(() => {
    providerModelPreferencesRef.current = providerModelPreferences;
  }, [providerModelPreferences]);


  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(SETTINGS_STORAGE_KEY, toPersistedSettings(settings));
    saveSecret(DEVICE_SECRET_STORAGE_KEY, settings.deviceSecret).catch(reportSecretStoreError);
    saveSecret(DEVICE_ORIGIN_STORAGE_KEY, settings.deviceSecret ? normalizeServerUrl(settings.serverUrl) : '').catch(reportSecretStoreError);
  }, [hydrated, reportSecretStoreError, settings]);

  useEffect(() => {
    if (hydrated) {
      void saveJson(BACKEND_CONNECTIONS_STORAGE_KEY, backendConnections.map(({ deviceSecret: _deviceSecret, ...profile }) => profile));
      for (const profile of backendConnections) saveSecret(`${DEVICE_SECRET_STORAGE_KEY}.${profile.id}`, profile.deviceSecret).catch(reportSecretStoreError);
    }
  }, [backendConnections, hydrated, reportSecretStoreError]);

  useEffect(() => {
    if (hydrated) {
      void saveJson(PROVIDER_MODEL_PREFERENCES_STORAGE_KEY, providerModelPreferences);
    }
  }, [hydrated, providerModelPreferences]);

  useEffect(() => {
    if (hydrated) {
      void saveJson(WORKSPACE_TOMBSTONES_STORAGE_KEY, workspaceTombstones);
    }
  }, [hydrated, workspaceTombstones]);


  // Paths already reported missing, per backend.
  const notifyRejectedWorkspaces = useCallback((backendId: string, rejections: WorkspaceSyncRejection[]) => {
    const keys = new Set(rejections.map((item) => `${backendId}\n${normalizeWorkspacePath(item.path)}`));
    const fresh = rejections.filter((item) => !workspaceMissingNotifiedRef.current.has(`${backendId}\n${normalizeWorkspacePath(item.path)}`));
    workspaceMissingNotifiedRef.current = new Set([
      ...[...workspaceMissingNotifiedRef.current].filter((key) => !key.startsWith(`${backendId}\n`)),
      ...keys,
    ]);
    if (fresh.length > 0) {
      setLastError(t('sess.workspacePathMissing', { paths: fresh.map((item) => item.path).join(', ') }));
    }
  }, []);

  const applyWorkspaceSyncRejections = useCallback(
    (backendId: string, rejections: WorkspaceSyncRejection[]) => {
      notifyRejectedWorkspaces(backendId, rejections);
      const missingKeys = new Set(rejections.map((item) => normalizeWorkspacePath(item.path)));
      setWorkspaces((current) => {
        const flagged = current.map((workspace) => flagWorkspaceMissing(workspace, missingKeys, backendId));
        if (flagged.every((workspace, index) => workspace === current[index])) {
          return current;
        }
        workspaceBackendSkipNextSaveRef.current.add(backendId);
        return flagged;
      });
    },
    [notifyRejectedWorkspaces],
  );

  /** Push the workspaces of one backend to it. */
  const syncWorkspacesToBackend = useCallback(
    async (backendId: string, snapshot: WorkspaceRecord[] = stores.workspaces.get()) => {
      const profile = profileFor(backendId);
      if (!profile) return false;
      try {
        const scoped = snapshot.filter((workspace) =>
          !isNoneWorkspaceId(workspace.id) && workspace.backendConnectionId === backendId);
        const body = JSON.stringify({ workspaces: prepareWorkspaceSyncPayload(scoped) });
        const response = await backendFetch(profile, {
          method: 'PUT',
          path: '/v2/workspaces',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body,
        });
        if (!response.ok) throw await readBackendError(response, t('sess.workspaceSyncFailed'));
        const payload = await response.json().catch(() => null);
        applyWorkspaceSyncRejections(backendId, parseWorkspaceSyncRejected(payload));
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : t('sess.workspaceSyncFailed'));
        return false;
      }
    },
    [applyWorkspaceSyncRejections],
  );

  const scheduleWorkspaceBackendSave = useCallback(
    (backendId: string, snapshot: WorkspaceRecord[]) => {
      const link = linksRef.current.get(backendId);
      if (!link) return;
      if (link.workspaceSyncTimer) {
        clearTimeout(link.workspaceSyncTimer);
      }
      const payload = snapshot.filter((workspace) => !isNoneWorkspaceId(workspace.id) && workspace.backendConnectionId === backendId);
      link.workspaceSyncTimer = setTimeout(() => {
        link.workspaceSyncTimer = null;
        void syncWorkspacesToBackend(backendId, payload);
      }, WORKSPACE_SYNC_DEBOUNCE_MS);
    },
    [syncWorkspacesToBackend],
  );

  /** Pull one backend's workspaces into the local list. Its conversation list
   * is fetched too unless `listConversations` is false: the periodic sync
   * leaves it to the manifest refresh, which polls it on its own timer. */
  const syncWorkspacesFromBackend = useCallback(async (backendId: string, { listConversations = true }: { listConversations?: boolean } = {}) => {
    const profile = profileFor(backendId);
    const link = linksRef.current.get(backendId);
    if (!profile || !link) return false;
    link.workspaceReady = false;
    try {
      const response = await backendFetch(profile, {
        method: 'GET',
        path: '/v2/workspaces',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw await readBackendError(response, t('sess.workspaceSyncFailed'));
      const syncBody = await response.json().catch(() => null);
      const remoteWorkspaces = parseWorkspaceSyncResponse(syncBody);
      const remoteRejections = parseWorkspaceSyncRejected(syncBody);
      notifyRejectedWorkspaces(backendId, remoteRejections);
      const merge = mergeWorkspaceDirectory({
        backendId,
        remote: remoteWorkspaces,
        rejections: remoteRejections,
        workspaces: stores.workspaces.get(),
        tombstones: stores.workspaceTombstones.get(),
      });
      // Deleted here while the backend still lists them: delete them again,
      // in case the first DELETE never reached it.
      for (const id of merge.staleRemoteIds) {
        void backendFetch(profile, { method: 'DELETE', path: `/v2/workspaces/${encodeURIComponent(id)}` }).catch(() => {});
      }
      if (merge.survivingTombstones) setWorkspaceTombstones(merge.survivingTombstones);
      const { localScoped: localScopedWorkspaces, nextScoped: nextScopedWorkspaces, nextWorkspaces, keptRemote: keptRemoteWorkspaces } = merge;

      if (nextWorkspaces.length > 0) {
        const remappedConversations = remapWorkspaceScopedRecords(
          stores.conversations.get(),
          localScopedWorkspaces,
          nextScopedWorkspaces,
        );
        const remappedActive = remapWorkspaceScopedRecords(
          [{ workspaceId: activeWorkspaceRef.current }],
          localScopedWorkspaces,
          nextScopedWorkspaces,
        )[0]?.workspaceId ?? activeWorkspaceRef.current;
        // Only the workspace left in view gets a draft: drafts elsewhere are
        // dropped as unused right after, so adding them re-rendered every sync.
        const viewedWorkspaceId = nextWorkspaces.some((workspace) => workspace.id === remappedActive) ? remappedActive : nextWorkspaces[0]?.id ?? '';
        const nextConversations = conversationsForWorkspaceSnapshot(nextWorkspaces, remappedConversations, new Set([viewedWorkspaceId]));
        // The records are read and written synchronously (session stores),
        // so nothing landed between the merge and these writes. An unchanged
        // directory keeps the list (and every consumer) as is; a changed one
        // came from the backend, so it is not pushed back.
        if (JSON.stringify(nextWorkspaces) !== JSON.stringify(stores.workspaces.get())) {
          workspaceBackendSkipNextSaveRef.current.add(backendId);
          setWorkspaces(nextWorkspaces);
        }
        setConversations(nextConversations);
        setTimeline((current) => remapWorkspaceScopedRecords(current, localScopedWorkspaces, nextScopedWorkspaces));
        setMentionHistory((current) => remapWorkspaceScopedRecords(current, localScopedWorkspaces, nextScopedWorkspaces));
        if (remappedActive !== activeWorkspaceRef.current) {
          setActiveWorkspaceId(remappedActive);
        }
        if (!nextWorkspaces.some((workspace) => workspace.id === remappedActive)) {
          const nextWorkspaceId = nextWorkspaces[0]?.id ?? '';
          setActiveWorkspaceId(nextWorkspaceId);
          setActiveConversationId(nextConversations.find((conversation) => conversation.workspaceId === nextWorkspaceId)?.id ?? '');
        } else if (!nextConversations.some((conversation) => conversation.id === activeConversationRef.current)) {
          setActiveConversationId(nextConversations.find((conversation) => conversation.workspaceId === remappedActive)?.id ?? '');
        }
      }

      link.workspaceReady = true;
      if (listConversations) {
        try {
          const epoch = manifestEpoch(backendId);
          const conversationResponse = await backendApi(profile).listConversations();
          if (manifestEpoch(backendId) === epoch) {
            setBackendManifests(backendId, conversationResponse.conversations);
            retainCachedHistory(backendId, conversationResponse.conversations);
            setConversations((current) => mergeManifestConversations(current, withDecryptedTitles(backendId, conversationResponse.conversations), stores.workspaces.get(), backendId, manifestRunModes(backendId)));
          }
        } catch (error) {
          setLastError(error instanceof Error ? error.message : t('sess.conversationDirSyncFailed'));
        }
      }
      if (!workspaceSyncPayloadEquals(keptRemoteWorkspaces, nextScopedWorkspaces)) {
        void syncWorkspacesToBackend(backendId, nextScopedWorkspaces);
      }
      return true;
    } catch (error) {
      link.workspaceReady = true;
      setLastError(error instanceof Error ? error.message : t('sess.workspaceSyncFailed'));
      return false;
    }
  }, [notifyRejectedWorkspaces, setBackendManifests, syncWorkspacesToBackend]);

  // Kanban tasks follow their workspace's backend; the focused backend's
  // zone is the one shown.
  useEffect(() => {
    configureKanbanRouting(activeBackendConnectionId, (workspaceId) => {
      const workspace = stores.workspaces.get().find((item) => item.id === workspaceId);
      return workspace ? ownerBackendId(null, workspace, noWorkspaceBackendIdRef.current) || null : null;
    });
  }, [activeBackendConnectionId]);

  // Every open backend syncs its workspaces and kanban tasks periodically.
  const openBackendIdsKey = Object.entries(linkStatusByBackend)
    .filter(([, status]) => status.state === 'open').map(([backendId]) => backendId).sort().join('\n');
  useEffect(() => {
    if (!hydrated) return;
    const openIds = new Set(openBackendIdsKey ? openBackendIdsKey.split('\n') : []);
    for (const profile of backendConnectionsRef.current) {
      configureKanbanSync(profile.id, openIds.has(profile.id) ? profile : null);
    }
    if (!openIds.size) return;
    const timer = setInterval(() => {
      // A hidden window catches up on its next tick after it is shown again.
      if (document.visibilityState === 'hidden') return;
      for (const backendId of openIds) {
        void syncWorkspacesFromBackend(backendId, { listConversations: false });
        void syncKanbanTasksFromBackend(backendId);
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [backendEndpointsKey, hydrated, openBackendIdsKey, syncWorkspacesFromBackend]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    scheduleJsonSave(WORKSPACES_STORAGE_KEY, workspaces);
    const skipped = workspaceBackendSkipNextSaveRef.current;
    for (const [backendId, link] of linksRef.current) {
      if (skipped.delete(backendId)) continue;
      if (link.workspaceReady && link.socket && link.verified) scheduleWorkspaceBackendSave(backendId, workspaces);
    }
    skipped.clear();
  }, [hydrated, scheduleJsonSave, scheduleWorkspaceBackendSave, workspaces]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    // Private conversations (and their drafts) live in memory only.
    scheduleJsonSave(CONVERSATIONS_STORAGE_KEY, persistableConversations(conversations));
  }, [conversations, hydrated, scheduleJsonSave]);

  // v2 history lives in the backend journal and pages in lazily, so only
  // local-only entries are persisted; unchanged snapshots skip the write.
  const persistedTimelineRef = useRef<TimelineEntry[]>([]);
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const persist = () => {
      const v2ConversationIds = new Set(stores.conversations.get().filter((item) => isV2Conversation(item) || isPrivateConversation(item)).map((item) => item.id));
      const local = stores.timeline.get()
        .filter((entry) => !entry.conversationId || !v2ConversationIds.has(entry.conversationId))
        .slice(0, MAX_TIMELINE_ITEMS);
      const previous = persistedTimelineRef.current;
      if (local.length === previous.length && local.every((entry, index) => entry === previous[index])) return;
      persistedTimelineRef.current = local;
      scheduleJsonSave(TIMELINE_STORAGE_KEY, local);
    };
    persist();
    return stores.timeline.subscribe(persist);
  }, [hydrated, scheduleJsonSave, stores]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    scheduleJsonSave(USAGE_RECORDS_STORAGE_KEY, withoutPrivateEntries(usageRecords, privateConversationIds(stores.conversations.get())).slice(0, MAX_USAGE_RECORDS));
  }, [conversations, hydrated, scheduleJsonSave, usageRecords]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(MENTION_HISTORY_STORAGE_KEY, mentionHistory);
  }, [hydrated, mentionHistory]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(EXPERIMENTAL_FEATURES_STORAGE_KEY, experimentalFeatures);
  }, [experimentalFeatures, hydrated]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    // A private conversation is never named on disk; its workspace is.
    const active = stores.conversations.get().find((item) => item.id === activeConversationId);
    void saveJson(ACTIVE_SELECTION_STORAGE_KEY, {
      workspaceId: activeWorkspaceId,
      conversationId: isPrivateConversation(active) ? '' : activeConversationId,
      noneBackendId: noWorkspaceBackendId,
    });
  }, [activeConversationId, activeWorkspaceId, hydrated, noWorkspaceBackendId, stores]);

  const activeWorkspace = useMemo(() => {
    const workspace = workspaces.find((item) => item.id === activeWorkspaceId) ?? null;
    return workspace && isNoneWorkspaceId(workspace.id)
      ? workspaceForConversation(workspace, conversations.find((item) => item.id === activeConversationId))
      : workspace;
  }, [activeConversationId, activeWorkspaceId, conversations, workspaces]);

  // The None workspace's own path is its backend's scratch root, so model and
  // command discovery work before its first conversation folder exists.
  const scratchWorkspaceRoot = linkStatusByBackend[noWorkspaceBackendId]?.serverVersion?.scratch_workspace_root ?? '';
  useEffect(() => {
    setWorkspaces((current) => {
      const none = current.find((item) => isNoneWorkspaceId(item.id));
      return none && none.path !== scratchWorkspaceRoot
        ? current.map((item) => item === none ? { ...none, path: scratchWorkspaceRoot } : item)
        : current;
    });
  }, [hydrated, scratchWorkspaceRoot]);

  const refreshCapabilityCatalog = useCallback(async (provider: ProviderKind) => {
    const workspacePath = activeWorkspace?.path || settings.defaultWorkspacePath;
    if (!workspacePath) return;
    // Catalogs are keyed by provider only: a reply for the workspace (or
    // backend) left meanwhile must not land in the new one as `ready`.
    const scope = capabilityWorkspaceRef.current;
    setCapabilityCatalogs((current) => ({ ...current, [provider]: { ...(current[provider] ?? {}), status: 'loading', error: undefined } }));
    const api = backendApi(settings);
    try {
      const [skills, mcp] = await Promise.all([
        discoveryLimit(() => api.listSkillCatalog(provider, workspacePath)),
        discoveryLimit(() => api.listMcpCatalog(provider, workspacePath)),
      ]);
      if (capabilityWorkspaceRef.current !== scope) return;
      setCapabilityCatalogs((current) => ({ ...current, [provider]: { status: 'ready', skills, mcp } }));
    } catch (error) {
      if (capabilityWorkspaceRef.current !== scope) return;
      setCapabilityCatalogs((current) => ({
        ...current,
        [provider]: { ...(current[provider] ?? {}), status: 'error', error: error instanceof Error ? error.message : t('sess.catalogReadFailed') },
      }));
    }
  }, [activeWorkspace?.path, settings.deviceSecret, settings.defaultWorkspacePath, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl]);

  useEffect(() => {
    if (!hydrated || !activeWorkspace?.path || v2Providers.length === 0) return;
    // The same path on two backends is two different workspaces.
    const capabilityScope = `${activeBackendConnectionId}\n${activeWorkspace.path}`;
    if (capabilityWorkspaceRef.current !== capabilityScope) {
      capabilityWorkspaceRef.current = capabilityScope;
      setCapabilityCatalogs({});
      return;
    }
    // Failed catalogs are retried once per reconnect, not on every render.
    const retryFailed = capabilityRetryEpochRef.current !== connectionEpoch;
    capabilityRetryEpochRef.current = connectionEpoch;
    for (const provider of v2Providers) {
      const entry = capabilityCatalogs[provider.id];
      if (!entry || (retryFailed && entry.status === 'error')) void refreshCapabilityCatalog(provider.id);
    }
  }, [activeBackendConnectionId, activeWorkspace?.path, capabilityCatalogs, connectionEpoch, hydrated, refreshCapabilityCatalog, v2Providers]);

  useEffect(() => {
    if (!hydrated || !activeWorkspace?.path || v2Providers.length === 0) return;
    const backendId = activeBackendConnectionId;
    const api = backendApi(settings);
    const scope = JSON.stringify([backendId, activeWorkspace.path, settings.serverUrl, settings.deviceSecret]);
    if (modelDiscoveryRef.current.scope !== scope) modelDiscoveryRef.current = emptyDiscoveryProgress(scope);
    const progress = modelDiscoveryRef.current;
    const stale = () => modelDiscoveryRef.current !== progress;
    void Promise.all(v2Providers.filter((item) => (
      item.available && !progress.loaded.has(item.id) && !progress.pending.has(item.id)
    )).map(async (provider) => {
      progress.pending.add(provider.id);
      const result = await retryWithDelays(() => discoveryLimit(() => (
        stale() ? Promise.reject(new Error('model discovery scope changed')) : api.listProviderModels(provider.id, activeWorkspace.path)
      )), {
        delaysMs: MODEL_DISCOVERY_RETRY_DELAYS_MS,
        isCancelled: stale,
        onGiveUp: (error) => console.warn(`${provider.id} model discovery failed`, error),
      }).finally(() => progress.pending.delete(provider.id));
      // Keep the descriptor models while live discovery is unavailable.
      if (!result || stale()) return;
      progress.loaded.add(provider.id);
      setProviderModelsByBackend((current) => {
        const next = { ...current, [backendId]: { ...current[backendId], [provider.id]: result.models } };
        providerModelsByBackendRef.current = next;
        return next;
      });
      const conversation = stores.conversations.get().find((item) => item.id === activeConversationRef.current);
      if (conversation?.provider === provider.id) {
        const selection = resolveRememberedProviderSelection(
          conversation.backendConnectionId ?? backendId,
          provider.id,
          conversation.model,
          conversation.reasoningEffort,
          result.models,
        );
        if (selection.model && (selection.model !== conversation.model || selection.reasoningEffort !== conversation.reasoningEffort)) {
          setConversations((current) => current.map((item) => item.id === conversation.id ? {
            ...item,
            model: selection.model,
            reasoningEffort: selection.reasoningEffort,
          } : item));
        }
        if (selection.model) {
          rememberProviderModelSelection(
            conversation.backendConnectionId ?? backendId,
            provider.id,
            selection.model,
            selection.reasoningEffort,
          );
        }
      }
    }));
  }, [activeBackendConnectionId, activeWorkspace?.path, connectionEpoch, hydrated, rememberProviderModelSelection, resolveRememberedProviderSelection, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl, v2Providers]);

  useEffect(() => {
    if (!hydrated || !activeWorkspace?.path || v2Providers.length === 0) return;
    const backendId = activeBackendConnectionId;
    const api = backendApi(settings);
    const scope = JSON.stringify([backendId, activeWorkspace.path, settings.serverUrl, settings.deviceSecret]);
    if (commandDiscoveryRef.current.scope !== scope) commandDiscoveryRef.current = emptyDiscoveryProgress(scope);
    const progress = commandDiscoveryRef.current;
    const stale = () => commandDiscoveryRef.current !== progress;
    void Promise.all(v2Providers.filter((item) => (
      item.available && !progress.loaded.has(item.id) && !progress.pending.has(item.id)
    )).map(async (provider) => {
      progress.pending.add(provider.id);
      try {
        const result = await discoveryLimit(async () => (stale() ? null : api.listProviderCommands(provider.id, activeWorkspace.path)));
        if (result && !stale()) {
          progress.loaded.add(provider.id);
          setProviderCommandsByBackend((current) => ({
            ...current,
            [backendId]: { ...current[backendId], [provider.id]: result.commands },
          }));
        }
      } catch {
        // Keep the last successful command catalog while the backend recovers.
      } finally {
        progress.pending.delete(provider.id);
      }
    }));
  }, [activeBackendConnectionId, activeWorkspace?.path, connectionEpoch, hydrated, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl, v2Providers]);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );


  // A conversation's command catalog depends on its backend, workspace,
  // provider, native session and runtime (Pi extensions add commands).
  const providerRuntimes = useStoreSelector(stores.runtime, (runtimes) => {
    const next: Record<string, ConversationRuntime['providerRuntime']> = {};
    for (const [localId, state] of Object.entries(runtimes)) if (state.providerRuntime) next[localId] = state.providerRuntime;
    return next;
  }, sameRecordValues);
  const providerCommandContext = useCallback((conversationId: string) => {
    const conversation = conversations.find(item => item.id === conversationId);
    if (!conversation?.provider) return;
    const workspace = workspaces.find(item => item.id === conversation.workspaceId);
    if (!workspace) return;
    const runtime = providerRuntimes[conversationId];
    return { backend: `${activeBackendConnectionId}:${settings.serverUrl}`, workspace: workspace.path,
      provider: conversation.provider, conversationId: conversation.v2ConversationId,
      runtimeId: runtime?.runtimeId, runtimeStatus: runtime?.status, commandEpoch: commandEpochs[conversationId] };
  }, [conversations, workspaces, providerRuntimes, activeBackendConnectionId, settings.serverUrl, commandEpochs]);
  const getProviderCommandCatalog = useCallback((conversationId: string) => {
    const context = providerCommandContext(conversationId);
    const catalog = context && providerCommandCatalogs[commandContextKey(context)];
    return catalog || undefined;
  }, [providerCommandContext, providerCommandCatalogs]);
  const activeCommandContext = activeConversation && providerCommandContext(activeConversation.id);
  const activeCommandKey = activeCommandContext ? commandContextKey(activeCommandContext) : '';
  useEffect(() => {
    if (!hydrated || !activeCommandKey) return;
    const [, workspace, provider, conversationId] = JSON.parse(activeCommandKey) as string[];
    let cancelled = false;
    setProviderCommandCatalogs(current => ({ ...current,
      [activeCommandKey]: { contextKey: activeCommandKey, status: 'loading', commands: [] } }));
    const api = backendApi(settings);
    void api.listProviderCommands(provider as ProviderKind, workspace, conversationId || undefined).then(result => {
      if (!cancelled) setProviderCommandCatalogs(current => ({ ...current,
        [activeCommandKey]: { contextKey: activeCommandKey, status: 'ready', commands: result.commands, source: result.catalogSource } }));
    }).catch((error: unknown) => {
      if (!cancelled) setProviderCommandCatalogs(current => ({ ...current,
        [activeCommandKey]: { contextKey: activeCommandKey, status: 'error', commands: [],
          error: error instanceof Error ? error.message : t('sess.commandCatalogFailed') } }));
    });
    return () => { cancelled = true; };
  }, [hydrated, activeCommandKey, commandCatalogRevision, settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified]);


  const restoreSubmissionDraft = useCallback((conversationId: string, submission: SubmissionDraft) => {
    setConversationChatDraft(conversationId, (current) => current || submission.text);
    setConversationAttachments(conversationId, (current) => current.length ? current : submission.attachments);
    setConversationSelectedSkills(conversationId, (current) => current.length ? current : submission.skills);
  }, [setConversationChatDraft, setConversationAttachments, setConversationSelectedSkills]);

  const restorePendingSubmission = useCallback((conversationId: string) => {
    const submission = pendingV2SubmissionsRef.current.get(conversationId);
    if (submission) restoreSubmissionDraft(conversationId, submission);
  }, [restoreSubmissionDraft]);

  /** A prompt failed in a conversation whose daemon holds the queue. Whether
   * the daemon continues it after a rate limit shows only in the queue
   * snapshot it publishes right after the failure (§6.7); error text is not
   * consulted. Resolves true when the daemon queued a continuation — the
   * prompt stays out of the composer — and false after the prompt went back
   * to the composer with the failure reported. One decision per turn. */
  const awaitBackendContinuation = useCallback((conversationId: string, turnId: string, submission: SubmissionDraft, message: string) => {
    const key = `${conversationId}:${turnId}`;
    const existing = backendContinuationsRef.current.get(key);
    if (existing) return existing.decided;
    let resolve!: (continued: boolean) => void;
    const entry: BackendContinuation = {
      conversationId,
      done: false,
      decided: new Promise<boolean>((settle) => { resolve = settle; }),
      decide: (queue) => {
        if (entry.done) return;
        entry.done = true;
        clearTimeout(entry.timer);
        const rateLimit = backendRateLimitState(queue);
        if (rateLimit.continues) {
          setLastError(t('sess.sessionLimitReached', {
            reset: Number.isFinite(rateLimit.resumeAt) ? formatResetInstant(rateLimit.resumeAt) : '—' }));
          resolve(true);
          return;
        }
        restoreSubmissionDraft(conversationId, submission);
        setLastError(message || t('sess.taskExecFailed'));
        resolve(false);
      },
    };
    // An empty queue publishes nothing after an ordinary failure: ask for the
    // snapshot once the daemon has had time to settle the turn.
    entry.timer = setTimeout(() => {
      void refreshFollowUpQueueRef.current(conversationId).finally(() => {
        const v2Id = stores.conversations.get().find((item) => item.id === conversationId)?.v2ConversationId;
        entry.decide(v2Id ? conversationRecoveryRef.current?.get(v2Id)?.followUps : undefined);
      });
    }, BACKEND_CONTINUATION_SETTLE_MS);
    backendContinuationsRef.current.set(key, entry);
    // Settled decisions stay so a late prompt ACK reuses them; keep a few.
    if (backendContinuationsRef.current.size > 64) {
      backendContinuationsRef.current.delete(backendContinuationsRef.current.keys().next().value!);
    }
    return entry.decided;
  }, [restoreSubmissionDraft, setLastError]);
  useEffect(() => () => {
    for (const entry of backendContinuationsRef.current.values()) clearTimeout(entry.timer);
  }, []);

  const lastSequenceTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  runtimeUpdateRef.current = (state, appliedEvents, recovering, live) => {
    const conversation = stores.conversations.get().find((item) => item.v2ConversationId === state.conversationId || item.id === state.conversationId);
    if (!conversation) return;
    const localId = conversation.id;
    setConversationRuntimeById((current) => ({ ...current, [localId]: state }));
    setPendingPluginDrafts(current => {
      const request = current[localId];
      return request && (request.runtimeId !== state.extensionUi.runtimeId || request.eventId !== state.extensionUi.editorRequest?.eventId || state.providerRuntime?.status === 'stopped')
        ? { ...current, [localId]: undefined } : current;
    });
    for (const event of appliedEvents) {
      const effect = extensionEffectsRef.current.consume(event, state);
      if (effect?.kind === 'notice') {
        const title = t('sess.piNoticeTitle', { conversation: conversation.title || t('sess.piConversation'), level: effect.notice.level === 'error' ? t('pi.noticeError') : effect.notice.level === 'warning' ? t('pi.noticeWarning') : t('pi.noticeInfo') });
        const options = { description: piExtensionPlainText(effect.notice.message).slice(0, 300), timeout: 6000 };
        if (effect.notice.level === 'error') toast.danger(title, options);
        else if (effect.notice.level === 'warning') toast.warning(title, options);
        else toast.info(title, options);
      } else if (effect?.kind === 'editor') {
        if (canApplyPluginDraft(chatDraftsRef.current[localId] ?? '')) {
          setConversationChatDraft(localId, effect.request.text);
          setPendingPluginDrafts(current => ({ ...current, [localId]: undefined }));
        } else setPendingPluginDrafts(current => ({ ...current, [localId]: effect.request }));
      }
    }
    if (state.pendingControl) {
      controlRequestsRef.current.set(localId, state.pendingControl.requestId);
      setControlStatusByConversation(current => withEntry(current, localId, state.pendingControl!.status));
    } else if (!state.activeTurnId) {
      controlRequestsRef.current.delete(localId);
      setControlStatusByConversation(current => withEntry(current, localId, undefined));
    }
    setRecoveringConversations((current) => (current[localId] === recovering ? current : { ...current, [localId]: recovering }));
    const boundAttachments = bindSentAttachmentEvents(sentAttachmentRecordsRef.current, localId, appliedEvents);
    if (boundAttachments !== sentAttachmentRecordsRef.current) updateSentAttachmentRecords(boundAttachments);
    setTimeline((current) => capTimelinePerConversation([
      ...state.timeline.map((entry) => stampTimelineEntry(entry, localId)),
      ...current.filter((entry) => entry.conversationId !== localId),
    ]));
    const hasEarlier = conversationRecoveryRef.current?.hasEarlierHistory(state.conversationId) ?? false;
    setEarlierHistory((current) => {
      const existing = current[localId];
      if (existing?.hasMore === hasEarlier) return current;
      return { ...current, [localId]: { ...existing, hasMore: hasEarlier, loading: existing?.loading ?? false } };
    });
    if (state.contextUsage) setContextUsageByConversation((current) => current[localId] === state.contextUsage ? current : { ...current, [localId]: state.contextUsage! });
    setCompactionByConversation((current) => current[localId] === state.compaction ? current : { ...current, [localId]: state.compaction });
    const projected = projectedRuntimeListsRef.current.get(localId);
    projectedRuntimeListsRef.current.set(localId, { subagents: state.subagents, agentCalls: state.agentCalls, usageRecords: state.usageRecords });
    if (projected?.subagents !== state.subagents) {
      setSubagentsByConversation((current) => ({ ...current, [localId]: state.subagents.map((run) => ({ ...run, conversationId: localId })) }));
    }
    if (projected?.agentCalls !== state.agentCalls) {
      setAgentCallsByConversation((current) => ({ ...current, [localId]: state.agentCalls }));
    }
    setMemoryEntriesByConversation((current) => current[localId] === state.memoryEntries ? current : { ...current, [localId]: state.memoryEntries });
    if (projected?.usageRecords !== state.usageRecords) {
      setUsageRecords((current) => [
        ...state.usageRecords.map((record) => ({ ...record, conversationId: localId,
          provider: record.provider === 'unknown' ? conversation.provider || 'unknown' : record.provider,
          model: record.model === 'unknown' ? conversation.model || 'unknown' : record.model,
        })),
        ...current.filter((record) => record.conversationId !== localId),
      ].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_USAGE_RECORDS));
    }
    let completedAt = 0;
    for (const event of appliedEvents) {
      const data = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? event.payload as Record<string, unknown> : {};
      const type = canonicalConversationEventType(event);
      const turnId = typeof data.turnId === 'string' ? data.turnId : '';
      const requestId = data.clientRequestId ?? data.requestId;
      const submission = pendingV2SubmissionsRef.current.get(localId);
      if (submission && requestId === submission.requestId && turnId) {
        submission.turnId = turnId;
        submission.phase = 'running';
        setSubmissionStatusByConversation((current) => ({ ...current, [localId]: 'running' }));
      }
      if (type === 'followups.updated') {
        // The daemon's queue after a failure tells whether it continues the
        // prompt. A snapshot that neither continues nor pauses predates it.
        const queue = parseFollowUpQueue(data);
        if (queue.paused || backendRateLimitState(queue).continues) {
          for (const entry of backendContinuationsRef.current.values()) {
            if (entry.conversationId === localId && !entry.done) entry.decide(queue);
          }
        }
      }
      if (type === 'control.completed' || type === 'control.rejected') {
        const id = typeof data.requestId === 'string' ? data.requestId : '';
        const draft = controlDraftsRef.current.get(id);
        if (draft && type === 'control.completed') {
          setConversationChatDraft(draft.conversationId, current => current.trim() === draft.text.trim() ? '' : current);
        }
        controlDraftsRef.current.delete(id);
      }
      if (type === 'control.unknown' && data.requestId === controlRequestsRef.current.get(localId)) {
        setControlStatusByConversation(current => withEntry(current, localId, 'unknown'));
      }
      if ((type === 'control.completed' || type === 'control.rejected')
        && data.requestId === controlRequestsRef.current.get(localId)) {
        controlRequestsRef.current.delete(localId);
        setControlStatusByConversation(current => withEntry(current, localId, undefined));
        if (type === 'control.rejected') setLastError(typeof data.message === 'string' ? data.message : t('sess.agentControlRejected'));
      }
      if (['turn.completed', 'turn.cancelled', 'turn.failed', 'turn.interrupted'].includes(type)) {
        // A realtime frame is news even when it lands inside a history replay.
        const replayed = recovering && !live.has(event.sequence);
        completedAt = Math.max(completedAt, Date.parse(event.time) || Date.now());
        // Extensions can change their catalog or native session during a turn;
        // Claude's slash-command catalog likewise only arrives once a turn's
        // initialize exchange has run.
        if (conversation.provider === 'pi' || conversation.provider === 'claude-code') setCommandEpochs(current => (current[localId] ?? 0) >= event.sequence
          ? current : { ...current, [localId]: event.sequence });
        const settledKey = turnId ? `${state.conversationId}:${turnId}` : '';
        const firstSettle = Boolean(settledKey) && !settledV2TurnsRef.current.has(settledKey);
        if (turnId) {
          settledV2TurnsRef.current.set(settledKey, type);
          if (settledV2TurnsRef.current.size > 2000) settledV2TurnsRef.current.delete(settledV2TurnsRef.current.keys().next().value!);
        }
        if (type === 'turn.completed' && firstSettle && !replayed) {
          notifyTurnCompletedRef.current(localId, state, turnId);
        }
        // A daemon that holds the queue handles rate limits itself — for every
        // client and with no window open — and reports them only through its
        // queue snapshot, so its error text is not parsed.
        const backendQueued = hasBackendQueue(providersForConversation(stores.conversations.get().find((item) => item.id === localId)), stores.conversations.get().find((item) => item.id === localId));
        if (submission && turnId && submission.turnId === turnId) {
          if (type === 'turn.failed' && backendQueued) {
            void awaitBackendContinuation(localId, turnId, submission,
              typeof data.message === 'string' ? data.message : '');
          } else if (type === 'turn.failed') {
            restorePendingSubmission(localId);
            setLastError(typeof data.message === 'string' ? data.message : t('sess.taskExecFailed'));
          }
          pendingV2SubmissionsRef.current.delete(localId);
          setSubmissionStatusByConversation((current) => ({ ...current, [localId]: undefined }));
        }
      }
    }
    setConversationTurnId(localId, state.activeTurnId);
    const pending = pendingV2SubmissionsRef.current.get(localId);
    setConversationThinking(localId, Boolean(state.activeTurnId) || pending?.phase === 'sending');
    // The record's high-water mark follows the runtime: right away when a
    // turn ends, otherwise at most every LAST_SEQUENCE_WRITE_MS, so a stream
    // of deltas does not rewrite the conversation list (and re-render the
    // app) for each one. Recovery reads the runtime's own sequence.
    const writeLastSequence = () => {
      lastSequenceTimersRef.current.delete(localId);
      setConversations((current) => {
        const index = current.findIndex((item) => item.id === localId);
        if (index < 0) return current;
        const applied = stores.runtime.get()[localId]?.appliedSequence ?? state.appliedSequence;
        const lastSequence = Math.max(current[index].lastSequence ?? 0, applied);
        const lastCompletedAt = Math.max(current[index].lastCompletedAt ?? 0, completedAt);
        if (lastSequence === current[index].lastSequence && lastCompletedAt === current[index].lastCompletedAt) return current;
        const next = [...current];
        next[index] = { ...next[index], lastSequence, lastCompletedAt };
        return next;
      });
    };
    const pendingWrite = lastSequenceTimersRef.current.get(localId);
    if (completedAt > 0) {
      if (pendingWrite) clearTimeout(pendingWrite);
      writeLastSequence();
    } else if (!pendingWrite && state.appliedSequence > (conversation.lastSequence ?? 0)) {
      lastSequenceTimersRef.current.set(localId, setTimeout(writeLastSequence, LAST_SEQUENCE_WRITE_MS));
    }
  };
  useEffect(() => () => {
    for (const timer of lastSequenceTimersRef.current.values()) clearTimeout(timer);
  }, []);

  /** Open a conversation lazily: only the newest history window is fetched
   * from the journal tail; earlier events page in on scroll. Falls back to a
   * full forward replay when the runtime is already initialized. */
  const openConversation = useCallback(async (conversationId: string) => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId || item.v2ConversationId === conversationId);
    const v2Id = conversation?.v2ConversationId;
    if (!v2Id || !conversation) return;
    const status = conversation.nativeStatus ?? '';
    await conversationRecoveryRef.current!.open(v2Id, conversation.workspaceId, {
      highWater: conversation.lastSequence ?? 0,
      turnActive: status === 'running' || status === 'waiting_permission',
    });
    await refreshFollowUpQueueRef.current(conversation.id);
  }, []);

  const recoverConversation = useCallback(async (conversationId: string) => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId || item.v2ConversationId === conversationId);
    const v2Id = conversation?.v2ConversationId;
    if (!v2Id || !conversation) return;
    // Without a loaded runtime a forward replay would read the whole journal;
    // open lazily from the tail instead. A failed open retries as an open so
    // its status settles.
    if (!conversationRecoveryRef.current!.get(v2Id) || conversationRecoveryRef.current!.openStatus(v2Id) === 'failed') {
      await openConversation(conversation.id);
      return;
    }
    await conversationRecoveryRef.current!.recover(v2Id, conversation.workspaceId, conversation.lastSequence ?? 0);
  }, [openConversation]);

  /** Fetch and prepend the next older history page. Resolves false when no
   * earlier events remain or a page is in flight. Every call fetches, so an
   * explicit retry after a failure goes through here; automatic triggers
   * check `canAutoLoadEarlierHistory` first. */
  const loadEarlierHistory = useCallback(async (conversationId: string) => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId);
    const v2Id = conversation?.v2ConversationId;
    const recovery = conversationRecoveryRef.current;
    if (!conversation || !v2Id || !recovery || recovery.isLoadingEarlier(v2Id) || !recovery.hasEarlierHistory(v2Id)) {
      return false;
    }
    setEarlierHistory((current) => ({ ...current, [conversation.id]: { hasMore: true, loading: true } }));
    let result: EarlierHistoryResult | undefined;
    try {
      result = await recovery.loadEarlier(v2Id, conversation.workspaceId);
      return result.hasMore;
    } finally {
      const failed = !result || result.failed === true;
      setEarlierHistory((current) => ({
        ...current,
        [conversation.id]: { hasMore: recovery.hasEarlierHistory(v2Id), loading: false,
          ...(failed ? { failed } : {}), ...(result?.capped ? { capped: true } : {}) },
      }));
    }
  }, []);

  // Returning to a conversation lets it page history in on its own again.
  useEffect(() => {
    if (!activeConversationId) return;
    setEarlierHistory((current) => {
      const status = current[activeConversationId];
      if (!status?.failed) return current;
      const { failed: _failed, ...rest } = status;
      return { ...current, [activeConversationId]: rest };
    });
  }, [activeConversationId]);

  /** A lost prompt ACK leaves the submission 'unknown'. Replaying the journal
   * settles it: a recorded turn binds its clientRequestId and flips the phase
   * to 'running'; a complete replay without a match means the prompt never
   * reached the backend, so the draft returns to the composer. */
  const reconcilePendingSubmission = useCallback(async (conversationId: string) => {
    const submission = pendingV2SubmissionsRef.current.get(conversationId);
    if (submission?.phase !== 'unknown') return;
    const settled = () => pendingV2SubmissionsRef.current.get(conversationId) !== submission
      || submission.phase !== 'unknown' || Boolean(submission.turnId);
    const unfinished = () => {
      const v2Id = stores.conversations.get().find((item) => item.id === conversationId)?.v2ConversationId;
      return !v2Id || (conversationRecoveryRef.current?.isRecovering(v2Id) ?? true);
    };
    await recoverConversation(conversationId);
    if (settled() || unfinished()) return;
    // The ACK can be lost while the backend is still journaling the prompt;
    // allow one settle window before concluding it never arrived.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    if (settled()) return;
    await recoverConversation(conversationId);
    if (settled() || unfinished()) return;
    restorePendingSubmission(conversationId);
    pendingV2SubmissionsRef.current.delete(conversationId);
    updateSentAttachmentRecords(sentAttachmentRecordsRef.current.filter((record) =>
      record.conversationId !== conversationId || record.requestId !== submission.requestId || Boolean(record.eventId)));
    setSubmissionStatusByConversation((current) => ({ ...current, [conversationId]: undefined }));
    setConversationThinking(conversationId, false);
    setLastError(t('sess.sendRestoredDraft'));
  }, [recoverConversation, restorePendingSubmission, setConversationThinking, updateSentAttachmentRecords, setLastError]);

  // Runtime caches are only invalid when a profile is re-pointed or
  // re-paired (or removed). Its socket closes, queued commands addressed to
  // the old endpoint are dropped, and projections reopen from the journal;
  // changing focus between backends keeps everything.
  const runtimeEndpointsRef = useRef<Map<string, string> | null>(null);
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  useEffect(() => {
    if (!hydrated) return;
    const previous = runtimeEndpointsRef.current;
    const next = new Map(backendConnections.map((profile) => [profile.id, JSON.stringify([
      normalizeServerUrl(profile.serverUrl), profile.deviceSecret, profile.encryptionProtocol, profile.encryptionPublicKey, profile.transportVerified,
    ])]));
    runtimeEndpointsRef.current = next;
    if (!previous) return;
    const changed = [...previous].filter(([backendId, endpoint]) => next.get(backendId) !== endpoint).map(([backendId]) => backendId);
    if (!changed.length) return;
    for (const backendId of changed) {
      const link = linksRef.current.get(backendId);
      if (!link) continue;
      closeSocket(backendId, false);
      link.commands.dispose();
      if (next.has(backendId)) {
        // Connects again on Connect or once pairing completes.
        patchLinkStatus(backendId, { state: 'idle', error: '', health: defaultConnectionHealth, serverVersion: null, starting: false });
      } else {
        linksRef.current.delete(backendId);
        setLinkStatusByBackend(({ [backendId]: _removed, ...rest }) => rest);
      }
    }
    // Only the conversations of the changed backends reopen from the journal.
    const changedIds = new Set(changed);
    conversationEventBatcherRef.current?.flush();
    const recovery = conversationRecoveryRef.current;
    const released: string[] = [];
    for (const v2Id of recovery?.loadedConversationIds() ?? []) {
      if (!changedIds.has(backendIdForConversation(v2Id))) continue;
      recovery?.release(v2Id);
      const localId = stores.conversations.get().find((item) => item.v2ConversationId === v2Id || item.id === v2Id)?.id;
      if (localId) released.push(localId);
      for (const key of [...settledV2TurnsRef.current.keys()]) {
        if (key.startsWith(`${v2Id}:`)) settledV2TurnsRef.current.delete(key);
      }
    }
    if (released.length) {
      const withoutReleased = <T,>(current: Record<string, T>) => {
        if (!released.some((id) => id in current)) return current;
        const next = { ...current };
        for (const id of released) delete next[id];
        return next;
      };
      for (const id of released) projectedRuntimeListsRef.current.delete(id);
      setConversationRuntimeById(withoutReleased);
      setRecoveringConversations(withoutReleased);
      setOpenStatusByConversation(withoutReleased);
      setEarlierHistory(withoutReleased);
      pruneConversationState(released);
    }
    // Agent extension state and command catalogs are rebuilt on demand.
    extensionEffectsRef.current.reset();
    setPendingPluginDrafts({});
    setProviderCommandCatalogs({});
    setCommandEpochs({});
    setStoppingProviderRuntimes({});
    setRuntimeRevision((value) => value + 1);
  }, [backendConnections, closeSocket, hydrated, patchLinkStatus]);

  useEffect(() => {
    if (!hydrated || !activeConversation?.v2ConversationId || !settings.serverUrl.trim()) return;
    void openConversation(activeConversation.id);
    // An opened conversation must hold a live subscription even when it was
    // past the auto-subscribe budget at connect time; the helper evicts the
    // oldest background subscription if needed.
    if (activeConversation.archived !== true) {
      subscribeV2ConversationRef.current(activeConversation.v2ConversationId, {
        afterSequence: Math.max(
          conversationRecoveryRef.current?.get(activeConversation.v2ConversationId)?.appliedSequence ?? 0,
          activeConversation.lastSequence ?? 0,
        ),
        limit: 200,
      });
    }
  }, [activeConversation?.id, activeConversation?.v2ConversationId, hydrated, openConversation, runtimeRevision, settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified]);

  // Only recently viewed conversations keep their projected history in
  // memory, the less recent ones trimmed to their newest rows. Older ones,
  // and runtimes live frames created for conversations
  // never opened here, are released and reopen lazily from the journal tail;
  // busy conversations (running, awaiting approval, queued or unconfirmed
  // prompts, loading) are always kept.
  const recentConversationIdsRef = useRef<string[]>([]);
  const releaseIdleConversationRuntimes = useCallback(() => {
    const recovery = conversationRecoveryRef.current;
    if (!recovery) return;
    const localIdFor = (v2Id: string) => stores.conversations.get().find((item) => item.v2ConversationId === v2Id || item.id === v2Id)?.id;
    const busy = (localId: string, state: ConversationRuntime | undefined) =>
      Boolean(state && isConversationRuntimeBusy(state)) || conversationHasPendingWork(localId);
    const recent = recentConversationIdsRef.current;
    const kept: string[] = [];
    const released: string[] = [];
    for (const [index, localId] of recent.entries()) {
      const v2Id = stores.conversations.get().find((item) => item.id === localId)?.v2ConversationId;
      const state = v2Id ? recovery.get(v2Id) : undefined;
      if (index < RETAINED_CONVERSATION_RUNTIMES || busy(localId, state)) kept.push(localId);
      else if (!v2Id || !state) continue; // nothing loaded to release
      else if (index < RETAINED_CONVERSATION_TAILS && recovery.trim(v2Id, RETAINED_TAIL_ROWS)) kept.push(localId);
      else if (recovery.release(v2Id)) released.push(localId);
      else kept.push(localId); // a page is in flight; retry on the next sweep
    }
    const recentIds = new Set(recent);
    for (const v2Id of recovery.loadedConversationIds()) {
      const localId = localIdFor(v2Id);
      if (localId && recentIds.has(localId)) continue;
      if (localId && busy(localId, recovery.get(v2Id))) continue;
      if (!localId && isConversationRuntimeBusy(recovery.get(v2Id)!)) continue;
      if (recovery.release(v2Id) && localId) released.push(localId);
    }
    recentConversationIdsRef.current = kept;
    if (!released.length) return;
    const releasedIds = new Set(released);
    const withoutReleased = <T,>(current: Record<string, T>) => {
      if (!released.some((id) => id in current)) return current;
      const next = { ...current };
      for (const id of released) delete next[id];
      return next;
    };
    for (const id of released) projectedRuntimeListsRef.current.delete(id);
    setConversationRuntimeById(withoutReleased);
    setRecoveringConversations(withoutReleased);
    setOpenStatusByConversation(withoutReleased);
    setEarlierHistory(withoutReleased);
    pruneConversationState(released);
    setTimeline((current) => current.some((entry) => entry.conversationId && releasedIds.has(entry.conversationId))
      ? current.filter((entry) => !entry.conversationId || !releasedIds.has(entry.conversationId)) : current);
  }, []);
  useEffect(() => {
    if (!activeConversationId) return;
    recentConversationIdsRef.current = [activeConversationId, ...recentConversationIdsRef.current.filter((id) => id !== activeConversationId)];
    releaseIdleConversationRuntimes();
    void historyTailCache?.flushAll();
  }, [activeConversationId, releaseIdleConversationRuntimes]);
  // Background conversations settle without a switch; each manifest refresh
  // releases the ones that went idle.
  useEffect(() => {
    releaseIdleConversationRuntimes();
  }, [releaseIdleConversationRuntimes, v2Conversations]);


  const getConversationContext = useCallback((conversationId = activeConversationRef.current): ConversationContext | null => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId) ?? null;
    const workspace = conversation
      ? stores.workspaces.get().find((item) => item.id === conversation.workspaceId) ?? null
      : null;
    return workspace && conversation ? { workspace: workspaceForConversation(workspace, conversation), conversation } : null;
  }, []);

  // Open permission requests of every projected conversation (a resolved one
  // leaves its runtime's `pendingPermissions`).
  // Re-renders the session only when a conversation's open permissions change.
  const permissionRuntimes = useStoreSelector(stores.runtime, (runtimes) => {
    const next: Record<string, { conversationId: string; pendingPermissions: ConversationRuntime['pendingPermissions']; caughtUp: boolean }> = {};
    for (const [localId, state] of Object.entries(runtimes)) {
      next[localId] = { conversationId: state.conversationId, pendingPermissions: state.pendingPermissions, caughtUp: state.appliedSequence >= state.highWaterSequence };
    }
    return next;
  }, (left, right) => sameRecordValues(left, right, (a, b) => a.conversationId === b.conversationId && a.pendingPermissions === b.pendingPermissions && a.caughtUp === b.caughtUp));
  const pendingRequests = useMemo<PendingRequest[]>(() => {
    const open = new Map<string, PendingRequest>();
    for (const [localId, state] of Object.entries(permissionRuntimes)) {
      if (recoveringConversations[localId] || !state.caughtUp) continue;
      const conversation = conversations.find((item) => item.id === localId);
      for (const permission of state.pendingPermissions) {
        const request = classifyPendingRequest({ type: 'conversation.permission.request', payload: {
          ...permission.payload, requestId: permission.id, permissionId: permission.id,
          conversationId: state.conversationId, sessionId: conversation?.sessionId,
        } });
        if (request) open.set(request.requestId, request);
      }
    }
    return [...open.values()];
  }, [permissionRuntimes, recoveringConversations, conversations]);

  const updateWorkspace = useCallback((id: string, patch: Partial<WorkspaceRecord>) => {
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === id
          ? {
              ...workspace,
              ...patch,
              updatedAt: Date.now(),
              // A changed path needs a fresh backend verdict.
              ...(patch.path !== undefined && normalizeWorkspacePath(patch.path) !== normalizeWorkspacePath(workspace.path)
                ? { pathMissing: undefined }
                : null),
            }
          : workspace,
      ),
    );
  }, []);

  const clearWorkspaceTombstone = useCallback((path: string, backendConnectionId: string | null) => {
    const key = normalizeWorkspacePath(path);
    const next = stores.workspaceTombstones.get().filter((item) => {
      if (normalizeWorkspacePath(item.path) !== key) {
        return true;
      }
      const scope = item.backendConnectionId ?? null;
      return scope !== null && scope !== backendConnectionId;
    });
    if (next.length !== stores.workspaceTombstones.get().length) {
      setWorkspaceTombstones(next);
    }
  }, []);

  const updateConversation = useCallback((id: string, patch: Partial<ConversationRecord>) => {
    setConversations((current) =>
      current.map((conversation) => {
        if (conversation.id !== id) return conversation;
        return { ...conversation, ...patch, updatedAt: Date.now() };
      }),
    );
  }, []);

  // Read marking goes through a dedicated path: bumping updatedAt or
  // lastCompletedAt would disturb sidebar ordering and turn bookkeeping.
  const markConversationRead = useCallback((conversationId: string, seenUntil = Date.now()) => {
    setConversations((current) => {
      const index = current.findIndex((item) => item.id === conversationId);
      if (index < 0) return current;
      const readAt = Date.now();
      // Already read past everything it shows: no write, no re-render.
      if ((current[index].lastReadAt ?? 0) >= Math.min(seenUntil, readAt)) return current;
      const next = [...current];
      next[index] = { ...next[index], lastReadAt: readAt };
      return next;
    });
  }, []);

  const setConversationLabelColor = useCallback((conversationId: string, labelColor?: string) => {
    updateConversation(conversationId, { labelColor: normalizeBackendLabelColor(labelColor) });
  }, [updateConversation]);

  // A conversation counts as read while it is on screen in a focused window:
  // opening it, refocusing the app, or watching replies stream in all clear
  // the unread marker. Activity that lands while hidden stays unread. Only
  // new activity (a later row, completion or status) re-marks it, so
  // streaming into an existing row writes nothing.
  const activeRowsAt = useStoreSelector(stores.timeline, (rows) => {
    let latest = 0;
    for (const entry of rows) {
      if (entry.conversationId === activeConversationId && entry.at > latest) latest = entry.at;
    }
    return latest;
  });
  const activeAttentionAt = Math.max(activeRowsAt, activeConversationRecord?.updatedAt ?? 0, activeConversationRecord?.lastCompletedAt ?? 0);
  useEffect(() => {
    const markActiveRead = () => {
      if (!activeConversationId) return;
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      markConversationRead(activeConversationId, activeAttentionAt || Date.now());
    };
    markActiveRead();
    window.addEventListener('focus', markActiveRead);
    document.addEventListener('visibilitychange', markActiveRead);
    return () => {
      window.removeEventListener('focus', markActiveRead);
      document.removeEventListener('visibilitychange', markActiveRead);
    };
  }, [activeConversationId, activeAttentionAt, markConversationRead]);



  const appendTimeline = useCallback((entry: TimelineEntry) => {
    setTimeline((current) => capTimelinePerConversation([entry, ...current]));
  }, []);

  const rememberMentionReferences = useCallback((workspaceId: string, references: MentionReference[]) => {
    const files = references
      .filter((reference) => reference.kind === 'file')
      .map((reference) => reference.value.trim())
      .filter(Boolean);

    if (!files.length) {
      return;
    }

    setMentionHistory((current) => {
      const existing = current.find((item) => item.workspaceId === workspaceId);
      const merged = [...files, ...(existing?.files ?? [])]
        .filter((file, index, list) => list.findIndex((candidate) => candidate === file) === index)
        .slice(0, 20);
      const nextRecord: WorkspaceMentionHistory = {
        workspaceId,
        files: merged,
        updatedAt: Date.now(),
      };
      return [nextRecord, ...current.filter((item) => item.workspaceId !== workspaceId)].slice(0, 50);
    });
  }, []);









  /** Shows an error inside the terminal, in red, like the backend's own errors. */
  const appendTerminalError = useCallback((terminalId: string, text: string) => {
    terminalStreamsRef.current.get(terminalId).append(`\r\n\x1b[31m${text.replace(/\r?\n/g, '\r\n')}\x1b[0m\r\n`);
  }, []);

  const startTerminalSessionRef = useRef<((target: TerminalTarget, options: TerminalStartOptions) => boolean) | null>(null);

  const handleTerminalEvent = useCallback((event: ServerEvent, data: Record<string, unknown>) => {
    if (event.type === 'error') {
      if (data.code === 'EVENT_STREAM_LAGGED') {
        // Terminal output the socket fell behind on is not replayed by the
        // event stream: fetch it from each terminal's retained output.
        reattachTerminalsRef.current();
        return false;
      }
      const failedTerminalId = typeof data.terminalId === 'string' ? data.terminalId : '';
      if (!failedTerminalId || !terminalByIdRef.current[failedTerminalId]) {
        return false;
      }
      const message = typeof data.message === 'string' ? data.message : 'terminal error';
      if (/is not running/.test(message)) {
        // The backend lost this terminal (e.g. it restarted): end it here too,
        // so local shells restart and SSH tabs offer Reconnect.
        setTerminalById((current) => {
          const existing = current[failedTerminalId];
          if (!existing || (existing.status !== 'running' && existing.status !== 'stopping')) return current;
          return { ...current, [failedTerminalId]: { ...existing, status: 'exited', exitCode: null, updatedAt: Date.now() } };
        });
      } else {
        appendTerminalError(failedTerminalId, message);
        // A start the backend refused: leave "starting" for the error state.
        setTerminalById((current) => {
          const existing = current[failedTerminalId];
          if (!existing || existing.status !== 'starting') return current;
          return { ...current, [failedTerminalId]: { ...existing, status: 'error', error: message, updatedAt: Date.now() } };
        });
      }
      return true;
    }
    if (!event.type.startsWith('terminal.')) {
      return false;
    }
    if (event.type === 'terminal.audit') {
      return true;
    }

    const rawTerminalId = data.terminalId ?? data.terminal_id ?? event.pane_id;
    const terminalId = typeof rawTerminalId === 'string' ? rawTerminalId : '';
    if (!terminalId && event.type !== 'terminal.status') {
      return true;
    }

    // Output and keystroke acknowledgements never touch React state.
    if (event.type === 'terminal.output') {
      const text = typeof data.data === 'string' ? data.data : '';
      const seq = typeof data.seq === 'number' ? data.seq : undefined;
      if (text && terminalStreamsRef.current.get(terminalId).applyOutput(text, seq) === 'gap') {
        attachTerminalRef.current(terminalId);
      }
      return true;
    }
    if (event.type === 'terminal.input.accepted') {
      return true;
    }
    if (event.type === 'terminal.cleared') {
      terminalStreamsRef.current.get(terminalId).clear();
      return true;
    }
    if (event.type === 'terminal.attached') {
      attachSentAtRef.current.delete(terminalId);
    }
    if (event.type === 'terminal.attached' && data.running !== true) {
      const start = startOnMissingRef.current.get(terminalId);
      startOnMissingRef.current.delete(terminalId);
      if (start) {
        start();
        return true;
      }
      setTerminalById((current) => {
        const existing = current[terminalId];
        if (!existing || (existing.status !== 'running' && existing.status !== 'stopping')) return current;
        return { ...current, [terminalId]: { ...existing, status: 'exited', exitCode: null, updatedAt: Date.now() } };
      });
      return true;
    }
    if (event.type === 'terminal.attached') {
      startOnMissingRef.current.delete(terminalId);
      terminalStreamsRef.current.get(terminalId).applyAttached({
        reset: data.reset === true,
        data: typeof data.data === 'string' ? data.data : '',
        seq: typeof data.seq === 'number' ? data.seq : 0,
      });
    }

    if (event.type === 'terminal.status') {
      const terminals = Array.isArray(data.terminals) ? data.terminals : [];
      const requestedId = typeof data.terminalId === 'string' ? data.terminalId : '';
      setTerminalById((current) => {
        let next = current;
        // A terminal asked about by id but not listed is no longer running.
        const requested = requestedId ? current[requestedId] : undefined;
        if (
          requested
          && (requested.status === 'running' || requested.status === 'stopping')
          && !terminals.some((item) => item && typeof item === 'object' && (item as Record<string, unknown>).terminalId === requestedId)
        ) {
          next = { ...current, [requestedId]: { ...requested, status: 'exited', exitCode: null, updatedAt: Date.now() } };
        }
        terminals.forEach((item) => {
          if (!item || typeof item !== 'object') {
            return;
          }
          const record = item as Record<string, unknown>;
          const statusTerminalId = typeof record.terminalId === 'string' ? record.terminalId : '';
          const existing = statusTerminalId ? current[statusTerminalId] : null;
          if (!statusTerminalId || !existing) {
            return;
          }
          if (next === current) {
            next = { ...current };
          }
          next[statusTerminalId] = {
            ...existing,
            status: 'running',
            cwd: typeof record.cwd === 'string' ? record.cwd : existing.cwd,
            shell: typeof record.shell === 'string' ? record.shell : existing.shell,
            rows: typeof record.rows === 'number' ? record.rows : existing.rows,
            cols: typeof record.cols === 'number' ? record.cols : existing.cols,
            pid: typeof record.pid === 'number' ? record.pid : existing.pid,
            error: '',
            stopRequested: false,
            updatedAt: Date.now(),
          };
        });
        return evictIdleTerminalStates(next);
      });
      return true;
    }

    const rawWorkspaceId = data.workspaceId ?? data.workspace_id ?? event.workspace_id;
    const workspaceId = typeof rawWorkspaceId === 'string' ? rawWorkspaceId : '';
    const rawTenantId = data.tenantId ?? data.tenant_id;
    const tenantId = typeof rawTenantId === 'string' ? rawTenantId : '';
    const rawCwd = data.cwd;
    const cwd = typeof rawCwd === 'string' ? rawCwd : '';
    const rawShell = data.shell;
    const shell = typeof rawShell === 'string' ? rawShell : '';
    const conversation = stores.conversations.get().find((item) => terminalIdForConversation(item.id) === terminalId);
    const conversationId = conversation?.id ?? activeConversationRef.current;

    // ssh exits with 255 when the saved password is rejected or the host key
    // is not yet confirmed (askpass never answers that); sign in at the prompt.
    const known = terminalByIdRef.current[terminalId];
    if (
      event.type === 'terminal.exited'
      && data.exitCode === 255
      && known?.ssh
      && known.sshPasswordAt !== undefined
      && Date.now() - known.sshPasswordAt < SSH_PASSWORD_FALLBACK_WINDOW_MS
      && !known.stopRequested
      && known.status !== 'stopping'
    ) {
      const host = known.ssh.host;
      window.setTimeout(() => {
        startTerminalSessionRef.current?.({ kind: 'ssh', host, backendConnectionId: known.backendConnectionId ?? '' }, {
          terminalId, cwd: '', shell: '', rows: known.rows, cols: known.cols, preserveOutput: true, interactive: true,
        });
      }, 0);
    }

    setTerminalById((current) => {
      const existing = current[terminalId];
      const base: TerminalClientState = existing ?? {
        terminalId,
        workspaceId: workspaceId || conversation?.workspaceId || activeWorkspaceRef.current,
        conversationId,
        tenantId: tenantId || settings.tenantId,
        cwd: cwd || (conversation
          ? stores.workspaces.get().find((workspace) => workspace.id === conversation.workspaceId)?.path ?? ''
          : ''),
        shell,
        rows: DEFAULT_TERMINAL_ROWS,
        cols: DEFAULT_TERMINAL_COLS,
        status: 'idle',
        error: '',
        pid: null,
        exitCode: null,
        updatedAt: Date.now(),
      };
      let status: TerminalLifecycleState = base.status;
      let error = base.error;
      let exitCode = base.exitCode;
      let stopRequested = base.stopRequested ?? false;
      let sshHost = base.ssh?.host;

      if (event.type === 'terminal.started') {
        status = 'running';
        const startedSsh = data.ssh && typeof data.ssh === 'object' ? (data.ssh as Record<string, unknown>).host : undefined;
        if (typeof startedSsh === 'string' && startedSsh) sshHost = startedSsh;
        error = '';
        stopRequested = false;
      } else if (event.type === 'terminal.attached') {
        status = 'running';
        const attachedSsh = data.ssh && typeof data.ssh === 'object' ? (data.ssh as Record<string, unknown>).host : undefined;
        if (typeof attachedSsh === 'string' && attachedSsh) sshHost = attachedSsh;
        error = '';
        stopRequested = false;
      } else if (event.type === 'terminal.stopping') {
        status = 'stopping';
        stopRequested = true;
      } else if (event.type === 'terminal.exited') {
        status = 'exited';
        exitCode = typeof data.exitCode === 'number' ? data.exitCode : null;
        // Same as the mobile client: an exit only suppresses the auto-restart
        // when it was requested — either the backend flagged the payload or we
        // had already observed the terminal.stopping lifecycle state.
        stopRequested = stopRequested || base.status === 'stopping' || data.stoppedByRequest === true;
      } else if (event.type === 'terminal.error') {
        status = 'error';
        error = typeof data.error === 'string' ? data.error : 'terminal error';
      }

      return evictIdleTerminalStates({
        ...current,
        [terminalId]: {
          ...base,
          ...(sshHost ? { ssh: { host: sshHost } } : {}),
          workspaceId: workspaceId || base.workspaceId,
          conversationId: base.conversationId || conversationId,
          tenantId: tenantId || base.tenantId,
          cwd: cwd || base.cwd,
          shell: shell || base.shell,
          rows: typeof data.rows === 'number' ? data.rows : base.rows,
          cols: typeof data.cols === 'number' ? data.cols : base.cols,
          pid: typeof data.pid === 'number' ? data.pid : base.pid,
          exitCode,
          status,
          error,
          stopRequested,
          updatedAt: Date.now(),
        },
      });
    });

    if (event.type === 'terminal.error') {
      appendTerminalError(terminalId, typeof data.error === 'string' ? data.error : 'terminal error');
    }
    return true;
  }, [appendTerminalError, settings.tenantId]);

  /** Frames outside the conversation event stream: terminal output, and
   * the backend's top-level `error` events (a stream that lagged or closed,
   * a frame it could not parse). */
  const projectServerEvent = useCallback((event: ServerEvent) => {
    const data = eventPayloadData(event);
    if (handleTerminalEvent(event, data)) return;
    const protocolError = extractProtocolError(event.type, data);
    if (protocolError) setLastError(protocolError);
  }, [handleTerminalEvent]);

  const scheduleServerEventDrain = useCallback(() => {
    if (pendingServerEventFrameRef.current !== null) {
      return;
    }

    pendingServerEventFrameRef.current = scheduleMessageTask(() => {
      pendingServerEventFrameRef.current = null;
      const batch = pendingServerEventsRef.current.splice(0, SOCKET_EVENT_BATCH_SIZE);
      batch.forEach(projectServerEvent);

      if (pendingServerEventsRef.current.length > 0) {
        scheduleServerEventDrain();
      }
    });
  }, [projectServerEvent]);

  const enqueueServerEvent = useCallback((event: ServerEvent) => {
    pendingServerEventsRef.current.push(event);
    scheduleServerEventDrain();
  }, [scheduleServerEventDrain]);

  /** Connection failures of a background backend stay on its own status (the
   * sidebar and Settings show them); the focused backend's also reach the
   * shared error notice. */
  const reportLinkError = useCallback((backendId: string, message: string) => {
    patchLinkStatus(backendId, { error: message });
    if (backendId === activeBackendConnectionIdRef.current) setLastError(message);
  }, [patchLinkStatus]);

  const decodeSocketFrame = useCallback((frame: PendingSocketFrame) => {
    const { backendId } = frame;
    const link = linksRef.current.get(backendId);
    if (!link || frame.generation !== link.generation) {
      return;
    }

    try {
      const text = frame.data;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const messageType = typeof parsed.type === 'string' ? parsed.type : '';
      // Anything else may depend on the events received before it (a
      // command result, a legacy frame): project those first.
      if (messageType !== 'conversation.event') conversationEventBatcherRef.current?.flush();
      if (messageType === 'server.result') {
        const id = typeof parsed.id === 'string' ? parsed.id : '';
        // Warming is fire-and-forget; nothing waits for its result.
        if (isConversationWarmRequestId(id)) return;
        const payload = parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
          ? parsed.payload as Record<string, unknown> : {};
        const subscribedConversationId = link.pendingSubscribes.get(id);
        link.pendingSubscribes.delete(id);
        if (subscribedConversationId && payload.hasMore === true) {
          // The capped backfill stopped short of the high-water mark. A loaded
          // conversation pages the rest over HTTP; an unopened one loads its
          // history lazily when it is opened.
          const conversation = stores.conversations.get().find((item) => item.v2ConversationId === subscribedConversationId);
          if (conversation && conversationRecoveryRef.current?.get(subscribedConversationId)) {
            void conversationRecoveryRef.current.recover(subscribedConversationId, conversation.workspaceId, conversation.lastSequence ?? 0);
          }
        }
        link.commands.resolve(id, payload);
        return;
      }
      if (messageType === 'server.error' && parsed.id !== undefined) {
        const payload = parsed.payload as { code?: unknown; message?: unknown; conversationId?: unknown } | undefined;
        const code = typeof payload?.code === 'string' ? payload.code : '';
        const detail = historyErrorMessage(code) ?? (typeof payload?.message === 'string' ? payload.message : t('sess.v2CommandFailed'));
        const message = code ? `[${code}] ${detail}` : detail;
        const requestId = typeof parsed.id === 'string' ? parsed.id : '';
        if (isAgentBrowserWatchRequestId(requestId)) {
          // A live view that cannot start falls back to screenshots; it is not
          // the user's failure to report.
          console.warn('Agent browser watch request failed', message);
          return;
        }
        // Warming is best-effort, and older backends do not know the command.
        if (isConversationWarmRequestId(requestId)) return;
        const failedSubscribe = link.pendingSubscribes.get(requestId);
        if (failedSubscribe) {
          link.pendingSubscribes.delete(requestId);
          link.subscriptions.delete(failedSubscribe);
        }
        // A subscription task that died server-side already released its slot;
        // drop the local marker so a later subscribe is not deduped away.
        const endedConversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : '';
        if (endedConversationId) link.subscriptions.delete(endedConversationId);
        // A busy conversation's prompt may still join the backend queue;
        // sendV2Prompt reports the conflict itself when it cannot.
        const callerReports = code === 'CONFLICT' && link.commands.typeOf(requestId) === 'conversation.prompt';
        // No recipient to encrypt the write for: register this device again.
        if (code === HISTORY_KEY_REQUIRED) void historyEncryptionRef.current?.keyRequired(backendId);
        link.commands.reject(requestId, message, code);
        if (!callerReports) setLastError(message);
        return;
      }
      if (messageType === HISTORY_ENCRYPTION_UPDATED) {
        historyEncryptionRef.current?.receiveUpdate(backendId, parsed.payload);
        return;
      }
      if (messageType === 'agentBrowser.frame') {
        const frame = parsed.payload as AgentBrowserFrame | undefined;
        if (frame?.conversationId) agentBrowserWatchersRef.current.get(frame.conversationId)?.forEach(listener => listener(frame));
        return;
      }
      if (messageType === 'conversation.event') {
        const raw = (parsed.payload ?? parsed) as Record<string, unknown>;
        const rawConversationId = typeof raw.conversationId === 'string' ? raw.conversationId : '';
        const generation = frame.generation;
        // Encrypted payloads are opened before normalization; per
        // conversation the arrival order is kept even when a wrap is fetched.
        const deliver = (opened: Record<string, unknown>) => {
          if (generation !== linksRef.current.get(backendId)?.generation) return;
          const event = normalizeConversationEvent(opened);
          if (!event) throw new Error(t('sess.invalidConversationEvent'));
          // Only this backend's conversations take its events, even if
          // another backend reuses an id.
          const conversation = stores.conversations.get().find((item) => (
            (item.v2ConversationId === event.conversationId || item.id === event.conversationId)
            && backendIdForConversation(item.id) === backendId
          ));
          if (conversation) {
            if (parsed.delivery === 'live') extensionEffectsRef.current.markLive(event);
            conversationEventBatcherRef.current!.push(event.conversationId, conversation.workspaceId, event);
          }
        };
        const history = historyEncryptionRef.current;
        if (rawConversationId && !isPrivateBackendConversation(rawConversationId)) historyTailCache?.capture(backendId, rawConversationId, [raw], parsed.frames);
        if (!history || !rawConversationId) deliver(raw);
        else history.receiveSocketEvent(backendId, rawConversationId, raw, parsed.frames, parsed.delivery === 'replay' ? 'summary' : 'full', deliver, setLastError);
        return;
      }
      enqueueServerEvent(parsed as unknown as ServerEvent);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'failed to parse websocket message');
    }
  }, [enqueueServerEvent]);

  const scheduleSocketFrameDrain = useCallback(() => {
    if (pendingSocketFrameDrainRef.current !== null) {
      return;
    }

    pendingSocketFrameDrainRef.current = scheduleMessageTask(() => {
      pendingSocketFrameDrainRef.current = null;
      const startedAt = Date.now();
      let processed = 0;

      while (
        pendingSocketFramesRef.current.length > 0 &&
        processed < SOCKET_FRAME_DECODE_BATCH_SIZE
      ) {
        const frame = pendingSocketFramesRef.current.shift();
        if (!frame) {
          break;
        }
        const owner = linksRef.current.get(frame.backendId);
        if (owner) owner.pendingFrames = Math.max(0, owner.pendingFrames - 1);
        decodeSocketFrame(frame);
        processed += 1;
        if (Date.now() - startedAt >= SOCKET_FRAME_DECODE_BUDGET_MS) {
          break;
        }
      }

      if (pendingSocketFramesRef.current.length > 0) {
        scheduleSocketFrameDrain();
      }
    });
  }, [decodeSocketFrame]);

  const enqueueSocketFrame = useCallback((frame: PendingSocketFrame) => {
    const link = linksRef.current.get(frame.backendId);
    if (!link) return;
    if (link.pendingFrames >= MAX_PENDING_SOCKET_FRAMES) {
      // The renderer fell too far behind this backend's socket. Drop its
      // backlog and reconnect it like any transient drop (other backends keep
      // theirs): resubscribing replays each conversation from its cursor, and
      // gaps recover over REST.
      closeSocket(frame.backendId, false);
      // Back off across repeated drops: markVerified zeroes the attempt
      // counter on every successful reconnect.
      const streak = nextSocketBacklogStreak(link.backlogStreak, Date.now());
      link.backlogStreak = streak;
      link.reconnectAttempt = Math.max(link.reconnectAttempt, streak.count - 1);
      link.lastFailureRetryable = true;
      patchLinkStatus(frame.backendId, { state: 'closed' });
      reportLinkError(frame.backendId, t('sess.socketBacklog'));
      return;
    }
    pendingSocketFramesRef.current.push(frame);
    link.pendingFrames += 1;
    scheduleSocketFrameDrain();
  }, [closeSocket, patchLinkStatus, reportLinkError, scheduleSocketFrameDrain]);

  /** Raw `{id, type, payload}` frame on a backend's /v2/ws socket (the one
   * the frame addresses when no backend is named): the secure socket checks
   * the 8 MiB frame limit before sealing, then sends. Returns null when the
   * frame never left (socket closed) and throws ConnectionError on oversize
   * payloads. */
  const sendRawProtocolFrame = useCallback((message: { id: string; type: string; payload: Record<string, unknown> }, backendId = backendIdForPayload(message.payload)) => {
    const link = linksRef.current.get(backendId);
    const socket = link?.socket;
    if (!link || !socket?.ready || !link.verified) {
      return null;
    }
    let frame: string;
    try {
      frame = JSON.stringify(message);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : t('sess.serializeFailed'));
      return null;
    }
    sendSocketText(socket, frame);
    return message;
  }, []);

  /** Streams the conversation's agent browser tab while subscribed; returns
   * the unsubscribe. */
  const watchAgentBrowser = useCallback((conversationId: string, listener: (frame: AgentBrowserFrame) => void) => {
    const watchers = agentBrowserWatchersRef.current;
    let listeners = watchers.get(conversationId);
    if (!listeners) {
      listeners = new Set();
      watchers.set(conversationId, listeners);
      sendRawProtocolFrame({ id: createRequestId(AGENT_BROWSER_WATCH_ID_PREFIX), type: 'agentBrowser.watch', payload: { conversationId } });
    }
    listeners.add(listener);
    return () => {
      const current = watchers.get(conversationId);
      if (!current?.delete(listener) || current.size) return;
      watchers.delete(conversationId);
      sendRawProtocolFrame({ id: createRequestId(AGENT_BROWSER_UNWATCH_ID_PREFIX), type: 'agentBrowser.unwatch', payload: { conversationId } });
    };
  }, [sendRawProtocolFrame]);

  const unsubscribeV2Conversation = useCallback((v2ConversationId: string, backendId = backendIdForConversation(v2ConversationId)) => {
    if (!linksRef.current.get(backendId)?.subscriptions.delete(v2ConversationId)) return;
    sendRawProtocolFrame({
      id: createRequestId('unsub'),
      type: 'conversation.unsubscribe',
      payload: { conversationId: v2ConversationId },
    }, backendId);
  }, [sendRawProtocolFrame]);

  /** Send `conversation.subscribe` on the owning backend's socket within its
   * budget. When the budget is full, the oldest background subscription is
   * unsubscribed first; the active conversation is never evicted. Returns
   * false when the frame could not be sent or no slot could be freed. */
  const subscribeV2Conversation = useCallback((
    v2ConversationId: string,
    options?: { afterSequence?: number; limit?: number },
  ): boolean => {
    const backendId = backendIdForConversation(v2ConversationId);
    const link = linksRef.current.get(backendId);
    // Not connected yet: the connection subscribes it once it opens.
    if (!link?.verified) return false;
    const subscribed = link.subscriptions;
    if (subscribed.has(v2ConversationId)) {
      // Refresh recency so active conversations are not evicted first.
      subscribed.delete(v2ConversationId);
      subscribed.add(v2ConversationId);
      return true;
    }
    const activeV2Id = stores.conversations.get().find(
      (item) => item.id === activeConversationRef.current,
    )?.v2ConversationId;
    while (subscribed.size >= V2_WS_SUBSCRIPTION_BUDGET) {
      const evict = [...subscribed].find((id) => id !== activeV2Id);
      if (!evict) return false;
      unsubscribeV2Conversation(evict, backendId);
    }
    const requestId = createRequestId('sub');
    const sent = sendRawProtocolFrame({
      id: requestId,
      type: 'conversation.subscribe',
      payload: {
        conversationId: v2ConversationId,
        afterSequence: options?.afterSequence ?? 0,
        limit: options?.limit ?? 200,
        // Backfill like HTTP history pages: folded process events, and capped
        // so a stale cursor cannot stream a whole journal over the socket
        // (servers without these fields ignore them).
        detail: 'summary',
        backfillLimit: V2_SUBSCRIBE_BACKFILL_LIMIT,
        historyEncryption: HISTORY_ENCRYPTION_CAPABILITY,
      },
    }, backendId);
    if (!sent) return false;
    subscribed.add(v2ConversationId);
    link.pendingSubscribes.set(requestId, v2ConversationId);
    return true;
  }, [sendRawProtocolFrame, unsubscribeV2Conversation]);
  subscribeV2ConversationRef.current = subscribeV2Conversation;

  rawProtocolSenderRef.current = (backendId, message) => Boolean(sendRawProtocolFrame(message, backendId));

  // Pre-start the open conversation's agent process so its first prompt starts
  // faster: on opening it, and on every verified connection to its backend.
  const conversationWarmSentAtRef = useRef(new Map<string, number>());
  const activeConversationBackendId = activeConversation ? backendIdForConversation(activeConversation.id) : '';
  const activeConversationLink = linkStatusByBackend[activeConversationBackendId] ?? IDLE_BACKEND_LINK;
  const activeConversationConnected = activeConversationLink.state === 'open';
  useEffect(() => {
    const conversation = activeConversation;
    const v2Id = conversation?.v2ConversationId;
    if (!activeConversationConnected || !conversation || !v2Id || conversation.archived === true) return;
    const runtime = conversationRecoveryRef.current?.get(v2Id);
    const busy = Boolean(runtime && isConversationRuntimeBusy(runtime)) || conversationHasPendingWork(conversation.id);
    const now = Date.now();
    if (!shouldWarmConversation(v2Id, now, conversationWarmSentAtRef.current, busy)) return;
    const sent = sendRawProtocolFrame({ id: createRequestId(CONVERSATION_WARM_ID_PREFIX), type: 'conversation.warm', payload: { conversationId: v2Id } });
    if (sent) conversationWarmSentAtRef.current.set(v2Id, now);
    // Busy state is sampled when the conversation opens or the connection is
    // (re)established; it is deliberately not a dependency.
  }, [activeConversation?.id, activeConversation?.v2ConversationId, activeConversationConnected, activeConversationLink.epoch, sendRawProtocolFrame]);

  /** A command on a backend's socket; without a backend it goes to the one
   * owning the conversation the command names (else the focused backend). */
  const sendProtocolCommand = useCallback((message: ProtocolCommand, timeoutMs = 15_000, backendId = backendIdForPayload(message.payload)) => (
    profileFor(backendId)
      ? linkFor(backendId).commands.request(message, timeoutMs)
      : Promise.reject(new ProtocolCommandError(t('sidebar.backendRemoved'), 'not-sent', message.id))
  ), []);

  // History encryption runs per backend over each backend's own socket.
  // Keyed by content so health probes do not re-run its effects.
  const historyLinksKey = JSON.stringify(backendConnections.map((profile) => {
    const status = linkStatusByBackend[profile.id];
    return [profile.id, status?.state === 'open', status?.serverVersion ? status.serverVersion.historyEncryption === 1 : null];
  }));
  const stableHistoryLinks = useMemo(() => Object.fromEntries(
    (JSON.parse(historyLinksKey) as [string, boolean, boolean | null][]).map(([backendId, connected, supported]) => [
      backendId, { connected, supported: supported ?? undefined },
    ]),
  ), [historyLinksKey]);
  const historyEncryption = useHistoryEncryption({
    backends: stableHistoryLinks,
    focusBackendId: activeBackendConnectionId,
    sendCommand: (backendId, message, timeoutMs) => sendProtocolCommand(message, timeoutMs, backendId),
    // Keys arrived: drop the projections (of the named conversations, or
    // all) that hold locked rows and reopen the visible conversation so it
    // decrypts now.
    onUnlocked: (conversationIds) => {
      const recovery = conversationRecoveryRef.current;
      if (!recovery) return;
      const activeV2Id = stores.conversations.get().find((item) => item.id === activeConversationRef.current)?.v2ConversationId;
      let reopenActive = false;
      for (const id of conversationIds ?? recovery.loadedConversationIds()) {
        if (!recovery.get(id)?.timeline.some((entry) => entry.detailLocked)) continue;
        if (recovery.release(id) && id === activeV2Id) reopenActive = true;
      }
      if (reopenActive && activeConversationRef.current) void openConversation(activeConversationRef.current);
    },
  });
  historyEncryptionRef.current = historyEncryption;
  useEffect(() => {
    historyTailCache?.setRecipientResolver(async (backendId) => historyEncryptionRef.current?.localRecipientId(backendId));
    // Tails changed while reading are written before the window goes away.
    const flush = () => { if (document.visibilityState === 'hidden') void historyTailCache?.flushAll(); };
    const flushOnExit = () => { void historyTailCache?.flushAll(); };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flushOnExit);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flushOnExit);
    };
  }, []);

  // A revoked device says so once instead of only showing locked rows.
  const historyRevoked = historyEncryption.revoked;
  useEffect(() => {
    if (historyRevoked) setLastError(t('history.accessRevoked'));
  }, [historyRevoked]);

  // Encrypted manifest titles (§3.2): decrypt what is new on each backend,
  // then re-merge the listed manifests once more titles are readable.
  const { decryptManifestTitles: decryptTitles, titleRevision: decryptedTitleRevision } = historyEncryption;
  useEffect(() => {
    for (const [backendId, manifests] of Object.entries(v2ConversationsByBackend)) {
      if (!stableHistoryLinks[backendId]?.connected) continue;
      void decryptTitles(backendId, manifests);
    }
  }, [decryptTitles, stableHistoryLinks, v2ConversationsByBackend]);
  useEffect(() => {
    if (!decryptedTitleRevision) return;
    setConversations((current) => Object.entries(v2ConversationsByBackend).reduce(
      (merged, [backendId, manifests]) => mergeManifestConversations(merged, withDecryptedTitles(backendId, manifests), stores.workspaces.get(), backendId, manifestRunModes(backendId)),
      current,
    ));
  }, [decryptedTitleRevision]);

  const controlConversation = useCallback(async (conversationId: string, control: LiveConversationControl): Promise<boolean> => {
    const conversation = stores.conversations.get().find(item => item.id === conversationId);
    if (refuseReadOnlyWrite(conversation)) return false;
    const turnId = turnIdsRef.current[conversationId];
    if (!conversation?.v2ConversationId || !turnId || controlRequestsRef.current.has(conversationId)) {
      setLastError(t('sess.turnEndedUnconfirmed'));
      return false;
    }
    const requestId = createRequestId('control');
    controlRequestsRef.current.set(conversationId, requestId);
    if (control.action === 'queueAdd' || control.action === 'steer') {
      controlDraftsRef.current.set(requestId, { conversationId, text: control.text });
      if (controlDraftsRef.current.size > 64) controlDraftsRef.current.delete(controlDraftsRef.current.keys().next().value!);
    }
    setControlStatusByConversation(current => withEntry(current, conversationId, 'pending'));
    try {
      const result = await sendProtocolCommand({ id: requestId, type: 'conversation.control', payload: {
        conversationId: conversation.v2ConversationId, expectedTurnId: turnId, control,
      } }, 35_000);
      if (result.status === 'targetUnavailable') throw new Error(t('sess.turnEndedNotApplied'));
      if (controlRequestsRef.current.get(conversationId) === requestId) {
        controlRequestsRef.current.delete(conversationId);
        setControlStatusByConversation(current => withEntry(current, conversationId, undefined));
      }
      return true;
    } catch (error) {
      const unknown = error instanceof ProtocolCommandError && error.state === 'unknown';
      if (controlRequestsRef.current.get(conversationId) === requestId) {
        if (!unknown) controlRequestsRef.current.delete(conversationId);
        setControlStatusByConversation(current => withEntry(current, conversationId, unknown ? 'unknown' : undefined));
      }
      setLastError(error instanceof Error ? error.message : t('sess.agentControlFailed'));
      if (unknown) await recoverConversation(conversationId);
      return false;
    }
  }, [recoverConversation, sendProtocolCommand]);


  const pushSystem = useCallback(
    (title: string, subtitle = '') => {
      appendTimeline(makeSystemEntry(title, subtitle, activeWorkspaceRef.current, activeConversationRef.current));
    },
    [appendTimeline],
  );

  const refreshServerVersion = useCallback(async (backendId: string) => {
    const profile = profileFor(backendId);
    if (!profile) return;
    try {
      // Signed so the daemon also returns its data and workspace paths;
      // tunnelled like every other call when a key is pinned.
      const response = await backendFetch(profile, {
        method: 'GET',
        path: '/v2/version',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw await readBackendError(response, '/v2/version');
      const json = normalizeServerVersion((await response.json()) as Record<string, unknown>);
      patchLinkStatus(backendId, { serverVersion: json });
      terminalSnapshotRef.current.set(backendId, (json.terminalSnapshot ?? 0) >= 1);
      noteTerminalReplayRef.current(backendId, (json.terminalReplay ?? 0) >= 1);
    } catch (error) {
      patchLinkStatus(backendId, { serverVersion: null });
      terminalSnapshotRef.current.set(backendId, false);
      noteTerminalReplayRef.current(backendId, false);
      reportLinkError(backendId, error instanceof Error ? error.message : 'failed to fetch /v2/version');
    }
  }, [patchLinkStatus, reportLinkError]);

  const checkConnectionHealth = useCallback(async (backendId: string) => {
    const profile = profileFor(backendId);
    const link = linksRef.current.get(backendId);
    if (!profile?.serverUrl.trim() || !link || link.transportFailure || link.readyWait) return;
    // A frozen (paused) daemon cannot answer; it is woken on demand instead.
    if (backendWakeGateRef.current?.isFrozen(backendId)) return;
    const probeId = link.healthProbeSeq + 1;
    link.healthProbeSeq = probeId;
    const stale = () => link.healthProbeSeq !== probeId || link.transportFailure || Boolean(link.readyWait)
      || linksRef.current.get(backendId) !== link;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTION_HEALTH_TIMEOUT_MS);

    patchLinkStatus(backendId, (current) => {
      const status = current.health.status === 'online' ? 'online' : 'checking';
      // Online stays online while the probe runs: no new object, no render.
      return current.health.status === status && !current.health.error ? {} : { health: { ...current.health, status, error: '' } };
    });

    try {
      const response = await fetch(buildHttpUrl(profile.serverUrl, '/health'), {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      if (stale()) {
        return;
      }
      if (!response.ok) {
        throw new Error(`health endpoint returned ${response.status}`);
      }
      // Quantize latency so the sidebar badge color only changes when the
      // connection quality actually shifts, not on every probe.
      const latencyBucket = latencyMs <= 100 ? 100 : latencyMs <= 300 ? 300 : 600;
      patchLinkStatus(backendId, (current) => {
        const health = current.health;
        const currentBucket = health.latencyMs === null ? null : health.latencyMs <= 100 ? 100 : health.latencyMs <= 300 ? 300 : 600;
        if (health.status === 'online' && currentBucket === latencyBucket && !health.error && !health.code) return {};
        return { health: { status: 'online', latencyMs, lastCheckedAt: Date.now(), error: '', code: '' } };
      });
    } catch (error) {
      if (stale()) {
        return;
      }
      const isAbort = error instanceof Error && error.name === 'AbortError';
      patchLinkStatus(backendId, { health: {
        status: 'offline',
        latencyMs: null,
        lastCheckedAt: Date.now(),
        error: isAbort ? t('sess.healthCheckTimeout') : error instanceof Error ? error.message : t('sess.healthCheckFailed'),
      } });
    } finally {
      clearTimeout(timeoutId);
    }
  }, [patchLinkStatus]);

  // Every connected (or connecting) backend is probed on its own.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    // A hidden window shows no badge: probing pauses and resumes on return.
    const probeAll = () => {
      if (document.visibilityState === 'hidden') return;
      for (const backendId of linksRef.current.keys()) void checkConnectionHealth(backendId);
    };
    probeAll();
    const intervalId = setInterval(probeAll, CONNECTION_HEALTH_INTERVAL_MS);
    document.addEventListener('visibilitychange', probeAll);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', probeAll);
    };
  }, [backendEndpointsKey, checkConnectionHealth, hydrated]);

  /** Open (or reopen) one backend's socket. */
  const connectBackend = useCallback((backendId: string) => {
    // A disabled profile's backend is served by another profile.
    if (profileFor(backendId)?.disabled) return;
    const link = linkFor(backendId);
    link.manualDisconnect = false;
    setAutoConnectEnabled(true);
    closeSocket(backendId, false);
    const generation = link.generation;
    const attempt = new AbortController();
    link.attempt = attempt;
    link.transportFailure = false;
    const isAttemptCurrent = () => linksRef.current.get(backendId) === link && link.generation === generation
      && link.attempt === attempt && !attempt.signal.aborted;
    const setHealth = (health: Partial<ConnectionHealth>) => patchLinkStatus(backendId, (current) => ({ health: { ...current.health, ...health } }));
    const failTransport = (failure: TransportFailure) => {
      if (link.attempt !== attempt) return;
      // A definitive failure stops the reconnect loop and keeps the health
      // poll from overwriting the message; a retryable one only reports.
      link.transportFailure = !failure.retryable;
      closeSocket(backendId, false);
      link.lastFailureRetryable = failure.retryable;
      patchLinkStatus(backendId, { state: 'error' });
      reportLinkError(backendId, failure.message);
      patchLinkStatus(backendId, { health: { status: 'offline', latencyMs: null, lastCheckedAt: Date.now(), error: failure.message, code: failure.code } });
    };
    const profile = profileFor(backendId);
    patchLinkStatus(backendId, { state: 'connecting', error: '' });
    if (backendId === activeBackendConnectionIdRef.current) setLastError('');
    setHealth({ status: 'checking', error: '', code: '' });

    void (async () => {
      const inspected = inspectServerUrl(profile?.serverUrl ?? '');
      if (inspected.error) {
        link.lastFailureRetryable = inspected.error.retryable;
        patchLinkStatus(backendId, { state: 'error' });
        reportLinkError(backendId, inspected.error.userMessage);
        setHealth({
          status: 'offline',
          latencyMs: null,
          lastCheckedAt: Date.now(),
          error: inspected.error.userMessage,
          code: inspected.error.code,
        });
        return;
      }

      const insecureReason = platform.backendUrlProblem(inspected.origin);
      if (insecureReason) {
        const error = ConnectionError.invalidServerUrl(insecureReason);
        link.lastFailureRetryable = false;
        patchLinkStatus(backendId, { state: 'error' });
        reportLinkError(backendId, insecureReason);
        setHealth({
          status: 'offline',
          latencyMs: null,
          lastCheckedAt: Date.now(),
          error: insecureReason,
          code: error.code,
        });
        return;
      }

      const transportProfile = { ...profile!, serverUrl: inspected.origin };
      // A starting backend accepts the connection but answers only once it
      // has loaded, so the policy read, the first request, waits for that
      // instead of timing out; the steps after it then answer promptly.
      link.readyWait = attempt;
      const startingNotice = setTimeout(() => {
        if (isAttemptCurrent()) patchLinkStatus(backendId, { starting: true });
      }, BACKEND_READY_NOTICE_DELAY_MS);
      try {
        await verifyTransportPolicy(transportProfile, { signal: attempt.signal, timeoutMs: BACKEND_READY_TIMEOUT_MS });
      } catch (error) {
        if (!isAttemptCurrent()) return;
        failTransport(describeTransportFailure(error)
          ?? { message: t('transport.cannotConfirmPolicy'), retryable: true, code: 'backend_unreachable' });
        return;
      } finally {
        clearTimeout(startingNotice);
        if (link.readyWait === attempt) {
          link.readyWait = null;
          patchLinkStatus(backendId, { starting: false });
        }
      }
      if (!isAttemptCurrent()) return;
      const transport = backendTransport(transportProfile);
      const probe = await probeBackendConnection({ serverUrl: inspected.origin, transport });
      if (!isAttemptCurrent()) return;
      const probedVersion = probe.version ? {
        name: probe.version.name,
        version: probe.version.version,
        data_dir: probe.version.dataDir || '',
        workspace_root: probe.version.workspaceRoot || '',
        scratch_workspace_root: probe.version.scratchWorkspaceRoot || '',
        historyEncryption: probe.version.historyEncryption,
        deployment: probe.version.deployment,
        pathMappings: probe.version.pathMappings,
      } : null;
      if (!probe.ok || probe.error) {
        const error = probe.error ?? ConnectionError.unreachable('backend probe failed');
        const transportFailure = describeTransportFailure(error);
        if (transportFailure) {
          failTransport(transportFailure);
          return;
        }
        link.lastFailureRetryable = error.retryable;
        patchLinkStatus(backendId, { state: 'error' });
        reportLinkError(backendId, connectionErrorText(error));
        setHealth({
          status: 'offline',
          latencyMs: null,
          lastCheckedAt: Date.now(),
          error: connectionErrorText(error),
          code: error.code,
        });
        if (probedVersion) patchLinkStatus(backendId, { serverVersion: probedVersion });
        if (probe.providers.length) {
          setBackendProviders(backendId, probe.providers);
        }
        return;
      }

      setBackendProviders(backendId, probe.providers);
      if (probedVersion) patchLinkStatus(backendId, { serverVersion: probedVersion });
      patchLinkStatus(backendId, { health: {
        status: 'checking',
        latencyMs: null,
        lastCheckedAt: Date.now(),
        error: '',
        code: '',
      } });

      let verification: SocketVerification | null = null;
      let verified = false;
      let cryptoFailed = false;
      let socket: SecureSocket;
      const isSocketCurrent = () => isAttemptCurrent() && link.socket === socket;
      const markVerified = () => {
        if (!isSocketCurrent() || !socket.ready) return;
        verified = true;
        link.verified = true;
        // Server-side subscriptions are per-socket; this socket starts empty.
        link.subscriptions.clear();
        link.pendingSubscribes.clear();
        // So are live browser views: watch again what is still on screen.
        for (const watched of agentBrowserWatchersRef.current.keys()) {
          if (backendIdForConversation(watched) !== backendId) continue;
          const watchFrame = JSON.stringify({ id: createRequestId(AGENT_BROWSER_WATCH_ID_PREFIX), type: 'agentBrowser.watch', payload: { conversationId: watched } });
          sendSocketText(socket, watchFrame);
        }
        // The backend may have restarted meanwhile: the warm effect, rerun by
        // the connection epoch, warms the open conversation again.
        for (const v2Id of [...conversationWarmSentAtRef.current.keys()]) {
          if (backendIdForConversation(v2Id) === backendId) conversationWarmSentAtRef.current.delete(v2Id);
        }
        link.reconnectAttempt = 0;
        link.lastFailureRetryable = true;
        patchLinkStatus(backendId, (current) => ({ state: 'open', epoch: current.epoch + 1, error: '', openedAt: Date.now() }));
        void checkConnectionHealth(backendId);
        void refreshServerVersion(backendId);
        // Only the open conversation replays history eagerly. Other
        // conversations subscribe at their known high-water mark and
        // recover on demand (open, or a live event exposing a gap), so a
        // reconnect no longer replays every journal at once.
        const foregroundConversation = stores.conversations.get().find(
          (item) => item.id === activeConversationRef.current,
        );
        const ownsForeground = Boolean(foregroundConversation) && backendIdForConversation(foregroundConversation!.id) === backendId;
        // Returning to a backend continues its history where it stopped:
        // a loaded conversation catches up from its cursor, an unloaded one
        // opens lazily from the journal tail.
        if (ownsForeground && foregroundConversation?.v2ConversationId) {
          void openConversation(foregroundConversation.id);
        }
        // Prompt submissions whose ACK was lost are reconciled against the
        // journal: delivered ones resume tracking, the rest return to drafts.
        for (const [pendingId, pending] of pendingV2SubmissionsRef.current) {
          if (pending.phase === 'unknown' && backendIdForConversation(pendingId) === backendId) void reconcilePendingSubmission(pendingId);
        }
        void (async () => {
          await syncWorkspacesFromBackend(backendId);
          if (!isSocketCurrent()) return;
          const candidates = stores.conversations.get().filter((conversation) => (
            Boolean(conversation.v2ConversationId) && conversation.archived !== true
            && backendIdForConversation(conversation.id) === backendId
          ));
          // The foreground conversation must keep its live subscription even
          // when the list exceeds the server's per-socket subscription cap.
          candidates.sort((left, right) =>
            Number(right.id === foregroundConversation?.id) - Number(left.id === foregroundConversation?.id));
          for (const conversation of candidates) {
            if (link.subscriptions.size >= V2_WS_SUBSCRIPTION_BUDGET) break;
            const v2ConversationId = conversation.v2ConversationId as string;
            try {
              // Conversations whose last recovery was cut short resume here.
              if (conversationRecoveryRef.current?.isRecovering(v2ConversationId)) {
                void openConversation(conversation.id);
              }
              subscribeV2Conversation(v2ConversationId, {
                // Subscribe at the known high-water mark instead of
                // replaying the backfill; a stale cursor still surfaces
                // missed events, and gaps trigger an on-demand recover.
                afterSequence: Math.max(
                  conversationRecoveryRef.current?.get(v2ConversationId)?.appliedSequence ?? 0,
                  conversation.lastSequence ?? 0,
                ),
                limit: 200,
              });
            } catch {
              // subscribe is best-effort after resume
            }
          }
        })();
        link.commands.flush();
      };
      const failVerification = (error: unknown) => {
        // The verifier's verdict is authoritative even when the socket
        // already closed mid-handshake; only a newer connection attempt or
        // our own abort may supersede it.
        if (link.attempt !== attempt) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const failure = describeTransportFailure(error)
          ?? { message: t('transport.notVerified'), retryable: false, code: 'protocol_mismatch' as const };
        if (failure.retryable) {
          if (!isSocketCurrent()) return;
          // Transient drop mid-handshake: supersede this socket so its
          // onClose no-ops, then let the reconnect effect retry.
          closeSocket(backendId, false);
          link.lastFailureRetryable = true;
          patchLinkStatus(backendId, { state: 'closed' });
          return;
        }
        socket.close();
        failTransport(failure);
      };

      try {
        socket = transport.openSocket({
          query: { historyEncryption: String(HISTORY_ENCRYPTION_CAPABILITY) },
          onOpen: () => {
            if (!isSocketCurrent()) return;
            if (!socket.encrypted) {
              markVerified();
              return;
            }
            // The first sealed frame is a ping: its pong proves the server
            // opened it with the pinned key (a wrong key closes with 4400).
            verification = startSocketVerification((text) => sendSocketText(socket, text), {
              signal: attempt.signal,
              timeoutMs: SOCKET_VERIFICATION_TIMEOUT_MS,
            });
            void verification.done.then(markVerified, failVerification);
          },
          onMessage: (text) => {
            if (!isSocketCurrent()) return;
            // The verifier alone reads messages until its challenge succeeds.
            if (!verified) {
              verification?.handleMessage(text);
              return;
            }
            enqueueSocketFrame({ data: text, backendId, generation });
          },
          onError: (error) => {
            if (!isSocketCurrent()) return;
            if (error instanceof TransportCryptoError) {
              // The socket already closed with 4400; onClose reports it.
              cryptoFailed = true;
              return;
            }
            const message = socket.encrypted && !verified
              ? t('transport.notVerified')
              : ConnectionError.websocketFailed(inspected.origin).userMessage;
            link.lastFailureRetryable = true;
            patchLinkStatus(backendId, { state: 'error' });
            reportLinkError(backendId, message);
            setHealth({ status: 'offline', error: message, code: 'websocket_failed' });
          },
          onClose: (event) => {
            if (!isSocketCurrent()) return;
            verification?.fail();
            link.verified = false;
            link.socket = null;
            attempt.abort();
            link.commands.disconnect();
            if (cryptoFailed || event.code === TRANSPORT_V2_WS_CLOSE_CODE) {
              // A transport crypto failure: reconnect with a fresh handshake
              // and tell the user how to recover if it keeps happening.
              const failure = describeTransportFailure(new TransportCryptoError('socket closed')) as TransportFailure;
              link.lastFailureRetryable = true;
              patchLinkStatus(backendId, { state: 'error' });
              reportLinkError(backendId, failure.message);
              setHealth({ status: 'offline', error: failure.message, code: failure.code });
              return;
            }
            if (socket.encrypted && !verified) {
              // A drop before the encrypted handshake finishes is transient;
              // keep auto-reconnect alive instead of latching an error.
              link.lastFailureRetryable = true;
              patchLinkStatus(backendId, { state: 'closed' });
              reportLinkError(backendId, t('transport.notVerified'));
              return;
            }
            patchLinkStatus(backendId, (current) => ({ state: current.state === 'open' || current.state === 'connecting' ? 'closed' : current.state }));
          },
        });
      } catch (error) {
        if (!isAttemptCurrent()) return;
        failTransport(describeTransportFailure(error)
          ?? { message: error instanceof Error ? error.message : t('transport.invalidKey'), retryable: false, code: 'encryption_required' });
        return;
      }
      link.socket = socket;
      // An endpoint that accepts the upgrade but never opens (no hello, a
      // lost IPC open event) would otherwise stay "connecting" for good:
      // give up and let the reconnect backoff try again.
      const openTimer = setTimeout(() => {
        if (!isSocketCurrent() || socket.ready) return;
        link.socket = null;
        link.verified = false;
        link.lastFailureRetryable = true;
        attempt.abort();
        link.commands.disconnect();
        socket.close();
        patchLinkStatus(backendId, { state: 'closed' });
        reportLinkError(backendId, t('sess.socketOpenTimeout'));
      }, SOCKET_OPEN_TIMEOUT_MS);
      attempt.signal.addEventListener('abort', () => clearTimeout(openTimer), { once: true });
    })().catch((error: unknown) => {
      if (!isAttemptCurrent()) return;
      link.lastFailureRetryable = true;
      patchLinkStatus(backendId, { state: 'error' });
      const message = error instanceof Error ? error.message : t('sess.backendConnectFailed');
      reportLinkError(backendId, message);
      setHealth({ status: 'offline', latencyMs: null, lastCheckedAt: Date.now(), error: message, code: 'backend_unreachable' });
    });
  }, [checkConnectionHealth, closeSocket, enqueueSocketFrame, openConversation, patchLinkStatus, reconcilePendingSubmission, refreshServerVersion, reportLinkError, setBackendProviders, subscribeV2Conversation, syncWorkspacesFromBackend]);

  /** Connect a backend (the focused one when none is named). */
  const connect = useCallback((backendId = activeBackendConnectionIdRef.current) => connectBackend(backendId), [connectBackend]);
  /** Disconnect a backend (the focused one when none is named); `manual`
   * keeps it disconnected until Connect. */
  const disconnect = useCallback((backendId = activeBackendConnectionIdRef.current, manual = true) => closeSocket(backendId, manual), [closeSocket]);

  // Each backend reconnects on its own after a retryable drop, with jittered
  // backoff so backends that dropped together do not retry in lockstep.
  useEffect(() => {
    if (!hydrated || !autoConnectEnabled) {
      return;
    }
    for (const [backendId, status] of Object.entries(linkStatusByBackend)) {
      const link = linksRef.current.get(backendId);
      if (!link || link.manualDisconnect || link.reconnectTimer) continue;
      if (status.state !== 'closed' && status.state !== 'error') continue;
      if (!link.lastFailureRetryable) continue;
      const delay = nextReconnectDelayMs(link.reconnectAttempt);
      link.reconnectAttempt += 1;
      link.reconnectTimer = setTimeout(() => {
        link.reconnectTimer = null;
        // A definitive failure may land after this timer was scheduled (the
        // encrypted-socket verifier can reject after the socket closes).
        if (linksRef.current.get(backendId) === link && !link.manualDisconnect && link.lastFailureRetryable) {
          connectBackend(backendId);
        }
      }, delay);
    }
  }, [autoConnectEnabled, connectBackend, hydrated, linkStatusByBackend]);
  useEffect(() => () => {
    for (const link of linksRef.current.values()) {
      if (link.reconnectTimer) clearTimeout(link.reconnectTimer);
      link.reconnectTimer = null;
    }
  }, []);

  // Backstop for the event-driven reconnect above: a socket can die without a
  // usable close event (sleep/wake, renderer churn, missed state transitions),
  // and state latches like manualDisconnect can silently suppress retries.
  // The watchdog reconnects whenever a socket is observably dead, and pings
  // an open socket so a half-open TCP connection is also detected.
  const linkStatusRef = useRef(linkStatusByBackend);
  linkStatusRef.current = linkStatusByBackend;
  useEffect(() => {
    if (!hydrated || !autoConnectEnabled) return;
    const tick = () => {
      for (const [backendId, link] of linksRef.current) {
        if (link.manualDisconnect) continue;
        const socket = link.socket;
        if (!socket || socket.closed) {
          link.verified = false;
          link.watchdogFailures = 0;
          const state = linkStatusRef.current[backendId]?.state;
          if (state === 'open') patchLinkStatus(backendId, { state: 'closed' });
          // Never connected, or waiting for Connect after a re-point.
          if (!state || state === 'idle' || state === 'connecting' || !link.lastFailureRetryable) continue;
          // A scheduled reconnect keeps its jittered backoff.
          if (link.reconnectTimer) continue;
          connectBackend(backendId);
          continue;
        }
        if (!socket.ready || !link.verified) continue;
        const livenessProbe = socket;
        void sendProtocolCommand({ id: createRequestId('watchdog'), type: 'server.ping', payload: {} }, SOCKET_LIVENESS_TIMEOUT_MS, backendId)
          .then(() => {
            link.watchdogFailures = 0;
          })
          .catch(() => {
            if (link.socket !== livenessProbe) return;
            link.watchdogFailures += 1;
            if (link.watchdogFailures < SOCKET_LIVENESS_MAX_FAILURES) return;
            link.watchdogFailures = 0;
            closeSocket(backendId, false);
            patchLinkStatus(backendId, { state: 'closed' });
          });
      }
    };
    const intervalId = setInterval(tick, SOCKET_WATCHDOG_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [autoConnectEnabled, closeSocket, connectBackend, hydrated, patchLinkStatus, sendProtocolCommand]);

  // At startup every backend with a server URL connects. Backends added or
  // re-pointed later connect on Connect, or once pairing completes.
  const autoConnectStartedRef = useRef(false);
  useEffect(() => {
    if (!hydrated || !autoConnectEnabled || autoConnectStartedRef.current) {
      return;
    }
    autoConnectStartedRef.current = true;
    for (const profile of backendConnectionsRef.current) {
      if (profile.serverUrl.trim() && !profile.disabled && !linksRef.current.has(profile.id)) connectBackend(profile.id);
    }
  }, [autoConnectEnabled, connectBackend, hydrated]);

  // Pairing approved a backend: connect it once the profile carrying the new
  // credentials has been committed.
  const pairingConnectPendingRef = useRef(new Set<string>());
  useEffect(() => {
    if (!pairingConnectPendingRef.current.size) return;
    const pending = [...pairingConnectPendingRef.current];
    pairingConnectPendingRef.current.clear();
    for (const backendId of pending) {
      if (profileFor(backendId)) connectBackend(backendId);
    }
  }, [backendConnections, connectBackend]);

  const sendProtocolMessage = useCallback(
    (
      type: string,
      payload: Record<string, unknown>,
      requestId = createRequestId('msg'),
      target?: TimelineTarget,
      backendId = target?.conversationId ? backendIdForConversation(target.conversationId) : backendIdForPayload(payload),
    ) => {
      const link = linksRef.current.get(backendId);
      if (!link?.socket?.ready || !link.verified) {
        if (autoConnectEnabled && profileFor(backendId)?.serverUrl.trim() && !link?.manualDisconnect) {
          setLastError(t('sess.reconnecting'));
          connectBackend(backendId);
        } else {
          setLastError(t('sess.connectBackendFirst'));
        }
        return false;
      }

      let message: { id: string; type: string; payload: Record<string, unknown> } | null;
      try {
        message = sendRawProtocolFrame({ id: requestId, type, payload }, backendId);
      } catch (error: unknown) {
        setLastError(
          error instanceof ConnectionError ? connectionErrorText(error) : t('sess.sendFailed'),
        );
        return false;
      }
      if (!message) {
        setLastError(t('sess.connectBackendFirst'));
        return false;
      }
      return true;
    },
    [appendTimeline, autoConnectEnabled, connectBackend, sendRawProtocolFrame],
  );

  /** Backend a terminal runs on: an SSH terminal's picked backend, else its
   * conversation's. */
  const terminalBackendId = (target: TerminalTarget) => (target.kind === 'ssh'
    ? target.backendConnectionId || activeBackendConnectionIdRef.current
    : ownerBackendId(target.conversation, target.workspace, noWorkspaceBackendIdRef.current));
  /** Tenant of a terminal: its workspace's, else its backend's. */
  const terminalTenantId = (target: TerminalTarget) => (target.kind === 'workspace' && target.workspace.tenantId)
    || settingsForBackend(terminalBackendId(target)).tenantId;

  const seedTerminalState = useCallback((target: TerminalTarget, patch: Partial<TerminalClientState> = {}) => {
    const workspace = target.kind === 'workspace' ? target.workspace : null;
    const terminalId = patch.terminalId?.trim() || terminalIdForConversation(
      target.kind === 'workspace' ? target.conversation.id : `ssh_${target.host}`,
    );
    setTerminalById((current) => {
      const existing = current[terminalId];
      const base: TerminalClientState = {
        terminalId,
        ...(target.kind === 'ssh' ? { ssh: { host: target.host } } : {}),
        workspaceId: workspace?.id ?? '',
        conversationId: target.kind === 'workspace' ? target.conversation.id : '',
        backendConnectionId: terminalBackendId(target),
        tenantId: terminalTenantId(target),
        cwd: workspace?.path ?? '',
        shell: '',
        rows: DEFAULT_TERMINAL_ROWS,
        cols: DEFAULT_TERMINAL_COLS,
        status: 'idle',
        error: '',
        pid: null,
        exitCode: null,
        updatedAt: Date.now(),
      };
      const merged: TerminalClientState = { ...base, ...existing, ...patch };
      return evictIdleTerminalStates({
        ...current,
        [terminalId]: merged,
      });
    });
    return terminalId;
  }, [settingsForBackend]);

  const sendTerminalStart = useCallback((
    target: TerminalTarget,
    terminalId: string,
    { cwd, shell, rows, cols }: { cwd: string; shell: string; rows: number; cols: number },
    password?: string,
  ) => {
    const sent = sendProtocolMessage('terminal.start', target.kind === 'ssh' ? {
      terminalId,
      tenantId: terminalTenantId(target),
      cwd: '',
      ssh: { host: target.host, ...(password ? { password } : {}) },
      rows,
      cols,
    } : {
      terminalId,
      tenantId: target.workspace.tenantId || settings.tenantId,
      workspaceId: target.workspace.id,
      cwd,
      shell: shell || undefined,
      rows,
      cols,
      shellIntegration: getTerminalPreferences().shellIntegration,
    }, createRequestId('terminal-start'), undefined, terminalBackendId(target));
    if (!sent) {
      setTerminalById((current) => {
        const existing = current[terminalId];
        if (!existing) {
          return current;
        }
        return {
          ...current,
          [terminalId]: {
            ...existing,
            status: 'error',
            error: t('sess.connectBackendFirst'),
            updatedAt: Date.now(),
          },
        };
      });
      appendTerminalError(terminalId, t('sess.connectBackendFirst'));
      return false;
    }
    return true;
  }, [appendTerminalError, sendProtocolMessage, settingsForBackend]);

  const startTerminalSession = useCallback((target: TerminalTarget, options: TerminalStartOptions) => {
    const workspace = target.kind === 'workspace' ? target.workspace : null;
    // SSH terminals run `ssh -tt <host>` on the backend; cwd/workspace are ignored.
    const cwd = workspace ? options.cwd.trim() || workspace.path : '';
    const shell = options.shell.trim();
    const rows = Number.isFinite(options.rows) ? Math.round(options.rows) : DEFAULT_TERMINAL_ROWS;
    const cols = Number.isFinite(options.cols) ? Math.round(options.cols) : DEFAULT_TERMINAL_COLS;
    const terminalId = seedTerminalState(target, {
      terminalId: options.terminalId,
      cwd,
      shell,
      rows,
      cols,
      status: 'starting',
      error: '',
      exitCode: null,
      stopRequested: false,
      sshPasswordAt: undefined,
    });
    // A new process numbers its output from 1 again.
    const stream = terminalStreamsRef.current.get(terminalId);
    stream.restart();
    if (!options.preserveOutput) stream.clear();
    startOnMissingRef.current.delete(terminalId);
    if (target.kind === 'ssh' && !options.interactive) {
      // A saved password signs in through the backend's askpass helper; the
      // keychain lookup is asynchronous, so the start is sent once it settles.
      void loadSshPassword(terminalBackendId(target), target.host).then((password) => {
        if (password) {
          setTerminalById((current) => {
            const existing = current[terminalId];
            return existing ? { ...current, [terminalId]: { ...existing, sshPasswordAt: Date.now() } } : current;
          });
        }
        sendTerminalStart(target, terminalId, { cwd, shell, rows, cols }, password ?? undefined);
      });
      return true;
    }
    return sendTerminalStart(target, terminalId, { cwd, shell, rows, cols });
  }, [seedTerminalState, sendTerminalStart]);

  startTerminalSessionRef.current = startTerminalSession;

  const sendTerminalInput = useCallback((terminalId: string, tenantId: string, data: string) => {
    const sent = sendProtocolMessage('terminal.input', {
      terminalId,
      tenantId,
      data,
    }, createRequestId('terminal-input'));
    if (sent) {
      return true;
    }
    if (terminalByIdRef.current[terminalId]) {
      appendTerminalError(terminalId, t('sess.connectBackendFirst'));
    }
    return false;
  }, [appendTerminalError, sendProtocolMessage]);

  const stopTerminalSession = useCallback((terminalId: string, tenantId: string, force = false) => {
    setTerminalById((current) => {
      const existing = current[terminalId];
      if (!existing) {
        return current;
      }
      return {
        ...current,
        [terminalId]: {
          ...existing,
          status: 'stopping',
          stopRequested: true,
          updatedAt: Date.now(),
        },
      };
    });
    return sendProtocolMessage('terminal.stop', {
      terminalId,
      tenantId,
      force,
    }, createRequestId('terminal-stop'));
  }, [sendProtocolMessage]);

  const resizeTerminalSession = useCallback((terminalId: string, tenantId: string, rows: number, cols: number) => {
    const nextRows = Number.isFinite(rows) ? Math.round(rows) : DEFAULT_TERMINAL_ROWS;
    const nextCols = Number.isFinite(cols) ? Math.round(cols) : DEFAULT_TERMINAL_COLS;
    setTerminalById((current) => {
      const existing = current[terminalId];
      if (!existing) {
        return current;
      }
      return {
        ...current,
        [terminalId]: {
          ...existing,
          rows: nextRows,
          cols: nextCols,
          updatedAt: Date.now(),
        },
      };
    });
    return sendProtocolMessage('terminal.resize', {
      terminalId,
      tenantId,
      rows: nextRows,
      cols: nextCols,
    }, createRequestId('terminal-resize'));
  }, [sendProtocolMessage]);

  const requestTerminalStatus = useCallback((target: TerminalTarget, terminalId?: string) => {
    const resolvedTerminalId = seedTerminalState(target, { terminalId });
    return sendProtocolMessage('terminal.status', target.kind === 'ssh' ? {
      tenantId: terminalTenantId(target),
      terminalId: resolvedTerminalId,
    } : {
      tenantId: target.workspace.tenantId || settings.tenantId,
      workspaceId: target.workspace.id,
      terminalId: resolvedTerminalId,
    }, createRequestId('terminal-status'), undefined, terminalBackendId(target));
  }, [seedTerminalState, sendProtocolMessage, settings.tenantId, settingsForBackend]);
  requestTerminalStatusRef.current = requestTerminalStatus;

  /** Whether `backendId` replays terminal output; undefined until known. */
  const terminalReplayFor = (backendId: string) => terminalReplayRef.current.get(backendId);

  /** Re-joins a running terminal: the backend resizes it and sends the
   * output after the last `seq` this client holds (or all it kept). */
  const attachTerminal = useCallback((terminalId: string, fresh = false) => {
    const terminal = terminalByIdRef.current[terminalId];
    if (!terminal) return false;
    const backendId = terminal.backendConnectionId || activeBackendConnectionIdRef.current;
    if (!terminalReplayFor(backendId)) {
      return sendProtocolMessage('terminal.status', { tenantId: terminal.tenantId, terminalId }, createRequestId('terminal-status'), undefined, backendId);
    }
    // One attach at a time: lag and gaps during a flood would otherwise
    // each ask for the same output again.
    // A view waiting for a snapshot always gets its own request.
    const sentAt = attachSentAtRef.current.get(terminalId);
    if (!fresh && sentAt !== undefined && Date.now() - sentAt < TERMINAL_ATTACH_TIMEOUT_MS) return true;
    attachSentAtRef.current.set(terminalId, Date.now());
    const stream = terminalStreamsRef.current.get(terminalId);
    return sendProtocolMessage('terminal.attach', {
      terminalId,
      tenantId: terminal.tenantId,
      // Without `since` the backend answers with the whole screen.
      ...(stream.seq > 0 && !fresh ? { since: stream.seq } : {}),
      rows: terminal.rows,
      cols: terminal.cols,
    }, createRequestId('terminal-attach'), undefined, backendId);
  }, [sendProtocolMessage]);
  attachTerminalRef.current = attachTerminal;

  /**
   * Asks for the running terminal's screen as a snapshot, for a view whose
   * kept output lost its start. False when the backend cannot send one (the
   * view then replays what it has).
   */
  const requestTerminalSnapshot = useCallback((terminalId: string) => {
    const terminal = terminalByIdRef.current[terminalId];
    if (!terminal || terminal.status !== 'running') return false;
    const backendId = terminal.backendConnectionId || activeBackendConnectionIdRef.current;
    if (!terminalSnapshotRef.current.get(backendId)) return false;
    return attachTerminal(terminalId, true);
  }, [attachTerminal]);

  /** After a reconnect or lag: catch every live terminal of `backendId` (all
   * backends when omitted) up with its output. */
  const reattachTerminals = useCallback((backendId?: string) => {
    for (const terminal of Object.values(terminalByIdRef.current)) {
      if (terminal.status !== 'running' && terminal.status !== 'stopping') continue;
      const owner = terminal.backendConnectionId || activeBackendConnectionIdRef.current;
      if (backendId && owner !== backendId) continue;
      attachTerminal(terminal.terminalId);
    }
  }, [attachTerminal]);
  reattachTerminalsRef.current = reattachTerminals;

  /** Wakes backends frozen for idleness (paused TodeX containers, see the
   * desktop's ContainerFreezer) before a send or terminal open reaches them. */
  const backendWakeGateRef = useRef<BackendWakeGate | null>(null);
  const setBackendWakeGate = useCallback((gate: BackendWakeGate | null) => {
    backendWakeGateRef.current = gate;
  }, []);

  /**
   * Shows the terminal `options.terminalId`: joins it when the backend still
   * runs it, otherwise starts it (unless `autoStart` is false, which leaves
   * it idle). Backends without replay get the older status-then-start check.
   */
  const openTerminalSession = useCallback((target: TerminalTarget, options: TerminalStartOptions & { autoStart: boolean }) => {
    const frozenBackend = terminalBackendId(target);
    if (backendWakeGateRef.current?.isFrozen(frozenBackend)) {
      void backendWakeGateRef.current.wake(frozenBackend).then(
        () => openTerminalSessionRef.current(target, options),
        (error: unknown) => setLastError(error instanceof Error ? error.message : String(error)),
      );
      return;
    }
    const terminalId = seedTerminalState(target, { terminalId: options.terminalId, rows: options.rows, cols: options.cols });
    const backendId = terminalBackendId(target);
    const replay = terminalReplayFor(backendId);
    if (replay === undefined) {
      // Decided once the backend's version arrives.
      pendingTerminalOpensRef.current.set(terminalId, () => openTerminalSessionRef.current(target, options));
      return;
    }
    const start = () => {
      if (options.autoStart) startTerminalSessionRef.current?.(target, { ...options, terminalId });
    };
    if (!replay) {
      requestTerminalStatusRef.current(target, terminalId);
      window.setTimeout(() => {
        const latest = terminalByIdRef.current[terminalId];
        if (!latest || latest.status === 'idle' || latest.status === 'exited' || latest.status === 'error') start();
      }, 300);
      return;
    }
    startOnMissingRef.current.set(terminalId, start);
    const stream = terminalStreamsRef.current.get(terminalId);
    const sent = sendProtocolMessage('terminal.attach', {
      terminalId,
      tenantId: terminalTenantId(target),
      ...(stream.seq > 0 ? { since: stream.seq } : {}),
      rows: options.rows,
      cols: options.cols,
    }, createRequestId('terminal-attach'), undefined, backendId);
    if (!sent) startOnMissingRef.current.delete(terminalId);
  }, [seedTerminalState, sendProtocolMessage, settingsForBackend]);
  const openTerminalSessionRef = useRef(openTerminalSession);
  openTerminalSessionRef.current = openTerminalSession;

  /** Records whether `backendId` replays terminal output, then rejoins its
   * live terminals and runs the opens that waited for this answer. */
  const noteTerminalReplay = useCallback((backendId: string, replay: boolean) => {
    terminalReplayRef.current.set(backendId, replay);
    reattachTerminalsRef.current(backendId);
    const waiting = [...pendingTerminalOpensRef.current.entries()];
    for (const [terminalId, open] of waiting) {
      const terminal = terminalByIdRef.current[terminalId];
      const owner = terminal?.backendConnectionId || activeBackendConnectionIdRef.current;
      if (terminal && owner !== backendId) continue;
      pendingTerminalOpensRef.current.delete(terminalId);
      open();
    }
  }, []);
  noteTerminalReplayRef.current = noteTerminalReplay;

  /** Clears the view and, where the backend keeps output, its copy too. */
  const clearTerminalOutput = useCallback((terminalId: string) => {
    terminalStreamsRef.current.get(terminalId).clear();
    const terminal = terminalByIdRef.current[terminalId];
    if (!terminal || terminal.status !== 'running') return;
    const backendId = terminal.backendConnectionId || activeBackendConnectionIdRef.current;
    if (terminalReplayFor(backendId)) {
      sendProtocolMessage('terminal.clear', { terminalId, tenantId: terminal.tenantId }, createRequestId('terminal-clear'), undefined, backendId);
    }
  }, [sendProtocolMessage]);

  /** Stops the backend PTYs of terminals that are going away with their
   * conversation or workspace, so they do not keep running unseen. */
  const stopTerminalsWhere = useCallback((matches: (terminal: TerminalClientState) => boolean) => {
    for (const terminal of Object.values(terminalByIdRef.current)) {
      if (!matches(terminal)) continue;
      startOnMissingRef.current.delete(terminal.terminalId);
      pendingTerminalOpensRef.current.delete(terminal.terminalId);
      terminalStreamsRef.current.delete(terminal.terminalId);
      if (terminal.status === 'running' || terminal.status === 'starting' || terminal.status === 'stopping') {
        sendProtocolMessage('terminal.stop', { terminalId: terminal.terminalId, tenantId: terminal.tenantId, force: true }, createRequestId('terminal-stop'));
      }
    }
  }, [sendProtocolMessage]);


  const createWorkspace = useCallback(
    (nameDraft: string, pathDraft: string, backendConnectionId = activeBackendConnectionIdRef.current) => {
      const path = pathDraft.trim();
      if (!path) {
        desktopAlert(t('alert.missingDirectory'), t('alert.missingDirectoryBody'));
        return null;
      }

      const name = nameDraft.trim() || displayNameFromPath(path);
      const id = createRequestId('workspace');
      const sessionId = createSessionId(name);
      const threadId = '';
      const nextWorkspace: WorkspaceRecord = {
        id,
        name,
        path,
        backendConnectionId,
        sessionId,
        tenantId: settings.tenantId,
        threadId,
        model: settings.defaultModel,
        reasoningEffort: null,
        approvalPolicy: settings.approvalPolicy,
        approvalsReviewer: null,
        sandboxMode: settings.sandboxMode,
        serviceTier: null,
        permissionProfile: null,
        personality: null,
        localAdapterState: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sortOrder: nextWorkspaceSortOrder(stores.workspaces.get()),
      };
      const nextConversation = createDefaultConversation(nextWorkspace);

      clearWorkspaceTombstone(nextWorkspace.path, nextWorkspace.backendConnectionId ?? null);
      setWorkspaces((current) => [nextWorkspace, ...current]);
      setConversations((current) => [nextConversation, ...current]);
      setActiveWorkspaceId(id);
      setActiveConversationId(nextConversation.id);
      pushSystem(t('sess.addedDirectoryTitle'), nextWorkspace.path);
      return { workspace: nextWorkspace, conversation: nextConversation };
    },
    [
      clearWorkspaceTombstone,
      pushSystem,
      settings.approvalPolicy,
      settings.defaultModel,
      settings.defaultReasoningEffort,
      settings.sandboxMode,
      settings.tenantId,
    ],
  );

  const updateBackendConnection = useCallback((id: string, requested: Partial<BackendConnectionProfile>) => {
    // A self-hosted deployment fixes each backend's address.
    const { serverUrl: _pinned, ...unpinned } = requested;
    const patch: Partial<BackendConnectionProfile> = platform.deployment ? unpinned : requested;
    setBackendConnections((current) => current.map((profile) => {
      if (profile.id !== id) return profile;
      const originChanged = patch.serverUrl !== undefined
        && normalizeServerUrl(profile.serverUrl) !== normalizeServerUrl(patch.serverUrl);
      // A new origin drops the device key and the transport pin unless the
      // patch sets them itself.
      return {
        ...profile,
        ...(originChanged ? UNPAIRED_TRANSPORT : {}),
        ...patch,
        updatedAt: Date.now(),
      };
    }));
  }, []);

  /** Updates app-wide preferences; changed transport fields re-point the
   * focused backend's profile (they belong to a backend, not the app). */
  const setSettings = useCallback((value: SetStateAction<ConnectionSettings>) => {
    const current = connectionRoutingRef.current;
    const next = typeof value === 'function' ? value(current) : value;
    setPreferences(next);
    const patch: Partial<BackendConnectionProfile> = {};
    if (next.serverUrl !== current.serverUrl) patch.serverUrl = next.serverUrl;
    if (next.deviceSecret !== current.deviceSecret) patch.deviceSecret = next.deviceSecret;
    if (next.tenantId !== current.tenantId) patch.tenantId = next.tenantId;
    if (next.encryptionProtocol !== current.encryptionProtocol) patch.encryptionProtocol = next.encryptionProtocol;
    if (next.encryptionPublicKey !== current.encryptionPublicKey) patch.encryptionPublicKey = next.encryptionPublicKey;
    if (next.transportVerified !== current.transportVerified) patch.transportVerified = next.transportVerified;
    const focusId = activeBackendConnectionIdRef.current;
    if (Object.keys(patch).length && profileFor(focusId)) updateBackendConnection(focusId, patch);
  }, [updateBackendConnection]);

  // Device pairing approved the device and the transport key it verified:
  // one profile update pins both, then the backend connects once the profile
  // carrying them has been committed (see the pairing effect).
  const onDevicePairingApproved = useCallback((
    profileId: string,
    credentials: Pick<BackendConnectionProfile, 'deviceSecret' | 'encryptionProtocol' | 'encryptionPublicKey' | 'transportVerified'>,
  ) => {
    updateBackendConnection(profileId, credentials);
    pairingConnectPendingRef.current.add(profileId);
  }, [updateBackendConnection]);

  const addBackendConnection = useCallback((profile?: Partial<BackendConnectionProfile>) => {
    // A self-hosted deployment fixes the backend list (its settings hide
    // the add button); stay on the first backend instead.
    if (platform.deployment) return backendConnectionsRef.current[0];
    const id = createRequestId('backend');
    // A new backend never inherits the current device key or transport pin.
    const next: BackendConnectionProfile = { ...profileFromSettings(connectionRoutingRef.current, t('session.newBackend'), id), ...UNPAIRED_TRANSPORT, ...profile, id, createdAt: Date.now(), updatedAt: Date.now() };
    setBackendConnections((current) => [...current, next]);
    return next;
  }, []);

  /** Removes a backend profile: its connection closes, and its device key
   * and history keys are forgotten. The last backend cannot be removed. */
  const removeBackendConnection = useCallback((id: string) => {
    const profiles = backendConnectionsRef.current;
    if (platform.deployment || profiles.length <= 1 || !profiles.some((profile) => profile.id === id)) return;
    closeSocket(id, true);
    linksRef.current.get(id)?.commands.dispose();
    linksRef.current.delete(id);
    configureKanbanSync(id, null);
    setLinkStatusByBackend(({ [id]: _removed, ...rest }) => rest);
    setV2ConversationsByBackend(({ [id]: _removed, ...rest }) => rest);
    setDirectorySyncByBackend(({ [id]: _removed, ...rest }) => rest);
    void removeSecret(`${DEVICE_SECRET_STORAGE_KEY}.${id}`).catch((error) => {
      setLastError(error instanceof Error ? error.message : t('sess.credentialClearFailed'));
    });
    void historyTailCache?.forgetBackend(id);
    void historyEncryptionRef.current?.forgetBackend(id).catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : t('history.keyFailed'));
    });
    setBackendConnections((current) => current.filter((profile) => profile.id !== id));
  }, [closeSocket]);

  /** Hands backend `loserId` over to `winnerId`, a profile of the same
   * daemon (its IPC connection, say): the loser disconnects and stays
   * disabled, the winner is enabled and connects, and the loser's workspaces
   * and conversations move to the winner, so the ids the daemon issued are
   * listed once. The loser keeps its device key and history key, so the
   * swap can be undone the same way. */
  const replaceBackendConnection = useCallback((loserId: string, winnerId: string) => {
    const profiles = backendConnectionsRef.current;
    const winner = profiles.find((profile) => profile.id === winnerId);
    if (loserId === winnerId || !winner || !profiles.some((profile) => profile.id === loserId)) return;
    // Drop the loser's link first: workspace saves only reach linked
    // backends, so its emptied scope is never pushed to the daemon.
    closeSocket(loserId, true);
    linksRef.current.get(loserId)?.commands.dispose();
    linksRef.current.delete(loserId);
    configureKanbanSync(loserId, null);
    setLinkStatusByBackend(({ [loserId]: _removed, ...rest }) => rest);
    setV2ConversationsByBackend(({ [loserId]: _removed, ...rest }) => rest);
    setDirectorySyncByBackend(({ [loserId]: _removed, ...rest }) => rest);
    const moved = moveBackendRecords({
      workspaces: stores.workspaces.get(),
      conversations: stores.conversations.get(),
      tombstones: stores.workspaceTombstones.get(),
    }, loserId, winnerId);
    setWorkspaces(moved.workspaces);
    setConversations(moved.conversations);
    setWorkspaceTombstones(moved.tombstones);
    const keptConversationId = moved.conversationIds.get(activeConversationRef.current);
    if (keptConversationId) setActiveConversationId(keptConversationId);
    setNoneBackendSelection((current) => (current === loserId ? winnerId : current));
    setBackendConnections((current) => current.map((profile) => {
      if (profile.id === loserId) return { ...profile, disabled: true, updatedAt: Date.now() };
      if (profile.id === winnerId && profile.disabled) {
        const { disabled: _disabled, ...enabled } = profile;
        return { ...enabled, updatedAt: Date.now() };
      }
      return profile;
    }));
    if (winner.disabled) pairingConnectPendingRef.current.add(winnerId);
  }, [closeSocket]);

  /** Opens a workspace. None is listed once per backend: `noneBackendId`
   * picks which backend's None conversations it shows and starts. */
  const selectWorkspace = useCallback((workspaceId: string, noneBackendId?: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace || workspace.pathMissing) {
      return;
    }
    const noneBackend = isNoneWorkspaceId(workspaceId) ? noneBackendId || noWorkspaceBackendIdRef.current : '';
    if (noneBackend) setNoneBackendSelection(noneBackend);
    setActiveWorkspaceId(workspaceId);
    const conversation = conversations.find((item) => item.workspaceId === workspaceId
      && (!noneBackend || ownerBackendId(item, workspace, noneBackend) === noneBackend));
    if (conversation) {
      setActiveConversationId(conversation.id);
    } else {
      const nextConversation = noneBackend
        ? { ...createDefaultConversation(workspace), backendConnectionId: noneBackend }
        : createDefaultConversation(workspace);
      setConversations((current) => current.some((item) => item.id === nextConversation.id) ? current : [nextConversation, ...current]);
      setActiveConversationId(nextConversation.id);
    }
    setLastError('');
  }, [conversations, workspaces]);

  const selectConversation = useCallback((workspaceId: string, conversationId: string) => {
    setActiveWorkspaceId(workspaceId);
    setActiveConversationId(conversationId);
    setLastError('');
  }, []);

  /** Shows a child conversation (Agent Calling) in the main chat. Children
   * are left out of the conversation list, so one opened for the first time
   * is fetched by id from its parent's backend and kept as a hidden record
   * in the parent's workspace. */
  const openAgentCallConversation = useCallback(async (parentConversationId: string, childConversationId: string, fallbackTitle?: string) => {
    const existing = stores.conversations.get().find((item) => item.v2ConversationId === childConversationId || item.id === childConversationId);
    if (existing) {
      selectConversation(existing.workspaceId, existing.id);
      return;
    }
    const parent = stores.conversations.get().find((item) => item.id === parentConversationId || item.v2ConversationId === parentConversationId);
    if (!parent) throw new Error(t('agentCalls.parentMissing'));
    const backendId = backendIdForConversation(parent.id);
    const profile = profileFor(backendId);
    if (!profile) throw new Error(t('sidebar.backendRemoved'));
    // Children are not listed, so their sealed title is decrypted here; the
    // call's own title stands in when it cannot be read.
    const manifest = await withDecryptedManifest(backendId, await backendApi(profile).getConversation(childConversationId));
    const workspace = stores.workspaces.get().find((item) => item.id === parent.workspaceId);
    const base = conversationFromManifest(
      !manifest.title && fallbackTitle?.trim() ? { ...manifest, title: fallbackTitle.trim() } : manifest,
      parent.workspaceId,
    );
    const record: ConversationRecord = {
      ...base,
      ...(workspace ? manifestRunModes(backendId)(base, workspace) : {}),
      ...(parent.backendConnectionId ? { backendConnectionId: parent.backendConnectionId } : {}),
      parentConversationId: manifest.parentConversationId || parent.v2ConversationId || parent.id,
    };
    setConversations((current) => current.some((item) => item.v2ConversationId === manifest.id) ? current : [record, ...current]);
    const localId = stores.conversations.get().find((item) => item.v2ConversationId === manifest.id)?.id ?? record.id;
    selectConversation(parent.workspaceId, localId);
  }, [selectConversation]);

  /** Cancels a child conversation's running turn (Agent Calling) through its
   * parent's backend; the parent's journal reports the result. */
  const cancelAgentCall = useCallback(async (parentConversationId: string, childConversationId: string, childTurnId?: string) => {
    const profile = profileFor(backendIdForConversation(parentConversationId));
    if (!profile) throw new Error(t('sidebar.backendRemoved'));
    return backendApi(profile).cancel(childConversationId, childTurnId);
  }, []);

  /** A turn that finished out of sight goes to the notification history. */
  const recordCompletion = (localId: string, state: { timeline: TimelineEntry[] }) => {
    const conversation = stores.conversations.get().find((item) => item.id === localId);
    const workspace = stores.workspaces.get().find((item) => item.id === conversation?.workspaceId);
    // A private conversation is announced without its title or reply, and
    // the entry is never stored.
    const hidden = isPrivateConversation(conversation);
    addNotification({
      kind: 'conversation',
      status: 'success',
      title: hidden ? t('private.notifyReply') : conversation?.title?.trim() || workspace?.name?.trim() || 'TodeX',
      description: hidden ? '' : completionNotificationBody(state.timeline),
      workspaceId: conversation?.workspaceId,
      conversationId: localId,
      ...(hidden ? { ephemeral: true } : {}),
    });
  };

  notifyTurnCompletedRef.current = (localId, state, turnId) => {
    const viewingConversation = activeConversationRef.current === localId
      && document.visibilityState === 'visible'
      && document.hasFocus();
    if (!shouldNotifyCompletion({
      enabled: completionNotificationsState.completionNotifications,
      supported: completionNotificationsState.completionNotificationsSupported,
      viewingConversation,
    })) {
      if (!viewingConversation) recordCompletion(localId, state);
      return;
    }
    const conversation = stores.conversations.get().find((item) => item.id === localId);
    const workspace = stores.workspaces.get().find((item) => item.id === conversation?.workspaceId);
    recordCompletion(localId, state);
    const hidden = isPrivateConversation(conversation);
    postCompletionNotification({
      title: hidden ? t('private.notifyReply') : conversation?.title?.trim() || workspace?.name?.trim() || 'TodeX',
      body: hidden ? '' : completionNotificationBody(state.timeline),
      tag: `turn-completed-${state.conversationId}-${turnId}`,
      onActivate: () => { if (conversation) selectConversation(conversation.workspaceId, localId); },
    });
  };

  /** Each permission request alerts once, like a finished turn: to the
   * notification history when out of sight, and as a system notification
   * when completion alerts are on. */
  const notifiedPermissionIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const ownerById = new Map<string, string>();
    for (const [localId, state] of Object.entries(permissionRuntimes)) {
      for (const permission of state.pendingPermissions) ownerById.set(permission.id, localId);
    }
    for (const request of pendingRequests) {
      const localId = ownerById.get(request.requestId);
      if (!localId || notifiedPermissionIdsRef.current.has(request.requestId)) continue;
      notifiedPermissionIdsRef.current.add(request.requestId);
      const viewingConversation = activeConversationRef.current === localId
        && document.visibilityState === 'visible'
        && document.hasFocus();
      if (viewingConversation) continue;
      const conversation = stores.conversations.get().find((item) => item.id === localId);
      const workspace = stores.workspaces.get().find((item) => item.id === conversation?.workspaceId);
      // A private conversation's request is announced without what it asks.
      const hidden = isPrivateConversation(conversation);
      const title = hidden ? t('private.notifyPermission') : conversation?.title?.trim() || workspace?.name?.trim() || 'TodeX';
      const body = hidden ? '' : permissionNotificationBody(request);
      addNotification({
        kind: 'conversation',
        status: 'information',
        title,
        description: body,
        workspaceId: conversation?.workspaceId,
        conversationId: localId,
        ...(hidden ? { ephemeral: true } : {}),
      });
      if (!shouldNotifyCompletion({
        enabled: completionNotificationsState.completionNotifications,
        supported: completionNotificationsState.completionNotificationsSupported,
        viewingConversation,
      })) continue;
      postCompletionNotification({
        title,
        body,
        tag: `permission-request-${request.requestId}`,
        onActivate: () => { if (conversation) selectConversation(conversation.workspaceId, localId); },
      });
    }
  }, [
    pendingRequests,
    permissionRuntimes,
    completionNotificationsState.completionNotifications,
    completionNotificationsState.completionNotificationsSupported,
    selectConversation,
  ]);

  const removeWorkspace = useCallback(
    (workspaceId: string) => {
      if (isNoneWorkspaceId(workspaceId)) {
        return;
      }
      const removedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
      if (removedWorkspace) {
        // A tombstone keeps the merge-based sync from resurrecting the
        // workspace while the backend record is still around or unreachable.
        const tombstone: WorkspaceTombstone = {
          id: removedWorkspace.id,
          path: removedWorkspace.path,
          backendConnectionId: removedWorkspace.backendConnectionId ?? activeBackendConnectionId,
          deletedAt: Date.now(),
        };
        const nextTombstones = [
          tombstone,
          ...stores.workspaceTombstones.get().filter((item) =>
            item.id !== tombstone.id && normalizeWorkspacePath(item.path) !== normalizeWorkspacePath(tombstone.path)),
        ].slice(0, MAX_WORKSPACE_TOMBSTONES);
        setWorkspaceTombstones(nextTombstones);
      }
      const ownerProfile = profileFor(removedWorkspace?.backendConnectionId ?? activeBackendConnectionId);
      if (removedWorkspace && ownerProfile && linkStatusRef.current[ownerProfile.id]?.state === 'open') {
        void backendFetch(ownerProfile, {
          method: 'DELETE',
          path: `/v2/workspaces/${encodeURIComponent(workspaceId)}`,
        }).then(async (response) => {
          // 404 means the backend holds no matching record — the desired state.
          if (!response.ok && response.status !== 404) throw await readBackendError(response, t('sess.workspaceDeleteSyncFailed'));
        }).catch((error) => setLastError(error instanceof Error ? error.message : t('sess.workspaceDeleteSyncFailed')));
      }
      const removedConversationIds = conversations
        .filter((conversation) => conversation.workspaceId === workspaceId)
        .map((conversation) => conversation.id);
      // Release the websocket subscription slots held by this workspace's
      // conversations; they no longer exist locally.
      for (const conversation of conversations) {
        if (conversation.workspaceId === workspaceId && conversation.v2ConversationId) {
          unsubscribeV2Conversation(conversation.v2ConversationId);
        }
      }
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      setConversations((current) => current.filter((conversation) => conversation.workspaceId !== workspaceId));
      setTimeline((current) => current.filter((entry) => entry.workspaceId !== workspaceId && !removedConversationIds.includes(entry.conversationId ?? '')));
      const pruneConversationState = <T,>(current: Record<string, T>) => {
        const next = { ...current };
        removedConversationIds.forEach((id) => {
          delete next[id];
        });
        return next;
      };
      setChatDrafts(pruneConversationState);
      removedConversationIds.forEach((id) => heldFollowUpsRef.current.delete(id));
      setComposerSelections(pruneConversationState);
      setComposerAttachments(pruneConversationState);
      setSelectedSkills(pruneConversationState);
      setTurnIds(pruneConversationState);
      setThinkingConversations(pruneConversationState);
      stopTerminalsWhere((terminal) => terminal.workspaceId === workspaceId || removedConversationIds.includes(terminal.conversationId));
      setTerminalById((current) => {
        const next = { ...current };
        Object.entries(next).forEach(([terminalId, terminal]) => {
          if (terminal.workspaceId === workspaceId || removedConversationIds.includes(terminal.conversationId)) {
            delete next[terminalId];
          }
        });
        return next;
      });
      if (activeWorkspaceId === workspaceId) {
        const next = workspaces.find((workspace) => workspace.id !== workspaceId);
        setActiveWorkspaceId(next?.id ?? '');
        setActiveConversationId(conversations.find((conversation) => conversation.workspaceId === next?.id)?.id ?? '');
      }
    },
    [activeBackendConnectionId, activeWorkspaceId, conversations, unsubscribeV2Conversation, workspaces],
  );

  const renameWorkspace = useCallback((workspaceId: string, name: string) => {
    if (isNoneWorkspaceId(workspaceId)) {
      return;
    }
    const nextName = name.trim();
    if (!nextName) {
      desktopAlert(t('alert.nameRequired'), t('alert.workspaceNameBody'));
      return;
    }
    updateWorkspace(workspaceId, { name: nextName });
  }, [updateWorkspace]);

  const forkWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace || isNoneWorkspaceId(workspace.id)) {
      desktopAlert(t('alert.workspaceNotFound'), t('alert.workspaceNotFoundBody'));
      return null;
    }

    const now = Date.now();
    const nextWorkspace: WorkspaceRecord = {
      ...workspace,
      id: createRequestId('workspace'),
      name: `${workspace.name} fork`,
      sessionId: createSessionId(`${workspace.name}_fork`),
      threadId: '',
      localAdapterState: 'idle',
      createdAt: now,
      updatedAt: now,
      sortOrder: nextWorkspaceSortOrder(workspaces),
    };
    const sourceConversations = conversations.filter((conversation) => conversation.workspaceId === workspaceId);
    const nextConversations = sourceConversations.length > 0
      ? sourceConversations.map((conversation) => ({
          ...forkConversationRecord(conversation),
          workspaceId: nextWorkspace.id,
        }))
      : [createDefaultConversation(nextWorkspace)];

    clearWorkspaceTombstone(nextWorkspace.path, nextWorkspace.backendConnectionId ?? null);
    setWorkspaces((current) => [nextWorkspace, ...current]);
    setConversations((current) => [...nextConversations, ...current]);
    setActiveWorkspaceId(nextWorkspace.id);
    setActiveConversationId(nextConversations[0]?.id ?? '');
    return { workspace: nextWorkspace, conversation: nextConversations[0] ?? null };
  }, [clearWorkspaceTombstone, conversations, workspaces]);
















  const applyConversationPermissionMode = useCallback(async (
    conversationId: string,
    mode: PermissionMode,
  ): Promise<boolean> => {
    const context = getConversationContext(conversationId);
    if (!context) return false;
    const config = conversationPermissionCapabilities(context.conversation, providersForConversation(context.conversation));
    if (!config?.modes?.includes(mode)) {
      setLastError(t('sess.permissionModeUnsupported'));
      return false;
    }
    if (pendingV2SubmissionsRef.current.has(conversationId) || thinkingConversationsRef.current[conversationId] === true) {
      setLastError(t('sess.permissionWait'));
      return false;
    }
    updateConversation(conversationId, { permissionMode: mode });
    rememberProviderRunModes(
      context.conversation.backendConnectionId ?? context.workspace.backendConnectionId ?? activeBackendConnectionId,
      context.conversation.provider,
      { permissionMode: mode },
    );
    return true;
  }, [activeBackendConnectionId, getConversationContext, rememberProviderRunModes, updateConversation]);

  const applyConversationWorkMode = useCallback(async (
    conversationId: string,
    mode: 'plan' | 'implement',
  ): Promise<boolean> => {
    const context = getConversationContext(conversationId);
    if (!context) return false;
    const config = conversationPermissionCapabilities(context.conversation, providersForConversation(context.conversation));
    if (mode === 'plan' && !config?.supportsPlan) {
      setLastError(t('sess.workModeUnsupported'));
      return false;
    }
    if (pendingV2SubmissionsRef.current.has(conversationId) || thinkingConversationsRef.current[conversationId] === true) {
      setLastError(t('sess.workModeWait'));
      return false;
    }
    updateConversation(conversationId, { mode });
    rememberProviderRunModes(
      context.conversation.backendConnectionId ?? context.workspace.backendConnectionId ?? activeBackendConnectionId,
      context.conversation.provider,
      { workMode: mode },
    );
    return true;
  }, [activeBackendConnectionId, getConversationContext, rememberProviderRunModes, updateConversation]);

  const applyPermissionProfile = useCallback(async (
    conversationId: string,
    profileId: string,
    _description = '',
    approvalsReviewer?: string | null,
  ) => {
    const preset = permissionPresetForProfile(profileId, approvalsReviewer);
    if (!preset) { setLastError(t('sess.permissionPresetRequired')); return false; }
    return applyConversationPermissionMode(conversationId,
      preset.id === 'full-access' ? 'full-access' : preset.id === 'auto-review' ? 'auto' : 'ask');
  }, [applyConversationPermissionMode]);






  // The latest diff request per conversation; older answers are dropped.
  const gitDiffRequestRef = useRef(new Map<string, number>());
  const requestGitDiff = useCallback(async (conversationId = activeConversationRef.current, cwd = '') => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    const empty: GitDiffState = { status: 'idle', diff: '', sha: '', error: '', updatedAt: 0 };
    setGitDiffByConversation((current) => ({
      ...current,
      [conversation.id]: { ...(current[conversation.id] ?? empty), status: 'loading', error: '' },
    }));
    const requestNumber = (gitDiffRequestRef.current.get(conversation.id) ?? 0) + 1;
    gitDiffRequestRef.current.set(conversation.id, requestNumber);
    const current = () => gitDiffRequestRef.current.get(conversation.id) === requestNumber;
    // The backend's whole-repo diff (GET /v2/git/diff without `path`); no
    // local Codex adapter is started for it.
    const repoPath = cwd.trim() || workspace.path;
    try {
      const result = await readGitWorkingTreeDiff(settingsForBackend(backendIdForConversation(conversation.id)), repoPath);
      if (!current()) return false;
      setGitDiffByConversation((latest) => ({
        ...latest,
        [conversation.id]: {
          status: 'ready',
          diff: result.diff,
          sha: result.base ?? '',
          error: '',
          updatedAt: Date.now(),
          baseRef: result.baseRef,
          truncated: result.truncated,
        },
      }));
      return true;
    } catch (error) {
      if (!current()) return false;
      const message = gitDiffUnsupported(error)
        ? t('sess.gitDiffBackendTooOld')
        : error instanceof Error ? error.message : t('sess.gitDiffFailed');
      setGitDiffByConversation((latest) => ({
        ...latest,
        [conversation.id]: { ...(latest[conversation.id] ?? empty), status: 'error', error: message, updatedAt: Date.now() },
      }));
      return false;
    }
  }, [getConversationContext, settingsForBackend]);

  const selectGitRepo = useCallback((workspaceId: string, path: string) => {
    setSelectedGitRepoByWorkspace((current) => (current[workspaceId] === path
      ? current
      : { ...current, [workspaceId]: path }));
  }, []);

  const openGitDiff = useCallback((conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return;
    }
    openPanel('GitDiff', {
      workspaceId: context.workspace.id,
      conversationId: context.conversation.id,
    });
    void requestGitDiff(context.conversation.id, selectedGitRepoByWorkspace[context.workspace.id] || '');
  }, [getConversationContext, requestGitDiff, selectedGitRepoByWorkspace]);

  const openTerminal = useCallback((conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return;
    }
    const target: TerminalTarget = { kind: 'workspace', workspace: context.workspace, conversation: context.conversation };
    seedTerminalState(target);
    openPanel('Terminal', {
      workspaceId: context.workspace.id,
      conversationId: context.conversation.id,
    });
    if (linkStatusRef.current[backendIdForConversation(context.conversation.id)]?.state === 'open') {
      requestTerminalStatus(target);
    }
  }, [getConversationContext, requestTerminalStatus, seedTerminalState]);


  const openExperimentalFeatures = useCallback((conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return;
    }
    openPanel('Experimental', {
      workspaceId: context.workspace.id,
      conversationId: context.conversation.id,
    });
  }, [getConversationContext]);


  // Only local, never-started placeholders are disposable. A remote ID may
  // represent history that has not been loaded yet.
  const isUnusedConversation = useCallback((conversation: ConversationRecord) => (
    !conversation.archived
    && !isPrivateConversation(conversation)
    && !conversation.v2ConversationId
    && !conversation.preview?.trim()
    && !turnIdsRef.current[conversation.id]
    && !pendingV2ConversationCreatesRef.current.has(conversation.id)
    && !pendingV2FirstPromptsRef.current.has(conversation.id)
    && canSwitchConversationAgent(conversation, {
      timeline: stores.timeline.get(),
      thinking: thinkingConversationsRef.current[conversation.id] === true,
    })
  ), []);

  useEffect(() => {
    if (!hydrated || !conversations.some((item) => item.id === activeConversationId && item.workspaceId === activeWorkspaceId)) return;
    const unusedIds = new Set(conversations
      .filter((item) => item.id !== activeConversationId && isUnusedConversation(item))
      .map((item) => item.id));
    if (unusedIds.size === 0) return;
    setConversations((current) => current.filter((item) => !unusedIds.has(item.id)));
    const withoutUnused = <T,>(current: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !unusedIds.has(id)));
    setChatDrafts(withoutUnused);
    setComposerSelections(withoutUnused);
    setComposerAttachments(withoutUnused);
    setSelectedSkills(withoutUnused);
  }, [activeConversationId, activeWorkspaceId, conversations, hydrated, isUnusedConversation]);

  const createConversation = useCallback((
    workspaceId: string,
    // `fresh` never recycles an unused draft: a kanban task owns each
    // conversation it starts, so two starts must not share one. `ephemeral`
    // marks the placeholder of a private conversation (always fresh, never
    // persisted, never reused by a normal "new conversation").
    options?: { provider?: ProviderKind; providerProfile?: string; title?: string; backendConnectionId?: string; fresh?: boolean; ephemeral?: boolean },
  ) => {
    const workspace = stores.workspaces.get().find((item) => item.id === workspaceId);
    if (!workspace) {
      desktopAlert(t('alert.workspaceNotFound'), t('alert.workspaceNotFoundBody'));
      return null;
    }
    const backendProfile = backendConnections.find((item) => item.id === options?.backendConnectionId) ?? backendConnections.find((item) => item.id === workspace.backendConnectionId);
    // None spans every backend: its new conversations start on the backend
    // chosen for it in Settings.
    const backendConnectionId = backendProfile?.id
      ?? workspace.backendConnectionId
      ?? (isNoneWorkspaceId(workspace.id) ? noWorkspaceBackendIdRef.current || null : null);
    // The agents the conversation's own backend offers.
    const providers = (backendConnectionId ? v2ProvidersByBackendRef.current[backendConnectionId] : undefined) ?? v2ProvidersRef.current;
    const agent = resolveCreateConversationAgent({
      requestedProvider: options?.provider,
      requestedProfile: options?.providerProfile,
      providers,
      conversations: stores.conversations.get(),
      activeConversationId: activeConversationRef.current,
      workspaceId: workspace.id,
    });
    if (!agent) {
      desktopAlert(
        options?.provider ? t('alert.agentUnavailable') : t('alert.noAgent'),
        options?.provider ? t('alert.agentUnavailableBody') : t('alert.noAgentHint'),
      );
      return null;
    }

    const rememberedSelection = resolveRememberedProviderSelection(backendConnectionId, agent.provider);
    const runModes = rememberedRunModes(
      providerModelPreferencesRef.current[providerModelPreferenceKey(backendConnectionId, agent.provider)],
      providers.find((item) => item.id === agent.provider)?.capabilities.permissionConfig,
    );
    const existing = options?.fresh || options?.ephemeral ? undefined : stores.conversations.get().find((item) =>
      item.workspaceId === workspaceId
      && item.backendConnectionId === backendConnectionId
      && isUnusedConversation(item));
    if (existing && existing.provider && !options?.provider && !options?.title) {
      const record = { ...existing, permissionMode: runModes.permissionMode, mode: runModes.mode };
      if (record.permissionMode !== existing.permissionMode || record.mode !== existing.mode) {
        setConversations((current) => current.map((item) => item.id === record.id ? record : item));
      }
      setActiveWorkspaceId(workspace.id);
      setActiveConversationId(record.id);
      return record;
    }
    const now = Date.now();
    const placeholder = {
      ...(existing ?? createDefaultConversation(workspace)),
      title: options?.title?.trim() || t('chat.newConversation'),
      provider: agent.provider,
      providerProfile: agent.providerProfile,
      permissionMode: runModes.permissionMode,
      mode: runModes.mode,
      backendConnectionId,
      model: rememberedSelection.model || undefined,
      reasoningEffort: rememberedSelection.reasoningEffort,
      ...(options?.ephemeral ? { ephemeral: true } : {}),
      createdAt: now,
      updatedAt: now,
    };
    setConversations((current) => [placeholder, ...current.filter((item) => item.id !== placeholder.id)]);
    setActiveWorkspaceId(workspace.id);
    setActiveConversationId(placeholder.id);
    return placeholder;
  }, [backendConnections, isUnusedConversation, resolveRememberedProviderSelection]);

  /** Gives a draft without an agent the one a new conversation there would
   * start with (its backend's agents, remembered model and run modes), in
   * place, so typed text and attachments stay. Every conversation runs
   * through an agent; the old local Codex path is gone. Resolves the record
   * to send with, or null (with an alert unless `quiet`) when no agent is
   * available or the record is retired local Codex history. */
  const ensureConversationAgent = useCallback((conversationId: string, { quiet = false }: { quiet?: boolean } = {}): ConversationRecord | null => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId);
    if (!conversation) return null;
    if (isV2Conversation(conversation)) return conversation;
    if (conversation.legacyCodex) {
      if (!quiet) setLastError(t('sess.legacyCodexReadOnly'));
      return null;
    }
    const workspace = stores.workspaces.get().find((item) => item.id === conversation.workspaceId);
    const backendConnectionId = conversation.backendConnectionId
      ?? workspace?.backendConnectionId
      ?? (isNoneWorkspaceId(conversation.workspaceId) ? noWorkspaceBackendIdRef.current || null : null);
    const providers = (backendConnectionId ? v2ProvidersByBackendRef.current[backendConnectionId] : undefined) ?? v2ProvidersRef.current;
    const agent = resolveCreateConversationAgent({
      providers,
      conversations: stores.conversations.get(),
      activeConversationId: activeConversationRef.current,
      workspaceId: conversation.workspaceId,
    });
    if (!agent) {
      if (!quiet) desktopAlert(t('alert.noAgent'), t('alert.noAgentHint'));
      return null;
    }
    const rememberedSelection = resolveRememberedProviderSelection(backendConnectionId, agent.provider);
    const runModes = rememberedRunModes(
      providerModelPreferencesRef.current[providerModelPreferenceKey(backendConnectionId, agent.provider)],
      providers.find((item) => item.id === agent.provider)?.capabilities.permissionConfig,
    );
    const record: ConversationRecord = {
      ...conversation,
      provider: agent.provider,
      providerProfile: agent.providerProfile,
      permissionMode: runModes.permissionMode,
      mode: runModes.mode,
      backendConnectionId,
      model: rememberedSelection.model || undefined,
      reasoningEffort: rememberedSelection.reasoningEffort,
    };
    setConversations((current) => current.map((item) => (item.id === conversationId ? record : item)));
    return record;
  }, [resolveRememberedProviderSelection]);

  // The draft in view gets its agent as soon as its backend lists one, so
  // the composer shows that agent's models, permissions and commands.
  useEffect(() => {
    const conversation = conversations.find((item) => item.id === activeConversationId);
    if (!conversation || isV2Conversation(conversation) || conversation.legacyCodex) return;
    ensureConversationAgent(conversation.id, { quiet: true });
  }, [activeConversationId, conversations, ensureConversationAgent, v2Providers, v2ProvidersByBackend]);

  /** Open a backend-validated worktree as a separate workspace/conversation. */
  const openGitWorktree = useCallback((path: string, sourceConversationId: string): {
    workspace: WorkspaceRecord; conversation: ConversationRecord;
  } | null => {
    const source = stores.conversations.get().find(item => item.id === sourceConversationId);
    const sourceWorkspace = source && stores.workspaces.get().find(item => item.id === source.workspaceId);
    const targetPath = path.trim();
    if (!source || !sourceWorkspace || !targetPath || targetPath.includes('\0')
      || !(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(targetPath))) {
      setLastError(t('sess.worktreeInvalid'));
      return null;
    }
    const backendId = source.backendConnectionId ?? sourceWorkspace.backendConnectionId
      ?? activeBackendConnectionIdRef.current;
    if (backendId !== activeBackendConnectionIdRef.current
      || (source.backendConnectionId && sourceWorkspace.backendConnectionId
        && source.backendConnectionId !== sourceWorkspace.backendConnectionId)) {
      setLastError(t('sess.worktreeBackendSwitched'));
      return null;
    }
    const pathKey = (value: string) => value.replace(/[\\/]+$/, '') || '/';
    let workspace = stores.workspaces.get().find(item =>
      (item.backendConnectionId ?? activeBackendConnectionIdRef.current) === backendId
      && pathKey(item.path) === pathKey(targetPath));
    let conversation = workspace && stores.conversations.get().find(item =>
      item.workspaceId === workspace!.id
      && (item.backendConnectionId ?? workspace!.backendConnectionId ?? backendId) === backendId);
    if (!workspace) {
      // createWorkspace owns the normal defaults and sidebar selection. Publish
      // its records to refs immediately so a second click cannot create duplicates.
      const created = createWorkspace(displayNameFromPath(targetPath), targetPath, backendId);
      if (!created) return null;
      workspace = { ...created.workspace, backendConnectionId: backendId,
        model: sourceWorkspace.model, reasoningEffort: sourceWorkspace.reasoningEffort,
        approvalPolicy: sourceWorkspace.approvalPolicy, approvalsReviewer: sourceWorkspace.approvalsReviewer,
        sandboxMode: sourceWorkspace.sandboxMode, permissionProfile: sourceWorkspace.permissionProfile,
        serviceTier: sourceWorkspace.serviceTier, personality: sourceWorkspace.personality };
      const record = workspace;
      setWorkspaces(current => [record, ...current.filter(item => item.id !== record.id)]);
      conversation = created.conversation;
    }
    if (!conversation || !stores.conversations.get().some(item => item.id === conversation!.id)) {
      conversation = { ...(conversation ?? createDefaultConversation(workspace)),
        backendConnectionId: backendId, provider: source.provider, providerProfile: source.providerProfile,
        model: source.model, reasoningEffort: source.reasoningEffort, mode: source.mode,
        permissionMode: source.permissionMode };
      const record = conversation;
      setConversations(current => [record, ...current.filter(item => item.id !== record.id)]);
    }
    // Use current refs so rapid clicks reuse the same records. The backend
    // remains the source backend; the source native thread is never moved.
    activeWorkspaceRef.current = workspace.id;
    activeConversationRef.current = conversation.id;
    setActiveWorkspaceId(workspace.id);
    setActiveConversationId(conversation.id);
    setLastError('');
    return { workspace, conversation };
  }, [createWorkspace]);

  const switchConversationAgent = useCallback((conversationId: string, provider: ProviderKind) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickWorkspaceAndConversation'));
      return;
    }
    const { workspace, conversation } = context;
    if (conversation.provider === provider) {
      return;
    }
    if (
      pendingV2ConversationCreatesRef.current.has(conversation.id)
      || pendingV2FirstPromptsRef.current.has(conversation.id)
    ) {
      desktopAlert(t('alert.creatingConversation'), t('alert.creatingConversationBody'));
      return;
    }
    if (!canSwitchConversationAgent(conversation, {
      timeline: stores.timeline.get().filter((entry) => entry.conversationId === conversation.id),
      thinking: thinkingConversationsRef.current[conversation.id] === true,
    })) {
      desktopAlert(t('alert.cannotSwitchAgent'), t('alert.cannotSwitchAgentBody'));
      return;
    }
    const descriptor = v2Providers.find((item) => item.id === provider);
    if (!descriptor?.available) {
      desktopAlert(t('alert.agentUnavailable'), descriptor?.unavailableReason || t('alert.agentUnavailableBody'));
      return;
    }
    const backendConnectionId = conversation.backendConnectionId ?? workspace.backendConnectionId ?? null;
    const rememberedSelection = resolveRememberedProviderSelection(backendConnectionId, provider);
    const runModes = rememberedRunModes(
      providerModelPreferencesRef.current[providerModelPreferenceKey(backendConnectionId, provider)],
      descriptor.capabilities.permissionConfig,
    );
    const updatedAt = Date.now();
    const patch: Partial<ConversationRecord> = {
      provider,
      providerProfile: descriptor.profiles[0],
      permissionMode: runModes.permissionMode,
      mode: runModes.mode,
      backendConnectionId,
      model: rememberedSelection.model || undefined,
      reasoningEffort: rememberedSelection.reasoningEffort,
      v2ConversationId: undefined,
      threadId: '',
      nativeStatus: '',
      localAdapterState: 'idle',
      updatedAt,
    };
    setConversations((current) => current.map((item) => (
      item.id === conversation.id ? { ...item, ...patch } : item
    )));
    setConversationSelectedSkills(conversation.id, []);
  }, [getConversationContext, resolveRememberedProviderSelection, setConversationSelectedSkills, v2Providers]);

  const renameConversation = useCallback((conversationId: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      desktopAlert(t('alert.nameRequired'), t('alert.conversationTitleBody'));
      return;
    }
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickThread'));
      return;
    }
    if (refuseReadOnlyWrite(context.conversation)) return;
    const { conversation } = context;
    const previousTitle = conversation.title;
    updateConversation(conversationId, { title: nextTitle });
    const v2ConversationId = conversation.v2ConversationId;
    if (isV2Conversation(conversation) && v2ConversationId) {
      // The backend seals the title into `titleEnc`; the local title stays
      // until the sealed one is readable, so it neither flashes back to the
      // provider name nor reverts on the next list poll.
      const backendId = backendIdForConversation(conversationId);
      void (async () => {
        try {
          const manifest = await v2ApiForConversation(conversationId).updateConversation(v2ConversationId, { title: nextTitle });
          historyEncryptionRef.current?.rememberTitle(backendId, manifest, nextTitle);
          setV2ConversationsByBackend((current) => {
            const manifests = current[backendId];
            if (!manifests) return current;
            return { ...current, [backendId]: manifests.map((item) => (item.id === manifest.id ? manifest : item)) };
          });
          // A list poll that landed mid-request may have restored the old title.
          updateConversation(conversationId, { title: manifest.title || nextTitle });
        } catch (error) {
          updateConversation(conversationId, { title: previousTitle });
          toast.danger(t('sess.renameFailed'), { description: error instanceof Error ? error.message : undefined });
        }
      })();
    }
    // A draft without an agent only has its local title.
  }, [getConversationContext, updateConversation, v2ApiForConversation]);

  /** Forks the conversation; with `throughTurnId`, only its history through
   * that finished turn (the provider's `forkAt`). */
  const forkConversation = useCallback((conversationId: string, throughTurnId?: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickThread'));
      return null;
    }
    const { workspace, conversation } = context;
    if (refuseReadOnlyWrite(conversation)) return null;
    // The backend refuses to fork private conversations.
    if (isPrivateConversation(conversation)) {
      setLastError(t('private.forkRefused'));
      return null;
    }
    if (conversation.v2ConversationId) {
      const provider = providersForConversation(conversation).find((item) => item.id === conversation.provider);
      if (!provider?.capabilities.controlActions?.includes('fork')) {
        setLastError(t('sess.forkUnsupported'));
        return null;
      }
      if (thinkingConversationsRef.current[conversation.id]) {
        setLastError(t('sess.forkBusy'));
        return null;
      }
      void (async () => {
        try {
          const forkTitle = t('sess.forkTitle', { title: conversation.title || t('sess.conversation') });
          const result = await sendProtocolCommand({ id: createRequestId('fork'), type: 'conversation.fork', payload: {
            conversationId: conversation.v2ConversationId, title: forkTitle, ...(throughTurnId ? { throughTurnId } : {}),
          } }, 45_000);
          if (typeof result.conversationId !== 'string') throw new Error(t('sess.forkNoId'));
          // The fork lives on the source conversation's backend; its sealed
          // title is decrypted, else the title this device asked for stays.
          const backendId = backendIdForConversation(conversation.id);
          bumpManifestEpoch(backendId);
          const fetched = await withDecryptedManifest(backendId, await v2ApiForConversation(conversation.id).getConversation(result.conversationId));
          if (!fetched.title) historyEncryptionRef.current?.rememberTitle(backendId, fetched, forkTitle);
          const created = fetched.title ? fetched : { ...fetched, title: forkTitle };
          const record = { ...conversationFromManifest(created, workspace.id), backendConnectionId: conversation.backendConnectionId,
            model: conversation.model, reasoningEffort: conversation.reasoningEffort,
            permissionMode: conversation.permissionMode, mode: conversation.mode };
          setConversations((current) => [record, ...current.filter((item) => item.id !== record.id)]);
          setActiveWorkspaceId(workspace.id);
          setActiveConversationId(record.id);
          await recoverConversation(record.id);
          subscribeV2Conversation(created.id, {
            afterSequence: conversationRecoveryRef.current?.get(created.id)?.appliedSequence ?? 0,
            limit: 500,
          });
        } catch (error) { setLastError(error instanceof Error ? error.message : t('sess.forkFailed')); }
      })();
      return null;
    }
    // Only an agent conversation the backend holds can be forked.
    setLastError(t('sess.forkUnsupported'));
    return null;
  }, [getConversationContext, recoverConversation, sendProtocolCommand, settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, subscribeV2Conversation]);

  const removeConversation = useCallback((conversationId: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      return;
    }
    const { workspace, conversation } = context;
    const nextActive = stores.conversations.get().find(
      (item) => item.workspaceId === workspace.id && item.id !== conversationId && item.archived !== true,
    );
    updateConversation(conversationId, { archived: true, nativeStatus: 'archived' });
    setChatDrafts((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setComposerSelections((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setComposerAttachments((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setSelectedSkills((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setTurnIds((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setThinkingConversations((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    stopTerminalsWhere((terminal) => terminal.conversationId === conversationId);
    setTerminalById((current) => {
      const next = { ...current };
      for (const [terminalId, terminal] of Object.entries(current)) {
        if (terminal.conversationId === conversationId || terminalId === terminalIdForConversation(conversationId)) delete next[terminalId];
      }
      return next;
    });
    if (activeConversationRef.current === conversationId) {
      setActiveConversationId(nextActive?.id ?? '');
    }
    if (conversation.v2ConversationId) {
      unsubscribeV2Conversation(conversation.v2ConversationId);
    }
  }, [getConversationContext, unsubscribeV2Conversation, updateConversation]);

  const promptSkillsFromAttachments = useCallback((skills: SelectedSkillAttachment[]): PromptSkillRef[] => {
    return skills
      .filter((skill) => Boolean(skill.resourceId))
      .map((skill) => ({ resourceId: skill.resourceId as string, name: skill.name }));
  }, []);

  const promptContentFromAttachments = useCallback((attachments: ComposerAttachmentDraft[]): PromptContentRef[] => {
    const content: PromptContentRef[] = [];
    const imageBudget = { used: 0 };
    for (const attachment of attachments) {
      // Uploaded files are named by their path on the backend's machine.
      if (attachment.uploadedPath) {
        content.push(uploadedPromptContent({ path: attachment.uploadedPath, name: attachment.name, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes }, imageBudget));
        continue;
      }
      if (attachment.kind === 'image' && attachment.dataUrl) {
        const comma = attachment.dataUrl.indexOf(',');
        if (comma >= 0) {
          content.push({ type: 'image', data: attachment.dataUrl.slice(comma + 1), mimeType: attachment.mimeType });
        }
        continue;
      }
      if (attachment.kind === 'reference') {
        content.push({ type: 'text', text: attachmentTextBlock(attachment) });
        continue;
      }
      if (typeof attachment.textContent === 'string') {
        content.push({ type: 'text', text: `[附件: ${attachment.name}]\n${attachment.textContent}` });
      }
    }
    return content;
  }, []);

  /** `conversation.prompt` fields shared by direct sends and backend queue
   * items: permissions, work mode, model, skills and content. */
  const v2PromptFields = useCallback((
    conversation: ConversationRecord,
    workspace: WorkspaceRecord,
    permissionMode: string,
    text: string,
    skills: SelectedSkillAttachment[],
    attachments: ComposerAttachmentDraft[],
  ): Record<string, unknown> => {
    const skillRefs = promptSkillsFromAttachments(skills);
    const content = promptContentFromAttachments(attachments);
    const model = conversation.provider === 'codex'
      ? conversation.model || workspace.model || settings.defaultModel || undefined
      : conversation.model || undefined;
    const reasoningEffort = conversation.reasoningEffort || undefined;
    return {
      text,
      permissionMode,
      workMode: conversation.mode === 'plan' ? 'plan' : 'implement',
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(skillRefs.length ? { skills: skillRefs } : {}),
      ...(content.length ? { content } : {}),
    };
  }, [promptContentFromAttachments, promptSkillsFromAttachments, settings.defaultModel]);

  const materializeV2Conversation = useCallback(async (
    conversationId: string,
    firstMessageText: string,
  ): Promise<ConversationRecord | null> => {
    const existing = pendingV2ConversationCreatesRef.current.get(conversationId);
    if (existing) {
      return existing;
    }

    const pending = (async () => {
      const context = getConversationContext(conversationId);
      if (!context) {
        desktopAlert(t('alert.noConversation'), t('alert.pickWorkspaceAndConversation'));
        return null;
      }
      const { workspace, conversation } = context;
      if (conversation.v2ConversationId) {
        return conversation;
      }
      const backendConnectionId = conversation.backendConnectionId
        || workspace.backendConnectionId
        || (isNoneWorkspaceId(workspace.id) ? noWorkspaceBackendIdRef.current || null : null);
      const backendProfile = backendConnectionId ? profileFor(backendConnectionId) : undefined;
      const providers = (backendConnectionId ? v2ProvidersByBackendRef.current[backendConnectionId] : undefined) ?? v2ProvidersRef.current;
      const provider = providers.find(
        (item) => item.id === conversation.provider && item.available,
      );
      if (!provider) {
        const descriptor = providers.find((item) => item.id === conversation.provider);
        desktopAlert(t('alert.agentUnavailable'), descriptor?.unavailableReason || t('alert.agentUnavailableBody'));
        return null;
      }
      const title = conversation.title.trim();
      const isDefaultTitle = isDefaultConversationTitle(title);
      const firstMessageTitle = firstMessageText.trim().slice(0, 18);
      // A private conversation needs a real workspace and an agent that can
      // hold one.
      const ephemeral = isPrivateConversation(conversation);
      if (ephemeral && (isNoneWorkspaceId(workspace.id) || !providerPrivateMode(provider))) {
        desktopAlert(t('alert.createConversationFailed'), t(isNoneWorkspaceId(workspace.id) ? 'private.needsWorkspace' : 'private.agentUnsupported'));
        return null;
      }

      try {
        const api = backendApi(backendProfile ?? settings);
        const requestedTitle = isDefaultTitle ? firstMessageTitle || undefined : title || undefined;
        const created = await api.createConversation({
          provider: provider.id,
          // None: the backend creates this conversation's own folder.
          ...(isNoneWorkspaceId(workspace.id) ? { scratchWorkspace: true } : { workspace: workspace.path }),
          title: requestedTitle,
          providerProfile: conversation.providerProfile && provider.profiles.includes(conversation.providerProfile)
            ? conversation.providerProfile
            : provider.profiles[0],
          ...(ephemeral ? { ephemeral: true } : {}),
        });
        if (backendConnectionId) bumpManifestEpoch(backendConnectionId);
        if (ephemeral && created.ephemeral !== true) {
          // An older daemon ignored `ephemeral` and journaled the conversation
          // on disk: delete it right away so nothing of it survives.
          await api.deleteConversation(created.id).catch((error: unknown) => {
            console.error('Failed to delete the non-private conversation', error);
          });
          throw new Error(t('private.backendUnsupported'));
        }
        if (ephemeral && backendConnectionId) historyTailCache?.exclude(backendConnectionId, created.id);
        const latestConversation = stores.conversations.get().find((item) => item.id === conversationId)
          ?? conversation;
        // The backend seals the title; keep the one asked for (or the local
        // one) instead of the provider name until this device reads it.
        if (backendConnectionId && requestedTitle) historyEncryptionRef.current?.rememberTitle(backendConnectionId, created, requestedTitle);
        const readableTitle = created.title || requestedTitle;
        const record: ConversationRecord = {
          ...latestConversation,
          ...conversationFromManifest(readableTitle ? { ...created, title: readableTitle } : created, workspace.id),
          id: latestConversation.id,
          sessionId: latestConversation.sessionId,
          backendConnectionId,
          model: latestConversation.model,
          reasoningEffort: latestConversation.reasoningEffort,
          permissionMode: latestConversation.permissionMode,
          mode: latestConversation.mode,
        };
        const replaceConversation = (items: ConversationRecord[]) => [
          record,
          ...items.filter((item) => (
            item.id !== conversationId
            && item.id !== created.id
            && item.v2ConversationId !== created.id
          )),
        ];
        setConversations(replaceConversation);
        if (backendConnectionId) {
          setV2ConversationsByBackend((current) => ({
            ...current,
            [backendConnectionId]: [created, ...(current[backendConnectionId] ?? []).filter((item) => item.id !== created.id)],
          }));
        }
        void recoverConversation(record.id);
        subscribeV2Conversation(created.id, { afterSequence: 0, limit: 200 });
        return record;
      } catch (error) {
        const message = error instanceof ConnectionError
          ? `${connectionErrorText(error)}（${error.technicalDetails}）`
          : error instanceof Error ? error.message : t('alert.createConversationFailed');
        setLastError(message);
        desktopAlert(t('alert.createConversationFailed'), message);
        return null;
      }
    })();

    pendingV2ConversationCreatesRef.current.set(conversationId, pending);
    try {
      return await pending;
    } finally {
      if (pendingV2ConversationCreatesRef.current.get(conversationId) === pending) {
        pendingV2ConversationCreatesRef.current.delete(conversationId);
      }
    }
  }, [activeBackendConnectionId, backendConnections, getConversationContext, recoverConversation, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl, subscribeV2Conversation]);

  /** Applies (or dismisses) the editor draft a Pi extension proposed while
   * the composer held the user's own text. */
  const handlePluginDraft = useCallback((conversationId: string, request: ExtensionEditorRequest, replace: boolean) => {
    const current = pendingPluginDrafts[conversationId];
    const runtime = stores.runtime.get()[conversationId];
    if (current?.eventId !== request.eventId || current.eventId !== runtime?.extensionUi.editorRequest?.eventId || current.runtimeId !== runtime?.extensionUi.runtimeId
      || runtime.providerRuntime?.status === 'stopped') return;
    if (replace) setConversationChatDraft(conversationId, current.text);
    setPendingPluginDrafts(items => ({ ...items, [conversationId]: undefined }));
  }, [pendingPluginDrafts, setConversationChatDraft, stores]);

  const stopProviderRuntime = useCallback(async (conversationId: string) => {
    const conversation = stores.conversations.get().find(item => item.id === conversationId);
    if (!conversation?.v2ConversationId) return;
    setStoppingProviderRuntimes(current => ({ ...current, [conversationId]: true }));
    try {
      await sendProtocolCommand({ id: createRequestId('runtime-stop'), type: 'conversation.runtime.stop',
        payload: { conversationId: conversation.v2ConversationId } });
      await recoverConversation(conversationId);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : t('sess.piStopFailed'));
    } finally { setStoppingProviderRuntimes(current => ({ ...current, [conversationId]: false })); }
  }, [sendProtocolCommand, recoverConversation, setLastError]);

  const sendV2Prompt = useCallback(
    async (
      text: string,
      conversationId = activeConversationRef.current,
      skills: SelectedSkillAttachment[] = [],
      rawAttachments: ComposerAttachmentDraft[] = [],
    ): Promise<boolean> => {
      const context = getConversationContext(conversationId);
      if (!context) {
        desktopAlert(t('alert.noConversation'), t('alert.pickWorkspaceAndConversation'));
        return false;
      }
      const { workspace, conversation } = context;
      if (refuseReadOnlyWrite(conversation)) return false;
      // Reference attachments only send while their [引用:name] token is in the text.
      const attachments = liveComposerAttachments(text, rawAttachments);
      if (!isV2Conversation(conversation) || !conversation.provider) {
        desktopAlert(t('alert.notV2'), t('alert.notV2Body'));
        return false;
      }

      const permissionMode = resolvePermissionMode(conversation, workspace);
      if (!permissionMode) {
        setLastError(t('sess.permissionSelectRequired'));
        return false;
      }
      const permissionConfig = conversationPermissionCapabilities(conversation, providersForConversation(conversation));
      if (conversation.mode === 'plan' && !permissionConfig?.supportsPlan) {
        setLastError(t('sess.planModeUnsupported'));
        return false;
      }

      if (pendingV2SubmissionsRef.current.has(conversation.id)) {
        setLastError(t('sess.previousPending'));
        return false;
      }
      const isFirstPrompt = !conversation.v2ConversationId;
      if (isFirstPrompt && pendingV2FirstPromptsRef.current.has(conversation.id)) {
        return false;
      }
      const restoreSubmission = () => {
        setConversationChatDraft(conversation.id, (current) => current || text);
        if (skills.length > 0) {
          setConversationSelectedSkills(conversation.id, (current) => current.length > 0 ? current : skills);
        }
        if (attachments.length > 0) {
          setConversationAttachments(conversation.id, (current) => current.length > 0 ? current : attachments);
        }
      };
      // Inside a provider rate-limit window every send route lands here, so a
      // single gate holds it until the reset passes. The daemon reports its
      // wait in the queue snapshot and takes the prompt into its queue, behind
      // the continuation it starts at `resumeAt`.
      const backendQueued = hasBackendQueue(providersForConversation(conversation), conversation);
      const backendWait = backendQueued && conversation.v2ConversationId
        ? backendRateLimitState(conversationRecoveryRef.current?.get(conversation.v2ConversationId)?.followUps) : null;
      // A scheduled conversation's backend holds everything sent to it until
      // its time, behind the same queue.
      const schedule = backendQueued ? activeConversationSchedule(conversation) : undefined;
      if (schedule) {
        const queued = await queueV2FollowUpRef.current(conversation.id,
          { id: createRequestId('queued'), text, attachments, skills });
        if (!queued) {
          restoreSubmission();
          return false;
        }
        return true;
      }
      if (backendWait?.waiting) {
        const queued = await queueV2FollowUpRef.current(conversation.id,
          { id: createRequestId('queued'), text, attachments, skills });
        if (!queued) {
          restoreSubmission();
          return false;
        }
        appendTimeline(makeSystemEntry(t('sess.sessionLimitQueued'), t('sess.sessionLimitQueuedHint', {
          reset: Number.isFinite(backendWait.resumeAt) ? formatResetInstant(backendWait.resumeAt) : '—' }), workspace.id, conversation.id));
        return true;
      }
      const promptBackendId = backendIdForConversation(conversation.id);
      const promptLink = linksRef.current.get(promptBackendId);
      if (!promptLink?.socket?.ready || !promptLink.verified) {
        if (autoConnectEnabled && !promptLink?.manualDisconnect) {
          setLastError(t('sess.reconnecting'));
          connectBackend(promptBackendId);
        } else {
          setLastError(t('sess.connectBackendFirst'));
        }
        restoreSubmission();
        return false;
      }
      const requestId = createRequestId('prompt');
      const submission = { text, skills, attachments, requestId, phase: 'sending' as 'sending' | 'running' | 'unknown', turnId: undefined as string | undefined };
      pendingV2SubmissionsRef.current.set(conversation.id, submission);
      setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: 'sending' }));

      if (isFirstPrompt) {
        pendingV2FirstPromptsRef.current.add(conversation.id);
      }
      setConversationThinking(conversation.id, true);
      try {
        const readyConversation = conversation.v2ConversationId
          ? conversation
          : await materializeV2Conversation(
            conversation.id,
            text || attachmentPrompt(attachments) || selectedSkillSummary(skills),
          );
        const v2Id = readyConversation?.v2ConversationId;
        if (!readyConversation || !v2Id) {
          setConversationThinking(conversation.id, false);
          pendingV2SubmissionsRef.current.delete(conversation.id);
          setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: undefined }));
          restoreSubmission();
          return false;
        }

        if (attachments.length) {
          const previews = await prepareSentAttachments(attachments);
          updateSentAttachmentRecords([
            ...sentAttachmentRecordsRef.current.filter((record) => record.requestId !== requestId || record.conversationId !== conversation.id),
            { conversationId: conversation.id, requestId, text, attachments: previews },
          ]);
        }
        const result = await sendProtocolCommand({
          id: requestId,
          type: 'conversation.prompt',
          payload: {
            conversationId: v2Id,
            clientRequestId: requestId,
            ...v2PromptFields(readyConversation, workspace, permissionMode, text, skills, attachments),
          },
        });
        updateConversation(readyConversation.id, { permissionMode, mode: readyConversation.mode === 'plan' ? 'plan' : 'implement' });
        if (typeof result.turnId === 'string') submission.turnId = result.turnId;
        const terminal = submission.turnId ? settledV2TurnsRef.current.get(`${v2Id}:${submission.turnId}`) : undefined;
        if (terminal) {
          pendingV2SubmissionsRef.current.delete(conversation.id);
          setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: undefined }));
          if (terminal === 'turn.failed' && backendQueued) {
            // The turn failed before its ACK: the daemon's queue snapshot
            // tells whether it continues the prompt (then the composer clears).
            return awaitBackendContinuation(conversation.id, submission.turnId!, submission, '');
          }
          if (terminal === 'turn.failed') {
            restoreSubmission();
            return false;
          }
        } else if (pendingV2SubmissionsRef.current.get(conversation.id) === submission) {
          submission.phase = 'running';
          setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: 'running' }));
        }
        if (!isFirstPrompt && isDefaultConversationTitle(conversation.title) && text.trim()) {
          updateConversation(conversation.id, { title: text.slice(0, 18), updatedAt: Date.now() });
        }
        return true;
      } catch (error) {
        if (error instanceof ProtocolCommandError && error.state === 'unknown') {
          if (submission.phase === 'running') {
            const v2Id = stores.conversations.get().find((item) => item.id === conversation.id)?.v2ConversationId;
            const terminal = submission.turnId ? settledV2TurnsRef.current.get(`${v2Id}:${submission.turnId}`) : undefined;
            return terminal !== 'turn.failed';
          }
          submission.phase = 'unknown';
          setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: 'unknown' }));
          setLastError(error.message);
          setConversationThinking(conversation.id, false);
          await reconcilePendingSubmission(conversation.id);
          const latest = pendingV2SubmissionsRef.current.get(conversation.id);
          const v2Id = stores.conversations.get().find((item) => item.id === conversation.id)?.v2ConversationId;
          const terminal = v2Id && submission.turnId ? settledV2TurnsRef.current.get(`${v2Id}:${submission.turnId}`) : undefined;
          if (terminal) {
            if (terminal === 'turn.failed' && backendQueued) {
              return awaitBackendContinuation(conversation.id, submission.turnId!, submission, '');
            }
            return terminal !== 'turn.failed';
          }
          return latest?.phase === 'running';
        }
        // The backend was busy after all (a turn started below the loaded
        // window, or on another device): hand the prompt to its queue under
        // the same id instead of reporting the conflict.
        if (error instanceof ProtocolCommandError && error.code === 'CONFLICT' && !isFirstPrompt
          && hasBackendQueue(providersForConversation(conversation), conversation)) {
          pendingV2SubmissionsRef.current.delete(conversation.id);
          setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: undefined }));
          const queued = await queueV2FollowUpRef.current(conversation.id, { id: requestId, text, attachments, skills });
          if (queued) return true;
          restoreSubmission();
          return false;
        }
        updateSentAttachmentRecords(sentAttachmentRecordsRef.current.filter((record) =>
          record.conversationId !== conversation.id || record.requestId !== requestId || Boolean(record.eventId)));
        setConversationThinking(conversation.id, false);
        const message = error instanceof ConnectionError
          ? connectionErrorText(error)
          : error instanceof Error ? error.message : t('sess.sendFailedShort');
        setLastError(message);
        pendingV2SubmissionsRef.current.delete(conversation.id);
        setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: undefined }));
        restoreSubmission();
        return false;
      } finally {
        if (isFirstPrompt) {
          pendingV2FirstPromptsRef.current.delete(conversation.id);
          // Messages queued while the conversation was being created.
          void flushHeldFollowUpsRef.current(conversation.id);
        }
      }
    },
    [updateSentAttachmentRecords, appendTimeline, awaitBackendContinuation, getConversationContext, materializeV2Conversation, reconcilePendingSubmission, v2PromptFields, sendProtocolCommand, setConversationAttachments, setConversationChatDraft, setConversationSelectedSkills, setConversationThinking, updateConversation, autoConnectEnabled, connectBackend],
  );

  /** Adds one message to the backend queue (`conversation.queue.add`) and
   * reports nothing itself. The item id doubles as the prompt's
   * clientRequestId, so re-adding after a lost ACK or a reload is idempotent.
   * `paused` enqueues it paused by the user (needs `backendQueueControl`). */
  const addFollowUp = useCallback(async (
    conversationId: string,
    item: QueuedChatSubmission,
    paused = false,
  ): Promise<{ status: 'queued' | 'started' } | { error: unknown }> => {
    const context = getConversationContext(conversationId);
    const v2Id = context?.conversation.v2ConversationId;
    if (!context || !v2Id) return { error: new Error(t('sess.sendFailedShort')) };
    const { workspace, conversation } = context;
    const permissionMode = resolvePermissionMode(conversation, workspace);
    if (!permissionMode) return { error: new Error(t('sess.permissionSelectRequired')) };
    const attachments = liveComposerAttachments(item.text, item.attachments);
    let fields: Record<string, unknown>;
    try {
      fields = v2PromptFields(conversation, workspace, permissionMode, item.text, item.skills, attachments);
    } catch (error) {
      return { error };
    }
    if (attachments.length && !sentAttachmentRecordsRef.current.some((record) =>
      record.conversationId === conversation.id && record.requestId === item.id)) {
      const previews = await prepareSentAttachments(attachments);
      updateSentAttachmentRecords([...sentAttachmentRecordsRef.current,
        { conversationId: conversation.id, requestId: item.id, text: item.text, attachments: previews }]);
    }
    try {
      const frame = followUpQueueFrame('add', v2Id, { ...fields, itemId: item.id, ...(paused ? { paused: true } : {}) });
      const result = await sendProtocolCommand({ id: createRequestId('queue-add'), ...frame });
      const started = result.status === 'started';
      if (started) setConversationThinking(conversation.id, true);
      return { status: started ? 'started' : 'queued' };
    } catch (error) {
      if (!(error instanceof ProtocolCommandError && error.state === 'unknown')) {
        updateSentAttachmentRecords(sentAttachmentRecordsRef.current.filter((record) =>
          record.conversationId !== conversation.id || record.requestId !== item.id || Boolean(record.eventId)));
      }
      return { error };
    }
  }, [getConversationContext, sendProtocolCommand, setConversationThinking, updateSentAttachmentRecords, v2PromptFields]);

  /** Hands a follow-up to the backend queue. Resolves 'started' when the
   * conversation was idle and the backend began it at once, false when it
   * was not accepted (the reason is reported). */
  const queueV2FollowUp = useCallback(async (
    conversationId: string,
    item: QueuedChatSubmission,
  ): Promise<'queued' | 'started' | false> => {
    const conversation = getConversationContext(conversationId)?.conversation;
    if (!conversation?.v2ConversationId) return false;
    if (refuseReadOnlyWrite(conversation)) return false;
    const result = await addFollowUp(conversationId, item);
    if ('error' in result) {
      setLastError(result.error instanceof Error ? result.error.message : t('sess.sendFailedShort'));
      return false;
    }
    return result.status;
  }, [addFollowUp, getConversationContext, setLastError]);

  useEffect(() => {
    queueV2FollowUpRef.current = queueV2FollowUp;
  }, [queueV2FollowUp]);

  /** Returns a message that never reached the backend queue to the composer,
   * in front of anything typed since. */
  const restoreQueuedMessage = useCallback((conversationId: string, item: QueuedChatSubmission) => {
    setConversationChatDraft(conversationId, (current) =>
      [item.text, current].filter((part) => part.trim()).join('\n\n'));
    setConversationAttachments(conversationId, (current) => [
      ...item.attachments.filter((attachment) => !current.some((other) => other.id === attachment.id)), ...current]);
    const skillKey = (skill: SelectedSkillAttachment) => skill.resourceId || `${skill.name}:${skill.path}`;
    setConversationSelectedSkills(conversationId, (current) => [
      ...item.skills.filter((skill) => !current.some((other) => skillKey(other) === skillKey(skill))), ...current]);
  }, [setConversationAttachments, setConversationChatDraft, setConversationSelectedSkills]);

  /** Submits the messages held while the conversation had no backend id (see
   * `queueWhileBusy`) once its first prompt settled. A refused one and the
   * rest go back to the composer, with the reason reported. */
  const flushHeldFollowUps = useCallback(async (conversationId: string) => {
    const held = heldFollowUpsRef.current.get(conversationId);
    if (!held?.length) return;
    heldFollowUpsRef.current.delete(conversationId);
    for (const [index, item] of held.entries()) {
      if (await queueV2FollowUp(conversationId, item)) continue;
      for (const rest of held.slice(index).reverse()) restoreQueuedMessage(conversationId, rest);
      setLastError(t('sess.queueHeldRestored'));
      return;
    }
  }, [queueV2FollowUp, restoreQueuedMessage, setLastError]);

  useEffect(() => {
    flushHeldFollowUpsRef.current = flushHeldFollowUps;
  }, [flushHeldFollowUps]);

  /** Queues a message sent while the agent is busy. Only the backend holds
   * the queue: 'queued' means it accepted the message; 'held' means the
   * conversation has no backend id yet (its first prompt is creating it), so
   * the message waits in memory and is submitted afterwards; false means it
   * was refused, with the reason reported — the caller keeps the message. */
  const queueWhileBusy = useCallback(async (conversationId: string, item: QueuedChatSubmission): Promise<'queued' | 'held' | false> => {
    const conversation = getConversationContext(conversationId)?.conversation;
    if (!conversation) return false;
    if (!isV2Conversation(conversation)) {
      setLastError(t('sess.queueUnsupported'));
      return false;
    }
    const providers = providersForConversation(conversation);
    if (!providers.some((provider) => provider.id === conversation.provider)) {
      setLastError(t('sess.connectBackendFirst'));
      return false;
    }
    if (!providerHasBackendQueue(providers, conversation.provider)) {
      setLastError(t('sess.queueNeedsUpgrade'));
      return false;
    }
    if (!conversation.v2ConversationId) {
      if (!pendingV2FirstPromptsRef.current.has(conversation.id)) {
        setLastError(t('sess.sendFailedShort'));
        return false;
      }
      heldFollowUpsRef.current.set(conversation.id, [...(heldFollowUpsRef.current.get(conversation.id) ?? []), item]);
      return 'held';
    }
    return await queueV2FollowUp(conversationId, item) ? 'queued' : false;
  }, [getConversationContext, queueV2FollowUp, setLastError]);

  /** Reads the backend queue into the runtime: the loaded window may not
   * hold its latest `followups.updated`. */
  const refreshFollowUpQueue = useCallback(async (conversationId: string) => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId);
    const v2Id = conversation?.v2ConversationId;
    if (!conversation || !v2Id || !hasBackendQueue(providersForConversation(conversation), conversation)) return;
    try {
      const result = await sendProtocolCommand({ id: createRequestId('queue-list'), ...followUpQueueFrame('list', v2Id) });
      conversationRecoveryRef.current?.adoptFollowUpQueue(v2Id, parseFollowUpQueue(result.queue));
    } catch (error) {
      setLastError(error instanceof Error ? error.message : t('sess.requestFailed', { method: 'conversation.queue.list' }));
    }
  }, [sendProtocolCommand, setLastError]);

  /** Removes one item, clears, resumes, or (`backendQueueControl`) pauses the backend queue. */
  const editFollowUpQueue = useCallback(async (conversationId: string, operation: 'remove' | 'clear' | 'resume' | 'pause', itemId?: string) => {
    const v2Id = stores.conversations.get().find((item) => item.id === conversationId)?.v2ConversationId;
    if (!v2Id) return false;
    try {
      const result = await sendProtocolCommand({ id: createRequestId(`queue-${operation}`),
        ...followUpQueueFrame(operation, v2Id, itemId ? { itemId } : {}) });
      conversationRecoveryRef.current?.adoptFollowUpQueue(v2Id, parseFollowUpQueue(result.queue));
      return true;
    } catch (error) {
      setLastError(error instanceof Error ? error.message : t('sess.requestFailed', { method: `conversation.queue.${operation}` }));
      return false;
    }
  }, [sendProtocolCommand, setLastError]);

  /** Holds the conversation's backend queue until `at` (ISO instant), or
   * cancels its schedule with null. */
  const scheduleConversation = useCallback(async (conversationId: string, at: string | null) => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId);
    const v2Id = conversation?.v2ConversationId;
    if (!conversation || !v2Id) return false;
    if (isPrivateConversation(conversation)) {
      setLastError(t('private.scheduleRefused'));
      return false;
    }
    try {
      const result = await sendProtocolCommand({ id: createRequestId('schedule'), ...conversationScheduleFrame(v2Id, at) });
      if (result.queue !== undefined) conversationRecoveryRef.current?.adoptFollowUpQueue(v2Id, parseFollowUpQueue(result.queue));
      const schedule = parseConversationSchedule(result.schedule);
      const apply = (items: ConversationRecord[]) => items.map((item) => item.id === conversationId ? { ...item, schedule } : item);
      setConversations(apply);
      return true;
    } catch (error) {
      setLastError(error instanceof Error ? error.message : t('sess.requestFailed', { method: 'conversation.schedule' }));
      return false;
    }
  }, [sendProtocolCommand, setLastError]);

  /** Sends a scheduled conversation's held messages now: resuming its queue
   * ends the schedule on the backend. */
  const sendScheduledNow = useCallback(async (conversationId: string) => {
    if (!await editFollowUpQueue(conversationId, 'resume')) return false;
    const apply = (items: ConversationRecord[]) => items.map((item) => item.id === conversationId ? { ...item, schedule: undefined } : item);
    setConversations(apply);
    return true;
  }, [editFollowUpQueue]);

  /** Creates a conversation on the backend right away and schedules it: what
   * is sent to it waits there until `at`. Resolves the opened record, or
   * null with the reason reported. */
  const createScheduledConversation = useCallback(async (
    workspaceId: string,
    at: string,
    options?: { title?: string; provider?: ProviderKind },
  ): Promise<ConversationRecord | null> => {
    const created = createConversation(workspaceId, {
      fresh: true,
      ...(options?.title ? { title: options.title } : {}),
      ...(options?.provider ? { provider: options.provider } : {}),
    });
    if (!created) return null;
    if (!providerSupportsScheduledConversations(providersForConversation(created), created.provider)) {
      setLastError(t('sess.scheduleNeedsUpgrade'));
      return null;
    }
    const record = await materializeV2Conversation(created.id, options?.title ?? '');
    if (!record?.v2ConversationId) return null;
    if (!await scheduleConversation(record.id, at)) return null;
    return stores.conversations.get().find((item) => item.id === record.id) ?? record;
  }, [createConversation, materializeV2Conversation, scheduleConversation, setLastError]);

  /** Creates a private (RAM-only) conversation on the workspace's backend
   * right away, so its id exists before attachments upload into its private
   * folder. The placeholder never persists and is dropped when the backend
   * refuses or cannot keep the conversation private. */
  const createPrivateConversation = useCallback(async (
    workspaceId: string,
    options?: { provider?: ProviderKind },
  ): Promise<ConversationRecord | null> => {
    if (isNoneWorkspaceId(workspaceId)) {
      setLastError(t('private.needsWorkspace'));
      return null;
    }
    const created = createConversation(workspaceId, {
      fresh: true,
      ephemeral: true,
      ...(options?.provider ? { provider: options.provider } : {}),
    });
    if (!created) return null;
    const record = await materializeV2Conversation(created.id, '');
    if (record?.v2ConversationId && isPrivateConversation(record)) return record;
    setConversations((current) => current.filter((item) => item.id !== created.id));
    if (activeConversationRef.current === created.id) {
      const fallback = stores.conversations.get().find((item) => item.workspaceId === workspaceId && item.archived !== true && item.id !== created.id);
      setActiveConversationId(fallback?.id ?? '');
    }
    pruneConversationState([created.id], { drafts: true });
    return null;
  }, [createConversation, materializeV2Conversation, pruneConversationState, setLastError]);

  /** Agents of the workspace's backend for a private conversation: every
   * available one, those that cannot hold one marked unsupported, and the
   * default pick among the supported. */
  const privateConversationAgents = useCallback((workspaceId: string): { providers: Array<ProviderDescriptor & { privateMode: 'native' | 'scrubbed' | null }>; defaultProvider?: ProviderKind } => {
    const workspace = stores.workspaces.get().find((item) => item.id === workspaceId);
    const backendConnectionId = workspace?.backendConnectionId ?? null;
    const providers = (backendConnectionId ? v2ProvidersByBackendRef.current[backendConnectionId] : undefined) ?? v2ProvidersRef.current;
    const listed = providers.filter((item) => item.available).map((item) => ({ ...item, privateMode: providerPrivateMode(item) }));
    const agent = resolveCreateConversationAgent({
      providers,
      conversations: stores.conversations.get(),
      activeConversationId: activeConversationRef.current,
      workspaceId,
    });
    const eligible = listed.filter((item) => item.privateMode);
    const defaultProvider = eligible.some((item) => item.id === agent?.provider) ? agent?.provider : eligible[0]?.id;
    return { providers: listed, defaultProvider };
  }, []);

  /** Agents a scheduled conversation in the workspace can run on (available
   * and able to hold its queue until a set time), and the one a new
   * conversation there would start with when it is among them. */
  const scheduledConversationAgents = useCallback((workspaceId: string): { providers: ProviderDescriptor[]; defaultProvider?: ProviderKind } => {
    const workspace = stores.workspaces.get().find((item) => item.id === workspaceId);
    const backendConnectionId = workspace?.backendConnectionId
      ?? (workspace && isNoneWorkspaceId(workspace.id) ? noWorkspaceBackendIdRef.current || null : null);
    const providers = (backendConnectionId ? v2ProvidersByBackendRef.current[backendConnectionId] : undefined) ?? v2ProvidersRef.current;
    const eligible = providers.filter((item) => item.available && providerSupportsScheduledConversations(providers, item.id));
    const agent = resolveCreateConversationAgent({
      providers,
      conversations: stores.conversations.get(),
      activeConversationId: activeConversationRef.current,
      workspaceId,
    });
    const defaultProvider = eligible.some((item) => item.id === agent?.provider) ? agent?.provider : eligible[0]?.id;
    return { providers: eligible, defaultProvider };
  }, []);

  useEffect(() => {
    refreshFollowUpQueueRef.current = refreshFollowUpQueue;
    editFollowUpQueueRef.current = editFollowUpQueue;
  }, [editFollowUpQueue, refreshFollowUpQueue]);

  // One-time migration of the candidates older builds persisted: each moves
  // to its conversation's backend queue under its original id, then the local
  // copy goes. Anything undecidable (another backend, providers not loaded, an
  // old backend) stays stored and is retried on the next connection.
  const migratingFollowUpsRef = useRef(false);
  useEffect(() => {
    const legacy = legacyFollowUpsRef.current;
    if (!legacy || !legacyFollowUpsLoaded || !hydrated || connectionState !== 'open' || v2Providers.length === 0
      || migratingFollowUpsRef.current) return;
    migratingFollowUpsRef.current = true;
    const forget = (conversationId: string) => {
      const current = legacyFollowUpsRef.current;
      if (!current) return;
      const { [conversationId]: _removed, ...queues } = current.queues;
      const paused = current.paused.filter((id) => id !== conversationId);
      legacyFollowUpsRef.current = Object.keys(queues).length > 0 ? { queues, paused } : null;
      const stored = legacyFollowUpsRef.current && { version: 2, queues, paused };
      void saveJson(LEGACY_QUEUED_FOLLOW_UPS_KEY, stored ?? undefined).catch((error) =>
        setLastError(error instanceof Error ? error.message : t('sess.queueMigrationFailed')));
    };
    void migrateLegacyFollowUps(legacy, {
      resolve: (conversationId): LegacyQueueTarget => {
        const conversation = stores.conversations.get().find((item) => item.id === conversationId);
        if (!conversation || isReadOnlyConversation(conversation)) return { kind: 'gone' };
        // Each backend's queue is migrated once that backend is connected.
        if (!conversation.v2ConversationId || linkStatusRef.current[backendIdForConversation(conversation.id)]?.state !== 'open'
          || !providerHasBackendQueue(providersForConversation(conversation), conversation.provider)) return { kind: 'wait' };
        return { kind: 'ready', control: providerHasBackendQueueControl(providersForConversation(conversation), conversation.provider) };
      },
      add: async (conversationId, item, paused): Promise<LegacyAddResult> => {
        const result = await addFollowUp(conversationId, item, paused);
        if (!('error' in result)) return 'added';
        return result.error instanceof ProtocolCommandError && result.error.code === HISTORY_READ_ONLY ? 'gone' : 'failed';
      },
      settle: (conversationId, discarded) => {
        forget(conversationId);
        if (discarded.length === 0) return;
        const conversation = stores.conversations.get().find((item) => item.id === conversationId);
        const listing = discarded.map((item) => (item.text.trim() || attachmentPrompt(item.attachments)
          || selectedSkillSummary(item.skills)).slice(0, 200)).join('\n');
        const body = t('sess.queueDiscardedHint', { count: discarded.length, text: listing });
        if (conversation) {
          appendTimeline(makeSystemEntry(t('sess.queueDiscarded'), body, conversation.workspaceId, conversation.id));
        } else {
          setLastError(`${t('sess.queueDiscarded')}\n${body}`);
        }
      },
    }).catch((error) => {
      setLastError(error instanceof Error ? error.message : t('sess.queueMigrationFailed'));
    }).finally(() => { migratingFollowUpsRef.current = false; });
  }, [addFollowUp, appendTimeline, connectionState, hydrated, legacyFollowUpsLoaded, setLastError, v2Providers]);


  // Action menus send a separate message without replacing the composer's draft.
  const sendAgentMessage = useCallback(async (text: string, conversationId: string): Promise<'sent' | 'queued' | false> => {
    const context = getConversationContext(conversationId);
    if (!context || !text.trim()) return false;
    const pending = pendingV2SubmissionsRef.current.get(conversationId);
    if (pending?.phase === 'unknown') {
      setLastError(t('sess.checkSendState'));
      return false;
    }
    if (thinkingConversationsRef.current[conversationId] || pending) {
      return await queueWhileBusy(conversationId, { id: createRequestId('queued'), text, attachments: [], skills: [] })
        ? 'queued' : false;
    }
    if (!ensureConversationAgent(conversationId)) return false;
    return await sendV2Prompt(text, conversationId) ? 'sent' : false;
  }, [ensureConversationAgent, getConversationContext, queueWhileBusy, sendV2Prompt]);


  const toggleCatalogSkill = useCallback((conversationId: string, skill: SkillCatalogDescriptor, provider: ProviderKind) => {
    if (!skill.valid) {
      desktopAlert(t('alert.skillInvalid'), skill.error || t('alert.skillInvalidBody'));
      return;
    }
    const nextSkill: SelectedSkillAttachment = {
      name: skill.name,
      path: skill.source,
      displayName: skill.name,
      resourceId: skill.resourceId,
      provider,
    };
    setConversationSelectedSkills(conversationId, (current) => {
      const exists = current.some((item) => item.resourceId === skill.resourceId || (item.name === skill.name && item.path === skill.source));
      if (exists) {
        return current.filter((item) => item.resourceId !== skill.resourceId && (item.name !== skill.name || item.path !== skill.source));
      }
      return [...current, nextSkill];
    });
  }, [setConversationSelectedSkills]);

  const previewSkillResource = useCallback(async (provider: ProviderKind, resourceId: string) => {
    const workspacePath = activeWorkspace?.path || settings.defaultWorkspacePath;
    if (!workspacePath) {
      throw new Error(t('sess.pickWorkspaceFirst'));
    }
    const api = backendApi(settings);
    const result = await api.getSkillResource(provider, workspacePath, resourceId);
    return result.content;
  }, [activeWorkspace?.path, settings.deviceSecret, settings.defaultWorkspacePath, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl]);

  const getMcpServerConfig = useCallback(async (provider: ProviderKind, resourceId: string) => {
    const workspacePath = activeWorkspace?.path || settings.defaultWorkspacePath;
    if (!workspacePath) {
      throw new Error(t('sess.pickWorkspaceFirst'));
    }
    return backendApi(settings).getMcpServerConfig(provider, workspacePath, resourceId);
  }, [activeWorkspace?.path, settings.deviceSecret, settings.defaultWorkspacePath, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl]);

  // Shared skill folders and files such as `.mcp.json` are read by several
  // providers, so a write reloads every catalog already on screen.
  const mutateCapabilityCatalog = useCallback(async <T,>(
    provider: ProviderKind,
    write: (api: ReturnType<typeof backendApi>, workspacePath: string) => Promise<T>,
  ): Promise<T> => {
    const workspacePath = activeWorkspace?.path || settings.defaultWorkspacePath;
    if (!workspacePath) {
      throw new Error(t('sess.pickWorkspaceFirst'));
    }
    const result = await write(backendApi(settings), workspacePath);
    const loaded = (Object.keys(capabilityCatalogs) as ProviderKind[]).filter((kind) => capabilityCatalogs[kind]);
    await Promise.all([...new Set([provider, ...loaded])].map((kind) => refreshCapabilityCatalog(kind)));
    return result;
  }, [activeWorkspace?.path, capabilityCatalogs, refreshCapabilityCatalog, settings.deviceSecret, settings.defaultWorkspacePath, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl]);

  /** Per-conversation disk usage on the active backend, titles decrypted. */
  /** History storage of a backend (the focused one by default). */
  const getHistoryStorage = useCallback(async (backendId = activeBackendConnectionIdRef.current) => {
    const response = await backendApi(settingsForBackend(backendId)).getHistoryStorage();
    return { ...response, conversations: withDecryptedTitles(backendId, response.conversations) as typeof response.conversations };
  }, [settingsForBackend]);

  /** Drops local records of conversations a backend (the focused one by
   * default) already deleted. */
  const forgetDeletedConversations = useCallback((v2ConversationIds: string[], backendId = activeBackendConnectionIdRef.current) => {
    const deleted = new Set(v2ConversationIds);
    if (deleted.size === 0) return;
    for (const id of deleted) {
      unsubscribeV2Conversation(id);
      void historyTailCache?.forgetConversation(backendId, id);
    }
    const removed = stores.conversations.get().filter((item) => (
      item.v2ConversationId && deleted.has(item.v2ConversationId) && backendIdForConversation(item.id) === backendId
    ));
    const removedIds = new Set(removed.map((item) => item.id));
    if (removedIds.has(activeConversationRef.current)) {
      const active = removed.find((item) => item.id === activeConversationRef.current);
      const nextActive = stores.conversations.get().find(
        (item) => item.workspaceId === active?.workspaceId && !removedIds.has(item.id) && item.archived !== true,
      );
      setActiveConversationId(nextActive?.id ?? '');
    }
    setConversations((current) => current.filter((item) => !removedIds.has(item.id)));
    pruneConversationState([...removedIds], { drafts: true });
  }, [pruneConversationState, unsubscribeV2Conversation]);

  // A private conversation its backend no longer lists died with a daemon
  // restart: everything this client held of it goes (record, subscription,
  // runtime, receipts, usage, notifications), and the user is told once.
  forgetVanishedPrivateRef.current = (backendId, manifests) => {
    const gone = vanishedPrivateConversations(stores.conversations.get(), manifests, stores.workspaces.get(), backendId)
      .filter((item) => backendIdForConversation(item.id) === backendId);
    if (!gone.length) return;
    const ids = privateConversationIds(gone);
    const localIds = gone.map((item) => item.id);
    conversationEventBatcherRef.current?.flush();
    for (const item of gone) conversationRecoveryRef.current?.release(item.v2ConversationId!);
    forgetDeletedConversations(gone.map((item) => item.v2ConversationId!), backendId);
    const without = <T,>(current: Record<string, T>) => {
      if (!localIds.some((id) => id in current)) return current;
      const next = { ...current };
      for (const id of localIds) delete next[id];
      return next;
    };
    for (const id of localIds) projectedRuntimeListsRef.current.delete(id);
    setConversationRuntimeById(without);
    setRecoveringConversations(without);
    setOpenStatusByConversation(without);
    setEarlierHistory(without);
    setTurnIds(without);
    setThinkingConversations(without);
    setTimeline((current) => current.some((entry) => entry.conversationId && ids.has(entry.conversationId))
      ? current.filter((entry) => !entry.conversationId || !ids.has(entry.conversationId)) : current);
    updateSentAttachmentRecords(withoutPrivateEntries(sentAttachmentRecordsRef.current, ids));
    setUsageRecords((current) => withoutPrivateEntries(current, ids));
    recentConversationIdsRef.current = recentConversationIdsRef.current.filter((id) => !ids.has(id));
    forgetConversationNotifications(ids);
    toast.info(t('private.cleared'));
  };

  /** Deletes backend conversations for good (unlike removeConversation,
   * which archives) and drops their local records right away. */
  const purgeConversations = useCallback(async (v2ConversationIds: string[], backendId = activeBackendConnectionIdRef.current) => {
    const result = await backendApi(settingsForBackend(backendId)).cleanupConversations(v2ConversationIds);
    forgetDeletedConversations(result.deleted, backendId);
    return result;
  }, [forgetDeletedConversations, settingsForBackend]);

  /** The sidebar's "delete": a backend conversation is deleted for good with
   * its Agent Calling children; retired local Codex history (only on this
   * device) is deleted here; a draft not created yet is archived. Resolves
   * a skip (e.g. `CONFLICT` while it runs) instead of throwing for it. */
  const deleteConversation = useCallback(async (conversationId: string): Promise<
    { status: 'deleted' | 'archived' } | { status: 'skipped'; code: string; message: string }
  > => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId);
    const v2ConversationId = conversation?.v2ConversationId;
    if (conversation?.legacyCodex) {
      removeConversation(conversationId);
      setConversations((current) => current.filter((item) => item.id !== conversationId));
      setTimeline((current) => current.filter((entry) => entry.conversationId !== conversationId));
      pruneConversationState([conversationId], { drafts: true });
      return { status: 'deleted' };
    }
    if (!conversation || !isV2Conversation(conversation) || !v2ConversationId) {
      removeConversation(conversationId);
      return { status: 'archived' };
    }
    const backendId = backendIdForConversation(conversationId);
    const result = await purgeConversations([v2ConversationId], backendId);
    bumpManifestEpoch(backendId);
    const skip = result.skipped.find((item) => item.conversationId === v2ConversationId) ?? result.skipped[0];
    if (!result.deleted.includes(v2ConversationId)) {
      return { status: 'skipped', code: skip?.code ?? '', message: skip?.message ?? '' };
    }
    const children = stores.conversations.get()
      .filter((item) => item.parentConversationId === v2ConversationId && item.v2ConversationId)
      .map((item) => item.v2ConversationId as string);
    forgetDeletedConversations(children, backendId);
    return { status: 'deleted' };
  }, [forgetDeletedConversations, purgeConversations, removeConversation]);

  const capabilityManager = useMemo<CapabilityManager>(() => ({
    createSkill: (provider, input) => mutateCapabilityCatalog(provider, (api, workspace) => api.createSkill(provider, workspace, input)),
    updateSkill: (provider, resourceId, content) => mutateCapabilityCatalog(provider, (api, workspace) => api.updateSkill(provider, workspace, resourceId, content)),
    deleteSkill: (provider, resourceId) => mutateCapabilityCatalog(provider, (api, workspace) => api.deleteSkill(provider, workspace, resourceId)).then(() => undefined),
    createMcpServer: (provider, input) => mutateCapabilityCatalog(provider, (api, workspace) => api.createMcpServer(provider, workspace, input)),
    updateMcpServer: (provider, resourceId, input) => mutateCapabilityCatalog(provider, (api, workspace) => api.updateMcpServer(provider, workspace, resourceId, input)),
    deleteMcpServer: (provider, resourceId) => mutateCapabilityCatalog(provider, (api, workspace) => api.deleteMcpServer(provider, workspace, resourceId)).then(() => undefined),
  }), [mutateCapabilityCatalog]);

  const refreshMcpServer = useCallback((conversationId: string, resourceId: string) => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId) ?? null;
    const v2Id = conversation?.v2ConversationId;
    if (!conversation || !isV2Conversation(conversation) || !v2Id) {
      desktopAlert(t('alert.needCreatedConversation'), t('alert.needMessageRefreshMcp'));
      return false;
    }
    return Boolean(sendRawProtocolFrame({
      id: createRequestId('mcp'),
      type: 'mcp.refresh',
      payload: { conversationId: v2Id, resourceId },
    }));
  }, [sendRawProtocolFrame]);

  const callMcpTool = useCallback((conversationId: string, resourceId: string, toolName: string, args: Record<string, unknown> = {}) => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId) ?? null;
    const workspace = conversation
      ? stores.workspaces.get().find((item) => item.id === conversation.workspaceId) ?? null
      : null;
    const v2Id = conversation?.v2ConversationId;
    if (!conversation || !workspace || !isV2Conversation(conversation) || !v2Id) {
      desktopAlert(t('alert.needCreatedConversation'), t('alert.needMessageCallMcp'));
      return false;
    }
    appendTimeline(makeSystemEntry(t('sess.mcpCalling'), `${toolName}`, workspace.id, conversation.id));
    return Boolean(sendRawProtocolFrame({
      id: createRequestId('mcp'),
      type: 'mcp.call',
      payload: {
        conversationId: v2Id,
        resourceId,
        toolName,
        arguments: args,
      },
    }));
  }, [appendTimeline, sendRawProtocolFrame]);

  const sendApprovalResponse = useCallback(
    (selection: boolean | PermissionOption, request: PendingRequest, answerData?: Record<string, unknown>) => {
      const data = eventPayloadData(request.event);
      if (request.requestType === 'conversation.permission.request') {
        const conversationId = typeof data.conversationId === 'string' ? data.conversationId : '';
        const conversation = stores.conversations.get().find((item) => item.id === conversationId || item.v2ConversationId === conversationId) ?? null;
        if (refuseReadOnlyWrite(conversation)) return false;
        const v2Id = conversation?.v2ConversationId || conversation?.id || conversationId;
        const permissionId = typeof data.permissionId === 'string' ? data.permissionId : request.requestId;
        if (!v2Id || !permissionId) {
          desktopAlert(t('alert.invalidPermissionRequest'), t('alert.invalidPermissionRequestBody'));
          return false;
        }
        void sendProtocolCommand({
          id: createRequestId('perm'),
          type: 'conversation.permission.respond',
          payload: {
            conversationId: v2Id,
            permissionId,
            decision: permissionDecision(selection, answerData),
          },
        }).then(() => recoverConversation(conversation?.id || conversationId)).catch((error: unknown) => {
          setLastError(error instanceof Error ? error.message : t('sess.approvalUnconfirmed'));
          void recoverConversation(conversation?.id || conversationId);
        });
        return true;
      }
      // Only agent conversations ask for permission now.
      desktopAlert(t('alert.invalidPermissionRequest'), t('alert.invalidPermissionRequestBody'));
      return false;
    },
    [recoverConversation, sendProtocolCommand],
  );


  const openPermissionsMenu = useCallback((conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) return;
    const config = conversationPermissionCapabilities(context.conversation, providersForConversation(context.conversation));
    const selected = resolvePermissionMode(context.conversation, context.workspace);
    const labels: Record<PermissionMode, string> = {
      ask: t('chat.permissionAsk'),
      'accept-edits': t('chat.permissionAcceptEdits'),
      auto: t('chat.permissionAuto'),
      'full-access': t('chat.permissionFullAccess'),
    };
    desktopAlert(
      t('sess.permissionSettings'),
      config?.modes?.length ? t('sess.permissionApplyNext') : t('sess.permissionNotProvided'),
      (config?.modes ?? []).map((mode) => ({
        text: `${selected === mode ? '✓ ' : ''}${labels[mode] ?? mode}`,
        onPress: () => { void applyConversationPermissionMode(conversationId, mode); },
      })),
    );
  }, [applyConversationPermissionMode, getConversationContext]);




  const applyConversationModelSelection = useCallback(
    (conversationId: string, model: string, reasoningEffort: string | null) => {
      const context = getConversationContext(conversationId);
      if (!context || !model.trim()) return;
      const provider = context.conversation.provider as ProviderKind | undefined;
      if (provider && v2ProvidersRef.current.some((item) => item.id === provider)) {
        const backendConnectionId = context.conversation.backendConnectionId
          ?? context.workspace.backendConnectionId
          ?? activeBackendConnectionId;
        const selection = resolveRememberedProviderSelection(
          backendConnectionId,
          provider,
          model,
          reasoningEffort,
        );
        if (!selection.model) return;
        updateConversation(conversationId, {
          model: selection.model,
          reasoningEffort: selection.reasoningEffort,
        });
        rememberProviderModelSelection(
          backendConnectionId,
          provider,
          selection.model,
          selection.reasoningEffort,
        );
        return;
      }
      updateConversation(conversationId, {
        model: model.trim(),
        reasoningEffort: normalizeReasoningEffort(reasoningEffort) ?? reasoningEffort,
      });
    },
    [activeBackendConnectionId, getConversationContext, rememberProviderModelSelection, resolveRememberedProviderSelection, updateConversation],
  );



  const openSlashCommandActionPage = useCallback((workspace: WorkspaceRecord, conversation: ConversationRecord, command: string) => {
    openPanel('SlashCommandAction', {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      command: canonicalSlashCommand(command),
    });
  }, []);

  const copyLastAgentMessage = useCallback(async (conversationId: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const lastMessage = stores.timeline.get().find(
      (entry) => entry.conversationId === conversationId && entry.kind === 'incoming' && entry.subtitle.trim(),
    );
    if (!lastMessage) {
      desktopAlert('Copy', t('alert.noCodexReply'));
      return false;
    }
    await navigator.clipboard.writeText(lastMessage.subtitle);
    appendTimeline(makeSystemEntry('Copied last response', t('sess.copiedLastResponse'), context.workspace.id, context.conversation.id));
    return true;
  }, [appendTimeline, getConversationContext]);

  /** Export a conversation's messages and work steps (tool calls, reasoning)
   * as Markdown, for referencing it from another conversation (`@chat:`).
   * Reads the journal from its tail — the conversation may never have been
   * opened here — in full detail, since summary pages leave the steps empty,
   * and stops once the newest entries fill `maxBytes`. */
  const exportConversationMarkdown = useCallback(async (conversationId: string, maxBytes?: number) => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId);
    if (!conversation) throw new Error(t('alert.noConversation'));
    // A private conversation's content never leaves it.
    if (isPrivateConversation(conversation)) throw new Error(t('private.exportRefused'));
    const v2Id = conversation.v2ConversationId;
    const transcript = v2Id
      ? await fetchConversationTranscriptTail((id, before, limit) => decryptedHistoryReplay(id, v2ApiForConversation(id).replayEventsBefore(id, before, limit, 'full'), 'full'),
        v2Id, conversation.workspaceId, { title: conversation.title, maxBytes })
      : { entries: transcriptEntries(stores.timeline.get().filter((entry) => entry.conversationId === conversationId)), olderUnread: false };
    return conversationTranscriptMarkdown(transcript.entries, { title: conversation.title, maxBytes, olderUnread: transcript.olderUnread });
  }, [decryptedHistoryReplay, v2ApiForConversation]);

  /** Uploads a composer attachment to the backend that owns the conversation;
   * the prompt then names the returned path on that backend's machine. */
  const uploadComposerFile = useCallback(async (conversationId: string, name: string, blob: Blob) => {
    const profile = profileFor(backendIdForConversation(conversationId));
    if (!profile) throw new Error(t('sidebar.backendRemoved'));
    // A private conversation's files go to its private folder, deleted with
    // it; it was created on the backend when it was opened.
    const conversation = stores.conversations.get().find((item) => item.id === conversationId);
    if (isPrivateConversation(conversation) && !conversation?.v2ConversationId) throw new Error(t('private.notReady'));
    return uploadPromptFile(backendApi(profile), name, blob, isPrivateConversation(conversation) ? conversation?.v2ConversationId : undefined);
  }, []);

  /** Sets, pauses, resumes or clears the goal an agent pursues on its own
   * (`conversation.goal`); resolves to whether the backend accepted it. */
  const sendConversationGoal = useCallback(async (conversationId: string, action: 'set' | 'pause' | 'resume' | 'clear', objective?: string) => {
    const conversation = getConversationContext(conversationId)?.conversation;
    if (!conversation?.v2ConversationId || refuseReadOnlyWrite(conversation)) return false;
    const provider = providersForConversation(conversation).find((item) => item.id === conversation.provider);
    if (!provider?.capabilities.controlActions?.includes('goal')) {
      setLastError(t('sess.goalUnsupported'));
      return false;
    }
    try {
      await sendProtocolCommand({ id: createRequestId('goal'), type: 'conversation.goal', payload: {
        conversationId: conversation.v2ConversationId, action, ...(action === 'set' ? { objective } : {}),
      } }, 45_000);
      return true;
    } catch (error) {
      setLastError(error instanceof Error ? error.message : t('sess.operationFailed'));
      return false;
    }
  }, [getConversationContext, sendProtocolCommand]);

  const sendSlashCommand = useCallback(
    (input: string, conversationId = activeConversationRef.current) => {
      const trimmed = input.trim();
      if (!trimmed.startsWith('/')) {
        if (ensureConversationAgent(conversationId)) void sendV2Prompt(trimmed, conversationId);
        return;
      }

      const [command, ...rest] = trimmed.slice(1).trim().split(/\s+/);
      let lower = command.toLowerCase();
      // The command's argument text as typed, for commands that take free text.
      let argumentText = trimmed.slice(1).trim().slice(command.length).trim();
      const context = getConversationContext(conversationId);

      if (!context) {
        desktopAlert(t('alert.noWorkspace'), t('alert.pickWorkspace'));
        return;
      }

      const { workspace } = context;
      // Every command runs in an agent conversation: a draft gets its agent first.
      const conversation = ensureConversationAgent(conversationId);
      if (!conversation) return;
      if (conversation.provider === 'pi') {
        const route = routePiSlashCommand(input, getProviderCommandCatalog(conversation.id));
        if (route.kind === 'blocked') { toast.warning(t('sess.piCommand'), { description: route.message }); return; }
        if (route.kind === 'native') {
          void sendV2Prompt(route.input, conversation.id).then(accepted => {
            if (accepted) setConversationChatDraft(conversation.id, current => current.trim() === input.trim() ? '' : current);
          });
          return;
        }
        if (route.command === 'commands') { refreshProviderCommands(); return; }
        lower = route.command;
        argumentText = route.args;
      }
      if (lower === 'memory' || lower === 'memories') {
        openSlashCommandActionPage(workspace, conversation, '/memory');
        return;
      }
      // The backend refuses compaction of private conversations.
      if (lower === 'compact' && conversation.provider !== 'pi' && isPrivateConversation(conversation)) {
        setLastError(t('private.compactRefused'));
        return;
      }
      if (lower === 'compact' || lower === 'retry' || lower === 'resume') {
        const provider = providersForConversation(conversation).find((item) => item.id === conversation.provider);
        const nativeAction = provider?.capabilities.controlActions?.includes(lower) === true;
        // Some providers expose these as catalog commands instead of control
        // actions (e.g. Claude /compact runs as a literal prompt).
        const promptCommand = conversation.provider
          ? findPromptCommand(providerCommands[conversation.provider as ProviderKind], lower)
          : undefined;
        if (!conversation.v2ConversationId || (!nativeAction && !promptCommand)) {
          setLastError(lower === 'resume' ? t('sess.resumeNeedsMessage') : t('sess.operationUnsupported'));
          return;
        }
        if (!nativeAction) {
          void sendV2Prompt(trimmed, conversation.id);
          return;
        }
        const instructions = lower === 'compact' ? argumentText : '';
        if (instructions && provider?.capabilities.compactInstructions !== true) {
          setLastError(t('sess.compactNoInstructions'));
          return;
        }
        // An e2e backend cannot read the original request back (§7): retry
        // returns the `retryRequest` the latest user message carries, read
        // in full detail since summary pages leave it out. Messages written
        // before it existed fall back to the text this device decrypted.
        const v2Id = conversation.v2ConversationId;
        const retryFields = async (): Promise<Record<string, unknown> | null> => {
          if (lower !== 'retry' || !historyEncryptionRef.current?.e2eFor(backendIdForConversation(conversation.id))) return {};
          const timeline = conversationRecoveryRef.current?.get(v2Id)?.timeline ?? [];
          const sequence = historyRetrySequence(timeline);
          if (sequence === null) return null;
          const page = await decryptedHistoryReplay(v2Id, v2ApiForConversation(v2Id).replayEvents(v2Id, sequence - 1, 1), 'full');
          const request = historyRetryRequest(page.events.find((event) => event.sequence === sequence)?.payload);
          if (request) return { text: request.text, content: request.content };
          const prompt = historyRetryPrompt(timeline);
          return prompt === null ? null : { prompt };
        };
        void retryFields().then((fields) => {
          if (fields === null) {
            setLastError(t('history.retryNeedsPrompt'));
            return;
          }
          return sendProtocolCommand({ id: createRequestId(lower), type: `conversation.${lower}`, payload: {
            conversationId: v2Id,
            ...fields,
            ...(instructions ? { instructions } : {}),
          } }).then(() => recoverConversation(conversation.id));
        }).catch((error: unknown) => {
          setLastError(error instanceof Error ? error.message : t('sess.operationFailed'));
          void recoverConversation(conversation.id);
        });
        return;
      }
      if (lower === 'goal' && providersForConversation(conversation).find((item) => item.id === conversation.provider)
        ?.capabilities.controlActions?.includes('goal')) {
        // `/goal` alone opens the editor; pause, resume and clear act on the
        // goal; anything else (optionally after `set`) is the new objective.
        const subcommand = rest[0]?.toLowerCase() ?? '';
        const objective = subcommand === 'set' ? argumentText.slice(rest[0].length).trim() : argumentText;
        if (!objective) {
          openSlashCommandActionPage(workspace, conversation, '/goal');
        } else if (rest.length === 1 && (subcommand === 'pause' || subcommand === 'resume' || subcommand === 'clear')) {
          void sendConversationGoal(conversation.id, subcommand);
        } else {
          void sendConversationGoal(conversation.id, 'set', objective).then((accepted) => {
            if (accepted) setConversationChatDraft(conversation.id, current => current.trim() === trimmed ? '' : current);
          });
        }
        return;
      }
      // The agent's own prompt commands go to it as prompts; a few TodeX
      // commands map to v2 actions, and the rest run in the client.
      const promptCommand = conversation.provider
        ? findPromptCommand(providerCommands[conversation.provider as ProviderKind], lower)
        : undefined;
      if (promptCommand) {
        void sendV2Prompt(trimmed, conversation.id);
        return;
      }
      if (lower === 'fork') {
        forkConversation(conversation.id);
        return;
      }
      if (lower === 'rename') {
        renameConversation(conversation.id, rest.join(' '));
        return;
      }
      if (lower === 'archive') {
        removeConversation(conversation.id);
        return;
      }

      if (lower === 'permissions') {
        const presetName = rest[0]?.toLowerCase() ?? '';
        const preset = PERMISSION_PRESETS.find((candidate) => candidate.id === presetName || (presetName === 'ask' && candidate.id === 'default') || (presetName === 'auto' && candidate.id === 'auto-review') || candidate.profileId.toLowerCase() === presetName || candidate.title.toLowerCase() === presetName);
        if (preset) {
          void applyPermissionProfile(conversation.id, preset.profileId, preset.description, preset.approvalsReviewer);
          return;
        }
        openPermissionsMenu(conversation.id);
        return;
      }

      if (lower === 'approve' || lower === 'approval') {
        const deny = /^(deny|decline|reject|no)$/i.test(rest[0] ?? '');
        // The named request, else this conversation's oldest open one.
        const target = rest[1]
          ? pendingRequests.find((request) => request.requestId === rest[1])
          : pendingRequests.find((request) => request.data.conversationId === conversation.v2ConversationId);
        if (!target) {
          desktopAlert(t('alert.noPendingRequests'), t('alert.noPendingRequestsBody'));
          return;
        }
        sendApprovalResponse(!deny, target);
        return;
      }

      if (lower === 'clear' || lower === 'new') {
        createConversation(workspace.id);
        return;
      }

      if (lower === 'mention') {
        setConversationChatDraft(conversation.id, '@');
        setConversationComposerSelection(conversation.id, { start: 1, end: 1 });
        return;
      }

      if (lower === 'plan') {
        void applyConversationWorkMode(conversation.id, 'plan').then((selected) => {
          if (!selected || rest.length === 0) return;
          void sendV2Prompt(rest.join(' '), conversation.id);
        });
        return;
      }

      if (lower === 'diff') {
        openGitDiff(conversation.id);
        return;
      }

      if (lower === 'experimental') {
        openExperimentalFeatures(conversation.id);
        return;
      }

      if (lower === 'copy') {
        void copyLastAgentMessage(conversation.id);
        return;
      }

      setLastError(t('sess.operationUnsupported'));
    },
    [
      applyConversationWorkMode,
      applyPermissionProfile,
      copyLastAgentMessage,
      createConversation,
      decryptedHistoryReplay,
      ensureConversationAgent,
      forkConversation,
      getConversationContext,
      getProviderCommandCatalog,
      sendConversationGoal,
      openExperimentalFeatures,
      openGitDiff,
      openPermissionsMenu,
      openSlashCommandActionPage,
      pendingRequests,
      providerCommands,
      recoverConversation,
      refreshProviderCommands,
      removeConversation,
      renameConversation,
      sendApprovalResponse,
      sendProtocolCommand,
      sendV2Prompt,
      setConversationChatDraft,
      setConversationComposerSelection,
      setLastError,
      v2ApiForConversation,
    ],
  );

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!activeWorkspaceId) {
      const firstWorkspaceId = workspaces[0]?.id ?? '';
      if (firstWorkspaceId) {
        setActiveWorkspaceId(firstWorkspaceId);
      }
      return;
    }
    const workspace = workspaces.find((item) => item.id === activeWorkspaceId) ?? null;
    if (!workspace) {
      const firstWorkspaceId = workspaces[0]?.id ?? '';
      if (firstWorkspaceId !== activeWorkspaceId) {
        setActiveWorkspaceId(firstWorkspaceId);
        setActiveConversationId('');
      }
      return;
    }
    const workspaceConversations = conversations
      .filter((item) => item.workspaceId === workspace.id && item.archived !== true)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    if (workspaceConversations.some((item) => item.id === activeConversationId)) {
      return;
    }
    if (workspaceConversations.length > 0) {
      setActiveConversationId(workspaceConversations[0].id);
      return;
    }
    const nextConversation = createDefaultConversation(workspace);
    setConversations((current) => {
      if (current.some((item) => item.id === nextConversation.id)) {
        return current;
      }
      return [nextConversation, ...current];
    });
    setActiveConversationId(nextConversation.id);
  }, [activeConversationId, activeWorkspaceId, conversations, hydrated, workspaces]);

  const stopThinking = useCallback((conversationId: string) => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId) ?? null;
    const workspace = conversation
      ? stores.workspaces.get().find((item) => item.id === conversation.workspaceId) ?? null
      : null;
    if (!workspace || !conversation) {
      desktopAlert(t('alert.noWorkspace'), t('alert.pickWorkspace'));
      return;
    }
    if (isV2Conversation(conversation)) {
      const v2Id = conversation.v2ConversationId;
      if (!v2Id) {
        setLastError(t('sess.firstMessageCreating'));
        return;
      }
      // Name the turn on screen: if it already ended, the backend leaves a
      // newer turn running and answers `cancelled: false`.
      const turnId = conversationRecoveryRef.current?.get(v2Id)?.activeTurnId
        || pendingV2SubmissionsRef.current.get(conversation.id)?.turnId;
      void sendProtocolCommand(buildConversationCancelMessage(v2Id, turnId)).then((result) => {
        if (!isStaleCancelResult(result)) {
          appendTimeline(makeSystemEntry(t('sess.stopConfirmed'), t('sess.syncingTurn'), workspace.id, conversation.id));
        }
        // Either way the runtime resyncs, so a stale view picks up the turn
        // that is actually running.
        return recoverConversation(conversation.id);
      }).catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : t('sess.stopUnconfirmed'));
        void recoverConversation(conversation.id);
      });
    }
  }, [appendTimeline, recoverConversation, sendProtocolCommand]);

  const submitChat = useCallback((conversationId: string) => {
    const draftText = (chatDrafts[conversationId] ?? '').trim();
    const draftAttachments = composerAttachments[conversationId] ?? [];
    const skills = selectedSkills[conversationId] ?? [];
    if (!draftText && draftAttachments.length === 0 && skills.length === 0) {
      return;
    }
    const pendingUpload = liveComposerAttachments(draftText, draftAttachments).find((item) => item.uploadState);
    if (pendingUpload) {
      toast.danger(pendingUpload.uploadState === 'uploading' ? t('chat.uploadPending') : t('chat.uploadFailedBlocking', { name: pendingUpload.name }));
      return;
    }
    // The draft stays in the composer while a frozen backend wakes, then this runs again.
    const frozenBackend = backendIdForConversation(conversationId);
    if (backendWakeGateRef.current?.isFrozen(frozenBackend)) {
      void backendWakeGateRef.current.wake(frozenBackend).then(
        () => submitChatRef.current(conversationId),
        (error: unknown) => setLastError(error instanceof Error ? error.message : String(error)),
      );
      return;
    }
    // Pasted-text capsules are sent as the text they stand for.
    const { text: expandedText, attachments } = expandTextCapsules(draftText, draftAttachments);
    const text = expandedText.trim();
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noWorkspace'), t('alert.pickWorkspace'));
      return;
    }
    const { workspace } = context;
    // A draft without an agent gets one before anything is sent.
    const conversation = ensureConversationAgent(conversationId);
    if (!conversation) return;
    const isThinking = thinkingConversations[conversationId] === true;
    if (conversation.provider === 'pi' && text.startsWith('/')) {
      const route = routePiSlashCommand(text, getProviderCommandCatalog(conversation.id));
      if (route.kind !== 'native') { sendSlashCommand(text, conversationId); return; }
    }
    if (text === '/compact' && conversation.provider !== 'pi') {
      if (isThinking || pendingV2SubmissionsRef.current.has(conversationId)) {
        setLastError(t('sess.compactWait'));
        return;
      }
      sendSlashCommand(text, conversationId);
      setConversationChatDraft(conversationId, '');
      return;
    }
    const mentionReferences = parseMentionReferences(text);
    if (mentionReferences.length > 0) {
      // Files named in a private conversation are not remembered.
      if (!isPrivateConversation(conversation)) rememberMentionReferences(workspace.id, mentionReferences);
      const mentionSummary = summarizeMentionReferences(mentionReferences);
      if (mentionSummary) {
        appendTimeline(makeSystemEntry(t('sess.filesReferenced'), mentionSummary, workspace.id, conversationId));
      }
    }
    const liveAttachments = liveComposerAttachments(text, attachments);
    if (liveAttachments.length > 0) {
      appendTimeline(makeSystemEntry(t('sess.attachmentsAttached'), attachmentSummary(liveAttachments), workspace.id, conversationId));
    }
    if (skills.length > 0) {
      appendTimeline(makeSystemEntry(t('sess.skillSelected'), selectedSkillSummary(skills), workspace.id, conversationId));
    }
    const clearSubmittedComposer = () => {
      setConversationChatDraft(conversationId, (current) => current.trim() === draftText ? '' : current);
      setConversationAttachments(conversationId, (current) => current === draftAttachments ? [] : current);
      setConversationSelectedSkills(conversationId, (current) => current === skills ? [] : current);
      setConversationComposerSelection(conversationId, DEFAULT_COMPOSER_SELECTION);
    };
    // An idle conversation whose daemon waits out a rate limit also queues
    // there; sendV2Prompt routes it.
    if (isThinking) {
      // A provider with its own native queue (and no backend queue) keeps it.
      const nativeQueue = providersForConversation(conversation).find(item => item.id === conversation.provider)?.capabilities.followUpQueue === true;
      if (conversation.v2ConversationId && nativeQueue && !providerHasBackendQueue(providersForConversation(conversation), conversation.provider)
        && !liveAttachments.length && !skills.length) {
        void controlConversation(conversationId, { action: 'queueAdd', itemId: createRequestId('queue'), text })
          .then(accepted => { if (accepted) clearSubmittedComposer(); });
        return;
      }
      // Otherwise only the backend queues; the composer keeps the message
      // until it is accepted (or held in memory for a conversation that has no
      // backend id yet), so a refusal never loses it.
      void queueWhileBusy(conversationId, { id: createRequestId('queued'), text, attachments: liveAttachments, skills })
        .then((queued) => { if (queued) clearSubmittedComposer(); });
      return;
    }
    void sendV2Prompt(text, conversationId, skills, attachments).then((accepted) => {
      if (accepted) clearSubmittedComposer();
    });
  }, [appendTimeline, chatDrafts, composerAttachments, controlConversation, ensureConversationAgent, getConversationContext, queueWhileBusy, rememberMentionReferences, selectedSkills, sendSlashCommand, sendV2Prompt, setConversationAttachments, setConversationChatDraft, setConversationComposerSelection, setConversationSelectedSkills, thinkingConversations, getProviderCommandCatalog]);
  const submitChatRef = useRef(submitChat);
  submitChatRef.current = submitChat;





  // Backend/app release versions are expected to ship in lockstep; dev builds
  // (DEV0.0.0 / 0.0.0) on either side skip the check entirely.
  const versionMismatch = useMemo(
    () => isVersionMismatch(__TODEX_BUILD_VERSION__, serverVersion?.version),
    [serverVersion],
  );

  /** Fetch the full events covering an expanded folded group's stub sequences
   * and merge them into the projected timeline. Stubs are batched into
   * contiguous ranges so sparse groups skip unrelated payloads. Rejects when
   * the backend cannot be read so the UI can offer a retry. */
  /** Fetch the full events of folded rows, each given as the inclusive
   * journal range [firstSequence, sequence] it was built from, and merge them
   * into the projection. */
  const hydrateProcessGroup = useCallback(async (conversationId: string, ranges: ReadonlyArray<readonly [number, number]>) => {
    const conversation = stores.conversations.get().find((item) => item.id === conversationId);
    const v2Id = conversation?.v2ConversationId ?? conversationId;
    const api = v2ApiForConversation(v2Id);
    const merged = mergeSequenceRanges(ranges);
    if (!merged.length) return false;
    const events: ConversationEvent[] = [];
    for (const [fromSequence, toSequence] of merged) {
      let cursor = fromSequence - 1;
      while (cursor < toSequence) {
        const page = await decryptedHistoryReplay(v2Id, api.replayEvents(v2Id, cursor, Math.min(500, toSequence - cursor)), 'full');
        let reached = false;
        for (const event of page.events) {
          if (event.sequence > cursor && event.sequence <= toSequence) {
            events.push(event);
            cursor = event.sequence;
            reached = true;
          }
        }
        if (!reached || !page.hasMore) break;
      }
    }
    return events.length > 0
      && (conversationRecoveryRef.current?.hydrate(v2Id, conversation?.workspaceId ?? '', events) ?? false);
  }, [decryptedHistoryReplay, v2ApiForConversation]);

  // Kept referentially stable: the composer @-mention effect depends on this
  // callback, and a new identity per render would re-fire (and discard) the
  // lookup on every unrelated session update.
  const fetchWorkspaceEntries = useCallback(async (cwd: string, query: string, limit?: number) => {
    const api = backendApi(settings);
    return api.listWorkspaceEntries(cwd, query, limit);
  }, [settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified]);

  // Stable for the same reason as fetchWorkspaceEntries: the composer @ssh:
  // effect depends on it.
  const fetchSshHosts = useCallback(async () => {
    const api = backendApi(settings);
    return api.listSshHosts();
  }, [settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified]);

  // Stable for the composer @app: effect, like fetchSshHosts.
  const fetchHostApps = useCallback(async () => {
    const api = backendApi(settings);
    return api.listComputerApps();
  }, [settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified]);

  return {
    watchAgentBrowser,
    ...workbenchSharingState,
    ...completionNotificationsState,
    hydrated,
    directorySyncStatus,
    settings,
    /** Preferences plus a given backend's transport (the focused backend's
     * when the id is unknown). */
    settingsForBackend,
    setSettings,
    backendConnections,
    /** The backend serving the visible conversation or workspace. */
    activeBackendConnectionId,
    /** Connection status of every backend, by profile id. */
    backendLinkStatus: linkStatusByBackend,
    /** Backend of the None workspace in view (the sidebar lists None once
     * per backend). */
    noWorkspaceBackendId,
    updateBackendConnection,
    addBackendConnection,
    removeBackendConnection,
    replaceBackendConnection,
    workspaces,
    conversations,
    activeWorkspaceId,
    activeConversationId,
    connectionState,
    connectionHealth,
    backendStarting,
    modelCatalog,
    lastError,
    serverVersion,
    versionMismatch,
    /** High-frequency state; components subscribe through conversationStore.ts. */
    stores,
    /** The visible timeline right now (read it in a render through
     * `useVisibleTimeline` or a narrower selector to stay current). */
    get timeline() { return visibleTimeline(stores); },
    hydrateProcessGroup,
    historyEncryption,
    mentionHistory,
    experimentalFeatures,
    setExperimentalFeatures,
    chatDrafts,
    editFollowUpQueue,
    scheduleConversation,
    sendScheduledNow,
    createScheduledConversation,
    scheduledConversationAgents,
    createPrivateConversation,
    privateConversationAgents,
    controlConversation,
    controlStatusByConversation,
    composerAttachments,
    composerSelections,
    selectedSkills,
    turnIds,
    thinkingConversations,
    gitDiffByConversation,
    selectedGitRepoByWorkspace,
    selectGitRepo,
    terminalById,
    v2Providers,
    v2ProvidersByBackend,
    v2Conversations,
    capabilityCatalogs,
    providerModels,
    providerCommands,
    getProviderCommandCatalog,
    refreshProviderCommands,
    contextUsageByConversation,
    compactionByConversation,
    subagentsByConversation,
    agentCallsByConversation,
    get conversationRuntimeById() { return stores.runtime.get(); },
    recoveringConversations,
    openStatusByConversation,
    earlierHistory,
    submissionStatusByConversation,
    recoverConversation,
    loadEarlierHistory,
    reconcilePendingSubmission,
    memoryEntriesByConversation,
    usageRecords,
    pendingRequests,
    activeWorkspace,
    activeConversation,
    connect,
    disconnect,
    onDevicePairingApproved,
    createWorkspace,
    openGitWorktree,
    selectWorkspace,
    renameWorkspace,
    updateWorkspace,
    forkWorkspace,
    removeWorkspace,
    createConversation,
    materializeConversation: materializeV2Conversation,
    switchConversationAgent,
    selectConversation,
    openAgentCallConversation,
    cancelAgentCall,
    renameConversation,
    forkConversation,
    sendConversationGoal,
    removeConversation,
    purgeConversations,
    deleteConversation,
    forgetDeletedConversations,
    getHistoryStorage,
    setConversationLabelColor,
    submitChat,
    setBackendWakeGate,
    sendAgentMessage,
    setConversationChatDraft,
    pendingPluginDrafts,
    handlePluginDraft,
    stoppingProviderRuntimes,
    stopProviderRuntime,
    setConversationAttachments,
    setConversationSelectedSkills,
    setConversationComposerSelection,
    sendApprovalResponse,
    openGitDiff,
    openTerminal,
    openExperimentalFeatures,
    requestGitDiff,
    startTerminalSession,
    stopTerminalSession,
    sendTerminalInput,
    refreshCapabilityCatalog,
    toggleCatalogSkill,
    previewSkillResource,
    getMcpServerConfig,
    capabilityManager,
    refreshMcpServer,
    callMcpTool,
    fetchWorkspaceDirectorySnapshot: (path?: string) => fetchWorkspaceDirectorySnapshot(settings, path),
    fetchWorkspaceEntries,
    fetchSshHosts,
    fetchHostApps,
    applyConversationModelSelection,
    sendSlashCommand,
    openSlashCommandActionPage,
    copyLastAgentMessage,
    exportConversationMarkdown,
    uploadComposerFile,
    stopThinking,
    applyConversationPermissionMode,
    resolvePermissionMode,
    applyConversationWorkMode,
    seedTerminalState,
    resizeTerminalSession,
    requestTerminalStatus,
    openTerminalSession,
    clearTerminalOutput,
    terminalStreams: terminalStreamsRef.current,
    requestTerminalSnapshot,
    autoConnectEnabled,
    openPanel,
  };
}

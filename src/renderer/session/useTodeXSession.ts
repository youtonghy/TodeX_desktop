import { normalizeBackendLabelColor, type BackendConnectionProfile } from './backendColors';
import { useWorkbenchSharing } from './useWorkbenchSharing';
import {
  completionNotificationBody,
  postCompletionNotification,
  shouldNotifyCompletion,
  useCompletionNotifications,
} from './completionNotifications';
import { bindSentAttachmentEvents, prepareSentAttachments, projectSentAttachments, pruneSentAttachmentRecords, type SentAttachmentRecord } from './sentAttachments';
import { configureKanbanSync, syncKanbanTasksFromBackend } from './kanbanTasks';
import { t } from '../i18n';
import { QueuedFollowUps, restoreQueuedFollowUps } from './queuedFollowUps';
import { parseSessionLimitReset, rateLimitContinuationText, restoreRateLimitWaits, type SessionLimitReset } from './sessionRateLimit';
import { LegacyEventRecovery } from './legacyEventRecovery';
import { ConversationRecovery, isConversationRuntimeBusy, type ConversationOpenStatus, type EarlierHistoryResult } from './conversationRecovery';
import type { AgentBrowserFrame } from '@todex/protocol/agentDesktop';
import { parseFollowUpQueue, type ConversationRuntime } from '@todex/protocol/conversationRuntime';
import { followUpQueueFrame } from '@todex/protocol/conversationCommands';
import { conversationTranscriptMarkdown, fetchConversationTranscript, transcriptEntries } from '@todex/protocol/conversationExport';
import { canonicalConversationEventType, type ConversationEvent } from '@todex/protocol/v2';
import { ConversationEventBatcher } from '@todex/protocol/frameBatch';
import { ProtocolCommands, ProtocolCommandError, type ProtocolCommand } from './protocolCommands';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import type { ConversationReplay, ProviderDescriptor, ProviderKind, ConversationManifest, PromptContentRef, PromptSkillRef, SkillCatalogDescriptor, ProviderModelDescriptor, ProviderCommandDescriptor, ContextCompactionState, SubagentRun, MemoryEntry } from '@todex/protocol/v2';
import { contextCompactionStatus } from '@todex/protocol/v2';
import { HISTORY_ENCRYPTION_CAPABILITY, normalizeConversationEvent } from '@todex/protocol/v2';
import { verifyTransportPolicy, type SecureSocket } from '@todex/protocol/secureTransport';
import { TRANSPORT_V2_WS_CLOSE_CODE, TransportCryptoError } from '@todex/protocol/secureChannel';
import { startSocketVerification, type SocketVerification } from '@todex/protocol/socketVerification';
import { HISTORY_ENCRYPTION_UPDATED, historyRetryPrompt, historyRetryRequest, historyRetrySequence } from '@todex/protocol/historyEncryption';
import { historyErrorMessage, useHistoryEncryption, type HistoryEncryptionSession } from './useHistoryEncryption';
import { retryWithDelays } from '@todex/protocol/retry';
import { probeBackendConnection, nextReconnectDelayMs, inspectServerUrl, credentialMatchesOrigin } from '@todex/protocol/connectionProbe';
import {
  ConnectionSettings,
  CodexMemorySettings,
  CodexModelCatalogItem,
  CodexNativeThread,
  CodexServiceTierOption,
  LocalAdapterState,
  PendingRequest,
  PermissionOption,
  ServerEvent,
  WorkspaceRecord,
  type WorkspaceSyncRejection,
  type WorkspaceTombstone,
  approvalResponsePayload,
  buildHttpUrl,
  classifyPendingRequest,
  permissionDecision,
  createRequestId,
  displayNameFromPath,
  eventId,
  eventPayloadData,
  extractThreadIdFromEvent,
  inferApprovalResponseType,
  isThreadNotMaterializedHistoryError,
  normalizeReasoningEffort,
  normalizeThreadId,
  normalizeServerUrl,
  normalizeWorkspacePath,
  normalizeWorkspaceTombstone,
  mergeWorkspaceRecords,
  nextWorkspaceSortOrder,
  remapWorkspaceScopedRecords,
  prepareWorkspaceSyncPayload,
  parseWorkspaceSyncRejected,
  parseCodexModelListResponse,
  parseCodexNativeThread,
  parseCodexNativeThreadListResponse,
  parseCodexNativeThreadReadResponse,
  parseHooksListResponse,
  parseMemorySettingsResponse,
  parseMcpServerStatusListResponse,
  parsePermissionProfileListResponse,
  parsePluginListResponse,
  parseWorkspaceSyncResponse,
  workspaceMatchesTombstone,
  findCapabilityHashTrigger,
  insertCapabilityReference,
  sandboxPolicyForMode,
  shortJson,
  type CodexThreadHistoryEntry,
} from '@todex/protocol/todex';
import { loadJson, loadSecret, removeSecret, saveJson, saveSecret } from '../lib/storage';
import {
  applyPairingToSettings,
  assemblePairingQrChunkPayload,
  parsePairingQrFrame,
  resolvePairingPayload,
  type PairingQrChunk,
} from '@todex/protocol/transportCrypto';
import { ConnectionError } from '@todex/protocol/connectionError';
import { desktopAlert } from '../lib/desktopAlert';
import { createConcurrencyLimit } from '../lib/concurrencyLimit';
import { panelFromRoute, type DesktopPanel, type OpenPanelOptions } from '../lib/panels';
import type { CatalogState } from '../screens/CapabilitiesPanel';
import {
  DEFAULT_COMPOSER_SELECTION,
  EXPERIMENTAL_FEATURE_DEFAULTS,
  SETTINGS_STORAGE_KEY,
  WORKSPACES_STORAGE_KEY,
  CONVERSATIONS_STORAGE_KEY,
  TIMELINE_STORAGE_KEY,
  ACTIVE_SELECTION_STORAGE_KEY,
  MENTION_HISTORY_STORAGE_KEY,
  SESSION_CURSORS_STORAGE_KEY,
  EXPERIMENTAL_FEATURES_STORAGE_KEY,
  USAGE_RECORDS_STORAGE_KEY,
  PROVIDER_MODEL_PREFERENCES_STORAGE_KEY,
  DEVICE_SECRET_STORAGE_KEY,
  DEVICE_ORIGIN_STORAGE_KEY,
  BACKEND_CONNECTIONS_STORAGE_KEY,
  JSON_SAVE_DEBOUNCE_MS,
  SESSION_CURSOR_SAVE_DEBOUNCE_MS,
  WORKSPACE_SYNC_DEBOUNCE_MS,
  WORKSPACE_TOMBSTONES_STORAGE_KEY,
  SOCKET_EVENT_BATCH_SIZE,
  SOCKET_FRAME_DECODE_BATCH_SIZE,
  SOCKET_FRAME_DECODE_BUDGET_MS,
  MAX_PENDING_SOCKET_FRAMES,
  nextSocketBacklogStreak,
  type SocketBacklogStreak,
  MAX_TRANSPORT_HELLO_SESSION_CURSORS,
  MAX_TIMELINE_ITEMS,
  capTimelinePerConversation,
  type EarlierHistoryStatus,
  mergeSequenceRanges,
  MAX_USAGE_RECORDS,
  MAX_WORKSPACE_TOMBSTONES,
  MAX_EVENTS,
  CHAT_ATTACH_REPLAY_LIMIT,
  capTerminalOutput,
  evictIdleTerminalStates,
  DEFAULT_TERMINAL_ROWS,
  DEFAULT_TERMINAL_COLS,
  LOCAL_SESSION_IDLE_SUSPEND_MS,
  LOCAL_SESSION_IDLE_SWEEP_MS,
  SLASH_COMMANDS,
  EXPERIMENTAL_FEATURES,
  SLASH_COMMAND_CATEGORY_ORDER,
  SLASH_COMMAND_CATEGORY_LABELS,
  DIRECT_SLASH_COMMANDS,
  defaultSettings,
  defaultConnectionHealth,
  normalizeBackendConnectionProfile,
  profileFromSettings,
  settingsFromProfile,
  PERMISSION_PRESETS,
  type ServerVersion,
  type ConversationRecord,
  type PendingThreadList,
  type PendingGitDiff,
  type ExperimentalFeatureSettings,
  type GitDiffState,
  type McpInventoryState,
  type PermissionProfilesState,
  type HooksCatalogState,
  type PluginsCatalogState,
  type MemorySettingsState,
  type TerminalClientState,
  type TerminalTarget,
  type PendingThreadAction,
  type ComposerSelection,
  type ComposerAttachmentDraft,
  type QueuedChatSubmission,
  type PendingLocalStart,
  type PendingThreadStart,
  type PendingModelList,
  type PendingSkillList,
  type PendingJsonSave,
  type PendingSocketFrame,
  type ConversationContext,
  type ModelCommandPromptState,
  type ModelPickerPromptState,
  type ThreadInfoModalState,
  type ThreadCommandPromptState,
  type SkillListStatus,
  type SkillListItem,
  type SelectedSkillAttachment,
  type TimelineTarget,
  type ConnectionState,
  type ConnectionHealth,
  type RuntimeStatusState,
  type TerminalOutputEntry,
  type TerminalLifecycleState,
  type PermissionPreset,
  type TimelineEntry,
  type SlashCommand,
  type WorkspaceMentionHistory,
  type MentionReference,
  type ThreadMenuAction,
  type PersistedSettings,
  type WorkspaceDirectorySnapshot,
  type ProviderModelPreferences,
  canonicalSlashCommand,
  slashCommandDefinition,
  slashCommandNeedsActionPage,
  serviceTierCommandForModel,
  serviceTierSlashCommandsForModel,
  toPersistedSettings,
  fromPersistedSettings,
  backendApi,
  backendFetch,
  backendTransport,
  describeTransportFailure,
  sendSocketText,
  type TransportFailure,
  workspaceSyncPayloadEquals,
  createSessionId,
  terminalIdForConversation,
  terminalStatusLabel,
  terminalOutputLine,
  connectionStateLabel,
  healthLabelOf,
  modeLabelOf,
  compactGoalLabel,
  conversationTitleFromNativeThread,
  conversationPatchFromNativeThread,
  fetchWorkspaceDirectorySnapshot,
  progressTextFromData,
  isLifecycleProgressText,
  isVersionMismatch,
  objectPayloadOf,
  sessionIdFromEvent,
  mergeModelCatalog,
  normalizeExperimentalFeatures,
  itemTypeOf,
  itemIdOf,
  textFromContent,
  textFromItem,
  attachmentPrompt,
  attachmentTextBlock,
  codexInputFromComposer,
  attachmentSummary,
  liveComposerAttachments,
  selectedSkillSummary,
  skillIdFromPath,
  parseSkillListItems,
  extractProtocolError,
  reasoningEffortLabel,
  modelDisplayLabel,
  reasoningOptionsForModel,
  defaultReasoningForModel,
  normalizeProviderModelPreferences,
  providerModelPreferenceKey,
  resolveProviderModel,
  resolveProviderReasoningEffort,
  serviceTiersForModel,
  fastServiceTierForModel,
  serviceTierLabel,
  modelCommandInitialValue,
  parseModelCommandArgs,
  attachmentId,
  formatBytes,
  fileNameFromUri,
  inferMimeType,
  isImageMimeType,
  isTextAttachment,
  mimeTypeFromDataUrl,
  base64FromDataUrl,
  dataUrlFromBase64,
  estimatedBytesFromBase64,
  readBase64DataUrl,
  resolveFileSizeBytes,
  readTextAttachmentContent,
  localConversationStateOf,
  shouldAutoStartLocalAdapter,
  sessionIdForConversation,
  commandWorkspaceForConversation,
  isLocalAdapterAlreadyRunning,
  isLocalAdapterFailed,
  isThreadNotFound,
  localTurnErrorMessage,
  nowLabel,
  latencyLabelOf,
  threadDateLabel,
  parseThreadMetadataArgs,
  parseThreadMetadataPrompt,
  parseThreadMemoryMode,
  parsePositiveLimit,
  parseJsonArrayPrompt,
  nativeThreadPatchFromNotification,
  findMentionTrigger,
  insertMention,
  parseMentionReferences,
  summarizeMentionReferences,
  stringFromUnknown,
  parseWorkspaceDirectorySnapshot,
  permissionPresetForProfile,
  conversationPermissionCapabilities,
  conversationPermissionMode,
  rememberedRunModes,
  permissionProfileLabel,
  permissionPresetSelected,
  approvalsReviewerValue,
  makeOutgoingEntry,
  makeSystemEntry,
  classifyProgressEvent,
  classifyChatEvent,
  shouldAppendV2ConversationEvent,
  reduceV2ConversationEvents,
  mergeConversationTimeline,
  conversationFromManifest,
  mergeManifestConversations,
  isV2Conversation,
  hasBackendQueue,
  conversationImageInputSupport,
  canSwitchConversationAgent,
  resolveCreateConversationAgent,
  isTurnTerminalEvent,
  timelineEntryFromNativeHistoryEntry,
  isVisibleConversationEntry,
  conversationPreviewText,
  isStepProgressEntry,
  isThinkingProgressEntry,
  isCollapsibleProgressEntry,
  executionGroupId,
  buildConversationRenderItems,
  buildConversationControlMessage,
  type ConversationContextUsage,
  type UsageRecord,
  normalizeUsageRecords,
  createDefaultConversation,
  conversationsForWorkspaceSnapshot,
  forkConversationRecord,
  isDefaultConversationTitle,
  STREAMING_REPLY_PLACEHOLDER,
  formatThreadSummary,
  formatThreadActionResult,
  resultThreadFromValue,
  goalPatchFromEventData,
  turnIdFromEventData,
  turnStatusFromEventData,
  textFromLocalTurnPayload,
  cursorFromEvent,
  threadIdFromEventData,
  personalityLabel,
  FEEDBACK_CATEGORIES,
  PERSONALITY_OPTIONS,
  CONNECTION_HEALTH_INTERVAL_MS,
  CONNECTION_HEALTH_TIMEOUT_MS,
  SOCKET_WATCHDOG_INTERVAL_MS,
  SOCKET_LIVENESS_TIMEOUT_MS,
  SOCKET_VERIFICATION_TIMEOUT_MS,
  SOCKET_LIVENESS_MAX_FAILURES,
  MAX_COMPOSER_ATTACHMENTS,
  scheduleMessageTask,
  cancelMessageTask,
} from './helpers';

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
// on; older ones are released and reopen lazily from the journal tail.
const RETAINED_CONVERSATION_RUNTIMES = 8;

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
export function useTodeXSession(openPanel: OpenPanelFn) {
  const workbenchSharingState = useWorkbenchSharing();
  const completionNotificationsState = useCompletionNotifications();
  const socketRef = useRef<SecureSocket | null>(null);
  /** Live agent browser views: conversation → frame listeners. The socket
   * watches a conversation while it has listeners (re-sent on reconnect). */
  const agentBrowserWatchersRef = useRef(new Map<string, Set<(frame: AgentBrowserFrame) => void>>());
  const connectionAttemptRef = useRef<AbortController | null>(null);
  const socketVerifiedRef = useRef(false);
  const transportFailureRef = useRef(false);
  const rawProtocolSenderRef = useRef<(message: ProtocolCommand) => boolean>(() => false);
  const protocolCommandsRef = useRef<ProtocolCommands | null>(null);
  if (!protocolCommandsRef.current) protocolCommandsRef.current = new ProtocolCommands((message) => rawProtocolSenderRef.current(message));
  useEffect(() => () => protocolCommandsRef.current?.dispose(), []);
  const activeWorkspaceRef = useRef('');
  const activeConversationRef = useRef('');
  const workspacesRef = useRef<WorkspaceRecord[]>([]);
  const conversationsRef = useRef<ConversationRecord[]>([]);
  const v2ProvidersRef = useRef<ProviderDescriptor[]>([]);
  const timelineRef = useRef<TimelineEntry[]>([]);
  const turnIdsRef = useRef<Record<string, string>>({});
  const thinkingConversationsRef = useRef<Record<string, boolean>>({});
  const terminalByIdRef = useRef<Record<string, TerminalClientState>>({});
  const providerModelPreferencesRef = useRef<ProviderModelPreferences>({});
  const providerModelsByBackendRef = useRef<Record<string, ProviderModelCatalog>>({});
  const providerImageInputRef = useRef<Record<string, { status: 'loading' | 'ready' | 'error'; imageInput?: boolean; reason?: string }>>({});
  const pendingLocalStartsRef = useRef(new Map<string, PendingLocalStart>());
  const autoStartedLocalConversationsRef = useRef(new Set<string>());
  const pendingThreadStartsRef = useRef(new Map<string, PendingThreadStart>());
  const pendingThreadListsRef = useRef(new Map<string, PendingThreadList>());
  const pendingThreadActionsRef = useRef(new Map<string, PendingThreadAction>());
  const pendingV2ConversationCreatesRef = useRef(new Map<string, Promise<ConversationRecord | null>>());
  const pendingV2FirstPromptsRef = useRef(new Set<string>());
  const pendingV2SubmissionsRef = useRef(new Map<string, {
    text: string;
    skills: SelectedSkillAttachment[];
    attachments: ComposerAttachmentDraft[];
    requestId: string;
    turnId?: string;
    phase: 'sending' | 'running' | 'unknown';
  }>());
  const queuedChatDraftsRef = useRef<Record<string, QueuedChatSubmission[]>>({});
  /** Work the session still owes a conversation: a turn shown as running, a
   * prompt awaiting its turn, or queued follow-ups. */
  const conversationHasPendingWork = (localId: string) => thinkingConversationsRef.current[localId] === true
    || pendingV2SubmissionsRef.current.has(localId)
    || (queuedChatDraftsRef.current[localId]?.length ?? 0) > 0;
  // v2 ids we have asked the current socket to subscribe to, in request order;
  // the tail is the eviction candidate when the budget is reached.
  const v2SubscriptionsRef = useRef(new Set<string>());
  // subscribe requestId -> v2 id, so a rejected subscribe frees its slot again.
  const pendingV2SubscribeRef = useRef(new Map<string, string>());
  // Set during render (like rawProtocolSenderRef) so earlier effects can reach it.
  const subscribeV2ConversationRef = useRef<(v2ConversationId: string, options?: { afterSequence?: number; limit?: number }) => boolean>(() => false);
  const pendingGitDiffsRef = useRef(new Map<string, PendingGitDiff>());
  const pendingSkillListsRef = useRef(new Map<string, PendingSkillList>());
  const pendingModelListRef = useRef<PendingModelList | null>(null);
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
  const socketGenerationRef = useRef(0);
  const autoConnectAttemptedRef = useRef(false);
  const legacyRecoveryRef = useRef(new LegacyEventRecovery<ServerEvent>());
  const sessionCursorsRef = useRef(new Map<string, number>());
  const reconnectAttemptRef = useRef(0);
  const socketBacklogStreakRef = useRef<SocketBacklogStreak | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketWatchdogFailuresRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const workspaceBackendReadyRef = useRef(false);
  const workspaceBackendSkipNextSaveRef = useRef(false);
  const workspaceBackendSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceTombstonesRef = useRef<WorkspaceTombstone[]>([]);
  const workspaceMissingNotifiedRef = useRef(new Set<string>());
  const healthProbeSeqRef = useRef(0);
  const loadedNativeThreadHistoryRef = useRef(new Map<string, number>());
  const unmaterializedNativeThreadIdsRef = useRef(new Set<string>());

  const [hydrated, setHydrated] = useState(false);
  const [autoConnectEnabled, setAutoConnectEnabled] = useState(false);
  const [settings, setSettings] = useState<ConnectionSettings>(defaultSettings);
  const [backendConnections, setBackendConnections] = useState<BackendConnectionProfile[]>([]);
  const [activeBackendConnectionId, setActiveBackendConnectionId] = useState('default-backend');
  const activeBackendConnectionIdRef = useRef(activeBackendConnectionId);
  activeBackendConnectionIdRef.current = activeBackendConnectionId;
  // Backend the single `/v2/ws` socket was last opened against; a switch to a
  // workspace on another backend must move the socket along with it.
  const connectedBackendIdRef = useRef<string | null>(null);
  const connectionRoutingRef = useRef({ settings, backendConnections });
  connectionRoutingRef.current = { settings, backendConnections };
  // History reads follow the backend that owns the conversation, so a load
  // still in flight when the user switches away keeps reading the right
  // journal, and the next visit continues from where it stopped.
  const v2ApiForConversation = useCallback((conversationId: string) => {
    const { settings: activeSettings, backendConnections: profiles } = connectionRoutingRef.current;
    const backendId = backendIdForConversation(conversationId);
    const profile = backendId !== activeBackendConnectionIdRef.current
      ? profiles.find((item) => item.id === backendId)
      : undefined;
    const target = profile ?? activeSettings;
    return backendApi(target, { historyEncryption: true });
  }, []);
  /** Backend profile owning a conversation (the active one when untagged). */
  function backendIdForConversation(conversationId: string): string {
    const conversation = conversationsRef.current.find((item) => item.v2ConversationId === conversationId || item.id === conversationId);
    return conversation?.backendConnectionId
      ?? workspacesRef.current.find((item) => item.id === conversation?.workspaceId)?.backendConnectionId
      ?? activeBackendConnectionIdRef.current;
  }
  // End-to-end encrypted history: every page is decrypted before it reaches
  // the projection (set once the hook below has run).
  const historyEncryptionRef = useRef<HistoryEncryptionSession | null>(null);
  const withDecryptedTitles = (backendId: string, manifests: ConversationManifest[]) =>
    historyEncryptionRef.current?.withDecryptedTitles(backendId, manifests) ?? manifests;
  const decryptedHistoryReplay = useCallback(async <P extends ConversationReplay>(conversationId: string, page: Promise<P>, detail: 'summary' | 'full'): Promise<P> => {
    const history = historyEncryptionRef.current;
    const result = await page;
    return history ? history.decryptPage(backendIdForConversation(conversationId), conversationId, result, detail) : result;
  }, []);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [workspaceTombstones, setWorkspaceTombstones] = useState<WorkspaceTombstone[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [directorySyncStatus, setDirectorySyncStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [activeConversationId, setActiveConversationId] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  // Bumped each time the socket opens; discovery effects use it to retry
  // providers that failed while the backend was unreachable.
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>(defaultConnectionHealth);
  const [remoteModelCatalog, setRemoteModelCatalog] = useState<CodexModelCatalogItem[]>([]);
  const [modelCatalogStatus, setModelCatalogStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [modelCatalogError, setModelCatalogError] = useState('');
  const [lastError, setLastError] = useState('');
  const [serverVersion, setServerVersion] = useState<ServerVersion | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [sentAttachmentRecords, setSentAttachmentRecords] = useState<SentAttachmentRecord[]>([]);
  const sentAttachmentRecordsRef = useRef<SentAttachmentRecord[]>([]);
  const [mentionHistory, setMentionHistory] = useState<WorkspaceMentionHistory[]>([]);
  const [experimentalFeatures, setExperimentalFeatures] = useState<ExperimentalFeatureSettings>(EXPERIMENTAL_FEATURE_DEFAULTS);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [queuedChatDrafts, setQueuedChatDrafts] = useState<Record<string, QueuedChatSubmission[]>>({});
  const [queueHydrated, setQueueHydrated] = useState(false);
  const [queuePausedByConversation, setQueuePausedByConversation] = useState<Record<string, boolean>>({});
  const [rateLimitedUntilByConversation, setRateLimitedUntilByConversation] = useState<Record<string, SessionLimitReset>>({});
  const rateLimitedUntilRef = useRef<Record<string, SessionLimitReset>>({});
  const [controlStatusByConversation, setControlStatusByConversation] = useState<Record<string, 'pending' | 'unknown' | undefined>>({});
  const controlRequestsRef = useRef(new Map<string, string>());
  const controlDraftsRef = useRef(new Map<string, { conversationId: string; text: string }>());
  const followUpsRef = useRef(new QueuedFollowUps());
  const [composerAttachments, setComposerAttachments] = useState<Record<string, ComposerAttachmentDraft[]>>({});
  const [composerSelections, setComposerSelections] = useState<Record<string, ComposerSelection>>({});
  const [selectedSkills, setSelectedSkills] = useState<Record<string, SelectedSkillAttachment[]>>({});
  const [skillListVisible, setSkillListVisible] = useState(false);
  const [skillListConversationId, setSkillListConversationId] = useState('');
  const [skillListStatus, setSkillListStatus] = useState<SkillListStatus>('idle');
  const [skillListError, setSkillListError] = useState('');
  const [skillListItems, setSkillListItems] = useState<SkillListItem[]>([]);
  const [modelCommandPrompt, setModelCommandPrompt] = useState<ModelCommandPromptState | null>(null);
  const [modelPickerPrompt, setModelPickerPrompt] = useState<ModelPickerPromptState | null>(null);
  const [threadInfoModal, setThreadInfoModal] = useState<ThreadInfoModalState | null>(null);
  const [threadCommandPrompt, setThreadCommandPrompt] = useState<ThreadCommandPromptState | null>(null);
  const [turnIds, setTurnIds] = useState<Record<string, string>>({});
  const [thinkingConversations, setThinkingConversations] = useState<Record<string, boolean>>({});
  const [threadListStatusByWorkspace, setThreadListStatusByWorkspace] = useState<Record<string, 'idle' | 'loading' | 'ready' | 'error'>>({});
  const [threadListErrorByWorkspace, setThreadListErrorByWorkspace] = useState<Record<string, string>>({});
  const [gitDiffByConversation, setGitDiffByConversation] = useState<Record<string, GitDiffState>>({});
  const [selectedGitRepoByWorkspace, setSelectedGitRepoByWorkspace] = useState<Record<string, string>>({});
  const [mcpInventoryByConversation, setMcpInventoryByConversation] = useState<Record<string, McpInventoryState>>({});
  const [permissionProfilesByConversation, setPermissionProfilesByConversation] = useState<Record<string, PermissionProfilesState>>({});
  const [hooksCatalogByConversation, setHooksCatalogByConversation] = useState<Record<string, HooksCatalogState>>({});
  const [pluginsCatalogByConversation, setPluginsCatalogByConversation] = useState<Record<string, PluginsCatalogState>>({});
  const [memorySettingsByConversation, setMemorySettingsByConversation] = useState<Record<string, MemorySettingsState>>({});
  const [terminalById, setTerminalById] = useState<Record<string, TerminalClientState>>({});
  // Agent, model and command catalogs are per backend: every workspace reads
  // the catalog of its own backend, and switching back does not refetch blind.
  const [v2ProvidersByBackend, setV2ProvidersByBackend] = useState<Record<string, ProviderDescriptor[]>>({});
  const [v2Conversations, setV2Conversations] = useState<ConversationManifest[]>([]);
  const [capabilityCatalogs, setCapabilityCatalogs] = useState<Partial<Record<ProviderKind, CatalogState>>>({});
  const [providerModelsByBackend, setProviderModelsByBackend] = useState<Record<string, ProviderModelCatalog>>({});
  const [providerImageInput, setProviderImageInput] = useState<Record<string, { status: 'loading' | 'ready' | 'error'; imageInput?: boolean; reason?: string }>>({});
  const [providerModelPreferences, setProviderModelPreferences] = useState<ProviderModelPreferences>({});
  const [providerCommandsByBackend, setProviderCommandsByBackend] = useState<Record<string, Partial<Record<ProviderKind, ProviderCommandDescriptor[]>>>>({});
  const v2Providers = v2ProvidersByBackend[activeBackendConnectionId] ?? EMPTY_PROVIDERS;
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
  const [memoryEntriesByConversation, setMemoryEntriesByConversation] = useState<Record<string, MemoryEntry[]>>({});
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [conversationRuntimeById, setConversationRuntimeById] = useState<Record<string, ConversationRuntime>>({});
  const [recoveringConversations, setRecoveringConversations] = useState<Record<string, boolean>>({});
  /** Lazy history opens in flight or failed, by local conversation id; set
   * before any runtime state exists, unlike recoveringConversations. */
  const [openStatusByConversation, setOpenStatusByConversation] = useState<Record<string, ConversationOpenStatus>>({});
  // Per-conversation lazy-history flags for the chat scroll sentinel.
  const [earlierHistory, setEarlierHistory] = useState<Record<string, EarlierHistoryStatus>>({});
  const [submissionStatusByConversation, setSubmissionStatusByConversation] = useState<Record<string, 'sending' | 'running' | 'unknown' | undefined>>({});
  const settledV2TurnsRef = useRef(new Map<string, string>());
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
  if (!conversationRecoveryRef.current) conversationRecoveryRef.current = new ConversationRecovery(
    (id, after, limit) => decryptedHistoryReplay(id, v2ApiForConversation(id).replayEvents(id, after, limit, 'summary'), 'summary'),
    (state, applied, recovering, live) => runtimeUpdateRef.current(state, applied, recovering, live), setLastError,
    (id, before, limit) => decryptedHistoryReplay(id, v2ApiForConversation(id).replayEventsBefore(id, before, limit, 'summary'), 'summary'),
    (id, status) => {
      const localId = conversationsRef.current.find((item) => item.v2ConversationId === id || item.id === id)?.id;
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
      const localId = conversationsRef.current.find((item) => item.v2ConversationId === id || item.id === id)?.id;
      return Boolean(localId && conversationHasPendingWork(localId));
    },
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
  const projectedRuntimeListsRef = useRef(new Map<string, Pick<ConversationRuntime, 'subagents' | 'usageRecords'>>());


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

  useEffect(() => {
    if (!hydrated || !settings.serverUrl.trim()) {
      if (hydrated) setDirectorySyncStatus('ready');
      return;
    }
    const api = backendApi(settings);
    const backendId = activeBackendConnectionId;
    let active = true;
    setDirectorySyncStatus('loading');
    void Promise.all([api.listProviders(), api.listConversations()])
      .then(([providers, conversations]) => {
        if (!active) return;
        setBackendProviders(backendId, providers.providers);
        setV2Conversations(conversations.conversations);
        setConversations((current) => mergeManifestConversations(current, withDecryptedTitles(backendId, conversations.conversations), workspacesRef.current, backendId));
        setDirectorySyncStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        // Keep this backend's last known agent catalog; the status flags the failure.
        setDirectorySyncStatus('error');
        setV2Conversations([]);
      });
    const refreshTimer = setInterval(() => {
      void api.listConversations().then((response) => {
        if (!active) return;
        setV2Conversations(response.conversations);
        setConversations((current) => mergeManifestConversations(current, withDecryptedTitles(backendId, response.conversations), workspacesRef.current, backendId));
      }).catch(() => undefined);
    }, 15000);
    // The main connection below is the single `/v2/ws` socket; providers and
    // conversations lists are plain HTTP refreshes, no side channel needed.
    return () => {
      active = false;
      clearInterval(refreshTimer);
    };
  }, [activeBackendConnectionId, hydrated, setBackendProviders, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.serverUrl]);

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

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);
  const queuedChatDispatchingRef = useRef(new Set<string>());
  const sendQueuedChatDraftRef = useRef<(submission: QueuedChatSubmission, conversationId: string) => Promise<boolean>>(async () => false);
  const queueV2FollowUpRef = useRef<(conversationId: string, item: QueuedChatSubmission) => Promise<'queued' | 'started' | false>>(async () => false);
  const refreshFollowUpQueueRef = useRef<(conversationId: string) => Promise<void>>(async () => undefined);
  const editFollowUpQueueRef = useRef<(conversationId: string, operation: 'remove' | 'clear' | 'resume', itemId?: string) => Promise<boolean>>(async () => false);
  // Conversations whose candidate queue is being handed to the backend.
  const followUpHandoverRef = useRef(new Set<string>());
  // Resumes that waited for the backend's provider capabilities to load.
  const deferredFollowUpResumesRef = useRef(new Set<string>());

  const activeTurnId = activeConversationId ? turnIds[activeConversationId] ?? '' : '';
  const modelCatalog = useMemo(
    () => mergeModelCatalog(
      remoteModelCatalog,
      [
        settings.defaultModel,
        ...workspaces.map((workspace) => workspace.model),
      ],
    ),
    [remoteModelCatalog, settings.defaultModel, workspaces],
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
    modes: { permissionMode?: 'ask' | 'auto' | 'full-access'; workMode?: 'plan' | 'implement' },
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

  useEffect(() => {
    queuedChatDraftsRef.current = queuedChatDrafts;
  }, [queuedChatDrafts]);

  useEffect(() => {
    let disposed = false;
    void loadJson<unknown>('todex.queued-follow-ups.v1', {}).then((value) => {
      if (disposed) return;
      const queues = restoreQueuedFollowUps<QueuedChatSubmission>(value);
      queuedChatDraftsRef.current = { ...queues, ...queuedChatDraftsRef.current };
      setQueuedChatDrafts(queuedChatDraftsRef.current);
      setQueueHydrated(true);
    }).catch(() => {
      if (!disposed) setLastError(t('sess.candidateRestoreFailed'));
    });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (queueHydrated) void saveJson('todex.queued-follow-ups.v1', queuedChatDrafts)
      .catch(() => setLastError(t('sess.candidateSaveFailed')));
  }, [queueHydrated, queuedChatDrafts]);

  useEffect(() => {
    let disposed = false;
    void loadJson<unknown>('todex.rate-limits.v1', {}).then((value) => {
      if (disposed) return;
      const waits = restoreRateLimitWaits(value);
      if (Object.keys(waits).length === 0) return;
      rateLimitedUntilRef.current = { ...waits, ...rateLimitedUntilRef.current };
      setRateLimitedUntilByConversation(rateLimitedUntilRef.current);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (queueHydrated) void saveJson('todex.rate-limits.v1', rateLimitedUntilByConversation).catch(() => undefined);
  }, [queueHydrated, rateLimitedUntilByConversation]);

  const setConversationRateLimit = useCallback((conversationId: string, wait: SessionLimitReset | null) => {
    if (wait) {
      rateLimitedUntilRef.current = { ...rateLimitedUntilRef.current, [conversationId]: wait };
    } else if (conversationId in rateLimitedUntilRef.current) {
      const { [conversationId]: _removed, ...rest } = rateLimitedUntilRef.current;
      rateLimitedUntilRef.current = rest;
    } else {
      return;
    }
    setRateLimitedUntilByConversation(rateLimitedUntilRef.current);
  }, []);

  const removeQueuedFollowUp = useCallback((conversationId: string, itemId: string) => {
    const items = (queuedChatDraftsRef.current[conversationId] ?? []).filter(item => item.id !== itemId);
    queuedChatDraftsRef.current = { ...queuedChatDraftsRef.current, [conversationId]: items };
    setQueuedChatDrafts(queuedChatDraftsRef.current);
  }, []);

  const clearQueuedFollowUps = useCallback((conversationId: string) => {
    if (!(conversationId in queuedChatDraftsRef.current)) return;
    const { [conversationId]: _removed, ...rest } = queuedChatDraftsRef.current;
    queuedChatDraftsRef.current = rest;
    setQueuedChatDrafts(rest);
  }, []);

  const resumeQueuedFollowUps = useCallback(async (conversationId: string, options: { rateLimitEnded?: boolean } = {}) => {
    // A conversation still inside a provider rate-limit window holds its queue
    // until the recorded reset instant; the timer below resumes it then.
    const wait = rateLimitedUntilRef.current[conversationId];
    if (wait && wait.until > Date.now()) return;
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    // Whether the backend holds the queue is unknown until its providers
    // load (right after a reload or reconnect); decide then.
    if (conversation?.v2ConversationId && v2ProvidersRef.current.length === 0) {
      deferredFollowUpResumesRef.current.add(conversationId);
      return;
    }
    if (hasBackendQueue(v2ProvidersRef.current, conversation)) {
      // The backend decides when queued prompts run, busy or not: hand the
      // candidates over in order instead of dispatching them from here.
      if (followUpHandoverRef.current.has(conversationId)) return;
      followUpHandoverRef.current.add(conversationId);
      try {
        for (let item = queuedChatDraftsRef.current[conversationId]?.[0]; item;
          item = queuedChatDraftsRef.current[conversationId]?.[0]) {
          if (!await queueV2FollowUpRef.current(conversationId, item)) break;
          removeQueuedFollowUp(conversationId, item.id);
        }
      } finally {
        followUpHandoverRef.current.delete(conversationId);
      }
      // A queue paused by the rate-limited turn continues once the window ends.
      const followUps = conversation?.v2ConversationId
        ? conversationRecoveryRef.current?.get(conversation.v2ConversationId)?.followUps : undefined;
      if (options.rateLimitEnded && followUps?.paused && followUps.pauseReason === 'turn_failed') {
        await editFollowUpQueueRef.current(conversationId, 'resume');
      }
      return;
    }
    if (thinkingConversationsRef.current[conversationId] || pendingV2SubmissionsRef.current.has(conversationId)) return;
    // A backend without its own queue: its manifest still reports a turn the
    // lazily loaded window has not adopted yet.
    if (conversation?.nativeStatus === 'running' || conversation?.nativeStatus === 'waiting_permission') return;
    await followUpsRef.current.resume(conversationId,
      () => queuedChatDraftsRef.current[conversationId]?.[0],
      (item) => sendQueuedChatDraftRef.current(item, conversationId),
      (itemId) => removeQueuedFollowUp(conversationId, itemId));
    setQueuePausedByConversation(current => ({ ...current, [conversationId]: followUpsRef.current.isPaused(conversationId) }));
  }, [removeQueuedFollowUp]);

  // Provider rate-limit windows (e.g. Claude Code's five-hour limit) end at
  // the parsed reset instant; the queued follow-ups then drain normally.
  // A single long setTimeout is unreliable in a hidden/frozen/slept renderer,
  // so expired waits are also swept on an interval and whenever the window
  // regains focus or visibility.
  useEffect(() => {
    const sweepExpiredWaits = () => {
      const now = Date.now();
      const expired = Object.keys(rateLimitedUntilRef.current)
        .filter((id) => rateLimitedUntilRef.current[id].until <= now);
      if (expired.length === 0) return;
      rateLimitedUntilRef.current = { ...rateLimitedUntilRef.current };
      for (const id of expired) delete rateLimitedUntilRef.current[id];
      setRateLimitedUntilByConversation(rateLimitedUntilRef.current);
      for (const id of expired) void resumeQueuedFollowUps(id, { rateLimitEnded: true });
    };
    const waits = Object.values(rateLimitedUntilByConversation).map((wait) => wait.until);
    if (waits.length === 0) return;
    const timer = window.setTimeout(sweepExpiredWaits, Math.max(0, Math.min(...waits) - Date.now()));
    const watchdog = window.setInterval(sweepExpiredWaits, 30_000);
    const onWake = () => { if (document.visibilityState === 'visible') sweepExpiredWaits(); };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [rateLimitedUntilByConversation, resumeQueuedFollowUps]);

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

  const persistSessionCursors = useCallback(() => {
    const cursors = Object.fromEntries(sessionCursorsRef.current.entries());
    scheduleJsonSave(SESSION_CURSORS_STORAGE_KEY, cursors, SESSION_CURSOR_SAVE_DEBOUNCE_MS);
  }, [scheduleJsonSave]);

  const getSessionCursorSnapshot = useCallback(() => {
    const cursors = sessionCursorsRef.current;
    if (cursors.size <= MAX_TRANSPORT_HELLO_SESSION_CURSORS) {
      return Object.fromEntries(cursors.entries());
    }

    const selected = new Map<string, number>();
    const activeConversationId = activeConversationRef.current;
    const rankedConversations = conversationsRef.current
      .filter((conversation) => conversation.sessionId && cursors.has(conversation.sessionId))
      .sort((left, right) => {
        const activeRank =
          (right.id === activeConversationId ? 1 : 0) -
          (left.id === activeConversationId ? 1 : 0);
        if (activeRank !== 0) {
          return activeRank;
        }
        return right.updatedAt - left.updatedAt;
      });

    for (const conversation of rankedConversations) {
      if (selected.size >= MAX_TRANSPORT_HELLO_SESSION_CURSORS) {
        break;
      }
      const cursor = cursors.get(conversation.sessionId);
      if (cursor !== undefined) {
        selected.set(conversation.sessionId, cursor);
      }
    }

    if (selected.size < MAX_TRANSPORT_HELLO_SESSION_CURSORS) {
      for (const [sessionId, cursor] of cursors.entries()) {
        if (selected.size >= MAX_TRANSPORT_HELLO_SESSION_CURSORS) {
          break;
        }
        if (!selected.has(sessionId)) {
          selected.set(sessionId, cursor);
        }
      }
    }

    return Object.fromEntries(selected.entries());
  }, []);

  const closeSocket = useCallback((manual = true) => {
    // Events this socket already delivered are valid; project them before
    // its generation ends.
    conversationEventBatcherRef.current?.flush();
    socketGenerationRef.current += 1;
    connectionAttemptRef.current?.abort();
    connectionAttemptRef.current = null;
    socketVerifiedRef.current = false;
    healthProbeSeqRef.current += 1;
    protocolCommandsRef.current?.disconnect();
    if (manual) {
      manualDisconnectRef.current = true;
      setAutoConnectEnabled(false);
      setConnectionState('closed');
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (workspaceBackendSyncTimerRef.current) {
      clearTimeout(workspaceBackendSyncTimerRef.current);
      workspaceBackendSyncTimerRef.current = null;
    }
    workspaceBackendReadyRef.current = false;
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }
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
  }, []);

  const updateSentAttachmentRecords = useCallback((next: SentAttachmentRecord[]) => {
    const pruned = pruneSentAttachmentRecords(next);
    sentAttachmentRecordsRef.current = pruned;
    setSentAttachmentRecords(pruned);
    scheduleJsonSave(SENT_ATTACHMENTS_STORAGE_KEY, pruned);
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
        storedSessionCursors,
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
        loadJson<{ workspaceId?: string; conversationId?: string } | null>(ACTIVE_SELECTION_STORAGE_KEY, null),
        loadJson<WorkspaceMentionHistory[]>(MENTION_HISTORY_STORAGE_KEY, []),
        loadJson<Record<string, number>>(SESSION_CURSORS_STORAGE_KEY, {}),
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
      const profiles = hydratedProfiles.length ? hydratedProfiles : [profileFromSettings(nextSettings)];
      const normalizedWorkspaces = storedWorkspaces.map((workspace) => ({
        ...workspace,
        reasoningEffort: normalizeReasoningEffort(workspace.reasoningEffort),
        threadId: '',
        localAdapterState: 'idle' as LocalAdapterState,
      }));
      const existingWorkspaceIds = new Set(normalizedWorkspaces.map((workspace) => workspace.id));
      const seenSessionIds = new Set<string>();
      const seenThreadIds = new Set<string>();
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

                return {
                  ...conversation,
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
      sessionCursorsRef.current = new Map(
        Object.entries(storedSessionCursors)
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0),
      );

      const normalizedTombstones = (Array.isArray(storedWorkspaceTombstones) ? storedWorkspaceTombstones : [])
        .map(normalizeWorkspaceTombstone)
        .filter((item): item is WorkspaceTombstone => Boolean(item))
        .slice(0, MAX_WORKSPACE_TOMBSTONES);
      workspaceTombstonesRef.current = normalizedTombstones;
      // Restore the backend that owns the restored workspace; otherwise the
      // profile the persisted settings point at, so the two cannot disagree.
      const restoredWorkspace = normalizedWorkspaces.find((workspace) => workspace.id === firstWorkspaceId);
      const workspaceProfile = profiles.find((profile) => profile.id === restoredWorkspace?.backendConnectionId);
      const activeProfile = workspaceProfile
        ?? profiles.find((profile) => profile.serverUrl === nextSettings.serverUrl)
        ?? profiles[0];
      setSettings(workspaceProfile ? settingsFromProfile(workspaceProfile, nextSettings) : nextSettings);
      setBackendConnections(profiles);
      setActiveBackendConnectionId(activeProfile?.id ?? 'default-backend');
      setWorkspaces(normalizedWorkspaces);
      setWorkspaceTombstones(normalizedTombstones);
      setConversations(normalizedConversations);
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
      setActiveConversationId(firstConversationId);
      setAutoConnectEnabled(Boolean(storedSettings?.serverUrl?.trim()));
      setHydrated(true);
    })();

    return () => {
      alive = false;
      closeSocket(false);
    };
  }, [closeSocket, reportSecretStoreError]);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    workspaceTombstonesRef.current = workspaceTombstones;
  }, [workspaceTombstones]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    v2ProvidersRef.current = v2Providers;
  }, [v2Providers]);

  // Candidates restored from storage move to the backend queue as soon as
  // the connected backend is known to hold one; resumes deferred while its
  // providers loaded run now.
  useEffect(() => {
    if (!queueHydrated || connectionState !== 'open' || v2Providers.length === 0) return;
    const deferred = [...deferredFollowUpResumesRef.current];
    deferredFollowUpResumesRef.current.clear();
    for (const id of new Set([...deferred, ...Object.keys(queuedChatDraftsRef.current)])) {
      const conversation = conversationsRef.current.find((item) => item.id === id);
      if (deferred.includes(id) || (queuedChatDraftsRef.current[id]?.length && hasBackendQueue(v2Providers, conversation))) {
        void resumeQueuedFollowUps(id);
      }
    }
  }, [connectionState, queueHydrated, resumeQueuedFollowUps, v2Providers]);

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
    providerImageInputRef.current = providerImageInput;
  }, [providerImageInput]);

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

  // Rejections carry `code` per record; every rejected workspace is flagged
  // `pathMissing` (greyed out in the sidebar) and toasted once per path until
  // it syncs cleanly again.
  const flagWorkspaceMissing = useCallback(
    (workspace: WorkspaceRecord, missingKeys: Set<string>) => {
      const inScope = !workspace.backendConnectionId || workspace.backendConnectionId === activeBackendConnectionId;
      const pathMissing = (inScope && missingKeys.has(normalizeWorkspacePath(workspace.path))) || undefined;
      return workspace.pathMissing === pathMissing ? workspace : { ...workspace, pathMissing };
    },
    [activeBackendConnectionId],
  );

  const notifyRejectedWorkspaces = useCallback((rejections: WorkspaceSyncRejection[]) => {
    const keys = new Set(rejections.map((item) => normalizeWorkspacePath(item.path)));
    const fresh = rejections.filter((item) => !workspaceMissingNotifiedRef.current.has(normalizeWorkspacePath(item.path)));
    workspaceMissingNotifiedRef.current = keys;
    if (fresh.length > 0) {
      setLastError(t('sess.workspacePathMissing', { paths: fresh.map((item) => item.path).join(', ') }));
    }
  }, []);

  const applyWorkspaceSyncRejections = useCallback(
    (rejections: WorkspaceSyncRejection[]) => {
      notifyRejectedWorkspaces(rejections);
      const missingKeys = new Set(rejections.map((item) => normalizeWorkspacePath(item.path)));
      setWorkspaces((current) => {
        const flagged = current.map((workspace) => flagWorkspaceMissing(workspace, missingKeys));
        if (flagged.every((workspace, index) => workspace === current[index])) {
          return current;
        }
        workspaceBackendSkipNextSaveRef.current = true;
        return flagged;
      });
    },
    [flagWorkspaceMissing, notifyRejectedWorkspaces],
  );

  const syncWorkspacesToBackend = useCallback(
    async (snapshot: WorkspaceRecord[] = workspacesRef.current) => {
      try {
        const activeSnapshot = snapshot.filter((workspace) =>
          !workspace.backendConnectionId || workspace.backendConnectionId === activeBackendConnectionId,
        );
        const body = JSON.stringify({ workspaces: prepareWorkspaceSyncPayload(activeSnapshot) });
        const response = await backendFetch(settings, {
          method: 'PUT',
          path: '/v2/workspaces',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body,
        });
        if (!response.ok) {
          const errorBody = await response.json().catch(() => null) as { message?: unknown } | null;
          const message = typeof errorBody?.message === 'string' ? errorBody.message : '';
          throw new Error(message ? `workspace sync failed: ${message}` : `workspace sync returned ${response.status}`);
        }
        const payload = await response.json().catch(() => null);
        applyWorkspaceSyncRejections(parseWorkspaceSyncRejected(payload));
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : t('sess.workspaceSyncFailed'));
        return false;
      }
    },
    [activeBackendConnectionId, applyWorkspaceSyncRejections, settings],
  );

  const scheduleWorkspaceBackendSave = useCallback(
    (snapshot: WorkspaceRecord[]) => {
      if (workspaceBackendSyncTimerRef.current) {
        clearTimeout(workspaceBackendSyncTimerRef.current);
      }
      const payload = prepareWorkspaceSyncPayload(snapshot);
      workspaceBackendSyncTimerRef.current = setTimeout(() => {
        workspaceBackendSyncTimerRef.current = null;
        void syncWorkspacesToBackend(payload);
      }, WORKSPACE_SYNC_DEBOUNCE_MS);
    },
    [syncWorkspacesToBackend],
  );

  /** Pull the backend's workspaces into the local list. The conversation list
   * is fetched too unless `listConversations` is false: the periodic sync
   * leaves it to the manifest refresh, which polls it on its own timer. */
  const syncWorkspacesFromBackend = useCallback(async ({ listConversations = true }: { listConversations?: boolean } = {}) => {
    workspaceBackendReadyRef.current = false;
    try {
      const response = await backendFetch(settings, {
        method: 'GET',
        path: '/v2/workspaces',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null) as { message?: unknown } | null;
        const message = typeof errorBody?.message === 'string' ? errorBody.message : '';
        throw new Error(message ? `workspace sync failed: ${message}` : `workspace sync returned ${response.status}`);
      }
      const syncBody = await response.json().catch(() => null);
      const remoteWorkspaces = parseWorkspaceSyncResponse(syncBody);
      const remoteRejections = parseWorkspaceSyncRejected(syncBody);
      notifyRejectedWorkspaces(remoteRejections);
      const missingKeys = new Set(remoteRejections.map((item) => normalizeWorkspacePath(item.path)));
      const localWorkspaces = workspacesRef.current;
      const localActiveWorkspaces = localWorkspaces.filter((workspace) =>
        !workspace.backendConnectionId || workspace.backendConnectionId === activeBackendConnectionId,
      );
      const otherWorkspaces = localWorkspaces.filter((workspace) =>
        Boolean(workspace.backendConnectionId) && workspace.backendConnectionId !== activeBackendConnectionId,
      );
      const scopedTombstones = workspaceTombstonesRef.current.filter((item) =>
        !item.backendConnectionId || item.backendConnectionId === activeBackendConnectionId,
      );
      const taggedRemoteWorkspaces = remoteWorkspaces.map((workspace) => ({
        ...workspace,
        backendConnectionId: activeBackendConnectionId || null,
      }));
      // Tombstoned deletions must not be merged back. While the backend still
      // stores such a record, re-issue the DELETE with the remote id so it is
      // cleaned up even if the original delete never reached the server.
      const keptRemoteWorkspaces = taggedRemoteWorkspaces.filter((workspace) =>
        !scopedTombstones.some((item) => workspaceMatchesTombstone(workspace, item)),
      );
      for (const remote of taggedRemoteWorkspaces) {
        if (keptRemoteWorkspaces.includes(remote)) {
          continue;
        }
        void backendFetch(settings, {
          method: 'DELETE',
          path: `/v2/workspaces/${encodeURIComponent(remote.id)}`,
        }).catch(() => {});
      }
      // Prune tombstones once the backend no longer stores a matching record.
      if (workspaceTombstonesRef.current.length > 0) {
        const surviving = workspaceTombstonesRef.current.filter((item) => {
          const inScope = !item.backendConnectionId || item.backendConnectionId === activeBackendConnectionId;
          if (!inScope) {
            return true;
          }
          return remoteWorkspaces.some((remote) => workspaceMatchesTombstone(remote, item));
        });
        if (surviving.length !== workspaceTombstonesRef.current.length) {
          workspaceTombstonesRef.current = surviving;
          setWorkspaceTombstones(surviving);
        }
      }
      const nextActiveWorkspaces = remoteWorkspaces.length > 0
        ? mergeWorkspaceRecords(localActiveWorkspaces, keptRemoteWorkspaces).map((workspace) => ({
            ...workspace,
            threadId: '',
            localAdapterState:
              localActiveWorkspaces.find((item) => item.id === workspace.id || item.path === workspace.path)?.localAdapterState ??
              workspace.localAdapterState ??
              'idle',
          }))
        : localActiveWorkspaces;
      const nextWorkspaces = [...otherWorkspaces, ...nextActiveWorkspaces.map((workspace) => flagWorkspaceMissing(workspace, missingKeys))]
        .sort((left, right) => right.updatedAt - left.updatedAt);

      if (nextWorkspaces.length > 0) {
        const remappedConversations = remapWorkspaceScopedRecords(
          conversationsRef.current,
          localActiveWorkspaces,
          nextActiveWorkspaces,
        );
        const nextConversations = conversationsForWorkspaceSnapshot(nextWorkspaces, remappedConversations);
        const remappedActive = remapWorkspaceScopedRecords(
          [{ workspaceId: activeWorkspaceRef.current }],
          localActiveWorkspaces,
          nextActiveWorkspaces,
        )[0]?.workspaceId ?? activeWorkspaceRef.current;
        workspaceBackendSkipNextSaveRef.current = true;
        setWorkspaces(nextWorkspaces);
        setConversations(nextConversations);
        setTimeline((current) => remapWorkspaceScopedRecords(current, localActiveWorkspaces, nextActiveWorkspaces));
        setMentionHistory((current) => remapWorkspaceScopedRecords(current, localActiveWorkspaces, nextActiveWorkspaces));
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

      workspaceBackendReadyRef.current = true;
      if (listConversations) {
        try {
          const conversationResponse = await backendApi(settings).listConversations();
          setV2Conversations(conversationResponse.conversations);
          setConversations((current) => mergeManifestConversations(current, withDecryptedTitles(activeBackendConnectionId, conversationResponse.conversations), nextWorkspaces, activeBackendConnectionId));
        } catch (error) {
          setLastError(error instanceof Error ? error.message : t('sess.conversationDirSyncFailed'));
        }
      }
      if (!workspaceSyncPayloadEquals(keptRemoteWorkspaces, nextActiveWorkspaces)) {
        void syncWorkspacesToBackend(nextActiveWorkspaces);
      }
      return true;
    } catch (error) {
      workspaceBackendReadyRef.current = true;
      setLastError(error instanceof Error ? error.message : t('sess.workspaceSyncFailed'));
      return false;
    }
  }, [activeBackendConnectionId, flagWorkspaceMissing, notifyRejectedWorkspaces, settings, syncWorkspacesToBackend]);

  useEffect(() => {
    if (!hydrated || connectionState !== 'open') {
      if (connectionState !== 'open') configureKanbanSync(null);
      return;
    }
    configureKanbanSync({
      serverUrl: settings.serverUrl,
      deviceSecret: settings.deviceSecret,
      encryptionProtocol: settings.encryptionProtocol,
      encryptionPublicKey: settings.encryptionPublicKey,
      backendConnectionId: activeBackendConnectionId,
    });
    const timer = setInterval(() => {
      void syncWorkspacesFromBackend({ listConversations: false });
      void syncKanbanTasksFromBackend();
    }, 15000);
    return () => clearInterval(timer);
  }, [activeBackendConnectionId, connectionState, hydrated, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.serverUrl, syncWorkspacesFromBackend]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    scheduleJsonSave(WORKSPACES_STORAGE_KEY, workspaces);
    if (workspaceBackendSkipNextSaveRef.current) {
      workspaceBackendSkipNextSaveRef.current = false;
      return;
    }
    if (connectionState === 'open' && workspaceBackendReadyRef.current) {
      scheduleWorkspaceBackendSave(workspaces);
    }
  }, [connectionState, hydrated, scheduleJsonSave, scheduleWorkspaceBackendSave, workspaces]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    scheduleJsonSave(CONVERSATIONS_STORAGE_KEY, conversations);
  }, [conversations, hydrated, scheduleJsonSave]);

  // v2 history lives in the backend journal and pages in lazily, so only
  // local-only entries are persisted; unchanged snapshots skip the write.
  const persistedTimelineRef = useRef<TimelineEntry[]>([]);
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const v2ConversationIds = new Set(conversationsRef.current.filter(isV2Conversation).map((item) => item.id));
    const local = timeline
      .filter((entry) => !entry.conversationId || !v2ConversationIds.has(entry.conversationId))
      .slice(0, MAX_TIMELINE_ITEMS);
    const previous = persistedTimelineRef.current;
    if (local.length === previous.length && local.every((entry, index) => entry === previous[index])) return;
    persistedTimelineRef.current = local;
    scheduleJsonSave(TIMELINE_STORAGE_KEY, local);
  }, [hydrated, scheduleJsonSave, timeline]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    scheduleJsonSave(USAGE_RECORDS_STORAGE_KEY, usageRecords.slice(0, MAX_USAGE_RECORDS));
  }, [hydrated, scheduleJsonSave, usageRecords]);

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
    void saveJson(ACTIVE_SELECTION_STORAGE_KEY, {
      workspaceId: activeWorkspaceId,
      conversationId: activeConversationId,
    });
  }, [activeConversationId, activeWorkspaceId, hydrated]);

  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  const refreshCapabilityCatalog = useCallback(async (provider: ProviderKind) => {
    const workspacePath = activeWorkspace?.path || settings.defaultWorkspacePath;
    if (!workspacePath) return;
    setCapabilityCatalogs((current) => ({ ...current, [provider]: { ...(current[provider] ?? {}), status: 'loading', error: undefined } }));
    const api = backendApi(settings);
    try {
      const [skills, mcp] = await Promise.all([
        discoveryLimit(() => api.listSkillCatalog(provider, workspacePath)),
        discoveryLimit(() => api.listMcpCatalog(provider, workspacePath)),
      ]);
      setCapabilityCatalogs((current) => ({ ...current, [provider]: { status: 'ready', skills, mcp } }));
    } catch (error) {
      setCapabilityCatalogs((current) => ({
        ...current,
        [provider]: { ...(current[provider] ?? {}), status: 'error', error: error instanceof Error ? error.message : t('sess.catalogReadFailed') },
      }));
    }
  }, [activeWorkspace?.path, settings.deviceSecret, settings.defaultWorkspacePath, settings.encryptionProtocol, settings.encryptionPublicKey, settings.serverUrl]);

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
      const conversation = conversationsRef.current.find((item) => item.id === activeConversationRef.current);
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
  }, [activeBackendConnectionId, activeWorkspace?.path, connectionEpoch, hydrated, rememberProviderModelSelection, resolveRememberedProviderSelection, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.serverUrl, v2Providers]);

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
  }, [activeBackendConnectionId, activeWorkspace?.path, connectionEpoch, hydrated, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.serverUrl, v2Providers]);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  useEffect(() => {
    if (!hydrated || !activeConversation || !activeWorkspace?.path) return;
    const descriptor = v2Providers.find((item) => item.id === activeConversation.provider);
    if (descriptor?.capabilities.imageInputMode !== 'profile') return;
    const conversationId = activeConversation.id;
    let cancelled = false;
    setProviderImageInput((current) => ({
      ...current,
      [conversationId]: { status: 'loading' },
    }));
    const api = backendApi(settings);
    void api.getProviderImageInput(
      descriptor.id,
      activeWorkspace.path,
      activeConversation.providerProfile,
      activeConversation.model,
    ).then((result) => {
      if (cancelled) return;
      setProviderImageInput((current) => ({
        ...current,
        [conversationId]: {
          status: 'ready',
          imageInput: result.imageInput,
          reason: result.reason,
        },
      }));
    }).catch((error) => {
      if (cancelled) return;
      setProviderImageInput((current) => ({
        ...current,
        [conversationId]: {
          status: 'error',
          reason: error instanceof Error ? error.message : t('image.profileUnconfirmed'),
        },
      }));
    });
    return () => { cancelled = true; };
  }, [activeConversation, activeWorkspace?.path, hydrated, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.serverUrl, v2Providers]);

  const restorePendingSubmission = useCallback((conversationId: string) => {
    const submission = pendingV2SubmissionsRef.current.get(conversationId);
    if (!submission) return;
    setConversationChatDraft(conversationId, (current) => current || submission.text);
    setConversationAttachments(conversationId, (current) => current.length ? current : submission.attachments);
    setConversationSelectedSkills(conversationId, (current) => current.length ? current : submission.skills);
  }, [setConversationChatDraft, setConversationAttachments, setConversationSelectedSkills]);

  runtimeUpdateRef.current = (state, appliedEvents, recovering, live) => {
    const conversation = conversationsRef.current.find((item) => item.v2ConversationId === state.conversationId || item.id === state.conversationId);
    if (!conversation) return;
    const localId = conversation.id;
    setConversationRuntimeById((current) => ({ ...current, [localId]: state }));
    if (state.pendingControl) {
      controlRequestsRef.current.set(localId, state.pendingControl.requestId);
      setControlStatusByConversation(current => ({ ...current, [localId]: state.pendingControl!.status }));
    } else if (!state.activeTurnId) {
      controlRequestsRef.current.delete(localId);
      setControlStatusByConversation(current => ({ ...current, [localId]: undefined }));
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
    projectedRuntimeListsRef.current.set(localId, { subagents: state.subagents, usageRecords: state.usageRecords });
    if (projected?.subagents !== state.subagents) {
      setSubagentsByConversation((current) => ({ ...current, [localId]: state.subagents.map((run) => ({ ...run, conversationId: localId })) }));
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
      if (type === 'control.completed' || type === 'control.rejected') {
        const id = typeof data.requestId === 'string' ? data.requestId : '';
        const draft = controlDraftsRef.current.get(id);
        if (draft && type === 'control.completed') {
          setConversationChatDraft(draft.conversationId, current => current.trim() === draft.text.trim() ? '' : current);
        }
        controlDraftsRef.current.delete(id);
      }
      if (type === 'control.unknown' && data.requestId === controlRequestsRef.current.get(localId)) {
        setControlStatusByConversation(current => ({ ...current, [localId]: 'unknown' }));
      }
      if ((type === 'control.completed' || type === 'control.rejected')
        && data.requestId === controlRequestsRef.current.get(localId)) {
        controlRequestsRef.current.delete(localId);
        setControlStatusByConversation(current => ({ ...current, [localId]: undefined }));
        if (type === 'control.rejected') setLastError(typeof data.message === 'string' ? data.message : t('sess.agentControlRejected'));
      }
      if (['turn.completed', 'turn.cancelled', 'turn.failed', 'turn.interrupted'].includes(type)) {
        // A realtime frame is news even when it lands inside a history replay.
        const replayed = recovering && !live.has(event.sequence);
        completedAt = Math.max(completedAt, Date.parse(event.time) || Date.now());
        const settledKey = turnId ? `${state.conversationId}:${turnId}` : '';
        const firstSettle = Boolean(settledKey) && !settledV2TurnsRef.current.has(settledKey);
        if (turnId) {
          settledV2TurnsRef.current.set(settledKey, type);
          if (settledV2TurnsRef.current.size > 2000) settledV2TurnsRef.current.delete(settledV2TurnsRef.current.keys().next().value!);
        }
        if (type === 'turn.completed' && firstSettle && !replayed) {
          notifyTurnCompletedRef.current(localId, state, turnId);
        }
        // Claude Code reports its five-hour window as provider_unavailable with
        // "session limit · resets <time> (<tz>)". Recording the reset arms the
        // wait: sends join the candidate queue until it passes, and the failed
        // prompt is re-queued at the head so everything replays in order. A
        // backend with its own queue inserts that continuation itself — for
        // every client and with no window open — so it is not queued here.
        // Replayed journal entries are skipped — their wall-time report would
        // resolve against now, while the persisted wait already holds the
        // instant computed when the failure was live.
        const rateLimited = !replayed && type === 'turn.failed' && typeof data.message === 'string'
          ? parseSessionLimitReset(data.message) : null;
        if (type === 'turn.completed') setConversationRateLimit(localId, null);
        if (rateLimited) {
          setConversationRateLimit(localId, rateLimited);
          setLastError(t('sess.sessionLimitReached', { reset: rateLimited.label }));
        }
        if (submission && turnId && submission.turnId === turnId) {
          if (type === 'turn.completed') removeQueuedFollowUp(localId, submission.requestId);
          const backendContinues = Boolean(rateLimited)
            && hasBackendQueue(v2ProvidersRef.current, conversationsRef.current.find((item) => item.id === localId));
          if (type === 'turn.failed' && !backendContinues) {
            const queued = queuedChatDraftsRef.current[localId] ?? [];
            if (rateLimited && queued.length < 32) {
              queuedChatDraftsRef.current = { ...queuedChatDraftsRef.current,
                [localId]: [{ id: createRequestId('queued'), text: rateLimitContinuationText(submission.text),
                  attachments: submission.attachments, skills: submission.skills, front: true }, ...queued] };
              setQueuedChatDrafts(queuedChatDraftsRef.current);
            } else {
              restorePendingSubmission(localId);
              if (!rateLimited) setLastError(typeof data.message === 'string' ? data.message : t('sess.taskExecFailed'));
            }
          }
          pendingV2SubmissionsRef.current.delete(localId);
          setSubmissionStatusByConversation((current) => ({ ...current, [localId]: undefined }));
        }
        if (turnId) {
          queueMicrotask(() => {
            void followUpsRef.current.settle(localId, turnId, type, replayed,
              () => queuedChatDraftsRef.current[localId]?.[0],
              (item) => sendQueuedChatDraftRef.current(item, localId),
              (itemId) => removeQueuedFollowUp(localId, itemId)).then(() => {
                setQueuePausedByConversation(current => ({ ...current, [localId]: followUpsRef.current.isPaused(localId) }));
              });
          });
        }
      }
    }
    setConversationTurnId(localId, state.activeTurnId);
    const pending = pendingV2SubmissionsRef.current.get(localId);
    setConversationThinking(localId, Boolean(state.activeTurnId) || pending?.phase === 'sending');
    setConversations((current) => {
      const index = current.findIndex((item) => item.id === localId);
      if (index < 0) return current;
      const lastSequence = Math.max(current[index].lastSequence ?? 0, state.appliedSequence);
      const lastCompletedAt = Math.max(current[index].lastCompletedAt ?? 0, completedAt);
      if (lastSequence === current[index].lastSequence && lastCompletedAt === current[index].lastCompletedAt) return current;
      const next = [...current];
      next[index] = { ...next[index], lastSequence, lastCompletedAt };
      return next;
    });
  };

  /** Open a conversation lazily: only the newest history window is fetched
   * from the journal tail; earlier events page in on scroll. Falls back to a
   * full forward replay when the runtime is already initialized. */
  const openConversation = useCallback(async (conversationId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId || item.v2ConversationId === conversationId);
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
    const conversation = conversationsRef.current.find((item) => item.id === conversationId || item.v2ConversationId === conversationId);
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
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
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
      const v2Id = conversationsRef.current.find((item) => item.id === conversationId)?.v2ConversationId;
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
    // A queued dispatch keeps its queue entry; only composer submissions are
    // handed back as drafts.
    const stillQueued = (queuedChatDraftsRef.current[conversationId] ?? []).some((item) => item.id === submission.requestId);
    if (!stillQueued) restorePendingSubmission(conversationId);
    pendingV2SubmissionsRef.current.delete(conversationId);
    updateSentAttachmentRecords(sentAttachmentRecordsRef.current.filter((record) =>
      record.conversationId !== conversationId || record.requestId !== submission.requestId || Boolean(record.eventId)));
    setSubmissionStatusByConversation((current) => ({ ...current, [conversationId]: undefined }));
    setConversationThinking(conversationId, false);
    if ((queuedChatDraftsRef.current[conversationId] ?? []).length > 0) {
      followUpsRef.current.pause(conversationId);
      setQueuePausedByConversation((current) => ({ ...current, [conversationId]: true }));
    }
    setLastError(t(stillQueued ? 'sess.sendRestoredQueue' : 'sess.sendRestoredDraft'));
  }, [recoverConversation, restorePendingSubmission, setConversationThinking, updateSentAttachmentRecords, setLastError]);

  // Runtime caches are only invalid when the active profile itself is
  // re-pointed or re-paired. Switching to another profile keeps every
  // backend's conversation state, so the other workspaces do not reload.
  const runtimeEndpointRef = useRef<{ backendId: string; serverUrl: string; deviceSecret: string } | null>(null);
  useEffect(() => {
    const previous = runtimeEndpointRef.current;
    runtimeEndpointRef.current = { backendId: activeBackendConnectionId, serverUrl: settings.serverUrl, deviceSecret: settings.deviceSecret };
    // Queued commands were addressed to the previous endpoint and must not
    // flush onto the next socket.
    protocolCommandsRef.current?.dispose();
    if (previous && previous.backendId !== activeBackendConnectionId) return;
    conversationEventBatcherRef.current?.discard();
    conversationRecoveryRef.current?.reset();
    legacyRecoveryRef.current = new LegacyEventRecovery<ServerEvent>();
    setConversationRuntimeById({});
    setRecoveringConversations({});
    setOpenStatusByConversation({});
    setEarlierHistory({});
    projectedRuntimeListsRef.current.clear();
    settledV2TurnsRef.current.clear();
  }, [activeBackendConnectionId, settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey]);

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
  }, [activeConversation?.id, activeConversation?.v2ConversationId, hydrated, openConversation, settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey]);

  // Only recently viewed conversations keep their projected history in
  // memory. Older ones, and runtimes live frames created for conversations
  // never opened here, are released and reopen lazily from the journal tail;
  // busy conversations (running, awaiting approval, queued or unconfirmed
  // prompts, loading) are always kept.
  const recentConversationIdsRef = useRef<string[]>([]);
  const releaseIdleConversationRuntimes = useCallback(() => {
    const recovery = conversationRecoveryRef.current;
    if (!recovery) return;
    const localIdFor = (v2Id: string) => conversationsRef.current.find((item) => item.v2ConversationId === v2Id || item.id === v2Id)?.id;
    const busy = (localId: string, state: ConversationRuntime | undefined) =>
      Boolean(state && isConversationRuntimeBusy(state)) || conversationHasPendingWork(localId);
    const recent = recentConversationIdsRef.current;
    const kept: string[] = [];
    const released: string[] = [];
    for (const [index, localId] of recent.entries()) {
      const v2Id = conversationsRef.current.find((item) => item.id === localId)?.v2ConversationId;
      const state = v2Id ? recovery.get(v2Id) : undefined;
      if (index < RETAINED_CONVERSATION_RUNTIMES || busy(localId, state)) kept.push(localId);
      else if (!v2Id || !state) continue; // nothing loaded to release
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
    setTimeline((current) => current.some((entry) => entry.conversationId && releasedIds.has(entry.conversationId))
      ? current.filter((entry) => !entry.conversationId || !releasedIds.has(entry.conversationId)) : current);
  }, []);
  useEffect(() => {
    if (!activeConversationId) return;
    recentConversationIdsRef.current = [activeConversationId, ...recentConversationIdsRef.current.filter((id) => id !== activeConversationId)];
    releaseIdleConversationRuntimes();
  }, [activeConversationId, releaseIdleConversationRuntimes]);
  // Background conversations settle without a switch; each manifest refresh
  // releases the ones that went idle.
  useEffect(() => {
    releaseIdleConversationRuntimes();
  }, [releaseIdleConversationRuntimes, v2Conversations]);

  const runtimeStatus = useMemo<RuntimeStatusState>(() => ({
    socket: connectionState,
    daemon: connectionHealth.status,
    codexAdapter: activeConversation?.localAdapterState ?? activeWorkspace?.localAdapterState ?? 'unknown',
    turn: activeTurnId ? 'running' : 'idle',
  }), [activeConversation?.localAdapterState, activeTurnId, activeWorkspace?.localAdapterState, connectionHealth.status, connectionState]);

  const getConversationContext = useCallback((conversationId = activeConversationRef.current): ConversationContext | null => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
    const workspace = conversation
      ? workspacesRef.current.find((item) => item.id === conversation.workspaceId) ?? null
      : null;
    return workspace && conversation ? { workspace, conversation } : null;
  }, []);

  const pendingRequests = useMemo<PendingRequest[]>(() => {
    const open = new Map<string, PendingRequest>();
    const resolved = new Set<string>();

    for (const event of events) {
      if (event.type === 'conversation.permission.request') continue;
      if (event.type === 'codex.serverRequest.resolved' || event.type === 'permission.resolved') {
        const data = eventPayloadData(event);
        const resolvedId = data.requestId ?? data.request_id ?? data.permissionId;
        if (typeof resolvedId === 'string' && resolvedId) {
          resolved.add(resolvedId);
        }
      }

      const request = classifyPendingRequest(event);
      if (request) {
        open.set(request.requestId, request);
      }
    }

    for (const [localId, state] of Object.entries(conversationRuntimeById)) {
      if (recoveringConversations[localId] || state.appliedSequence < state.highWaterSequence) continue;
      const conversation = conversations.find((item) => item.id === localId);
      for (const permission of state.pendingPermissions) {
        const request = classifyPendingRequest({ type: 'conversation.permission.request', payload: {
          ...permission.payload, requestId: permission.id, permissionId: permission.id,
          conversationId: state.conversationId, sessionId: conversation?.sessionId,
        } });
        if (request) open.set(request.requestId, request);
      }
    }
    return [...open.values()].filter((request) => !resolved.has(request.requestId));
  }, [events, conversationRuntimeById, recoveringConversations, conversations]);

  useEffect(() => {
    if (!pendingRequests.length) {
      setSelectedRequestId('');
      return;
    }
    if (!selectedRequestId || !pendingRequests.some((request) => request.requestId === selectedRequestId)) {
      setSelectedRequestId(pendingRequests[0].requestId);
    }
  }, [pendingRequests, selectedRequestId]);

  const selectedRequest = useMemo(
    () => pendingRequests.find((request) => request.requestId === selectedRequestId) ?? pendingRequests[0] ?? null,
    [pendingRequests, selectedRequestId],
  );

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
    const next = workspaceTombstonesRef.current.filter((item) => {
      if (normalizeWorkspacePath(item.path) !== key) {
        return true;
      }
      const scope = item.backendConnectionId ?? null;
      return scope !== null && scope !== backendConnectionId;
    });
    if (next.length !== workspaceTombstonesRef.current.length) {
      workspaceTombstonesRef.current = next;
      setWorkspaceTombstones(next);
    }
  }, []);

  const updateConversation = useCallback((id: string, patch: Partial<ConversationRecord>) => {
    setConversations((current) =>
      current.map((conversation) => {
        if (conversation.id !== id) return conversation;
        // A native adapter leaving the running/starting state counts as a
        // completed or stopped turn for sidebar ordering.
        const finished = (conversation.localAdapterState === 'running' || conversation.localAdapterState === 'starting')
          && (patch.localAdapterState === 'idle' || patch.localAdapterState === 'stopped' || patch.localAdapterState === 'error');
        return { ...conversation, ...patch, updatedAt: Date.now(), ...(finished ? { lastCompletedAt: Date.now() } : null) };
      }),
    );
  }, []);

  // Read marking goes through a dedicated path: bumping updatedAt or
  // lastCompletedAt would disturb sidebar ordering and turn bookkeeping.
  const markConversationRead = useCallback((conversationId: string) => {
    setConversations((current) => {
      const index = current.findIndex((item) => item.id === conversationId);
      if (index < 0) return current;
      const readAt = Date.now();
      if ((current[index].lastReadAt ?? 0) >= readAt) return current;
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
  // the unread marker. Activity that lands while hidden stays unread.
  useEffect(() => {
    const markActiveRead = () => {
      if (!activeConversationId) return;
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      markConversationRead(activeConversationId);
    };
    markActiveRead();
    window.addEventListener('focus', markActiveRead);
    document.addEventListener('visibilitychange', markActiveRead);
    return () => {
      window.removeEventListener('focus', markActiveRead);
      document.removeEventListener('visibilitychange', markActiveRead);
    };
  }, [activeConversationId, timeline, turnIds, markConversationRead]);

  const upsertNativeThreads = useCallback((workspaceId: string, sessionId: string, threads: CodexNativeThread[]) => {
    if (!threads.length) {
      return;
    }
    setConversations((current) => {
      const next = [...current];
      for (const thread of threads) {
        const threadId = normalizeThreadId(thread.id);
        if (!threadId) {
          continue;
        }
        const existingIndex = next.findIndex(
          (conversation) =>
            conversation.workspaceId === workspaceId &&
            normalizeThreadId(conversation.threadId) === threadId,
        );
        const patch = conversationPatchFromNativeThread(thread);
        if (existingIndex >= 0) {
          next[existingIndex] = {
            ...next[existingIndex],
            ...patch,
            createdAt: next[existingIndex].createdAt,
            updatedAt: Math.max(next[existingIndex].updatedAt, patch.updatedAt ?? 0),
            sessionId: next[existingIndex].sessionId || sessionId,
          };
          continue;
        }
        next.push({
          id: createRequestId('thread'),
          workspaceId,
          title: patch.title || threadId,
          preview: patch.preview || '',
          nativeStatus: patch.nativeStatus || '',
          archived: patch.archived === true,
          sessionId: createSessionId(`${patch.title || threadId}_thread`),
          threadId,
          localAdapterState: 'idle',
          mode: 'implement',
          goalStatus: '',
          goalObjective: '',
          createdAt: patch.createdAt || Date.now(),
          updatedAt: patch.updatedAt || Date.now(),
        });
      }
      return next.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, []);

  const resetWorkspaceSession = useCallback(
    (workspace: WorkspaceRecord) => {
      updateWorkspace(workspace.id, {
        sessionId: createSessionId(workspace.name),
        localAdapterState: 'idle',
      });
    },
    [updateWorkspace],
  );

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

  const resolveTimelineTarget = useCallback((event: ServerEvent, data = eventPayloadData(event)) => {
    const sessionId = sessionIdFromEvent(event, data);
    const threadId = threadIdFromEventData(event, data);
    const conversations = conversationsRef.current;
    const byThread = threadId
      ? conversations.find((conversation) => normalizeThreadId(conversation.threadId) === threadId)
      : null;
    const bySession = sessionId ? conversations.find((conversation) => conversation.sessionId === sessionId) : null;
    if (sessionId && !bySession) {
      return {
        workspaceId: '',
        conversationId: '',
        conversation: null,
        sessionId,
        threadId,
      };
    }
    const conversation = bySession ?? byThread ?? conversations.find((item) => item.id === activeConversationRef.current) ?? null;

    return {
      workspaceId: conversation?.workspaceId ?? activeWorkspaceRef.current,
      conversationId: conversation?.id ?? activeConversationRef.current,
      conversation,
      sessionId,
      threadId,
    };
  }, []);

  const upsertChatTimeline = useCallback((entry: TimelineEntry, appendSubtitle = false) => {
    setTimeline((current) => {
      const index = current.findIndex(
        (item) =>
          item.id === entry.id &&
          item.workspaceId === entry.workspaceId &&
          item.conversationId === entry.conversationId,
      );

      if (index === -1) {
        return capTimelinePerConversation([entry, ...current]);
      }

      const next = current.slice();
      const previous = next[index];
      next[index] = {
        ...previous,
        ...entry,
        subtitle: appendSubtitle ? `${previous.subtitle === STREAMING_REPLY_PLACEHOLDER ? '' : previous.subtitle}${entry.subtitle}` : entry.subtitle,
        at: Date.now(),
      };
      return next;
    });
  }, []);

  const settlePendingThreadStart = useCallback(
    (pending: PendingThreadStart, threadId: string, errorMessage = '') => {
      clearTimeout(pending.timeoutId);
      pendingThreadStartsRef.current.delete(pending.conversationId);

      if (errorMessage || !threadId) {
        const error = new Error(errorMessage || t('sess.threadCreateFailed'));
        pending.reject(error);
        setLastError(error.message);
        return;
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === pending.conversationId ? { ...conversation, threadId, updatedAt: Date.now() } : conversation,
        ),
      );
      pending.resolve(threadId);
    },
    [],
  );

  const finishPendingThreadList = useCallback((pending: PendingThreadList, errorMessage = '') => {
    clearTimeout(pending.timeoutId);
    pendingThreadListsRef.current.delete(pending.workspaceId);
    setThreadListStatusByWorkspace((current) => ({
      ...current,
      [pending.workspaceId]: errorMessage ? 'error' : 'ready',
    }));
    setThreadListErrorByWorkspace((current) => ({
      ...current,
      [pending.workspaceId]: errorMessage,
    }));
    if (errorMessage) {
      setLastError(errorMessage);
    }
  }, []);

  const finishPendingGitDiff = useCallback((pending: PendingGitDiff, errorMessage = '') => {
    clearTimeout(pending.timeoutId);
    pendingGitDiffsRef.current.delete(pending.requestId);
    if (!errorMessage) {
      setLastError('');
      return;
    }
    setGitDiffByConversation((current) => ({
      ...current,
      [pending.conversationId]: {
        ...(current[pending.conversationId] ?? {
          status: 'idle',
          diff: '',
          sha: '',
          error: '',
          updatedAt: 0,
        }),
        status: 'error',
        error: errorMessage,
        updatedAt: Date.now(),
      },
    }));
    setLastError(errorMessage);
  }, []);

  const finishPendingSkillList = useCallback((pending: PendingSkillList, errorMessage = '') => {
    clearTimeout(pending.timeoutId);
    pendingSkillListsRef.current.delete(pending.requestId);
    if (!errorMessage) {
      setLastError('');
      return;
    }
    setSkillListStatus('error');
    setSkillListError(errorMessage);
    setLastError(errorMessage);
  }, []);

  const finishPendingThreadAction = useCallback((pending: PendingThreadAction, errorMessage = '') => {
    clearTimeout(pending.timeoutId);
    pendingThreadActionsRef.current.delete(pending.requestId);
    if (errorMessage) {
      if (pending.action === 'fork' && pending.sourceConversationId && pending.conversationId !== pending.sourceConversationId) {
        setConversations((current) => current.filter((conversation) => conversation.id !== pending.conversationId));
      }
      if (pending.action === 'mcp') {
        setMcpInventoryByConversation((current) => ({
          ...current,
          [pending.conversationId]: {
            ...(current[pending.conversationId] ?? {
              status: 'idle',
              detail: 'toolsAndAuthOnly',
              servers: [],
              raw: null,
              error: '',
              updatedAt: 0,
            }),
            status: 'error',
            error: errorMessage,
            updatedAt: Date.now(),
          },
        }));
      } else if (pending.action === 'permissionProfiles') {
        setPermissionProfilesByConversation((current) => ({
          ...current,
          [pending.conversationId]: {
            ...(current[pending.conversationId] ?? {
              status: 'idle',
              profiles: [],
              raw: null,
              error: '',
              updatedAt: 0,
            }),
            status: 'error',
            error: errorMessage,
            updatedAt: Date.now(),
          },
        }));
      } else if (pending.action === 'hooks') {
        setHooksCatalogByConversation((current) => ({
          ...current,
          [pending.conversationId]: {
            ...(current[pending.conversationId] ?? {
              status: 'idle',
              entries: [],
              raw: null,
              error: '',
              updatedAt: 0,
            }),
            status: 'error',
            error: errorMessage,
            updatedAt: Date.now(),
          },
        }));
      } else if (pending.action === 'plugins') {
        setPluginsCatalogByConversation((current) => ({
          ...current,
          [pending.conversationId]: {
            ...(current[pending.conversationId] ?? {
              status: 'idle',
              catalog: { marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] },
              raw: null,
              error: '',
              updatedAt: 0,
            }),
            status: 'error',
            error: errorMessage,
            updatedAt: Date.now(),
          },
        }));
      } else if (pending.action === 'memorySettings') {
        setMemorySettingsByConversation((current) => ({
          ...current,
          [pending.conversationId]: {
            ...(current[pending.conversationId] ?? {
              status: 'idle',
              settings: { useMemories: false, generateMemories: false },
              raw: null,
              error: '',
              updatedAt: 0,
            }),
            status: 'error',
            error: errorMessage,
            updatedAt: Date.now(),
          },
        }));
      }
      setLastError(errorMessage);
      return;
    }
    setLastError('');
  }, []);

  const findPendingLocalStart = useCallback((event: ServerEvent, data: Record<string, unknown>) => {
    const pendingStarts = [...pendingLocalStartsRef.current.values()];
    const requestId = data.requestId ?? data.request_id;
    if (typeof requestId === 'string' && requestId) {
      const byRequestId = pendingStarts.find((item) => item.requestId === requestId);
      if (byRequestId) {
        return byRequestId;
      }
    }

    const sessionId =
      data.codexSessionId ??
      data.codex_session_id ??
      data.sessionId ??
      data.session_id ??
      event.codex_session_id;
    if (typeof sessionId === 'string' && sessionId) {
      return pendingStarts.find((item) => item.sessionId === sessionId) ?? null;
    }

    return pendingStarts.length === 1 ? pendingStarts[0] : null;
  }, []);

  const settlePendingLocalStart = useCallback(
    (pending: PendingLocalStart, errorMessage = '') => {
      clearTimeout(pending.timeoutId);
      pendingLocalStartsRef.current.delete(pending.conversationId);

      if (isLocalAdapterAlreadyRunning(errorMessage)) {
        updateConversation(pending.conversationId, { localAdapterState: 'running' });
        setLastError('');
        pending.resolve();
        return;
      }

      if (errorMessage) {
        updateConversation(pending.conversationId, { localAdapterState: 'error' });
        const error = new Error(localTurnErrorMessage(errorMessage));
        pending.reject(error);
        setLastError(error.message);
        appendTimeline({ ...makeSystemEntry(t('sess.localStartFailed'), error.message, activeWorkspaceRef.current, activeConversationRef.current), marker: 'error' });
        return;
      }

      updateConversation(pending.conversationId, { localAdapterState: 'running' });
      pending.resolve();
    },
    [appendTimeline, updateConversation],
  );

  const appendTerminalOutput = useCallback((terminalId: string, entry: TerminalOutputEntry) => {
    setTerminalById((current) => {
      const existing = current[terminalId];
      if (!existing) {
        return current;
      }
      return evictIdleTerminalStates({
        ...current,
        [terminalId]: {
          ...existing,
          output: capTerminalOutput([...existing.output, entry]),
          updatedAt: Date.now(),
        },
      });
    });
  }, []);

  const handleTerminalEvent = useCallback((event: ServerEvent, data: Record<string, unknown>) => {
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

    if (event.type === 'terminal.status') {
      const terminals = Array.isArray(data.terminals) ? data.terminals : [];
      setTerminalById((current) => {
        let next = current;
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
    const conversation = conversationsRef.current.find((item) => terminalIdForConversation(item.id) === terminalId);
    const conversationId = conversation?.id ?? activeConversationRef.current;

    setTerminalById((current) => {
      const existing = current[terminalId];
      const base: TerminalClientState = existing ?? {
        terminalId,
        workspaceId: workspaceId || conversation?.workspaceId || activeWorkspaceRef.current,
        conversationId,
        tenantId: tenantId || settings.tenantId,
        cwd: cwd || (conversation
          ? workspacesRef.current.find((workspace) => workspace.id === conversation.workspaceId)?.path ?? ''
          : ''),
        shell,
        rows: DEFAULT_TERMINAL_ROWS,
        cols: DEFAULT_TERMINAL_COLS,
        status: 'idle',
        output: [],
        error: '',
        pid: null,
        exitCode: null,
        updatedAt: Date.now(),
      };
      let status: TerminalLifecycleState = base.status;
      let error = base.error;
      let output = base.output;
      let exitCode = base.exitCode;
      let stopRequested = base.stopRequested ?? false;
      let sshHost = base.ssh?.host;

      if (event.type === 'terminal.started') {
        status = 'running';
        const startedSsh = data.ssh && typeof data.ssh === 'object' ? (data.ssh as Record<string, unknown>).host : undefined;
        if (typeof startedSsh === 'string' && startedSsh) sshHost = startedSsh;
        error = '';
        stopRequested = false;
        output = capTerminalOutput([
          ...output,
          terminalOutputLine('system', sshHost ? `ssh connected: ${sshHost}` : `terminal started: ${cwd || base.cwd}`),
        ]);
      } else if (event.type === 'terminal.stopping') {
        status = 'stopping';
        stopRequested = true;
        output = capTerminalOutput([
          ...output,
          terminalOutputLine('system', 'terminal stopping'),
        ]);
      } else if (event.type === 'terminal.exited') {
        status = 'exited';
        exitCode = typeof data.exitCode === 'number' ? data.exitCode : null;
        // Same as the mobile client: an exit only suppresses the auto-restart
        // when it was requested — either the backend flagged the payload or we
        // had already observed the terminal.stopping lifecycle state.
        stopRequested = stopRequested || base.status === 'stopping' || data.stoppedByRequest === true;
        output = capTerminalOutput([
          ...output,
          terminalOutputLine('system', `terminal exited${exitCode === null ? '' : ` with code ${exitCode}`}`),
        ]);
      } else if (event.type === 'terminal.error') {
        status = 'error';
        error = typeof data.error === 'string' ? data.error : 'terminal error';
        output = capTerminalOutput([
          ...output,
          terminalOutputLine('error', error),
        ]);
      } else if (event.type === 'terminal.resized') {
        output = capTerminalOutput([
          ...output,
          terminalOutputLine('system', `size ${typeof data.cols === 'number' ? data.cols : base.cols}x${typeof data.rows === 'number' ? data.rows : base.rows}`),
        ]);
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
          output,
          error,
          stopRequested,
          updatedAt: Date.now(),
        },
      });
    });

    if (event.type === 'terminal.output') {
      const stream = data.stream === 'stderr' ? 'stderr' : 'stdout';
      const text = typeof data.data === 'string' ? data.data : '';
      if (text) {
        appendTerminalOutput(terminalId, terminalOutputLine(stream, text));
      }
    }
    return true;
  }, [appendTerminalOutput, settings.tenantId]);

  const projectLegacyEvent = useCallback(
    (event: ServerEvent) => {
      const data = eventPayloadData(event);
      const sessionId = sessionIdFromEvent(event, data);
      setEvents((current) => [event, ...current].slice(0, MAX_EVENTS));
      if (handleTerminalEvent(event, data)) {
        return;
      }
      const target = resolveTimelineTarget(event, data);
      const targetConversationId = target.conversationId || target.conversation?.id || (target.sessionId ? '' : activeConversationRef.current);
      const hasTimelineTarget = Boolean(targetConversationId);
      const goalPatch = goalPatchFromEventData(data);
      if (
        target.conversation &&
        goalPatch &&
        (
          /goal/i.test(event.type) ||
          data.method === 'thread/goal/set' ||
          data.method === 'thread/goal/get' ||
          data.method === 'thread/goal/clear'
        )
      ) {
        updateConversation(target.conversation.id, goalPatch);
      }
      const threadPatch = nativeThreadPatchFromNotification(event.type, data);
      const threadPatchId = threadPatch ? threadIdFromEventData(event, data) : '';
      if (threadPatch && threadPatchId) {
        const existing = conversationsRef.current.find((conversation) => normalizeThreadId(conversation.threadId) === threadPatchId);
        if (existing) {
          updateConversation(existing.id, threadPatch);
        }
      }
      const chatEntry = hasTimelineTarget ? classifyChatEvent(event, target.workspaceId, targetConversationId) : null;
      if (chatEntry) {
        upsertChatTimeline(chatEntry, event.type === 'codex.item.agentMessage.delta');
        if (event.type === 'codex.item.completed') {
          setConversationThinking(targetConversationId, false);
        }
      }
      const protocolError = extractProtocolError(event.type, data);
      const pendingLocalStartForError = event.type === 'codex.control.error'
        ? findPendingLocalStart(event, data)
        : null;
      const suppressProgressError =
        Boolean(pendingLocalStartForError) ||
        (protocolError ? isThreadNotMaterializedHistoryError(protocolError) : false);
      const progressEntry = hasTimelineTarget ? classifyProgressEvent(event, target.workspaceId, targetConversationId) : null;
      if (progressEntry && !suppressProgressError) {
        upsertChatTimeline(progressEntry, false);
      }
      if (hasTimelineTarget && event.type === 'codex.control.request.accepted' && data.operation === 'codex.local.turn') {
        setConversationThinking(targetConversationId, true);
      }
      const maybeModelListRequestId = data.requestId ?? data.request_id;
      const pendingModelList = pendingModelListRef.current;
      if (
        pendingModelList &&
        typeof maybeModelListRequestId === 'string' &&
        maybeModelListRequestId === pendingModelList.requestId
      ) {
        if (event.type === 'codex.control.response') {
          const models = parseCodexModelListResponse(data.result ?? data);
          if (models.length) {
            setRemoteModelCatalog(models);
            setModelCatalogStatus('ready');
            setModelCatalogError('');
          } else {
            setModelCatalogStatus('error');
            setModelCatalogError(t('sess.modelListEmpty'));
          }
          clearTimeout(pendingModelList.timeoutId);
          pendingModelListRef.current = null;
        } else if (protocolError || event.type === 'codex.control.error') {
          setModelCatalogStatus('error');
          setModelCatalogError(localTurnErrorMessage(protocolError || t('sess.modelListFailed')));
          clearTimeout(pendingModelList.timeoutId);
          pendingModelListRef.current = null;
        }
      }
      const maybeThreadRequestId = typeof maybeModelListRequestId === 'string' ? maybeModelListRequestId : '';
      const pendingGitDiff = maybeThreadRequestId ? pendingGitDiffsRef.current.get(maybeThreadRequestId) ?? null : null;
      if (pendingGitDiff) {
        if (event.type === 'codex.control.response') {
          const responseValue = data.result ?? data;
          const responseRecord = responseValue && typeof responseValue === 'object' && !Array.isArray(responseValue)
            ? responseValue as Record<string, unknown>
            : {};
          const diff = typeof responseRecord.diff === 'string' ? responseRecord.diff : '';
          const sha = typeof responseRecord.sha === 'string' ? responseRecord.sha : shortJson(responseRecord.sha ?? '');
          setGitDiffByConversation((current) => ({
            ...current,
            [pendingGitDiff.conversationId]: {
              status: 'ready',
              diff,
              sha,
              error: '',
              updatedAt: Date.now(),
            },
          }));
          appendTimeline(makeSystemEntry('Git diff loaded', diff ? `${diff.length} characters` : 'No diff', pendingGitDiff.workspaceId, pendingGitDiff.conversationId));
          finishPendingGitDiff(pendingGitDiff);
        } else if (protocolError || event.type === 'codex.control.error') {
          finishPendingGitDiff(pendingGitDiff, localTurnErrorMessage(protocolError || t('sess.gitDiffFailed')));
        }
      }
      const pendingSkillList = maybeThreadRequestId ? pendingSkillListsRef.current.get(maybeThreadRequestId) ?? null : null;
      if (pendingSkillList) {
        if (event.type === 'codex.control.response') {
          const items = parseSkillListItems(data.result ?? data);
          setSkillListItems(items);
          setSkillListStatus('ready');
          setSkillListError('');
          appendTimeline(makeSystemEntry(
            'Skills loaded',
            items.length ? `${items.length} skills available` : 'No skills returned for this workspace',
            pendingSkillList.workspaceId,
            pendingSkillList.conversationId,
          ));
          finishPendingSkillList(pendingSkillList);
        } else if (protocolError || event.type === 'codex.control.error') {
          finishPendingSkillList(pendingSkillList, localTurnErrorMessage(protocolError || t('sess.skillsListFailed')));
        }
      }
      const pendingThreadList = maybeThreadRequestId
        ? [...pendingThreadListsRef.current.values()].find((item) => item.requestId === maybeThreadRequestId)
        : null;
      if (pendingThreadList) {
        if (event.type === 'codex.control.response') {
          const threads = parseCodexNativeThreadListResponse(data.result ?? data);
          upsertNativeThreads(pendingThreadList.workspaceId, pendingThreadList.sessionId, threads);
          finishPendingThreadList(pendingThreadList);
        } else if (protocolError || event.type === 'codex.control.error') {
          finishPendingThreadList(pendingThreadList, localTurnErrorMessage(protocolError || t('sess.threadListFailed')));
        }
      }
      const pendingThreadAction = maybeThreadRequestId
        ? pendingThreadActionsRef.current.get(maybeThreadRequestId) ?? null
        : null;
      if (pendingThreadAction) {
        if (event.type === 'codex.control.response') {
          const responseValue = data.result ?? data;
          if (pendingThreadAction.action === 'mcp') {
            const servers = parseMcpServerStatusListResponse(responseValue);
            setMcpInventoryByConversation((current) => ({
              ...current,
              [pendingThreadAction.conversationId]: {
                status: 'ready',
                detail: pendingThreadAction.resultDetail === 'full' ? 'full' : 'toolsAndAuthOnly',
                servers,
                raw: responseValue,
                error: '',
                updatedAt: Date.now(),
              },
            }));
          } else if (pendingThreadAction.action === 'permissionProfiles') {
            const profiles = parsePermissionProfileListResponse(responseValue);
            setPermissionProfilesByConversation((current) => ({
              ...current,
              [pendingThreadAction.conversationId]: {
                status: 'ready',
                profiles,
                raw: responseValue,
                error: '',
                updatedAt: Date.now(),
              },
            }));
          } else if (pendingThreadAction.action === 'hooks') {
            const entries = parseHooksListResponse(responseValue);
            setHooksCatalogByConversation((current) => ({
              ...current,
              [pendingThreadAction.conversationId]: {
                status: 'ready',
                entries,
                raw: responseValue,
                error: '',
                updatedAt: Date.now(),
              },
            }));
          } else if (pendingThreadAction.action === 'plugins') {
            const catalog = parsePluginListResponse(responseValue);
            setPluginsCatalogByConversation((current) => ({
              ...current,
              [pendingThreadAction.conversationId]: {
                status: 'ready',
                catalog,
                raw: responseValue,
                error: '',
                updatedAt: Date.now(),
              },
            }));
          } else if (pendingThreadAction.action === 'memorySettings') {
            const settings = pendingThreadAction.memorySettings ?? parseMemorySettingsResponse(responseValue);
            setMemorySettingsByConversation((current) => ({
              ...current,
              [pendingThreadAction.conversationId]: {
                status: 'ready',
                settings,
                raw: responseValue,
                error: '',
                updatedAt: Date.now(),
              },
            }));
          }
          const nativeThread = parseCodexNativeThread(responseValue);
          const nativeThreadRead = pendingThreadAction.restoreHistory
            ? parseCodexNativeThreadReadResponse(responseValue)
            : null;
          const responseThread = resultThreadFromValue(responseValue);
          const displayThread = nativeThread || responseThread;
          if (nativeThread) {
            if (pendingThreadAction.action === 'fork') {
              const source = conversationsRef.current.find((item) => item.id === pendingThreadAction.sourceConversationId);
              const targetConversation = conversationsRef.current.find((item) => item.id === pendingThreadAction.conversationId);
              setConversations((current) =>
                [
                  {
                    ...(source ?? {
                      id: pendingThreadAction.conversationId,
                      workspaceId: pendingThreadAction.workspaceId,
                      title: conversationTitleFromNativeThread(nativeThread),
                      sessionId: sessionIdFromEvent(event, data),
                      threadId: nativeThread.id,
                      localAdapterState: 'idle' as LocalAdapterState,
                      mode: 'implement' as ConversationRecord['mode'],
                      goalStatus: '',
                      goalObjective: '',
                      createdAt: nativeThread.createdAt || Date.now(),
                      updatedAt: nativeThread.updatedAt || Date.now(),
                    }),
                    id: pendingThreadAction.conversationId,
                    workspaceId: pendingThreadAction.workspaceId,
                    sessionId: targetConversation?.sessionId || createSessionId(`${conversationTitleFromNativeThread(nativeThread)}_fork`),
                    localAdapterState: 'idle' as LocalAdapterState,
                    mode: source?.mode ?? 'implement',
                    goalStatus: '',
                    goalObjective: '',
                    ...conversationPatchFromNativeThread(nativeThread),
                  },
                  ...current.filter((conversation) => conversation.id !== pendingThreadAction.conversationId),
                ].sort((a, b) => b.updatedAt - a.updatedAt),
              );
              setActiveWorkspaceId(pendingThreadAction.workspaceId);
              setActiveConversationId(pendingThreadAction.conversationId);
            } else {
              upsertNativeThreads(
                pendingThreadAction.workspaceId,
                sessionIdFromEvent(event, data) || conversationsRef.current.find((item) => item.id === pendingThreadAction.conversationId)?.sessionId || '',
                [nativeThread],
              );
            }
          }
          if (nativeThreadRead) {
            if (nativeThreadRead.history.length > 0) {
              unmaterializedNativeThreadIdsRef.current.delete(nativeThreadRead.thread.id);
            }
            const restored = nativeThreadRead.history
              .map((entry) =>
                timelineEntryFromNativeHistoryEntry(
                  entry,
                  pendingThreadAction.workspaceId,
                  pendingThreadAction.conversationId,
                ),
              )
              .reverse();
            setTimeline((current) => {
              const remaining = current.filter((entry) => entry.conversationId !== pendingThreadAction.conversationId);
              return capTimelinePerConversation([...restored, ...remaining]);
            });
            loadedNativeThreadHistoryRef.current.set(
              nativeThreadRead.thread.id,
              nativeThreadRead.thread.updatedAt,
            );
          }
          if (pendingThreadAction.action === 'archive') {
            updateConversation(pendingThreadAction.conversationId, { archived: true, nativeStatus: 'archived' });
          } else if (pendingThreadAction.action === 'unarchive') {
            updateConversation(pendingThreadAction.conversationId, { archived: false });
          } else if (pendingThreadAction.action === 'rename' && pendingThreadAction.title) {
            updateConversation(pendingThreadAction.conversationId, { title: pendingThreadAction.title });
          } else if (pendingThreadAction.action === 'unsubscribe') {
            updateConversation(pendingThreadAction.conversationId, { nativeStatus: 'unsubscribed' });
          } else if (pendingThreadAction.action === 'memory') {
            updateConversation(pendingThreadAction.conversationId, { nativeStatus: pendingThreadAction.resultDetail || 'memory updated' });
          }
          if (displayThread && displayThread !== nativeThread) {
            upsertNativeThreads(
              pendingThreadAction.workspaceId,
              sessionIdFromEvent(event, data) || conversationsRef.current.find((item) => item.id === pendingThreadAction.conversationId)?.sessionId || '',
              [displayThread],
            );
          }
          if (pendingThreadAction.showResult) {
            const title = pendingThreadAction.resultTitle || `${pendingThreadAction.action} result`;
            const detail = pendingThreadAction.resultDetail || formatThreadActionResult(pendingThreadAction, responseValue);
            setThreadInfoModal({
              title,
              detail,
              raw: responseValue,
            });
            appendTimeline(makeSystemEntry(title, detail.slice(0, 500), pendingThreadAction.workspaceId, pendingThreadAction.conversationId));
          }
          finishPendingThreadAction(pendingThreadAction);
        } else if (protocolError || event.type === 'codex.control.error') {
          if (pendingThreadAction.restoreHistory && protocolError && isThreadNotMaterializedHistoryError(protocolError)) {
            finishPendingThreadAction(pendingThreadAction);
          } else {
            finishPendingThreadAction(pendingThreadAction, localTurnErrorMessage(protocolError || t('sess.requestFailed', { method: pendingThreadAction.action })));
          }
        }
      }
      const turnId = turnIdFromEventData(data);
      const turnStatus = turnStatusFromEventData(data);
      const turnIsStarting = event.type === 'codex.turn.started' || /^inprogress$/i.test(turnStatus.replace(/[^a-z]/gi, ''));
      const turnIsTerminal = isTurnTerminalEvent(event) || /^(completed|interrupted|failed)$/i.test(turnStatus);
      if (hasTimelineTarget && turnIsTerminal) {
        setConversationTurnId(targetConversationId, '');
      } else if (hasTimelineTarget && turnId) {
        setConversationTurnId(targetConversationId, turnId);
      }
      if (hasTimelineTarget && turnIsStarting) {
        setConversationThinking(targetConversationId, true);
      }
      if (hasTimelineTarget && turnIsTerminal) {
        setConversationThinking(targetConversationId, false);
        const turnIsCompleted = event.type === 'codex.turn.completed' || /^completed$/i.test(turnStatus);
        if (!turnIsCompleted) {
          followUpsRef.current.pause(targetConversationId);
          setQueuePausedByConversation((current) => ({ ...current, [targetConversationId]: true }));
        }
        const queuedDrafts = queuedChatDraftsRef.current[targetConversationId] ?? [];
        const nextQueuedDraft = queuedDrafts[0] ?? null;
        if (
          turnIsCompleted &&
          nextQueuedDraft &&
          (nextQueuedDraft.text.trim() || nextQueuedDraft.attachments.length > 0 || nextQueuedDraft.skills.length > 0) &&
          !followUpsRef.current.isPaused(targetConversationId) &&
          !queuedChatDispatchingRef.current.has(targetConversationId)
        ) {
          queuedChatDispatchingRef.current.add(targetConversationId);
          void (async () => {
            try {
              const sent = await sendQueuedChatDraftRef.current(nextQueuedDraft, targetConversationId);
              if (sent) {
                setQueuedChatDrafts((current) => {
                  const queue = current[targetConversationId] ?? [];
                  if (queue.length === 0 || queue[0]?.id !== nextQueuedDraft.id) {
                    return current;
                  }
                  const nextQueue = queue.slice(1);
                  if (nextQueue.length === 0) {
                    const { [targetConversationId]: _removed, ...rest } = current;
                    return rest;
                  }
                  return { ...current, [targetConversationId]: nextQueue };
                });
              }
            } finally {
              queuedChatDispatchingRef.current.delete(targetConversationId);
            }
          })();
        }
      }
      if (event.type === 'codex.control.stopped') {
        const sessionId = target.sessionId || sessionIdFromEvent(event, data);
        if (typeof sessionId === 'string') {
          const conversation = conversationsRef.current.find((item) => item.sessionId === sessionId);
          if (conversation) {
            updateConversation(conversation.id, { localAdapterState: 'stopped' });
          }
        }
      }
      if (event.type === 'codex.control.ready') {
        const pending = findPendingLocalStart(event, data);
        if (pending) {
          settlePendingLocalStart(pending);
        }
      } else if (event.type === 'codex.control.error') {
        const pending = pendingLocalStartForError ?? findPendingLocalStart(event, data);
        if (pending) {
          settlePendingLocalStart(pending, protocolError || t('sess.localStartFailed'));
        }
      } else if (event.type === 'codex.serverRequest.resolved' && protocolError) {
        const pending = findPendingLocalStart(event, data);
        if (pending) {
          settlePendingLocalStart(pending, protocolError);
        }
      }
      const threadStartRequestId = data.requestId ?? data.request_id;
      if (typeof threadStartRequestId === 'string' && threadStartRequestId) {
        const pendingThread = [...pendingThreadStartsRef.current.values()].find((item) => item.requestId === threadStartRequestId);
        if (pendingThread) {
          const threadId = extractThreadIdFromEvent(event);
          if (protocolError || event.type === 'codex.control.request.rejected') {
            settlePendingThreadStart(pendingThread, '', localTurnErrorMessage(protocolError || t('sess.threadCreateFailed')));
          } else if (threadId) {
            settlePendingThreadStart(pendingThread, threadId);
          }
        }
      } else {
        const threadId = extractThreadIdFromEvent(event);
        if (threadId && pendingThreadStartsRef.current.size === 1) {
          const pendingThread = [...pendingThreadStartsRef.current.values()][0];
          settlePendingThreadStart(pendingThread, threadId);
        }
      }
      if (protocolError && isLocalAdapterFailed(protocolError)) {
        const sessionId = target.sessionId || sessionIdFromEvent(event, data);
        if (typeof sessionId === 'string') {
          const workspace = workspacesRef.current.find((item) => item.sessionId === sessionId);
          const conversation = conversationsRef.current.find((item) => item.sessionId === sessionId);
          if (conversation) {
            updateConversation(conversation.id, {
              sessionId: createSessionId(conversation.title),
              threadId: '',
              localAdapterState: 'idle',
            });
          } else if (workspace) {
            resetWorkspaceSession(workspace);
          }
        }
      }
      if (protocolError && isThreadNotFound(protocolError)) {
        const sessionId = target.sessionId || sessionIdFromEvent(event, data);
        const requestId = data.requestId ?? data.request_id;
        const conversation =
          typeof sessionId === 'string'
            ? conversationsRef.current.find((item) => item.sessionId === sessionId)
            : activeConversationRef.current
              ? conversationsRef.current.find((item) => item.id === activeConversationRef.current)
              : null;
        if (conversation) {
          updateConversation(conversation.id, { threadId: '' });
          appendTimeline(makeSystemEntry(
            t('sess.invalidatedThreadTitle'),
            localTurnErrorMessage(protocolError),
            conversation.workspaceId,
            conversation.id,
          ));
        }
        if (typeof requestId === 'string') {
          const pendingThread = [...pendingThreadStartsRef.current.values()].find((item) => item.requestId === requestId);
          if (pendingThread) {
            settlePendingThreadStart(pendingThread, '', localTurnErrorMessage(protocolError));
          }
        }
        const resetConversationId = conversation?.id ?? targetConversationId;
        if (resetConversationId) {
          setConversationThinking(resetConversationId, false);
        }
      }
      if (protocolError && !isLocalAdapterAlreadyRunning(protocolError) && !isThreadNotMaterializedHistoryError(protocolError)) {
        setLastError(localTurnErrorMessage(protocolError));
      }
    },
    [appendTimeline, findPendingLocalStart, finishPendingGitDiff, finishPendingSkillList, finishPendingThreadAction, finishPendingThreadList, handleTerminalEvent, persistSessionCursors, resetWorkspaceSession, resolveTimelineTarget, settlePendingLocalStart, settlePendingThreadStart, setConversationThinking, setConversationTurnId, updateConversation, upsertChatTimeline, upsertNativeThreads],
  );

  const appendEvent = useCallback((event: ServerEvent) => {
    const sessionId = sessionIdFromEvent(event, eventPayloadData(event));
    const cursor = cursorFromEvent(event);
    if (!sessionId || cursor === null) {
      projectLegacyEvent(event);
      return;
    }
    legacyRecoveryRef.current.receive(sessionId, cursor, event,
      () => sessionCursorsRef.current.get(sessionId) ?? 0,
      projectLegacyEvent,
      (next) => { sessionCursorsRef.current.set(sessionId, next); persistSessionCursors(); },
      (after) => rawProtocolSenderRef.current({ id: createRequestId('resume'), type: 'session.resume', payload: { sessionCursors: { [sessionId]: after } } }),
    );
  }, [persistSessionCursors, projectLegacyEvent]);

  const scheduleServerEventDrain = useCallback(() => {
    if (pendingServerEventFrameRef.current !== null) {
      return;
    }

    pendingServerEventFrameRef.current = scheduleMessageTask(() => {
      pendingServerEventFrameRef.current = null;
      const batch = pendingServerEventsRef.current.splice(0, SOCKET_EVENT_BATCH_SIZE);
      batch.forEach(appendEvent);

      if (pendingServerEventsRef.current.length > 0) {
        scheduleServerEventDrain();
      }
    });
  }, [appendEvent]);

  const enqueueServerEvent = useCallback((event: ServerEvent) => {
    pendingServerEventsRef.current.push(event);
    scheduleServerEventDrain();
  }, [scheduleServerEventDrain]);

  const decodeSocketFrame = useCallback((frame: PendingSocketFrame) => {
    if (frame.generation !== socketGenerationRef.current) {
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
        const payload = parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
          ? parsed.payload as Record<string, unknown> : {};
        const subscribedConversationId = pendingV2SubscribeRef.current.get(id);
        pendingV2SubscribeRef.current.delete(id);
        if (subscribedConversationId && payload.hasMore === true) {
          // The capped backfill stopped short of the high-water mark. A loaded
          // conversation pages the rest over HTTP; an unopened one loads its
          // history lazily when it is opened.
          const conversation = conversationsRef.current.find((item) => item.v2ConversationId === subscribedConversationId);
          if (conversation && conversationRecoveryRef.current?.get(subscribedConversationId)) {
            void conversationRecoveryRef.current.recover(subscribedConversationId, conversation.workspaceId, conversation.lastSequence ?? 0);
          }
        }
        protocolCommandsRef.current?.resolve(id, payload);
        return;
      }
      if (messageType === 'server.error' && parsed.id !== undefined) {
        const payload = parsed.payload as { code?: unknown; message?: unknown; conversationId?: unknown } | undefined;
        const code = typeof payload?.code === 'string' ? payload.code : '';
        const detail = historyErrorMessage(code) ?? (typeof payload?.message === 'string' ? payload.message : t('sess.v2CommandFailed'));
        const message = code ? `[${code}] ${detail}` : detail;
        const requestId = typeof parsed.id === 'string' ? parsed.id : '';
        const failedSubscribe = pendingV2SubscribeRef.current.get(requestId);
        if (failedSubscribe) {
          pendingV2SubscribeRef.current.delete(requestId);
          v2SubscriptionsRef.current.delete(failedSubscribe);
        }
        // A subscription task that died server-side already released its slot;
        // drop the local marker so a later subscribe is not deduped away.
        const endedConversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : '';
        if (endedConversationId) v2SubscriptionsRef.current.delete(endedConversationId);
        // A busy conversation's prompt may still join the backend queue;
        // sendV2Prompt reports the conflict itself when it cannot.
        const callerReports = code === 'CONFLICT' && protocolCommandsRef.current?.typeOf(requestId) === 'conversation.prompt';
        protocolCommandsRef.current?.reject(requestId, message, code);
        if (!callerReports) setLastError(message);
        return;
      }
      if (messageType === HISTORY_ENCRYPTION_UPDATED) {
        historyEncryptionRef.current?.receiveUpdate(connectedBackendIdRef.current ?? activeBackendConnectionIdRef.current, parsed.payload);
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
        const backendId = connectedBackendIdRef.current ?? activeBackendConnectionIdRef.current;
        const generation = frame.generation;
        // Encrypted payloads are opened before normalization; per
        // conversation the arrival order is kept even when a wrap is fetched.
        const deliver = (opened: Record<string, unknown>) => {
          if (generation !== socketGenerationRef.current) return;
          const event = normalizeConversationEvent(opened);
          if (!event) throw new Error(t('sess.invalidConversationEvent'));
          const conversation = conversationsRef.current.find((item) => item.v2ConversationId === event.conversationId || item.id === event.conversationId);
          if (conversation) conversationEventBatcherRef.current!.push(event.conversationId, conversation.workspaceId, event);
        };
        const history = historyEncryptionRef.current;
        if (!history || !rawConversationId) deliver(raw);
        else history.receiveSocketEvent(backendId, rawConversationId, raw, parsed.frames, parsed.delivery === 'replay' ? 'summary' : 'full', deliver, setLastError);
        return;
      }
      enqueueServerEvent(parsed as unknown as ServerEvent);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'failed to parse websocket message');
    }
  }, [enqueueServerEvent, setConversationThinking, setConversationTurnId, updateConversation, upsertChatTimeline]);

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
    if (pendingSocketFramesRef.current.length >= MAX_PENDING_SOCKET_FRAMES) {
      // The renderer fell too far behind the socket. Drop the backlog and
      // reconnect like any transient drop: resubscribing replays each
      // conversation from its cursor, and gaps recover over REST.
      closeSocket(false);
      // Back off across repeated drops: markVerified zeroes the attempt
      // counter on every successful reconnect.
      const streak = nextSocketBacklogStreak(socketBacklogStreakRef.current, Date.now());
      socketBacklogStreakRef.current = streak;
      reconnectAttemptRef.current = Math.max(reconnectAttemptRef.current, streak.count - 1);
      lastFailureRetryableRef.current = true;
      setConnectionState('closed');
      setLastError(t('sess.socketBacklog'));
      return;
    }
    pendingSocketFramesRef.current.push(frame);
    scheduleSocketFrameDrain();
  }, [closeSocket, scheduleSocketFrameDrain, setLastError]);

  /** Raw `{id, type, payload}` frame on the unified /v2/ws socket: the secure
   * socket checks the 8 MiB frame limit before sealing, then sends. Returns
   * null when the frame never left (socket closed) and throws ConnectionError
   * on oversize payloads. */
  const sendRawProtocolFrame = useCallback((message: { id: string; type: string; payload: Record<string, unknown> }) => {
    const socket = socketRef.current;
    if (!socket?.ready || !socketVerifiedRef.current) {
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
      sendRawProtocolFrame({ id: createRequestId('abw'), type: 'agentBrowser.watch', payload: { conversationId } });
    }
    listeners.add(listener);
    return () => {
      const current = watchers.get(conversationId);
      if (!current?.delete(listener) || current.size) return;
      watchers.delete(conversationId);
      sendRawProtocolFrame({ id: createRequestId('abu'), type: 'agentBrowser.unwatch', payload: { conversationId } });
    };
  }, [sendRawProtocolFrame]);

  const unsubscribeV2Conversation = useCallback((v2ConversationId: string) => {
    if (!v2SubscriptionsRef.current.delete(v2ConversationId)) return;
    sendRawProtocolFrame({
      id: createRequestId('unsub'),
      type: 'conversation.unsubscribe',
      payload: { conversationId: v2ConversationId },
    });
  }, [sendRawProtocolFrame]);

  /** Send `conversation.subscribe` within the per-socket budget. When the
   * budget is full, the oldest background subscription is unsubscribed first;
   * the active conversation is never evicted. Returns false when the frame
   * could not be sent or no slot could be freed. */
  const subscribeV2Conversation = useCallback((
    v2ConversationId: string,
    options?: { afterSequence?: number; limit?: number },
  ): boolean => {
    // Mid-switch the socket still belongs to the previous backend; the
    // reconnect subscribes the new backend's conversations once it opens.
    if (connectedBackendIdRef.current !== activeBackendConnectionIdRef.current) return false;
    const subscribed = v2SubscriptionsRef.current;
    if (subscribed.has(v2ConversationId)) {
      // Refresh recency so active conversations are not evicted first.
      subscribed.delete(v2ConversationId);
      subscribed.add(v2ConversationId);
      return true;
    }
    const activeV2Id = conversationsRef.current.find(
      (item) => item.id === activeConversationRef.current,
    )?.v2ConversationId;
    while (subscribed.size >= V2_WS_SUBSCRIPTION_BUDGET) {
      const evict = [...subscribed].find((id) => id !== activeV2Id);
      if (!evict) return false;
      unsubscribeV2Conversation(evict);
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
    });
    if (!sent) return false;
    subscribed.add(v2ConversationId);
    pendingV2SubscribeRef.current.set(requestId, v2ConversationId);
    return true;
  }, [sendRawProtocolFrame, unsubscribeV2Conversation]);
  subscribeV2ConversationRef.current = subscribeV2Conversation;

  rawProtocolSenderRef.current = (message) => Boolean(sendRawProtocolFrame(message));

  const sendProtocolCommand = useCallback((message: ProtocolCommand, timeoutMs = 15_000) =>
    protocolCommandsRef.current!.request(message, timeoutMs), []);

  const historyEncryption = useHistoryEncryption({
    activeBackendId: activeBackendConnectionId,
    connected: connectionState === 'open' && connectedBackendIdRef.current === activeBackendConnectionId,
    supported: serverVersion ? serverVersion.historyEncryption === 1 : undefined,
    sendCommand: sendProtocolCommand,
    // Keys arrived: drop the projections (of the named conversations, or
    // all) that hold locked rows and reopen the visible conversation so it
    // decrypts now.
    onUnlocked: (conversationIds) => {
      const recovery = conversationRecoveryRef.current;
      if (!recovery) return;
      const activeV2Id = conversationsRef.current.find((item) => item.id === activeConversationRef.current)?.v2ConversationId;
      let reopenActive = false;
      for (const id of conversationIds ?? recovery.loadedConversationIds()) {
        if (!recovery.get(id)?.timeline.some((entry) => entry.detailLocked)) continue;
        if (recovery.release(id) && id === activeV2Id) reopenActive = true;
      }
      if (reopenActive && activeConversationRef.current) void openConversation(activeConversationRef.current);
    },
  });
  historyEncryptionRef.current = historyEncryption;

  // A revoked device says so once instead of only showing locked rows.
  const historyRevoked = historyEncryption.revoked;
  useEffect(() => {
    if (historyRevoked) setLastError(t('history.accessRevoked'));
  }, [historyRevoked]);

  // Encrypted manifest titles (§3.2): decrypt what is new, then re-merge the
  // listed manifests once more titles are readable.
  const { decryptManifestTitles: decryptTitles, titleRevision: decryptedTitleRevision, view: historyView } = historyEncryption;
  useEffect(() => {
    if (historyView.status !== 'ready') return;
    void decryptTitles(activeBackendConnectionId, v2Conversations);
  }, [activeBackendConnectionId, decryptTitles, historyView.status, v2Conversations]);
  useEffect(() => {
    if (!decryptedTitleRevision) return;
    setConversations((current) => mergeManifestConversations(current, withDecryptedTitles(activeBackendConnectionId, v2Conversations), workspacesRef.current, activeBackendConnectionId));
  }, [decryptedTitleRevision]);

  const controlConversation = useCallback(async (conversationId: string, control: LiveConversationControl): Promise<boolean> => {
    const conversation = conversationsRef.current.find(item => item.id === conversationId);
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
    setControlStatusByConversation(current => ({ ...current, [conversationId]: 'pending' }));
    try {
      const result = await sendProtocolCommand({ id: requestId, type: 'conversation.control', payload: {
        conversationId: conversation.v2ConversationId, expectedTurnId: turnId, control,
      } }, 35_000);
      if (result.status === 'targetUnavailable') throw new Error(t('sess.turnEndedNotApplied'));
      if (controlRequestsRef.current.get(conversationId) === requestId) {
        controlRequestsRef.current.delete(conversationId);
        setControlStatusByConversation(current => ({ ...current, [conversationId]: undefined }));
      }
      return true;
    } catch (error) {
      const unknown = error instanceof ProtocolCommandError && error.state === 'unknown';
      if (controlRequestsRef.current.get(conversationId) === requestId) {
        if (!unknown) controlRequestsRef.current.delete(conversationId);
        setControlStatusByConversation(current => ({ ...current, [conversationId]: unknown ? 'unknown' : undefined }));
      }
      setLastError(error instanceof Error ? error.message : t('sess.agentControlFailed'));
      if (unknown) await recoverConversation(conversationId);
      return false;
    }
  }, [recoverConversation, sendProtocolCommand]);

  const flushQueuedProtocolCommands = useCallback(() => protocolCommandsRef.current?.flush(), []);

  const sendSessionResume = useCallback((sessionCursors: Record<string, number>) => {
    try {
      sendRawProtocolFrame({
        id: createRequestId('resume'),
        type: 'session.resume',
        payload: { sessionCursors },
      });
    } catch (error: unknown) {
      setLastError(error instanceof ConnectionError ? error.userMessage : t('sess.resumeFailed'));
    }
  }, [sendRawProtocolFrame]);

  const pushSystem = useCallback(
    (title: string, subtitle = '') => {
      appendTimeline(makeSystemEntry(title, subtitle, activeWorkspaceRef.current, activeConversationRef.current));
    },
    [appendTimeline],
  );

  const refreshServerVersion = useCallback(async () => {
    try {
      // Signed so the daemon also returns its data and workspace paths;
      // tunnelled like every other call when a key is pinned.
      const response = await backendFetch(settings, {
        method: 'GET',
        path: '/v2/version',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`version endpoint returned ${response.status}`);
      }
      const json = (await response.json()) as ServerVersion;
      setServerVersion(json);
    } catch (error) {
      setServerVersion(null);
      setLastError(error instanceof Error ? error.message : 'failed to fetch /v2/version');
    }
  }, [settings]);

  const checkConnectionHealth = useCallback(async () => {
    if (transportFailureRef.current) return;
    const probeId = healthProbeSeqRef.current + 1;
    healthProbeSeqRef.current = probeId;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONNECTION_HEALTH_TIMEOUT_MS);

    setConnectionHealth((current) => ({
      ...current,
      status: current.status === 'online' ? 'online' : 'checking',
      error: '',
    }));

    try {
      const response = await fetch(buildHttpUrl(settings.serverUrl, '/health'), {
        cache: 'no-store',
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      if (healthProbeSeqRef.current !== probeId || transportFailureRef.current) {
        return;
      }
      if (!response.ok) {
        throw new Error(`health endpoint returned ${response.status}`);
      }
      setConnectionHealth({
        status: 'online',
        latencyMs,
        lastCheckedAt: Date.now(),
        error: '',
      });
    } catch (error) {
      if (healthProbeSeqRef.current !== probeId || transportFailureRef.current) {
        return;
      }
      const isAbort = error instanceof Error && error.name === 'AbortError';
      setConnectionHealth({
        status: 'offline',
        latencyMs: null,
        lastCheckedAt: Date.now(),
        error: isAbort ? t('sess.healthCheckTimeout') : error instanceof Error ? error.message : t('sess.healthCheckFailed'),
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }, [settings.serverUrl]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    setConnectionHealth(defaultConnectionHealth);
    void checkConnectionHealth();

    const intervalId = setInterval(() => {
      void checkConnectionHealth();
    }, CONNECTION_HEALTH_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [checkConnectionHealth, hydrated]);

  const lastFailureRetryableRef = useRef(true);

  const connect = useCallback(() => {
    manualDisconnectRef.current = false;
    autoConnectAttemptedRef.current = true;
    setAutoConnectEnabled(true);
    closeSocket(false);
    const generation = socketGenerationRef.current;
    const backendId = activeBackendConnectionIdRef.current;
    connectedBackendIdRef.current = backendId;
    const attempt = new AbortController();
    connectionAttemptRef.current = attempt;
    transportFailureRef.current = false;
    const isAttemptCurrent = () => socketGenerationRef.current === generation
      && connectionAttemptRef.current === attempt && !attempt.signal.aborted;
    const failTransport = (failure: TransportFailure) => {
      if (connectionAttemptRef.current !== attempt) return;
      // A definitive failure stops the reconnect loop and keeps the health
      // poll from overwriting the message; a retryable one only reports.
      transportFailureRef.current = !failure.retryable;
      closeSocket(false);
      lastFailureRetryableRef.current = failure.retryable;
      setConnectionState('error');
      setLastError(failure.message);
      setConnectionHealth({ status: 'offline', latencyMs: null, lastCheckedAt: Date.now(), error: failure.message, code: failure.code });
    };
    setLastError('');
    setConnectionState('connecting');
    setConnectionHealth((current) => ({ ...current, status: 'checking', error: '', code: '' }));

    void (async () => {
      const inspected = inspectServerUrl(settings.serverUrl);
      if (inspected.error) {
        lastFailureRetryableRef.current = inspected.error.retryable;
        setConnectionState('error');
        setLastError(inspected.error.userMessage);
        setConnectionHealth({
          status: 'offline',
          latencyMs: null,
          lastCheckedAt: Date.now(),
          error: inspected.error.userMessage,
          code: inspected.error.code,
        });
        return;
      }

      const profile = { ...settings, serverUrl: inspected.origin };
      try {
        await verifyTransportPolicy(profile, { signal: attempt.signal });
      } catch (error) {
        if (!isAttemptCurrent()) return;
        failTransport(describeTransportFailure(error)
          ?? { message: t('transport.cannotConfirmPolicy'), retryable: true, code: 'backend_unreachable' });
        return;
      }
      if (!isAttemptCurrent()) return;
      const transport = backendTransport(profile);
      const probe = await probeBackendConnection({ serverUrl: inspected.origin, transport });
      if (!isAttemptCurrent()) return;
      if (!probe.ok || probe.error) {
        const error = probe.error ?? ConnectionError.unreachable('backend probe failed');
        const transportFailure = describeTransportFailure(error);
        if (transportFailure) {
          failTransport(transportFailure);
          return;
        }
        lastFailureRetryableRef.current = error.retryable;
        setConnectionState('error');
        setLastError(error.userMessage);
        setConnectionHealth({
          status: 'offline',
          latencyMs: null,
          lastCheckedAt: Date.now(),
          error: error.userMessage,
          code: error.code,
        });
        if (probe.version) {
          setServerVersion({
            name: probe.version.name,
            version: probe.version.version,
            data_dir: probe.version.dataDir || '',
            workspace_root: probe.version.workspaceRoot || '',
            historyEncryption: probe.version.historyEncryption,
          });
        }
        if (probe.providers.length) {
          setBackendProviders(backendId, probe.providers);
        }
        return;
      }

      setBackendProviders(backendId, probe.providers);
      if (probe.version) {
        setServerVersion({
          name: probe.version.name,
          version: probe.version.version,
          data_dir: probe.version.dataDir || '',
          workspace_root: probe.version.workspaceRoot || '',
          historyEncryption: probe.version.historyEncryption,
        });
      }
      setConnectionHealth({
        status: 'checking',
        latencyMs: null,
        lastCheckedAt: Date.now(),
        error: '',
        code: '',
      });

      let verification: SocketVerification | null = null;
      let verified = false;
      let cryptoFailed = false;
      let socket: SecureSocket;
      const isSocketCurrent = () => isAttemptCurrent() && socketRef.current === socket;
      const markVerified = () => {
        if (!isSocketCurrent() || !socket.ready) return;
        verified = true;
        socketVerifiedRef.current = true;
        // Server-side subscriptions are per-socket; this socket starts empty.
        v2SubscriptionsRef.current.clear();
        // So are live browser views: watch again what is still on screen.
        for (const watched of agentBrowserWatchersRef.current.keys()) {
          const watchFrame = JSON.stringify({ id: createRequestId('abw'), type: 'agentBrowser.watch', payload: { conversationId: watched } });
          sendSocketText(socket, watchFrame);
        }
        pendingV2SubscribeRef.current.clear();
        reconnectAttemptRef.current = 0;
        lastFailureRetryableRef.current = true;
        setConnectionState('open');
        setConnectionEpoch((current) => current + 1);
        sendSessionResume(getSessionCursorSnapshot());
        void checkConnectionHealth();
        void refreshServerVersion();
        // Only the open conversation replays history eagerly. Other
        // conversations subscribe at their known high-water mark and
        // recover on demand (open, or a live event exposing a gap), so a
        // reconnect no longer replays every journal at once.
        const foregroundConversation = conversationsRef.current.find(
          (item) => item.id === activeConversationRef.current,
        );
        // Returning to a backend continues its history where it stopped:
        // a loaded conversation catches up from its cursor, an unloaded one
        // opens lazily from the journal tail.
        if (foregroundConversation?.v2ConversationId) {
          void openConversation(foregroundConversation.id);
        }
        // Prompt submissions whose ACK was lost are reconciled against the
        // journal: delivered ones resume tracking, the rest return to drafts.
        for (const [pendingId, pending] of pendingV2SubmissionsRef.current) {
          if (pending.phase === 'unknown') void reconcilePendingSubmission(pendingId);
        }
        void (async () => {
          await syncWorkspacesFromBackend();
          if (!isSocketCurrent()) return;
          const backendId = activeBackendConnectionIdRef.current;
          const candidates = conversationsRef.current.filter((conversation) => {
            if (!conversation.v2ConversationId || conversation.archived === true) return false;
            // Manifest-imported conversations are untagged; their workspace
            // names the backend that owns them.
            const ownerId = conversation.backendConnectionId
              ?? workspacesRef.current.find((item) => item.id === conversation.workspaceId)?.backendConnectionId;
            return !ownerId || ownerId === backendId;
          });
          // The foreground conversation must keep its live subscription even
          // when the list exceeds the server's per-socket subscription cap.
          candidates.sort((left, right) =>
            Number(right.id === foregroundConversation?.id) - Number(left.id === foregroundConversation?.id));
          for (const conversation of candidates) {
            if (v2SubscriptionsRef.current.size >= V2_WS_SUBSCRIPTION_BUDGET) break;
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
        flushQueuedProtocolCommands();
        for (const queuedConversationId of Object.keys(queuedChatDraftsRef.current)) {
          void resumeQueuedFollowUps(queuedConversationId);
        }
      };
      const failVerification = (error: unknown) => {
        // The verifier's verdict is authoritative even when the socket
        // already closed mid-handshake; only a newer connection attempt or
        // our own abort may supersede it.
        if (connectionAttemptRef.current !== attempt) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const failure = describeTransportFailure(error)
          ?? { message: t('transport.notVerified'), retryable: false, code: 'protocol_mismatch' as const };
        if (failure.retryable) {
          if (!isSocketCurrent()) return;
          // Transient drop mid-handshake: supersede this socket so its
          // onClose no-ops, then let the reconnect effect retry.
          closeSocket(false);
          lastFailureRetryableRef.current = true;
          setConnectionState('closed');
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
            enqueueSocketFrame({ data: text, generation });
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
            lastFailureRetryableRef.current = true;
            setConnectionState('error');
            setLastError(message);
            setConnectionHealth((current) => ({
              ...current,
              status: 'offline',
              error: message,
              code: 'websocket_failed',
            }));
          },
          onClose: (event) => {
            if (!isSocketCurrent()) return;
            verification?.fail();
            socketVerifiedRef.current = false;
            socketRef.current = null;
            attempt.abort();
            protocolCommandsRef.current?.disconnect();
            if (cryptoFailed || event.code === TRANSPORT_V2_WS_CLOSE_CODE) {
              // A transport crypto failure: reconnect with a fresh handshake
              // and tell the user how to recover if it keeps happening.
              const failure = describeTransportFailure(new TransportCryptoError('socket closed')) as TransportFailure;
              lastFailureRetryableRef.current = true;
              setConnectionState('error');
              setLastError(failure.message);
              setConnectionHealth((current) => ({ ...current, status: 'offline', error: failure.message, code: failure.code }));
              return;
            }
            if (socket.encrypted && !verified) {
              // A drop before the encrypted handshake finishes is transient;
              // keep auto-reconnect alive instead of latching an error.
              lastFailureRetryableRef.current = true;
              setConnectionState('closed');
              setLastError(t('transport.notVerified'));
              return;
            }
            setConnectionState((current) => (current === 'open' || current === 'connecting' ? 'closed' : current));
          },
        });
      } catch (error) {
        if (!isAttemptCurrent()) return;
        failTransport(describeTransportFailure(error)
          ?? { message: error instanceof Error ? error.message : t('transport.invalidKey'), retryable: false, code: 'encryption_required' });
        return;
      }
      socketRef.current = socket;
    })().catch((error: unknown) => {
      if (!isAttemptCurrent()) return;
      lastFailureRetryableRef.current = true;
      setConnectionState('error');
      const message = error instanceof Error ? error.message : t('sess.backendConnectFailed');
      setLastError(message);
      setConnectionHealth({ status: 'offline', latencyMs: null, lastCheckedAt: Date.now(), error: message, code: 'backend_unreachable' });
    });
  }, [checkConnectionHealth, closeSocket, enqueueSocketFrame, flushQueuedProtocolCommands, getSessionCursorSnapshot, openConversation, reconcilePendingSubmission, refreshServerVersion, resumeQueuedFollowUps, sendSessionResume, setBackendProviders, settings, subscribeV2Conversation, syncWorkspacesFromBackend]);

  useEffect(() => {
    if (!hydrated || !autoConnectEnabled || manualDisconnectRef.current) {
      return;
    }
    if (connectionState !== 'closed' && connectionState !== 'error') {
      return;
    }
    if (!lastFailureRetryableRef.current) {
      return;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    const delay = nextReconnectDelayMs(reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      // A definitive failure may land after this timer was scheduled (the
      // encrypted-socket verifier can reject after the socket closes).
      if (!manualDisconnectRef.current && lastFailureRetryableRef.current) {
        connect();
      }
    }, delay);
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [autoConnectEnabled, connect, connectionState, hydrated]);

  // Backstop for the event-driven reconnect above: a socket can die without a
  // usable close event (sleep/wake, renderer churn, missed state transitions),
  // and state latches like manualDisconnectRef can silently suppress retries.
  // The watchdog reconnects whenever the socket is observably dead, and pings
  // an open socket so a half-open TCP connection is also detected.
  useEffect(() => {
    if (!hydrated || !autoConnectEnabled) return;
    const tick = () => {
      if (manualDisconnectRef.current) return;
      const socket = socketRef.current;
      if (!socket || socket.closed) {
        socketVerifiedRef.current = false;
        socketWatchdogFailuresRef.current = 0;
        setConnectionState((current) => (current === 'open' ? 'closed' : current));
        if (!lastFailureRetryableRef.current || connectionState === 'connecting') return;
        connect();
        return;
      }
      if (!socket.ready || !socketVerifiedRef.current) return;
      const livenessProbe = socket;
      void sendProtocolCommand({ id: createRequestId('watchdog'), type: 'server.ping', payload: {} }, SOCKET_LIVENESS_TIMEOUT_MS)
        .then(() => {
          socketWatchdogFailuresRef.current = 0;
        })
        .catch(() => {
          if (socketRef.current !== livenessProbe) return;
          socketWatchdogFailuresRef.current += 1;
          if (socketWatchdogFailuresRef.current < SOCKET_LIVENESS_MAX_FAILURES) return;
          socketWatchdogFailuresRef.current = 0;
          closeSocket(false);
          setConnectionState('closed');
        });
    };
    const intervalId = setInterval(tick, SOCKET_WATCHDOG_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [autoConnectEnabled, closeSocket, connect, connectionState, hydrated, sendProtocolCommand]);

  useEffect(() => {
    if (!hydrated || !autoConnectEnabled || autoConnectAttemptedRef.current) {
      return;
    }

    autoConnectAttemptedRef.current = true;
    connect();
  }, [autoConnectEnabled, connect, hydrated]);

  // Selecting a workspace or conversation on another backend switches the
  // active profile; move the socket there. Editing the active profile's URL
  // does not reconnect by itself — that still goes through Settings.
  useEffect(() => {
    if (!hydrated || !autoConnectEnabled || manualDisconnectRef.current) return;
    const connectedBackendId = connectedBackendIdRef.current;
    if (!connectedBackendId || connectedBackendId === activeBackendConnectionId) return;
    connect();
  }, [activeBackendConnectionId, autoConnectEnabled, connect, hydrated]);

  const sendProtocolMessage = useCallback(
    (
      type: string,
      payload: Record<string, unknown>,
      requestId = createRequestId('msg'),
      target?: TimelineTarget,
    ) => {
      const socket = socketRef.current;
      if (!socket?.ready || !socketVerifiedRef.current) {
        if (autoConnectEnabled && !manualDisconnectRef.current) {
          setLastError(t('sess.reconnecting'));
          connect();
        } else {
          setLastError(t('sess.connectBackendFirst'));
        }
        return false;
      }

      let message: { id: string; type: string; payload: Record<string, unknown> } | null;
      try {
        message = sendRawProtocolFrame({ id: requestId, type, payload });
      } catch (error: unknown) {
        setLastError(
          error instanceof ConnectionError ? error.userMessage : t('sess.sendFailed'),
        );
        return false;
      }
      if (!message) {
        setLastError(t('sess.connectBackendFirst'));
        return false;
      }
      if (type === 'codex.local.turn') {
        appendTimeline(makeOutgoingEntry(
          message,
          target?.workspaceId ?? activeWorkspaceRef.current,
          target?.conversationId ?? activeConversationRef.current,
        ));
      }
      return true;
    },
    [appendTimeline, autoConnectEnabled, connect, sendRawProtocolFrame],
  );

  const seedTerminalState = useCallback((target: TerminalTarget, patch: Partial<TerminalClientState> = {}, notice?: TerminalOutputEntry) => {
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
        tenantId: workspace?.tenantId || settings.tenantId,
        cwd: workspace?.path ?? '',
        shell: '',
        rows: DEFAULT_TERMINAL_ROWS,
        cols: DEFAULT_TERMINAL_COLS,
        status: 'idle',
        output: [],
        error: '',
        pid: null,
        exitCode: null,
        updatedAt: Date.now(),
      };
      const merged: TerminalClientState = { ...base, ...existing, ...patch };
      merged.output = capTerminalOutput(notice ? [...merged.output, notice] : merged.output);
      return evictIdleTerminalStates({
        ...current,
        [terminalId]: merged,
      });
    });
    return terminalId;
  }, [settings.tenantId]);

  const startTerminalSession = useCallback((
    target: TerminalTarget,
    options: { cwd: string; shell: string; rows: number; cols: number; terminalId?: string; preserveOutput?: boolean },
  ) => {
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
      ...(options.preserveOutput ? {} : {
        output: [
          terminalOutputLine('system', target.kind === 'ssh' ? `connecting to ${target.host}` : `starting terminal in ${cwd}`),
        ],
      }),
    }, options.preserveOutput ? terminalOutputLine('system', 'restarting terminal') : undefined);
    const sent = sendProtocolMessage('terminal.start', target.kind === 'ssh' ? {
      terminalId,
      tenantId: settings.tenantId,
      cwd: '',
      ssh: { host: target.host },
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
    }, createRequestId('terminal-start'));
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
            output: capTerminalOutput([
              ...existing.output,
              terminalOutputLine('error', t('sess.connectBackendFirst')),
            ]),
            updatedAt: Date.now(),
          },
        };
      });
      return false;
    }
    return true;
  }, [seedTerminalState, sendProtocolMessage, settings.tenantId]);

  const sendTerminalInput = useCallback((terminalId: string, tenantId: string, data: string) => {
    const terminal = terminalById[terminalId];
    const sent = sendProtocolMessage('terminal.input', {
      terminalId,
      tenantId,
      data,
    }, createRequestId('terminal-input'));
    if (sent) {
      return true;
    }
    if (terminal) {
      appendTerminalOutput(terminalId, terminalOutputLine('error', t('sess.connectBackendFirst')));
    }
    return false;
  }, [appendTerminalOutput, sendProtocolMessage, terminalById]);

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
          output: capTerminalOutput([
            ...existing.output,
            terminalOutputLine('system', force ? 'force stopping terminal' : 'stopping terminal'),
          ]),
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
      tenantId: settings.tenantId,
      terminalId: resolvedTerminalId,
    } : {
      tenantId: target.workspace.tenantId || settings.tenantId,
      workspaceId: target.workspace.id,
      terminalId: resolvedTerminalId,
    }, createRequestId('terminal-status'));
  }, [seedTerminalState, sendProtocolMessage, settings.tenantId]);

  const clearTerminalOutput = useCallback((terminalId: string) => {
    setTerminalById((current) => {
      const existing = current[terminalId];
      if (!existing) {
        return current;
      }
      return {
        ...current,
        [terminalId]: {
          ...existing,
          output: [],
          updatedAt: Date.now(),
        },
      };
    });
  }, []);

  const requestModelCatalog = useCallback(() => {
    const sessionId =
      activeWorkspaceRef.current
        ? workspacesRef.current.find((workspace) => workspace.id === activeWorkspaceRef.current)?.sessionId
        : workspacesRef.current[0]?.sessionId;
    if (!sessionId) {
      setModelCatalogStatus('ready');
      return false;
    }
    const requestId = createRequestId('model-list');
    if (pendingModelListRef.current) {
      clearTimeout(pendingModelListRef.current.timeoutId);
    }
    const timeoutId = setTimeout(() => {
      if (pendingModelListRef.current?.requestId !== requestId) {
        return;
      }
      pendingModelListRef.current = null;
      setModelCatalogStatus('error');
      setModelCatalogError(t('sess.modelListTimeout'));
    }, 8000);
    pendingModelListRef.current = { requestId, timeoutId };
    setModelCatalogStatus('loading');
    setModelCatalogError('');
    const sent = sendProtocolMessage('codex.local.request', {
      codexSessionId: sessionId,
      tenantId: settings.tenantId,
      method: 'model/list',
      params: {
        limit: 50,
        includeHidden: false,
      },
    }, requestId);
    if (!sent) {
      clearTimeout(timeoutId);
      pendingModelListRef.current = null;
      setModelCatalogStatus('error');
      setModelCatalogError(t('sess.modelListNeedBackend'));
      return false;
    }
    return true;
  }, [sendProtocolMessage, settings.tenantId]);

  const createWorkspace = useCallback(
    (nameDraft: string, pathDraft: string) => {
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
        backendConnectionId: activeBackendConnectionId,
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
        sortOrder: nextWorkspaceSortOrder(workspacesRef.current),
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
      activeBackendConnectionId,
    ],
  );

  const updateBackendConnection = useCallback((id: string, patch: Partial<BackendConnectionProfile>) => {
    setBackendConnections((current) => current.map((profile) => profile.id === id ? { ...profile, ...patch, updatedAt: Date.now() } : profile));
  }, []);

  const addBackendConnection = useCallback((profile?: Partial<BackendConnectionProfile>) => {
    const id = createRequestId('backend');
    const next: BackendConnectionProfile = { ...profileFromSettings(settings, t('session.newBackend'), id), ...profile, id, createdAt: Date.now(), updatedAt: Date.now() };
    setBackendConnections((current) => [...current, next]);
    setActiveBackendConnectionId(id);
    setSettings((current) => settingsFromProfile(next, current));
    return next;
  }, [settings]);

  const removeBackendConnection = useCallback((id: string) => {
    if (backendConnections.length <= 1) return;
    void removeSecret(`${DEVICE_SECRET_STORAGE_KEY}.${id}`).catch((error) => {
      setLastError(error instanceof Error ? error.message : t('sess.credentialClearFailed'));
    });
    void historyEncryptionRef.current?.forgetBackend(id).catch((error: unknown) => {
      setLastError(error instanceof Error ? error.message : t('history.keyFailed'));
    });
    const next = backendConnections.filter((profile) => profile.id !== id);
    setBackendConnections(next);
    if (activeBackendConnectionId === id && next[0]) {
      setActiveBackendConnectionId(next[0].id);
      setSettings((current) => settingsFromProfile(next[0], current));
    }
  }, [activeBackendConnectionId, backendConnections]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace || workspace.pathMissing) {
      return;
    }
    setActiveWorkspaceId(workspaceId);
    const profile = backendConnections.find((item) => item.id === workspace.backendConnectionId);
    if (profile) {
      setActiveBackendConnectionId(profile.id);
      setSettings((current) => settingsFromProfile(profile, current));
    }
    const conversation = conversations.find((item) => item.workspaceId === workspaceId);
    if (conversation) {
      setActiveConversationId(conversation.id);
    } else {
      const nextConversation = createDefaultConversation(workspace);
      setConversations((current) => current.some((item) => item.id === nextConversation.id) ? current : [nextConversation, ...current]);
      setActiveConversationId(nextConversation.id);
    }
    setLastError('');
  }, [backendConnections, conversations, workspaces]);

  const selectConversation = useCallback((workspaceId: string, conversationId: string) => {
    const conversation = conversations.find((item) => item.id === conversationId);
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const profileId = conversation?.backendConnectionId ?? workspace?.backendConnectionId;
    const profile = backendConnections.find((item) => item.id === profileId);
    if (profile) {
      setActiveBackendConnectionId(profile.id);
      setSettings((current) => settingsFromProfile(profile, current));
    }
    setActiveWorkspaceId(workspaceId);
    setActiveConversationId(conversationId);
    setLastError('');
  }, [backendConnections, conversations, workspaces]);

  notifyTurnCompletedRef.current = (localId, state, turnId) => {
    const viewingConversation = activeConversationRef.current === localId
      && document.visibilityState === 'visible'
      && document.hasFocus();
    if (!shouldNotifyCompletion({
      enabled: completionNotificationsState.completionNotifications,
      supported: completionNotificationsState.completionNotificationsSupported,
      viewingConversation,
    })) return;
    const conversation = conversationsRef.current.find((item) => item.id === localId);
    const workspace = workspacesRef.current.find((item) => item.id === conversation?.workspaceId);
    postCompletionNotification({
      title: conversation?.title?.trim() || workspace?.name?.trim() || 'TodeX',
      body: completionNotificationBody(state.timeline),
      tag: `turn-completed-${state.conversationId}-${turnId}`,
      onActivate: () => { if (conversation) selectConversation(conversation.workspaceId, localId); },
    });
  };

  const removeWorkspace = useCallback(
    (workspaceId: string) => {
      const removedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
      if (removedWorkspace) {
        // A tombstone keeps the merge-based sync from resurrecting the
        // workspace while the backend record is still around or unreachable.
        const tombstone: WorkspaceTombstone = {
          id: removedWorkspace.id,
          path: removedWorkspace.path,
          backendConnectionId: removedWorkspace.backendConnectionId ?? activeBackendConnectionId ?? null,
          deletedAt: Date.now(),
        };
        const nextTombstones = [
          tombstone,
          ...workspaceTombstonesRef.current.filter((item) =>
            item.id !== tombstone.id && normalizeWorkspacePath(item.path) !== normalizeWorkspacePath(tombstone.path)),
        ].slice(0, MAX_WORKSPACE_TOMBSTONES);
        workspaceTombstonesRef.current = nextTombstones;
        setWorkspaceTombstones(nextTombstones);
      }
      if (
        connectionState === 'open' &&
        removedWorkspace &&
        (!removedWorkspace.backendConnectionId || removedWorkspace.backendConnectionId === activeBackendConnectionId)
      ) {
        void backendFetch(settings, {
          method: 'DELETE',
          path: `/v2/workspaces/${encodeURIComponent(workspaceId)}`,
        }).then((response) => {
          // 404 means the backend holds no matching record — the desired state.
          if (!response.ok && response.status !== 404) throw new Error(`workspace delete returned ${response.status}`);
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
      setQueuedChatDrafts(pruneConversationState);
      setComposerSelections(pruneConversationState);
      setComposerAttachments(pruneConversationState);
      setSelectedSkills(pruneConversationState);
      setTurnIds(pruneConversationState);
      setThinkingConversations(pruneConversationState);
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
    [activeBackendConnectionId, activeWorkspaceId, connectionState, conversations, settings, unsubscribeV2Conversation, workspaces],
  );

  const renameWorkspace = useCallback((workspaceId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) {
      desktopAlert(t('alert.nameRequired'), t('alert.workspaceNameBody'));
      return;
    }
    updateWorkspace(workspaceId, { name: nextName });
  }, [updateWorkspace]);

  const forkWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
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

  const sendWorkspaceCommand = useCallback(
    (workspace: WorkspaceRecord, type: string, extra: Record<string, unknown> = {}, conversation?: ConversationRecord | null) => {
      const sessionId = conversation ? sessionIdForConversation(workspace, conversation) : workspace.sessionId;
      const payload = {
        codexSessionId: sessionId,
        tenantId: workspace.tenantId,
        ...extra,
      };
      return sendProtocolMessage(type, payload);
    },
    [sendProtocolMessage],
  );

  const attachWorkspaceConversation = useCallback((workspace: WorkspaceRecord, conversation: ConversationRecord) => {
    if (isV2Conversation(conversation)) {
      if (!conversation.v2ConversationId) {
        return true;
      }
      return subscribeV2Conversation(conversation.v2ConversationId, {
        afterSequence: 0,
        limit: CHAT_ATTACH_REPLAY_LIMIT,
      });
    }
    const sessionId = sessionIdForConversation(workspace, conversation);
    const afterCursor = sessionCursorsRef.current.get(sessionId) ?? null;
    return sendWorkspaceCommand(workspace, 'codex.local.attach', {
      afterCursor,
      replayLimit: CHAT_ATTACH_REPLAY_LIMIT,
    }, conversation);
  }, [sendWorkspaceCommand, subscribeV2Conversation]);

  const sendLocalMethodRequest = useCallback((
    workspace: WorkspaceRecord,
    conversation: ConversationRecord,
    method: string,
    params: Record<string, unknown> | null,
    requestId = createRequestId('local-method'),
  ) => {
    return sendProtocolMessage('codex.local.request', {
      codexSessionId: sessionIdForConversation(workspace, conversation),
      tenantId: workspace.tenantId,
      method,
      params,
    }, requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
    });
  }, [sendProtocolMessage]);

  const startLocalAdapter = useCallback(
    (workspace: WorkspaceRecord, conversation: ConversationRecord) => {
      const sessionId = sessionIdForConversation(workspace, conversation);
      const currentState = localConversationStateOf(conversation);
      const existingPending = pendingLocalStartsRef.current.get(conversation.id);

      if (currentState === 'running' && !existingPending) {
        return Promise.resolve(true);
      }

      if (existingPending) {
        return existingPending.promise.then(() => true);
      }

      return new Promise<boolean>((resolve, reject) => {
        const requestId = createRequestId('local-start');
        let settleResolve: () => void = () => {};
        let settleReject: (reason: Error) => void = () => {};
        const promise = new Promise<void>((innerResolve, innerReject) => {
          settleResolve = innerResolve;
          settleReject = innerReject;
        });
        // The shared entry rejects even when no concurrent waiter attached;
        // mark it handled so a timeout can't surface as an unhandled rejection.
        void promise.catch(() => {});
        const timeoutId = setTimeout(() => {
          pendingLocalStartsRef.current.delete(conversation.id);
          updateConversation(conversation.id, { localAdapterState: 'error' });
          const error = new Error(t('chat.localStartTimeoutDetail'));
          setLastError(error.message);
          pushSystem('本地会话启动超时', error.message);
          settleReject(error);
          reject(error);
        }, 15000);

        pendingLocalStartsRef.current.set(conversation.id, {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          sessionId,
          requestId,
          promise,
          resolve: () => {
            settleResolve();
            resolve(true);
          },
          reject: (reason) => {
            settleReject(reason);
            reject(reason);
          },
          timeoutId,
        });

        updateConversation(conversation.id, { sessionId, localAdapterState: 'starting' });

        const sent = sendProtocolMessage('codex.local.start', {
          codexSessionId: sessionId,
          tenantId: workspace.tenantId,
          cwd: workspace.path,
          model: workspace.model || settings.defaultModel || undefined,
          approvalPolicy: workspace.approvalPolicy,
          approvalsReviewer: workspace.approvalsReviewer || settings.approvalsReviewer || undefined,
          sandboxMode: workspace.sandboxMode,
          configOverrides: {
            reasoningEffort: workspace.reasoningEffort || settings.defaultReasoningEffort || undefined,
          },
        }, requestId);

        if (!sent) {
          clearTimeout(timeoutId);
          pendingLocalStartsRef.current.delete(conversation.id);
          updateConversation(conversation.id, { localAdapterState: 'error' });
          const error = new Error(t('sess.connectBackendFirst'));
          reject(error);
        }
      });
    },
    [pushSystem, sendProtocolMessage, settings.approvalsReviewer, settings.defaultModel, settings.defaultReasoningEffort, updateConversation],
  );

  const ensureThreadId = useCallback(
    (workspace: WorkspaceRecord, conversation: ConversationRecord, forceNewThread = false) => {
      const sessionId = sessionIdForConversation(workspace, conversation);
      const currentThreadId = normalizeThreadId(conversation.threadId);
      if (!forceNewThread && currentThreadId) {
        return Promise.resolve(currentThreadId);
      }
      if (forceNewThread) {
        setConversations((current) =>
          current.map((item) =>
            item.id === conversation.id ? { ...item, threadId: '', updatedAt: Date.now() } : item,
          ),
        );
      }

      const existingPending = pendingThreadStartsRef.current.get(conversation.id);
      if (existingPending) {
        return existingPending.promise;
      }

      return new Promise<string>((resolve, reject) => {
        const requestId = createRequestId('thread-start');
        let settleResolve: (threadId: string) => void = () => {};
        let settleReject: (reason: Error) => void = () => {};
        const promise = new Promise<string>((innerResolve, innerReject) => {
          settleResolve = innerResolve;
          settleReject = innerReject;
        });
        const timeoutId = setTimeout(() => {
          pendingThreadStartsRef.current.delete(conversation.id);
          const error = new Error(t('sess.threadCreateTimeout'));
          setLastError(error.message);
          settleReject(error);
          reject(error);
        }, 15000);

        pendingThreadStartsRef.current.set(conversation.id, {
          conversationId: conversation.id,
          requestId,
          promise,
          resolve: (threadId) => {
            settleResolve(threadId);
            resolve(threadId);
          },
          reject: (reason) => {
            settleReject(reason);
            reject(reason);
          },
          timeoutId,
        });

        const sent = sendProtocolMessage('codex.local.request', {
          codexSessionId: sessionId,
          tenantId: workspace.tenantId,
          method: 'thread/start',
          params: {
            cwd: workspace.path,
            model: workspace.model || settings.defaultModel || undefined,
            reasoningEffort: workspace.reasoningEffort || settings.defaultReasoningEffort || undefined,
            approvalPolicy: workspace.approvalPolicy || settings.approvalPolicy || undefined,
            approvalsReviewer: workspace.approvalsReviewer || settings.approvalsReviewer || undefined,
            sandbox: workspace.permissionProfile ? undefined : workspace.sandboxMode || settings.sandboxMode || undefined,
            permissions: workspace.permissionProfile || undefined,
            serviceTier: workspace.serviceTier || undefined,
          },
        }, requestId);

        if (!sent) {
          clearTimeout(timeoutId);
          pendingThreadStartsRef.current.delete(conversation.id);
          const error = new Error(t('sess.connectBackendFirst'));
          settleReject(error);
          reject(error);
        }
      });
    },
    [sendProtocolMessage, settings.approvalPolicy, settings.approvalsReviewer, settings.defaultModel, settings.defaultReasoningEffort, settings.sandboxMode],
  );

  const requestNativeThreadList = useCallback(async (workspaceId: string, includeArchived = false) => {
    const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
    const conversation =
      conversationsRef.current.find((item) => item.workspaceId === workspaceId) ??
      (workspace ? createDefaultConversation(workspace) : null);
    if (!workspace || !conversation) {
      setLastError(t('sess.workspaceNotFoundRefresh'));
      return false;
    }
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.localNotStarted'));
      return false;
    }
    const existing = pendingThreadListsRef.current.get(workspaceId);
    if (existing) {
      clearTimeout(existing.timeoutId);
    }
    const requestId = createRequestId('thread-list');
    const sessionId = sessionIdForConversation(workspace, conversation);
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadListsRef.current.get(workspaceId);
      if (pending?.requestId !== requestId) {
        return;
      }
      finishPendingThreadList(pending, t('sess.requestTimeout', { method: 'thread/list' }));
    }, 10000);
    pendingThreadListsRef.current.set(workspaceId, {
      workspaceId,
      sessionId,
      requestId,
      timeoutId,
    });
    setThreadListStatusByWorkspace((current) => ({ ...current, [workspaceId]: 'loading' }));
    setThreadListErrorByWorkspace((current) => ({ ...current, [workspaceId]: '' }));
    const sent = sendLocalMethodRequest(workspace, conversation, 'thread/list', {
      cwd: workspace.path,
      archived: includeArchived ? true : false,
      limit: 100,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      sourceKinds: ['cli', 'vscode', 'appServer'],
    }, requestId);
    if (!sent) {
      finishPendingThreadList(pendingThreadListsRef.current.get(workspaceId)!, t('sess.connectBackendFirst'));
      return false;
    }
    return true;
  }, [finishPendingThreadList, sendLocalMethodRequest, startLocalAdapter]);

  const sendNativeThreadAction = useCallback(async (
    conversationId: string,
    action: PendingThreadAction['action'],
    method: string,
    paramsBuilder: (threadId: string, workspace: WorkspaceRecord, conversation: ConversationRecord) => Record<string, unknown>,
    options: {
      title?: string;
      selectResult?: boolean;
      resultConversationId?: string;
      restoreHistory?: boolean;
      showResult?: boolean;
      resultTitle?: string;
      resultDetail?: string;
    } = {},
  ) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickThread'));
      return false;
    }
    const { workspace, conversation } = context;
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.localNotStarted'));
      return false;
    }
    let threadId = normalizeThreadId(conversation.threadId);
    const canCreateThreadForAction = ![
      'archive',
      'fork',
      'resume',
      'rollback',
      'unarchive',
      'unsubscribe',
    ].includes(action);
    if (!threadId && canCreateThreadForAction) {
      try {
        threadId = await ensureThreadId(workspace, conversation, true);
      } catch (error) {
        setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.threadCreateFailed'));
        return false;
      }
    }
    if (!threadId) {
      setLastError(t('sess.noNativeThreadId'));
      return false;
    }
    const requestId = createRequestId(`thread-${action}`);
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (!pending) {
        return;
      }
      finishPendingThreadAction(pending, t('sess.requestTimeout', { method }));
    }, 10000);
    pendingThreadActionsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: options.resultConversationId ?? (options.selectResult && action === 'fork' ? createRequestId('thread') : conversation.id),
      requestId,
      action,
      timeoutId,
      sourceConversationId: conversation.id,
      title: options.title,
      restoreHistory: options.restoreHistory,
      showResult: options.showResult,
      resultTitle: options.resultTitle,
      resultDetail: options.resultDetail,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, method, paramsBuilder(threadId, workspace, conversation), requestId);
    if (!sent) {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.connectBackendFirst'));
      }
      return false;
    }
    return true;
  }, [ensureThreadId, finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const sendTrackedLocalMethod = useCallback(async (
    conversationId: string,
    action: PendingThreadAction['action'],
    method: string,
    params: Record<string, unknown> | null | undefined,
    title: string,
    detail = '',
  ) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickThread'));
      return false;
    }
    const { workspace, conversation } = context;
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.localNotStarted'));
      return false;
    }
    const requestId = createRequestId(`thread-${action}`);
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (!pending) {
        return;
      }
      finishPendingThreadAction(pending, t('sess.requestTimeout', { method }));
    }, 10000);
    pendingThreadActionsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      action,
      timeoutId,
      sourceConversationId: conversation.id,
      showResult: true,
      resultTitle: title,
      resultDetail: detail,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, method, params === undefined ? {} : params, requestId);
    if (!sent) {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.connectBackendFirst'));
      }
      return false;
    }
    return true;
  }, [finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const requestMcpInventory = useCallback(async (
    conversationId = activeConversationRef.current,
    detail: McpInventoryState['detail'] = 'toolsAndAuthOnly',
  ) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    setMcpInventoryByConversation((current) => ({
      ...current,
      [conversation.id]: {
        ...(current[conversation.id] ?? {
          status: 'idle',
          detail,
          servers: [],
          raw: null,
          error: '',
          updatedAt: 0,
        }),
        status: 'loading',
        detail,
        error: '',
      },
    }));
    try {
      await startLocalAdapter(workspace, conversation);
      const threadId = await ensureThreadId(workspace, conversation, !normalizeThreadId(conversation.threadId));
      const requestId = createRequestId('mcp-status');
      const timeoutId = setTimeout(() => {
        const pending = pendingThreadActionsRef.current.get(requestId);
        if (pending) {
          finishPendingThreadAction(pending, t('sess.requestTimeout', { method: 'mcpServerStatus/list' }));
        }
      }, 15000);
      pendingThreadActionsRef.current.set(requestId, {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        requestId,
        action: 'mcp',
        timeoutId,
        sourceConversationId: conversation.id,
        showResult: false,
        resultDetail: detail,
      });
      const sent = sendLocalMethodRequest(workspace, conversation, 'mcpServerStatus/list', {
        cursor: null,
        limit: null,
        detail,
        threadId,
      }, requestId);
      if (!sent) {
        const pending = pendingThreadActionsRef.current.get(requestId);
        if (pending) {
          finishPendingThreadAction(pending, t('sess.connectBackendFirst'));
        }
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.mcpStatusFailed');
      setMcpInventoryByConversation((current) => ({
        ...current,
        [conversation.id]: {
          ...(current[conversation.id] ?? {
            status: 'idle',
            detail,
            servers: [],
            raw: null,
            error: '',
            updatedAt: 0,
          }),
          status: 'error',
          detail,
          error: message,
          updatedAt: Date.now(),
        },
      }));
      setLastError(message);
      return false;
    }
  }, [ensureThreadId, finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const requestPermissionProfiles = useCallback(async (conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    setPermissionProfilesByConversation((current) => ({
      ...current,
      [conversation.id]: {
        ...(current[conversation.id] ?? {
          status: 'idle',
          profiles: [],
          raw: null,
          error: '',
          updatedAt: 0,
        }),
        status: 'loading',
        error: '',
      },
    }));
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.localNotStarted');
      setPermissionProfilesByConversation((current) => ({
        ...current,
        [conversation.id]: {
          ...(current[conversation.id] ?? {
            status: 'idle',
            profiles: [],
            raw: null,
            error: '',
            updatedAt: 0,
          }),
          status: 'error',
          error: message,
          updatedAt: Date.now(),
        },
      }));
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('permission-profiles');
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.requestTimeout', { method: 'permissionProfile/list' }));
      }
    }, 15000);
    pendingThreadActionsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      action: 'permissionProfiles',
      timeoutId,
      sourceConversationId: conversation.id,
      showResult: false,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'permissionProfile/list', {
      cursor: null,
      limit: null,
      cwd: workspace.path,
    }, requestId);
    if (!sent) {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.connectBackendFirst'));
      }
      return false;
    }
    return true;
  }, [finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const requestHooksCatalog = useCallback(async (conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    setHooksCatalogByConversation((current) => ({
      ...current,
      [conversation.id]: {
        ...(current[conversation.id] ?? {
          status: 'idle',
          entries: [],
          raw: null,
          error: '',
          updatedAt: 0,
        }),
        status: 'loading',
        error: '',
      },
    }));
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.localNotStarted');
      setHooksCatalogByConversation((current) => ({
        ...current,
        [conversation.id]: {
          ...(current[conversation.id] ?? {
            status: 'idle',
            entries: [],
            raw: null,
            error: '',
            updatedAt: 0,
          }),
          status: 'error',
          error: message,
          updatedAt: Date.now(),
        },
      }));
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('hooks');
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.requestTimeout', { method: 'hooks/list' }));
      }
    }, 15000);
    pendingThreadActionsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      action: 'hooks',
      timeoutId,
      sourceConversationId: conversation.id,
      showResult: false,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'hooks/list', {
      cwds: [workspace.path],
    }, requestId);
    if (!sent) {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.connectBackendFirst'));
      }
      return false;
    }
    return true;
  }, [finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const requestPluginsCatalog = useCallback(async (conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    setPluginsCatalogByConversation((current) => ({
      ...current,
      [conversation.id]: {
        ...(current[conversation.id] ?? {
          status: 'idle',
          catalog: { marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] },
          raw: null,
          error: '',
          updatedAt: 0,
        }),
        status: 'loading',
        error: '',
      },
    }));
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.localNotStarted');
      setPluginsCatalogByConversation((current) => ({
        ...current,
        [conversation.id]: {
          ...(current[conversation.id] ?? {
            status: 'idle',
            catalog: { marketplaces: [], marketplaceLoadErrors: [], featuredPluginIds: [] },
            raw: null,
            error: '',
            updatedAt: 0,
          }),
          status: 'error',
          error: message,
          updatedAt: Date.now(),
        },
      }));
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('plugins');
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.requestTimeout', { method: 'plugin/list' }));
      }
    }, 15000);
    pendingThreadActionsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      action: 'plugins',
      timeoutId,
      sourceConversationId: conversation.id,
      showResult: false,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'plugin/list', {
      cwds: [workspace.path],
      extraUserRoots: [],
    }, requestId);
    if (!sent) {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.connectBackendFirst'));
      }
      return false;
    }
    return true;
  }, [finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const requestMemorySettings = useCallback(async (conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    setMemorySettingsByConversation((current) => ({
      ...current,
      [conversation.id]: {
        ...(current[conversation.id] ?? {
          status: 'idle',
          settings: { useMemories: false, generateMemories: false },
          raw: null,
          error: '',
          updatedAt: 0,
        }),
        status: 'loading',
        error: '',
      },
    }));
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.localNotStarted');
      setMemorySettingsByConversation((current) => ({
        ...current,
        [conversation.id]: {
          ...(current[conversation.id] ?? {
            status: 'idle',
            settings: { useMemories: false, generateMemories: false },
            raw: null,
            error: '',
            updatedAt: 0,
          }),
          status: 'error',
          error: message,
          updatedAt: Date.now(),
        },
      }));
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('memory-settings');
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.requestTimeout', { method: 'config/read' }));
      }
    }, 15000);
    pendingThreadActionsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      action: 'memorySettings',
      timeoutId,
      sourceConversationId: conversation.id,
      showResult: false,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'config/read', {
      cwd: workspace.path,
    }, requestId);
    if (!sent) {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.connectBackendFirst'));
      }
      return false;
    }
    return true;
  }, [finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const updateMemorySettings = useCallback(async (
    conversationId: string,
    patch: Partial<CodexMemorySettings>,
  ) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    const previousSettings = memorySettingsByConversation[conversation.id]?.settings ?? {
      useMemories: false,
      generateMemories: false,
    };
    const nextMemorySettings: CodexMemorySettings = {
      ...previousSettings,
      ...patch,
    };
    const edits = [
      patch.useMemories === undefined
        ? null
        : { keyPath: 'memories.use_memories', value: patch.useMemories, mergeStrategy: 'replace' },
      patch.generateMemories === undefined
        ? null
        : { keyPath: 'memories.generate_memories', value: patch.generateMemories, mergeStrategy: 'replace' },
    ].filter((edit): edit is { keyPath: string; value: boolean; mergeStrategy: string } => Boolean(edit));
    if (!edits.length) {
      return true;
    }
    setMemorySettingsByConversation((current) => ({
      ...current,
      [conversation.id]: {
        ...(current[conversation.id] ?? {
          raw: null,
          error: '',
          updatedAt: 0,
        }),
        status: 'saving',
        settings: nextMemorySettings,
        error: '',
        updatedAt: Date.now(),
      },
    }));
    try {
      await startLocalAdapter(workspace, conversation);
      if (
        patch.generateMemories !== undefined &&
        patch.generateMemories !== previousSettings.generateMemories
      ) {
        const threadId = await ensureThreadId(workspace, conversation, !normalizeThreadId(conversation.threadId));
        sendLocalMethodRequest(workspace, conversation, 'thread/memoryMode/set', {
          threadId,
          mode: patch.generateMemories ? 'enabled' : 'disabled',
        }, createRequestId('memory-mode'));
      }
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.memorySetFailed');
      setMemorySettingsByConversation((current) => ({
        ...current,
        [conversation.id]: {
          ...(current[conversation.id] ?? {
            settings: nextMemorySettings,
            raw: null,
            error: '',
            updatedAt: 0,
          }),
          status: 'error',
          error: message,
          updatedAt: Date.now(),
        },
      }));
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('memory-settings-save');
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.requestTimeout', { method: 'config/batchWrite' }));
      }
    }, 15000);
    pendingThreadActionsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      action: 'memorySettings',
      timeoutId,
      sourceConversationId: conversation.id,
      showResult: false,
      memorySettings: nextMemorySettings,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'config/batchWrite', {
      edits,
      reloadUserConfig: true,
    }, requestId);
    if (!sent) {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.connectBackendFirst'));
      }
      return false;
    }
    return true;
  }, [ensureThreadId, finishPendingThreadAction, getConversationContext, memorySettingsByConversation, sendLocalMethodRequest, startLocalAdapter]);

  const resetMemories = useCallback(async (conversationId: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.localNotStarted');
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('memory-reset');
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.requestTimeout', { method: 'memory/reset' }));
      }
    }, 15000);
    pendingThreadActionsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      action: 'memoryReset',
      timeoutId,
      sourceConversationId: conversation.id,
      showResult: false,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'memory/reset', null, requestId);
    if (!sent) {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, t('sess.connectBackendFirst'));
      }
      return false;
    }
    appendTimeline(makeSystemEntry('Memory reset requested', t('sess.memoryResetRequested'), workspace.id, conversation.id));
    return true;
  }, [appendTimeline, finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const applyConversationPermissionMode = useCallback(async (
    conversationId: string,
    mode: 'ask' | 'auto' | 'full-access',
  ): Promise<boolean> => {
    const context = getConversationContext(conversationId);
    if (!context) return false;
    const config = conversationPermissionCapabilities(context.conversation, v2ProvidersRef.current);
    if (!config?.modes?.includes(mode)) {
      setLastError(t('sess.permissionModeUnsupported'));
      return false;
    }
    if (pendingV2SubmissionsRef.current.has(conversationId) || thinkingConversationsRef.current[conversationId] === true) {
      setLastError(t('sess.permissionWait'));
      return false;
    }
    conversationsRef.current = conversationsRef.current.map((item) => item.id === conversationId ? { ...item, permissionMode: mode } : item);
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
    const config = conversationPermissionCapabilities(context.conversation, v2ProvidersRef.current);
    if (mode === 'plan' && !config?.supportsPlan) {
      setLastError(t('sess.workModeUnsupported'));
      return false;
    }
    if (pendingV2SubmissionsRef.current.has(conversationId) || thinkingConversationsRef.current[conversationId] === true) {
      setLastError(t('sess.workModeWait'));
      return false;
    }
    conversationsRef.current = conversationsRef.current.map((item) => item.id === conversationId ? { ...item, mode } : item);
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

  const setWorkspaceServiceTier = useCallback((conversationId: string, nextTier: string, title: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    const model = workspace.model || settings.defaultModel;
    updateWorkspace(workspace.id, { serviceTier: nextTier });
    appendTimeline(makeSystemEntry(
      title,
      `${modelDisplayLabel(model, modelCatalog)} · ${serviceTierLabel(nextTier)}`,
      workspace.id,
      conversation.id,
    ));
    const threadId = normalizeThreadId(conversation.threadId);
    if (threadId) {
      sendLocalMethodRequest(workspace, conversation, 'thread/settings/update', {
        threadId,
        serviceTier: nextTier,
      }, createRequestId('service-tier'));
    }
    return true;
  }, [appendTimeline, getConversationContext, modelCatalog, sendLocalMethodRequest, settings.defaultModel, updateWorkspace]);

  const applyServiceTier = useCallback((conversationId: string, serviceTier: CodexServiceTierOption) => {
    return setWorkspaceServiceTier(conversationId, serviceTier.id, `${serviceTierLabel(serviceTier.id)} service tier enabled`);
  }, [setWorkspaceServiceTier]);

  const toggleFastServiceTier = useCallback((conversationId: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace } = context;
    const model = workspace.model || settings.defaultModel;
    const fastTier = fastServiceTierForModel(model, modelCatalog);
    const currentTier = workspace.serviceTier || null;
    const fastEnabled = currentTier === fastTier.id || currentTier === 'fast';
    const nextTier = fastEnabled ? 'default' : fastTier.id;
    return setWorkspaceServiceTier(
      conversationId,
      nextTier,
      nextTier === fastTier.id ? 'Fast mode enabled' : 'Fast mode disabled',
    );
  }, [getConversationContext, modelCatalog, setWorkspaceServiceTier, settings.defaultModel]);

  const applyPersonality = useCallback((conversationId: string, personality: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    const normalized = personality.toLowerCase();
    updateWorkspace(workspace.id, { personality: normalized });
    appendTimeline(makeSystemEntry(
      `Personality set to ${personalityLabel(normalized)}`,
      normalized,
      workspace.id,
      conversation.id,
    ));
    const threadId = normalizeThreadId(conversation.threadId);
    if (threadId) {
      sendLocalMethodRequest(workspace, conversation, 'thread/settings/update', {
        threadId,
        personality: normalized,
      }, createRequestId('personality'));
    }
    return true;
  }, [appendTimeline, getConversationContext, sendLocalMethodRequest, updateWorkspace]);

  const submitFeedback = useCallback((
    conversationId: string,
    classification: string,
    reason: string,
    includeLogs: boolean,
  ) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    const trimmedReason = reason.trim();
    const threadId = normalizeThreadId(conversation.threadId);
    const sent = sendLocalMethodRequest(workspace, conversation, 'feedback/upload', {
      classification,
      reason: trimmedReason || undefined,
      threadId: threadId || undefined,
      includeLogs,
    }, createRequestId('feedback'));
    if (!sent) {
      setLastError(t('sess.connectBackendFirst'));
      return false;
    }
    appendTimeline(makeSystemEntry(
      'Feedback submitted',
      `${classification}${trimmedReason ? ` · ${trimmedReason}` : ''}${includeLogs ? ' · with logs' : ''}`,
      workspace.id,
      conversation.id,
    ));
    return true;
  }, [appendTimeline, getConversationContext, sendLocalMethodRequest, setLastError]);

  const requestGitDiff = useCallback(async (conversationId = activeConversationRef.current, cwd = '') => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    setGitDiffByConversation((current) => ({
      ...current,
      [conversation.id]: {
        ...(current[conversation.id] ?? {
          status: 'idle',
          diff: '',
          sha: '',
          error: '',
          updatedAt: 0,
        }),
        status: 'loading',
        error: '',
      },
    }));
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.localNotStarted');
      setGitDiffByConversation((current) => ({
        ...current,
        [conversation.id]: {
          ...(current[conversation.id] ?? {
            status: 'idle',
            diff: '',
            sha: '',
            error: '',
            updatedAt: 0,
          }),
          status: 'error',
          error: message,
          updatedAt: Date.now(),
        },
      }));
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('git-diff');
    const timeoutId = setTimeout(() => {
      const pending = pendingGitDiffsRef.current.get(requestId);
      if (pending) {
        finishPendingGitDiff(pending, t('sess.requestTimeout', { method: 'gitDiffToRemote' }));
      }
    }, 15000);
    pendingGitDiffsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      timeoutId,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'gitDiffToRemote', { cwd: cwd.trim() || workspace.path }, requestId);
    if (!sent) {
      const pending = pendingGitDiffsRef.current.get(requestId);
      if (pending) {
        finishPendingGitDiff(pending, t('sess.connectBackendFirst'));
      }
      return false;
    }
    return true;
  }, [finishPendingGitDiff, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

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
    if (connectionState === 'open') {
      requestTerminalStatus(target);
    }
  }, [connectionState, getConversationContext, requestTerminalStatus, seedTerminalState]);

  const requestSkillList = useCallback(async (conversationId = activeConversationRef.current, forceReload = false) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickCodexConversation'));
      return false;
    }
    const { workspace, conversation } = context;
    setSkillListConversationId(conversation.id);
    setSkillListVisible(true);
    setSkillListStatus('loading');
    setSkillListError('');
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : t('sess.localNotStarted');
      setSkillListStatus('error');
      setSkillListError(message);
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('skills');
    const timeoutId = setTimeout(() => {
      const pending = pendingSkillListsRef.current.get(requestId);
      if (pending) {
        finishPendingSkillList(pending, t('sess.requestTimeout', { method: 'skills/list' }));
      }
    }, 15000);
    pendingSkillListsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      timeoutId,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'skills/list', {
      cwds: [workspace.path],
      forceReload,
    }, requestId);
    if (!sent) {
      const pending = pendingSkillListsRef.current.get(requestId);
      if (pending) {
        finishPendingSkillList(pending, t('sess.connectBackendFirst'));
      }
      return false;
    }
    return true;
  }, [finishPendingSkillList, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

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

  const loadNativeThreadHistory = useCallback((conversationId: string, force = false) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      return false;
    }
    const threadId = normalizeThreadId(context.conversation.threadId);
    if (!threadId) {
      return false;
    }
    const loadedAt = loadedNativeThreadHistoryRef.current.get(threadId) ?? 0;
    if (!force && loadedAt >= context.conversation.updatedAt) {
      return true;
    }
    if (!force && unmaterializedNativeThreadIdsRef.current.has(threadId)) {
      return true;
    }
    void sendNativeThreadAction(
      conversationId,
      'read',
      'thread/read',
      (currentThreadId) => ({ threadId: currentThreadId, includeTurns: true }),
      { restoreHistory: true },
    );
    return true;
  }, [getConversationContext, sendNativeThreadAction]);

  // Only local, never-started placeholders are disposable. A remote ID may
  // represent history that has not been loaded yet.
  const isUnusedConversation = useCallback((conversation: ConversationRecord) => (
    !conversation.archived
    && !conversation.v2ConversationId
    && !conversation.preview?.trim()
    && !turnIdsRef.current[conversation.id]
    && !pendingV2ConversationCreatesRef.current.has(conversation.id)
    && !pendingV2FirstPromptsRef.current.has(conversation.id)
    && canSwitchConversationAgent(conversation, {
      timeline: timelineRef.current,
      thinking: thinkingConversationsRef.current[conversation.id] === true,
    })
  ), []);

  useEffect(() => {
    if (!hydrated || !conversations.some((item) => item.id === activeConversationId && item.workspaceId === activeWorkspaceId)) return;
    const unusedIds = new Set(conversations
      .filter((item) => item.id !== activeConversationId && isUnusedConversation(item))
      .map((item) => item.id));
    if (unusedIds.size === 0) return;
    conversationsRef.current = conversationsRef.current.filter((item) => !unusedIds.has(item.id));
    setConversations((current) => current.filter((item) => !unusedIds.has(item.id)));
    const withoutUnused = <T,>(current: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !unusedIds.has(id)));
    setChatDrafts(withoutUnused);
    setQueuedChatDrafts(withoutUnused);
    setComposerSelections(withoutUnused);
    setComposerAttachments(withoutUnused);
    setSelectedSkills(withoutUnused);
  }, [activeConversationId, activeWorkspaceId, conversations, hydrated, isUnusedConversation]);

  const createConversation = useCallback((
    workspaceId: string,
    options?: { provider?: ProviderKind; providerProfile?: string; title?: string; backendConnectionId?: string },
  ) => {
    const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
    if (!workspace) {
      desktopAlert(t('alert.workspaceNotFound'), t('alert.workspaceNotFoundBody'));
      return null;
    }
    const agent = resolveCreateConversationAgent({
      requestedProvider: options?.provider,
      requestedProfile: options?.providerProfile,
      providers: v2ProvidersRef.current,
      conversations: conversationsRef.current,
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

    const backendProfile = backendConnections.find((item) => item.id === options?.backendConnectionId) ?? backendConnections.find((item) => item.id === workspace.backendConnectionId);
    const backendConnectionId = backendProfile?.id ?? workspace.backendConnectionId ?? null;
    const rememberedSelection = resolveRememberedProviderSelection(backendConnectionId, agent.provider);
    const runModes = rememberedRunModes(
      providerModelPreferencesRef.current[providerModelPreferenceKey(backendConnectionId, agent.provider)],
      v2ProvidersRef.current.find((item) => item.id === agent.provider)?.capabilities.permissionConfig,
    );
    const existing = conversationsRef.current.find((item) =>
      item.workspaceId === workspaceId
      && item.backendConnectionId === backendConnectionId
      && isUnusedConversation(item));
    if (existing && existing.provider && !options?.provider && !options?.title) {
      const record = { ...existing, permissionMode: runModes.permissionMode, mode: runModes.mode };
      if (record.permissionMode !== existing.permissionMode || record.mode !== existing.mode) {
        conversationsRef.current = conversationsRef.current.map((item) => item.id === record.id ? record : item);
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
      createdAt: now,
      updatedAt: now,
    };
    conversationsRef.current = [placeholder, ...conversationsRef.current.filter((item) => item.id !== placeholder.id)];
    setConversations((current) => [placeholder, ...current.filter((item) => item.id !== placeholder.id)]);
    setActiveWorkspaceId(workspace.id);
    setActiveConversationId(placeholder.id);
    return placeholder;
  }, [backendConnections, isUnusedConversation, resolveRememberedProviderSelection]);

  /** Open a backend-validated worktree as a separate workspace/conversation. */
  const openGitWorktree = useCallback((path: string, sourceConversationId: string): {
    workspace: WorkspaceRecord; conversation: ConversationRecord;
  } | null => {
    const source = conversationsRef.current.find(item => item.id === sourceConversationId);
    const sourceWorkspace = source && workspacesRef.current.find(item => item.id === source.workspaceId);
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
    let workspace = workspacesRef.current.find(item =>
      (item.backendConnectionId ?? activeBackendConnectionIdRef.current) === backendId
      && pathKey(item.path) === pathKey(targetPath));
    let conversation = workspace && conversationsRef.current.find(item =>
      item.workspaceId === workspace!.id
      && (item.backendConnectionId ?? workspace!.backendConnectionId ?? backendId) === backendId);
    if (!workspace) {
      // createWorkspace owns the normal defaults and sidebar selection. Publish
      // its records to refs immediately so a second click cannot create duplicates.
      const created = createWorkspace(displayNameFromPath(targetPath), targetPath);
      if (!created) return null;
      workspace = { ...created.workspace, backendConnectionId: backendId,
        model: sourceWorkspace.model, reasoningEffort: sourceWorkspace.reasoningEffort,
        approvalPolicy: sourceWorkspace.approvalPolicy, approvalsReviewer: sourceWorkspace.approvalsReviewer,
        sandboxMode: sourceWorkspace.sandboxMode, permissionProfile: sourceWorkspace.permissionProfile,
        serviceTier: sourceWorkspace.serviceTier, personality: sourceWorkspace.personality };
      workspacesRef.current = [workspace, ...workspacesRef.current.filter(item => item.id !== workspace!.id)];
      const record = workspace;
      setWorkspaces(current => [record, ...current.filter(item => item.id !== record.id)]);
      conversation = created.conversation;
    }
    if (!conversation || !conversationsRef.current.some(item => item.id === conversation!.id)) {
      conversation = { ...(conversation ?? createDefaultConversation(workspace)),
        backendConnectionId: backendId, provider: source.provider, providerProfile: source.providerProfile,
        model: source.model, reasoningEffort: source.reasoningEffort, mode: source.mode,
        permissionMode: source.permissionMode };
      const record = conversation;
      conversationsRef.current = [record, ...conversationsRef.current.filter(item => item.id !== record.id)];
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
      timeline: timelineRef.current.filter((entry) => entry.conversationId === conversation.id),
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
    conversationsRef.current = conversationsRef.current.map((item) => (
      item.id === conversation.id ? { ...item, ...patch } : item
    ));
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
    updateConversation(conversationId, { title: nextTitle });
    void sendNativeThreadAction(
      conversationId,
      'rename',
      'thread/name/set',
      (threadId) => ({ threadId, name: nextTitle }),
      { title: nextTitle },
    );
  }, [getConversationContext, sendNativeThreadAction, updateConversation]);

  const forkConversation = useCallback((conversationId: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noConversation'), t('alert.pickThread'));
      return null;
    }
    const { workspace, conversation } = context;
    if (conversation.v2ConversationId) {
      const provider = v2ProvidersRef.current.find((item) => item.id === conversation.provider);
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
          const result = await sendProtocolCommand({ id: createRequestId('fork'), type: 'conversation.fork', payload: {
            conversationId: conversation.v2ConversationId, title: t('sess.forkTitle', { title: conversation.title || t('sess.conversation') }),
          } }, 45_000);
          if (typeof result.conversationId !== 'string') throw new Error(t('sess.forkNoId'));
          const api = backendApi(settings);
          const created = await api.getConversation(result.conversationId);
          const record = { ...conversationFromManifest(created, workspace.id), backendConnectionId: conversation.backendConnectionId,
            model: conversation.model, reasoningEffort: conversation.reasoningEffort,
            permissionMode: conversation.permissionMode, mode: conversation.mode };
          conversationsRef.current = [record, ...conversationsRef.current.filter((item) => item.id !== record.id)];
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
    const threadId = normalizeThreadId(conversation.threadId);
    if (!threadId) {
      setLastError(t('sess.noForkableThread'));
      return null;
    }

    const nextConversation = {
      ...forkConversationRecord(conversation),
      workspaceId: workspace.id,
      title: `${conversation.title || 'Thread'} fork`,
    };
    setConversations((current) => [nextConversation, ...current]);
    setActiveWorkspaceId(workspace.id);
    setActiveConversationId(nextConversation.id);
    void sendNativeThreadAction(
      conversation.id,
      'fork',
      'thread/fork',
      (sourceThreadId) => ({
        threadId: sourceThreadId,
        cwd: workspace.path,
        model: workspace.model || settings.defaultModel || undefined,
        approvalPolicy: workspace.approvalPolicy || settings.approvalPolicy || undefined,
        approvalsReviewer: workspace.approvalsReviewer || settings.approvalsReviewer || undefined,
        sandbox: workspace.permissionProfile ? undefined : workspace.sandboxMode || settings.sandboxMode || undefined,
        permissions: workspace.permissionProfile || undefined,
      }),
      { selectResult: true, resultConversationId: nextConversation.id },
    );
    return nextConversation;
  }, [getConversationContext, recoverConversation, sendProtocolCommand, settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, sendNativeThreadAction, settings.approvalPolicy, settings.approvalsReviewer, settings.defaultModel, settings.sandboxMode, subscribeV2Conversation]);

  const removeConversation = useCallback((conversationId: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      return;
    }
    const { workspace, conversation } = context;
    const nextActive = conversationsRef.current.find(
      (item) => item.workspaceId === workspace.id && item.id !== conversationId && item.archived !== true,
    );
    updateConversation(conversationId, { archived: true, nativeStatus: 'archived' });
    setChatDrafts((current) => {
      const { [conversationId]: _removed, ...rest } = current;
      return rest;
    });
    setQueuedChatDrafts((current) => {
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
    setTerminalById((current) => {
      const terminalId = terminalIdForConversation(conversationId);
      const { [terminalId]: _removed, ...rest } = current;
      return rest;
    });
    if (activeConversationRef.current === conversationId) {
      setActiveConversationId(nextActive?.id ?? '');
    }
    if (conversation.v2ConversationId) {
      unsubscribeV2Conversation(conversation.v2ConversationId);
    }
    if (normalizeThreadId(conversation.threadId)) {
      void sendNativeThreadAction(conversationId, 'archive', 'thread/archive', (threadId) => ({ threadId }));
    }
  }, [getConversationContext, sendNativeThreadAction, unsubscribeV2Conversation, updateConversation]);

  const promptSkillsFromAttachments = useCallback((skills: SelectedSkillAttachment[]): PromptSkillRef[] => {
    return skills
      .filter((skill) => Boolean(skill.resourceId))
      .map((skill) => ({ resourceId: skill.resourceId as string, name: skill.name }));
  }, []);

  const promptContentFromAttachments = useCallback((attachments: ComposerAttachmentDraft[]): PromptContentRef[] => {
    const content: PromptContentRef[] = [];
    for (const attachment of attachments) {
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
      const provider = v2ProvidersRef.current.find(
        (item) => item.id === conversation.provider && item.available,
      );
      if (!provider) {
        const descriptor = v2ProvidersRef.current.find((item) => item.id === conversation.provider);
        desktopAlert(t('alert.agentUnavailable'), descriptor?.unavailableReason || t('alert.agentUnavailableBody'));
        return null;
      }

      const backendProfile = backendConnections.find((item) => item.id === conversation.backendConnectionId)
        ?? backendConnections.find((item) => item.id === workspace.backendConnectionId);
      const backendConnectionId = backendProfile?.id ?? workspace.backendConnectionId ?? null;
      const title = conversation.title.trim();
      const isDefaultTitle = isDefaultConversationTitle(title);
      const firstMessageTitle = firstMessageText.trim().slice(0, 18);

      try {
        const api = backendApi(backendProfile ?? settings);
        const created = await api.createConversation({
          provider: provider.id,
          workspace: workspace.path,
          title: isDefaultTitle ? firstMessageTitle || undefined : title || undefined,
          providerProfile: conversation.providerProfile && provider.profiles.includes(conversation.providerProfile)
            ? conversation.providerProfile
            : provider.profiles[0],
        });
        const latestConversation = conversationsRef.current.find((item) => item.id === conversationId)
          ?? conversation;
        const record: ConversationRecord = {
          ...latestConversation,
          ...conversationFromManifest(created, workspace.id),
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
        conversationsRef.current = replaceConversation(conversationsRef.current);
        setConversations(replaceConversation);
        setV2Conversations((current) => [
          created,
          ...current.filter((item) => item.id !== created.id),
        ]);
        void recoverConversation(record.id);
        subscribeV2Conversation(created.id, { afterSequence: 0, limit: 200 });
        return record;
      } catch (error) {
        const message = error instanceof ConnectionError
          ? `${error.userMessage}（${error.technicalDetails}）`
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
  }, [backendConnections, getConversationContext, recoverConversation, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.serverUrl, subscribeV2Conversation]);

  const sendV2Prompt = useCallback(
    async (
      text: string,
      conversationId = activeConversationRef.current,
      skills: SelectedSkillAttachment[] = [],
      rawAttachments: ComposerAttachmentDraft[] = [],
      queuedRequestId?: string,
    ): Promise<boolean> => {
      const context = getConversationContext(conversationId);
      if (!context) {
        desktopAlert(t('alert.noConversation'), t('alert.pickWorkspaceAndConversation'));
        return false;
      }
      const { workspace, conversation } = context;
      // Reference attachments only send while their [引用:name] token is in the text.
      const attachments = liveComposerAttachments(text, rawAttachments);
      if (!isV2Conversation(conversation) || !conversation.provider) {
        desktopAlert(t('alert.notV2'), t('alert.notV2Body'));
        return false;
      }

      const permissionMode = conversationPermissionMode(conversation, workspace, v2ProvidersRef.current);
      if (!permissionMode) {
        setLastError(t('sess.permissionSelectRequired'));
        return false;
      }
      const permissionConfig = conversationPermissionCapabilities(conversation, v2ProvidersRef.current);
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
      // single gate moves it to the candidate queue until the reset passes.
      // Queue dispatches report false instead so their entry stays at the head.
      const rateLimitWait = rateLimitedUntilRef.current[conversation.id];
      if (rateLimitWait && rateLimitWait.until > Date.now()) {
        if (queuedRequestId) return false;
        const queued = queuedChatDraftsRef.current[conversation.id] ?? [];
        if (queued.length >= 32) {
          setLastError(t('sess.candidateQueueFull'));
          restoreSubmission();
          return false;
        }
        queuedChatDraftsRef.current = { ...queuedChatDraftsRef.current,
          [conversation.id]: [...queued, { id: createRequestId('queued'), text, attachments, skills }] };
        setQueuedChatDrafts(queuedChatDraftsRef.current);
        appendTimeline(makeSystemEntry(t('sess.sessionLimitQueued'),
          t('sess.sessionLimitQueuedHint', { reset: rateLimitWait.label }), workspace.id, conversation.id));
        return true;
      }
      if (rateLimitWait) setConversationRateLimit(conversation.id, null);
      const socket = socketRef.current;
      if (!socket?.ready || !socketVerifiedRef.current) {
        if (autoConnectEnabled && !manualDisconnectRef.current) {
          setLastError(t('sess.reconnecting'));
          connect();
        } else {
          setLastError(t('sess.connectBackendFirst'));
        }
        // Queued dispatches keep their entry on failure; only composer sends
        // restore the draft.
        if (!queuedRequestId) restoreSubmission();
        return false;
      }
      if (attachments.some((attachment) => attachment.kind === 'image')) {
        const imageSupport = conversationImageInputSupport(conversation, v2ProvidersRef.current, {
          models: conversation.provider
            ? providerModelsFor(conversation.backendConnectionId ?? workspace.backendConnectionId, conversation.provider)
            : undefined,
          profileCapability: providerImageInputRef.current[conversation.id],
        });
        if (!imageSupport.supported) {
          setLastError(imageSupport.reason || t('image.agentUnsupportedShort'));
          if (!queuedRequestId) restoreSubmission();
          return false;
        }
      }
      const requestId = queuedRequestId ?? createRequestId('prompt');
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
          // A rate-limited failure already re-queued the prompt at the head —
          // treat it as accepted so the composer clears instead of restoring.
          const waitActive = (rateLimitedUntilRef.current[conversation.id]?.until ?? 0) > Date.now();
          if (terminal === 'turn.failed' && !waitActive) restoreSubmission();
          pendingV2SubmissionsRef.current.delete(conversation.id);
          setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: undefined }));
          if (terminal === 'turn.failed') return waitActive;
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
            const v2Id = conversationsRef.current.find((item) => item.id === conversation.id)?.v2ConversationId;
            const terminal = submission.turnId ? settledV2TurnsRef.current.get(`${v2Id}:${submission.turnId}`) : undefined;
            return terminal !== 'turn.failed';
          }
          submission.phase = 'unknown';
          setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: 'unknown' }));
          setLastError(error.message);
          setConversationThinking(conversation.id, false);
          await reconcilePendingSubmission(conversation.id);
          const latest = pendingV2SubmissionsRef.current.get(conversation.id);
          const v2Id = conversationsRef.current.find((item) => item.id === conversation.id)?.v2ConversationId;
          const terminal = v2Id && submission.turnId ? settledV2TurnsRef.current.get(`${v2Id}:${submission.turnId}`) : undefined;
          if (terminal) {
            const waitActive = (rateLimitedUntilRef.current[conversation.id]?.until ?? 0) > Date.now();
            return terminal !== 'turn.failed' || waitActive;
          }
          return latest?.phase === 'running';
        }
        // The backend was busy after all (a turn started below the loaded
        // window, or on another device): hand the prompt to its queue under
        // the same id instead of reporting the conflict.
        if (error instanceof ProtocolCommandError && error.code === 'CONFLICT' && !isFirstPrompt
          && hasBackendQueue(v2ProvidersRef.current, conversation)) {
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
          ? error.userMessage
          : error instanceof Error ? error.message : t('sess.sendFailedShort');
        setLastError(message);
        pendingV2SubmissionsRef.current.delete(conversation.id);
        setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: undefined }));
        restoreSubmission();
        return false;
      } finally {
        if (isFirstPrompt) {
          pendingV2FirstPromptsRef.current.delete(conversation.id);
        }
      }
    },
    [updateSentAttachmentRecords, appendTimeline, getConversationContext, materializeV2Conversation, reconcilePendingSubmission, v2PromptFields, sendProtocolCommand, setConversationAttachments, setConversationChatDraft, setConversationRateLimit, setConversationSelectedSkills, setConversationThinking, updateConversation, autoConnectEnabled, connect],
  );

  /** Hands a follow-up to the backend queue (`conversation.queue.add`). The
   * item id doubles as the prompt's clientRequestId, so re-adding after a
   * lost ACK or a reload is idempotent. Resolves 'started' when the
   * conversation was idle and the backend began it at once, false when it
   * was not accepted (the reason is reported). */
  const queueV2FollowUp = useCallback(async (
    conversationId: string,
    item: QueuedChatSubmission,
  ): Promise<'queued' | 'started' | false> => {
    const context = getConversationContext(conversationId);
    const v2Id = context?.conversation.v2ConversationId;
    if (!context || !v2Id) return false;
    const { workspace, conversation } = context;
    const permissionMode = conversationPermissionMode(conversation, workspace, v2ProvidersRef.current);
    if (!permissionMode) {
      setLastError(t('sess.permissionSelectRequired'));
      return false;
    }
    const attachments = liveComposerAttachments(item.text, item.attachments);
    let fields: Record<string, unknown>;
    try {
      fields = v2PromptFields(conversation, workspace, permissionMode, item.text, item.skills, attachments);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : t('sess.sendFailedShort'));
      return false;
    }
    if (attachments.length && !sentAttachmentRecordsRef.current.some((record) =>
      record.conversationId === conversation.id && record.requestId === item.id)) {
      const previews = await prepareSentAttachments(attachments);
      updateSentAttachmentRecords([...sentAttachmentRecordsRef.current,
        { conversationId: conversation.id, requestId: item.id, text: item.text, attachments: previews }]);
    }
    try {
      const frame = followUpQueueFrame('add', v2Id, { ...fields, itemId: item.id, ...(item.front ? { front: true } : {}) });
      const result = await sendProtocolCommand({ id: createRequestId('queue-add'), ...frame });
      const started = result.status === 'started';
      if (started) setConversationThinking(conversation.id, true);
      return started ? 'started' : 'queued';
    } catch (error) {
      if (!(error instanceof ProtocolCommandError && error.state === 'unknown')) {
        updateSentAttachmentRecords(sentAttachmentRecordsRef.current.filter((record) =>
          record.conversationId !== conversation.id || record.requestId !== item.id || Boolean(record.eventId)));
      }
      setLastError(error instanceof Error ? error.message : t('sess.sendFailedShort'));
      return false;
    }
  }, [getConversationContext, sendProtocolCommand, setConversationThinking, setLastError, updateSentAttachmentRecords, v2PromptFields]);

  useEffect(() => {
    queueV2FollowUpRef.current = queueV2FollowUp;
  }, [queueV2FollowUp]);

  /** Reads the backend queue into the runtime: the loaded window may not
   * hold its latest `followups.updated`. */
  const refreshFollowUpQueue = useCallback(async (conversationId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    const v2Id = conversation?.v2ConversationId;
    if (!conversation || !v2Id || !hasBackendQueue(v2ProvidersRef.current, conversation)) return;
    try {
      const result = await sendProtocolCommand({ id: createRequestId('queue-list'), ...followUpQueueFrame('list', v2Id) });
      conversationRecoveryRef.current?.adoptFollowUpQueue(v2Id, parseFollowUpQueue(result.queue));
    } catch (error) {
      setLastError(error instanceof Error ? error.message : t('sess.requestFailed', { method: 'conversation.queue.list' }));
    }
  }, [sendProtocolCommand, setLastError]);

  /** Removes one item, clears, or resumes the backend queue. */
  const editFollowUpQueue = useCallback(async (conversationId: string, operation: 'remove' | 'clear' | 'resume', itemId?: string) => {
    const v2Id = conversationsRef.current.find((item) => item.id === conversationId)?.v2ConversationId;
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

  useEffect(() => {
    refreshFollowUpQueueRef.current = refreshFollowUpQueue;
    editFollowUpQueueRef.current = editFollowUpQueue;
  }, [editFollowUpQueue, refreshFollowUpQueue]);

  const sendLocalTurn = useCallback(
    async (
      text: string,
      mode: ConversationRecord['mode'] = 'implement',
      conversationId = activeConversationRef.current,
      rawAttachments: ComposerAttachmentDraft[] = [],
      skills: SelectedSkillAttachment[] = [],
    ) => {
      const context = getConversationContext(conversationId);
      if (!context) {
        desktopAlert(t('alert.noConversation'), t('alert.pickWorkspaceAndConversation'));
        return false;
      }

      const { workspace, conversation } = context;
      const attachments = liveComposerAttachments(text, rawAttachments);
      const permissionMode = conversationPermissionMode(conversation, workspace, v2ProvidersRef.current);
      const preset = PERMISSION_PRESETS.find((item) => item.id === (permissionMode === 'ask' ? 'default' : permissionMode === 'auto' ? 'auto-review' : permissionMode));
      if (!preset) {
        setLastError(t('sess.permissionSelectSupported'));
        return false;
      }
      const workMode = conversation.mode ?? mode;
      if (workMode === 'plan' && !conversationPermissionCapabilities(conversation, v2ProvidersRef.current)?.supportsPlan) {
        setLastError(t('sess.planModeUnsupported'));
        return false;
      }
      const sessionId = sessionIdForConversation(workspace, conversation);
      const commandWorkspace = commandWorkspaceForConversation(workspace, conversation);
      const conversationThreadId = normalizeThreadId(conversation.threadId);
      try {
        await startLocalAdapter(workspace, conversation);
      } catch (error) {
        const message = error instanceof Error ? error.message : t('sess.localNotStarted');
        setLastError(localTurnErrorMessage(message));
        return false;
      }

      let threadId = '';
      try {
        threadId = await ensureThreadId(workspace, conversation, !conversationThreadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : t('sess.threadCreateFailed');
        setLastError(message);
        return false;
      }

      setConversationThinking(conversation.id, true);
      appendTimeline(makeSystemEntry(t('sess.thinkingStart'), t('sess.thinkingStartHint'), workspace.id, conversation.id));

      const payload = {
        codexSessionId: sessionId,
        tenantId: workspace.tenantId,
        threadId,
        input: codexInputFromComposer(text, attachments, skills),
        approvalPolicy: preset.approvalPolicy,
        approvalsReviewer: preset.approvalsReviewer,
        sandboxPolicy: preset.profileId ? undefined : sandboxPolicyForMode(preset.sandboxMode),
        permissions: preset.profileId,
        serviceTier: workspace.serviceTier || undefined,
        collaborationMode: {
          mode: workMode === 'plan' ? 'plan' : 'default',
          settings: {
            model: workspace.model || settings.defaultModel,
            reasoningEffort: workspace.reasoningEffort || settings.defaultReasoningEffort || undefined,
            developerInstructions: null,
          },
        },
      };

      const requestId = createRequestId('msg');
      if (attachments.length) {
        const previews = await prepareSentAttachments(attachments);
        updateSentAttachmentRecords([...sentAttachmentRecordsRef.current, {
          conversationId: conversation.id, requestId, eventId: requestId, text, attachments: previews,
        }]);
      }
      if (sendProtocolMessage('codex.local.turn', payload, requestId, {
        workspaceId: workspace.id,
        conversationId: conversation.id,
      })) {
        unmaterializedNativeThreadIdsRef.current.delete(threadId);
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === context.conversation.id
              ? {
                  ...conversation,
                  sessionId: commandWorkspace.sessionId,
                  threadId,
                  mode: workMode,
                  permissionMode: permissionMode ?? undefined,
                  title: isDefaultConversationTitle(conversation.title) ? text.slice(0, 18) || attachmentPrompt(attachments).slice(0, 18) || selectedSkillSummary(skills).slice(0, 18) || conversation.title : conversation.title,
                  updatedAt: Date.now(),
                }
              : conversation,
          ),
        );
        return true;
      }

      setConversationThinking(conversation.id, false);
      updateSentAttachmentRecords(sentAttachmentRecordsRef.current.filter((record) =>
        record.conversationId !== conversation.id || record.requestId !== requestId));
      return false;
    },
    [updateSentAttachmentRecords, appendTimeline, ensureThreadId, getConversationContext, sendProtocolMessage, setConversationThinking, settings.approvalPolicy, settings.approvalsReviewer, settings.defaultModel, settings.defaultReasoningEffort, settings.sandboxMode, startLocalAdapter],
  );

  useEffect(() => {
    sendQueuedChatDraftRef.current = async (submission, conversationId) => {
      const conversation = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
      // A dispatch that reaches a backend-queue conversation joins that queue,
      // which is safe whether or not a turn is running.
      if (hasBackendQueue(v2ProvidersRef.current, conversation)) {
        return Boolean(await queueV2FollowUp(conversationId, submission));
      }
      if (isV2Conversation(conversation)) {
        return sendV2Prompt(submission.text, conversationId, submission.skills, submission.attachments, submission.id);
      }
      return sendLocalTurn(submission.text, 'implement', conversationId, submission.attachments, submission.skills);
    };
  }, [queueV2FollowUp, sendLocalTurn, sendV2Prompt]);

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
      if (hasBackendQueue(v2ProvidersRef.current, context.conversation)) {
        return await queueV2FollowUp(conversationId, { id: createRequestId('queued'), text, attachments: [], skills: [] })
          ? 'queued' : false;
      }
      if (!queueHydrated) {
        setLastError(t('sess.candidateRestoring'));
        return false;
      }
      const items = queuedChatDraftsRef.current[conversationId] ?? [];
      if (items.length >= 32) {
        setLastError(t('sess.candidateQueueFull'));
        return false;
      }
      queuedChatDraftsRef.current = { ...queuedChatDraftsRef.current,
        [conversationId]: [...items, { id: createRequestId('queued'), text, attachments: [], skills: [] }] };
      setQueuedChatDrafts(queuedChatDraftsRef.current);
      return 'queued';
    }
    const accepted = isV2Conversation(context.conversation)
      ? await sendV2Prompt(text, conversationId)
      : await sendLocalTurn(text, context.conversation.mode ?? 'implement', conversationId);
    return accepted ? 'sent' : false;
  }, [getConversationContext, queueHydrated, queueV2FollowUp, sendLocalTurn, sendV2Prompt]);

  const toggleSelectedSkill = useCallback((conversationId: string, skill: SkillListItem) => {
    if (!skill.enabled) {
      desktopAlert(t('alert.skillDisabled'), t('alert.skillDisabledBody'));
      return;
    }
    const nextSkill: SelectedSkillAttachment = {
      name: skill.name,
      path: skill.path,
      displayName: skill.displayName,
    };
    setConversationSelectedSkills(conversationId, (current) => {
      const exists = current.some((item) => item.name === skill.name && item.path === skill.path);
      if (exists) {
        return current.filter((item) => item.name !== skill.name || item.path !== skill.path);
      }
      return [...current, nextSkill];
    });
  }, [setConversationSelectedSkills]);

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
  }, [activeWorkspace?.path, settings.deviceSecret, settings.defaultWorkspacePath, settings.encryptionProtocol, settings.encryptionPublicKey, settings.serverUrl]);

  const refreshMcpServer = useCallback((conversationId: string, resourceId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
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
    const conversation = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
    const workspace = conversation
      ? workspacesRef.current.find((item) => item.id === conversation.workspaceId) ?? null
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
        const conversation = conversationsRef.current.find((item) => item.id === conversationId || item.v2ConversationId === conversationId) ?? null;
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
      const requestSessionId = sessionIdFromEvent(request.event, data);
      const conversation = requestSessionId
        ? conversationsRef.current.find((item) => item.sessionId === requestSessionId) ?? null
        : null;
      const workspace = conversation
        ? workspacesRef.current.find((item) => item.id === conversation.workspaceId) ?? null
        : null;

      if (!requestSessionId || !workspace || !conversation) {
        desktopAlert(t('alert.noWorkspace'), t('alert.pickWorkspace'));
        return false;
      }
      return sendProtocolMessage('codex.local.approval.respond', {
        codexSessionId: requestSessionId,
        tenantId: workspace.tenantId,
        requestId: request.requestId,
        responseType: inferApprovalResponseType(request.requestType),
        response: approvalResponsePayload(
          request,
          typeof selection === 'boolean'
            ? selection
            : selection.kind === 'allow_once' || selection.kind === 'allow_always' || selection.kind === 'answer',
        ),
      }, createRequestId('msg'), {
        workspaceId: workspace.id,
        conversationId: conversation.id,
      });
    },
    [recoverConversation, sendProtocolCommand, sendProtocolMessage],
  );

  const applyPermissionPreset = useCallback(
    (preset: PermissionPreset) => {
      if (!activeConversation) {
        desktopAlert(t('alert.noWorkspace'), t('alert.pickWorkspace'));
        return;
      }
      void applyPermissionProfile(activeConversation.id, preset.profileId, preset.description, preset.approvalsReviewer);
    },
    [activeConversation, applyPermissionProfile],
  );

  const openPermissionsMenu = useCallback((conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) return;
    const config = conversationPermissionCapabilities(context.conversation, v2ProvidersRef.current);
    const selected = conversationPermissionMode(context.conversation, context.workspace, v2ProvidersRef.current);
    const labels = { ask: t('chat.permissionAsk'), auto: t('chat.permissionAuto'), 'full-access': t('chat.permissionFullAccess') };
    desktopAlert(
      t('sess.permissionSettings'),
      config?.modes?.length ? t('sess.permissionApplyNext') : t('sess.permissionNotProvided'),
      (config?.modes ?? []).map((mode) => ({
        text: `${selected === mode ? '✓ ' : ''}${labels[mode]}`,
        onPress: () => { void applyConversationPermissionMode(conversationId, mode); },
      })),
    );
  }, [applyConversationPermissionMode, getConversationContext]);

  const openModelPicker = useCallback((conversationId = activeConversationRef.current) => {
    setModelPickerPrompt({
      target: 'workspace',
      conversationId,
    });
    if (connectionState === 'open' && modelCatalogStatus !== 'loading') {
      requestModelCatalog();
    }
  }, [connectionState, modelCatalogStatus, requestModelCatalog]);

  const applyModelCommand = useCallback(
    (conversationId: string, args: string[], promptWhenEmpty = true) => {
      const context = getConversationContext(conversationId);
      if (!context) {
        desktopAlert(t('alert.noWorkspace'), t('alert.pickWorkspace'));
        return;
      }

      const { workspace, conversation } = context;
      const { model, reasoningEffort, invalidReasoningEffort } = parseModelCommandArgs(args);
      if (invalidReasoningEffort) {
        desktopAlert(
          t('alert.invalidEffort'),
          t('alert.invalidEffortBody'),
        );
        return;
      }

      if (!model && !reasoningEffort) {
        if (promptWhenEmpty) {
          setModelCommandPrompt({
            conversationId: conversation.id,
            initialValue: modelCommandInitialValue(workspace, settings),
          });
        } else {
          desktopAlert('Model', t('alert.modelInputHint'));
        }
        return;
      }

      const nextModel = model || workspace.model || settings.defaultModel;
      const nextReasoningEffort = reasoningEffort ?? normalizeReasoningEffort(workspace.reasoningEffort ?? settings.defaultReasoningEffort);
      updateWorkspace(workspace.id, {
        ...(model ? { model: nextModel } : {}),
        ...(reasoningEffort ? { reasoningEffort: nextReasoningEffort } : {}),
      });

      const detail = [
        `Model: ${nextModel || t('session.modelUnset')}`,
        `Reasoning: ${nextReasoningEffort || t('sess.defaultValue')}`,
      ].join('\n');
      appendTimeline(makeSystemEntry(
        'Model settings updated',
        t('sess.modelAppliedDetail', { detail }),
        workspace.id,
        conversation.id,
      ));
    },
    [appendTimeline, getConversationContext, settings, updateWorkspace],
  );

  const applyWorkspaceModelSelection = useCallback(
    (conversationId: string, model: string, reasoningEffort: string | null) => {
      const context = getConversationContext(conversationId);
      if (!context) {
        desktopAlert(t('alert.noWorkspace'), t('alert.pickWorkspace'));
        return;
      }
      const nextModel = model.trim();
      if (!nextModel) {
        desktopAlert(t('alert.missingModel'), t('alert.missingModelBody'));
        return;
      }
      const nextReasoningEffort = normalizeReasoningEffort(reasoningEffort) ?? defaultReasoningForModel(nextModel, modelCatalog);
      updateWorkspace(context.workspace.id, {
        model: nextModel,
        reasoningEffort: nextReasoningEffort,
      });
      appendTimeline(makeSystemEntry(
        'Model settings updated',
        [
          `Model: ${nextModel}`,
          `Reasoning: ${reasoningEffortLabel(nextReasoningEffort)}`,
          t('sess.modelAppliedFooter'),
        ].join('\n'),
        context.workspace.id,
        context.conversation.id,
      ));
    },
    [appendTimeline, getConversationContext, modelCatalog, updateWorkspace],
  );

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

  const applyDefaultModelSelection = useCallback(
    (model: string, reasoningEffort: string | null) => {
      const nextModel = model.trim();
      if (!nextModel) {
        return;
      }
      const nextReasoningEffort = normalizeReasoningEffort(reasoningEffort) ?? defaultReasoningForModel(nextModel, modelCatalog);
      setSettings((current) => ({
        ...current,
        defaultModel: nextModel,
        defaultReasoningEffort: nextReasoningEffort,
      }));
    },
    [modelCatalog],
  );

  const openThreadCommandPrompt = useCallback((conversationId: string, command: ThreadCommandPromptState['command']) => {
    if (command === 'metadata') {
      setThreadCommandPrompt({
        conversationId,
        command,
        title: 'Thread metadata',
        placeholder: 'branch main sha abc123 origin https://...',
        initialValue: '',
      });
      return;
    }
    if (command === 'memory') {
      setThreadCommandPrompt({
        conversationId,
        command,
        title: 'Thread memory',
        placeholder: 'on / off / reset',
        initialValue: '',
        warning: t('sess.memoryResetWarning'),
      });
      return;
    }
    if (command === 'shell') {
      setThreadCommandPrompt({
        conversationId,
        command,
        title: 'Thread shell command',
        placeholder: 'pwd && git status --short',
        initialValue: '',
        warning: t('sess.unsandboxedWarning'),
        multiline: true,
      });
      return;
    }
    if (command === 'items') {
      setThreadCommandPrompt({
        conversationId,
        command,
        title: 'Turn items',
        placeholder: 'turn_id',
        initialValue: turnIds[conversationId] || '',
      });
      return;
    }
    if (command === 'inject') {
      setThreadCommandPrompt({
        conversationId,
        command,
        title: 'Inject raw items',
        placeholder: '[{"type":"message","role":"user","content":[{"type":"input_text","text":"note"}]}]',
        initialValue: '[]',
        warning: t('sess.injectWarning'),
        multiline: true,
      });
      return;
    }
    setThreadCommandPrompt({
      conversationId,
      command,
      title: 'Approve denied action',
      placeholder: '{"event":{...}}',
      initialValue: '',
      warning: t('sess.guardianWarning'),
      multiline: true,
    });
  }, [turnIds]);

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
    const lastMessage = timelineRef.current.find(
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

  /** Export a conversation's user and assistant messages as Markdown, for
   * referencing it from another conversation (`@chat:`). Replays the whole
   * journal because the conversation may never have been opened here. */
  const exportConversationMarkdown = useCallback(async (conversationId: string, maxBytes?: number) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    if (!conversation) throw new Error(t('alert.noConversation'));
    const v2Id = conversation.v2ConversationId;
    const entries = v2Id
      ? await fetchConversationTranscript((id, after, limit) => decryptedHistoryReplay(id, v2ApiForConversation(id).replayEvents(id, after, limit, 'summary'), 'summary'), v2Id, conversation.workspaceId)
      : transcriptEntries(timelineRef.current.filter((entry) => entry.conversationId === conversationId));
    return conversationTranscriptMarkdown(entries, { title: conversation.title, maxBytes });
  }, [decryptedHistoryReplay, v2ApiForConversation]);

  const sendSlashCommand = useCallback(
    (input: string, conversationId = activeConversationRef.current) => {
      const trimmed = input.trim();
      if (!trimmed.startsWith('/')) {
        const conversation = conversationsRef.current.find((item) => item.id === conversationId);
        if (isV2Conversation(conversation)) { void sendV2Prompt(trimmed, conversationId); return; }
        void sendLocalTurn(trimmed, 'implement', conversationId);
        return;
      }

      const [command, ...rest] = trimmed.slice(1).trim().split(/\s+/);
      const lower = command.toLowerCase();
      const context = getConversationContext(conversationId);

      if (!context) {
        desktopAlert(t('alert.noWorkspace'), t('alert.pickWorkspace'));
        return;
      }

      const { workspace, conversation } = context;
      if (isV2Conversation(conversation)) {
        if (lower === 'memory' || lower === 'memories') {
          openSlashCommandActionPage(workspace, conversation, '/memory');
          return;
        }
        if (lower === 'compact' || lower === 'retry' || lower === 'resume') {
          const provider = v2ProvidersRef.current.find((item) => item.id === conversation.provider);
          const nativeAction = provider?.capabilities.controlActions?.includes(lower) === true;
          // Some providers expose these as catalog commands instead of control
          // actions (e.g. Claude /compact runs as a literal prompt).
          const promptCommand = conversation.provider
            ? providerCommands[conversation.provider as ProviderKind]?.find(
                (item) => item.name.toLowerCase() === lower && item.invocation === 'prompt')
            : undefined;
          if (!conversation.v2ConversationId || (!nativeAction && !promptCommand)) {
            setLastError(lower === 'resume' ? t('sess.resumeNeedsMessage') : t('sess.operationUnsupported'));
            return;
          }
          if (!nativeAction) {
            void sendV2Prompt(trimmed, conversation.id);
            return;
          }
          // An e2e backend cannot read the original request back (§7): retry
          // returns the `retryRequest` the latest user message carries, read
          // in full detail since summary pages leave it out. Messages written
          // before it existed fall back to the text this device decrypted.
          const v2Id = conversation.v2ConversationId;
          const retryFields = async (): Promise<Record<string, unknown> | null> => {
            if (lower !== 'retry' || !historyEncryptionRef.current?.e2e) return {};
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
            } }).then(() => recoverConversation(conversation.id));
          }).catch((error: unknown) => {
            setLastError(error instanceof Error ? error.message : t('sess.operationFailed'));
            void recoverConversation(conversation.id);
          });
          return;
        }
      }
      const addCommandNotice = (title: string, detail: string) => {
        appendTimeline(makeSystemEntry(title, detail, workspace.id, conversation.id));
      };

      const sendLocalMethod = (method: string, params: Record<string, unknown>, title: string, detail: string) => {
        if (sendWorkspaceCommand(workspace, 'codex.local.request', { method, params }, conversation)) {
          addCommandNotice(title, detail);
        }
      };

      const sendThreadMethod = (method: string, makeParams: (threadId: string) => Record<string, unknown>, title: string, detail: string) => {
        void (async () => {
          try {
            await startLocalAdapter(workspace, conversation);
            const threadId = await ensureThreadId(workspace, conversation, !normalizeThreadId(conversation.threadId));
            sendLocalMethod(method, makeParams(threadId), title, detail);
          } catch (error) {
            const message = error instanceof Error ? error.message : t('sess.actionFailed', { title });
            setLastError(message);
          }
        })();
      };

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

      if (lower === 'fast') {
        toggleFastServiceTier(conversation.id);
        return;
      }

      if (lower === 'model') {
        if (rest.length) {
          applyModelCommand(conversation.id, rest);
        } else {
          openModelPicker(conversation.id);
        }
        return;
      }

      if (lower === 'approve' || lower === 'approval') {
        if (/^(guardian|denied|override)$/i.test(rest[0] ?? '')) {
          openThreadCommandPrompt(conversation.id, 'guardian');
          return;
        }
        const deny = /^(deny|decline|reject|no)$/i.test(rest[0] ?? '');
        const requestId = rest[1] || selectedRequest?.requestId || '';
        const target = pendingRequests.find((request) => request.requestId === requestId) ?? selectedRequest;
        if (!target) {
          desktopAlert(t('alert.noPendingRequests'), t('alert.noPendingRequestsBody'));
          return;
        }
        sendApprovalResponse(!deny, target);
        return;
      }

      if (lower === 'skills') {
        void requestSkillList(conversation.id, /reload|refresh|true|1/i.test(rest[0] ?? ''));
        return;
      }

      if (lower === 'hooks' || lower === 'hook') {
        openSlashCommandActionPage(workspace, conversation, '/hooks');
        return;
      }

      if (lower === 'plugins' || lower === 'plugin') {
        openSlashCommandActionPage(workspace, conversation, '/plugins');
        return;
      }

      if (lower === 'apps') {
        sendLocalMethod('app/list', { limit: 50, forceRefetch: /reload|refresh|true|1/i.test(rest[0] ?? '') }, 'Apps requested', t('sess.appsRequested'));
        return;
      }

      if (lower === 'mcp') {
        const subcommand = rest[0]?.toLowerCase() ?? '';
        if (!subcommand) {
          openSlashCommandActionPage(workspace, conversation, '/mcp');
          return;
        }
        if (subcommand === 'verbose') {
          void requestMcpInventory(conversation.id, 'full');
          addCommandNotice('MCP inventory requested', t('sess.mcpInventoryDetail'));
          return;
        }
        if (/^(status|list|tools|refresh)$/i.test(subcommand)) {
          void requestMcpInventory(conversation.id, 'toolsAndAuthOnly');
          addCommandNotice('MCP inventory requested', t('sess.mcpInventory'));
          return;
        }
        desktopAlert('MCP', 'Usage: /mcp [verbose]');
        return;
      }

      if (lower === 'compact') {
        setCompactionByConversation((current) => ({ ...current, [conversation.id]: { ...current[conversation.id], status: 'running', updatedAt: new Date().toISOString() } }));
        sendThreadMethod('thread/compact/start', (threadId) => ({ threadId }), 'Compact started', t('sess.compactStarted'));
        return;
      }

      if (lower === 'goal') {
        const subcommand = rest[0]?.toLowerCase() ?? '';
        if (!subcommand || subcommand === 'edit') {
          openSlashCommandActionPage(workspace, conversation, '/goal');
          return;
        }
        if (subcommand === 'pause' || subcommand === 'resume') {
          const status = subcommand === 'pause' ? 'paused' : 'active';
          updateConversation(conversation.id, {
            goalStatus: status,
          });
          sendThreadMethod(
            'thread/goal/set',
            (threadId) => ({ threadId, status }),
            'Goal command sent',
            t('sess.sentGoalSet', { status }),
          );
          return;
        }
        const objective = subcommand === 'set' ? rest.slice(1).join(' ').trim() : rest.join(' ').trim();
        if (subcommand === 'set' && !objective) {
          desktopAlert('Goal', 'Usage: /goal <objective>');
          return;
        }
        const method =
          subcommand === 'clear'
            ? 'thread/goal/clear'
            : /^(get|show|view)$/i.test(subcommand)
              ? 'thread/goal/get'
              : 'thread/goal/set';
        if (method === 'thread/goal/set') {
          updateConversation(conversation.id, {
            goalStatus: 'active',
            goalObjective: objective,
          });
        } else if (method === 'thread/goal/clear') {
          updateConversation(conversation.id, {
            goalStatus: '',
            goalObjective: '',
          });
        }
        sendThreadMethod(
          method,
          (threadId) => (method === 'thread/goal/set' ? { threadId, objective } : { threadId }),
          'Goal command sent',
          t('sess.sentMethod', { method }),
        );
        return;
      }

      if (lower === 'rename') {
        const nextTitle = rest.join(' ').trim();
        if (!nextTitle) {
          desktopAlert('Rename', t('alert.conversationTitleBody'));
          return;
        }
        updateConversation(conversation.id, { title: nextTitle });
        if (conversation.threadId) {
          sendLocalMethod('thread/name/set', { threadId: conversation.threadId, name: nextTitle }, 'Thread rename sent', nextTitle);
        } else {
          addCommandNotice('Conversation renamed', nextTitle);
        }
        return;
      }

      if (lower === 'logout') {
        sendLocalMethod('account/logout', {}, 'Logout requested', t('sess.logoutRequested'));
        return;
      }

      if (lower === 'start') {
        void startLocalAdapter(workspace, conversation).catch(() => undefined);
        return;
      }

      if (lower === 'status') {
        const statusScope = rest[0]?.toLowerCase() ?? '';
        if (/^(thread|detail)$/i.test(statusScope)) {
          void sendNativeThreadAction(conversation.id, 'detail', 'thread/read', (threadId) => ({ threadId, includeTurns: false }), {
            showResult: true,
            resultTitle: 'Thread details',
          });
          return;
        }
        if (/^(history|read)$/i.test(statusScope)) {
          void sendNativeThreadAction(conversation.id, 'read', 'thread/read', (threadId) => ({ threadId, includeTurns: true }), {
            restoreHistory: true,
            showResult: true,
            resultTitle: 'Thread history',
          });
          return;
        }
        if (/^(turns|turn)$/i.test(statusScope)) {
          void sendNativeThreadAction(conversation.id, 'turns', 'thread/turns/list', (threadId) => ({
            threadId,
            limit: parsePositiveLimit(rest[1], 20),
            sortDirection: 'desc',
            itemsView: 'summary',
          }), {
            showResult: true,
            resultTitle: 'Thread turns',
          });
          return;
        }
        if (/^(items|item)$/i.test(statusScope)) {
          if (rest[1]) {
            void sendNativeThreadAction(conversation.id, 'items', 'thread/turns/items/list', (threadId) => ({
              threadId,
              turnId: rest[1],
              limit: parsePositiveLimit(rest[2], 50),
              sortDirection: 'asc',
            }), {
              showResult: true,
              resultTitle: 'Turn items',
            });
          } else {
            openThreadCommandPrompt(conversation.id, 'items');
          }
          return;
        }
        if (/^(loaded|loaded-threads)$/i.test(statusScope)) {
          void sendTrackedLocalMethod(conversation.id, 'loaded', 'thread/loaded/list', { limit: parsePositiveLimit(rest[1], 100) }, 'Loaded threads');
          return;
        }
        sendWorkspaceCommand(workspace, 'codex.local.status', {}, conversation);
        return;
      }

      if (lower === 'stop') {
        if (conversation.threadId) {
          sendLocalMethod('thread/backgroundTerminals/clean', { threadId: conversation.threadId }, 'Background terminals clean requested', t('sess.cleanTerminalsRequested'));
        }
        if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false }, conversation)) {
          const pending = pendingLocalStartsRef.current.get(conversation.id);
          if (pending) {
            clearTimeout(pending.timeoutId);
            pendingLocalStartsRef.current.delete(conversation.id);
            pending.reject(new Error(t('sess.localSessionStopped')));
          }
          updateConversation(conversation.id, { localAdapterState: 'stopped' });
        }
        return;
      }

      if (lower === 'clean') {
        void sendNativeThreadAction(conversation.id, 'clean', 'thread/backgroundTerminals/clean', (threadId) => ({ threadId }), {
          showResult: true,
          resultTitle: 'Background terminals clean',
        });
        if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false }, conversation)) {
          updateConversation(conversation.id, { localAdapterState: 'stopped' });
        }
        return;
      }

      if (lower === 'clear' || lower === 'new') {
        createConversation(workspace.id);
        return;
      }

      if (lower === 'archive') {
        desktopAlert('Archive thread', 'Archive this conversation and leave it from the active list?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Archive', style: 'destructive', onPress: () => removeConversation(conversation.id) },
        ]);
        return;
      }

      if (lower === 'resume') {
        if (!normalizeThreadId(conversation.threadId)) {
          setLastError(t('sess.noResumableThread'));
          return;
        }
        void sendNativeThreadAction(
          conversation.id,
          'resume',
          'thread/resume',
          (threadId) => ({ threadId }),
          { restoreHistory: true },
        );
        return;
      }

      if (lower === 'fork' || lower === 'side' || lower === 'btw') {
        void sendNativeThreadAction(
          conversation.id,
          'fork',
          'thread/fork',
          (threadId) => ({
            threadId,
            cwd: workspace.path,
            model: workspace.model || settings.defaultModel || undefined,
            approvalPolicy: workspace.approvalPolicy || settings.approvalPolicy || undefined,
            approvalsReviewer: workspace.approvalsReviewer || settings.approvalsReviewer || undefined,
            sandbox: workspace.permissionProfile ? undefined : workspace.sandboxMode || settings.sandboxMode || undefined,
            permissions: workspace.permissionProfile || undefined,
            ephemeral: lower === 'side' || lower === 'btw',
          }),
          { selectResult: true },
        );
        addCommandNotice('Thread fork sent', lower === 'side' || lower === 'btw' ? t('sess.sideThreadRequested') : t('sess.forkThreadRequested'));
        return;
      }

      if (lower === 'mention') {
        setConversationChatDraft(conversation.id, '@');
        setConversationComposerSelection(conversation.id, { start: 1, end: 1 });
        return;
      }

      if (lower === 'attach') {
        attachWorkspaceConversation(workspace, conversation);
        return;
      }

      if (lower === 'replay') {
        sendWorkspaceCommand(workspace, 'codex.local.replay', {
          afterCursor: null,
          limit: 200,
        }, conversation);
        return;
      }

      if (lower === 'interrupt') {
        const threadId = normalizeThreadId(conversation.threadId);
        if (!threadId) {
          setLastError(t('sess.noInterruptibleThreadInConversation'));
          return;
        }
        sendWorkspaceCommand(workspace, 'codex.local.interrupt', {
          threadId,
          turnId: turnIds[conversation.id] || '',
        }, conversation);
        return;
      }

      if (lower === 'review') {
        const instructions = rest.join(' ').trim();
        sendThreadMethod(
          'review/start',
          (threadId) => ({
            threadId,
            target: instructions ? { type: 'custom', instructions } : { type: 'uncommittedChanges' },
            delivery: 'inline',
          }),
          'Review started',
          instructions || 'Review uncommitted changes.',
        );
        return;
      }

      if (lower === 'init') {
        sendLocalTurn('create or update an AGENTS.md file with concise project instructions for Codex', 'implement', conversation.id);
        return;
      }

      if (lower === 'plan') {
        void applyConversationWorkMode(conversation.id, 'plan').then((selected) => {
          if (!selected || rest.length === 0) return;
          if (isV2Conversation(conversation)) void sendV2Prompt(rest.join(' '), conversation.id);
          else void sendLocalTurn(rest.join(' '), 'plan', conversation.id);
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

      if (lower === 'ps') {
        if (/^(clean|clear|stop)$/i.test(rest[0] ?? '')) {
          void sendNativeThreadAction(conversation.id, 'clean', 'thread/backgroundTerminals/clean', (threadId) => ({ threadId }), {
            showResult: true,
            resultTitle: 'Background terminals clean',
          });
          return;
        }
        void sendTrackedLocalMethod(conversation.id, 'loaded', 'thread/loaded/list', { limit: 100 }, 'Loaded threads');
        return;
      }

      if (lower === 'subagents') {
        openPanel('Subagents', { conversationId: conversation.id });
        return;
      }

      if (lower === 'personality') {
        openSlashCommandActionPage(workspace, conversation, '/personality');
        return;
      }

      if (lower === 'feedback') {
        openSlashCommandActionPage(workspace, conversation, '/feedback');
        return;
      }

      if (lower === 'copy') {
        void copyLastAgentMessage(conversation.id);
        return;
      }

      if (lower === 'memories') {
        if (rest.length) {
          const mode = parseThreadMemoryMode(rest.join(' '));
          if (mode === 'reset') {
            void sendTrackedLocalMethod(conversation.id, 'memoryReset', 'memory/reset', null, 'Memory reset');
            return;
          }
          if (mode) {
            void sendNativeThreadAction(conversation.id, 'memory', 'thread/memoryMode/set', (threadId) => ({ threadId, mode }), {
              showResult: true,
              resultTitle: 'Thread memory',
              resultDetail: `memory mode: ${mode}`,
            });
            return;
          }
        }
        openSlashCommandActionPage(workspace, conversation, '/memories');
        return;
      }

      const dynamicCommand = conversation.provider
        ? providerCommands[conversation.provider as ProviderKind]?.find(
        (item) => item.name.toLowerCase() === lower && item.invocation === 'prompt',
          )
        : undefined;
      if (dynamicCommand) {
        void sendV2Prompt(trimmed, conversation.id);
        return;
      }

      if (lower === 'quit' || lower === 'exit') {
        if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false }, conversation)) {
          updateConversation(conversation.id, { localAdapterState: 'stopped' });
          addCommandNotice(`/${lower} recognized`, t('sess.localSessionStoppedNotice'));
        }
        return;
      }

      const serviceTierCommand = serviceTierCommandForModel(lower, workspace.model || settings.defaultModel, modelCatalog);
      if (serviceTierCommand) {
        applyServiceTier(conversation.id, serviceTierCommand);
        return;
      }

      addCommandNotice(`/${lower} recognized`, t('sess.commandNotBuiltin'));
    },
    [
      applyPermissionProfile,
      applyConversationWorkMode,
      openPermissionsMenu,
      applyServiceTier,
      applyModelCommand,
      appendTimeline,
      copyLastAgentMessage,
      createConversation,
      ensureThreadId,
      getConversationContext,
      openModelPicker,
      openExperimentalFeatures,
      openSlashCommandActionPage,
      openThreadCommandPrompt,
      pendingRequests,
      requestMcpInventory,
      requestSkillList,
      removeConversation,
      selectConversation,
      selectedRequest,
      sendApprovalResponse,
      sendLocalTurn,
      sendNativeThreadAction,
      requestGitDiff,
      openGitDiff,
      sendTrackedLocalMethod,
      startLocalAdapter,
      sendWorkspaceCommand,
      attachWorkspaceConversation,
      settings,
      modelCatalog,
      openPanel,
      providerCommands,
      sendV2Prompt,
      sendProtocolCommand,
      recoverConversation,
      decryptedHistoryReplay,
      v2ApiForConversation,
      setConversationChatDraft,
      setConversationComposerSelection,
      setLastError,
      toggleFastServiceTier,
      turnIds,
      updateConversation,
      updateWorkspace,
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

  // At most one automatic start per conversation and connection: a failed
  // start used to flip the state to 'error', re-run this effect and start
  // again on every round trip.
  useEffect(() => {
    if (connectionState !== 'open') autoStartedLocalConversationsRef.current.clear();
  }, [connectionState]);

  useEffect(() => {
    if (
      !hydrated ||
      connectionState !== 'open' ||
      !activeWorkspace ||
      !shouldAutoStartLocalAdapter(activeConversation) ||
      pendingLocalStartsRef.current.has(activeConversation!.id) ||
      autoStartedLocalConversationsRef.current.has(activeConversation!.id)
    ) {
      return;
    }
    autoStartedLocalConversationsRef.current.add(activeConversation!.id);
    void startLocalAdapter(activeWorkspace, activeConversation!).catch(() => undefined);
  }, [
    activeConversation?.archived,
    activeConversation?.id,
    activeConversation?.localAdapterState,
    activeConversation?.provider,
    activeConversation?.sessionId,
    activeConversation?.threadId,
    activeConversation?.v2ConversationId,
    activeWorkspace?.approvalPolicy,
    activeWorkspace?.approvalsReviewer,
    activeWorkspace?.id,
    activeWorkspace?.model,
    activeWorkspace?.path,
    activeWorkspace?.reasoningEffort,
    activeWorkspace?.sandboxMode,
    connectionState,
    hydrated,
    startLocalAdapter,
  ]);

  useEffect(() => {
    if (!hydrated || connectionState !== 'open') {
      return;
    }
    const suspendIdleSessions = () => {
      const now = Date.now();
      const activeConversationId = activeConversationRef.current;
      conversationsRef.current.forEach((conversation) => {
        if (
          conversation.id === activeConversationId ||
          conversation.archived === true ||
          localConversationStateOf(conversation) !== 'running' ||
          now - conversation.updatedAt < LOCAL_SESSION_IDLE_SUSPEND_MS ||
          pendingLocalStartsRef.current.has(conversation.id) ||
          pendingThreadStartsRef.current.has(conversation.id) ||
          turnIdsRef.current[conversation.id] ||
          thinkingConversationsRef.current[conversation.id]
        ) {
          return;
        }
        const hasPendingThreadAction = [...pendingThreadActionsRef.current.values()].some(
          (pending) =>
            pending.conversationId === conversation.id ||
            pending.sourceConversationId === conversation.id,
        );
        if (hasPendingThreadAction) {
          return;
        }
        const hasActiveTerminal = Object.values(terminalByIdRef.current).some(
          (terminal) =>
            terminal.conversationId === conversation.id &&
            (terminal.status === 'starting' || terminal.status === 'running' || terminal.status === 'stopping'),
        );
        if (hasActiveTerminal) {
          return;
        }
        const workspace = workspacesRef.current.find((item) => item.id === conversation.workspaceId) ?? null;
        if (!workspace) {
          return;
        }
        if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false }, conversation)) {
          updateConversation(conversation.id, { localAdapterState: 'stopped' });
        }
      });
    };
    const intervalId = setInterval(suspendIdleSessions, LOCAL_SESSION_IDLE_SWEEP_MS);
    return () => clearInterval(intervalId);
  }, [connectionState, hydrated, sendWorkspaceCommand, updateConversation]);

  const stopThinking = useCallback((conversationId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
    const workspace = conversation
      ? workspacesRef.current.find((item) => item.id === conversation.workspaceId) ?? null
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
      void sendProtocolCommand(buildConversationControlMessage(v2Id, 'cancel')).then(() => {
        appendTimeline(makeSystemEntry(t('sess.stopConfirmed'), t('sess.syncingTurn'), workspace.id, conversation.id));
        return recoverConversation(conversation.id);
      }).catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : t('sess.stopUnconfirmed'));
        void recoverConversation(conversation.id);
      });
      return;
    }
    const threadId = normalizeThreadId(conversation.threadId);
    if (!threadId) {
      setLastError(t('sess.noInterruptibleThread'));
      return;
    }
    if (sendWorkspaceCommand(workspace, 'codex.local.interrupt', { threadId, turnId: turnIds[conversationId] || '' }, conversation)) {
      appendTimeline(makeSystemEntry(t('sess.stopSent'), t('sess.stopRequested'), workspace.id, conversation.id));
    }
  }, [appendTimeline, recoverConversation, sendProtocolCommand, sendWorkspaceCommand, turnIds]);

  const submitChat = useCallback((conversationId: string) => {
    const text = (chatDrafts[conversationId] ?? '').trim();
    const attachments = composerAttachments[conversationId] ?? [];
    const skills = selectedSkills[conversationId] ?? [];
    if (!text && attachments.length === 0 && skills.length === 0) {
      return;
    }
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert(t('alert.noWorkspace'), t('alert.pickWorkspace'));
      return;
    }
    const { workspace, conversation } = context;
    if (attachments.some((attachment) => attachment.kind === 'image')) {
      const imageSupport = conversationImageInputSupport(conversation, v2ProvidersRef.current, {
        models: conversation.provider
          ? providerModelsFor(conversation.backendConnectionId ?? workspace.backendConnectionId, conversation.provider)
          : undefined,
        profileCapability: providerImageInputRef.current[conversation.id],
      });
      if (!imageSupport.supported) {
        setLastError(imageSupport.reason || t('image.agentUnsupportedShort'));
        return;
      }
    }
    const isThinking = thinkingConversations[conversationId] === true;
    if (text === '/compact') {
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
      rememberMentionReferences(workspace.id, mentionReferences);
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
      setConversationChatDraft(conversationId, (current) => current.trim() === text ? '' : current);
      setConversationAttachments(conversationId, (current) => current === attachments ? [] : current);
      setConversationSelectedSkills(conversationId, (current) => current === skills ? [] : current);
      setConversationComposerSelection(conversationId, DEFAULT_COMPOSER_SELECTION);
    };
    const rateLimitWait = rateLimitedUntilRef.current[conversationId];
    if (isThinking && hasBackendQueue(v2ProvidersRef.current, conversation)
      && !(rateLimitWait && rateLimitWait.until > Date.now())) {
      void queueV2FollowUp(conversationId, { id: createRequestId('queued'), text, attachments: liveAttachments, skills })
        .then((queued) => { if (queued) clearSubmittedComposer(); });
      return;
    }
    if (isThinking) {
      const nativeQueue = v2ProvidersRef.current.find(item => item.id === conversation.provider)?.capabilities.followUpQueue === true;
      if (conversation.v2ConversationId && nativeQueue && !liveAttachments.length && !skills.length) {
        void controlConversation(conversationId, { action: 'queueAdd', itemId: createRequestId('queue'), text })
          .then(accepted => { if (accepted) clearSubmittedComposer(); });
        return;
      }
      if ((queuedChatDraftsRef.current[conversationId]?.length ?? 0) >= 32) {
        setLastError(t('sess.candidateQueueFull')); return;
      }
      clearSubmittedComposer();
      queuedChatDraftsRef.current = {
        ...queuedChatDraftsRef.current,
        [conversationId]: [...(queuedChatDraftsRef.current[conversationId] ?? []),
          { id: createRequestId('queued'), text, attachments, skills }],
      };
      setQueuedChatDrafts(queuedChatDraftsRef.current);
      appendTimeline(makeSystemEntry(t('sess.messageQueued'), t('sess.messageQueuedHint'), workspace.id, conversationId));
      return;
    }
    if (isV2Conversation(conversation)) {
      void sendV2Prompt(text, conversationId, skills, attachments).then((accepted) => {
        if (accepted) clearSubmittedComposer();
      });
      return;
    }
    clearSubmittedComposer();
    if (attachments.length > 0 || skills.length > 0) {
      void sendLocalTurn(text, 'implement', conversationId, attachments, skills);
      return;
    }
    sendSlashCommand(text, conversationId);
  }, [appendTimeline, chatDrafts, composerAttachments, controlConversation, getConversationContext, queueV2FollowUp, rememberMentionReferences, selectedSkills, sendLocalTurn, sendSlashCommand, sendV2Prompt, setConversationAttachments, setConversationChatDraft, setConversationComposerSelection, setConversationSelectedSkills, thinkingConversations]);

  const runWorkspaceCommand = useCallback((workspace: WorkspaceRecord, conversation: ConversationRecord, command: 'start' | 'status' | 'attach' | 'stop' | 'interrupt') => {
    if (command === 'start') {
      void startLocalAdapter(workspace, conversation).catch(() => undefined);
      return;
    }
    if (command === 'status') {
      sendWorkspaceCommand(workspace, 'codex.local.status', {}, conversation);
      return;
    }
    if (command === 'attach') {
      attachWorkspaceConversation(workspace, conversation);
      return;
    }
    if (command === 'interrupt') {
      const threadId = normalizeThreadId(conversation.threadId);
      if (!threadId) {
        setLastError(t('sess.noInterruptibleThreadInConversation'));
        return;
      }
      sendWorkspaceCommand(workspace, 'codex.local.interrupt', {
        threadId,
        turnId: turnIds[conversation.id] || '',
      }, conversation);
      return;
    }
    if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false }, conversation)) {
      const pending = pendingLocalStartsRef.current.get(conversation.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingLocalStartsRef.current.delete(conversation.id);
        pending.reject(new Error(t('sess.localSessionStopped')));
      }
      updateConversation(conversation.id, { localAdapterState: 'stopped' });
    }
  }, [attachWorkspaceConversation, sendWorkspaceCommand, turnIds, updateConversation, startLocalAdapter]);

  const runThreadMenuAction = useCallback((conversationId: string, action: ThreadMenuAction) => {
    if (action === 'fork') {
      forkConversation(conversationId);
      return;
    }
    if (action === 'archive') {
      removeConversation(conversationId);
      return;
    }
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    if (conversation && isV2Conversation(conversation)) {
      if (action === 'compact' || action === 'resume') {
        sendSlashCommand(`/${action}`, conversationId);
      } else if (action === 'history' || action === 'detail' || action === 'turns') {
        void recoverConversation(conversationId);
      } else {
        setLastError(t('sess.conversationActionUnsupported'));
      }
      return;
    }
    if (action === 'resume') {
      void sendNativeThreadAction(conversationId, 'resume', 'thread/resume', (threadId) => ({ threadId }), { restoreHistory: true });
      return;
    }
    if (action === 'rollback') {
      void sendNativeThreadAction(conversationId, 'rollback', 'thread/rollback', (threadId) => ({ threadId, numTurns: 1 }));
      return;
    }
    if (action === 'compact') {
      setCompactionByConversation((current) => ({ ...current, [conversationId]: { ...current[conversationId], status: 'running', updatedAt: new Date().toISOString() } }));
      void sendNativeThreadAction(conversationId, 'read', 'thread/compact/start', (threadId) => ({ threadId }), {
        showResult: true,
        resultTitle: 'Compact started',
      });
      return;
    }
    if (action === 'detail') {
      void sendNativeThreadAction(conversationId, 'detail', 'thread/read', (threadId) => ({ threadId, includeTurns: false }), {
        showResult: true,
        resultTitle: 'Thread details',
      });
      return;
    }
    if (action === 'history') {
      void sendNativeThreadAction(conversationId, 'read', 'thread/read', (threadId) => ({ threadId, includeTurns: true }), {
        restoreHistory: true,
        showResult: true,
        resultTitle: 'Thread history',
      });
      return;
    }
    if (action === 'turns') {
      void sendNativeThreadAction(conversationId, 'turns', 'thread/turns/list', (threadId) => ({
        threadId,
        limit: 20,
        sortDirection: 'desc',
        itemsView: 'summary',
      }), {
        showResult: true,
        resultTitle: 'Thread turns',
      });
      return;
    }
    if (action === 'unarchive') {
      void sendNativeThreadAction(conversationId, 'unarchive', 'thread/unarchive', (threadId) => ({ threadId }), {
        showResult: true,
        resultTitle: 'Thread unarchived',
      });
      return;
    }
    if (action === 'unsubscribe') {
      void sendNativeThreadAction(conversationId, 'unsubscribe', 'thread/unsubscribe', (threadId) => ({ threadId }), {
        showResult: true,
        resultTitle: 'Thread unsubscribe',
      });
      return;
    }
    if (action === 'loaded') {
      void sendTrackedLocalMethod(conversationId, 'loaded', 'thread/loaded/list', { limit: 100 }, 'Loaded threads');
      return;
    }
    if (action === 'clean') {
      void sendNativeThreadAction(conversationId, 'clean', 'thread/backgroundTerminals/clean', (threadId) => ({ threadId }), {
        showResult: true,
        resultTitle: 'Background terminals clean',
      });
      return;
    }
    openThreadCommandPrompt(conversationId, action);
  }, [forkConversation, openThreadCommandPrompt, recoverConversation, removeConversation, sendNativeThreadAction, sendSlashCommand, sendTrackedLocalMethod]);

  const submitThreadCommandPrompt = useCallback((prompt: ThreadCommandPromptState, value: string) => {
    const trimmed = value.trim();
    if (prompt.command === 'metadata') {
      const parsed = parseThreadMetadataPrompt(trimmed);
      if (parsed.error) {
        desktopAlert('Metadata', parsed.error);
        return;
      }
      void sendNativeThreadAction(prompt.conversationId, 'metadata', 'thread/metadata/update', (threadId) => ({
        threadId,
        gitInfo: parsed.gitInfo,
      }), {
        showResult: true,
        resultTitle: 'Thread metadata updated',
      });
      setThreadCommandPrompt(null);
      return;
    }
    if (prompt.command === 'memory') {
      const mode = parseThreadMemoryMode(trimmed);
      if (!mode) {
        desktopAlert('Memory', t('alert.memoryArgs'));
        return;
      }
      if (mode === 'reset') {
        void sendTrackedLocalMethod(prompt.conversationId, 'memoryReset', 'memory/reset', null, 'Memory reset');
      } else {
        void sendNativeThreadAction(prompt.conversationId, 'memory', 'thread/memoryMode/set', (threadId) => ({
          threadId,
          mode,
        }), {
          showResult: true,
          resultTitle: 'Thread memory',
          resultDetail: `memory mode: ${mode}`,
        });
      }
      setThreadCommandPrompt(null);
      return;
    }
    if (prompt.command === 'shell') {
      if (!trimmed) {
        desktopAlert('Shell command', t('alert.shellCommand'));
        return;
      }
      void sendNativeThreadAction(prompt.conversationId, 'shell', 'thread/shellCommand', (threadId) => ({
        threadId,
        command: trimmed,
      }), {
        showResult: true,
        resultTitle: 'Shell command sent',
        resultDetail: trimmed,
      });
      setThreadCommandPrompt(null);
      return;
    }
    if (prompt.command === 'items') {
      if (!trimmed) {
        desktopAlert('Turn items', t('alert.turnId'));
        return;
      }
      void sendNativeThreadAction(prompt.conversationId, 'items', 'thread/turns/items/list', (threadId) => ({
        threadId,
        turnId: trimmed,
        limit: 50,
        sortDirection: 'asc',
      }), {
        showResult: true,
        resultTitle: 'Turn items',
      });
      setThreadCommandPrompt(null);
      return;
    }
    if (prompt.command === 'inject') {
      const items = parseJsonArrayPrompt(trimmed);
      if (!items) {
        desktopAlert('Inject items', t('alert.jsonArray'));
        return;
      }
      void sendNativeThreadAction(prompt.conversationId, 'inject', 'thread/inject_items', (threadId) => ({
        threadId,
        items,
      }), {
        showResult: true,
        resultTitle: 'Items injected',
      });
      setThreadCommandPrompt(null);
      return;
    }
    if (prompt.command === 'guardian') {
      try {
        const event = JSON.parse(trimmed);
        void sendNativeThreadAction(prompt.conversationId, 'guardian', 'thread/approveGuardianDeniedAction', (threadId) => ({
          threadId,
          event,
        }), {
          showResult: true,
          resultTitle: 'Guardian action approved',
        });
        setThreadCommandPrompt(null);
      } catch {
        desktopAlert('Guardian', t('alert.validJson'));
      }
    }
  }, [sendNativeThreadAction, sendTrackedLocalMethod]);

  const visibleTimeline = useMemo(() => timeline.map((entry) =>
    projectSentAttachments([entry], sentAttachmentRecords, entry.conversationId ?? '')[0]),
  [timeline, sentAttachmentRecords]);

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
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
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
  }, [settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey]);

  // Stable for the same reason as fetchWorkspaceEntries: the composer @ssh:
  // effect depends on it.
  const fetchSshHosts = useCallback(async () => {
    const api = backendApi(settings);
    return api.listSshHosts();
  }, [settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey]);

  return {
    watchAgentBrowser,
    ...workbenchSharingState,
    ...completionNotificationsState,
    hydrated,
    directorySyncStatus,
    settings,
    setSettings,
    backendConnections,
    activeBackendConnectionId,
    setActiveBackendConnectionId,
    updateBackendConnection,
    addBackendConnection,
    removeBackendConnection,
    workspaces,
    conversations,
    activeWorkspaceId,
    activeConversationId,
    connectionState,
    connectionHealth,
    remoteModelCatalog,
    modelCatalog,
    modelCatalogStatus,
    modelCatalogError,
    lastError,
    serverVersion,
    versionMismatch,
    events,
    timeline: visibleTimeline,
    hydrateProcessGroup,
    historyEncryption,
    mentionHistory,
    experimentalFeatures,
    setExperimentalFeatures,
    selectedRequestId,
    setSelectedRequestId,
    chatDrafts,
    queuedChatDrafts,
    queuePausedByConversation,
    rateLimitedUntilByConversation,
    removeQueuedFollowUp,
    clearQueuedFollowUps,
    resumeQueuedFollowUps,
    editFollowUpQueue,
    controlConversation,
    controlStatusByConversation,
    composerAttachments,
    composerSelections,
    selectedSkills,
    skillListVisible,
    skillListConversationId,
    skillListStatus,
    skillListError,
    skillListItems,
    modelCommandPrompt,
    setModelCommandPrompt,
    modelPickerPrompt,
    setModelPickerPrompt,
    threadInfoModal,
    setThreadInfoModal,
    threadCommandPrompt,
    setThreadCommandPrompt,
    turnIds,
    thinkingConversations,
    threadListStatusByWorkspace,
    threadListErrorByWorkspace,
    gitDiffByConversation,
    selectedGitRepoByWorkspace,
    selectGitRepo,
    mcpInventoryByConversation,
    permissionProfilesByConversation,
    hooksCatalogByConversation,
    pluginsCatalogByConversation,
    memorySettingsByConversation,
    terminalById,
    v2Providers,
    v2Conversations,
    capabilityCatalogs,
    providerModels,
    providerImageInput,
    providerCommands,
    contextUsageByConversation,
    compactionByConversation,
    subagentsByConversation,
    conversationRuntimeById,
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
    selectedRequest,
    activeWorkspace,
    activeConversation,
    connect,
    closeSocket,
    onDevicePairingApproved: () => connect(),
    createWorkspace,
    openGitWorktree,
    selectWorkspace,
    renameWorkspace,
    updateWorkspace,
    forkWorkspace,
    removeWorkspace,
    createConversation,
    switchConversationAgent,
    selectConversation,
    renameConversation,
    forkConversation,
    removeConversation,
    setConversationLabelColor,
    requestNativeThreadList,
    submitChat,
    sendAgentMessage,
    setConversationChatDraft,
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
    requestSkillList,
    refreshCapabilityCatalog,
    toggleCatalogSkill,
    previewSkillResource,
    refreshMcpServer,
    callMcpTool,
    fetchWorkspaceDirectorySnapshot: (path?: string) => fetchWorkspaceDirectorySnapshot(settings, path),
    fetchWorkspaceEntries,
    fetchSshHosts,
    openModelPicker,
    applyModelCommand,
    applyWorkspaceModelSelection,
    applyConversationModelSelection,
    sendSlashCommand,
    openSlashCommandActionPage,
    copyLastAgentMessage,
    exportConversationMarkdown,
    runWorkspaceCommand,
    runThreadMenuAction,
    submitThreadCommandPrompt,
    stopThinking,
    openPermissionsMenu,
    applyPermissionPreset,
    applyPersonality,
    applyServiceTier,
    toggleFastServiceTier,
    requestMcpInventory,
    requestPermissionProfiles,
    requestHooksCatalog,
    requestPluginsCatalog,
    requestMemorySettings,
    updateMemorySettings,
    resetMemories,
    applyPermissionProfile,
    applyConversationPermissionMode,
    applyConversationWorkMode,
    seedTerminalState,
    resizeTerminalSession,
    requestTerminalStatus,
    clearTerminalOutput,
    setSkillListVisible,
    toggleSelectedSkill,
    autoConnectEnabled,
    setAutoConnectEnabled,
    openPanel,
  };
}

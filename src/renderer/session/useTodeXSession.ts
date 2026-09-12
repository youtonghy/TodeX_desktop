import type { BackendConnectionProfile } from './backendColors';
import { useWorkbenchSharing } from './useWorkbenchSharing';
import {
  completionNotificationBody,
  postCompletionNotification,
  shouldNotifyCompletion,
  useCompletionNotifications,
} from './completionNotifications';
import { bindSentAttachmentEvents, prepareSentAttachments, projectSentAttachments, pruneSentAttachmentRecords, type SentAttachmentRecord } from './sentAttachments';
import { ENCRYPTION_VERIFICATION_ERROR, TransportVerificationError, validateTransportEncryption, verifyEncryptedSocket } from './transportVerification';
import { QueuedFollowUps, restoreQueuedFollowUps } from './queuedFollowUps';
import { LegacyEventRecovery } from './legacyEventRecovery';
import { ConversationRecovery } from './conversationRecovery';
import { type ConversationRuntime } from '@todex/protocol/conversationRuntime';
import { canonicalConversationEventType, type ConversationEvent } from '@todex/protocol/v2';
import { ProtocolCommands, ProtocolCommandError, type ProtocolCommand } from './protocolCommands';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import type { ProviderDescriptor, ProviderKind, ConversationManifest, PromptContentRef, PromptSkillRef, SkillCatalogDescriptor, ProviderModelDescriptor, ProviderCommandDescriptor, ContextCompactionState, SubagentRun, MemoryEntry } from '@todex/protocol/v2';
import { contextCompactionStatus } from '@todex/protocol/v2';
import { V2ApiClient, buildV2WebSocketUrlWithOptions, normalizeConversationEvent } from '@todex/protocol/v2';
import { probeBackendConnection, nextReconnectDelayMs, inspectServerUrl, tokenMatchesOrigin } from '@todex/protocol/connectionProbe';
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
  mergeWorkspaceRecords,
  remapWorkspaceScopedRecords,
  prepareWorkspaceSyncPayload,
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
  findCapabilityHashTrigger,
  insertCapabilityReference,
  sandboxPolicyForMode,
  shortJson,
  utf8ByteLength,
  type CodexThreadHistoryEntry,
} from '@todex/protocol/todex';
import { loadJson, loadSecret, saveJson, saveSecret } from '../lib/storage';
import {
  applyPairingToSettings,
  assemblePairingQrChunkPayload,
  createTransportCryptoSession,
  parsePairingQrFrame,
  resolvePairingPayload,
  type PairingQrChunk,
  type TransportCryptoSession,
} from '@todex/protocol/transportCrypto';
import {
  MAX_LEGACY_MESSAGE_BYTES,
} from '@todex/protocol/transport';
import { ConnectionError } from '@todex/protocol/connectionError';
import { desktopAlert } from '../lib/desktopAlert';
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
  TOKEN_STORAGE_KEY,
  TOKEN_ORIGIN_STORAGE_KEY,
  BACKEND_CONNECTIONS_STORAGE_KEY,
  JSON_SAVE_DEBOUNCE_MS,
  SESSION_CURSOR_SAVE_DEBOUNCE_MS,
  WORKSPACE_SYNC_DEBOUNCE_MS,
  SOCKET_EVENT_BATCH_SIZE,
  SOCKET_FRAME_DECODE_BATCH_SIZE,
  SOCKET_FRAME_DECODE_BUDGET_MS,
  MAX_TRANSPORT_HELLO_SESSION_CURSORS,
  MAX_TIMELINE_ITEMS,
  MAX_USAGE_RECORDS,
  MAX_EVENTS,
  CHAT_ATTACH_REPLAY_LIMIT,
  TERMINAL_MAX_OUTPUT_ENTRIES,
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
  type MentionSuggestion,
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
  authHeaders,
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
  buildMentionSuggestions,
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
  classifyV2ConversationEvent,
  shouldAppendV2ConversationEvent,
  contextUsageFromV2Event,
  reduceV2ConversationEvents,
  mergeConversationTimeline,
  conversationFromManifest,
  mergeManifestConversations,
  isV2Conversation,
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
  SOCKET_LIVENESS_MAX_FAILURES,
  MAX_COMPOSER_ATTACHMENTS,
} from './helpers';

const SENT_ATTACHMENTS_STORAGE_KEY = `${TIMELINE_STORAGE_KEY}.attachments`;

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
  const socketRef = useRef<WebSocket | null>(null);
  const connectionAttemptRef = useRef<AbortController | null>(null);
  const socketVerifiedRef = useRef(false);
  const transportFailureRef = useRef(false);
  const rawProtocolSenderRef = useRef<(message: ProtocolCommand) => boolean>(() => false);
  const protocolCommandsRef = useRef<ProtocolCommands | null>(null);
  if (!protocolCommandsRef.current) protocolCommandsRef.current = new ProtocolCommands((message) => rawProtocolSenderRef.current(message));
  useEffect(() => () => protocolCommandsRef.current?.dispose(), []);
  const socketCryptoRef = useRef<TransportCryptoSession | null>(null);
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
  const providerModelsRef = useRef<Partial<Record<ProviderKind, ProviderModelDescriptor[]>>>({});
  const providerImageInputRef = useRef<Record<string, { status: 'loading' | 'ready' | 'error'; imageInput?: boolean; reason?: string }>>({});
  const pendingLocalStartsRef = useRef(new Map<string, PendingLocalStart>());
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
  const pendingGitDiffsRef = useRef(new Map<string, PendingGitDiff>());
  const pendingSkillListsRef = useRef(new Map<string, PendingSkillList>());
  const pendingModelListRef = useRef<PendingModelList | null>(null);
  const pendingJsonSavesRef = useRef(new Map<string, PendingJsonSave>());
  const pendingServerEventsRef = useRef<ServerEvent[]>([]);
  const pendingServerEventFrameRef = useRef<number | null>(null);
  const pendingSocketFramesRef = useRef<PendingSocketFrame[]>([]);
  const pendingSocketFrameDrainRef = useRef<number | null>(null);
  const capabilityWorkspaceRef = useRef('');
  const socketGenerationRef = useRef(0);
  const autoConnectAttemptedRef = useRef(false);
  const legacyRecoveryRef = useRef(new LegacyEventRecovery<ServerEvent>());
  const sessionCursorsRef = useRef(new Map<string, number>());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketWatchdogFailuresRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const workspaceBackendReadyRef = useRef(false);
  const workspaceBackendSkipNextSaveRef = useRef(false);
  const workspaceBackendSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [directorySyncStatus, setDirectorySyncStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [activeConversationId, setActiveConversationId] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
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
  const [mcpInventoryByConversation, setMcpInventoryByConversation] = useState<Record<string, McpInventoryState>>({});
  const [permissionProfilesByConversation, setPermissionProfilesByConversation] = useState<Record<string, PermissionProfilesState>>({});
  const [hooksCatalogByConversation, setHooksCatalogByConversation] = useState<Record<string, HooksCatalogState>>({});
  const [pluginsCatalogByConversation, setPluginsCatalogByConversation] = useState<Record<string, PluginsCatalogState>>({});
  const [memorySettingsByConversation, setMemorySettingsByConversation] = useState<Record<string, MemorySettingsState>>({});
  const [terminalById, setTerminalById] = useState<Record<string, TerminalClientState>>({});
  const [v2Providers, setV2Providers] = useState<ProviderDescriptor[]>([]);
  const [v2Conversations, setV2Conversations] = useState<ConversationManifest[]>([]);
  const [capabilityCatalogs, setCapabilityCatalogs] = useState<Partial<Record<ProviderKind, CatalogState>>>({});
  const [providerModels, setProviderModels] = useState<Partial<Record<ProviderKind, ProviderModelDescriptor[]>>>({});
  const [providerImageInput, setProviderImageInput] = useState<Record<string, { status: 'loading' | 'ready' | 'error'; imageInput?: boolean; reason?: string }>>({});
  const [providerModelPreferences, setProviderModelPreferences] = useState<ProviderModelPreferences>({});
  const [providerCommands, setProviderCommands] = useState<Partial<Record<ProviderKind, ProviderCommandDescriptor[]>>>({});
  const [contextUsageByConversation, setContextUsageByConversation] = useState<Record<string, ConversationContextUsage>>({});
  const [compactionByConversation, setCompactionByConversation] = useState<Record<string, ContextCompactionState & { recommended?: boolean }>>({});
  const [subagentsByConversation, setSubagentsByConversation] = useState<Record<string, SubagentRun[]>>({});
  const [memoryEntriesByConversation, setMemoryEntriesByConversation] = useState<Record<string, MemoryEntry[]>>({});
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [conversationRuntimeById, setConversationRuntimeById] = useState<Record<string, ConversationRuntime>>({});
  const [recoveringConversations, setRecoveringConversations] = useState<Record<string, boolean>>({});
  const [submissionStatusByConversation, setSubmissionStatusByConversation] = useState<Record<string, 'sending' | 'running' | 'unknown' | undefined>>({});
  const settledV2TurnsRef = useRef(new Map<string, string>());
  const runtimeReplayRef = useRef((id: string, after: number, limit: number) =>
    new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken }).replayEvents(id, after, limit));
  runtimeReplayRef.current = (id, after, limit) => new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken }).replayEvents(id, after, limit);
  const runtimeUpdateRef = useRef<(state: ConversationRuntime, applied: ConversationEvent[], recovering: boolean) => void>(() => {});
  const notifyTurnCompletedRef = useRef<(localId: string, state: ConversationRuntime, turnId: string) => void>(() => {});
  const conversationRecoveryRef = useRef<ConversationRecovery | null>(null);
  if (!conversationRecoveryRef.current) conversationRecoveryRef.current = new ConversationRecovery(
    (id, after, limit) => runtimeReplayRef.current(id, after, limit),
    (state, applied, recovering) => runtimeUpdateRef.current(state, applied, recovering), setLastError,
  );


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
    const api = new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken });
    let active = true;
    setDirectorySyncStatus('loading');
    void Promise.all([api.listProviders(), api.listConversations()])
      .then(([providers, conversations]) => {
        if (!active) return;
        setV2Providers(providers.providers);
        setV2Conversations(conversations.conversations);
        setConversations((current) => mergeManifestConversations(current, conversations.conversations, workspacesRef.current));
        setDirectorySyncStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setDirectorySyncStatus('error');
        setV2Providers([]);
        setV2Conversations([]);
      });
    const refreshTimer = setInterval(() => {
      void api.listConversations().then((response) => {
        if (!active) return;
        setV2Conversations(response.conversations);
        setConversations((current) => mergeManifestConversations(current, response.conversations, workspacesRef.current));
      }).catch(() => undefined);
    }, 15000);
    // The main connection below is the single `/v2/ws` socket; providers and
    // conversations lists are plain HTTP refreshes, no side channel needed.
    return () => {
      active = false;
      clearInterval(refreshTimer);
    };
  }, [hydrated, settings.authToken, settings.serverUrl]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);
  const queuedChatDraftsRef = useRef<Record<string, QueuedChatSubmission[]>>({});
  const queuedChatDispatchingRef = useRef(new Set<string>());
  const sendQueuedChatDraftRef = useRef<(submission: QueuedChatSubmission, conversationId: string) => Promise<boolean>>(async () => false);

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
    const models = modelsOverride ?? providerModelsRef.current[provider] ?? [];
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
  }, []);

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
      for (const id of Object.keys(queues)) followUpsRef.current.pause(id);
      queuedChatDraftsRef.current = { ...queues, ...queuedChatDraftsRef.current };
      setQueuedChatDrafts(queuedChatDraftsRef.current);
      setQueuePausedByConversation(Object.fromEntries(Object.keys(queues).map(id => [id, true])));
      setQueueHydrated(true);
    }).catch(() => {
      if (!disposed) setLastError('无法恢复候选消息，请检查本地存储。');
    });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (queueHydrated) void saveJson('todex.queued-follow-ups.v1', queuedChatDrafts)
      .catch(() => setLastError('候选消息未能保存。关闭页面前请保留输入内容。'));
  }, [queueHydrated, queuedChatDrafts]);

  const removeQueuedFollowUp = useCallback((conversationId: string, itemId: string) => {
    const items = (queuedChatDraftsRef.current[conversationId] ?? []).filter(item => item.id !== itemId);
    queuedChatDraftsRef.current = { ...queuedChatDraftsRef.current, [conversationId]: items };
    setQueuedChatDrafts(queuedChatDraftsRef.current);
  }, []);

  const resumeQueuedFollowUps = useCallback(async (conversationId: string) => {
    if (thinkingConversationsRef.current[conversationId] || pendingV2SubmissionsRef.current.has(conversationId)) return;
    await followUpsRef.current.resume(conversationId,
      () => queuedChatDraftsRef.current[conversationId]?.[0],
      (item) => sendQueuedChatDraftRef.current(item, conversationId),
      (itemId) => removeQueuedFollowUp(conversationId, itemId));
    setQueuePausedByConversation(current => ({ ...current, [conversationId]: followUpsRef.current.isPaused(conversationId) }));
  }, [removeQueuedFollowUp]);

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
    socketCryptoRef.current = null;
    pendingServerEventsRef.current = [];
    if (pendingServerEventFrameRef.current !== null) {
      cancelAnimationFrame(pendingServerEventFrameRef.current);
      pendingServerEventFrameRef.current = null;
    }
    pendingSocketFramesRef.current = [];
    if (pendingSocketFrameDrainRef.current !== null) {
      cancelAnimationFrame(pendingSocketFrameDrainRef.current);
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
      pendingServerEventsRef.current = [];
      if (pendingServerEventFrameRef.current !== null) {
        cancelAnimationFrame(pendingServerEventFrameRef.current);
        pendingServerEventFrameRef.current = null;
      }
      pendingSocketFramesRef.current = [];
      if (pendingSocketFrameDrainRef.current !== null) {
        cancelAnimationFrame(pendingSocketFrameDrainRef.current);
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

  useEffect(() => {
    let alive = true;
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
        storedToken,
        storedTokenOrigin,
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
        loadSecret(TOKEN_STORAGE_KEY),
        loadSecret(TOKEN_ORIGIN_STORAGE_KEY),
      ]);

      if (!alive) {
        return;
      }

      const nextSettings = fromPersistedSettings(
        storedSettings,
        tokenMatchesOrigin(storedTokenOrigin, storedSettings?.serverUrl || defaultSettings.serverUrl) ? storedToken : '',
      );
      nextSettings.serverUrl = normalizeServerUrl(nextSettings.serverUrl);
      const storedProfiles = (storedBackendConnections as unknown[]).map(normalizeBackendConnectionProfile).filter((profile): profile is BackendConnectionProfile => Boolean(profile));
      const hydratedProfiles = storedProfiles.length ? await Promise.all(storedProfiles.map(async (profile) => ({ ...profile, authToken: (await loadSecret(`${TOKEN_STORAGE_KEY}.${profile.id}`)) || (profile.id === 'default-backend' ? nextSettings.authToken : '') }))) : [];
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

      setSettings(nextSettings);
      setBackendConnections(profiles);
      setActiveBackendConnectionId(profiles[0]?.id ?? 'default-backend');
      setWorkspaces(normalizedWorkspaces);
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
  }, [closeSocket]);

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
    conversationsRef.current = conversations;
  }, [conversations]);

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
    providerImageInputRef.current = providerImageInput;
  }, [providerImageInput]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(SETTINGS_STORAGE_KEY, toPersistedSettings(settings));
    void saveSecret(TOKEN_STORAGE_KEY, settings.authToken);
    void saveSecret(TOKEN_ORIGIN_STORAGE_KEY, settings.authToken ? normalizeServerUrl(settings.serverUrl) : '');
  }, [hydrated, settings]);

  useEffect(() => {
    if (hydrated) {
      void saveJson(BACKEND_CONNECTIONS_STORAGE_KEY, backendConnections.map(({ authToken: _authToken, ...profile }) => profile));
      for (const profile of backendConnections) void saveSecret(`${TOKEN_STORAGE_KEY}.${profile.id}`, profile.authToken);
    }
  }, [backendConnections, hydrated]);

  useEffect(() => {
    if (hydrated) {
      void saveJson(PROVIDER_MODEL_PREFERENCES_STORAGE_KEY, providerModelPreferences);
    }
  }, [hydrated, providerModelPreferences]);

  const syncWorkspacesToBackend = useCallback(
    async (snapshot: WorkspaceRecord[] = workspacesRef.current) => {
      try {
        const activeSnapshot = snapshot.filter((workspace) =>
          !workspace.backendConnectionId || workspace.backendConnectionId === activeBackendConnectionId,
        );
        const response = await fetch(buildHttpUrl(settings.serverUrl, '/v2/workspaces'), {
          method: 'PUT',
          headers: authHeaders(settings, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ workspaces: prepareWorkspaceSyncPayload(activeSnapshot) }),
        });
        if (!response.ok) {
          throw new Error(`workspace sync returned ${response.status}`);
        }
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : '工作区同步失败');
        return false;
      }
    },
    [activeBackendConnectionId, settings],
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

  const syncWorkspacesFromBackend = useCallback(async () => {
    workspaceBackendReadyRef.current = false;
    try {
      const response = await fetch(buildHttpUrl(settings.serverUrl, '/v2/workspaces'), {
        headers: authHeaders(settings),
      });
      if (!response.ok) {
        throw new Error(`workspace sync returned ${response.status}`);
      }
      const remoteWorkspaces = parseWorkspaceSyncResponse(await response.json());
      const localWorkspaces = workspacesRef.current;
      const localActiveWorkspaces = localWorkspaces.filter((workspace) =>
        !workspace.backendConnectionId || workspace.backendConnectionId === activeBackendConnectionId,
      );
      const otherWorkspaces = localWorkspaces.filter((workspace) =>
        Boolean(workspace.backendConnectionId) && workspace.backendConnectionId !== activeBackendConnectionId,
      );
      const taggedRemoteWorkspaces = remoteWorkspaces.map((workspace) => ({
        ...workspace,
        backendConnectionId: activeBackendConnectionId || null,
      }));
      const nextActiveWorkspaces = remoteWorkspaces.length > 0
        ? mergeWorkspaceRecords(localActiveWorkspaces, taggedRemoteWorkspaces).map((workspace) => ({
            ...workspace,
            threadId: '',
            localAdapterState:
              localActiveWorkspaces.find((item) => item.id === workspace.id || item.path === workspace.path)?.localAdapterState ??
              workspace.localAdapterState ??
              'idle',
          }))
        : localActiveWorkspaces;
      const nextWorkspaces = [...otherWorkspaces, ...nextActiveWorkspaces]
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
      try {
        const conversationResponse = await new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken }).listConversations();
        setV2Conversations(conversationResponse.conversations);
        setConversations((current) => mergeManifestConversations(current, conversationResponse.conversations, nextWorkspaces));
      } catch (error) {
        setLastError(error instanceof Error ? error.message : '对话目录同步失败');
      }
      if (!workspaceSyncPayloadEquals(taggedRemoteWorkspaces, nextActiveWorkspaces)) {
        void syncWorkspacesToBackend(nextActiveWorkspaces);
      }
      return true;
    } catch (error) {
      workspaceBackendReadyRef.current = true;
      setLastError(error instanceof Error ? error.message : '工作区同步失败');
      return false;
    }
  }, [activeBackendConnectionId, settings, syncWorkspacesToBackend]);

  useEffect(() => {
    if (!hydrated || connectionState !== 'open') return;
    const timer = setInterval(() => void syncWorkspacesFromBackend(), 15000);
    return () => clearInterval(timer);
  }, [connectionState, hydrated, syncWorkspacesFromBackend]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(WORKSPACES_STORAGE_KEY, workspaces);
    if (workspaceBackendSkipNextSaveRef.current) {
      workspaceBackendSkipNextSaveRef.current = false;
      return;
    }
    if (connectionState === 'open' && workspaceBackendReadyRef.current) {
      scheduleWorkspaceBackendSave(workspaces);
    }
  }, [connectionState, hydrated, scheduleWorkspaceBackendSave, workspaces]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    void saveJson(CONVERSATIONS_STORAGE_KEY, conversations);
  }, [conversations, hydrated]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    scheduleJsonSave(TIMELINE_STORAGE_KEY, timeline.slice(0, MAX_TIMELINE_ITEMS));
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
    const api = new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken });
    try {
      const [skills, mcp] = await Promise.all([
        api.listSkillCatalog(provider, workspacePath),
        api.listMcpCatalog(provider, workspacePath),
      ]);
      setCapabilityCatalogs((current) => ({ ...current, [provider]: { status: 'ready', skills, mcp } }));
    } catch (error) {
      setCapabilityCatalogs((current) => ({
        ...current,
        [provider]: { ...(current[provider] ?? {}), status: 'error', error: error instanceof Error ? error.message : '能力目录读取失败' },
      }));
    }
  }, [activeWorkspace?.path, settings.authToken, settings.defaultWorkspacePath, settings.serverUrl]);

  useEffect(() => {
    if (!hydrated || !activeWorkspace?.path || v2Providers.length === 0) return;
    if (capabilityWorkspaceRef.current !== activeWorkspace.path) {
      capabilityWorkspaceRef.current = activeWorkspace.path;
      setCapabilityCatalogs({});
      return;
    }
    for (const provider of v2Providers) {
      if (!capabilityCatalogs[provider.id]) void refreshCapabilityCatalog(provider.id);
    }
  }, [activeWorkspace?.path, capabilityCatalogs, hydrated, refreshCapabilityCatalog, v2Providers]);

  useEffect(() => {
    if (!hydrated || !activeWorkspace?.path || v2Providers.length === 0) return;
    let cancelled = false;
    const api = new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken });
    void Promise.all(v2Providers.filter((item) => item.available).map(async (provider) => {
      try {
        const result = await api.listProviderModels(provider.id, activeWorkspace.path);
        if (!cancelled) {
          setProviderModels((current) => {
            const next = { ...current, [provider.id]: result.models };
            providerModelsRef.current = next;
            return next;
          });
          const conversation = conversationsRef.current.find((item) => item.id === activeConversationRef.current);
          if (conversation?.provider === provider.id) {
            const selection = resolveRememberedProviderSelection(
              conversation.backendConnectionId ?? activeBackendConnectionId,
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
                conversation.backendConnectionId ?? activeBackendConnectionId,
                provider.id,
                selection.model,
                selection.reasoningEffort,
              );
            }
          }
        }
      } catch {
        // Keep the descriptor models when live discovery is unavailable.
      }
    }));
    return () => { cancelled = true; };
  }, [activeBackendConnectionId, activeWorkspace?.path, hydrated, rememberProviderModelSelection, resolveRememberedProviderSelection, settings.authToken, settings.serverUrl, v2Providers]);

  useEffect(() => {
    if (!hydrated || !activeWorkspace?.path || v2Providers.length === 0) return;
    let cancelled = false;
    const api = new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken });
    void Promise.all(v2Providers.filter((item) => item.available).map(async (provider) => {
      try {
        const result = await api.listProviderCommands(provider.id, activeWorkspace.path);
        if (!cancelled) setProviderCommands((current) => ({ ...current, [provider.id]: result.commands }));
      } catch {
        // Keep the last successful command catalog while the backend recovers.
      }
    }));
    return () => { cancelled = true; };
  }, [activeWorkspace?.path, hydrated, settings.authToken, settings.serverUrl, v2Providers]);

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
    const api = new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken });
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
          reason: error instanceof Error ? error.message : '无法确认当前 ACP 配置的图片能力。',
        },
      }));
    });
    return () => { cancelled = true; };
  }, [activeConversation, activeWorkspace?.path, hydrated, settings.authToken, settings.serverUrl, v2Providers]);

  const restorePendingSubmission = useCallback((conversationId: string) => {
    const submission = pendingV2SubmissionsRef.current.get(conversationId);
    if (!submission) return;
    setConversationChatDraft(conversationId, (current) => current || submission.text);
    setConversationAttachments(conversationId, (current) => current.length ? current : submission.attachments);
    setConversationSelectedSkills(conversationId, (current) => current.length ? current : submission.skills);
  }, [setConversationChatDraft, setConversationAttachments, setConversationSelectedSkills]);

  runtimeUpdateRef.current = (state, appliedEvents, recovering) => {
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
    setRecoveringConversations((current) => ({ ...current, [localId]: recovering }));
    const boundAttachments = bindSentAttachmentEvents(sentAttachmentRecordsRef.current, localId, appliedEvents);
    if (boundAttachments !== sentAttachmentRecordsRef.current) updateSentAttachmentRecords(boundAttachments);
    setTimeline((current) => [
      ...state.timeline.map((entry) => ({ ...entry, conversationId: localId })),
      ...current.filter((entry) => entry.conversationId !== localId),
    ].slice(0, MAX_TIMELINE_ITEMS));
    if (state.contextUsage) setContextUsageByConversation((current) => ({ ...current, [localId]: state.contextUsage! }));
    setCompactionByConversation((current) => ({ ...current, [localId]: state.compaction }));
    setSubagentsByConversation((current) => ({ ...current, [localId]: state.subagents.map((run) => ({ ...run, conversationId: localId })) }));
    setMemoryEntriesByConversation((current) => ({ ...current, [localId]: state.memoryEntries }));
    setUsageRecords((current) => [
      ...state.usageRecords.map((record) => ({ ...record, conversationId: localId,
        provider: record.provider === 'unknown' ? conversation.provider || 'unknown' : record.provider,
        model: record.model === 'unknown' ? conversation.model || 'unknown' : record.model,
      })),
      ...current.filter((record) => record.conversationId !== localId),
    ].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_USAGE_RECORDS));
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
        if (type === 'control.rejected') setLastError(typeof data.message === 'string' ? data.message : 'Agent 未应用控制请求');
      }
      if (['turn.completed', 'turn.cancelled', 'turn.failed', 'turn.interrupted'].includes(type)) {
        const settledKey = turnId ? `${state.conversationId}:${turnId}` : '';
        const firstSettle = Boolean(settledKey) && !settledV2TurnsRef.current.has(settledKey);
        if (turnId) {
          settledV2TurnsRef.current.set(settledKey, type);
          if (settledV2TurnsRef.current.size > 2000) settledV2TurnsRef.current.delete(settledV2TurnsRef.current.keys().next().value!);
        }
        if (type === 'turn.completed' && firstSettle && !recovering) {
          notifyTurnCompletedRef.current(localId, state, turnId);
        }
        if (submission && turnId && submission.turnId === turnId) {
          if (type === 'turn.completed') removeQueuedFollowUp(localId, submission.requestId);
          queueMicrotask(() => {
            void followUpsRef.current.settle(localId, turnId, type, true, recovering,
              () => queuedChatDraftsRef.current[localId]?.[0],
              (item) => sendQueuedChatDraftRef.current(item, localId),
              (itemId) => removeQueuedFollowUp(localId, itemId)).then(() => {
                setQueuePausedByConversation(current => ({ ...current, [localId]: followUpsRef.current.isPaused(localId) }));
              });
          });
          if (type === 'turn.failed') {
            restorePendingSubmission(localId);
            setLastError(typeof data.message === 'string' ? data.message : '当前任务执行失败，请核对记录后重试。');
          }
          pendingV2SubmissionsRef.current.delete(localId);
          setSubmissionStatusByConversation((current) => ({ ...current, [localId]: undefined }));
        }
      }
    }
    setConversationTurnId(localId, state.activeTurnId);
    const pending = pendingV2SubmissionsRef.current.get(localId);
    setConversationThinking(localId, Boolean(state.activeTurnId) || pending?.phase === 'sending');
    setConversations((current) => current.map((item) => item.id === localId
      ? { ...item, lastSequence: Math.max(item.lastSequence ?? 0, state.appliedSequence) } : item));
  };

  const recoverConversation = useCallback(async (conversationId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId || item.v2ConversationId === conversationId);
    if (conversation?.v2ConversationId) await conversationRecoveryRef.current!.recover(conversation.v2ConversationId, conversation.workspaceId);
  }, []);

  useEffect(() => {
    conversationRecoveryRef.current?.reset();
    legacyRecoveryRef.current = new LegacyEventRecovery<ServerEvent>();
    protocolCommandsRef.current?.dispose();
    setConversationRuntimeById({});
    setRecoveringConversations({});
    settledV2TurnsRef.current.clear();
  }, [settings.serverUrl, settings.authToken]);

  useEffect(() => {
    if (!hydrated || !activeConversation?.v2ConversationId || !settings.serverUrl.trim()) return;
    void recoverConversation(activeConversation.id);
  }, [activeConversation?.id, activeConversation?.v2ConversationId, hydrated, recoverConversation, settings.serverUrl, settings.authToken]);

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
        workspace.id === id ? { ...workspace, ...patch, updatedAt: Date.now() } : workspace,
      ),
    );
  }, []);

  const updateConversation = useCallback((id: string, patch: Partial<ConversationRecord>) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id ? { ...conversation, ...patch, updatedAt: Date.now() } : conversation,
      ),
    );
  }, []);

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
    setTimeline((current) => [entry, ...current].slice(0, MAX_TIMELINE_ITEMS));
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
        return [entry, ...current].slice(0, MAX_TIMELINE_ITEMS);
      }

      const next = current.slice();
      const previous = next[index];
      next[index] = {
        ...previous,
        ...entry,
        subtitle: appendSubtitle ? `${previous.subtitle === '正在回复...' ? '' : previous.subtitle}${entry.subtitle}` : entry.subtitle,
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
        const error = new Error(errorMessage || '创建 thread 失败');
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
        appendTimeline(makeSystemEntry('本地会话启动失败', error.message, activeWorkspaceRef.current, activeConversationRef.current));
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
      return {
        ...current,
        [terminalId]: {
          ...existing,
          output: [...existing.output, entry].slice(-TERMINAL_MAX_OUTPUT_ENTRIES),
          updatedAt: Date.now(),
        },
      };
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
            updatedAt: Date.now(),
          };
        });
        return next;
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

      if (event.type === 'terminal.started') {
        status = 'running';
        error = '';
        output = [
          ...output,
          terminalOutputLine('system', `terminal started: ${cwd || base.cwd}`),
        ].slice(-TERMINAL_MAX_OUTPUT_ENTRIES);
      } else if (event.type === 'terminal.stopping') {
        status = 'stopping';
        output = [
          ...output,
          terminalOutputLine('system', 'terminal stopping'),
        ].slice(-TERMINAL_MAX_OUTPUT_ENTRIES);
      } else if (event.type === 'terminal.exited') {
        status = 'exited';
        exitCode = typeof data.exitCode === 'number' ? data.exitCode : null;
        output = [
          ...output,
          terminalOutputLine('system', `terminal exited${exitCode === null ? '' : ` with code ${exitCode}`}`),
        ].slice(-TERMINAL_MAX_OUTPUT_ENTRIES);
      } else if (event.type === 'terminal.error') {
        status = 'error';
        error = typeof data.error === 'string' ? data.error : 'terminal error';
        output = [
          ...output,
          terminalOutputLine('error', error),
        ].slice(-TERMINAL_MAX_OUTPUT_ENTRIES);
      } else if (event.type === 'terminal.resized') {
        output = [
          ...output,
          terminalOutputLine('system', `size ${typeof data.cols === 'number' ? data.cols : base.cols}x${typeof data.rows === 'number' ? data.rows : base.rows}`),
        ].slice(-TERMINAL_MAX_OUTPUT_ENTRIES);
      }

      return {
        ...current,
        [terminalId]: {
          ...base,
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
          updatedAt: Date.now(),
        },
      };
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
            setModelCatalogError('model/list 没有返回可用模型');
          }
          clearTimeout(pendingModelList.timeoutId);
          pendingModelListRef.current = null;
        } else if (protocolError || event.type === 'codex.control.error') {
          setModelCatalogStatus('error');
          setModelCatalogError(localTurnErrorMessage(protocolError || 'model/list 请求失败'));
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
          finishPendingGitDiff(pendingGitDiff, localTurnErrorMessage(protocolError || 'gitDiffToRemote 请求失败'));
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
          finishPendingSkillList(pendingSkillList, localTurnErrorMessage(protocolError || 'skills/list 请求失败'));
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
          finishPendingThreadList(pendingThreadList, localTurnErrorMessage(protocolError || 'thread/list 请求失败'));
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
              return [...restored, ...remaining].slice(0, MAX_TIMELINE_ITEMS);
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
            finishPendingThreadAction(pendingThreadAction, localTurnErrorMessage(protocolError || `${pendingThreadAction.action} 请求失败`));
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
        const queuedDrafts = queuedChatDraftsRef.current[targetConversationId] ?? [];
        const nextQueuedDraft = queuedDrafts[0] ?? null;
        if (
          nextQueuedDraft &&
          (nextQueuedDraft.text.trim() || nextQueuedDraft.attachments.length > 0 || nextQueuedDraft.skills.length > 0) &&
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
          settlePendingLocalStart(pending, protocolError || '本地会话启动失败');
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
            settlePendingThreadStart(pendingThread, '', localTurnErrorMessage(protocolError || '创建 thread 失败'));
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
            '已重置失效 Thread',
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

    pendingServerEventFrameRef.current = requestAnimationFrame(() => {
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
      const text = frame.crypto?.decryptServerText(frame.data) ?? frame.data;
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const messageType = typeof parsed.type === 'string' ? parsed.type : '';
      if (messageType === 'server.result') {
        const id = typeof parsed.id === 'string' ? parsed.id : '';
        const payload = parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
          ? parsed.payload as Record<string, unknown> : {};
        protocolCommandsRef.current?.resolve(id, payload);
        return;
      }
      if (messageType === 'server.error' && parsed.id !== undefined) {
        const payload = parsed.payload as { code?: unknown; message?: unknown } | undefined;
        const code = typeof payload?.code === 'string' ? payload.code : '';
        const detail = typeof payload?.message === 'string' ? payload.message : 'v2 命令失败';
        const message = code ? `[${code}] ${detail}` : detail;
        protocolCommandsRef.current?.reject(typeof parsed.id === 'string' ? parsed.id : '', message, code);
        setLastError(message);
        return;
      }
      if (messageType === 'conversation.event') {
        const event = normalizeConversationEvent(parsed.payload ?? parsed);
        if (!event) throw new Error('收到无效的对话事件，未推进恢复位置。');
        const conversation = conversationsRef.current.find((item) => item.v2ConversationId === event.conversationId || item.id === event.conversationId);
        if (conversation) conversationRecoveryRef.current!.receive(event.conversationId, conversation.workspaceId, [event]);
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

    pendingSocketFrameDrainRef.current = requestAnimationFrame(() => {
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
    pendingSocketFramesRef.current.push(frame);
    scheduleSocketFrameDrain();
  }, [scheduleSocketFrameDrain]);

  /** Raw `{id, type, payload}` frame on the unified /v2/ws socket: encrypt,
   * guard the 8 MiB backend limit, send. Returns null when the frame never
   * left (socket closed) and throws ConnectionError on oversize payloads. */
  const sendRawProtocolFrame = useCallback((message: { id: string; type: string; payload: Record<string, unknown> }) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !socketVerifiedRef.current) {
      return null;
    }
    let frame: string;
    try {
      frame = JSON.stringify(message);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : '消息序列化失败。');
      return null;
    }
    frame = socketCryptoRef.current?.encryptClientText(frame) ?? frame;
    const size = utf8ByteLength(frame);
    if (size > MAX_LEGACY_MESSAGE_BYTES) {
      throw ConnectionError.messageTooLarge(size, MAX_LEGACY_MESSAGE_BYTES);
    }
    socket.send(frame);
    return message;
  }, []);

  rawProtocolSenderRef.current = (message) => Boolean(sendRawProtocolFrame(message));

  const sendProtocolCommand = useCallback((message: ProtocolCommand, timeoutMs = 15_000) =>
    protocolCommandsRef.current!.request(message, timeoutMs), []);

  const controlConversation = useCallback(async (conversationId: string, control: LiveConversationControl): Promise<boolean> => {
    const conversation = conversationsRef.current.find(item => item.id === conversationId);
    const turnId = turnIdsRef.current[conversationId];
    if (!conversation?.v2ConversationId || !turnId || controlRequestsRef.current.has(conversationId)) {
      setLastError('当前回合已结束或上一条控制尚未确认，请核对记录后继续。');
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
      if (result.status === 'targetUnavailable') throw new Error('回合已结束，配置未应用；下轮仍使用你的选择。');
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
      setLastError(error instanceof Error ? error.message : 'Agent 控制失败');
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
      setLastError(error instanceof ConnectionError ? error.userMessage : '会话恢复失败，请稍后重试。');
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
      const response = await fetch(buildHttpUrl(settings.serverUrl, '/v2/version'));
      if (!response.ok) {
        throw new Error(`version endpoint returned ${response.status}`);
      }
      const json = (await response.json()) as ServerVersion;
      setServerVersion(json);
    } catch (error) {
      setServerVersion(null);
      setLastError(error instanceof Error ? error.message : 'failed to fetch /v2/version');
    }
  }, [settings.serverUrl]);

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
        error: isAbort ? '健康检查超时' : error instanceof Error ? error.message : '健康检查失败',
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
    const attempt = new AbortController();
    connectionAttemptRef.current = attempt;
    transportFailureRef.current = false;
    const isAttemptCurrent = () => socketGenerationRef.current === generation
      && connectionAttemptRef.current === attempt && !attempt.signal.aborted;
    const failTransport = (error: unknown) => {
      if (!isAttemptCurrent()) return;
      const message = error instanceof Error ? error.message : ENCRYPTION_VERIFICATION_ERROR;
      lastFailureRetryableRef.current = false;
      transportFailureRef.current = true;
      closeSocket(false);
      setConnectionState('error');
      setLastError(message);
      setConnectionHealth({ status: 'offline', latencyMs: null, lastCheckedAt: Date.now(), error: message, code: 'protocol_mismatch' });
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

      try {
        await validateTransportEncryption({ ...settings, serverUrl: inspected.origin }, attempt.signal);
      } catch (error) {
        if (error instanceof TransportVerificationError && error.retryable) {
          lastFailureRetryableRef.current = true;
          setConnectionState('error');
          setLastError(error.message);
          setConnectionHealth({ status: 'offline', latencyMs: null, lastCheckedAt: Date.now(), error: error.message, code: 'backend_unreachable' });
          return;
        }
        failTransport(error);
        return;
      }
      if (!isAttemptCurrent()) return;
      const probe = await probeBackendConnection({
        serverUrl: inspected.origin,
        authToken: settings.authToken,
      });
      if (!isAttemptCurrent()) return;
      if (!probe.ok || probe.error) {
        const error = probe.error ?? ConnectionError.unreachable('backend probe failed');
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
          });
        }
        if (probe.providers.length) {
          setV2Providers(probe.providers);
        }
        return;
      }

      setV2Providers(probe.providers);
      if (probe.version) {
        setServerVersion({
          name: probe.version.name,
          version: probe.version.version,
          data_dir: probe.version.dataDir || '',
          workspace_root: probe.version.workspaceRoot || '',
        });
      }
      setConnectionHealth({
        status: 'checking',
        latencyMs: null,
        lastCheckedAt: Date.now(),
        error: '',
        code: '',
      });

      let crypto: TransportCryptoSession | null = null;
      try {
        crypto = createTransportCryptoSession({ ...settings, serverUrl: inspected.origin });
      } catch (error) {
        failTransport(new Error(`${ENCRYPTION_VERIFICATION_ERROR}${error instanceof Error && error.message ? `（${error.message}）` : ''}`));
        return;
      }

      const wsUrl = buildV2WebSocketUrlWithOptions(inspected.origin, {
        cryptoQueryString: crypto?.queryString,
        authToken: settings.authToken,
      });

      try {
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;
        socketCryptoRef.current = crypto;
        let verified = false;
        const isSocketCurrent = () => isAttemptCurrent() && socketRef.current === socket;

        socket.onopen = async () => {
          if (!isSocketCurrent()) return;
          if (crypto) {
            try {
              await verifyEncryptedSocket(socket, crypto, attempt.signal);
            } catch (error) {
              if (!isSocketCurrent()) return;
              if (error instanceof TransportVerificationError && error.retryable) {
                // Transient drop mid-handshake: supersede this socket so its
                // onclose no-ops, then let the reconnect effect retry.
                closeSocket(false);
                lastFailureRetryableRef.current = true;
                setConnectionState('closed');
                return;
              }
              failTransport(error);
              return;
            }
          }
          if (!isSocketCurrent() || socket.readyState !== WebSocket.OPEN) return;
          verified = true;
          socketVerifiedRef.current = true;
          reconnectAttemptRef.current = 0;
          lastFailureRetryableRef.current = true;
          setConnectionState('open');
          sendSessionResume(getSessionCursorSnapshot());
          void checkConnectionHealth();
          void refreshServerVersion();
          void syncWorkspacesFromBackend();
          for (const conversation of conversationsRef.current) {
            if (conversation.v2ConversationId) {
              try {
                void recoverConversation(conversation.id);
                sendRawProtocolFrame({
                  id: createRequestId('sub'),
                  type: 'conversation.subscribe',
                  payload: {
                    conversationId: conversation.v2ConversationId,
                    // lastSequence is the backend high-water mark, not this
                    // device's applied cursor. Replay from zero on reconnect
                    // so a fresh device cannot skip persisted history.
                    afterSequence: conversationRecoveryRef.current?.get(conversation.v2ConversationId)?.appliedSequence ?? 0,
                    limit: 200,
                  },
                });
              } catch {
                // subscribe is best-effort after resume
              }
            }
          }
          flushQueuedProtocolCommands();
        };

        socket.onmessage = (event) => {
          // The verifier alone decrypts frames until its challenge succeeds.
          if (!isSocketCurrent() || !verified) return;
          enqueueSocketFrame({
            data: String(event.data),
            generation,
            crypto,
          });
        };

        socket.onerror = () => {
          if (!isSocketCurrent()) return;
          if (crypto && !verified) {
            // A transport error before the encrypted handshake finishes is
            // ambiguous (dropped connection vs rejected key); keep retrying
            // rather than latching the socket dead.
            lastFailureRetryableRef.current = true;
            setConnectionState('error');
            setLastError(ENCRYPTION_VERIFICATION_ERROR);
            setConnectionHealth((current) => ({
              ...current,
              status: 'offline',
              error: ENCRYPTION_VERIFICATION_ERROR,
              code: 'websocket_failed',
            }));
            return;
          }
          lastFailureRetryableRef.current = true;
          setConnectionState('error');
          setLastError(ConnectionError.websocketFailed(wsUrl).userMessage);
          setConnectionHealth((current) => ({
            ...current,
            status: 'offline',
            error: ConnectionError.websocketFailed(wsUrl).userMessage,
            code: 'websocket_failed',
          }));
        };

        socket.onclose = () => {
          if (!isSocketCurrent()) return;
          if (crypto && !verified) {
            // A drop before the encrypted handshake finishes is transient;
            // keep auto-reconnect alive instead of latching a verification
            // error. The verifier's rejection may run after this callback.
            lastFailureRetryableRef.current = true;
            setConnectionState('closed');
            setLastError(ENCRYPTION_VERIFICATION_ERROR);
            socketVerifiedRef.current = false;
            socketRef.current = null;
            socketCryptoRef.current = null;
            attempt.abort();
            protocolCommandsRef.current?.disconnect();
            return;
          }
          socketVerifiedRef.current = false;
          setConnectionState((current) => (current === 'open' || current === 'connecting' ? 'closed' : current));
          socketRef.current = null;
          socketCryptoRef.current = null;
          attempt.abort();
          protocolCommandsRef.current?.disconnect();
        };
      } catch (error) {
        if (!isAttemptCurrent()) return;
        lastFailureRetryableRef.current = true;
        setConnectionState('error');
        socketCryptoRef.current = null;
        setLastError(error instanceof Error ? error.message : ConnectionError.websocketFailed(wsUrl).userMessage);
      }
    })().catch((error: unknown) => {
      if (!isAttemptCurrent()) return;
      lastFailureRetryableRef.current = true;
      setConnectionState('error');
      const message = error instanceof Error ? error.message : '连接后端失败，请重试。';
      setLastError(message);
      setConnectionHealth({ status: 'offline', latencyMs: null, lastCheckedAt: Date.now(), error: message, code: 'backend_unreachable' });
    });
  }, [checkConnectionHealth, closeSocket, enqueueSocketFrame, flushQueuedProtocolCommands, getSessionCursorSnapshot, recoverConversation, refreshServerVersion, sendRawProtocolFrame, sendSessionResume, settings, syncWorkspacesFromBackend]);

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
      if (!manualDisconnectRef.current) {
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
      if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
        socketVerifiedRef.current = false;
        socketWatchdogFailuresRef.current = 0;
        setConnectionState((current) => (current === 'open' ? 'closed' : current));
        if (!lastFailureRetryableRef.current || connectionState === 'connecting') return;
        connect();
        return;
      }
      if (socket.readyState !== WebSocket.OPEN || !socketVerifiedRef.current) return;
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

  const sendProtocolMessage = useCallback(
    (
      type: string,
      payload: Record<string, unknown>,
      requestId = createRequestId('msg'),
      target?: TimelineTarget,
    ) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || !socketVerifiedRef.current) {
        if (autoConnectEnabled && !manualDisconnectRef.current) {
          setLastError('后端连接已断开，正在重连；请稍后重试。');
          connect();
        } else {
          setLastError('请先在设置里连接后端。');
        }
        return false;
      }

      let message: { id: string; type: string; payload: Record<string, unknown> } | null;
      try {
        message = sendRawProtocolFrame({ id: requestId, type, payload });
      } catch (error: unknown) {
        setLastError(
          error instanceof ConnectionError ? error.userMessage : '消息发送失败，请稍后重试。',
        );
        return false;
      }
      if (!message) {
        setLastError('请先在设置里连接后端。');
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

  const seedTerminalState = useCallback((workspace: WorkspaceRecord, conversation: ConversationRecord, patch: Partial<TerminalClientState> = {}) => {
    const terminalId = patch.terminalId?.trim() || terminalIdForConversation(conversation.id);
    setTerminalById((current) => {
      const existing = current[terminalId];
      const base: TerminalClientState = {
        terminalId,
        workspaceId: workspace.id,
        conversationId: conversation.id,
        tenantId: workspace.tenantId || settings.tenantId,
        cwd: workspace.path,
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
      return {
        ...current,
        [terminalId]: { ...base, ...existing, ...patch },
      };
    });
    return terminalId;
  }, [settings.tenantId]);

  const startTerminalSession = useCallback((
    workspace: WorkspaceRecord,
    conversation: ConversationRecord,
    options: { cwd: string; shell: string; rows: number; cols: number; terminalId?: string },
  ) => {
    const cwd = options.cwd.trim() || workspace.path;
    const shell = options.shell.trim();
    const rows = Number.isFinite(options.rows) ? Math.round(options.rows) : DEFAULT_TERMINAL_ROWS;
    const cols = Number.isFinite(options.cols) ? Math.round(options.cols) : DEFAULT_TERMINAL_COLS;
    const terminalId = seedTerminalState(workspace, conversation, {
      terminalId: options.terminalId,
      cwd,
      shell,
      rows,
      cols,
      status: 'starting',
      error: '',
      exitCode: null,
      output: [
        terminalOutputLine('system', `starting terminal in ${cwd}`),
      ],
    });
    const sent = sendProtocolMessage('terminal.start', {
      terminalId,
      tenantId: workspace.tenantId || settings.tenantId,
      workspaceId: workspace.id,
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
            error: '请先在设置里连接后端。',
            output: [
              ...existing.output,
              terminalOutputLine('error', '请先在设置里连接后端。'),
            ].slice(-TERMINAL_MAX_OUTPUT_ENTRIES),
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
      appendTerminalOutput(terminalId, terminalOutputLine('error', '请先在设置里连接后端。'));
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
          output: [
            ...existing.output,
            terminalOutputLine('system', force ? 'force stopping terminal' : 'stopping terminal'),
          ].slice(-TERMINAL_MAX_OUTPUT_ENTRIES),
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

  const requestTerminalStatus = useCallback((workspace: WorkspaceRecord, conversation: ConversationRecord, terminalId?: string) => {
    const resolvedTerminalId = seedTerminalState(workspace, conversation, { terminalId });
    return sendProtocolMessage('terminal.status', {
      tenantId: workspace.tenantId || settings.tenantId,
      workspaceId: workspace.id,
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
      setModelCatalogError('model/list 请求超时，已保留内置模型列表');
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
      setModelCatalogError('请先连接后端后再刷新模型列表');
      return false;
    }
    return true;
  }, [sendProtocolMessage, settings.tenantId]);

  const createWorkspace = useCallback(
    (nameDraft: string, pathDraft: string) => {
      const path = pathDraft.trim();
      if (!path) {
        desktopAlert('缺少目录', '请输入要管理的目录路径。');
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
      };
      const nextConversation = createDefaultConversation(nextWorkspace);

      setWorkspaces((current) => [nextWorkspace, ...current]);
      setConversations((current) => [nextConversation, ...current]);
      setActiveWorkspaceId(id);
      setActiveConversationId(nextConversation.id);
      pushSystem('已添加目录', nextWorkspace.path);
      return { workspace: nextWorkspace, conversation: nextConversation };
    },
    [
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
    const next: BackendConnectionProfile = { ...profileFromSettings(settings, '新后端', id), ...profile, id, createdAt: Date.now(), updatedAt: Date.now() };
    setBackendConnections((current) => [...current, next]);
    setActiveBackendConnectionId(id);
    setSettings((current) => settingsFromProfile(next, current));
    return next;
  }, [settings]);

  const removeBackendConnection = useCallback((id: string) => {
    if (backendConnections.length <= 1) return;
    const next = backendConnections.filter((profile) => profile.id !== id);
    setBackendConnections(next);
    if (activeBackendConnectionId === id && next[0]) {
      setActiveBackendConnectionId(next[0].id);
      setSettings((current) => settingsFromProfile(next[0], current));
    }
  }, [activeBackendConnectionId, backendConnections]);

  const selectWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
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
      if (
        connectionState === 'open' &&
        removedWorkspace &&
        (!removedWorkspace.backendConnectionId || removedWorkspace.backendConnectionId === activeBackendConnectionId)
      ) {
        void fetch(buildHttpUrl(settings.serverUrl, `/v2/workspaces/${encodeURIComponent(workspaceId)}`), {
          method: 'DELETE',
          headers: authHeaders(settings),
        }).then((response) => {
          if (!response.ok) throw new Error(`workspace delete returned ${response.status}`);
        }).catch((error) => setLastError(error instanceof Error ? error.message : '工作区删除同步失败'));
      }
      const removedConversationIds = conversations
        .filter((conversation) => conversation.workspaceId === workspaceId)
        .map((conversation) => conversation.id);
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
    [activeBackendConnectionId, activeWorkspaceId, connectionState, conversations, settings, workspaces],
  );

  const renameWorkspace = useCallback((workspaceId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) {
      desktopAlert('名称不能为空', '请输入新的工作区名称。');
      return;
    }
    updateWorkspace(workspaceId, { name: nextName });
  }, [updateWorkspace]);

  const forkWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      desktopAlert('未找到工作区', '请返回后重新选择工作区。');
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
    };
    const sourceConversations = conversations.filter((conversation) => conversation.workspaceId === workspaceId);
    const nextConversations = sourceConversations.length > 0
      ? sourceConversations.map((conversation) => ({
          ...forkConversationRecord(conversation),
          workspaceId: nextWorkspace.id,
        }))
      : [createDefaultConversation(nextWorkspace)];

    setWorkspaces((current) => [nextWorkspace, ...current]);
    setConversations((current) => [...nextConversations, ...current]);
    setActiveWorkspaceId(nextWorkspace.id);
    setActiveConversationId(nextConversations[0]?.id ?? '');
    return { workspace: nextWorkspace, conversation: nextConversations[0] ?? null };
  }, [conversations, workspaces]);

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
      return Boolean(sendRawProtocolFrame({
        id: createRequestId('sub'),
        type: 'conversation.subscribe',
        payload: {
          conversationId: conversation.v2ConversationId,
          afterSequence: 0,
          limit: CHAT_ATTACH_REPLAY_LIMIT,
        },
      }));
    }
    const sessionId = sessionIdForConversation(workspace, conversation);
    const afterCursor = sessionCursorsRef.current.get(sessionId) ?? null;
    return sendWorkspaceCommand(workspace, 'codex.local.attach', {
      afterCursor,
      replayLimit: CHAT_ATTACH_REPLAY_LIMIT,
    }, conversation);
  }, [sendRawProtocolFrame, sendWorkspaceCommand]);

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
        const timeoutId = setTimeout(() => {
          pendingLocalStartsRef.current.delete(conversation.id);
          updateConversation(conversation.id, { localAdapterState: 'error' });
          const error = new Error('本地会话启动超时，请先确认 Codex 本地 adapter 可用。');
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
          const error = new Error('请先在设置里连接后端。');
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
          const error = new Error('创建 thread 超时，请稍后重试。');
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
          const error = new Error('请先在设置里连接后端。');
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
      setLastError('未找到工作区，无法刷新 Codex threads。');
      return false;
    }
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动');
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
      finishPendingThreadList(pending, 'thread/list 请求超时');
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
      finishPendingThreadList(pendingThreadListsRef.current.get(workspaceId)!, '请先在设置里连接后端。');
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
      desktopAlert('未选择对话', '请先选择一个 Codex thread。');
      return false;
    }
    const { workspace, conversation } = context;
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动');
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
        setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : '创建 thread 失败');
        return false;
      }
    }
    if (!threadId) {
      setLastError('当前记录还没有原生 thread id。');
      return false;
    }
    const requestId = createRequestId(`thread-${action}`);
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (!pending) {
        return;
      }
      finishPendingThreadAction(pending, `${method} 请求超时`);
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
        finishPendingThreadAction(pending, '请先在设置里连接后端。');
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
      desktopAlert('未选择对话', '请先选择一个 Codex thread。');
      return false;
    }
    const { workspace, conversation } = context;
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      setLastError(error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动');
      return false;
    }
    const requestId = createRequestId(`thread-${action}`);
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (!pending) {
        return;
      }
      finishPendingThreadAction(pending, `${method} 请求超时`);
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
        finishPendingThreadAction(pending, '请先在设置里连接后端。');
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
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
          finishPendingThreadAction(pending, 'mcpServerStatus/list 请求超时');
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
          finishPendingThreadAction(pending, '请先在设置里连接后端。');
        }
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : 'MCP 状态读取失败';
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
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动';
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
        finishPendingThreadAction(pending, 'permissionProfile/list 请求超时');
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
        finishPendingThreadAction(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    return true;
  }, [finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const requestHooksCatalog = useCallback(async (conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动';
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
        finishPendingThreadAction(pending, 'hooks/list 请求超时');
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
        finishPendingThreadAction(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    return true;
  }, [finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const requestPluginsCatalog = useCallback(async (conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动';
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
        finishPendingThreadAction(pending, 'plugin/list 请求超时');
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
        finishPendingThreadAction(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    return true;
  }, [finishPendingThreadAction, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const requestMemorySettings = useCallback(async (conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动';
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
        finishPendingThreadAction(pending, 'config/read 请求超时');
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
        finishPendingThreadAction(pending, '请先在设置里连接后端。');
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
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : 'Memory 设置失败';
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
        finishPendingThreadAction(pending, 'config/batchWrite 请求超时');
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
        finishPendingThreadAction(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    return true;
  }, [ensureThreadId, finishPendingThreadAction, getConversationContext, memorySettingsByConversation, sendLocalMethodRequest, startLocalAdapter]);

  const resetMemories = useCallback(async (conversationId: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
      return false;
    }
    const { workspace, conversation } = context;
    try {
      await startLocalAdapter(workspace, conversation);
    } catch (error) {
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动';
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('memory-reset');
    const timeoutId = setTimeout(() => {
      const pending = pendingThreadActionsRef.current.get(requestId);
      if (pending) {
        finishPendingThreadAction(pending, 'memory/reset 请求超时');
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
        finishPendingThreadAction(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    appendTimeline(makeSystemEntry('Memory reset requested', '已请求重置本地 memories。', workspace.id, conversation.id));
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
      setLastError('当前 Agent 不支持此权限模式。');
      return false;
    }
    if (pendingV2SubmissionsRef.current.has(conversationId) || thinkingConversationsRef.current[conversationId] === true) {
      setLastError('请等待当前请求完成后再更改权限。');
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
      setLastError('当前 Agent 不支持此工作模式。');
      return false;
    }
    if (pendingV2SubmissionsRef.current.has(conversationId) || thinkingConversationsRef.current[conversationId] === true) {
      setLastError('请等待当前请求完成后再更改工作模式。');
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
    if (!preset) { setLastError('请选择请求审批、自动审批或完全访问。'); return false; }
    return applyConversationPermissionMode(conversationId,
      preset.id === 'full-access' ? 'full-access' : preset.id === 'auto-review' ? 'auto' : 'ask');
  }, [applyConversationPermissionMode]);

  const setWorkspaceServiceTier = useCallback((conversationId: string, nextTier: string, title: string) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      setLastError('请先在设置里连接后端。');
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

  const requestGitDiff = useCallback(async (conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动';
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
        finishPendingGitDiff(pending, 'gitDiffToRemote 请求超时');
      }
    }, 15000);
    pendingGitDiffsRef.current.set(requestId, {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      requestId,
      timeoutId,
    });
    const sent = sendLocalMethodRequest(workspace, conversation, 'gitDiffToRemote', { cwd: workspace.path }, requestId);
    if (!sent) {
      const pending = pendingGitDiffsRef.current.get(requestId);
      if (pending) {
        finishPendingGitDiff(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    return true;
  }, [finishPendingGitDiff, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const openGitDiff = useCallback((conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
      return;
    }
    openPanel('GitDiff', {
      workspaceId: context.workspace.id,
      conversationId: context.conversation.id,
    });
    void requestGitDiff(context.conversation.id);
  }, [getConversationContext, requestGitDiff]);

  const openTerminal = useCallback((conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
      return;
    }
    seedTerminalState(context.workspace, context.conversation);
    openPanel('Terminal', {
      workspaceId: context.workspace.id,
      conversationId: context.conversation.id,
    });
    if (connectionState === 'open') {
      requestTerminalStatus(context.workspace, context.conversation);
    }
  }, [connectionState, getConversationContext, requestTerminalStatus, seedTerminalState]);

  const requestSkillList = useCallback(async (conversationId = activeConversationRef.current, forceReload = false) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      const message = error instanceof Error ? localTurnErrorMessage(error.message) : '本地会话未启动';
      setSkillListStatus('error');
      setSkillListError(message);
      setLastError(message);
      return false;
    }
    const requestId = createRequestId('skills');
    const timeoutId = setTimeout(() => {
      const pending = pendingSkillListsRef.current.get(requestId);
      if (pending) {
        finishPendingSkillList(pending, 'skills/list 请求超时');
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
        finishPendingSkillList(pending, '请先在设置里连接后端。');
      }
      return false;
    }
    return true;
  }, [finishPendingSkillList, getConversationContext, sendLocalMethodRequest, startLocalAdapter]);

  const openExperimentalFeatures = useCallback((conversationId = activeConversationRef.current) => {
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
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
      desktopAlert('未找到工作区', '请返回后重新选择工作区。');
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
        options?.provider ? '该 Agent 当前不可用' : '没有可用的 Agent',
        options?.provider ? '请选择其他可用的 Agent。' : '请先连接后端，并确认至少有一个 Agent 可用。',
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
      setActiveWorkspaceId(workspace.id);
      setActiveConversationId(existing.id);
      return existing;
    }
    const now = Date.now();
    const placeholder = {
      ...(existing ?? createDefaultConversation(workspace)),
      title: options?.title?.trim() || '新对话',
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
      setLastError('无法打开 worktree：源对话或目录路径无效。');
      return null;
    }
    const backendId = source.backendConnectionId ?? sourceWorkspace.backendConnectionId
      ?? activeBackendConnectionIdRef.current;
    if (backendId !== activeBackendConnectionIdRef.current
      || (source.backendConnectionId && sourceWorkspace.backendConnectionId
        && source.backendConnectionId !== sourceWorkspace.backendConnectionId)) {
      setLastError('后端已切换，请在源对话的后端重新读取 worktree 列表。');
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
      desktopAlert('未选择对话', '请先选择工作区和对话。');
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
      desktopAlert('正在创建对话', '第一条消息正在发送，请稍候。');
      return;
    }
    if (!canSwitchConversationAgent(conversation, {
      timeline: timelineRef.current.filter((entry) => entry.conversationId === conversation.id),
      thinking: thinkingConversationsRef.current[conversation.id] === true,
    })) {
      desktopAlert('无法切换 Agent', '任务开始后不能再切换 Agent。请新建对话。');
      return;
    }
    const descriptor = v2Providers.find((item) => item.id === provider);
    if (!descriptor?.available) {
      desktopAlert('该 Agent 当前不可用', descriptor?.unavailableReason || '请选择其他可用的 Agent。');
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
      desktopAlert('名称不能为空', '请输入新的对话标题。');
      return;
    }
    const context = getConversationContext(conversationId);
    if (!context) {
      desktopAlert('未选择对话', '请先选择一个 Codex thread。');
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
      desktopAlert('未选择对话', '请先选择一个 Codex thread。');
      return null;
    }
    const { workspace, conversation } = context;
    if (conversation.v2ConversationId) {
      const provider = v2ProvidersRef.current.find((item) => item.id === conversation.provider);
      if (!provider?.capabilities.controlActions?.includes('fork')) {
        setLastError('当前 Agent 未提供已验证的原生分叉能力。');
        return null;
      }
      if (thinkingConversationsRef.current[conversation.id]) {
        setLastError('请先结束当前任务再分叉对话。');
        return null;
      }
      void (async () => {
        try {
          const result = await sendProtocolCommand({ id: createRequestId('fork'), type: 'conversation.fork', payload: {
            conversationId: conversation.v2ConversationId, title: `${conversation.title || '对话'} · 分叉`,
          } }, 45_000);
          if (typeof result.conversationId !== 'string') throw new Error('分叉已响应，但未返回新对话标识，请刷新对话列表核对。');
          const api = new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken });
          const created = await api.getConversation(result.conversationId);
          const record = { ...conversationFromManifest(created, workspace.id), backendConnectionId: conversation.backendConnectionId,
            model: conversation.model, reasoningEffort: conversation.reasoningEffort,
            permissionMode: conversation.permissionMode, mode: conversation.mode };
          conversationsRef.current = [record, ...conversationsRef.current.filter((item) => item.id !== record.id)];
          setConversations((current) => [record, ...current.filter((item) => item.id !== record.id)]);
          setActiveWorkspaceId(workspace.id);
          setActiveConversationId(record.id);
          await recoverConversation(record.id);
          await sendProtocolCommand({ id: createRequestId('sub'), type: 'conversation.subscribe', payload: {
            conversationId: created.id, afterSequence: conversationRecoveryRef.current?.get(created.id)?.appliedSequence ?? 0, limit: 500,
          } });
        } catch (error) { setLastError(error instanceof Error ? error.message : '分叉失败'); }
      })();
      return null;
    }
    const threadId = normalizeThreadId(conversation.threadId);
    if (!threadId) {
      setLastError('当前记录还没有可 fork 的原生 thread。');
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
  }, [getConversationContext, recoverConversation, sendProtocolCommand, settings.serverUrl, settings.authToken, sendNativeThreadAction, settings.approvalPolicy, settings.approvalsReviewer, settings.defaultModel, settings.sandboxMode]);

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
    if (normalizeThreadId(conversation.threadId)) {
      void sendNativeThreadAction(conversationId, 'archive', 'thread/archive', (threadId) => ({ threadId }));
    }
  }, [getConversationContext, sendNativeThreadAction, updateConversation]);

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
        desktopAlert('未选择对话', '请先选择工作区和对话。');
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
        desktopAlert('该 Agent 当前不可用', descriptor?.unavailableReason || '请选择其他可用的 Agent。');
        return null;
      }

      const backendProfile = backendConnections.find((item) => item.id === conversation.backendConnectionId)
        ?? backendConnections.find((item) => item.id === workspace.backendConnectionId);
      const backendConnectionId = backendProfile?.id ?? workspace.backendConnectionId ?? null;
      const title = conversation.title.trim();
      const isDefaultTitle = title === '新对话' || title === '默认对话';
      const firstMessageTitle = firstMessageText.trim().slice(0, 18);

      try {
        const api = new V2ApiClient({
          serverUrl: backendProfile?.serverUrl ?? settings.serverUrl,
          authToken: backendProfile?.authToken ?? settings.authToken,
        });
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
        sendRawProtocolFrame({
          id: createRequestId('sub'),
          type: 'conversation.subscribe',
          payload: { conversationId: created.id, afterSequence: 0, limit: 200 },
        });
        return record;
      } catch (error) {
        const message = error instanceof ConnectionError
          ? `${error.userMessage}（${error.technicalDetails}）`
          : error instanceof Error ? error.message : '创建对话失败';
        setLastError(message);
        desktopAlert('创建对话失败', message);
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
  }, [backendConnections, getConversationContext, recoverConversation, sendRawProtocolFrame, settings.authToken, settings.serverUrl]);

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
        desktopAlert('未选择对话', '请先选择工作区和对话。');
        return false;
      }
      const { workspace, conversation } = context;
      // Reference attachments only send while their [引用:name] token is in the text.
      const attachments = liveComposerAttachments(text, rawAttachments);
      if (!isV2Conversation(conversation) || !conversation.provider) {
        desktopAlert('当前不是 v2 对话', '请新建对话后再发送。');
        return false;
      }

      const permissionMode = conversationPermissionMode(conversation, workspace, v2ProvidersRef.current);
      if (!permissionMode) {
        setLastError('请先为当前对话选择权限模式；旧版只读配置不会自动扩大权限。');
        return false;
      }
      const permissionConfig = conversationPermissionCapabilities(conversation, v2ProvidersRef.current);
      if (conversation.mode === 'plan' && !permissionConfig?.supportsPlan) {
        setLastError('当前 Agent 不支持计划模式，请切换到执行模式。');
        return false;
      }

      if (pendingV2SubmissionsRef.current.has(conversation.id)) {
        setLastError('上一条请求尚未结束或确认，请先核对记录。');
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
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || !socketVerifiedRef.current) {
        if (autoConnectEnabled && !manualDisconnectRef.current) {
          setLastError('后端连接已断开，正在重连；请稍后重试。');
          connect();
        } else {
          setLastError('请先在设置里连接后端。');
        }
        restoreSubmission();
        return false;
      }
      if (attachments.some((attachment) => attachment.kind === 'image')) {
        const imageSupport = conversationImageInputSupport(conversation, v2ProvidersRef.current, {
          models: conversation.provider
            ? providerModelsRef.current[conversation.provider as ProviderKind]
            : undefined,
          profileCapability: providerImageInputRef.current[conversation.id],
        });
        if (!imageSupport.supported) {
          setLastError(imageSupport.reason || '当前 Agent 不支持图片输入');
          restoreSubmission();
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
        const skillRefs = promptSkillsFromAttachments(skills);
        const content = promptContentFromAttachments(attachments);
        const model = readyConversation.provider === 'codex'
          ? readyConversation.model || workspace.model || settings.defaultModel || undefined
          : readyConversation.model || undefined;
        const reasoningEffort = readyConversation.reasoningEffort || undefined;
        const result = await sendProtocolCommand({
          id: requestId,
          type: 'conversation.prompt',
          payload: {
            conversationId: v2Id,
            clientRequestId: requestId,
            text,
            permissionMode,
            workMode: readyConversation.mode === 'plan' ? 'plan' : 'implement',
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(skillRefs.length ? { skills: skillRefs } : {}),
            ...(content.length ? { content } : {}),
          },
        });
        updateConversation(readyConversation.id, { permissionMode, mode: readyConversation.mode === 'plan' ? 'plan' : 'implement' });
        if (typeof result.turnId === 'string') submission.turnId = result.turnId;
        const terminal = submission.turnId ? settledV2TurnsRef.current.get(`${v2Id}:${submission.turnId}`) : undefined;
        if (terminal) {
          if (terminal === 'turn.failed') restoreSubmission();
          pendingV2SubmissionsRef.current.delete(conversation.id);
          setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: undefined }));
          if (terminal === 'turn.failed') return false;
        } else if (pendingV2SubmissionsRef.current.get(conversation.id) === submission) {
          submission.phase = 'running';
          setSubmissionStatusByConversation((current) => ({ ...current, [conversation.id]: 'running' }));
        }
        if (!isFirstPrompt && conversation.title === '新对话' && text.trim()) {
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
          await recoverConversation(conversation.id);
          const latest = pendingV2SubmissionsRef.current.get(conversation.id);
          const v2Id = conversationsRef.current.find((item) => item.id === conversation.id)?.v2ConversationId;
          const terminal = v2Id && submission.turnId ? settledV2TurnsRef.current.get(`${v2Id}:${submission.turnId}`) : undefined;
          if (terminal) return terminal !== 'turn.failed';
          return latest?.phase === 'running';
        }
        updateSentAttachmentRecords(sentAttachmentRecordsRef.current.filter((record) =>
          record.conversationId !== conversation.id || record.requestId !== requestId || Boolean(record.eventId)));
        setConversationThinking(conversation.id, false);
        const message = error instanceof ConnectionError
          ? error.userMessage
          : error instanceof Error ? error.message : '消息发送失败';
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
    [updateSentAttachmentRecords, getConversationContext, materializeV2Conversation, recoverConversation, promptContentFromAttachments, promptSkillsFromAttachments, sendProtocolCommand, setConversationAttachments, setConversationChatDraft, setConversationSelectedSkills, setConversationThinking, settings.defaultModel, updateConversation, autoConnectEnabled, connect],
  );

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
        desktopAlert('未选择对话', '请先选择工作区和对话。');
        return false;
      }

      const { workspace, conversation } = context;
      const attachments = liveComposerAttachments(text, rawAttachments);
      const permissionMode = conversationPermissionMode(conversation, workspace, v2ProvidersRef.current);
      const preset = PERMISSION_PRESETS.find((item) => item.id === (permissionMode === 'ask' ? 'default' : permissionMode === 'auto' ? 'auto-review' : permissionMode));
      if (!preset) {
        setLastError('请先为当前对话明确选择支持的权限模式。');
        return false;
      }
      const workMode = conversation.mode ?? mode;
      if (workMode === 'plan' && !conversationPermissionCapabilities(conversation, v2ProvidersRef.current)?.supportsPlan) {
        setLastError('当前 Agent 不支持计划模式，请切换到执行模式。');
        return false;
      }
      const sessionId = sessionIdForConversation(workspace, conversation);
      const commandWorkspace = commandWorkspaceForConversation(workspace, conversation);
      const conversationThreadId = normalizeThreadId(conversation.threadId);
      try {
        await startLocalAdapter(workspace, conversation);
      } catch (error) {
        const message = error instanceof Error ? error.message : '本地会话未启动';
        setLastError(localTurnErrorMessage(message));
        return false;
      }

      let threadId = '';
      try {
        threadId = await ensureThreadId(workspace, conversation, !conversationThreadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : '创建 thread 失败';
        setLastError(message);
        return false;
      }

      setConversationThinking(conversation.id, true);
      appendTimeline(makeSystemEntry('正在思考', '请求已发出，等待 Codex 返回中间步骤...', workspace.id, conversation.id));

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
                  title: conversation.title === '默认对话' ? text.slice(0, 18) || attachmentPrompt(attachments).slice(0, 18) || selectedSkillSummary(skills).slice(0, 18) || conversation.title : conversation.title,
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
      if (isV2Conversation(conversation)) {
        return sendV2Prompt(submission.text, conversationId, submission.skills, submission.attachments, submission.id);
      }
      return sendLocalTurn(submission.text, 'implement', conversationId, submission.attachments, submission.skills);
    };
  }, [sendLocalTurn, sendV2Prompt]);

  // Action menus send a separate message without replacing the composer's draft.
  const sendAgentMessage = useCallback(async (text: string, conversationId: string): Promise<'sent' | 'queued' | false> => {
    const context = getConversationContext(conversationId);
    if (!context || !text.trim()) return false;
    const pending = pendingV2SubmissionsRef.current.get(conversationId);
    if (pending?.phase === 'unknown') {
      setLastError('请先核对当前对话的发送状态。');
      return false;
    }
    if (thinkingConversationsRef.current[conversationId] || pending) {
      if (!queueHydrated) {
        setLastError('候选消息正在恢复，请稍后再发送。');
        return false;
      }
      const items = queuedChatDraftsRef.current[conversationId] ?? [];
      if (items.length >= 32) {
        setLastError('候选队列最多保存 32 条消息。');
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
  }, [getConversationContext, queueHydrated, sendLocalTurn, sendV2Prompt]);

  const toggleSelectedSkill = useCallback((conversationId: string, skill: SkillListItem) => {
    if (!skill.enabled) {
      desktopAlert('Skill 已禁用', '该 Skill 当前未启用，不能添加到下一条消息。');
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
      desktopAlert('Skill 无效', skill.error || '该 Skill 当前不能添加到下一条消息。');
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
      throw new Error('请先选择工作区');
    }
    const api = new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken });
    const result = await api.getSkillResource(provider, workspacePath, resourceId);
    return result.content;
  }, [activeWorkspace?.path, settings.authToken, settings.defaultWorkspacePath, settings.serverUrl]);

  const refreshMcpServer = useCallback((conversationId: string, resourceId: string) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId) ?? null;
    const v2Id = conversation?.v2ConversationId;
    if (!conversation || !isV2Conversation(conversation) || !v2Id) {
      desktopAlert('需要已创建的对话', '请先发送一条消息创建对话，再刷新 MCP。');
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
      desktopAlert('需要已创建的对话', '请先发送一条消息创建对话，再调用 MCP。');
      return false;
    }
    appendTimeline(makeSystemEntry('正在调用 MCP', `${toolName}`, workspace.id, conversation.id));
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
          desktopAlert('权限请求无效', '找不到对应的对话。');
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
          setLastError(error instanceof Error ? error.message : '审批结果尚未确认。');
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
        desktopAlert('未选择工作区', '请先选择一个工作区。');
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
        desktopAlert('未选择工作区', '请先选择一个工作区。');
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
    const labels = { ask: '请求审批', auto: '自动审批', 'full-access': '完全访问' };
    desktopAlert(
      '权限设置',
      config?.modes?.length ? '所选权限将在下次发送时应用。' : '当前 Agent 尚未提供权限设置能力。',
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
        desktopAlert('未选择工作区', '请先选择一个工作区。');
        return;
      }

      const { workspace, conversation } = context;
      const { model, reasoningEffort, invalidReasoningEffort } = parseModelCommandArgs(args);
      if (invalidReasoningEffort) {
        desktopAlert(
          '无效思考强度',
          '支持 none、minimal、low、medium、high、xhigh，也支持 max 作为 xhigh 的别名。',
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
          desktopAlert('Model', '请输入模型名或思考强度，例如 gpt-5.5 high。');
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
        `Model: ${nextModel || '未设置'}`,
        `Reasoning: ${nextReasoningEffort || '默认'}`,
      ].join('\n');
      appendTimeline(makeSystemEntry(
        'Model settings updated',
        `${detail}\n后续新 thread 和 turn 会把这些参数发送给 Codex app-server。`,
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
        desktopAlert('未选择工作区', '请先选择一个工作区。');
        return;
      }
      const nextModel = model.trim();
      if (!nextModel) {
        desktopAlert('缺少模型', '请选择或输入模型名。');
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
          '后续新 thread 和 turn 会把这些参数发送给 Codex app-server。',
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
        warning: 'reset 会清空 Codex 本地 memory，作用域不是单个 thread。',
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
        warning: '该命令会按 Codex app-server 语义以 unsandboxed full access 运行。',
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
        warning: '会直接追加 Responses API items 到 thread 历史。请只粘贴可信 JSON 数组。',
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
      warning: '需要粘贴 guardian denied action 的原始事件 JSON。',
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
      desktopAlert('未选择对话', '请先选择一个 Codex 对话。');
      return false;
    }
    const lastMessage = timelineRef.current.find(
      (entry) => entry.conversationId === conversationId && entry.kind === 'incoming' && entry.subtitle.trim(),
    );
    if (!lastMessage) {
      desktopAlert('Copy', '当前对话还没有可复制的 Codex 回复。');
      return false;
    }
    await navigator.clipboard.writeText(lastMessage.subtitle);
    appendTimeline(makeSystemEntry('Copied last response', '最近一条 Codex 回复已复制到剪贴板。', context.workspace.id, context.conversation.id));
    return true;
  }, [appendTimeline, getConversationContext]);

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
        desktopAlert('未选择工作区', '请先选择一个工作区。');
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
          if (!conversation.v2ConversationId || !provider?.capabilities.controlActions?.includes(lower)) {
            setLastError(lower === 'resume' ? '请发送明确的后续消息继续对话；当前 Agent 不支持独立恢复操作。' : '当前 Agent 不支持此操作。');
            return;
          }
          void sendProtocolCommand({ id: createRequestId(lower), type: `conversation.${lower}`, payload: {
            conversationId: conversation.v2ConversationId,
          } }).then(() => recoverConversation(conversation.id)).catch((error: unknown) => {
            setLastError(error instanceof Error ? error.message : '操作失败');
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
            const message = error instanceof Error ? error.message : `${title} 失败`;
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
          desktopAlert('没有待处理请求', '当前没有可回复的审批或问题。');
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
        sendLocalMethod('app/list', { limit: 50, forceRefetch: /reload|refresh|true|1/i.test(rest[0] ?? '') }, 'Apps requested', '已请求 Codex app-server 列出 apps。');
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
          addCommandNotice('MCP inventory requested', '已请求 MCP server 详细状态。');
          return;
        }
        if (/^(status|list|tools|refresh)$/i.test(subcommand)) {
          void requestMcpInventory(conversation.id, 'toolsAndAuthOnly');
          addCommandNotice('MCP inventory requested', '已请求 MCP server 状态。');
          return;
        }
        desktopAlert('MCP', 'Usage: /mcp [verbose]');
        return;
      }

      if (lower === 'compact') {
        setCompactionByConversation((current) => ({ ...current, [conversation.id]: { ...current[conversation.id], status: 'running', updatedAt: new Date().toISOString() } }));
        sendThreadMethod('thread/compact/start', (threadId) => ({ threadId }), 'Compact started', '已请求 Codex app-server 压缩当前 thread 上下文。');
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
            `已发送 thread/goal/set status=${status}。`,
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
          `已发送 ${method}。`,
        );
        return;
      }

      if (lower === 'rename') {
        const nextTitle = rest.join(' ').trim();
        if (!nextTitle) {
          desktopAlert('Rename', '请输入新的对话标题。');
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
        sendLocalMethod('account/logout', {}, 'Logout requested', '已请求 Codex app-server 登出当前账号。');
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
          sendLocalMethod('thread/backgroundTerminals/clean', { threadId: conversation.threadId }, 'Background terminals clean requested', '已请求 Codex 清理后台终端。');
        }
        if (sendWorkspaceCommand(workspace, 'codex.local.stop', { force: false }, conversation)) {
          const pending = pendingLocalStartsRef.current.get(conversation.id);
          if (pending) {
            clearTimeout(pending.timeoutId);
            pendingLocalStartsRef.current.delete(conversation.id);
            pending.reject(new Error('本地会话已停止'));
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
          setLastError('当前记录还没有可 resume 的原生 thread。');
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
        addCommandNotice('Thread fork sent', lower === 'side' || lower === 'btw' ? '已请求创建临时 side thread。' : '已请求 fork 当前原生 thread。');
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
          setLastError('当前对话还没有可中断的 thread。');
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
        openSlashCommandActionPage(workspace, conversation, '/subagents');
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
          addCommandNotice(`/${lower} recognized`, '已停止当前本地 Codex 会话；移动端应用不会退出。');
        }
        return;
      }

      const serviceTierCommand = serviceTierCommandForModel(lower, workspace.model || settings.defaultModel, modelCatalog);
      if (serviceTierCommand) {
        applyServiceTier(conversation.id, serviceTierCommand);
        return;
      }

      addCommandNotice(`/${lower} recognized`, '该命令不在当前内置命令清单中，已阻止作为普通 prompt 发送。');
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

  useEffect(() => {
    if (
      !hydrated ||
      connectionState !== 'open' ||
      !activeWorkspace ||
      !activeConversation ||
      isV2Conversation(activeConversation) ||
      activeConversation.archived === true
    ) {
      return;
    }
    const state = localConversationStateOf(activeConversation);
    if (
      state === 'running' ||
      state === 'starting' ||
      pendingLocalStartsRef.current.has(activeConversation.id)
    ) {
      return;
    }
    void startLocalAdapter(activeWorkspace, activeConversation).catch(() => undefined);
  }, [
    activeConversation?.archived,
    activeConversation?.id,
    activeConversation?.localAdapterState,
    activeConversation?.provider,
    activeConversation?.sessionId,
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
      desktopAlert('未选择工作区', '请先选择一个工作区。');
      return;
    }
    if (isV2Conversation(conversation)) {
      const v2Id = conversation.v2ConversationId;
      if (!v2Id) {
        setLastError('第一条消息正在创建对话，请稍候。');
        return;
      }
      void sendProtocolCommand(buildConversationControlMessage(v2Id, 'cancel')).then(() => {
        appendTimeline(makeSystemEntry('停止请求已确认', '正在同步当前回合状态。', workspace.id, conversation.id));
        return recoverConversation(conversation.id);
      }).catch((error: unknown) => {
        setLastError(error instanceof Error ? error.message : '停止结果尚未确认。');
        void recoverConversation(conversation.id);
      });
      return;
    }
    const threadId = normalizeThreadId(conversation.threadId);
    if (!threadId) {
      setLastError('当前还没有可中断的 thread。');
      return;
    }
    if (sendWorkspaceCommand(workspace, 'codex.local.interrupt', { threadId, turnId: turnIds[conversationId] || '' }, conversation)) {
      appendTimeline(makeSystemEntry('已发送停止', '正在请求 Codex 中断当前思考。', workspace.id, conversation.id));
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
      desktopAlert('未选择工作区', '请先选择一个工作区。');
      return;
    }
    const { workspace, conversation } = context;
    if (attachments.some((attachment) => attachment.kind === 'image')) {
      const imageSupport = conversationImageInputSupport(conversation, v2ProvidersRef.current, {
        models: conversation.provider
          ? providerModelsRef.current[conversation.provider as ProviderKind]
          : undefined,
        profileCapability: providerImageInputRef.current[conversation.id],
      });
      if (!imageSupport.supported) {
        setLastError(imageSupport.reason || '当前 Agent 不支持图片输入');
        return;
      }
    }
    const isThinking = thinkingConversations[conversationId] === true;
    if (text === '/compact') {
      if (isThinking || pendingV2SubmissionsRef.current.has(conversationId)) {
        setLastError('请等待当前任务结束后再压缩上下文。');
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
        appendTimeline(makeSystemEntry('已引用文件', mentionSummary, workspace.id, conversationId));
      }
    }
    const liveAttachments = liveComposerAttachments(text, attachments);
    if (liveAttachments.length > 0) {
      appendTimeline(makeSystemEntry('已附加附件', attachmentSummary(liveAttachments), workspace.id, conversationId));
    }
    if (skills.length > 0) {
      appendTimeline(makeSystemEntry('已选择 Skill', selectedSkillSummary(skills), workspace.id, conversationId));
    }
    const clearSubmittedComposer = () => {
      setConversationChatDraft(conversationId, (current) => current.trim() === text ? '' : current);
      setConversationAttachments(conversationId, (current) => current === attachments ? [] : current);
      setConversationSelectedSkills(conversationId, (current) => current === skills ? [] : current);
      setConversationComposerSelection(conversationId, DEFAULT_COMPOSER_SELECTION);
    };
    if (isThinking) {
      const nativeQueue = v2ProvidersRef.current.find(item => item.id === conversation.provider)?.capabilities.followUpQueue === true;
      if (conversation.v2ConversationId && nativeQueue && !liveAttachments.length && !skills.length) {
        void controlConversation(conversationId, { action: 'queueAdd', itemId: createRequestId('queue'), text })
          .then(accepted => { if (accepted) clearSubmittedComposer(); });
        return;
      }
      if ((queuedChatDraftsRef.current[conversationId]?.length ?? 0) >= 32) {
        setLastError('候选队列最多保存 32 条消息。'); return;
      }
      clearSubmittedComposer();
      queuedChatDraftsRef.current = {
        ...queuedChatDraftsRef.current,
        [conversationId]: [...(queuedChatDraftsRef.current[conversationId] ?? []),
          { id: createRequestId('queued'), text, attachments, skills }],
      };
      setQueuedChatDrafts(queuedChatDraftsRef.current);
      appendTimeline(makeSystemEntry('消息已加入候选', '当前任务完成后会自动继续发送。', workspace.id, conversationId));
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
  }, [appendTimeline, chatDrafts, composerAttachments, controlConversation, getConversationContext, rememberMentionReferences, selectedSkills, sendLocalTurn, sendSlashCommand, sendV2Prompt, setConversationAttachments, setConversationChatDraft, setConversationComposerSelection, setConversationSelectedSkills, thinkingConversations]);

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
        setLastError('当前对话还没有可中断的 thread。');
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
        pending.reject(new Error('本地会话已停止'));
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
        setLastError('当前 Agent 未提供此对话操作。');
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
        desktopAlert('Memory', '请输入 on、off 或 reset。');
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
        desktopAlert('Shell command', '请输入要执行的 shell command。');
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
        desktopAlert('Turn items', '请输入 turn id。');
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
        desktopAlert('Inject items', '请输入 JSON 数组。');
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
        desktopAlert('Guardian', '请输入有效 JSON。');
      }
    }
  }, [sendNativeThreadAction, sendTrackedLocalMethod]);

  const visibleTimeline = useMemo(() => timeline.map((entry) =>
    projectSentAttachments([entry], sentAttachmentRecords, entry.conversationId ?? '')[0]),
  [timeline, sentAttachmentRecords]);

  return {
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
    events,
    timeline: visibleTimeline,
    mentionHistory,
    experimentalFeatures,
    setExperimentalFeatures,
    selectedRequestId,
    setSelectedRequestId,
    chatDrafts,
    queuedChatDrafts,
    queuePausedByConversation,
    removeQueuedFollowUp,
    resumeQueuedFollowUps,
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
    submissionStatusByConversation,
    recoverConversation,
    memoryEntriesByConversation,
    usageRecords,
    pendingRequests,
    selectedRequest,
    activeWorkspace,
    activeConversation,
    connect,
    closeSocket,
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
    fetchWorkspaceEntries: async (cwd: string, query: string) => {
      const api = new V2ApiClient({ serverUrl: settings.serverUrl, authToken: settings.authToken });
      return api.listWorkspaceEntries(cwd, query);
    },
    openModelPicker,
    applyModelCommand,
    applyWorkspaceModelSelection,
    applyConversationModelSelection,
    sendSlashCommand,
    openSlashCommandActionPage,
    copyLastAgentMessage,
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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const appPath = join(root, '../../TodeX_app/App.tsx');
const sessionDir = join(root, '../src/renderer/session');
mkdirSync(sessionDir, { recursive: true });

const source = readFileSync(appPath, 'utf8').split('\n');

function lineOf(needle) {
  const index = source.findIndex((line) => line === needle);
  if (index < 0) {
    throw new Error(`marker not found in App.tsx: ${needle}`);
  }
  return index;
}

// Marker-based slicing: line numbers rot every time App.tsx changes, stable
// structural markers do not. Helpers run from the first shared type to the App
// component; the session slice is the component body up to its loading
// early-return JSX (the desktop hook has no UI of its own).
const helpersStart = lineOf('type ServerVersion = {');
const sessionStart = lineOf('export default function App() {');
const hydratedReturn = source.findIndex((line) => line === '  if (!hydrated) {');
if (hydratedReturn < 0) {
  throw new Error('App() loading early-return marker not found');
}
let sessionEnd = hydratedReturn - 1;
while (source[sessionEnd].trim() === '') {
  sessionEnd -= 1;
}

function sliceLines(start, end) {
  return source.slice(start, end + 1).join('\n');
}

function exportTopLevel(block) {
  return block
    .replace(/^type /gm, 'export type ')
    .replace(/^const /gm, 'export const ')
    .replace(/^function /gm, 'export function ')
    .replace(/^async function /gm, 'export async function ');
}

let helpers = sliceLines(helpersStart, sessionStart - 1);
// App.tsx interleaves RN navigation/theme plumbing between the shared helpers;
// the desktop session never renders, so drop that island wholesale.
const navIslandStart = helpers.indexOf('const Stack = createNativeStackNavigator<RootStackParamList>();');
const navIslandEnd = helpers.indexOf("const DARK_STATUS_BAR_STYLE = 'light' as const;");
if (navIslandStart < 0 || navIslandEnd < navIslandStart) {
  throw new Error('RN navigation island markers not found in App.tsx helpers region');
}
helpers = helpers.slice(0, navIslandStart) + helpers.slice(navIslandEnd + "const DARK_STATUS_BAR_STYLE = 'light' as const;".length).replace(/^\n+/, '\n');
helpers = helpers.replace(/todex\.mobile\./g, 'todex.desktop.');
helpers = helpers.replace(
  'const encoded = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });',
  'const encoded = await readDesktopFileBase64(uri);',
);
helpers = helpers.replace(
  `    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return null;
    }
    return 'size' in info && typeof info.size === 'number' ? info.size : null;`,
  `    const info = await readDesktopFile(uri);
    return info.sizeBytes;`,
);
helpers = helpers.replace(
  '    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });',
  '    const info = await readDesktopFile(uri);\n    return info.text;',
);
helpers = helpers.replace(
  "type ComposerSelection = TextInputSelectionChangeEventData['selection'];",
  'export type ComposerSelection = { start: number; end: number };',
);
helpers = helpers.replace(
  "    return health.error || '后端不可达';",
  "    return !health.error || health.error === 'Failed to fetch' ? '后端不可达' : health.error;",
);
helpers = exportTopLevel(helpers);

const helpersHeader = `import type {
  CodexHooksListEntry,
  CodexMcpServerStatus,
  CodexMemorySettings,
  CodexModelCatalogItem,
  CodexNativeThread,
  CodexPermissionProfileSummary,
  CodexPluginListResult,
  CodexReasoningEffortOption,
  CodexServiceTierOption,
  ConnectionSettings,
  LocalAdapterState,
  PendingRequest,
  ServerEvent,
  WorkspaceRecord,
} from '@todex/protocol/todex';
import {
  buildHttpUrl,
  createRequestId,
  eventId,
  eventPayloadData,
  extractThreadIdFromEvent,
  DEFAULT_REASONING_EFFORT_OPTIONS,
  FAST_SERVICE_TIER,
  FALLBACK_CODEX_MODELS,
  mergeWorkspaceRecords,
  normalizeReasoningEffort,
  parseMcpServerStatusListResponse,
  parsePermissionProfileListResponse,
  normalizeThreadId,
  parseCodexNativeThread,
  prepareWorkspaceSyncPayload,
  shortJson,
  type CodexThreadHistoryEntry,
} from '@todex/protocol/todex';
import type { TransportCryptoSession } from '@todex/protocol/transportCrypto';
import type { PairingQrChunk } from '@todex/protocol/transportCrypto';
import {
  cursorFromEvent as transportCursorFromEvent,
  sessionIdFromEvent as transportSessionIdFromEvent,
} from '@todex/protocol/transport';

async function readDesktopFile(uri: string): Promise<{ sizeBytes: number | null; text?: string; base64?: string }> {
  if (uri.startsWith('data:')) {
    return { sizeBytes: null };
  }
  return window.todexDesktop.fs.readFile(uri);
}

async function readDesktopFileBase64(uri: string): Promise<string> {
  const file = await window.todexDesktop.fs.readFile(uri);
  return file.base64;
}
`;

writeFileSync(join(sessionDir, 'helpers.ts'), `${helpersHeader}\n${helpers}\n`);

let session = sliceLines(sessionStart, sessionEnd);
session = session.replace('export default function App() {', 'export function useTodeXSession(openPanel: OpenPanelFn) {');
session = session.replace(
  `  const { theme } = useUniwind();
  const darkMode = theme === 'dark';
  const themedStyles = useMemo(() => makeAppThemeStyles(darkMode), [darkMode]);
  const navTheme = darkMode ? DARK_NAV_THEME : LIGHT_NAV_THEME;
  const statusBarStyle = darkMode ? DARK_STATUS_BAR_STYLE : LIGHT_STATUS_BAR_STYLE;
`,
  '',
);
session = session.replace(/Alert\.alert/g, 'desktopAlert');
session = session.replace(
  'await Clipboard.setStringAsync(lastMessage.subtitle);',
  'await navigator.clipboard.writeText(lastMessage.subtitle);',
);
session = session.replace(/navigationRef\.current\?\.navigate/g, 'openPanel');
session = session.replace(
  `  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        flushJsonSave();
      }
    });
    return () => subscription.remove();
  }, [flushJsonSave]);`,
  `  useEffect(() => {
    const onHide = () => flushJsonSave();
    window.addEventListener('blur', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('blur', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [flushJsonSave]);`,
);

const sessionHeader = `import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { ProviderDescriptor, ProviderKind, ConversationManifest } from '@todex/protocol/v2';
import { V2ApiClient, buildV2WebSocketUrlWithOptions } from '@todex/protocol/v2';
import {
  ConnectionSettings,
  CodexMemorySettings,
  CodexModelCatalogItem,
  CodexNativeThread,
  CodexServiceTierOption,
  LocalAdapterState,
  PendingRequest,
  ServerEvent,
  WorkspaceRecord,
  approvalResponsePayload,
  buildHttpUrl,
  classifyPendingRequest,
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
  TOKEN_STORAGE_KEY,
  JSON_SAVE_DEBOUNCE_MS,
  SESSION_CURSOR_SAVE_DEBOUNCE_MS,
  WORKSPACE_SYNC_DEBOUNCE_MS,
  SOCKET_EVENT_BATCH_SIZE,
  SOCKET_FRAME_DECODE_BATCH_SIZE,
  SOCKET_FRAME_DECODE_BUDGET_MS,
  MAX_TRANSPORT_HELLO_SESSION_CURSORS,
  MAX_TIMELINE_ITEMS,
  MAX_EVENTS,
  RECONNECT_DELAY_MS,
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
  selectedSkillSummary,
  skillIdFromPath,
  parseSkillListItems,
  extractProtocolError,
  reasoningEffortLabel,
  modelDisplayLabel,
  reasoningOptionsForModel,
  defaultReasoningForModel,
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
  isConversationHighlighted,
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
  permissionProfileLabel,
  permissionPresetSelected,
  approvalsReviewerValue,
  makeOutgoingEntry,
  makeSystemEntry,
  classifyProgressEvent,
  classifyChatEvent,
  isTurnTerminalEvent,
  timelineEntryFromNativeHistoryEntry,
  isVisibleConversationEntry,
  conversationPreviewText,
  isStepProgressEntry,
  isThinkingProgressEntry,
  isCollapsibleProgressEntry,
  executionGroupId,
  buildConversationRenderItems,
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
  MAX_COMPOSER_ATTACHMENTS,
} from './helpers';

export type OpenPanelFn = (name: string, params?: OpenPanelOptions) => void;

export type TodeXSession = ReturnType<typeof useTodeXSession>;

export type { CatalogState };
`;
const sessionFooter = `  return {
    hydrated,
    settings,
    setSettings,
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
    timeline,
    mentionHistory,
    experimentalFeatures,
    setExperimentalFeatures,
    selectedRequestId,
    setSelectedRequestId,
    chatDrafts,
    queuedChatDrafts,
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
    pendingRequests,
    selectedRequest,
    activeWorkspace,
    activeConversation,
    connect,
    closeSocket,
    createWorkspace,
    selectWorkspace,
    renameWorkspace,
    forkWorkspace,
    removeWorkspace,
    createConversation,
    selectConversation,
    renameConversation,
    forkConversation,
    removeConversation,
    requestNativeThreadList,
    submitChat,
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
    fetchWorkspaceDirectorySnapshot: (path?: string) => fetchWorkspaceDirectorySnapshot(settings, path),
    openModelPicker,
    applyModelCommand,
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
    seedTerminalState,
    resizeTerminalSession,
    requestTerminalStatus,
    clearTerminalOutput,
    setSkillListVisible,
    toggleSelectedSkill,
    autoConnectEnabled,
    setAutoConnectEnabled,
  };
}
`;

writeFileSync(join(sessionDir, 'useTodeXSession.ts'), `${sessionHeader}${session}\n${sessionFooter}\n`);

// Consistency guard: the generator must never reintroduce the retired legacy
// transport plane or `/v1` endpoints into generated session code.
const banned = /TodeXTransportClient|buildWebSocketUrlWithToken|buildWebSocketUrl\b|transport\.hello|transport\.chunk|transport\.ack|DEFAULT_TRANSPORT_STATUS|TransportStatusSnapshot|\/v1\//;
for (const [name, text] of [['helpers.ts', helpers], ['useTodeXSession.ts', session], ['headers', `${helpersHeader}${sessionHeader}${sessionFooter}`]]) {
  const match = banned.exec(text);
  if (match) {
    throw new Error(`generated ${name} contains retired reference: ${match[0]}`);
  }
}
console.log('extracted helpers and session (v2)');

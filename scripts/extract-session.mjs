import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const appPath = join(root, '../../TodeX_app/App.tsx');
const sessionDir = join(root, '../src/renderer/session');
mkdirSync(sessionDir, { recursive: true });

const source = readFileSync(appPath, 'utf8').split('\n');

function sliceLines(start, end) {
  return source.slice(start - 1, end).join('\n');
}

function exportTopLevel(block) {
  return block
    .replace(/^type /gm, 'export type ')
    .replace(/^const /gm, 'export const ')
    .replace(/^function /gm, 'export function ')
    .replace(/^async function /gm, 'export async function ');
}

let helpers = sliceLines(151, 2378);
helpers = helpers.replace(
  "type ComposerSelection = TextInputSelectionChangeEventData['selection'];",
  'export type ComposerSelection = { start: number; end: number };',
);
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
  eventPayloadData,
  FAST_SERVICE_TIER,
  FALLBACK_CODEX_MODELS,
  mergeWorkspaceRecords,
  normalizeReasoningEffort,
  normalizeThreadId,
  prepareWorkspaceSyncPayload,
} from '@todex/protocol/todex';
import type { TransportCryptoSession } from '@todex/protocol/transportCrypto';
import type { PairingQrChunk } from '@todex/protocol/transportCrypto';
import type { TodeXTransportClient, TransportStatusSnapshot } from '@todex/protocol/transport';
import { sessionIdFromEvent as transportSessionIdFromEvent } from '@todex/protocol/transport';

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

writeFileSync(join(sessionDir, 'helpers.ts'), `${helpersHeader}${helpers}\n`);

let session = sliceLines(2380, 7490);
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
import { V2ApiClient, V2ConversationSocket } from '@todex/protocol/v2';
import {
  ConnectionSettings,
  CodexModelCatalogItem,
  CodexNativeThread,
  LocalAdapterState,
  PendingRequest,
  ServerEvent,
  WorkspaceRecord,
  approvalResponsePayload,
  buildHttpUrl,
  buildWebSocketUrl,
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
  TodeXTransportClient,
  type TransportOutboundMessage,
  type TransportStatusSnapshot,
  cursorFromEvent as transportCursorFromEvent,
  sessionIdFromEvent as transportSessionIdFromEvent,
} from '@todex/protocol/transport';
import { ConnectionError } from '@todex/protocol/connectionError';
import { desktopAlert } from '../lib/desktopAlert';
import { panelFromRoute, type DesktopPanel, type OpenPanelOptions } from '../lib/panels';
import type { CatalogState } from '../screens/CapabilitiesPanel';
import {
  DEFAULT_COMPOSER_SELECTION,
  DEFAULT_TRANSPORT_STATUS,
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
  type TimelineEntry,
  type SlashCommand,
  type MentionSuggestion,
  type WorkspaceMentionHistory,
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
  buildConversationRenderItems,
  classifyChatEvent,
  createDefaultConversation,
  forkConversationRecord,
  parseThreadMetadataArgs,
  nativeThreadPatchFromNotification,
  findMentionTrigger,
  buildMentionSuggestions,
  parseMentionReferences,
  summarizeMentionReferences,
  stringFromUnknown,
  parseWorkspaceDirectorySnapshot,
  permissionPresetForProfile,
  approvalsReviewerValue,
} from './helpers';

export type OpenPanelFn = (name: string, params?: OpenPanelOptions) => void;

export type { CatalogState };

`;

const sessionFooter = `
  return {
    hydrated,
    settings,
    setSettings,
    workspaces,
    conversations,
    activeWorkspaceId,
    activeConversationId,
    connectionState,
    connectionHealth,
    transportStatus,
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
    applyPairingPayload,
    refreshCapabilityCatalog,
    fetchWorkspaceDirectorySnapshot: (path?: string) => fetchWorkspaceDirectorySnapshot(settings, path),
    openModelPicker,
    applyModelCommand,
    handleSlashCommand,
  };
}
`;

writeFileSync(join(sessionDir, 'useTodeXSession.ts'), `${sessionHeader}${session}\n${sessionFooter}\n`);
console.log('extracted helpers and session');

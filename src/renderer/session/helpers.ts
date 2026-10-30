import { normalizeBackendLabelColor, type BackendConnectionProfile } from './backendColors';
import { isLoopbackUrl, normalizeUsageRecords as normalizeSharedUsageRecords } from '@todex/protocol/mobileParity';
import type {
  CodexModelCatalogItem,
  ConnectionSettings,
  LocalAdapterState,
  ServerEvent,
  WorkspaceRecord,
} from '@todex/protocol/todex';
import type { ConversationEvent, ConversationManifest, ConversationSchedule, PermissionMode, ProviderDescriptor, ProviderKind, ProviderModelDescriptor } from '@todex/protocol/v2';
import { isPermissionMode } from './permissions';
import { platform } from '../platform';

export type ResolvedSessionConfig = {
  model?: import('@todex/protocol/v2').ResolvedConfigValue<string>;
  reasoningEffort?: import('@todex/protocol/v2').ResolvedConfigValue<string | null>;
  approvalPolicy?: import('@todex/protocol/v2').ResolvedConfigValue<string>;
  sandboxMode?: import('@todex/protocol/v2').ResolvedConfigValue<string>;
};

export function buildConversationControlMessage(
  conversationId: string,
  action: import('@todex/protocol/v2').ConversationControlAction,
  payload: Record<string, unknown> = {},
): { id: string; type: string; payload: Record<string, unknown> } {
  return {
    id: createRequestId(`conversation-${action}`),
    type: action === 'cancel' ? 'conversation.cancel' : `conversation.${action}`,
    payload: { conversationId, ...payload },
  };
}

/** `conversation.cancel` for the turn the client saw running. Naming the turn
 * keeps a late click from stopping a newer turn the user has not seen; the
 * backend then answers `{ cancelled: false, activeTurnId }` instead. */
export function buildConversationCancelMessage(conversationId: string, turnId: string | undefined) {
  return buildConversationControlMessage(conversationId, 'cancel', turnId ? { turnId } : {});
}

/** True when the backend skipped a cancel because the named turn was no longer
 * running (`{ cancelled: false }`). That is a no-op, not an error. Results
 * without the field come from cancels sent without a turn id. */
export function isStaleCancelResult(result: Record<string, unknown>): boolean {
  return result.cancelled === false;
}
import { parseConversationSchedule, providerDisplayName } from '@todex/protocol/v2';
import { ConnectionError, ConnectionErrorType, type ConnectionFailureCode } from '@todex/protocol/connectionError';
import { matchesMessage, t, type MessageKey } from '../i18n';

// Sentinel produced while an assistant reply is streaming. The shared
// protocol lib merges against this exact zh literal, so it stays untranslated;
// the UI maps it to t('chat.replying') at render time.
export const STREAMING_REPLY_PLACEHOLDER = '正在回复...';
import {
  createRequestId,
  eventPayloadData,
  DEFAULT_REASONING_EFFORT_OPTIONS,
  FAST_SERVICE_TIER,
  FALLBACK_CODEX_MODELS,
  normalizeReasoningEffort,
  normalizeServerUrl,
  normalizeThreadId,
  prepareWorkspaceSyncPayload,
} from '@todex/protocol/todex';
import { deviceIdentityFromSecret, type DeviceIdentity } from '@todex/protocol/deviceAuth';
import {
  BackendUpgradeRequiredError,
  EncryptionRequiredError,
  InvalidPinnedKeyError,
  TransportPolicyError,
  TransportRepairRequiredError,
  cachedSecureTransport,
  toFetchResponse,
  type SecureRequest,
  type SecureSocket,
  type SecureTransport,
} from '@todex/protocol/secureTransport';
import { TransportCryptoError, TransportPayloadTooLargeError } from '@todex/protocol/secureChannel';
import { SocketVerificationError } from '@todex/protocol/socketVerification';
import { V2ApiClient, type V2ApiOptions } from '@todex/protocol/v2';
import { parseBackendDeployment, parsePathMappings, type BackendDeployment, type PathMapping } from '@todex/protocol/pathMapping';
import {
  cursorFromEvent as transportCursorFromEvent,
  sessionIdFromEvent as transportSessionIdFromEvent,
} from '@todex/protocol/transport';
import {
  buildConversationRenderItems as sharedBuildConversationRenderItems,
  executionGroupId as sharedExecutionGroupId,
  isCollapsibleProgressEntry as sharedIsCollapsibleProgressEntry,
  isStepProgressEntry as sharedIsStepProgressEntry,
  isThinkingProgressEntry as sharedIsThinkingProgressEntry,
  shouldAppendV2ConversationEvent as sharedShouldAppendV2ConversationEvent,
  type ConversationBlockCategory,
  type ConversationBlockPhase,
  type ProviderNotice,
  type ProviderTurnTrigger,
} from '@todex/protocol/mobileParity';

export type ServerVersion = {
  name: string;
  version: string;
  data_dir: string;
  workspace_root: string;
  /** Parent of the None workspace's per-conversation folders; empty on
   * backends that predate it. */
  scratch_workspace_root: string;
  /** `1` when the backend serves end-to-end encrypted history. */
  historyEncryption?: number;
  /** Where private conversations' temp folders live: `memory` (tmpfs) or
   * `disk` (no RAM-backed folder; files are deleted with the conversation).
   * Missing on backends without private conversations. */
  privateConversationStorage?: 'memory' | 'disk';
  /** `1` when terminal output carries `seq` and `terminal.attach` exists. */
  terminalReplay?: number;
  /** `1` when an attach that cannot continue sends a screen snapshot. */
  terminalSnapshot?: number;
  /** Where the backend runs; `host` on backends that predate it. */
  deployment: BackendDeployment;
  /** Host ↔ backend folder pairs; empty when the backend publishes none. */
  pathMappings: PathMapping[];
};

/** `/v2/version`'s JSON with the container fields normalized (older
 * backends omit them: a host backend without mappings). */
export function normalizeServerVersion(json: Record<string, unknown>): ServerVersion {
  return {
    ...(json as Omit<ServerVersion, 'deployment' | 'pathMappings'>),
    deployment: parseBackendDeployment(json.deployment),
    pathMappings: parsePathMappings(json.pathMappings),
  };
}

/** A failed workspace directory request, keeping the backend's error code. */
export class WorkspaceDirectoryError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'WorkspaceDirectoryError';
    this.code = code;
  }
}

/** Whether a workspace path failure on this backend means the folder is not
 * mounted into its container: outside the workspace roots, or missing there
 * (an unmounted host folder usually does not exist in the container). */
export function isUnmountedPathError(deployment: BackendDeployment | undefined, error: unknown): boolean {
  return deployment === 'container'
    && error instanceof WorkspaceDirectoryError
    && (error.code === 'WORKSPACE_PATH_OUTSIDE_ROOT' || error.code === 'WORKSPACE_PATH_NOT_FOUND');
}

/** `todexc mount add <path>`. Paths with anything but plain characters
 * (spaces, Windows backslashes) are single-quoted, which POSIX shells and
 * PowerShell both read literally. */
export function containerMountCommand(path: string): string {
  const quoted = /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
  return `todexc mount add ${quoted}`;
}

// Dev builds report "DEV0.0.0" (backend and clients) or a bare "0.0.0"; warning
// on those would fire on every development connection.
export function isDevVersion(version: string | null | undefined): boolean {
  const normalized = (version ?? '').trim().toLowerCase();
  return normalized === '' || /^(?:dev[-.]?)?0\.0\.0$/.test(normalized);
}

export function isVersionMismatch(appVersion: string, backendVersion: string | null | undefined): boolean {
  if (isDevVersion(appVersion) || isDevVersion(backendVersion)) return false;
  const normalize = (value: string) => value.trim().replace(/^v/i, '');
  return normalize(appVersion) !== normalize(backendVersion ?? '');
}

export type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
  kind: 'directory';
};

export type WorkspaceDirectorySnapshot = {
  root: string;
  roots: string[];
  current: string;
  parent: string | null;
  entries: WorkspaceDirectoryEntry[];
};

export type ConversationRecord = {
  id: string;
  workspaceId: string;
  /** Folder the backend created for a conversation in the None workspace
   * (manifest `scratchWorkspace`); it replaces the workspace path. */
  workspacePath?: string;
  backendConnectionId?: string | null;
  title: string;
  preview?: string;
  nativeStatus?: string;
  archived?: boolean;
  /** Stored before history became end-to-end encrypted: read-only (the
   * backend rejects writes with HISTORY_READ_ONLY). */
  legacyPlaintext?: boolean;
  /** History of the removed local Codex path (no agent, no backend journal):
   * kept to read, archive and delete; it can no longer send. */
  legacyCodex?: boolean;
  /** Scheduled conversation (manifest `schedule`): the backend holds what is
   * sent to it until `at`. */
  schedule?: ConversationSchedule;
  /** Private conversation (manifest `ephemeral`): it lives only in its
   * daemon's memory, so this client never persists anything of it. */
  ephemeral?: boolean;
  sessionId: string;
  threadId: string;
  localAdapterState?: LocalAdapterState;
  mode?: 'plan' | 'implement';
  permissionMode?: PermissionMode;
  goalStatus?: string;
  goalObjective?: string;
  provider?: ProviderKind | string;
  providerProfile?: string;
  model?: string;
  reasoningEffort?: string | null;
  v2ConversationId?: string;
  /** Child conversation an agent started through Agent Calling (manifest
   * `parentConversationId`): the parent's backend id. Children are left out
   * of the backend's conversation list and of the sidebar; a child record
   * exists only once opened from the parent's Agent calls tab, and lives as
   * long as its parent is listed. */
  parentConversationId?: string;
  lastSequence?: number;
  lastCompletedAt?: number;
  /** Last time the conversation was visible in a focused window. */
  lastReadAt?: number;
  /** User-picked tag color (hex); persists independently of read state. */
  labelColor?: string;
  createdAt: number;
  updatedAt: number;
};

export type ProviderModelPreference = {
  lastModel?: string;
  reasoningByModel: Record<string, string>;
  lastPermissionMode?: PermissionMode;
  lastWorkMode?: 'plan' | 'implement';
};

export type ProviderModelPreferences = Record<string, ProviderModelPreference>;

export function providerModelPreferenceKey(backendConnectionId: string | null | undefined, provider: string): string {
  return `${backendConnectionId?.trim() || 'default-backend'}::${provider.trim()}`;
}

export function normalizeProviderModelPreferences(value: unknown): ProviderModelPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    const reasoning = record.reasoningByModel;
    const reasoningByModel = reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning)
      ? Object.fromEntries(Object.entries(reasoning).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()),
      ))
      : {};
    const lastModel = typeof record.lastModel === 'string' && record.lastModel.trim() ? record.lastModel.trim() : undefined;
    const lastPermissionMode = isPermissionMode(record.lastPermissionMode) ? record.lastPermissionMode : undefined;
    const lastWorkMode = record.lastWorkMode === 'plan' || record.lastWorkMode === 'implement'
      ? record.lastWorkMode
      : undefined;
    return [[key, {
      ...(lastModel ? { lastModel } : {}),
      reasoningByModel,
      ...(lastPermissionMode ? { lastPermissionMode } : {}),
      ...(lastWorkMode ? { lastWorkMode } : {}),
    }]];
  }));
}

export function resolveProviderModel(
  models: ProviderModelDescriptor[],
  requestedModel?: string | null,
  preferredModel?: string | null,
): ProviderModelDescriptor | null {
  return models.find((item) => item.id === requestedModel)
    ?? models.find((item) => item.id === preferredModel)
    ?? models.find((item) => item.isDefault)
    ?? models[0]
    ?? null;
}

export function resolveProviderReasoningEffort(
  model: ProviderModelDescriptor | null,
  candidates: Array<string | null | undefined>,
): string | null {
  if (!model || model.supportedReasoningEfforts.length === 0) return null;
  return candidates.find((candidate): candidate is string => (
    typeof candidate === 'string' && model.supportedReasoningEfforts.includes(candidate)
  )) ?? (model.supportedReasoningEfforts.includes('medium') ? 'medium' : model.supportedReasoningEfforts[0] ?? null);
}


export type ExperimentalFeatureId =
  | 'gitDiffViewer'
  | 'verboseRuntimeEvents'
  | 'composerFileMentions';

export type ExperimentalFeatureSettings = Record<ExperimentalFeatureId, boolean>;

export type ExperimentalFeatureDefinition = {
  id: ExperimentalFeatureId;
  title: string;
  description: string;
  scope: string;
};

export type GitDiffState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  diff: string;
  /** Commit the diff is against (the upstream merge-base, else HEAD). */
  sha: string;
  error: string;
  updatedAt: number;
  /** What `sha` is: the upstream merge-base, HEAD, or the empty tree. */
  baseRef?: 'upstream' | 'head' | 'empty';
  /** The backend cut the diff at its size limit. */
  truncated?: boolean;
};






export type TerminalLifecycleState = 'idle' | 'starting' | 'running' | 'stopping' | 'exited' | 'error';

/** What a terminal runs: a local shell in a conversation's workspace, or
 * `ssh -tt <host>` on the backend machine (`terminal.start` with `ssh`). */
export type TerminalTarget =
  | { kind: 'workspace'; workspace: WorkspaceRecord; conversation: ConversationRecord }
  /** SSH terminals run `ssh -tt <host>` on the backend picked in the SSH view. */
  | { kind: 'ssh'; host: string; backendConnectionId: string };

export type TerminalClientState = {
  terminalId: string;
  /** Set for SSH terminals; `workspaceId`/`conversationId`/`cwd` are empty then. */
  ssh?: { host: string };
  /** Backend profile running the terminal. */
  backendConnectionId?: string;
  workspaceId: string;
  conversationId: string;
  tenantId: string;
  cwd: string;
  shell: string;
  rows: number;
  cols: number;
  status: TerminalLifecycleState;
  error: string;
  /** Set when the exit was requested (terminal.stop from any client or an
   * observed terminal.stopping); suppresses the auto-restart, matching the
   * mobile client's `state == .stopping` check. Cleared on terminal.started. */
  stopRequested?: boolean;
  pid?: number | null;
  exitCode?: number | null;
  /** When an SSH terminal was started with a saved password; an early ssh
   * failure then retries without it so the user can sign in at the prompt. */
  sshPasswordAt?: number;
  updatedAt: number;
};

export type TerminalStartOptions = {
  cwd: string;
  shell: string;
  rows: number;
  cols: number;
  terminalId?: string;
  preserveOutput?: boolean;
  /** SSH only: skip the saved password and let ssh prompt in the terminal. */
  interactive?: boolean;
};


export type ComposerSelection = { start: number; end: number };

export const DEFAULT_COMPOSER_SELECTION: ComposerSelection = { start: 0, end: 0 };

export type ComposerAttachmentDraft = {
  id: string;
  /** `text` is a pasted-text capsule: its `textContent` goes back into the
   * message where the capsule sits. */
  kind: 'image' | 'file' | 'reference' | 'text';
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  dataUrl: string;
  textContent?: string;
  source: 'clipboard' | 'library' | 'file' | 'preview' | 'message';
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  messageId?: string;
  /** Where `PUT /v2/uploads` stored the file on the backend's machine; the
   * prompt names this path instead of carrying the content. */
  uploadedPath?: string;
  /** Set while the upload runs and after it failed; absent once uploaded
   * (or for attachments that never upload). */
  uploadState?: 'uploading' | 'failed';
  uploadError?: string;
};

/** A message headed for the backend follow-up queue (`conversation.queue.add`).
 * The id is the queue item id and the prompt's clientRequestId. */
export type QueuedChatSubmission = {
  id: string;
  text: string;
  attachments: ComposerAttachmentDraft[];
  skills: SelectedSkillAttachment[];
};





export type PendingJsonSave = {
  timeoutId: ReturnType<typeof setTimeout>;
  value: unknown;
};

/** One opened (plaintext) JSON message from the secure socket. */
export type PendingSocketFrame = {
  data: string;
  /** Backend profile whose socket delivered the frame. */
  backendId: string;
  generation: number;
};

export type ConversationContext = {
  workspace: WorkspaceRecord;
  conversation: ConversationRecord;
};







export type SelectedSkillAttachment = {
  name: string;
  path: string;
  displayName: string;
  resourceId?: string;
  provider?: ProviderKind | string;
};


export type TimelineTarget = {
  workspaceId: string;
  conversationId: string;
};

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';


export type ConnectionHealth = {
  status: 'unknown' | 'checking' | 'online' | 'offline';
  latencyMs: number | null;
  lastCheckedAt: number | null;
  error: string;
  code?: ConnectionFailureCode | '';
};

export const CONNECTION_HEALTH_INTERVAL_MS = 5000;
export const CONNECTION_HEALTH_TIMEOUT_MS = 3500;
export const SOCKET_WATCHDOG_INTERVAL_MS = 15_000;
export const SOCKET_LIVENESS_TIMEOUT_MS = 15_000;
export const SOCKET_LIVENESS_MAX_FAILURES = 3;
/** How long a new encrypted socket may take to answer its verification ping. */
export const SOCKET_VERIFICATION_TIMEOUT_MS = 10_000;
/** A starting backend accepts connections but answers nothing until its
 * state (conversation recovery included) is loaded. The connect's first
 * request, the transport-policy read, waits this long for it. */
export const BACKEND_READY_TIMEOUT_MS = 120_000;
/** Shorter waits are not worth announcing. */
export const BACKEND_READY_NOTICE_DELAY_MS = 1500;

/** requestAnimationFrame stops firing while the window is hidden or occluded,
 * which freezes protocol frame processing even though the socket stays alive.
 * MessageChannel tasks are not throttled in background pages and still yield
 * to the event loop between batches. */
const messageTaskChannel = new MessageChannel();
const messageTaskQueue = new Map<number, () => void>();
let nextMessageTaskId = 0;
messageTaskChannel.port1.onmessage = () => {
  const first = messageTaskQueue.keys().next();
  if (first.done) return;
  const id = first.value;
  const run = messageTaskQueue.get(id);
  messageTaskQueue.delete(id);
  if (!run) return;
  try {
    run();
  } catch (error) {
    // Surface asynchronously so one failing task cannot wedge the queue.
    setTimeout(() => { throw error; });
  }
};

export function scheduleMessageTask(run: () => void): number {
  const id = ++nextMessageTaskId;
  messageTaskQueue.set(id, run);
  messageTaskChannel.port2.postMessage(null);
  return id;
}

export function cancelMessageTask(id: number): void {
  messageTaskQueue.delete(id);
}
export const MAX_COMPOSER_ATTACHMENTS = 8;
export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_ATTACHMENT_BYTES = 512 * 1024;



const CONNECTION_FAILURE_LABELS: Record<ConnectionFailureCode, MessageKey> = {
  backend_unreachable: 'conn.failure.backend_unreachable',
  invalid_server_url: 'conn.failure.invalid_server_url',
  authentication_failed: 'conn.failure.authentication_failed',
  protocol_mismatch: 'conn.failure.protocol_mismatch',
  websocket_failed: 'conn.failure.websocket_failed',
  provider_unavailable: 'conn.failure.provider_unavailable',
  encryption_required: 'conn.failure.encryption_required',
  request_failed: 'conn.failure.request_failed',
};

/** Text for a ConnectionError: an authentication failure gets the localized
 * pairing message (the protocol's own text is a locale-neutral fallback);
 * everything else, including a 403 permission refusal, keeps the backend's
 * message. */
export function connectionErrorText(error: ConnectionError): string {
  return error.code === 'authentication_failed' ? t('conn.failure.authentication_failed') : error.userMessage;
}

/** Short, localized label for a connection failure code; empty when unknown. */
export function connectionFailureLabel(code?: ConnectionFailureCode | ''): string {
  return code && Object.prototype.hasOwnProperty.call(CONNECTION_FAILURE_LABELS, code) ? t(CONNECTION_FAILURE_LABELS[code]) : '';
}

export function isConversationHighlighted(conversation: ConversationRecord, _activeConversationId: string, activeTurns: Record<string, string>): boolean {
  return Boolean(activeTurns[conversation.id]);
}

export type ConversationStatus = {
  kind: 'working' | 'issue' | 'unread';
  color: string;
  border: string;
  label: string;
};

export function getConversationStatus(
  session: { activeConversationId: string; turnIds: Record<string, string> },
  conversation: ConversationRecord,
  latestEntry?: TimelineEntry,
  latestIncomingAt?: number,
): ConversationStatus | null {
  if (isConversationHighlighted(conversation, session.activeConversationId, session.turnIds)) {
    return { kind: 'working', color: 'bg-chart-7', border: 'border-chart-7', label: t('sidebar.statusWorking') };
  }
  // The dot is an attention marker: it clears once the conversation has been
  // seen (lastReadAt), regardless of which state produced it.
  const lastReadAt = conversation.lastReadAt ?? 0;
  const latestEntryUnread = Boolean(latestEntry && latestEntry.at > lastReadAt);
  if (
    (latestEntry?.marker === 'error' && latestEntryUnread) ||
    (/error|failed|异常|失败/i.test(conversation.nativeStatus || '') && conversation.updatedAt > lastReadAt) ||
    (/error|failed|异常|失败/i.test(latestEntry?.title || '') && latestEntryUnread)
  ) {
    return { kind: 'issue', color: 'bg-chart-8', border: 'border-chart-8', label: t('sidebar.statusIssue') };
  }
  const incomingAt = latestIncomingAt ?? (latestEntry?.kind === 'incoming' ? latestEntry.at : 0);
  if (incomingAt > lastReadAt) {
    return { kind: 'unread', color: 'bg-accent-500', border: 'border-accent-500', label: t('sidebar.statusUnread') };
  }
  return null;
}


/** Built-in "None" workspace. Each of its conversations works in a folder the
 * backend creates under `scratch_workspace_root`; the record's own path is
 * that root (used for discovery before the first message). It is never
 * synced to the backend workspace list and cannot be edited or removed. */
export const NONE_WORKSPACE_ID = 'workspace-none';

export function isNoneWorkspaceId(workspaceId: string | null | undefined): boolean {
  return workspaceId === NONE_WORKSPACE_ID;
}

/** The sidebar lists None once per backend; each row's id names its backend. */
export function noneWorkspaceRowId(backendId: string): string {
  return `${NONE_WORKSPACE_ID}@${backendId}`;
}

/** Backend of a per-backend None row id, or null for any other id. */
export function noneWorkspaceRowBackendId(rowId: string): string | null {
  return rowId.startsWith(`${NONE_WORKSPACE_ID}@`) ? rowId.slice(NONE_WORKSPACE_ID.length + 1) : null;
}

export function createNoneWorkspace(
  settings: Pick<ConnectionSettings, 'tenantId' | 'defaultModel' | 'approvalPolicy' | 'sandboxMode'>,
): WorkspaceRecord {
  return {
    id: NONE_WORKSPACE_ID,
    name: t('sidebar.noWorkspace'),
    path: '',
    backendConnectionId: null,
    sessionId: createSessionId('none'),
    tenantId: settings.tenantId,
    threadId: '',
    model: settings.defaultModel,
    reasoningEffort: null,
    approvalPolicy: settings.approvalPolicy,
    approvalsReviewer: null,
    sandboxMode: settings.sandboxMode,
    serviceTier: null,
    permissionProfile: null,
    personality: null,
    localAdapterState: 'idle',
    createdAt: 0,
    updatedAt: 0,
  };
}

/** `workspaces` with exactly one None record, kept last so the default
 * selection stays on a real workspace. Its name follows the current locale. */
export function withNoneWorkspace(workspaces: WorkspaceRecord[], fallback: () => WorkspaceRecord): WorkspaceRecord[] {
  const none = workspaces.find((workspace) => isNoneWorkspaceId(workspace.id));
  const rest = workspaces.filter((workspace) => !isNoneWorkspaceId(workspace.id));
  return [...rest, none ? { ...none, name: t('sidebar.noWorkspace'), backendConnectionId: null, pathMissing: undefined } : fallback()];
}

/** The workspace a conversation actually runs in: a None conversation that
 * already has its backend folder uses that folder as the path. */
export function workspaceForConversation(workspace: WorkspaceRecord, conversation: ConversationRecord | null | undefined): WorkspaceRecord {
  return isNoneWorkspaceId(workspace.id) && conversation?.workspacePath
    ? { ...workspace, path: conversation.workspacePath }
    : workspace;
}

/** Like workspaceForConversation, but a None conversation without its folder
 * yet has no files of its own: undefined instead of the scratch root. */
export function filesWorkspaceForConversation(
  workspace: WorkspaceRecord | undefined,
  conversation: ConversationRecord | null | undefined,
): WorkspaceRecord | undefined {
  if (!workspace) return undefined;
  if (isNoneWorkspaceId(workspace.id) && !conversation?.workspacePath) return undefined;
  return workspaceForConversation(workspace, conversation);
}






export function attachmentId(): string {
  return createRequestId('att');
}

export function formatResetInstant(until: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(until));
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) {
    return 'unknown';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}


export type WorkspaceLinkTarget =
  | { kind: 'browser-url'; url: string }
  | { kind: 'browser-file'; filePath: string }
  | { kind: 'file'; filePath: string }
  | null;

function normalizeWorkspacePath(path: string): string {
  const prefix = path.startsWith('/') ? '/' : '';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return `${prefix}${normalized.join('/')}` || prefix || '.';
}

export function workspaceLinkTarget(href: string | undefined, workspacePath: string | undefined): WorkspaceLinkTarget {
  if (!href?.trim() || !workspacePath) return null;
  const raw = href.trim();
  try {
    const parsed = new URL(raw);
    // Only loopback pages load in the Workbench browser tab; other http(s)
    // links (and every link where the host has no browser tab) open outside.
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && platform.preview && isLoopbackUrl(parsed)) {
      return { kind: 'browser-url', url: parsed.toString() };
    }
    return null;
  } catch {
    // Relative and absolute workspace paths are handled below.
  }
  const pathPart = raw.split(/[?#]/, 1)[0];
  if (!pathPart) return null;
  let decodedPath = pathPart;
  try {
    decodedPath = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  const root = normalizeWorkspacePath(workspacePath).replace(/\/$/, '');
  const candidate = normalizeWorkspacePath(decodedPath.startsWith('/') ? decodedPath : `${root}/${decodedPath}`);
  if (candidate !== root && !candidate.startsWith(`${root}/`)) return null;
  const extension = candidate.split('/').pop()?.split('.').pop()?.toLowerCase() || '';
  if (extension === 'html' || extension === 'htm' || extension === 'xhtml' || extension === 'svg') {
    return { kind: 'browser-file', filePath: candidate };
  }
  return { kind: 'file', filePath: candidate };
}

export function inferMimeType(name: string, fallback = 'application/octet-stream'): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'txt':
      return 'text/plain';
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'csv':
      return 'text/csv';
    case 'pdf':
      return 'application/pdf';
    default:
      return fallback;
  }
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}






export function attachmentPrompt(attachments: ComposerAttachmentDraft[]): string {
  if (attachments.length === 0) {
    return '';
  }
  const imageCount = attachments.filter((item) => item.kind === 'image').length;
  const referenceCount = attachments.filter((item) => item.kind === 'reference').length;
  const fileCount = attachments.length - imageCount - referenceCount;
  if (imageCount === 0 && fileCount === 0) {
    return referenceCount === 1 ? t('session.viewReferenceSingle') : t('session.viewReferences', { count: referenceCount });
  }
  if (imageCount > 0 && fileCount > 0) {
    return t('session.viewAttachments', { count: attachments.length });
  }
  if (imageCount > 0) {
    return imageCount === 1 ? t('session.viewImage') : t('session.viewImages', { count: imageCount });
  }
  return fileCount === 1 ? t('session.viewFile') : t('session.viewFiles', { count: fileCount });
}

export function attachmentTextBlock(attachment: ComposerAttachmentDraft): string {
  if (attachment.kind === 'reference') {
    const lines = attachment.lineStart
      ? `:${attachment.lineStart}${attachment.lineEnd && attachment.lineEnd !== attachment.lineStart ? `-${attachment.lineEnd}` : ''}`
      : '';
    const location = attachment.path ? `${attachment.path}${lines}` : attachment.name;
    const parts = [`[引用: ${location}]`];
    if (attachment.textContent) parts.push(`Content:\n${attachment.textContent}`);
    return parts.join('\n');
  }
  const header = [
    `[附件: ${attachment.name}]`,
    `MIME: ${attachment.mimeType}`,
    `Size: ${formatBytes(attachment.sizeBytes)}`,
  ].join('\n');
  if (attachment.textContent) {
    return `${header}\nContent:\n${attachment.textContent}`;
  }
  return `${header}\nData URL:\n${attachment.dataUrl}`;
}


/**
 * Inline composer capsules. Every attachment that the user picked or quoted
 * lives in the draft as one of these tokens, which the editor renders as an
 * atomic pill and the payload builder resolves back to the attachment.
 */
export const COMPOSER_TOKEN_SOURCE = '\\[(引用|文件|文本|图片):([^\\]\n]+)\\]';

const TOKEN_LABEL_BY_KIND: Record<ComposerAttachmentDraft['kind'], string> = {
  reference: '引用',
  file: '文件',
  text: '文本',
  image: '图片',
};

const TOKEN_KIND_BY_LABEL: Record<string, ComposerAttachmentDraft['kind']> = {
  引用: 'reference',
  文件: 'file',
  文本: 'text',
  图片: 'image',
};

export function composerTokenPattern(flags = 'g'): RegExp {
  return new RegExp(COMPOSER_TOKEN_SOURCE, flags);
}

export function composerTokenKindFromLabel(label: string): ComposerAttachmentDraft['kind'] | undefined {
  return TOKEN_KIND_BY_LABEL[label];
}

/** A `]` or newline inside a name would terminate the token early. */
export function tokenSafeName(name: string): string {
  return name.replace(/[\][\r\n]/g, '');
}

export function composerToken(kind: ComposerAttachmentDraft['kind'], name: string): string {
  return `[${TOKEN_LABEL_BY_KIND[kind]}:${tokenSafeName(name)}]`;
}

export function attachmentToken(attachment: Pick<ComposerAttachmentDraft, 'kind' | 'name'>): string {
  return composerToken(attachment.kind, attachment.name);
}

export function referenceToken(name: string): string {
  return composerToken('reference', name);
}

export type ComposerTokenRef = {
  kind: ComposerAttachmentDraft['kind'];
  name: string;
  token: string;
  start: number;
};

export function composerTokensInText(text: string): ComposerTokenRef[] {
  const refs: ComposerTokenRef[] = [];
  for (const match of text.matchAll(composerTokenPattern())) {
    const kind = TOKEN_KIND_BY_LABEL[match[1]];
    if (!kind) continue;
    refs.push({ kind, name: match[2], token: match[0], start: match.index });
  }
  return refs;
}

/** Names used by any capsule token in the draft, regardless of kind. */
export function composerTokenNamesInText(text: string): string[] {
  return composerTokensInText(text).map((item) => item.name);
}

/** Short excerpt preview used as the capsule label (first line, ≤ max chars). */
export function referencePreview(excerpt: string | undefined, max = 10): string {
  if (!excerpt) return '';
  const line = excerpt.split('\n').find((part) => part.trim())?.replace(/\s+/g, ' ').trim() ?? '';
  const chars = [...line];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : line;
}

export function referenceNamesInText(text: string): string[] {
  return composerTokensInText(text).filter((item) => item.kind === 'reference').map((item) => item.name);
}

/** Keep every capsule name distinct so its token maps to exactly one attachment. */
export function uniqueAttachmentName(
  base: string,
  attachments: readonly ComposerAttachmentDraft[],
  draftText: string,
): string {
  const taken = new Set([
    ...attachments.map((item) => item.name),
    ...composerTokenNamesInText(draftText),
  ]);
  let name = base;
  let index = 2;
  while (taken.has(name)) {
    name = `${base} ${index}`;
    index += 1;
  }
  return name;
}

export function uniqueReferenceName(
  base: string,
  attachments: readonly ComposerAttachmentDraft[],
  draftText: string,
): string {
  return uniqueAttachmentName(base, attachments, draftText);
}

/** Puts each pasted-text capsule's text back where its token sits, so the
 * agent (and the sent message) reads it as part of the message. Returns the
 * remaining attachments. */
export function expandTextCapsules(
  text: string,
  attachments: readonly ComposerAttachmentDraft[],
): { text: string; attachments: ComposerAttachmentDraft[] } {
  const capsules = new Map(attachments
    .filter((item) => item.kind === 'text')
    .map((item) => [attachmentToken(item), item.textContent ?? ''] as const));
  if (!capsules.size) return { text, attachments: [...attachments] };
  const expanded = text.replace(composerTokenPattern(), (token) => capsules.get(token) ?? token);
  return { text: expanded, attachments: attachments.filter((item) => item.kind !== 'text') };
}

/** Attachments only count while their capsule token still lives in the draft text. */
export function liveComposerAttachments(
  text: string,
  attachments: readonly ComposerAttachmentDraft[],
): ComposerAttachmentDraft[] {
  const live = new Set(composerTokensInText(text).map((item) => item.token));
  return attachments.filter((item) => live.has(attachmentToken(item)));
}

export function attachmentSummary(attachments: ComposerAttachmentDraft[]): string {
  return attachments
    .map((item) => `${item.kind === 'image' ? t('session.kindImage') : item.kind === 'reference' ? t('session.kindReference') : t('session.kindFile')} ${item.name} (${formatBytes(item.sizeBytes)})`)
    .join('\n');
}

export function selectedSkillSummary(skills: SelectedSkillAttachment[]): string {
  return skills.map((item) => `${item.displayName || item.name} (${item.name})`).join('\n');
}



export function extractProtocolError(eventType: string, data: Record<string, unknown>): string {
  const rawError = data.error;
  if (typeof rawError === 'string' && rawError) {
    return rawError;
  }

  if (rawError && typeof rawError === 'object') {
    const errorData = rawError as Record<string, unknown>;
    const nestedMessage = errorData.message ?? errorData.error_message ?? errorData.reason;
    if (typeof nestedMessage === 'string' && nestedMessage) {
      return nestedMessage;
    }

    const nestedCode = errorData.code ?? errorData.error_code;
    if (typeof nestedCode === 'string' && nestedCode) {
      return nestedCode;
    }
  }

  const message = data.errorMessage ?? data.error_message ?? data.message;
  const code = data.errorCode ?? data.error_code ?? data.code;

  if (typeof message === 'string' && message) {
    return typeof code === 'string' && code ? `${code}: ${message}` : message;
  }

  if (typeof code === 'string' && code) {
    return code;
  }

  if (/error|failed/i.test(eventType)) {
    return eventType;
  }

  return '';
}

export type TimelineEntry = {
  sentAttachments?: import('./sentAttachments').SentAttachment[];
  id: string;
  kind: 'incoming' | 'outgoing' | 'system';
  title: string;
  subtitle: string;
  raw: string;
  at: number;
  /** Sequence of the newest journal event merged into this row. */
  sequence?: number;
  /** Sequence of the event that created this row; with `sequence` it bounds
   * the journal range a folded row was built from. */
  firstSequence?: number;
  /** Time of the event that created this row (`at` is the newest one). */
  firstAt?: number;
  workspaceId?: string;
  conversationId?: string;
  requestId?: string;
  marker?: string;
  category?: ConversationBlockCategory;
  phase?: ConversationBlockPhase;
  turnId?: string;
  blockId?: string;
  contentIndex?: number;
  /** Placeholder for a `detail=summary` replay event: content loads on expand. */
  detailStub?: boolean;
  /** Encrypted history this device holds no key for (one notice per turn). */
  detailLocked?: boolean;
  /** Opens a turn the provider started on its own; `subtitle` holds its
   * summary, if any. */
  providerTrigger?: ProviderTurnTrigger;
  /** A provider notice (e.g. auto mode unavailable); `subtitle` holds the
   * provider's reason, if any. */
  providerNotice?: ProviderNotice;
  /** Permission notices: `settings` when a Claude Code settings layer turned
   * the requested mode off (absent from older backends). */
  providerNoticeCause?: 'settings' | 'unavailable';
  /** The settings layer behind the notice (`metadata.settingsSource`). */
  providerNoticeSettingsSource?: string;
};

export function workspaceDisplayName(workspace: Pick<WorkspaceRecord, 'name' | 'path'>): string {
  const name = workspace.name.trim();
  if (name && !/[\\/]/.test(name)) {
    return name;
  }
  const normalizedPath = workspace.path.replace(/[\\/]+$/, '');
  return normalizedPath.split(/[\\/]/).pop() || name || workspace.path;
}

// Default conversation titles are produced localized; match them across all
// locales so records created under another language still read as generic.
export function isDefaultConversationTitle(title: string): boolean {
  return matchesMessage('chat.newConversation', title) || matchesMessage('chat.defaultConversation', title);
}

/** The oldest non-empty prompt sent in a conversation (title fallback). */
export function firstPromptText(timeline: readonly TimelineEntry[], conversationId: string): string {
  let firstPrompt: TimelineEntry | undefined;
  for (const entry of timeline) {
    if (entry.conversationId !== conversationId || entry.kind !== 'outgoing' || (firstPrompt && entry.at >= firstPrompt.at)) continue;
    if (entry.subtitle.trim()) firstPrompt = entry;
  }
  return firstPrompt?.subtitle ?? '';
}

/** `firstPrompt`: the conversation's rows, or its first prompt already taken
 * from them (`firstPromptText`). */
export function conversationDisplayTitle(
  conversation: Pick<ConversationRecord, 'id' | 'title' | 'preview' | 'provider'>,
  firstPrompt: readonly TimelineEntry[] | string,
): string {
  const title = conversation.title.trim();
  const genericTitles = new Set([
    '',
    'codex',
    'codex cli',
    'pi',
    'claude',
    'claude code',
    'devin',
    'opencode',
    'antigravity',
    'omp',
    'oh-my-pi',
    'deepseek harness',
    conversation.provider ? providerDisplayName(conversation.provider).toLowerCase() : '',
  ]);
  if (!genericTitles.has(title.toLowerCase()) && !isDefaultConversationTitle(title)) {
    return title;
  }

  const summarize = (value: string) => {
    const compact = value.replace(/\s+/g, ' ').trim();
    return compact.length > 32 ? `${compact.slice(0, 32)}…` : compact;
  };
  const preview = summarize(conversation.preview || '');
  if (preview && preview !== '暂无预览' && preview !== '还没有消息') {
    return preview;
  }
  const prompt = typeof firstPrompt === 'string' ? firstPrompt : firstPromptText(firstPrompt, conversation.id);
  return summarize(prompt) || title || t('chat.untitledConversation');
}

export type ConversationContextUsage = {
  usedTokens: number;
  contextWindow?: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  model?: string;
  updatedAt: number;
};

export type UsageRecord = import('@todex/protocol/mobileParity').UsageRecord;

export function normalizeUsageRecords(value: unknown): UsageRecord[] {
  return normalizeSharedUsageRecords(value, { limit: MAX_USAGE_RECORDS });
}

export type ConversationRenderItem =
  | { type: 'entry'; entry: TimelineEntry }
  | { type: 'executionGroup'; id: string; entries: TimelineEntry[] };

export type SlashCommand = {
  command: string;
  title: string;
  description: string;
  category: SlashCommandCategory;
};

export type SlashCommandCategory = 'core' | 'thread' | 'context' | 'runtime' | 'settings' | 'debug';

export type WorkspaceEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
};

export type MentionTrigger = {
  start: number;
  end: number;
  query: string;
};

export type PermissionPresetId = 'read-only' | 'default' | 'auto-review' | 'full-access';

export type PermissionPreset = {
  id: PermissionPresetId;
  title: string;
  description: string;
  approvalPolicy: string;
  approvalsReviewer?: string | null;
  sandboxMode: string;
  profileId: string;
};

export type MentionReference = {
  kind: 'file' | 'workspace' | 'conversation' | 'request' | 'ssh' | 'app';
  value: string;
};

export type WorkspaceMentionHistory = {
  workspaceId: string;
  files: string[];
  updatedAt: number;
};

export const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: 'off',
  off: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
  ultra: 'ultra',
  highest: 'ultra',
  ultracode: 'ultracode',
};

export function reasoningEffortLabel(value: string | null | undefined): string {
  const normalized = normalizeReasoningEffort(value);
  return normalized ? REASONING_EFFORT_LABELS[normalized] ?? normalized : 'default';
}

export function modelDisplayLabel(model: string | null | undefined, catalog: CodexModelCatalogItem[]): string {
  const normalized = model?.trim() ?? '';
  if (!normalized) {
    return t('session.modelUnset');
  }
  return catalog.find((item) => item.model === normalized)?.displayName || normalized;
}






export function mergeModelCatalog(remoteModels: CodexModelCatalogItem[], currentModels: string[]): CodexModelCatalogItem[] {
  const byModel = new Map<string, CodexModelCatalogItem>();
  FALLBACK_CODEX_MODELS.forEach((item) => byModel.set(item.model, item));
  remoteModels.forEach((item) => byModel.set(item.model, item));
  currentModels
    .map((model) => model.trim())
    .filter(Boolean)
    .forEach((model) => {
      if (!byModel.has(model)) {
        byModel.set(model, {
          id: model,
          model,
          displayName: model,
          description: 'Custom model',
          hidden: false,
          isDefault: false,
          supportedReasoningEfforts: DEFAULT_REASONING_EFFORT_OPTIONS,
          defaultReasoningEffort: 'medium',
          serviceTiers: [FAST_SERVICE_TIER],
        });
      }
    });
  return [...byModel.values()].filter((item) => !item.hidden);
}

export function normalizeExperimentalFeatures(value: Partial<ExperimentalFeatureSettings> | null | undefined): ExperimentalFeatureSettings {
  return {
    ...EXPERIMENTAL_FEATURE_DEFAULTS,
    ...(value && typeof value === 'object' ? value : {}),
  };
}



export function textFromContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part && typeof part === 'object') {
        const record = part as Record<string, unknown>;
        if (typeof record.text === 'string') {
          return record.text;
        }
      }
      return '';
    })
    .filter(Boolean)
    .join('');
}

export function textFromItem(item: Record<string, unknown>): string {
  const directText = item.text ?? item.message;
  if (typeof directText === 'string') {
    return directText;
  }
  return textFromContent(item.content);
}

export type PersistedSettings = Omit<ConnectionSettings, 'deviceSecret'>;


export const SETTINGS_STORAGE_KEY = `${platform.storagePrefix}.settings.v1`;
export const BACKEND_CONNECTIONS_STORAGE_KEY = `${platform.storagePrefix}.backendConnections.v1`;
export const WORKSPACES_STORAGE_KEY = `${platform.storagePrefix}.workspaces.v1`;
export const CONVERSATIONS_STORAGE_KEY = `${platform.storagePrefix}.conversations.v1`;
export const TIMELINE_STORAGE_KEY = `${platform.storagePrefix}.timeline.v1`;
export const ACTIVE_SELECTION_STORAGE_KEY = `${platform.storagePrefix}.activeSelection.v1`;
export const MENTION_HISTORY_STORAGE_KEY = `${platform.storagePrefix}.mentionHistory.v1`;
export const EXPERIMENTAL_FEATURES_STORAGE_KEY = `${platform.storagePrefix}.experimentalFeatures.v1`;
export const USAGE_RECORDS_STORAGE_KEY = `${platform.storagePrefix}.usageRecords.v1`;
export const PROVIDER_MODEL_PREFERENCES_STORAGE_KEY = `${platform.storagePrefix}.providerModelPreferences.v1`;
export const KANBAN_TASKS_STORAGE_KEY = `${platform.storagePrefix}.kanbanTasks.v1`;
export const DEVICE_SECRET_STORAGE_KEY = `${platform.storagePrefix}.deviceSecret.v1`;
export const DEVICE_ORIGIN_STORAGE_KEY = `${platform.storagePrefix}.deviceOrigin.v1`;
export const WORKSPACE_TOMBSTONES_STORAGE_KEY = `${platform.storagePrefix}.workspaceTombstones.v1`;
/** Config-sync baselines: content hashes per source → target pair, never values. */
export const CONFIG_SYNC_STORAGE_KEY = `${platform.storagePrefix}.configSync.v1`;
export const JSON_SAVE_DEBOUNCE_MS = 350;
export const WORKSPACE_SYNC_DEBOUNCE_MS = 900;
export const SOCKET_EVENT_BATCH_SIZE = 24;
export const SOCKET_FRAME_DECODE_BATCH_SIZE = 8;
export const SOCKET_FRAME_DECODE_BUDGET_MS = 10;
/** Opened socket messages waiting to be decoded. A renderer this far behind
 * drops the backlog and reconnects; resubscribing replays every
 * conversation from its cursor, so memory stays bounded without losing
 * events. */
export const MAX_PENDING_SOCKET_FRAMES = 5000;
/** A backlog drop this soon after the previous one belongs to the same storm.
 * Every verified reconnect resets the normal attempt counter, so without this
 * a renderer that keeps falling behind would reconnect at the base delay
 * forever. */
export const SOCKET_BACKLOG_STREAK_RESET_MS = 5 * 60_000;

export type SocketBacklogStreak = { count: number; lastDropAt: number };

/** Records a backlog drop at `now`: consecutive drops grow the streak, one
 * after a quiet `SOCKET_BACKLOG_STREAK_RESET_MS` starts over. The reconnect
 * backs off by `count - 1` attempts. */
export function nextSocketBacklogStreak(previous: SocketBacklogStreak | null, now: number): SocketBacklogStreak {
  const continues = previous !== null && now - previous.lastDropAt < SOCKET_BACKLOG_STREAK_RESET_MS;
  return { count: continues ? previous.count + 1 : 1, lastDropAt: now };
}
export const MAX_TRANSPORT_HELLO_SESSION_CURSORS = 12;
// Keep enough local history for completed execution traces to remain
// inspectable after a long Claude Code turn. The backend remains the source
// of truth for replay, while the desktop cache avoids silently evicting the
// context users are currently reviewing.
export const MAX_TIMELINE_ITEMS = 1000;
/** In-memory ceiling for timeline rows outside any conversation. Lazy
 * history loading keeps older pages mounted, so this is far above the
 * persisted slice. */
export const MAX_TIMELINE_ITEMS_LIVE = 5_000;
/** In-memory ceiling per conversation, so a busy background conversation
 * cannot evict the rows of another one. Earlier history stops paging in once
 * a conversation reaches it. */
export const MAX_CONVERSATION_TIMELINE_ITEMS = 5_000;
export const MAX_USAGE_RECORDS = 2_000;
export const MAX_WORKSPACE_TOMBSTONES = 100;
export const RECONNECT_DELAY_MS = 2000;
export const RECONNECT_MAX_DELAY_MS = 30_000;
export const CHAT_BOTTOM_FOLLOW_THRESHOLD = 72;
/** An unanswered `terminal.attach` is sent again after this long. */
export const TERMINAL_ATTACH_TIMEOUT_MS = 5000;
/** At most this many non-live terminal records are kept (LRU by updatedAt);
 * live PTYs are never evicted. Mirrors the mobile client's maxTerminals = 8. */
export const TERMINAL_MAX_CACHED_TERMINALS = 8;
const TERMINAL_LIVE_STATUSES: ReadonlySet<TerminalLifecycleState> = new Set(['starting', 'running', 'stopping']);

export const DEFAULT_TERMINAL_ROWS = 24;
export const DEFAULT_TERMINAL_COLS = 80;

/** Mirrors the backend's MAX_WORKSPACE_TEXT_BYTES compare-and-save limit. */
export const WORKSPACE_FILE_MAX_TEXT_BYTES = 1024 * 1024;

/** git-style conflict marker document for the manual merge flow, matching the
 * mobile client's `<<<<<<< local … ======= … >>>>>>> remote` splice. */
export function buildConflictMergeDocument(local: string, remote: string, localLabel: string, remoteLabel: string): string {
  return [`<<<<<<< ${localLabel}`, local, '=======', remote, `>>>>>>> ${remoteLabel}`].join('\n');
}

/** A merged document can only be adopted once every marker line is removed. */
export function conflictMarkersRemain(text: string): boolean {
  return text.split('\n').some((line) => line.startsWith('<<<<<<<') || line.startsWith('>>>>>>>') || line.trim() === '=======');
}

/** TodeX's own commands, offered when the agent publishes no catalog of its
 * own (agent commands come from `providerCommands`). */
export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/permissions', title: 'Permissions', description: 'choose what the agent is allowed to do', category: 'settings' },
  { command: '/experimental', title: 'Experimental', description: 'toggle experimental features', category: 'settings' },
  { command: '/approve', title: 'Approve', description: 'answer the open permission request', category: 'runtime' },
  { command: '/memories', title: 'Memories', description: 'configure memory use and generation', category: 'settings' },
  { command: '/rename', title: 'Rename', description: 'rename the current conversation', category: 'thread' },
  { command: '/new', title: 'New', description: 'start a new conversation', category: 'thread' },
  { command: '/archive', title: 'Archive', description: 'archive this conversation', category: 'thread' },
  { command: '/resume', title: 'Resume', description: 'resume the agent session', category: 'thread' },
  { command: '/fork', title: 'Fork', description: 'fork the current conversation', category: 'thread' },
  { command: '/plan', title: 'Plan', description: 'switch to Plan mode', category: 'core' },
  { command: '/copy', title: 'Copy', description: 'copy last response as markdown', category: 'context' },
  { command: '/diff', title: 'Diff', description: 'show git diff including untracked files', category: 'context' },
  { command: '/mention', title: 'Mention', description: 'mention a file', category: 'context' },
  { command: '/clear', title: 'Clear', description: 'start a new conversation', category: 'thread' },
];

export const EXPERIMENTAL_FEATURE_DEFAULTS: ExperimentalFeatureSettings = {
  gitDiffViewer: false,
  verboseRuntimeEvents: false,
  composerFileMentions: false,
};

export const EXPERIMENTAL_FEATURES: ExperimentalFeatureDefinition[] = [
  {
    id: 'gitDiffViewer',
    title: t('exp.gitDiffViewerTitle'),
    description: t('exp.gitDiffViewerDesc'),
    scope: 'App UI',
  },
  {
    id: 'verboseRuntimeEvents',
    title: t('exp.verboseRuntimeEventsTitle'),
    description: t('exp.verboseRuntimeEventsDesc'),
    scope: 'Diagnostics',
  },
  {
    id: 'composerFileMentions',
    title: t('exp.composerFileMentionsTitle'),
    description: t('exp.composerFileMentionsDesc'),
    scope: 'Composer',
  },
];

export const SLASH_COMMAND_CATEGORY_ORDER: SlashCommandCategory[] = ['core', 'thread', 'context', 'runtime', 'settings', 'debug'];

export const SLASH_COMMAND_CATEGORY_LABELS: Record<SlashCommandCategory, string> = {
  get core() { return t('slashCat.core'); },
  thread: 'Thread',
  get context() { return t('slashCat.context'); },
  get runtime() { return t('slashCat.runtime'); },
  get settings() { return t('slashCat.settings'); },
  get debug() { return t('slashCat.debug'); },
};


export function canonicalSlashCommand(command: string): string {
  const normalized = command.trim().toLowerCase();
  if (normalized === '/clean') {
    return '/stop';
  }
  if (normalized === '/btw') {
    return '/side';
  }
  if (normalized === '/hook') {
    return '/hooks';
  }
  if (normalized === '/plugin') {
    return '/plugins';
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}



export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: 'default',
    title: 'Ask for approval',
    description: 'Codex can read and edit files in the current workspace. Approval is required for network or outside edits.',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'workspace-write',
    profileId: ':workspace',
  },
  {
    id: 'auto-review',
    title: 'Approve for me',
    description: 'Route approval requests to Codex auto-review before asking you.',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandboxMode: 'workspace-write',
    profileId: ':workspace',
  },
  {
    id: 'full-access',
    title: 'Full Access',
    description: 'Codex can edit files outside this workspace and access the internet without asking.',
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'danger-full-access',
    profileId: ':danger-full-access',
  },
];

export { conversationPermissionCapabilities, conversationPermissionMode, isPermissionMode, PERMISSION_MODES, rememberedRunModes } from './permissions';

export function permissionPresetForProfile(
  profileId: string | null | undefined,
  approvalsReviewer?: string | null,
): PermissionPreset | null {
  if (!profileId) {
    return null;
  }
  const normalizedReviewer = approvalsReviewer || null;
  return (
    PERMISSION_PRESETS.find((preset) =>
      (preset.profileId === profileId || preset.id === profileId) &&
      (!normalizedReviewer || preset.approvalsReviewer === normalizedReviewer)
    ) ??
    PERMISSION_PRESETS.find((preset) =>
      (preset.profileId === profileId || preset.id === profileId) &&
      preset.approvalsReviewer !== 'auto_review'
    ) ??
    null
  );
}







export const defaultSettings: ConnectionSettings = {
  serverUrl: 'http://127.0.0.1:7345',
  deviceSecret: '',
  tenantId: 'local',
  encryptionProtocol: 'none',
  encryptionPublicKey: '',
  transportVerified: false,
  defaultWorkspacePath: '/home/dev/projects',
  defaultModel: 'gpt-5.5',
  defaultReasoningEffort: 'medium',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandboxMode: 'workspace-write',
};

export const defaultConnectionHealth: ConnectionHealth = {
  status: 'unknown',
  latencyMs: null,
  lastCheckedAt: null,
  error: '',
  code: '',
};



export function toPersistedSettings(settings: ConnectionSettings): PersistedSettings {
  const { deviceSecret: _deviceSecret, ...rest } = settings;
  return rest;
}

export function fromPersistedSettings(raw: Partial<PersistedSettings> | null | undefined, deviceSecret: string): ConnectionSettings {
  const { defaultThreadId: _legacyDefaultThreadId, ...safeRaw } = (raw ?? {}) as Partial<PersistedSettings> & {
    defaultThreadId?: string;
  };
  return {
    ...defaultSettings,
    ...safeRaw,
    defaultReasoningEffort: normalizeReasoningEffort(safeRaw.defaultReasoningEffort) ?? defaultSettings.defaultReasoningEffort,
    // Settings saved before pairing bound the transport key decode unverified.
    transportVerified: safeRaw.transportVerified === true,
    deviceSecret,
  };
}

/**
 * The credentials only device pairing may set. A changed server URL and a
 * newly added backend start from these: the device key and the transport pin
 * belong to one backend origin.
 */
export const UNPAIRED_TRANSPORT = {
  deviceSecret: '',
  encryptionProtocol: 'none',
  encryptionPublicKey: '',
  transportVerified: false,
} as const satisfies Pick<ConnectionSettings, 'deviceSecret' | 'encryptionProtocol' | 'encryptionPublicKey' | 'transportVerified'>;

export function profileFromSettings(settings: ConnectionSettings, name = t('session.defaultBackend'), id = 'default-backend'): BackendConnectionProfile {
  const now = Date.now();
  return { id, name, serverUrl: normalizeServerUrl(settings.serverUrl), deviceSecret: settings.deviceSecret, tenantId: settings.tenantId, encryptionProtocol: settings.encryptionProtocol, encryptionPublicKey: settings.encryptionPublicKey, transportVerified: settings.transportVerified === true, createdAt: now, updatedAt: now };
}

export function settingsFromProfile(profile: BackendConnectionProfile, current: ConnectionSettings): ConnectionSettings {
  return { ...current, serverUrl: normalizeServerUrl(profile.serverUrl), deviceSecret: profile.deviceSecret, tenantId: profile.tenantId, encryptionProtocol: profile.encryptionProtocol, encryptionPublicKey: profile.encryptionPublicKey, transportVerified: profile.transportVerified === true };
}

export function normalizeBackendConnectionProfile(value: unknown): BackendConnectionProfile | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const serverUrl = typeof raw.serverUrl === 'string' ? raw.serverUrl.trim() : '';
  if (!id || !serverUrl) return null;
  const now = Date.now();
  return { id, labelColor: normalizeBackendLabelColor(raw.labelColor), name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : t('session.backend'), serverUrl: normalizeServerUrl(serverUrl), deviceSecret: typeof raw.deviceSecret === 'string' ? raw.deviceSecret : '', tenantId: typeof raw.tenantId === 'string' && raw.tenantId.trim() ? raw.tenantId.trim() : 'local', encryptionProtocol: raw.encryptionProtocol === 'x25519' || raw.encryptionProtocol === 'ml-kem-768' ? raw.encryptionProtocol : 'none', encryptionPublicKey: typeof raw.encryptionPublicKey === 'string' ? raw.encryptionPublicKey : '', transportVerified: raw.transportVerified === true, ...(raw.disabled === true ? { disabled: true } : {}), createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now, updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now };
}

const DEVICE_IDENTITY_CACHE_LIMIT = 16;
const deviceIdentityCache = new Map<string, DeviceIdentity | null>();

/** `deviceIdentityFromSecret` derives the Ed25519 public key on every call;
 * request signing reuses the identity of each (few) device secrets. */
export function cachedDeviceIdentity(secret: string): DeviceIdentity | null {
  if (deviceIdentityCache.has(secret)) return deviceIdentityCache.get(secret) ?? null;
  const identity = deviceIdentityFromSecret(secret);
  if (deviceIdentityCache.size >= DEVICE_IDENTITY_CACHE_LIMIT) deviceIdentityCache.clear();
  deviceIdentityCache.set(secret, identity);
  return identity;
}

/** The parts of a backend profile the transport depends on. */
export type BackendTransportProfile = Pick<ConnectionSettings, 'serverUrl' | 'deviceSecret' | 'encryptionProtocol' | 'encryptionPublicKey' | 'transportVerified'>;

/**
 * The profile's transport v2 entry point (cached per profile): a key pinned
 * by device pairing sends every REST call through `POST /v2/sealed` and opens
 * `tv=2` sockets, an unverified pin or an unpaired remote host is refused, an
 * unpaired loopback host is plaintext.
 */
export function backendTransport(settings: BackendTransportProfile): SecureTransport {
  if (transportOverride) return transportOverride;
  return withLocalizedRequestLimits(cachedSecureTransport(settings, cachedDeviceIdentity(settings.deviceSecret)));
}

let transportOverride: SecureTransport | null = null;

/** Routes every backend call through `transport` instead of the network; the
 * dev-only demo preview (`?demo`) uses it to serve fixtures. */
export function overrideBackendTransport(transport: SecureTransport | null): void {
  transportOverride = transport;
}

/** The profile the Workbench browser forwards its loopback requests through;
 * null in the demo preview, whose backend is fixtures. */
export function previewBackendProfile(settings: BackendTransportProfile): BackendTransportProfile | null {
  if (transportOverride) return null;
  const { serverUrl, deviceSecret, encryptionProtocol, encryptionPublicKey, transportVerified } = settings;
  return { serverUrl, deviceSecret, encryptionProtocol, encryptionPublicKey, transportVerified };
}

const localizedTransports = new WeakMap<SecureTransport, SecureTransport>();
const MIB = 1024 * 1024;

/** Turns the transport's body-limit pre-check (nothing was sent) into a
 * localized, non-retryable `ConnectionError` for every REST caller. */
function withLocalizedRequestLimits(transport: SecureTransport): SecureTransport {
  const cached = localizedTransports.get(transport);
  if (cached) return cached;
  const localize = (error: unknown): never => {
    if (error instanceof TransportPayloadTooLargeError) {
      throw new ConnectionError(
        ConnectionErrorType.MESSAGE_TOO_LARGE,
        t('transport.requestTooLarge', { size: (Math.ceil((error.size / MIB) * 10) / 10).toFixed(1), limit: Math.round(error.limit / MIB) }),
        error.message,
        false,
        'request_failed',
      );
    }
    throw error;
  };
  const wrapped: SecureTransport = {
    ...transport,
    fetch: (request) => transport.fetch(request).catch(localize),
    fetchStream: (request) => transport.fetchStream(request).catch(localize),
  };
  localizedTransports.set(transport, wrapped);
  return wrapped;
}

/** How long a request without its own signal may take, as V2ApiClient allows. */
export const BACKEND_FETCH_TIMEOUT_MS = 30_000;

/** A signed backend request through the profile's transport, answered as a
 * standard `Response`. Without a caller signal it gives up after
 * `BACKEND_FETCH_TIMEOUT_MS`, so a stalled backend cannot hold a sync. */
export async function backendFetch(settings: BackendTransportProfile, request: SecureRequest): Promise<Response> {
  const signal = request.signal ?? AbortSignal.timeout(BACKEND_FETCH_TIMEOUT_MS);
  return toFetchResponse(await backendTransport(settings).fetch({ ...request, signal }));
}

/** A failed backend request: the server's `code` and message when it sent one. */
export class BackendRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'BackendRequestError';
  }

  /** 401 / UNAUTHENTICATED: the device is not (or no longer) paired. */
  get unauthenticated(): boolean {
    return this.status === 401 || this.code === 'UNAUTHENTICATED';
  }
}

/** Reads the backend's error body (`{ code, message }`, or local-admin's
 * `{ error: { code, message } }`) into a `BackendRequestError`; `fallback`
 * names the request when the body says nothing. */
export async function readBackendError(response: Response, fallback: string): Promise<BackendRequestError> {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const error = body && typeof body.error === 'object' && body.error ? body.error as Record<string, unknown> : body;
  const message = typeof error?.message === 'string' && error.message.trim() ? error.message : '';
  const code = typeof error?.code === 'string' ? error.code : undefined;
  return new BackendRequestError(message ? `${fallback}: ${message}` : `${fallback} (HTTP ${response.status})`, response.status, code);
}

/**
 * Sends one JSON text message over the secure socket. The size check runs on
 * the plaintext before sealing (no counter is consumed) and surfaces as the
 * usual `ConnectionError`.
 */
export function sendSocketText(socket: SecureSocket, text: string): void {
  try {
    socket.send(text);
  } catch (error) {
    if (error instanceof TransportPayloadTooLargeError) throw ConnectionError.messageTooLarge(error.size, error.limit);
    throw error;
  }
}

export type TransportFailure = { message: string; retryable: boolean; code: ConnectionFailureCode };

/**
 * Localized message, retry policy and health code for a transport v2
 * failure, or null when `error` is not one. Pairing problems (no key for a
 * remote host, a changed or invalid key) and an outdated backend (no
 * transport v2 or no sealed REST revision 2) stop the automatic reconnect;
 * crypto failures (`4400`, `TRANSPORT_CRYPTO_FAILED`) and an unreachable
 * policy check keep retrying.
 */
export function describeTransportFailure(error: unknown): TransportFailure | null {
  if (error instanceof EncryptionRequiredError) {
    return { message: t('transport.encryptionRequired'), retryable: false, code: 'encryption_required' };
  }
  if (error instanceof InvalidPinnedKeyError) {
    return { message: t('transport.invalidKey'), retryable: false, code: 'encryption_required' };
  }
  if (error instanceof TransportRepairRequiredError) {
    return {
      message: error.required === null ? t('transport.unverifiedPin') : t('transport.repairRequired', { protocol: error.required }),
      retryable: false,
      code: 'encryption_required',
    };
  }
  if (error instanceof BackendUpgradeRequiredError) {
    return { message: t('transport.backendUpgradeRequired'), retryable: false, code: 'protocol_mismatch' };
  }
  if (error instanceof TransportPolicyError) {
    switch (error.reason) {
      case 'outdated':
        return { message: t('transport.backendOutdated'), retryable: false, code: 'protocol_mismatch' };
      case 'invalid':
        return { message: t('transport.invalidPolicy'), retryable: false, code: 'protocol_mismatch' };
      case 'timeout':
        return { message: t('sess.backendStartTimeout'), retryable: true, code: 'backend_unreachable' };
      case 'unreachable':
        return { message: t('transport.policyUnreachable'), retryable: true, code: 'backend_unreachable' };
      default:
        return { message: t('transport.cannotConfirmPolicy'), retryable: error.retryable, code: 'backend_unreachable' };
    }
  }
  if (error instanceof TransportCryptoError
    || (error instanceof ConnectionError && error.backendCode === 'TRANSPORT_CRYPTO_FAILED')) {
    return { message: t('transport.cryptoFailed'), retryable: true, code: 'protocol_mismatch' };
  }
  if (error instanceof ConnectionError && error.backendCode === 'PROTOCOL_UPGRADE_REQUIRED') {
    return { message: t('transport.upgradeRequired'), retryable: false, code: 'encryption_required' };
  }
  if (error instanceof SocketVerificationError) {
    return { message: t('transport.notVerified'), retryable: error.retryable, code: 'protocol_mismatch' };
  }
  return null;
}

export function backendApi(
  settings: BackendTransportProfile,
  options: Pick<V2ApiOptions, 'historyEncryption' | 'timeout'> = {},
): V2ApiClient {
  return new V2ApiClient({ ...options, serverUrl: settings.serverUrl, transport: backendTransport(settings) });
}

export function workspaceSyncPayloadEquals(left: WorkspaceRecord[], right: WorkspaceRecord[]): boolean {
  return JSON.stringify(prepareWorkspaceSyncPayload(left)) === JSON.stringify(prepareWorkspaceSyncPayload(right));
}

export function sanitizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function createSessionId(name: string): string {
  const slug = sanitizeSlug(name) || 'workspace';
  return `cdxs_${slug}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function terminalIdForConversation(conversationId: string, suffix = ''): string {
  const base = `term_${conversationId.replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
  const normalizedSuffix = suffix.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return normalizedSuffix ? `${base}_${normalizedSuffix}` : base;
}

export function terminalStatusLabel(status: TerminalLifecycleState): string {
  switch (status) {
    case 'starting':
      return t('terminal.starting');
    case 'running':
      return t('terminal.running');
    case 'stopping':
      return t('terminal.stopping');
    case 'exited':
      return t('terminal.exited');
    case 'error':
      return t('terminal.error');
    case 'idle':
    default:
      return t('terminal.idle');
  }
}

/** LRU-evicts terminal records past TERMINAL_MAX_CACHED_TERMINALS, skipping any
 * PTY that may still be alive so its state stays queryable. Returns the input
 * unchanged when nothing needs to go. */
export function evictIdleTerminalStates(current: Record<string, TerminalClientState>): Record<string, TerminalClientState> {
  const idle = Object.values(current)
    .filter((terminal) => !TERMINAL_LIVE_STATUSES.has(terminal.status))
    .sort((a, b) => a.updatedAt - b.updatedAt);
  if (idle.length <= TERMINAL_MAX_CACHED_TERMINALS) return current;
  const evicted = new Set(idle.slice(0, idle.length - TERMINAL_MAX_CACHED_TERMINALS).map((terminal) => terminal.terminalId));
  const next = { ...current };
  for (const terminalId of evicted) delete next[terminalId];
  return next;
}


export function connectionStateLabel(state: ConnectionState): string {
  switch (state) {
    case 'open':
      return t('conn.open');
    case 'connecting':
      return t('conn.connecting');
    case 'closed':
      return t('conn.closed');
    case 'error':
      return t('conn.error');
    case 'idle':
    default:
      return t('conn.idle');
  }
}

export function latencyLabelOf(latencyMs: number | null): string {
  return latencyMs === null ? t('conn.notMeasured') : `${latencyMs} ms`;
}

export function healthLabelOf(health: ConnectionHealth): string {
  switch (health.status) {
    case 'online':
      return t('conn.online', { latency: latencyLabelOf(health.latencyMs) });
    case 'checking':
      return health.latencyMs === null ? t('conn.checking') : t('conn.checkingWithLatency', { latency: latencyLabelOf(health.latencyMs) });
    case 'offline':
      if (health.error) {
        return health.error;
      }
      return t('conn.unreachable');
    case 'unknown':
    default:
      return t('conn.waiting');
  }
}

/** History that can only be read (legacy plaintext or retired local Codex). */
export function isReadOnlyConversation(conversation: Pick<ConversationRecord, 'legacyPlaintext' | 'legacyCodex'> | null | undefined): boolean {
  return conversation?.legacyPlaintext === true || conversation?.legacyCodex === true;
}

export function isV2Conversation(conversation: ConversationRecord | null | undefined): boolean {
  return Boolean(conversation?.v2ConversationId || (conversation?.provider && conversation.provider !== ''));
}

/** The connected backend holds queued follow-ups for this provider
 * (`conversation.queue.*`). It is the only place queued messages live. */
export function providerHasBackendQueue(providers: readonly ProviderDescriptor[], providerId: string | undefined): boolean {
  return Boolean(providerId && providers.find((provider) => provider.id === providerId)?.capabilities.backendQueue === true);
}

/** The backend can also pause the queue by user request, hand an item back
 * (`conversation.queue.pause|take`) and add one already paused. */
export function providerHasBackendQueueControl(providers: readonly ProviderDescriptor[], providerId: string | undefined): boolean {
  return providerHasBackendQueue(providers, providerId)
    && providers.find((provider) => provider.id === providerId)?.capabilities.backendQueueControl === true;
}

/** The backend can hold the queue until a set time (`conversation.schedule`). */
export function providerSupportsScheduledConversations(providers: readonly ProviderDescriptor[], providerId: string | undefined): boolean {
  return providerHasBackendQueue(providers, providerId)
    && providers.find((provider) => provider.id === providerId)?.capabilities.scheduledConversations === true;
}

export function hasBackendQueue(providers: readonly ProviderDescriptor[], conversation: ConversationRecord | null | undefined): boolean {
  return Boolean(conversation?.v2ConversationId && providerHasBackendQueue(providers, conversation.provider));
}

export function resolveCreateConversationAgent(input: {
  requestedProvider?: string;
  requestedProfile?: string;
  providers: ProviderDescriptor[];
  conversations: ConversationRecord[];
  activeConversationId: string;
  workspaceId: string;
}): { provider: ProviderKind; providerProfile?: string } | null {
  const available = input.providers.filter((item) => item.available);
  const match = (provider?: string, profile?: string) => {
    if (!provider) {
      return null;
    }
    const descriptor = available.find((item) => item.id === provider);
    if (!descriptor) {
      return null;
    }
    const nextProfile = profile && descriptor.profiles.includes(profile)
      ? profile
      : descriptor.profiles[0];
    return { provider: descriptor.id, providerProfile: nextProfile };
  };

  if (input.requestedProvider) {
    return match(input.requestedProvider, input.requestedProfile);
  }

  const candidates = [
    input.conversations.find((item) => item.id === input.activeConversationId),
    ...input.conversations
      .filter((item) => item.workspaceId === input.workspaceId && !item.archived)
      .sort((left, right) => right.updatedAt - left.updatedAt),
    ...input.conversations
      .filter((item) => !item.archived)
      .sort((left, right) => right.updatedAt - left.updatedAt),
  ];
  for (const conversation of candidates) {
    const found = match(conversation?.provider, conversation?.providerProfile);
    if (found) {
      return found;
    }
  }

  const first = available[0];
  return first ? match(first.id) : null;
}

export function canSwitchConversationAgent(
  conversation: ConversationRecord | null | undefined,
  options: {
    timeline?: TimelineEntry[];
    thinking?: boolean;
  } = {},
): boolean {
  if (!conversation) {
    return false;
  }
  if (options.thinking) {
    return false;
  }
  if (conversation.v2ConversationId || normalizeThreadId(conversation.threadId)) {
    return false;
  }
  // lastSequence also advances for subscribe/metadata events, so it cannot
  // mean "the user has started this chat". Lock only after a real message.
  return !(options.timeline ?? []).some(
    (entry) =>
      entry.conversationId === conversation.id
      && (entry.kind === 'outgoing' || entry.kind === 'incoming'),
  );
}

export function conversationFromManifest(
  manifest: ConversationManifest,
  workspaceId: string,
): ConversationRecord {
  const createdAt = Date.parse(manifest.createdAt) || Date.now();
  const updatedAt = Date.parse(manifest.updatedAt) || createdAt;
  return {
    id: manifest.id,
    workspaceId,
    ...(manifest.scratchWorkspace ? { workspacePath: manifest.workspace } : {}),
    title: manifest.title || providerDisplayName(manifest.provider),
    preview: '',
    nativeStatus: manifest.status,
    archived: Boolean(manifest.archivedAt),
    ...(manifest.legacyPlaintext ? { legacyPlaintext: true } : {}),
    ...(parseConversationSchedule(manifest.schedule) ? { schedule: parseConversationSchedule(manifest.schedule) } : {}),
    ...(manifest.ephemeral === true ? { ephemeral: true } : {}),
    sessionId: `v2_${manifest.id}`,
    threadId: '',
    localAdapterState: 'idle',
    mode: 'implement',
    goalStatus: '',
    goalObjective: '',
    provider: manifest.provider,
    providerProfile: manifest.providerProfile,
    v2ConversationId: manifest.id,
    ...(manifest.parentConversationId ? { parentConversationId: manifest.parentConversationId } : {}),
    lastSequence: manifest.lastSequence,
    createdAt,
    updatedAt,
  };
}

/** A private (RAM-only) conversation: only what its manifest echoed counts. */
export function isPrivateConversation(conversation: Pick<ConversationRecord, 'ephemeral'> | null | undefined): boolean {
  return conversation?.ephemeral === true;
}

/** Conversations the sidebar and pickers list: everything but Agent Calling children. */
export function isListedConversation(conversation: Pick<ConversationRecord, 'parentConversationId'>): boolean {
  return !conversation.parentConversationId;
}

export function sameConversationSchedule(left?: ConversationSchedule, right?: ConversationSchedule): boolean {
  return left?.at === right?.at && Boolean(left?.interrupted) === Boolean(right?.interrupted);
}

/** A schedule still holding what is sent (not interrupted by a restart). */
export function activeConversationSchedule(conversation: Pick<ConversationRecord, 'schedule'> | null | undefined): ConversationSchedule | undefined {
  const schedule = conversation?.schedule;
  return schedule && !schedule.interrupted ? schedule : undefined;
}

export function mergeManifestConversations(
  current: ConversationRecord[],
  manifests: ConversationManifest[],
  workspaces: WorkspaceRecord[],
  backendConnectionId: string,
  /** Run modes for a record first seen here (created elsewhere, or rebuilt
   * after its local record was lost), so it does not fall back to whatever
   * the backend declares as its provider default. */
  initialRunModes?: (record: ConversationRecord, workspace: WorkspaceRecord) => Partial<Pick<ConversationRecord, 'permissionMode'>>,
): ConversationRecord[] {
  // The backend is authoritative after materialization. Provider-backed local
  // drafts have no v2ConversationId yet and must survive manifest refreshes.
  // Merge field-by-field and keep the previous array/object identity when
  // nothing actually changed so the sidebar does not re-render or re-sort on
  // every poll.
  // Manifests only describe the backend they were listed from: conversations
  // and workspaces owned by another backend are out of scope. Untagged
  // records predate backend profiles and belong to the active backend.
  const inScope = (id: string | null | undefined) => !id || id === backendConnectionId;
  const scopedWorkspaces = workspaces.filter((workspace) => inScope(workspace.backendConnectionId));
  const conversationInScope = (item: ConversationRecord) => inScope(
    item.backendConnectionId ?? workspaces.find((workspace) => workspace.id === item.workspaceId)?.backendConnectionId,
  );
  const manifestIds = new Set(manifests.map((manifest) => manifest.id));
  let changed = false;
  // Child conversations (Agent Calling) are not listed; they stay while
  // their parent is.
  const next = current.filter((item) => (
    !isV2Conversation(item)
    || !item.v2ConversationId
    || manifestIds.has(item.v2ConversationId)
    || (item.parentConversationId !== undefined && manifestIds.has(item.parentConversationId))
    || !conversationInScope(item)
  ));
  if (next.length !== current.length) {
    changed = true;
  }
  for (const manifest of manifests) {
    const workspace = manifest.scratchWorkspace
      ? scopedWorkspaces.find((item) => isNoneWorkspaceId(item.id))
      : (manifest.workspaceId ? scopedWorkspaces.find((item) => item.id === manifest.workspaceId) : undefined)
        ?? scopedWorkspaces.find((item) => item.path === manifest.workspace);
    if (!workspace) {
      continue;
    }
    const existingIndex = next.findIndex((item) => item.v2ConversationId === manifest.id || item.id === manifest.id);
    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      // Local timestamps stay put unless the backend reports a newer one;
      // a manifest without parseable times must not re-stamp the record.
      const manifestUpdatedAt = Date.parse(manifest.updatedAt) || 0;
      const updatedAt = Math.max(existing.updatedAt, manifestUpdatedAt);
      const lastSequence = Math.max(existing.lastSequence ?? 0, manifest.lastSequence ?? 0);
      // An encrypted title this device has not read yet keeps the local one
      // (e.g. a rename just made here) instead of the provider name.
      const title = manifest.title || (manifest.titleEnc && existing.title ? existing.title : providerDisplayName(manifest.provider));
      const archived = Boolean(manifest.archivedAt);
      const legacyPlaintext = manifest.legacyPlaintext === true;
      const schedule = parseConversationSchedule(manifest.schedule);
      const ephemeral = manifest.ephemeral === true;
      const same = existing.title === title
        && isPrivateConversation(existing) === ephemeral
        && sameConversationSchedule(existing.schedule, schedule)
        && existing.archived === archived
        && Boolean(existing.legacyPlaintext) === legacyPlaintext
        && existing.nativeStatus === manifest.status
        && existing.provider === manifest.provider
        && existing.providerProfile === manifest.providerProfile
        && existing.v2ConversationId === manifest.id
        && existing.workspaceId === workspace.id
        && (!manifest.scratchWorkspace || existing.workspacePath === manifest.workspace)
        && existing.lastSequence === lastSequence
        && existing.updatedAt === updatedAt;
      if (!same) {
        changed = true;
        next[existingIndex] = {
          ...existing,
          title,
          archived,
          legacyPlaintext: legacyPlaintext || undefined,
          ephemeral: ephemeral || undefined,
          schedule,
          nativeStatus: manifest.status,
          provider: manifest.provider,
          providerProfile: manifest.providerProfile,
          v2ConversationId: manifest.id,
          workspaceId: workspace.id,
          ...(manifest.scratchWorkspace ? { workspacePath: manifest.workspace } : {}),
          lastSequence,
          updatedAt,
        };
      }
    } else {
      const base = conversationFromManifest(manifest, workspace.id);
      const record = { ...base, ...initialRunModes?.(base, workspace) };
      // The None workspace spans backends; its conversations carry their own.
      next.unshift(manifest.scratchWorkspace ? { ...record, backendConnectionId } : record);
      changed = true;
    }
  }
  if (!changed) {
    return current;
  }
  return next.sort((left, right) => (right.updatedAt - left.updatedAt) || (left.id < right.id ? -1 : 1));
}

export function shouldAppendV2ConversationEvent(event: ConversationEvent): boolean {
  return sharedShouldAppendV2ConversationEvent(event);
}
























export function findMentionTrigger(text: string, cursor: number): MentionTrigger | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  const beforeCursor = text.slice(0, end);
  const atIndex = beforeCursor.lastIndexOf('@');
  if (atIndex < 0) {
    return null;
  }

  const prefix = beforeCursor.slice(0, atIndex);
  if (prefix && !/\s$/.test(prefix)) {
    return null;
  }

  const query = beforeCursor.slice(atIndex + 1);
  if (/[^\s@]*\s/.test(query) || query.includes('@')) {
    return null;
  }

  return {
    start: atIndex,
    end,
    query,
  };
}

export function insertMention(text: string, trigger: MentionTrigger, insertText: string): string {
  return `${text.slice(0, trigger.start)}${insertText}${text.slice(trigger.end)}`;
}

export function parseMentionReferences(text: string): MentionReference[] {
  const references = new Map<string, MentionReference>();
  const mentionPattern = /(?:^|\s)@([^\s@]+)/g;
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(text)) !== null) {
    const raw = (match[1] ?? '').replace(/[.,;:!?，。；：！？]+$/g, '');
    if (!raw) {
      continue;
    }

    const [prefix, ...rest] = raw.split(':');
    const value = rest.join(':').trim();
    const kind =
      prefix === 'workspace' || prefix === 'conversation' || prefix === 'request' || prefix === 'ssh' || prefix === 'app'
        ? prefix
        : 'file';
    const resolvedValue = kind === 'file' ? raw : value;
    if (!resolvedValue) {
      continue;
    }
    references.set(`${kind}:${resolvedValue}`, { kind, value: resolvedValue });
  }

  return [...references.values()];
}

export function summarizeMentionReferences(references: MentionReference[]): string {
  const files = references.filter((item) => item.kind === 'file');
  if (!files.length) {
    return '';
  }
  return files.map((item) => item.value).join(', ');
}

export function stringFromUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

export function parseWorkspaceDirectorySnapshot(value: unknown): WorkspaceDirectorySnapshot {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const entries = Array.isArray(root.entries)
    ? root.entries
        .map((entry): WorkspaceDirectoryEntry | null => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return null;
          }
          const record = entry as Record<string, unknown>;
          const name = stringFromUnknown(record.name).trim();
          const path = stringFromUnknown(record.path).trim();
          const kind = stringFromUnknown(record.kind);
          if (!name || !path || kind !== 'directory') {
            return null;
          }
          return { name, path, kind: 'directory' };
        })
        .filter((entry): entry is WorkspaceDirectoryEntry => Boolean(entry))
    : [];
  const parent = stringFromUnknown(root.parent).trim();
  const roots = Array.isArray(root.roots)
    ? root.roots.map((item) => stringFromUnknown(item).trim()).filter(Boolean)
    : [];
  return {
    root: stringFromUnknown(root.root).trim(),
    roots,
    current: stringFromUnknown(root.current).trim(),
    parent: parent || null,
    entries,
  };
}

export async function fetchWorkspaceDirectorySnapshot(
  settings: ConnectionSettings,
  path?: string,
): Promise<WorkspaceDirectorySnapshot> {
  const response = await backendFetch(settings, {
    method: 'GET',
    path: '/v2/workspace/directories',
    query: path ? { path } : undefined,
    headers: { accept: 'application/json' },
  });
  return readWorkspaceDirectoryResponse(response, 'workspace.dirReadFailed');
}

/** Creates `name` directly under `parent` on the backend and returns the new folder's listing. */
export async function createWorkspaceDirectory(
  settings: ConnectionSettings,
  parent: string,
  name: string,
): Promise<WorkspaceDirectorySnapshot> {
  const response = await backendFetch(settings, {
    method: 'POST',
    path: '/v2/workspace/directories',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ parent, name }),
  });
  // Older backends only route GET here; 404 means the parent is missing.
  if (response.status === 405) {
    throw new Error(t('workspace.dirCreateUnsupported'));
  }
  return readWorkspaceDirectoryResponse(response, 'workspace.dirCreateFailed');
}

async function readWorkspaceDirectoryResponse(
  response: Response,
  failureKey: 'workspace.dirReadFailed' | 'workspace.dirCreateFailed',
): Promise<WorkspaceDirectorySnapshot> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const message = stringFromUnknown(record.message);
    throw new WorkspaceDirectoryError(message || t(failureKey, { status: response.status }), stringFromUnknown(record.code));
  }
  const snapshot = parseWorkspaceDirectorySnapshot(body);
  if (!snapshot.current) {
    throw new Error(t('workspace.noCurrentDir'));
  }
  return snapshot;
}

export function progressTextFromData(data: Record<string, unknown>, item: Record<string, unknown> | null): string {
  const direct = [
    data.delta,
    data.text,
    data.message,
    data.summary,
    data.status,
    data.reason,
    data.operation,
    data.command,
    data.question,
  ].map(stringFromUnknown).find(Boolean);
  if (direct) {
    return direct;
  }

  const questions = data.questions;
  if (Array.isArray(questions)) {
    const questionText = questions
      .map((question) => question && typeof question === 'object' && !Array.isArray(question)
        ? stringFromUnknown((question as Record<string, unknown>).question)
        : '')
      .find(Boolean);
    if (questionText) {
      return questionText;
    }
  }

  if (item) {
    const text = textFromItem(item);
    if (text) {
      return text;
    }
    const command = item.command ?? item.name ?? item.toolName ?? item.tool_name;
    if (typeof command === 'string' && command) {
      return command;
    }
  }

  const result = data.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const resultText = progressTextFromData(result as Record<string, unknown>, null);
    if (resultText) {
      return resultText;
    }
  }

  return '';
}



export function sessionIdFromEvent(event: ServerEvent, data = eventPayloadData(event)): string {
  const direct = transportSessionIdFromEvent(event);
  if (direct) {
    return direct;
  }
  const candidates = [
    data.codexSessionId,
    data.codex_session_id,
    data.sessionId,
    data.session_id,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value : '';
}

export function cursorFromEvent(event: ServerEvent): number | null {
  return transportCursorFromEvent(event);
}





/** Per-conversation state of paging older history into the chat. */
export type EarlierHistoryStatus = {
  hasMore: boolean;
  loading: boolean;
  /** The last page failed; only an explicit retry fetches again. */
  failed?: boolean;
  /** The conversation holds MAX_CONVERSATION_TIMELINE_ITEMS rows; older
   * history is not paged in. */
  capped?: boolean;
};

/** Scrolling may fetch older history on its own only while more exists, no
 * page is in flight, the conversation is under its row cap and the last page
 * did not fail — a failing backend would otherwise be asked again on every
 * layout pass. */
export function canAutoLoadEarlierHistory(status: EarlierHistoryStatus | undefined): boolean {
  return Boolean(status?.hasMore && !status.loading && !status.failed && !status.capped);
}

/** Keep the newest `limit` rows of each conversation (timelines are
 * newest-first); rows outside any conversation share MAX_TIMELINE_ITEMS_LIVE.
 * Order is preserved and the input is returned when nothing is dropped. */
export function capTimelinePerConversation<T extends { conversationId?: string }>(
  entries: T[],
  limit = MAX_CONVERSATION_TIMELINE_ITEMS,
): T[] {
  if (entries.length <= Math.min(limit, MAX_TIMELINE_ITEMS_LIVE)) return entries;
  const counts = new Map<string | undefined, number>();
  const kept = entries.filter((entry) => {
    const key = entry.conversationId || undefined;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count <= (key === undefined ? MAX_TIMELINE_ITEMS_LIVE : limit);
  });
  return kept.length === entries.length ? entries : kept;
}

/** Sort inclusive journal sequence ranges and merge the overlapping or
 * adjacent ones, so each event is fetched once. Invalid ranges are dropped. */
export function mergeSequenceRanges(ranges: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const valid = ranges
    .filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && from > 0 && to >= from)
    .map(([from, to]): [number, number] => [from, to])
    .sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const range of valid) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

export function makeSystemEntry(title: string, subtitle = '', workspaceId = '', conversationId = ''): TimelineEntry {
  return {
    id: createRequestId('sys'),
    kind: 'system',
    title,
    subtitle,
    raw: '',
    at: Date.now(),
    workspaceId,
    conversationId,
  };
}





export function isStepProgressEntry(entry: TimelineEntry): boolean {
  return sharedIsStepProgressEntry(entry);
}

export function isThinkingProgressEntry(entry: TimelineEntry): boolean {
  return sharedIsThinkingProgressEntry(entry);
}

export function isCollapsibleProgressEntry(entry: TimelineEntry): boolean {
  return sharedIsCollapsibleProgressEntry(entry);
}

export function executionGroupId(entries: TimelineEntry[]): string {
  return sharedExecutionGroupId(entries);
}

export function buildConversationRenderItems(entries: TimelineEntry[]): ConversationRenderItem[] {
  return sharedBuildConversationRenderItems(entries) as ConversationRenderItem[];
}

export function createDefaultConversation(workspace: WorkspaceRecord): ConversationRecord {
  const createdAt = workspace.createdAt || Date.now();
  return {
    id: createRequestId('conversation'),
    workspaceId: workspace.id,
    title: t('chat.defaultConversation'),
    preview: '',
    nativeStatus: '',
    archived: false,
    sessionId: createSessionId(`${workspace.name}_conversation`),
    threadId: '',
    localAdapterState: 'idle',
    mode: 'implement',
    goalStatus: '',
    goalObjective: '',
    createdAt,
    updatedAt: workspace.updatedAt || createdAt,
  };
}

/** The conversations of `workspaces`, newest first; a workspace without any
 * gets a draft (only those in `draftsFor` when given). Returns
 * `conversations` itself when that is already the result, so a periodic sync
 * does not re-render. */
export function conversationsForWorkspaceSnapshot(
  workspaces: WorkspaceRecord[],
  conversations: ConversationRecord[],
  draftsFor?: ReadonlySet<string>,
): ConversationRecord[] {
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const next = conversations.filter((conversation) => workspaceIds.has(conversation.workspaceId));
  const existingWorkspaceIds = new Set(next.map((conversation) => conversation.workspaceId));
  for (const workspace of workspaces) {
    if (!existingWorkspaceIds.has(workspace.id) && (!draftsFor || draftsFor.has(workspace.id))) {
      next.push(createDefaultConversation(workspace));
    }
  }
  next.sort((left, right) => right.updatedAt - left.updatedAt);
  return next.length === conversations.length && next.every((conversation, index) => conversation === conversations[index])
    ? conversations
    : next;
}

export function forkConversationRecord(conversation: ConversationRecord, title?: string): ConversationRecord {
  return {
    ...conversation,
    id: createRequestId('conversation'),
    title: title?.trim() || t('chat.forkTitle', { title: conversation.title || t('chat.newConversation') }),
    preview: '',
    nativeStatus: '',
    archived: false,
    sessionId: createSessionId(`${conversation.title || 'conversation'}_fork`),
    threadId: '',
    localAdapterState: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

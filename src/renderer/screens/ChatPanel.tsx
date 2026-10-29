import { ConversationControls } from '../components/ConversationControls';
import { PiExtensionPanel } from '../components/PiExtensionPanel';
import { piCommandCompatibility, piTodexCommands } from '../session/providerCommands';
import { ComputerLiveView } from '../components/ComputerLiveView';
import { ConversationGoalBar } from '../components/ConversationGoal';
import { ConversationScheduleBar } from '../components/ConversationSchedule';
import { NoticeToast } from '../components/NoticeToast';
import {
  RiArrowDownDoubleLine,
  RiArrowUpLine,
  RiAttachment2,
  RiBarChartBoxLine,
  RiChat3Line,
  RiCloseLine,
  RiCodeSSlashLine,
  RiCpuLine,
  RiEditLine,
  RiGitBranchLine,
  RiGitMergeLine,
  RiListCheck2,
  RiListCheck3,
  RiRouteLine,
  RiShieldCheckLine,
  RiShieldLine,
  RiSpeedUpLine,
  RiStopFill,
  RiTimerLine,
} from '@remixicon/react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, Dispatch, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, SetStateAction } from 'react';
import { Focusable, ListBox as AriaListBox, ListBoxItem as AriaListBoxItem, type ListBoxItemRenderProps } from 'react-aria-components';
import { motion, useReducedMotion } from 'motion/react';
import { ShimmerText } from '@/components/application/agent-log/agent-log';
import { ComposerLoader } from '@/components/application/composer-loader/composer-loader';
import { AgentLimitsCard } from '@/components/application/agent-limits/agent-limits-card';
import { Button } from '@/components/base/buttons/button';
import { Dropdown, DropdownPopover, DropdownTrigger } from '@/components/base/dropdown/dropdown';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Markdown, type MarkdownComponents } from '@/components/ui/markdown';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import { baseMarkdownComponents } from '../components/markdownComponents';
import { providerDisplayName, type ProviderKind, type ProviderQuotaSnapshot, type PermissionMode, type SkillCatalogDescriptor } from '@todex/protocol/v2';
import { ConversationPermissionActions, ConversationPromptInput, ConversationRunStatus, PermissionRequestCard, TurnUsageSummary } from '../components/ConversationRunStatus';
import { ReferenceComposer, type ComposerTokenState, type ReferenceComposerHandle } from '../components/ReferenceComposer';
import { PROMPT_UPLOAD_MAX_BYTES, isPromptUploadUnsupported, pastedTextDisposition } from '@todex/protocol/promptUploads';
import { ComposerAttachmentPreview } from '../components/ComposerAttachmentPreview';
import { SentAttachmentList } from '../components/chat/AttachmentTile';
import {
  COMPOSER_CONTROL_ICON,
  ComposerPopover,
  ComposerRoundButton,
  ComposerSelect,
  ComposerSendButton,
} from '../components/chat/ComposerControls';
import { CopyGlyph, FeedbackButton } from '../components/chat/MessageActions';
import { ProcessDisclosure, ProcessStep, ProcessSteps } from '../components/chat/ProcessDisclosure';
import { ToolCallCard, type ToolCallState } from '../components/chat/ToolCallCard';
import { ToolElapsed } from '../components/chat/ToolRunStatus';
import { TurnNavigator, type ChatTurn } from '../components/chat/TurnNavigator';
import { activeChatProcessId, buildChatRenderItems, isChatTimelineEntry, isChatToolEntry, latestIncomingEntryIds, sortChatEntries } from '../components/conversationTimeline';
import type { ChatRenderItem } from '../components/conversationTimeline';
import { awaitedBackgroundTasks, type BackgroundTask } from '@todex/protocol/conversationRuntime';
import { EFFORT_TEXT, ModelReasoningCard } from '../components/ModelReasoningCard';
import { ProviderIcon } from '../components/ProviderIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import {
  conversationPermissionCapabilities,
  PERMISSION_MODES,
  attachmentId,
  canSwitchConversationAgent,
  inferMimeType,
  isImageMimeType,
  isStepProgressEntry,
  isReadOnlyConversation,
  isV2Conversation,
  liveComposerAttachments,
  MAX_COMPOSER_ATTACHMENTS,
  SLASH_COMMANDS,
  attachmentToken,
  composerTokenPattern,
  findMentionTrigger,
  insertMention,
  tokenSafeName,
  canonicalSlashCommand,
  modelDisplayLabel,
  reasoningEffortLabel,
  referencePreview,
  referenceToken,
  uniqueAttachmentName,
  workspaceLinkTarget,
  STREAMING_REPLY_PLACEHOLDER,
  canAutoLoadEarlierHistory,
  isListedConversation,
  type ComposerAttachmentDraft,
  type MentionTrigger,
  type TimelineEntry,
} from '../session/helpers';
import { selectionInside } from '../lib/selection';
import { quotaLimits, quotaMessage } from '../session/quota';
import { backendApi } from '../session/helpers';
import { findCapabilityHashTrigger, insertCapabilityReference, normalizeReasoningEffort } from '@todex/protocol/todex';
import { buildCapabilitySuggestions, capabilityCatalogsPending, type CapabilitySuggestion } from '@todex/protocol/capabilityCatalog';
import {
  buildCapabilityReferenceSuggestions,
  buildAppReferenceSuggestions,
  buildChatReferenceSuggestions,
  buildEntryReferenceSuggestions,
  buildReferenceTypeSuggestions,
  buildSshReferenceSuggestions,
  referenceMenuState,
  TYPED_ENTRY_FETCH_LIMIT,
  type ReferenceSuggestion,
  type ReferenceType,
} from '@todex/protocol/referenceMenu';
import type { SshHost } from '@todex/protocol/ssh';
import type { HostApp } from '@todex/protocol/agentDesktop';
import { ConnectionError } from '@todex/protocol/connectionError';
import { describeToolCall, type ToolCallKind } from '@todex/protocol/toolPresentation';
import { agentCallingToolFromName, agentCallingToolSummary, type AgentCallingTool } from '@todex/protocol/agentCalling';
import { isThinkingProgressEntry } from '@todex/protocol/mobileParity';
import { getLocale, t, useT, type MessageKey } from '../i18n';
import { useConversationRuntime, useConversationTimeline } from '../session/conversationStore';
import { ErrorBoundary } from '@/components/ui/error-boundary';

type Props = {
  session: TodeXSession;
};

const REFERENCE_TYPE_KEYS = {
  file: 'chat.referenceTypeFile',
  folder: 'chat.referenceTypeFolder',
  chat: 'chat.referenceTypeChat',
  skill: 'chat.referenceTypeSkill',
  mcp: 'chat.referenceTypeMcp',
  ssh: 'chat.referenceTypeSsh',
  app: 'chat.referenceTypeApp',
} as const satisfies Record<ReferenceType, string>;

/** Why a turn without a user message began (`TimelineEntry.providerTrigger`). */
const PROVIDER_TURN_NOTICES = {
  background_task: 'chat.providerTurn.backgroundTask',
  wakeup: 'chat.providerTurn.wakeup',
  cron: 'chat.providerTurn.cron',
  unknown: 'chat.providerTurn.backgroundTask',
} as const satisfies Record<NonNullable<TimelineEntry['providerTrigger']>, string>;

/** Provider notices shown as one quiet line (`TimelineEntry.providerNotice`). */
const PROVIDER_NOTICES = {
  auto_mode_unavailable: 'chat.providerNotice.autoModeUnavailable',
  background_tasks_ended: 'chat.providerNotice.backgroundTasksEnded',
  bypass_mode_disabled: 'chat.providerNotice.bypassModeDisabledNoLayer',
} as const satisfies Record<NonNullable<TimelineEntry['providerNotice']>, MessageKey>;

/** Why background work was lost (`background_tasks_ended`'s `reason`, the
 * notice's subtitle); anything else reads as the process having ended. */
const BACKGROUND_ENDED_REASONS: Record<string, MessageKey> = {
  settings_changed: 'chat.backgroundEnded.settingsChanged',
  daemon_restarted: 'chat.backgroundEnded.daemonRestarted',
  stopped: 'chat.backgroundEnded.stopped',
  evicted: 'chat.backgroundEnded.evicted',
  expired: 'chat.backgroundEnded.expired',
};

/** Claude Code settings layers a permission notice can name
 * (`metadata.settingsSource`); an unknown layer is shown as reported. */
const SETTINGS_SOURCES: Record<string, MessageKey> = {
  userSettings: 'chat.settingsSource.userSettings',
  projectSettings: 'chat.settingsSource.projectSettings',
  localSettings: 'chat.settingsSource.localSettings',
  policySettings: 'chat.settingsSource.policySettings',
  flagSettings: 'chat.settingsSource.flagSettings',
};

/** `agent` names the conversation's agent (Claude Code, Pi, …). */
function providerNoticeText(notice: NonNullable<TimelineEntry['providerNotice']>, entry: TimelineEntry, agent: string): string {
  const source = entry.providerNoticeSettingsSource;
  const layer = source ? (SETTINGS_SOURCES[source] ? t(SETTINGS_SOURCES[source]) : source) : '';
  switch (notice) {
    case 'background_tasks_ended':
      return t(PROVIDER_NOTICES[notice], { agent, reason: t(BACKGROUND_ENDED_REASONS[entry.subtitle] ?? 'chat.backgroundEnded.processEnded', { agent }) });
    case 'auto_mode_unavailable':
      // Older backends send no cause; they keep the generic wording.
      if (entry.providerNoticeCause !== 'settings') return t(PROVIDER_NOTICES[notice]);
      return layer
        ? t('chat.providerNotice.autoModeDisabledBySettings', { agent, layer, ask: t('chat.permissionAsk') })
        : t('chat.providerNotice.autoModeDisabledBySettingsNoLayer', { agent, ask: t('chat.permissionAsk') });
    case 'bypass_mode_disabled':
      return layer ? t('chat.providerNotice.bypassModeDisabled', { agent, layer }) : t(PROVIDER_NOTICES[notice], { agent });
  }
}

/** Images up to this size also keep a local copy for the preview and the
 * sent-message thumbnail; every file is uploaded regardless. */
const MAX_COMPOSER_IMAGE_BYTES = 2_500_000;
/** Text files up to this size keep their text for the preview, and travel
 * inline when the backend predates uploads. */
const MAX_COMPOSER_TEXT_BYTES = 512 * 1024;
const HYDRATE_DEBOUNCE_MS = 200;
const SUPPORTED_COMPOSER_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** A row that mounts while a turn runs blurs in like a streaming line (BoardUI AI chat). */
const ENTRANCE_EASE = [0.25, 0.1, 0.25, 1] as const;
/** Rows already on screen when a conversation opens stay still; later rows animate. */
const ENTRANCE_ARM_DELAY_MS = 600;

const OPTION_ICON = 'size-5 shrink-0 text-foreground-icon-secondary';

function isSupportedComposerImage(mimeType: string): boolean {
  return SUPPORTED_COMPOSER_IMAGE_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

function isTextFile(file: File): boolean {
  return file.type.startsWith('text/') || /\.(md|mdx|txt|json|ya?ml|toml|csv|tsv|tsx?|jsx?|css|html?|xml|svg|sh|py|rs|go|java|kt|swift)$/i.test(file.name);
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(t('chat.readImageFailed')));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  });
}

/** Dropped files, and how many dropped folders were left out. */
function droppedFiles(data: DataTransfer): { files: File[]; folders: number } {
  const files: File[] = [];
  let folders = 0;
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      folders += 1;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files.length > 0 || folders > 0 ? { files, folders } : { files: Array.from(data.files), folders: 0 };
}

/** What a backend without `/v2/uploads` gets in the prompt instead of a path:
 * a small supported image or text file inline, as before uploads existed. */
async function inlineAttachmentContent(attachment: ComposerAttachmentDraft, blob: Blob): Promise<Partial<ComposerAttachmentDraft> | null> {
  if (attachment.kind === 'image') {
    if (!isSupportedComposerImage(attachment.mimeType) || blob.size > MAX_COMPOSER_IMAGE_BYTES) return null;
    return { dataUrl: attachment.dataUrl || await readFileAsDataUrl(blob) };
  }
  if (blob.size > MAX_COMPOSER_TEXT_BYTES) return null;
  if (attachment.textContent !== undefined) return { textContent: attachment.textContent };
  return attachment.mimeType.startsWith('text/') ? { textContent: await blob.text() } : null;
}

function clipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.items)
    .filter((item) => item.kind === 'file')
    .flatMap((item) => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
  return files.length > 0 ? files : Array.from(data.files);
}

function attachmentName(file: File, index: number, mimeType: string, source: 'clipboard' | 'file'): string {
  if (file.name.trim()) return file.name;
  const extension = mimeType === 'image/jpeg' ? 'jpg'
    : mimeType === 'image/gif' ? 'gif'
      : mimeType === 'image/webp' ? 'webp'
        : mimeType === 'image/png' ? 'png'
          : 'bin';
  return `${source === 'clipboard' ? 'pasted' : 'attachment'}-${index + 1}.${extension}`;
}

function toolKindLabel(kind: ToolCallKind): string {
  switch (kind) {
    case 'command': return t('chat.toolCommand');
    case 'fileChange': return t('chat.toolFileChange');
    case 'webSearch': return t('chat.toolWebSearch');
    default: return t('chat.toolCall');
  }
}

const AGENT_CALLING_TOOL_LABELS: Record<AgentCallingTool, MessageKey> = {
  agents_list: 'chat.agentToolList',
  agent_run: 'chat.agentToolRun',
  agent_turn: 'chat.agentToolTurn',
  agent_wait: 'chat.agentToolWait',
  agent_cancel: 'chat.agentToolCancel',
};

/** Tool rows name the tool and show its key argument (command, path, query)
 * without expanding; arguments, output and errors stay in the body. A call
 * that launched a background task the agent still waits on (`background`)
 * reads as running although the call itself returned at once. */
function toolCardPresentation(entry: TimelineEntry, active: boolean, background = false) {
  const tool = describeToolCall(entry.subtitle);
  const state: ToolCallState = tool.status === 'failed' ? 'failed'
    : background ? 'running'
      : tool.status === 'completed' || entry.phase === 'completed' || !active ? 'completed'
        : 'running';
  // A failed call without its own error text surfaces its output as the error.
  const outputIsError = state === 'failed' && !tool.errorText;
  // Agent Calling tools (`mcp__todex_agents__*`) read as what they do.
  const agentTool = agentCallingToolFromName(tool.name);
  return {
    label: agentTool ? t(AGENT_CALLING_TOOL_LABELS[agentTool]) : tool.name || toolKindLabel(tool.kind),
    summary: agentTool ? agentCallingToolSummary(tool.argsText) || tool.summary : tool.summary,
    argsText: tool.argsText,
    output: outputIsError ? undefined : tool.outputText,
    errorText: state === 'failed' ? (tool.errorText ?? tool.outputText) : undefined,
    state,
  };
}

/** Elapsed time in the header of a tool row or the folded group holding it. */
function toolElapsed(entry: TimelineEntry, running: boolean) {
  return <ToolElapsed startedAt={entry.firstAt} endedAt={entry.at} running={running} />;
}

/** Whether `entry` is the tool call that launched one of the awaited
 * background tasks (`ids` holds their `toolUseId`s, a call's block id). */
function launchesBackgroundTask(entry: TimelineEntry, ids: ReadonlySet<string>): boolean {
  if (!ids.size) return false;
  if (entry.blockId && ids.has(entry.blockId)) return true;
  for (const id of ids) if (entry.id.endsWith(`-${id}`)) return true;
  return false;
}
const NO_BACKGROUND_TOOLS: ReadonlySet<string> = new Set();

function backgroundTaskKind(taskType: string | undefined): string {
  if (taskType === 'local_bash') return t('chat.backgroundTaskShell');
  if (taskType?.includes('remote')) return t('chat.backgroundTaskRemoteAgent');
  if (taskType?.includes('agent')) return t('chat.backgroundTaskAgent');
  return '';
}

/** The trailing "waiting for background tasks" line, expandable into the
 * tasks the provider still runs and, when loaded, the tool call that
 * launched each (`toolUseId` is that call's block id). */
function BackgroundTasksStatus({ tasks, items }: { tasks: readonly BackgroundTask[]; items: readonly ChatRenderItem[] }) {
  const launchers = useMemo(() => {
    const wanted = tasks.flatMap(task => task.toolUseId ? [task.toolUseId] : []);
    const found = new Map<string, TimelineEntry>();
    if (!wanted.length) return found;
    for (const item of items) {
      for (const entry of item.type === 'entry' ? [item.entry] : item.entries) {
        if (!isChatToolEntry(entry) || entry.detailStub) continue;
        const id = wanted.find(toolUseId => entry.blockId === toolUseId || entry.id.endsWith(`-${toolUseId}`));
        if (id) found.set(id, entry);
      }
    }
    return found;
  }, [tasks, items]);
  return (
    <ProcessDisclosure running icon={RiTimerLine} title={t('chat.waitingBackground', { count: tasks.length })}>
      <ProcessSteps>
        {tasks.map((task, index) => {
          const launcher = task.toolUseId ? launchers.get(task.toolUseId) : undefined;
          const tool = launcher ? toolCardPresentation(launcher, true, true) : undefined;
          const startedAt = task.startedAt ? new Date(task.startedAt) : null;
          const meta = [
            backgroundTaskKind(task.taskType),
            startedAt && !Number.isNaN(startedAt.getTime())
              ? t('chat.backgroundTaskStartedAt', { time: startedAt.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) })
              : '',
          ].filter(Boolean).join(' · ');
          return (
            <ProcessStep key={task.taskId} last={index === tasks.length - 1}>
              <div className="flex min-w-0 flex-col gap-0.5 py-1">
                <p className="text-body-regular text-text-secondary wrap-anywhere">{task.description || tool?.summary || task.taskId}</p>
                {meta ? <p className="text-caption-1-regular text-text-tertiary">{meta}</p> : null}
                {tool ? (
                  <ToolCallCard
                    state={tool.state}
                    title={tool.summary || tool.label}
                    argsText={tool.argsText}
                    output={tool.output}
                    errorText={tool.errorText}
                  />
                ) : null}
              </div>
            </ProcessStep>
          );
        })}
      </ProcessSteps>
    </ProcessDisclosure>
  );
}

function permissionModeLabel(mode: PermissionMode): string {
  switch (mode) {
    case 'ask': return t('chat.permissionAsk');
    case 'accept-edits': return t('chat.permissionAcceptEdits');
    case 'auto': return t('chat.permissionAuto');
    case 'full-access': return t('chat.permissionFullAccess');
    // A mode a newer backend reports that this client cannot label: show it
    // as is rather than as some other, possibly broader, mode.
    default: return String(mode);
  }
}

function permissionModeIcon(mode: PermissionMode): ReactNode {
  switch (mode) {
    case 'ask': return <RiGitMergeLine aria-hidden className={cx(OPTION_ICON, '-scale-y-100')} />;
    case 'accept-edits': return <RiEditLine aria-hidden className={OPTION_ICON} />;
    case 'auto': return <RiSpeedUpLine aria-hidden className={OPTION_ICON} />;
    case 'full-access': return <RiShieldCheckLine aria-hidden className={OPTION_ICON} />;
    default: return <RiShieldLine aria-hidden className={OPTION_ICON} />;
  }
}

// Localized equivalent of progressGroupLabel from @todex/protocol/mobileParity.
function progressGroupLabel(entries: readonly { category?: string }[], active: boolean, pendingCount = 0): string {
  if (pendingCount > 0) return t('chat.pendingApproval');
  if (!active) return t('chat.workProcess');
  const latestCategory = entries[entries.length - 1]?.category;
  if (latestCategory === 'reasoning') return t('chat.thinking');
  if (latestCategory === 'tool' || latestCategory === 'approval') return t('chat.executing');
  return t('chat.working');
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat(getLocale(), { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function isImeCompositionKey(event: KeyboardEvent): boolean {
  // WebKit may expose an active IME key as 229 even when isComposing is false.
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

function isChatReminderEntry(entry: { subtitle: string; title: string }): boolean {
  return entry.subtitle.includes('本地会话启动超时')
    || entry.title === '本地会话启动超时'
    || entry.subtitle.trim() === 'codex.local.start';
}

// Plan quota per provider, shared by every composer for a minute so opening
// the context popover does not refetch on each click.
const QUOTA_CACHE_MS = 60_000;
let quotaCache: { at: number; providers: Record<string, ProviderQuotaSnapshot> } | null = null;

/** Context meter in the composer-panel recipe: a 16px ring that opens the
 * BoardUI agent-limits card with the conversation's context window and the
 * current agent's plan limits. */
function ContextUsageIndicator({
  session,
  provider,
  usedTokens,
  contextWindow,
  inputTokens,
  outputTokens,
  cachedInputTokens,
  cacheWriteTokens,
}: {
  session: TodeXSession;
  provider?: string;
  usedTokens: number;
  contextWindow?: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [quota, setQuota] = useState<ProviderQuotaSnapshot | null | undefined>(undefined);
  const percent = contextWindow ? Math.min(100, Math.max(0, usedTokens / contextWindow * 100)) : null;
  // Split the window into its buckets when they add up to the used total:
  // Anthropic counts cache beside input, while other providers fold cached
  // input into it. Otherwise the counters are listed without a share.
  const cached = cachedInputTokens + cacheWriteTokens;
  const freshInput = inputTokens + outputTokens + cached === usedTokens ? inputTokens
    : inputTokens >= cached && inputTokens + outputTokens === usedTokens ? inputTokens - cached : null;
  const segments = freshInput === null ? [
    { label: t('usage.quotaContextUsed'), tokens: usedTokens },
    { label: t('usage.inputLabel'), tokens: inputTokens, deferred: true },
    { label: t('usage.outputLabel'), tokens: outputTokens, deferred: true },
    { label: t('usage.cacheReadLabel'), tokens: cachedInputTokens, deferred: true },
    { label: t('usage.cacheWriteLabel'), tokens: cacheWriteTokens, deferred: true },
  ] : [
    { label: t('usage.cacheReadLabel'), tokens: cachedInputTokens },
    { label: t('usage.cacheWriteLabel'), tokens: cacheWriteTokens },
    { label: t('usage.inputLabel'), tokens: freshInput },
    { label: t('usage.outputLabel'), tokens: outputTokens },
  ];
  const progress = percent ?? 0;
  const circumference = 2 * Math.PI * 6;

  useEffect(() => {
    if (!open || !provider) return;
    let cancelled = false;
    const pick = (providers: Record<string, ProviderQuotaSnapshot>) => { if (!cancelled) setQuota(providers[provider] ?? null); };
    if (quotaCache && Date.now() - quotaCache.at < QUOTA_CACHE_MS) {
      pick(quotaCache.providers);
    } else {
      backendApi(session.settings).getProviderQuotas()
        .then((response) => {
          quotaCache = { at: Date.now(), providers: response.providers ?? {} };
          pick(quotaCache.providers);
        })
        .catch(() => { if (!cancelled) setQuota(null); });
    }
    return () => { cancelled = true; };
  }, [open, provider, session.settings.serverUrl, session.settings.deviceSecret]);

  const descriptor = session.v2Providers.find((item) => item.id === provider);
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger
        aria-label={percent === null ? t('chat.contextPending') : t('chat.contextUsed', { percent: percent.toFixed(1) })}
        className="flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-150 ease hover:bg-background-primary-hover"
      >
        <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="-rotate-90">
          <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2.5" className="stroke-border-button-default" />
          {progress > 0 ? (
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${(progress / 100) * circumference} ${circumference}`}
              className="stroke-foreground-icon-secondary"
            />
          ) : null}
        </svg>
      </DropdownTrigger>
      <DropdownPopover aria-label={t('chat.contextTitle')} placement="top end" offset={8} className="w-[360px] p-1.5">
        <AgentLimitsCard
          title={(
            <>
              {provider ? <ProviderIcon provider={provider} className="size-4" /> : null}
              <span className="truncate text-body-medium text-text-primary">{descriptor?.displayName ?? (provider ? providerDisplayName(provider) : t('chat.contextTitle'))}</span>
              {percent === null ? <span className="ms-auto shrink-0 text-caption-1-regular text-text-tertiary">{t('chat.contextWaiting')}</span> : null}
            </>
          )}
          context={contextWindow ? { max: contextWindow, segments } : undefined}
          defaultExpanded
          plan={quota?.planType ?? undefined}
          limits={quota ? quotaLimits(quota) : []}
          emptyMessage={quota === undefined ? t('usage.quotaLoading') : quota ? quotaMessage(quota) : t('usage.quotaUnsupported')}
          labels={{ context: t('chat.contextTitle'), limits: t('usage.quotaPlanLimits'), free: t('usage.quotaContextFree') }}
        />
      </DropdownPopover>
    </Dropdown>
  );
}

const COPY_CONFIRM_MS = 1600;

function AgentMessageActions({
  conversationId,
  entry,
  session,
}: {
  conversationId: string;
  entry: { id: string; subtitle: string; at: number; turnId?: string };
  session: TodeXSession;
}) {
  const t = useT();
  const conversation = session.conversations.find(item => item.id === conversationId);
  const provider = session.v2Providers.find(item => item.id === conversation?.provider);
  const canFork = provider?.capabilities.controlActions?.includes('fork') === true;
  // Legacy plaintext history is read-only and can never be forked.
  const readOnly = isReadOnlyConversation(conversation);
  const records = entry.turnId ? session.usageRecords.filter(record =>
    (record.conversationId === conversationId || record.conversationId === conversation?.v2ConversationId)
    && record.turnId === entry.turnId) : [];
  // The copy tooltip is held open to confirm, then dismissed even if the
  // pointer never left the button.
  const [copied, setCopied] = useState(false);
  const [copyTooltipOpen, setCopyTooltipOpen] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);
  const copy = () => {
    void navigator.clipboard.writeText(entry.subtitle)
      .then(() => {
        if (copyTimer.current) clearTimeout(copyTimer.current);
        setCopied(true);
        setCopyTooltipOpen(true);
        copyTimer.current = setTimeout(() => {
          setCopied(false);
          setCopyTooltipOpen(false);
        }, COPY_CONFIRM_MS);
      })
      .catch(() => toast.danger(t('chat.copyFailed')));
  };

  return (
    <div className="flex items-center gap-1.5 pt-0.5">
      <FeedbackButton
        label={t('chat.copyReply')}
        tooltip={copied ? t('chat.replyCopied') : undefined}
        isTooltipOpen={copyTooltipOpen}
        onTooltipOpenChange={setCopyTooltipOpen}
        onPress={copy}
      >
        <CopyGlyph copied={copied} />
      </FeedbackButton>
      {readOnly ? null : (
        <FeedbackButton
          icon={RiGitBranchLine}
          label={t('chat.forkConversation')}
          tooltip={canFork ? undefined : t('chat.forkUnsupported')}
          disabled={!canFork}
          onPress={() => session.forkConversation(conversationId)}
        />
      )}
      <FeedbackButton icon={RiBarChartBoxLine} label={t('chat.replyStats')} tooltip={<TurnUsageSummary records={records} />} />
    </div>
  );
}

/** Wraps a timeline row; a row that mounts during a live turn blurs in. */
function RowEntrance({ enter, className, children, ...props }: { enter: boolean; className?: string; children: ReactNode } & Omit<ComponentProps<'div'>, 'children' | 'className' | 'ref'>) {
  const reduce = useReducedMotion() ?? false;
  const [animate] = useState(enter && !reduce);
  return (
    <motion.div
      {...(props as ComponentProps<typeof motion.div>)}
      initial={animate ? { opacity: 0, y: 6, filter: 'blur(4px)' } : false}
      animate={animate ? { opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } } : undefined}
      transition={{ duration: 0.45, ease: ENTRANCE_EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

type ChatTimelineItemProps = {
  item: ChatRenderItem;
  conversationId: string;
  /** The conversation's agent, as notices about its own work name it. */
  agentName: string;
  thinking: boolean;
  isStreamingGroup: boolean;
  /** `toolUseId`s of the background tasks the agent still waits on. */
  backgroundToolIds: ReadonlySet<string>;
  groupExpanded: boolean;
  groupLoadState: 'loading' | 'error' | undefined;
  groupPendingCount: number;
  request: TodeXSession['pendingRequests'][number] | undefined;
  isActionable: boolean;
  isPendingReply: boolean;
  markdownComponents: MarkdownComponents;
  onHydrateGroup: TodeXSession['hydrateProcessGroup'];
  onApprove: TodeXSession['sendApprovalResponse'];
  setExpandedProcessIds: Dispatch<SetStateAction<Set<string>>>;
  setProcessGroupLoad: Dispatch<SetStateAction<Record<string, 'loading' | 'error'>>>;
  // Excluded from the memo comparison: only read when the row mounts.
  animateEntrance: boolean;
  // Excluded from the memo comparison: its members are stable useCallbacks,
  // and the stats AgentMessageActions reads self-correct on the next entry
  // update.
  session: TodeXSession;
};

function chatRenderItemKey(item: ChatRenderItem): string {
  return item.type === 'executionGroup' ? item.id : item.entry.id;
}

// Timeline entries keep object identity while unchanged, so an element-wise
// comparison of a group's entries is enough to detect real updates.
function chatRowItemEqual(prev: ChatRenderItem, next: ChatRenderItem): boolean {
  if (prev.type !== next.type) return false;
  if (prev.type === 'executionGroup' && next.type === 'executionGroup') {
    return prev.id === next.id
      && prev.entries.length === next.entries.length
      && prev.entries.every((entry, index) => entry === next.entries[index]);
  }
  if (prev.type === 'entry' && next.type === 'entry') return prev.entry === next.entry;
  return false;
}

// Memo boundary per timeline row: during live streaming only the rows the
// event touched re-render, instead of re-parsing every markdown body in the
// conversation on each socket batch.
const ChatTimelineItem = memo(function ChatTimelineItem({
  item,
  conversationId,
  agentName,
  thinking,
  isStreamingGroup,
  backgroundToolIds,
  groupExpanded,
  groupLoadState,
  groupPendingCount,
  request,
  isActionable,
  isPendingReply,
  markdownComponents,
  onHydrateGroup,
  onApprove,
  setExpandedProcessIds,
  setProcessGroupLoad,
  animateEntrance,
  session,
}: ChatTimelineItemProps) {
  const t = useT();
  // Folded-group detail fetches are debounced and single-flight per group:
  // rapid toggles coalesce into one request, and a started request keeps
  // running after the group folds again so the content is already merged
  // back when the user expands it next.
  const detailFetchRef = useRef<{ timer?: ReturnType<typeof setTimeout>; inflight?: boolean }>({});
  const itemRef = useRef(item);
  itemRef.current = item;
  useEffect(() => () => {
    const control = detailFetchRef.current;
    if (control.timer) clearTimeout(control.timer);
  }, []);
  if (item.type === 'executionGroup') {
    const hasStubs = item.entries.some((entry) => entry.detailStub);
    /** Folded groups fetched as summary stubs load their full events on expand;
     * a failed load keeps a retryable error state per group. */
    const requestDetails = () => {
      const control = detailFetchRef.current;
      if (control.inflight || control.timer) return;
      control.timer = setTimeout(() => {
        control.timer = undefined;
        const latest = itemRef.current;
        if (latest.type !== 'executionGroup') return;
        // A folded row merges several stubs; fetch everything it was built from.
        const ranges = latest.entries
          .filter((entry) => entry.detailStub && (entry.sequence ?? 0) > 0)
          .map((entry): [number, number] => [entry.firstSequence ?? entry.sequence!, entry.sequence!]);
        if (!ranges.length) return;
        control.inflight = true;
        setProcessGroupLoad((current) => ({ ...current, [item.id]: 'loading' }));
        void onHydrateGroup(conversationId, ranges)
          .then((hydrated) => setProcessGroupLoad((current) => {
            const next = { ...current };
            if (hydrated) delete next[item.id];
            else next[item.id] = 'error';
            return next;
          }))
          .catch(() => setProcessGroupLoad((current) => ({ ...current, [item.id]: 'error' })))
          .finally(() => { control.inflight = false; });
      }, HYDRATE_DEBOUNCE_MS);
    };
    const lastIndex = item.entries.length - 1;
    // A folded group hides its steps; its header carries the running tool's
    // elapsed time instead.
    const lastEntry = item.entries[lastIndex];
    const foldedElapsed = !groupExpanded && lastEntry && isChatToolEntry(lastEntry)
      && toolCardPresentation(lastEntry, isStreamingGroup, launchesBackgroundTask(lastEntry, backgroundToolIds)).state === 'running'
      ? toolElapsed(lastEntry, true) : undefined;
    return (
      <RowEntrance enter={animateEntrance}>
        <ProcessDisclosure
          icon={RiListCheck3}
          title={progressGroupLabel(item.entries, isStreamingGroup, groupPendingCount)}
          running={isStreamingGroup}
          meta={foldedElapsed}
          expanded={groupExpanded}
          onExpandedChange={(nextExpanded) => {
            if (nextExpanded && hasStubs) requestDetails();
            setExpandedProcessIds((current) => {
              const next = new Set(current);
              if (nextExpanded) next.add(item.id);
              else next.delete(item.id);
              return next;
            });
          }}
        >
          {!groupExpanded ? null : hasStubs ? (
            groupLoadState === 'error' ? (
              <button
                type="button"
                className="cursor-pointer rounded-md px-1 py-0.5 text-caption-1-regular text-text-error-primary outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                onClick={requestDetails}
              >
                {t('chat.processLoadFailed')}
              </button>
            ) : (
              <p className="flex items-center gap-1.5 px-1 py-0.5 text-caption-1-regular text-text-tertiary">
                <Spinner size="xs" />
                {t('chat.processLoading')}
              </p>
            )
          ) : (
            <ProcessSteps>
              {item.entries.map((entry, index) => {
                const last = index === lastIndex;
                if (!isChatToolEntry(entry)) {
                  // The protocol titles every reasoning row "思考中", even after
                  // the turn ends; only the step still streaming is thinking.
                  const streaming = isStreamingGroup && last;
                  const label = isThinkingProgressEntry(entry)
                    ? t(streaming ? 'progress.thinking' : 'progress.thought')
                    : entry.title;
                  return (
                    <ProcessStep key={entry.id} last={last}>
                      <div className="flex min-w-0 flex-col gap-0.5 py-1">
                        <span className="text-body-regular text-text-secondary">{streaming ? <ShimmerText>{label}</ShimmerText> : label}</span>
                        <p className="max-w-full overflow-x-auto whitespace-pre-wrap wrap-anywhere text-caption-1-regular text-text-tertiary">{entry.subtitle || entry.title}</p>
                      </div>
                    </ProcessStep>
                  );
                }
                const tool = toolCardPresentation(entry, isStreamingGroup, launchesBackgroundTask(entry, backgroundToolIds));
                return (
                  <ProcessStep key={entry.id} last={last}>
                    <ToolCallCard
                      state={tool.state}
                      meta={toolElapsed(entry, tool.state === 'running')}
                      title={tool.summary ? `${tool.label} · ${tool.summary}` : tool.label}
                      argsText={tool.argsText}
                      output={tool.output}
                      errorText={tool.errorText}
                    />
                  </ProcessStep>
                );
              })}
            </ProcessSteps>
          )}
        </ProcessDisclosure>
      </RowEntrance>
    );
  }
  const entry = item.entry;
  // End-to-end encrypted history this device holds no key for: one quiet
  // line per turn (docs/history-encryption.md §5.3).
  if (entry.detailLocked) {
    return <p data-message-id={entry.id} role="note" className="py-1 text-center text-caption-1-regular text-text-tertiary">{t('chat.historyLocked')}</p>;
  }
  // A turn the agent started on its own (a background task finished, a
  // wakeup fired) has no user message: one quiet line says why it began.
  if (entry.providerTrigger) {
    return (
      <p data-message-id={entry.id} role="note" title={entry.subtitle || undefined} className="py-1 text-center text-caption-1-regular text-text-tertiary">
        {t(PROVIDER_TURN_NOTICES[entry.providerTrigger], { agent: agentName })}
      </p>
    );
  }
  if (entry.providerNotice) {
    return (
      <p data-message-id={entry.id} role="note" title={entry.subtitle || undefined} className="py-1 text-center text-caption-1-regular text-text-tertiary">
        {providerNoticeText(entry.providerNotice, entry, agentName)}
      </p>
    );
  }
  if (isChatToolEntry(entry)) {
    const tool = toolCardPresentation(entry, thinking, launchesBackgroundTask(entry, backgroundToolIds));
    return (
      <RowEntrance enter={animateEntrance}>
        <ToolCallCard
          state={tool.state}
          meta={toolElapsed(entry, tool.state === 'running')}
          prefix={(thinking ? t('chat.toolCalling') : t('chat.toolCalled')).trim()}
          title={tool.summary ? `${tool.label} · ${tool.summary}` : tool.label}
          argsText={tool.argsText}
          output={tool.output}
          errorText={tool.errorText}
        />
      </RowEntrance>
    );
  }
  // Progress narration renders like a normal message; empty detail stubs hide.
  if (entry.category === 'assistant_progress' && !entry.subtitle.trim()) return null;
  const isUser = entry.kind === 'outgoing';
  const placeholder = entry.subtitle === STREAMING_REPLY_PLACEHOLDER;
  return (
    <RowEntrance
      enter={animateEntrance}
      data-message-id={entry.id}
      className={cx('flex min-w-0 flex-col gap-2 py-1', isUser ? 'items-end' : 'items-start')}
    >
      {entry.category === 'extension' ? <p className="text-caption-1-medium text-text-tertiary">{t('chat.piExtensionEntry', { title: entry.title })}</p> : null}
      {isUser ? (
        <>
          {entry.sentAttachments?.length ? <SentAttachmentList attachments={entry.sentAttachments} /> : null}
          {entry.subtitle ? (
            <div className="w-fit max-w-[85%] rounded-2xl bg-background-primary-default px-3 py-[11px] text-start text-body-regular text-text-primary shadow-card">
              <p className="whitespace-pre-wrap wrap-anywhere">{placeholder ? t('chat.replying') : entry.subtitle}</p>
            </div>
          ) : null}
        </>
      ) : placeholder ? (
        <p className="text-body-regular text-text-secondary"><ShimmerText>{t('chat.replying')}</ShimmerText></p>
      ) : (
        <Markdown id={entry.id} components={markdownComponents} className="w-full min-w-0 text-body-regular text-text-primary">
          {entry.subtitle}
        </Markdown>
      )}
      {entry.kind === 'incoming' && isActionable && !isPendingReply
        ? <AgentMessageActions conversationId={conversationId} entry={entry} session={session} />
        : null}
      {request ? (
        <div className="flex flex-wrap items-center gap-2">
          <ConversationPermissionActions request={request} deviceSecret={session.settings.deviceSecret} onSelect={(option, data) => { onApprove(option, request, data); }} />
        </div>
      ) : null}
    </RowEntrance>
  );
}, (prev, next) =>
  chatRowItemEqual(prev.item, next.item)
  && prev.conversationId === next.conversationId
  && prev.agentName === next.agentName
  && prev.thinking === next.thinking
  && prev.isStreamingGroup === next.isStreamingGroup
  && prev.backgroundToolIds === next.backgroundToolIds
  && prev.groupExpanded === next.groupExpanded
  && prev.groupLoadState === next.groupLoadState
  && prev.groupPendingCount === next.groupPendingCount
  && prev.request === next.request
  && prev.isActionable === next.isActionable
  && prev.isPendingReply === next.isPendingReply
  && prev.markdownComponents === next.markdownComponents
  && prev.onHydrateGroup === next.onHydrateGroup
  && prev.onApprove === next.onApprove);

/** One row that failed to render; the rest of the conversation stays usable. */
function RowRenderError() {
  const t = useT();
  return <p className="px-1 py-0.5 text-caption-1-regular text-text-tertiary">{t('chat.rowRenderFailed')}</p>;
}

/** Inserts `text` at the viewport point, as typing would (one undo step,
 * an input event for the editor). */
function insertPlainTextAt(x: number, y: number, text: string): void {
  const range = document.caretRangeFromPoint?.(x, y);
  const selection = window.getSelection();
  if (range && selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
  document.execCommand('insertText', false, text);
}

function isHttpUrl(href: string | undefined): boolean {
  try {
    const { protocol } = new URL(href?.trim() ?? '');
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function ChatPanel({ session }: Props) {
  const t = useT();
  const conversation = session.activeConversation;
  const workspace = session.activeWorkspace;
  const draft = conversation ? (session.chatDrafts[conversation.id] ?? '') : '';
  const composerRef = useRef<ReferenceComposerHandle>(null);
  // Attachment reads are async; insert against the live draft, not the render
  // that started the read.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const conversationIdRef = useRef(conversation?.id);
  conversationIdRef.current = conversation?.id;
  const composerSelectionRef = useRef(session.composerSelections[conversation?.id ?? '']);
  composerSelectionRef.current = session.composerSelections[conversation?.id ?? ''];
  const mention = findMentionTrigger(draft, conversation ? (session.composerSelections[conversation.id]?.end ?? draft.length) : 0);
  const capability = conversation ? findCapabilityHashTrigger(draft, session.composerSelections[conversation.id]?.end ?? draft.length) : null;
  // `@` and `#` can both parse when one wraps the other (`@file#x`); the
  // trigger closest to the caret wins.
  const mentionActive = Boolean(mention && (!capability || mention.start > capability.start));
  const capabilityActive = Boolean(capability && !mentionActive);
  // `@` opens a type menu; `@type:query` searches one type (see referenceMenu).
  const referenceState = mention ? referenceMenuState(mention.query) : null;
  const referenceType = referenceState?.stage === 'item' ? referenceState.type : null;
  const referenceQuery = referenceState?.stage === 'item' ? referenceState.query
    : referenceState?.stage === 'type' ? referenceState.prefix : '';
  // Workspace entries back an untyped `@query` (the old file search) and the
  // `@file:` / `@folder:` lists.
  const entryMode = referenceState?.stage === 'type' ? (referenceState.prefix ? 'any' : null)
    : referenceType === 'file' || referenceType === 'folder' ? referenceType : null;
  const [entryResults, setEntryResults] = useState<{ mode: string; query: string; items: ReferenceSuggestion[]; truncated: boolean }>(
    { mode: '', query: '', items: [], truncated: false });
  const [mentionSearchPending, setMentionSearchPending] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const suggestionsPopoverRef = useRef<HTMLDivElement>(null);
  const [expandedProcessIds, setExpandedProcessIds] = useState<Set<string>>(() => new Set());
  const [processGroupLoad, setProcessGroupLoad] = useState<Record<string, 'loading' | 'error'>>({});
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false);
  /** Files kept for retrying a failed upload, by attachment id. */
  const uploadBlobsRef = useRef(new Map<string, Blob>());
  /** A drag that started inside the composer moves its own text. */
  const internalDragRef = useRef(false);
  // Let go of retry copies once their attachment is gone (sent or removed).
  useEffect(() => {
    const live = new Set(Object.values(session.composerAttachments).flat().map((item) => item.id));
    for (const id of uploadBlobsRef.current.keys()) if (!live.has(id)) uploadBlobsRef.current.delete(id);
  }, [session.composerAttachments]);
  const [previewAttachment, setPreviewAttachment] = useState<ComposerAttachmentDraft | null>(null);
  const isComposingRef = useRef(false);
  useEffect(() => {
    let active = true;
    if (!entryMode || !workspace) {
      setMentionSearchPending(false);
      return () => { active = false; };
    }
    setMentionSearchPending(true);
    // The backend has no kind filter: typed lists fetch more and filter here.
    const limit = entryMode === 'any' ? undefined : TYPED_ENTRY_FETCH_LIMIT;
    const settle = (items: ReferenceSuggestion[], truncated: boolean) => {
      if (!active) return;
      setEntryResults({ mode: entryMode, query: referenceQuery, items, truncated });
      setMentionSearchPending(false);
    };
    void session.fetchWorkspaceEntries(workspace.path, referenceQuery, limit)
      .then((result) => settle(
        buildEntryReferenceSuggestions(result.entries, entryMode === 'any' ? undefined : entryMode),
        limit !== undefined && result.entries.length >= limit))
      .catch(() => settle([], false));
    return () => { active = false; };
  }, [entryMode, referenceQuery, workspace?.path, session.fetchWorkspaceEntries]);
  // `@ssh:` hosts come from the backend once and are filtered client-side;
  // the list stays cached for the mounted panel.
  const [sshHosts, setSshHosts] = useState<SshHost[] | null>(null);
  useEffect(() => {
    let active = true;
    if (referenceType !== 'ssh' || sshHosts !== null) {
      return () => { active = false; };
    }
    void session.fetchSshHosts()
      .then((result) => { if (active) setSshHosts(result.hosts); })
      .catch(() => { if (active) setSshHosts([]); });
    return () => { active = false; };
  }, [referenceType, sshHosts, session.fetchSshHosts]);
  // `@app:` lists apps on the backend host the same way. A 409 means
  // Computer Use is off and a 404 a backend without the list; both show as
  // the empty text instead of an error.
  const [hostApps, setHostApps] = useState<{ apps: HostApp[]; empty?: 'off' | 'unsupported' | 'failed' } | null>(null);
  useEffect(() => {
    let active = true;
    if (referenceType !== 'app') {
      // Off and failed are retried on the next @app:, so turning Computer
      // Use on in Settings shows the list without reopening the panel.
      if (hostApps?.empty === 'off' || hostApps?.empty === 'failed') setHostApps(null);
      return () => { active = false; };
    }
    if (hostApps !== null) {
      return () => { active = false; };
    }
    void session.fetchHostApps()
      .then((result) => { if (active) setHostApps({ apps: result.apps }); })
      .catch((error: unknown) => {
        if (!active) return;
        const status = error instanceof ConnectionError ? error.httpStatus : undefined;
        if (status !== 409 && status !== 404) console.warn('Could not list backend apps', error);
        setHostApps({ apps: [], empty: status === 409 ? 'off' : status === 404 ? 'unsupported' : 'failed' });
      });
    return () => { active = false; };
  }, [referenceType, hostApps, session.fetchHostApps]);
  // Keyboard navigation keeps the active row centered inside the popover;
  // near the list edges scrollTop simply clamps at the boundary.
  useEffect(() => {
    const popover = suggestionsPopoverRef.current;
    const active = popover?.querySelector<HTMLElement>('.composer-suggestion-item--active');
    if (!popover || !active) return;
    const popRect = popover.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    popover.scrollTop += itemRect.top + itemRect.height / 2 - (popRect.top + popRect.height / 2);
  }, [suggestionIndex, draft]);
  // This conversation's rows (and runtime), from the session stores: they
  // keep their identity, and this panel does not re-render, while other
  // conversations stream.
  const conversationTimeline = useConversationTimeline(session.stores, conversation?.id);
  const conversationRuntime = useConversationRuntime(session.stores, conversation?.id);
  const chatEntries = useMemo(() => sortChatEntries(conversationTimeline
    .filter((entry) => isChatTimelineEntry(entry) && !isChatReminderEntry(entry))), [conversationTimeline]);
  const items = useMemo(() => buildChatRenderItems(chatEntries), [chatEntries]);
  const chatTurns = useMemo<ChatTurn[]>(() => items.flatMap((item) => (
    item.type === 'entry' && item.entry.kind === 'outgoing' ? [{ id: item.entry.id, preview: item.entry.subtitle.trim() }] : []
  )), [items]);
  const actionableIncoming = useMemo(() => latestIncomingEntryIds(chatEntries), [chatEntries]);
  const sentHistory = useMemo(() => {
    const texts: string[] = [];
    for (const entry of chatEntries) {
      if (entry.kind !== 'outgoing' || entry.subtitle === STREAMING_REPLY_PLACEHOLDER) continue;
      const text = entry.subtitle.trim();
      if (text && texts[texts.length - 1] !== text) texts.push(text);
    }
    return texts;
  }, [chatEntries]);
  const sentHistoryBrowseRef = useRef<{ conversationId: string; index: number; recalled: string } | null>(null);
  // Background tasks the agent still waits on; the calls that launched them
  // read as running.
  const runtimeBackgroundTasks = conversationRuntime?.backgroundTasks;
  const backgroundTasks = useMemo(() => awaitedBackgroundTasks(runtimeBackgroundTasks ?? []), [runtimeBackgroundTasks]);
  const backgroundToolIds = useMemo(() => {
    const ids = backgroundTasks.flatMap(task => task.toolUseId ? [task.toolUseId] : []);
    return ids.length ? new Set(ids) : NO_BACKGROUND_TOOLS;
  }, [backgroundTasks]);
  // Every loaded row stays mounted; only history that is not loaded yet pages
  // in, when the reader scrolls near the top.
  const oldestItemKey = items[0] ? chatRenderItemKey(items[0]) : '';
  const messagesRef = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState<{ text: string; left: number; top: number; messageId?: string } | null>(null);
  useEffect(() => {
    const update = () => {
      const container = messagesRef.current;
      const inside = container ? selectionInside(container) : null;
      if (!inside) {
        setQuote(null);
        return;
      }
      const anchor = window.getSelection()?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      const messageId = element?.closest('[data-message-id]')?.getAttribute('data-message-id') ?? undefined;
      setQuote({ ...inside, messageId });
    };
    const hide = () => setQuote(null);
    document.addEventListener('selectionchange', update);
    document.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('scroll', hide, true);
    };
  }, []);
  const workspacePath = workspace?.path;
  const markdownComponents = useMemo<MarkdownComponents>(() => ({
    ...baseMarkdownComponents,
    a: ({ href, children, node: _node, ref: _ref, ...props }) => {
      const target = workspaceLinkTarget(href, workspacePath);
      // Loopback pages open in the Workbench browser tab (where the host has
      // one) and workspace files in the Files preview; other http(s) links
      // open outside the app (a new browser tab, or the system browser).
      const external = !target && isHttpUrl(href);
      return (
        <a
          {...props}
          href={href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          onClick={(event) => {
            if (!target) return;
            event.preventDefault();
            if (target.kind === 'browser-url') {
              session.openPanel('Browser', { url: target.url });
            } else {
              session.openPanel('Files', { filePath: target.filePath });
            }
          }}
        >
          {children}
        </a>
      );
    },
  }), [workspacePath, session.openPanel]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastScrollRef = useRef({ top: 0, height: 0 });
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollToLatest = (behavior: ScrollBehavior = 'auto') => {
    const element = scrollRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior });
  };
  const earlierHistoryStatus = conversation?.id ? session.earlierHistory?.[conversation.id] : undefined;
  /** Records where the viewport sat before an earlier-history prepend so the
   * rendered rows can be shifted back onto the same content. */
  const historyAnchorRef = useRef<{ conversationId: string; scrollHeight: number; scrollTop: number; oldestEntryId: string } | null>(null);
  /** Automatic triggers skip a conversation whose last page failed; `retry`
   * is the explicit request that fetches it again. */
  const requestEarlierHistory = (retry = false) => {
    const element = scrollRef.current;
    if (!element || !conversation || historyAnchorRef.current) return;
    const anchor = {
      conversationId: conversation.id,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      oldestEntryId: oldestItemKey,
    };
    if (retry ? !earlierHistoryStatus?.failed || earlierHistoryStatus.loading : !canAutoLoadEarlierHistory(earlierHistoryStatus)) return;
    historyAnchorRef.current = anchor;
    void session.loadEarlierHistory(conversation.id);
  };
  // The turn being read: the last user message whose top has passed a line
  // just below the viewport top (the newest one once scrolled to the bottom).
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const updateActiveTurn = () => {
    const viewport = scrollRef.current;
    const list = messagesRef.current;
    if (!viewport || !list || chatTurns.length === 0) return;
    if (atBottomRef.current) {
      setActiveTurnId(chatTurns[chatTurns.length - 1].id);
      return;
    }
    const turnIds = new Set(chatTurns.map((turn) => turn.id));
    const line = viewport.getBoundingClientRect().top + 96;
    let current = chatTurns[0].id;
    for (const row of list.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const id = row.dataset.messageId ?? '';
      if (!turnIds.has(id)) continue;
      if (row.getBoundingClientRect().top > line) break;
      current = id;
    }
    setActiveTurnId(current);
  };
  /** Scrolls a mounted message to the top of the viewport; false when it is not mounted. */
  const scrollMessageToTop = (id: string) => {
    const viewport = scrollRef.current;
    const target = messagesRef.current?.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (!viewport || !target) return false;
    const offset = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    viewport.scrollTo({ top: viewport.scrollTop + offset - 16, behavior: 'smooth' });
    setActiveTurnId(id);
    return true;
  };
  const updateScrollPosition = () => {
    const element = scrollRef.current;
    if (!element) return;
    const previous = lastScrollRef.current;
    lastScrollRef.current = { top: element.scrollTop, height: element.scrollHeight };
    // Distance alone cannot tell a reader from the follow mode: a slow scroll
    // up stays inside the bottom band, so the next streamed event snapped it
    // back down. Any upward move by the reader leaves follow mode at once;
    // a shrinking scrollHeight clamps scrollTop without the reader moving.
    const scrolledUp = element.scrollTop < previous.top && element.scrollHeight >= previous.height;
    const atBottom = !scrolledUp && element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    atBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    if (element.scrollTop < 240) requestEarlierHistory();
    updateActiveTurn();
  };
  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current;
    const element = scrollRef.current;
    if (!element) return;
    if (anchor && anchor.conversationId === conversation?.id) {
      if (oldestItemKey !== anchor.oldestEntryId) {
        // Older rows mounted above the viewport: compensate by the height they
        // added so the visible content does not move.
        historyAnchorRef.current = null;
        element.scrollTop = anchor.scrollTop + (element.scrollHeight - anchor.scrollHeight);
      } else if (!earlierHistoryStatus?.loading) {
        // The page resolved without new rows (empty or fully deduplicated).
        historyAnchorRef.current = null;
      }
    }
    // Content shorter than the viewport, or a reader already parked at the
    // top, cannot produce another scroll event: fetch from here.
    if (canAutoLoadEarlierHistory(earlierHistoryStatus)
      && (element.scrollHeight <= element.clientHeight || (!atBottomRef.current && element.scrollTop < 240))) {
      requestEarlierHistory();
    }
  }, [conversationTimeline, oldestItemKey, earlierHistoryStatus?.loading, conversation?.id]);
  useEffect(() => {
    atBottomRef.current = true;
    lastScrollRef.current = { top: 0, height: 0 };
    setIsAtBottom(true);
    historyAnchorRef.current = null;
    scrollToLatest();
  }, [conversation?.id]);
  useEffect(() => {
    if (atBottomRef.current) scrollToLatest();
  }, [conversationTimeline]);
  useEffect(updateActiveTurn, [chatTurns]);
  // Rows on screen when a conversation opens stay still; rows that arrive
  // later in a live turn blur in (see RowEntrance).
  const [entranceArmedFor, setEntranceArmedFor] = useState<string | null>(null);
  useEffect(() => {
    const id = conversation?.id;
    if (!id) return;
    const timer = window.setTimeout(() => setEntranceArmedFor(id), ENTRANCE_ARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [conversation?.id]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  if (!conversation || !workspace) {
    return (
      <EmptyState
        icon={RiChat3Line}
        title={t('chat.pickConversation')}
        description={t('chat.pickConversationHint')}
        className="h-full px-8"
      />
    );
  }

  const attachments = session.composerAttachments[conversation.id] ?? [];
  const tokenStates: Record<string, { state: ComposerTokenState; title?: string }> = {};
  for (const item of attachments) {
    if (!item.uploadState) continue;
    tokenStates[attachmentToken(item)] = item.uploadState === 'uploading'
      ? { state: 'uploading', title: t('chat.uploading', { name: item.name }) }
      : { state: 'failed', title: uploadBlobsRef.current.has(item.id) ? t('chat.uploadFailedRetry', { name: item.name, error: item.uploadError ?? '' }) : item.uploadError };
  }
  const currentProvider = isV2Conversation(conversation) ? conversation.provider || '' : '';
  const agentProvider = conversation.provider || '';
  const slashTrigger = draft.trim().startsWith('/') ? draft.trim() : '';
  // Pi reads its session's own catalog (extensions add commands); other
  // agents use the backend's per-provider list.
  const commandCatalog = currentProvider === 'pi' ? session.getProviderCommandCatalog(conversation.id) : undefined;
  const liveCommands = currentProvider === 'pi'
    ? (commandCatalog?.status === 'ready' ? commandCatalog.commands : [])
    : currentProvider ? (session.providerCommands[currentProvider as ProviderKind] ?? []) : [];
  const providerSlashCatalog = liveCommands.length > 0
    ? liveCommands.map((item) => ({
      command: `/${item.name}`,
      title: item.name,
      description: `${item.description || `${item.source} command`}${currentProvider === 'pi' ? ` · ${piCommandCompatibility(item).label}` : ''}`,
      category: 'context' as const,
    }))
    : currentProvider === 'pi' ? [] : SLASH_COMMANDS;
  const canCompact = session.v2Providers.find(item => item.id === currentProvider)?.capabilities.controlActions?.includes('compact') === true;
  const slashCatalog = currentProvider === 'pi' ? [...providerSlashCatalog, ...piTodexCommands] : [
    ...(canCompact ? [{ command: '/compact', title: t('chat.compactTitle'), description: t('chat.compactDescription'), category: 'thread' as const }] : []),
    // The synthetic /compact item already covers the catalog entry when the
    // provider offers a native control action; otherwise keep the catalog's.
    ...providerSlashCatalog.filter(item => !canCompact || canonicalSlashCommand(item.command) !== '/compact'),
  ];
  const chooseSlashCommand = (command: string) => {
    if (command === '/compact' && currentProvider !== 'pi') {
      if (thinking || executionUnknown || submissionStatus === 'sending' || compaction?.status === 'running') return;
      session.sendSlashCommand(command, conversation.id);
      session.setConversationChatDraft(conversation.id, '');
    } else session.setConversationChatDraft(conversation.id, `${command} `);
  };
  // Pi suggests only while the command word (or `/todex <command>`) is typed.
  const selectingPiCommand = /^\/[^\s]*$/.test(draft.trimStart()) || /^\/todex [^\s]*$/.test(draft.trimStart());
  const slashSuggestions = slashTrigger && (currentProvider !== 'pi' || selectingPiCommand)
    ? slashCatalog.filter(item => currentProvider === 'pi'
      ? item.command.startsWith(slashTrigger.startsWith('/todex ') ? slashTrigger : slashTrigger.split(/\s+/)[0])
      : canonicalSlashCommand(item.command).startsWith(canonicalSlashCommand(slashTrigger.split(/\s+/)[0] || slashTrigger)))
    : [];
  // The conversation's own provider catalog leads the `#` list; the rest follow.
  const capabilityProviderOrder: ProviderKind[] = currentProvider
    ? [currentProvider as ProviderKind, ...session.v2Providers.map(item => item.id).filter(id => id !== currentProvider)]
    : session.v2Providers.map(item => item.id);
  const selectedSkillAttachments = session.selectedSkills[conversation.id] ?? [];
  const isSkillAttached = (skill: SkillCatalogDescriptor) =>
    selectedSkillAttachments.some(item => item.resourceId === skill.resourceId || (item.name === skill.name && item.path === skill.source));
  const capabilitySuggestions = capabilityActive && capability
    ? buildCapabilitySuggestions(session.capabilityCatalogs, capabilityProviderOrder, capability.query, { isSkillAttached })
    : [];
  const capabilityLoading = capabilityActive && capabilityCatalogsPending(session.capabilityCatalogs, capabilityProviderOrder);
  const capabilityDescription = (item: CapabilitySuggestion) => item.kind === 'skill'
    ? `Skill${item.attached ? ` · ${t('chat.capabilityAttached')}` : ''}${item.description ? ` · ${item.description}` : ''}`
    : `MCP${item.description ? ` · ${item.description}` : ''}`;
  const entryRows = entryMode && entryResults.mode === entryMode && entryResults.query === referenceQuery ? entryResults.items : [];
  const referenceSuggestions: ReferenceSuggestion[] = !referenceState ? []
    : referenceState.stage === 'type'
      ? [...buildReferenceTypeSuggestions(referenceState.prefix, (type) => t(REFERENCE_TYPE_KEYS[type])), ...entryRows]
      : referenceType === 'chat'
        ? buildChatReferenceSuggestions(referenceQuery, session.conversations.filter(isListedConversation), conversation.workspaceId, conversation.id, t('chat.newConversation'))
        : referenceType === 'skill' || referenceType === 'mcp'
          ? buildCapabilityReferenceSuggestions(
            buildCapabilitySuggestions(session.capabilityCatalogs, capabilityProviderOrder, referenceQuery, { limit: 100, isSkillAttached }),
            referenceType)
          : referenceType === 'ssh'
            ? buildSshReferenceSuggestions(referenceQuery, sshHosts ?? [])
            : referenceType === 'app'
              ? buildAppReferenceSuggestions(referenceQuery, hostApps?.apps ?? [],
                (app) => (app.running ? `${app.id} · ${t('chat.appRunning')}` : app.id))
              : entryRows;
  const referenceEmptyText = referenceType === 'chat' ? t('chat.noChatSuggestions')
    : referenceType === 'skill' || referenceType === 'mcp'
      ? (capabilityCatalogsPending(session.capabilityCatalogs, capabilityProviderOrder) ? t('chat.loadingCapabilities') : t('chat.noCapabilities'))
      : referenceType === 'ssh'
        ? (sshHosts === null ? t('chat.loadingSshHosts') : t('chat.noSshSuggestions'))
        : referenceType === 'app'
          ? (hostApps === null ? t('chat.loadingApps')
            : hostApps.empty === 'off' ? t('chat.appsComputerUseOff')
              : hostApps.empty === 'unsupported' ? t('chat.appsUnsupported')
                : hostApps.empty === 'failed' ? t('chat.appsLoadFailed') : t('chat.noAppSuggestions'))
        : mentionSearchPending ? t('chat.searchingFiles')
        : referenceType === 'folder' ? t('chat.noFolderSuggestions') : t('chat.noFileSuggestions');
  /** Shared by the `#` list and `@skill:` / `@mcp:`; `trigger` is the text it replaces. */
  const applyCapabilitySuggestion = (item: CapabilitySuggestion, trigger: { start: number; end: number; query: string }) => {
    if (item.kind === 'skill') {
      // Attaching produces the same chip the capability manager creates, so
      // the trigger text (`#name`, `@skill:name`) is dropped instead of sent.
      session.toggleCatalogSkill(conversation.id, item.skill, item.provider);
      session.setConversationChatDraft(conversation.id, insertCapabilityReference(draft, trigger, ''));
      session.setConversationComposerSelection(conversation.id, { start: trigger.start, end: trigger.start });
      composerRef.current?.focus(trigger.start);
      return;
    }
    const insertText = `#${item.name} `;
    session.setConversationChatDraft(conversation.id, insertCapabilityReference(draft, trigger, insertText));
    const cursor = trigger.start + insertText.length;
    session.setConversationComposerSelection(conversation.id, { start: cursor, end: cursor });
    composerRef.current?.focus(cursor);
  };
  const suggestionCount = slashSuggestions.length > 0
    ? Math.min(12, slashSuggestions.length)
    : capabilityActive ? capabilitySuggestions.length : referenceSuggestions.length;
  const applySuggestion = (index: number) => {
    if (slashSuggestions.length > 0) {
      const item = slashSuggestions[index];
      if (item) chooseSlashCommand(item.command);
      return;
    }
    if (capabilityActive) {
      const item = capabilitySuggestions[index];
      if (item && capability) applyCapabilitySuggestion(item, capability);
      return;
    }
    const item = referenceSuggestions[index];
    if (item) applyReferenceSuggestion(item);
  };
  const handleSuggestionKeyDown = (event: KeyboardEvent) => {
    if (isComposingRef.current || isImeCompositionKey(event)) return;
    if (!suggestionCount) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSuggestionIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + suggestionCount) % suggestionCount);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      applySuggestion(suggestionIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setSuggestionIndex(0);
    }
  };
  // Up/Down recall this conversation's earlier messages, shell style: browsing
  // starts from an empty composer and lasts until the recalled text is edited.
  const browsingHistory = sentHistoryBrowseRef.current?.conversationId === conversation.id
    && sentHistoryBrowseRef.current.recalled === draft;
  const handleHistoryKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isComposingRef.current || isImeCompositionKey(event) || readOnly) return;
    const browse = browsingHistory ? sentHistoryBrowseRef.current : null;
    if (!browse && draft.trim()) return;
    // Inside a recalled multi-line message the arrows still move the caret
    // until it reaches either end.
    const selection = composerSelectionRef.current ?? { start: draft.length, end: draft.length };
    if (browse && (selection.start !== selection.end || (selection.start > 0 && selection.start < draft.length))) return;
    const index = (browse ? browse.index : sentHistory.length) + (event.key === 'ArrowUp' ? -1 : 1);
    if (index < 0 || (!browse && event.key === 'ArrowDown')) return;
    event.preventDefault();
    const next = sentHistory[index] ?? '';
    sentHistoryBrowseRef.current = index < sentHistory.length
      ? { conversationId: conversation.id, index, recalled: next }
      : null;
    setSuggestionIndex(0);
    session.setConversationChatDraft(conversation.id, next);
    session.setConversationComposerSelection(conversation.id, { start: next.length, end: next.length });
    composerRef.current?.focus(next.length);
  };
  const handleComposerKeyDown = (event: KeyboardEvent) => {
    // A recalled `/command` opens the slash menu; keep the arrows on history.
    if (!browsingHistory) handleSuggestionKeyDown(event);
    if (!event.defaultPrevented) handleHistoryKeyDown(event);
  };
  const thinking = session.thinkingConversations[conversation.id] === true;
  const submissionStatus = session.submissionStatusByConversation[conversation.id];
  const executionUnknown = submissionStatus === 'unknown';
  // Legacy plaintext history (stored before history became end-to-end
  // encrypted) and retired local Codex history: viewable, exportable,
  // archivable and deletable, nothing else.
  const readOnly = isReadOnlyConversation(conversation);
  const runtime = conversationRuntime;
  const sessionPermissionIds = new Set((runtime?.pendingPermissions ?? []).filter(item => item.scope === 'session').map(item => item.id));
  const pendingPermissionIds = new Set((runtime?.pendingPermissions ?? []).map(item => item.id));
  const permissionRequests = session.pendingRequests.filter(item => item.requestId && pendingPermissionIds.has(item.requestId));
  const compaction = session.compactionByConversation[conversation.id];
  const latestProcessGroupId = activeChatProcessId(items, runtime?.activeTurnId || session.turnIds[conversation.id]);
  // The agent has stopped answering and only waits on provider background
  // tasks (e.g. a CI watcher), within its turn or after it completed.
  const backgroundTaskCount = backgroundTasks.length;
  // Once the agent has replied after its last steps, the live status moves
  // below that reply instead of staying on the finished group above it.
  const lastItem = items[items.length - 1];
  const showTrailingStatus = (backgroundTaskCount > 0 || (thinking && !latestProcessGroupId)) && items.length > 0
    && !(lastItem?.type === 'entry' && lastItem.entry.subtitle === STREAMING_REPLY_PLACEHOLDER);
  // A trailing reply whose turn is still running is unfinished: hide its
  // copy/fork/usage actions until the turn settles. A newer outgoing entry
  // means the last reply already belongs to a completed turn.
  const runActive = thinking || executionUnknown || submissionStatus === 'sending' || compaction?.status === 'running';
  let pendingReplyId: string | undefined;
  if (runActive) {
    for (let index = chatEntries.length - 1; index >= 0; index -= 1) {
      const candidate = chatEntries[index];
      if (candidate.kind === 'incoming') {
        pendingReplyId = candidate.id;
        break;
      }
      if (candidate.kind === 'outgoing') break;
    }
  }
  const canSwitchAgent = canSwitchConversationAgent(conversation, {
    timeline: conversationTimeline,
    thinking,
  });
  const agentLabel = agentProvider
    ? providerDisplayName(agentProvider, 'Agent')
    : 'Agent';
  const availableProviders = session.v2Providers.filter((item) => item.available);
  const providerDescriptor = session.v2Providers.find((item) => item.id === currentProvider);
  const liveProviderModels = session.providerModels[currentProvider as ProviderKind];
  const providerModels = liveProviderModels?.length ? liveProviderModels : providerDescriptor?.models ?? [];
  const currentModel = conversation.model || providerModels.find((item) => item.isDefault)?.id || (currentProvider === 'codex' ? workspace.model || session.settings.defaultModel : '');
  const currentModelDescriptor = providerModels.find((item) => item.id === currentModel);
  const supportedReasoningEfforts = currentModelDescriptor?.supportedReasoningEfforts ?? [];
  // An unset Pi/agent effort is meaningful: let the provider apply its own default.
  const currentReasoningEffort = conversation.reasoningEffort ?? null;
  const displayedReasoningEffort = currentReasoningEffort
    ?? currentModelDescriptor?.defaultReasoningEffort
    ?? (supportedReasoningEfforts.includes('medium') ? 'medium' : supportedReasoningEfforts[0])
    ?? null;
  const reasoningIndex = Math.max(0, supportedReasoningEfforts.indexOf(displayedReasoningEffort ?? ''));
  const displayedEffortLevel = normalizeReasoningEffort(displayedReasoningEffort) ?? undefined;
  const contextUsage = session.contextUsageByConversation[conversation.id];
  const contextModelId = contextUsage?.model || currentModel;
  const currentContextWindow = contextUsage?.contextWindow
    ?? providerModels.find((item) => item.id === contextModelId || item.id.endsWith(`/${contextModelId}`))?.contextWindow;
  const permissionConfig = conversationPermissionCapabilities(conversation, session.v2Providers);
  // Client menu order, limited to the modes the agent declares.
  const permissionModes = PERMISSION_MODES.filter((mode) => permissionConfig?.modes?.includes(mode));
  const currentPermission = session.resolvePermissionMode(conversation, workspace);
  const fixedPermission = permissionModes.length === 1;
  const canChoosePermission = permissionModes.length > 0;
  const permissionHint = agentProvider === 'pi' ? t('chat.permissionHintPi')
    : !canChoosePermission ? t('chat.permissionHintUnavailable')
      : !currentPermission ? t('chat.permissionHintReselect')
        : t('chat.permissionHintApply');

  const openAttachmentSource = (item: ComposerAttachmentDraft) => {
    setPreviewAttachment(null);
    if (item.path) {
      session.openPanel('Files', { filePath: item.path });
      return;
    }
    if (item.messageId) {
      messagesRef.current
        ?.querySelector(`[data-message-id="${CSS.escape(item.messageId)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const insertAttachmentTokens = (tokens: string[]) => {
    if (!tokens.length) return;
    const text = draftRef.current;
    const recorded = composerSelectionRef.current ?? { start: text.length, end: text.length };
    const start = Math.min(recorded.start, text.length);
    const end = Math.min(Math.max(recorded.end, start), text.length);
    const before = text.slice(0, start);
    const after = text.slice(end);
    const insertion = tokens.join(' ');
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const tail = after && !/^\s/.test(after) ? ' ' : '';
    const cursor = start + lead.length + insertion.length + tail.length;
    session.setConversationChatDraft(conversation.id, `${before}${lead}${insertion}${tail}${after}`);
    session.setConversationComposerSelection(conversation.id, { start: cursor, end: cursor });
    composerRef.current?.focus(cursor);
  };

  const applyReferenceSuggestion = (item: ReferenceSuggestion) => {
    if (!mention) return;
    const { action } = item;
    setSuggestionIndex(0);
    if (action.kind === 'conversation') {
      void attachConversationMention(action.conversationId, action.title, mention);
      return;
    }
    if (action.kind === 'capability') {
      applyCapabilitySuggestion(action.item, mention);
      return;
    }
    session.setConversationChatDraft(conversation.id, insertMention(draft, mention, action.text));
    const cursor = mention.start + action.text.length;
    session.setConversationComposerSelection(conversation.id, { start: cursor, end: cursor });
    composerRef.current?.focus(cursor);
  };

  /** `@chat:` exports the picked conversation as Markdown and attaches it as
   * a file capsule in place of the trigger text. */
  const attachConversationMention = async (referencedId: string, title: string, trigger: MentionTrigger) => {
    const conversationId = conversation.id;
    session.setConversationChatDraft(conversationId, insertMention(draft, trigger, ''));
    session.setConversationComposerSelection(conversationId, { start: trigger.start, end: trigger.start });
    composerRef.current?.focus(trigger.start);
    if (attachments.length >= MAX_COMPOSER_ATTACHMENTS) {
      toast.danger(t('chat.maxAttachments', { max: MAX_COMPOSER_ATTACHMENTS }));
      return;
    }
    let markdown: string;
    try {
      markdown = await session.exportConversationMarkdown(referencedId, MAX_COMPOSER_TEXT_BYTES);
    } catch (error) {
      toast.danger(t('chat.chatMentionFailed'), { description: error instanceof Error ? error.message : String(error) });
      return;
    }
    const stillActive = conversationIdRef.current === conversationId;
    const currentDraft = stillActive ? draftRef.current : (session.chatDrafts[conversationId] ?? '');
    const attachment: ComposerAttachmentDraft = {
      id: attachmentId(),
      kind: 'file',
      // Every attachment is a token in the draft, so the live draft catches name clashes.
      name: uniqueAttachmentName(`${tokenSafeName(title).trim() || 'conversation'}.md`, session.composerAttachments[conversationId] ?? [], currentDraft),
      mimeType: 'text/markdown',
      sizeBytes: new TextEncoder().encode(markdown).length,
      dataUrl: '',
      textContent: markdown,
      source: 'file',
    };
    session.setConversationAttachments(conversationId, (current) => [...current, attachment]);
    if (stillActive) insertAttachmentTokens([attachmentToken(attachment)]);
    else session.setConversationChatDraft(conversationId, (current) => `${current}${current && !/\s$/.test(current) ? ' ' : ''}${attachmentToken(attachment)}`);
    toast.success(t('chat.chatMentionAdded'));
  };

  const patchAttachment = (conversationId: string, id: string, patch: Partial<ComposerAttachmentDraft>) => {
    session.setConversationAttachments(conversationId, (current) =>
      current.some((entry) => entry.id === id)
        ? current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry)
        : current);
  };

  /** Uploads an attachment to the backend; the prompt then names the stored
   * path. A backend without `/v2/uploads` gets the content inline instead,
   * when it is an image or text file small enough for that. */
  const uploadAttachment = async (conversationId: string, attachment: ComposerAttachmentDraft, blob: Blob) => {
    uploadBlobsRef.current.set(attachment.id, blob);
    patchAttachment(conversationId, attachment.id, { uploadState: 'uploading', uploadError: undefined, uploadedPath: undefined });
    try {
      const stored = await session.uploadComposerFile(conversationId, attachment.name, blob);
      uploadBlobsRef.current.delete(attachment.id);
      patchAttachment(conversationId, attachment.id, { uploadState: undefined, uploadedPath: stored.path, sizeBytes: stored.sizeBytes });
    } catch (error) {
      if (isPromptUploadUnsupported(error)) {
        const inline = await inlineAttachmentContent(attachment, blob);
        if (inline) {
          uploadBlobsRef.current.delete(attachment.id);
          patchAttachment(conversationId, attachment.id, { uploadState: undefined, ...inline });
          return;
        }
        // Retrying cannot help until the backend is updated.
        uploadBlobsRef.current.delete(attachment.id);
        patchAttachment(conversationId, attachment.id, { uploadState: 'failed', uploadError: t('chat.uploadUnsupported') });
        return;
      }
      patchAttachment(conversationId, attachment.id, {
        uploadState: 'failed',
        uploadError: error instanceof ConnectionError ? error.userMessage : error instanceof Error ? error.message : String(error),
      });
    }
  };

  const addBrowserFiles = async (files: File[], source: 'clipboard' | 'file' = 'file') => {
    const conversationId = conversation.id;
    const remaining = MAX_COMPOSER_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      toast.danger(t('chat.maxAttachments', { max: MAX_COMPOSER_ATTACHMENTS }));
      return;
    }
    const nextAttachments: { attachment: ComposerAttachmentDraft; file: File }[] = [];
    let reachedLimit = false;
    for (const [index, file] of files.entries()) {
      if (nextAttachments.length >= remaining) {
        reachedLimit = true;
        break;
      }
      try {
        if (file.size > PROMPT_UPLOAD_MAX_BYTES) throw new Error(t('chat.uploadTooLarge', { name: file.name }));
        const mimeType = file.type || inferMimeType(file.name);
        const image = isImageMimeType(mimeType);
        const name = uniqueAttachmentName(
          attachmentName(file, index, mimeType, source),
          [...attachments, ...nextAttachments.map((item) => item.attachment)],
          draft,
        );
        const previewImage = isSupportedComposerImage(mimeType) && file.size <= MAX_COMPOSER_IMAGE_BYTES;
        const previewText = !image && isTextFile(file) && file.size <= MAX_COMPOSER_TEXT_BYTES;
        nextAttachments.push({
          file,
          attachment: {
            id: attachmentId(),
            kind: image ? 'image' : 'file',
            name,
            mimeType,
            sizeBytes: file.size,
            dataUrl: previewImage ? await readFileAsDataUrl(file) : '',
            textContent: previewText ? await file.text() : undefined,
            source,
            uploadState: 'uploading',
          },
        });
      } catch (error) {
        toast.danger(error instanceof Error ? error.message : t('chat.attachmentReadFailed'));
      }
    }
    if (nextAttachments.length > 0) {
      session.setConversationAttachments(conversationId, (current) => [
        ...current,
        ...nextAttachments.map((item) => item.attachment),
      ].slice(0, MAX_COMPOSER_ATTACHMENTS));
      // Every attachment lives in the draft as a capsule token, exactly like a quote.
      insertAttachmentTokens(nextAttachments.map((item) => attachmentToken(item.attachment)));
      for (const { attachment, file } of nextAttachments) void uploadAttachment(conversationId, attachment, file);
    }
    if (reachedLimit) {
      toast.danger(t('chat.maxAttachments', { max: MAX_COMPOSER_ATTACHMENTS }));
    }
  };

  /** Short single-line text is typed in as is; longer text becomes a text
   * capsule, and text beyond the capsule limit is uploaded as a Markdown
   * file. Returns true when the text was taken as an attachment. */
  const addPastedText = (text: string): boolean => {
    // Copied capsules paste back as capsules (the editor rebuilds them).
    if (composerTokenPattern('').test(text)) return false;
    const disposition = pastedTextDisposition(text);
    if (disposition === 'inline') return false;
    if (attachments.length >= MAX_COMPOSER_ATTACHMENTS) {
      toast.danger(t('chat.maxAttachments', { max: MAX_COMPOSER_ATTACHMENTS }));
      return true;
    }
    const conversationId = conversation.id;
    const blob = new Blob([text], { type: 'text/markdown' });
    if (blob.size > PROMPT_UPLOAD_MAX_BYTES) {
      toast.danger(t('chat.uploadTooLarge', { name: t('chat.pastedTextName') }));
      return true;
    }
    const capsule = disposition === 'capsule';
    const attachment: ComposerAttachmentDraft = {
      id: attachmentId(),
      kind: capsule ? 'text' : 'file',
      name: uniqueAttachmentName(capsule ? t('chat.pastedTextName') : `${t('chat.pastedTextName')}.md`, attachments, draft),
      mimeType: capsule ? 'text/plain' : 'text/markdown',
      sizeBytes: blob.size,
      dataUrl: '',
      textContent: capsule || blob.size <= MAX_COMPOSER_TEXT_BYTES ? text : undefined,
      source: 'clipboard',
      ...(capsule ? {} : { uploadState: 'uploading' as const }),
    };
    session.setConversationAttachments(conversationId, (current) => [...current, attachment]);
    insertAttachmentTokens([attachmentToken(attachment)]);
    if (!capsule) void uploadAttachment(conversationId, attachment, blob);
    return true;
  };

  /** Saving an edited text attachment: an uploaded file is uploaded again, and
   * a text capsule that outgrew the capsule limit turns into a Markdown file. */
  const saveAttachmentText = (item: ComposerAttachmentDraft, text: string) => {
    const conversationId = conversation.id;
    const sizeBytes = new TextEncoder().encode(text).length;
    if (item.kind === 'text' && pastedTextDisposition(text) === 'file') {
      const name = uniqueAttachmentName(`${t('chat.pastedTextName')}.md`, attachments, draft);
      const next: ComposerAttachmentDraft = { ...item, kind: 'file', name, mimeType: 'text/markdown', textContent: text, sizeBytes };
      session.setConversationAttachments(conversationId, (current) => current.map((entry) => entry.id === item.id ? next : entry));
      session.setConversationChatDraft(conversationId, (current) => current.replace(attachmentToken(item), attachmentToken(next)));
      void uploadAttachment(conversationId, next, new Blob([text], { type: 'text/markdown' }));
      return;
    }
    patchAttachment(conversationId, item.id, { textContent: text, sizeBytes });
    if (item.kind !== 'text' && item.kind !== 'reference' && (item.uploadedPath || item.uploadState)) {
      void uploadAttachment(conversationId, { ...item, textContent: text, sizeBytes }, new Blob([text], { type: item.mimeType || 'text/plain' }));
    }
  };

  const retryAttachmentUpload = (item: ComposerAttachmentDraft): boolean => {
    const blob = uploadBlobsRef.current.get(item.id);
    if (item.uploadState !== 'failed' || !blob) return false;
    void uploadAttachment(conversation.id, item, blob);
    return true;
  };

  const submitComposer = () => {
    if (!conversation) return;
    if (readOnly || executionUnknown || submissionStatus === 'sending') return;
    if (currentProvider !== 'pi' && draft.trim().startsWith('/')) {
      session.sendSlashCommand(draft, conversation.id);
    } else {
      session.submitChat(conversation.id);
    }
  };

  // Rows mounting while a turn runs blur in; history reveals and prepends stay still.
  const animateEntrance = entranceArmedFor === conversation.id && runActive && !historyAnchorRef.current;
  const attachDisabled = readOnly || executionUnknown || attachments.length >= MAX_COMPOSER_ATTACHMENTS;
  const canSend = !readOnly && !executionUnknown && submissionStatus !== 'sending'
    && Boolean(draft.trim() || attachments.length > 0 || selectedSkillAttachments.length > 0);
  const effortClass = displayedEffortLevel ? EFFORT_TEXT[displayedEffortLevel] : undefined;
  const focusComposerFromPadding = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      composerRef.current?.focus();
    }
  };
  const suggestionItemClass = (active: boolean) => ({ isFocused, isHovered, isDisabled }: ListBoxItemRenderProps) => cx(
    'composer-suggestion-item grid min-h-10 cursor-pointer grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] items-center gap-3 rounded-2lg px-2.5 py-2 outline-none',
    'transition-colors duration-150 ease',
    active && 'composer-suggestion-item--active',
    (active || isFocused || isHovered) && 'bg-dropdown-item-hover-background',
    isDisabled && 'cursor-not-allowed opacity-50',
  );
  const suggestionCommand = 'min-w-0 truncate text-body-semibold text-text-primary';
  const suggestionDescription = 'min-w-0 truncate text-caption-1-regular text-text-secondary';
  const suggestionEmpty = 'px-2 py-1 text-caption-1-regular text-text-tertiary';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="@container relative min-h-0 flex-1">
        <ScrollArea
          viewportRef={scrollRef}
          onScroll={updateScrollPosition}
          surface="secondary"
          className="h-full"
          contentClassName="px-5 py-5"
        >
        <div ref={messagesRef} className="mx-auto flex max-w-2xl flex-col gap-3">
          {readOnly ? <Alert status="warning" description={t(conversation.legacyCodex ? 'history.legacyCodexBanner' : 'history.readOnlyBanner')} /> : null}
          {earlierHistoryStatus?.loading ? (
            <p className="flex items-center justify-center gap-2 py-2 text-caption-1-regular text-text-tertiary" role="status">
              <Spinner size="xs" />
              {t('chat.loadingEarlier')}
            </p>
          ) : earlierHistoryStatus?.failed ? (
            <div className="flex items-center justify-center gap-2 py-1" role="alert">
              <p className="text-caption-1-regular text-text-error-primary">{t('chat.loadEarlierFailed')}</p>
              <Button size="xs" variant="secondary" onClick={() => requestEarlierHistory(true)}>
                {t('chat.retry')}
              </Button>
            </div>
          ) : earlierHistoryStatus?.capped ? (
            <p className="py-2 text-center text-caption-1-regular text-text-tertiary" role="status">{t('chat.earlierHistoryCapped')}</p>
          ) : earlierHistoryStatus?.hasMore ? (
            <div className="flex justify-center py-1">
              <Button size="xs" variant="secondary" onClick={() => requestEarlierHistory()}>
                {t('chat.loadEarlier')}
              </Button>
            </div>
          ) : null}
          {items.length === 0 && !thinking && session.openStatusByConversation[conversation.id] === 'failed' ? (
            <div className="flex flex-col items-center gap-2 py-16" role="alert">
              <p className="text-body-regular text-text-error-primary">{t('chat.openHistoryFailed')}</p>
              <Button size="small" variant="secondary" onClick={() => { void session.recoverConversation(conversation.id); }}>
                {t('chat.retry')}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-16 text-center text-body-regular text-text-tertiary" role="status">
              {thinking ? t('chat.working')
                : session.openStatusByConversation[conversation.id] === 'opening' ? t('chat.openingHistory')
                  : session.recoveringConversations[conversation.id] ? t('chat.recovering')
                    : t('chat.emptyHint')}
            </p>
          ) : null}
          {items.map((item) => (
            <ErrorBoundary key={chatRenderItemKey(item)} label="chat row" fallback={() => <RowRenderError />}>
            <ChatTimelineItem
              item={item}
              conversationId={conversation.id}
              agentName={agentLabel}
              thinking={thinking}
              isStreamingGroup={item.type === 'executionGroup' && thinking && backgroundTaskCount === 0 && item.id === latestProcessGroupId}
              backgroundToolIds={backgroundToolIds}
              groupExpanded={item.type === 'executionGroup' && expandedProcessIds.has(item.id)}
              groupLoadState={item.type === 'executionGroup' ? processGroupLoad[item.id] : undefined}
              groupPendingCount={item.type === 'executionGroup'
                ? item.entries.filter((entry) => entry.requestId && session.pendingRequests.some((request) => request.requestId === entry.requestId)).length
                : 0}
              request={item.type === 'entry' && !readOnly
                ? session.pendingRequests.find((pendingItem) => pendingItem.requestId && (item.entry.requestId === pendingItem.requestId || item.entry.raw.includes(pendingItem.requestId)))
                : undefined}
              isActionable={item.type === 'entry' && actionableIncoming.has(item.entry.id)}
              isPendingReply={item.type === 'entry' && item.entry.id === pendingReplyId}
              markdownComponents={markdownComponents}
              onHydrateGroup={session.hydrateProcessGroup}
              onApprove={session.sendApprovalResponse}
              setExpandedProcessIds={setExpandedProcessIds}
              setProcessGroupLoad={setProcessGroupLoad}
              animateEntrance={animateEntrance}
              session={session}
            />
            </ErrorBoundary>
          ))}
          {showTrailingStatus ? (
            backgroundTaskCount > 0 ? <BackgroundTasksStatus tasks={backgroundTasks} items={items} /> : (
              <p className="min-h-7 py-1 text-body-regular" role="status">
                <ShimmerText>{t('chat.working')}</ShimmerText>
              </p>
            )
          ) : null}
        </div>
        </ScrollArea>
        {/* Sits in the gutter beside the centered message column; collapses to a hover reveal when the gutter is too narrow. */}
        <TurnNavigator
          turns={chatTurns}
          activeId={activeTurnId}
          onSelect={scrollMessageToTop}
          className="absolute inset-y-0 start-0 z-20 ps-3"
        />
        {isAtBottom ? null : (
          <Button
            size="small"
            variant="secondary"
            leadingIcon={RiArrowDownDoubleLine}
            className="absolute end-4 bottom-3 z-20 shadow-dropdown"
            onClick={() => scrollToLatest('smooth')}
          >
            {t('chat.scrollToLatest')}
          </Button>
        )}
      </div>
      {quote ? (
        // Pressing the button must not collapse the selection it quotes.
        <div className="fixed z-50 -translate-x-1/2" style={{ left: quote.left, top: quote.top }} onMouseDown={(event) => event.preventDefault()}>
          <Button size="small" variant="secondary" className="shadow-dropdown" onClick={() => {
            const existing = session.composerAttachments[conversation.id] ?? [];
            const name = uniqueAttachmentName(t('chat.quoteName'), existing, draft);
            session.setConversationAttachments(conversation.id, (current) => [...current, {
              id: attachmentId(), kind: 'reference', name, mimeType: 'text/plain',
              sizeBytes: new TextEncoder().encode(quote.text).length, dataUrl: '',
              textContent: quote.text, source: 'message',
              ...(quote.messageId ? { messageId: quote.messageId } : {}),
            }]);
            const token = referenceToken(name);
            insertAttachmentTokens([token]);
            window.getSelection()?.removeAllRanges();
            setQuote(null);
            toast.success(t('chat.quoteAdded'));
          }}>{t('chat.quoteAdd')}</Button>
        </div>
      ) : null}
      <ComposerAttachmentPreview
        attachment={previewAttachment}
        onOpenChange={(open) => { if (!open) setPreviewAttachment(null); }}
        onOpenSource={openAttachmentSource}
        onSaveText={(item, text) => {
          saveAttachmentText(item, text);
          setPreviewAttachment(null);
        }}
      />
      <div className="shrink-0 px-4 pt-2 pb-4">
        <div className="relative mx-auto max-w-2xl">
          <ComputerLiveView session={session} conversationId={conversation.v2ConversationId ?? conversation.id} state={conversationRuntime?.desktopComputer} />
          {readOnly ? null : permissionRequests.map(request => <PermissionRequestCard
            key={request.requestId}
            request={request}
            fallbackTitle={sessionPermissionIds.has(request.requestId) ? t('chat.piPluginRequest') : request.title || t('chat.permissionApproval')}
            deviceSecret={session.settings.deviceSecret}
            onSelect={(option, data) => { session.sendApprovalResponse(option, request, data); }}
          />)}
          {currentProvider === 'pi' && runtime ? <PiExtensionPanel placement="aboveEditor"
            extensionUi={runtime.extensionUi} providerRuntime={runtime.providerRuntime}
            pendingEditorRequest={session.pendingPluginDrafts[conversation.id]}
            onReplaceEditor={request => session.handlePluginDraft(conversation.id, request, true)}
            onDismissEditor={request => session.handlePluginDraft(conversation.id, request, false)}
            onStopRuntime={providerDescriptor?.capabilities.runtimeStop ? () => { void session.stopProviderRuntime(conversation.id); } : undefined}
            isStopping={session.stoppingProviderRuntimes[conversation.id]}
            isConnected={session.connectionState === 'open'} /> : null}
          {currentProvider === 'pi' && slashTrigger ? <div className="mb-2 flex items-center gap-2 text-caption-1-regular text-text-tertiary">
            <span>{commandCatalog?.status === 'ready' ? (commandCatalog.source === 'session' ? t('chat.piCommandsSession') : t('chat.piCommandsWorkspace'))
              : commandCatalog?.status === 'error' ? t('chat.commandCatalogFailed') : t('chat.piCommandsLoading')}</span>
            <Button size="xs" variant="ghost" disabled={commandCatalog?.status === 'loading'}
              onClick={session.refreshProviderCommands}>{t('chat.refreshCommands')}</Button>
          </div> : null}
          {(slashSuggestions.length > 0 || referenceSuggestions.length > 0 || (mentionActive && referenceSuggestions.length === 0) || capabilityActive) ? (
            <motion.div
              ref={suggestionsPopoverRef}
              initial={{ opacity: 0, scale: 0.97, filter: 'blur(2px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="composer-suggestions-popover absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-30 max-h-72 origin-bottom overflow-y-auto rounded-2xl border border-border-button-default bg-background-primary-default p-1.5 shadow-dropdown"
            >
              {slashSuggestions.length > 0 ? (
                <AriaListBox
                  aria-label={t('chat.commandSuggestions')}
                  className="flex flex-col gap-0.5 outline-none"
                  onAction={(key) => {
                    const item = slashSuggestions.find((candidate) => candidate.command === String(key));
                    if (item) chooseSlashCommand(item.command);
                  }}
                >
                  {slashSuggestions.slice(0, 12).map((item, index) => (
                    <AriaListBoxItem key={item.command} id={item.command} isDisabled={currentProvider !== 'pi' && item.command === '/compact' && (thinking || executionUnknown || submissionStatus === 'sending' || compaction?.status === 'running')} textValue={`${item.command} ${item.description}`} className={suggestionItemClass(index === suggestionIndex)}>
                      <span className={suggestionCommand}>{item.command}</span>
                      <span className={suggestionDescription}>{item.description}</span>
                    </AriaListBoxItem>
                  ))}
                </AriaListBox>
              ) : capabilityActive ? (
                capabilitySuggestions.length > 0 ? (
                  <AriaListBox
                    aria-label={t('chat.capabilitySuggestions')}
                    className="flex flex-col gap-0.5 outline-none"
                    onAction={(key) => {
                      const item = capabilitySuggestions.find((candidate) => candidate.id === String(key));
                      if (item && capability) applyCapabilitySuggestion(item, capability);
                    }}
                  >
                    {capabilitySuggestions.map((item, index) => (
                      <AriaListBoxItem key={item.id} id={item.id} textValue={`#${item.name} ${item.description}`} className={suggestionItemClass(index === suggestionIndex)}>
                        <span className={suggestionCommand}>#{item.name}</span>
                        <span className={suggestionDescription}>{capabilityDescription(item)}</span>
                      </AriaListBoxItem>
                    ))}
                  </AriaListBox>
                ) : (
                  <p className={suggestionEmpty}>{capabilityLoading ? t('chat.loadingCapabilities') : t('chat.noCapabilities')}</p>
                )
              ) : referenceSuggestions.length > 0 ? (
                <>
                  <AriaListBox
                    aria-label={t('chat.referenceSuggestions')}
                    className="flex flex-col gap-0.5 outline-none"
                    onAction={(key) => {
                      const item = referenceSuggestions.find((candidate) => candidate.id === String(key));
                      if (item) applyReferenceSuggestion(item);
                    }}
                  >
                    {referenceSuggestions.map((item, index) => (
                      <AriaListBoxItem key={item.id} id={item.id} textValue={`${item.label} ${item.description}`} className={suggestionItemClass(index === suggestionIndex)}>
                        <span className={suggestionCommand}>{item.label}</span>
                        <span className={suggestionDescription}>
                          {item.action.kind === 'capability' ? capabilityDescription(item.action.item) : item.description}
                        </span>
                      </AriaListBoxItem>
                    ))}
                  </AriaListBox>
                  {referenceType === 'folder' && entryResults.truncated ? <p className={suggestionEmpty}>{t('chat.folderSearchHint')}</p> : null}
                </>
              ) : mention ? <p className={suggestionEmpty}>{referenceEmptyText}</p> : null}
            </motion.div>
          ) : null}
          {(session.selectedSkills[conversation.id] ?? []).length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {(session.selectedSkills[conversation.id] ?? []).map((skill) => (
                <Button
                  key={skill.resourceId || `${skill.name}:${skill.path}`}
                  size="xs"
                  variant="secondary"
                  trailingIcon={RiCloseLine}
                  onClick={() => session.setConversationSelectedSkills(conversation.id, (current) =>
                    current.filter((item) => (item.resourceId || item.name) !== (skill.resourceId || skill.name)))}
                >
                  Skill · {skill.displayName || skill.name}
                </Button>
              ))}
            </div>
          ) : null}
          {runtime?.goal && !readOnly ? (
            <ConversationGoalBar
              className="mb-2"
              goal={runtime.goal}
              onChange={(action) => session.sendConversationGoal(conversation.id, action)}
            />
          ) : null}
          {conversation.schedule ? (
            <ConversationScheduleBar
              className="mb-2"
              schedule={conversation.schedule}
              heldCount={runtime?.followUps.items.length ?? 0}
              onSendNow={() => { void session.sendScheduledNow(conversation.id); }}
              onReschedule={(at) => session.scheduleConversation(conversation.id, at)}
              onCancel={() => { void session.scheduleConversation(conversation.id, null); }}
            />
          ) : null}
          <NoticeToast
            message={!currentPermission && agentProvider !== 'pi' && session.connectionState === 'open'
              && session.v2Providers.some(provider => provider.id === agentProvider) ? permissionHint : null}
            scope={conversation.id}
          />
          <ConversationRunStatus
            submissionStatus={submissionStatus}
            runtime={runtime}
            compaction={compaction}
            automaticCompaction={agentProvider === 'codex'}
            onRecover={() => session.reconcilePendingSubmission(conversation.id)}
          />
          {conversation.v2ConversationId && !readOnly ? <ConversationControls
            runtime={runtime}
            reportedError={session.lastError}
            running={thinking}
            canUseNativeQueue={providerDescriptor?.capabilities.followUpQueue === true}
            piQueue={currentProvider === 'pi'}
            controlStatus={session.controlStatusByConversation[conversation.id]}
            canPauseBackend={providerDescriptor?.capabilities.backendQueue === true && providerDescriptor.capabilities.backendQueueControl === true}
            onRecover={() => { void session.recoverConversation(conversation.id); }}
            onRemoveNative={itemId => { void session.controlConversation(conversation.id, { action: 'queueRemove', itemId }); }}
            onClearNative={() => { void session.controlConversation(conversation.id, { action: 'queueClear' }); }}
            onRemoveBackend={itemId => { void session.editFollowUpQueue(conversation.id, 'remove', itemId); }}
            onClearBackend={() => { void session.editFollowUpQueue(conversation.id, 'clear'); }}
            onResumeBackend={() => { void session.editFollowUpQueue(conversation.id, 'resume'); }}
            onPauseBackend={() => { void session.editFollowUpQueue(conversation.id, 'pause'); }}
          /> : null}
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            disabled={attachDisabled}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              // Reset so picking the same file again still fires a change.
              event.currentTarget.value = '';
              if (files.length > 0) void addBrowserFiles(files);
            }}
          />
          <ConversationPromptInput
            submissionStatus={submissionStatus}
            value={draft}
            status={submissionStatus === 'sending' ? 'submitted' : thinking ? 'streaming' : 'ready'}
            isDisabled={readOnly || executionUnknown}
            onKeyDownCapture={(event) => {
              if (event.key === 'Enter' && (isComposingRef.current || isImeCompositionKey(event))) {
                event.stopPropagation();
                return;
              }
              // Resolve Pi suggestions first so choosing a command only fills the draft.
              if (currentProvider === 'pi' && event.target instanceof HTMLElement
                && (event.target instanceof HTMLTextAreaElement || event.target.isContentEditable)) {
                handleComposerKeyDown(event);
                if (event.defaultPrevented) event.stopPropagation();
              }
            }}
            onValueChange={(value: string) => { setSuggestionIndex(0); session.setConversationChatDraft(conversation.id, value); }}
            onSubmit={submitComposer}
            onStop={() => session.stopThinking(conversation.id)}
          >
            <ComposerLoader active={thinking && !readOnly} radius={24}>
              <div
                data-dragging={isDraggingAttachment || undefined}
                onDragStart={() => { internalDragRef.current = true; }}
                onDragEnd={() => { internalDragRef.current = false; }}
                onDragEnter={(event) => {
                  if (!event.dataTransfer.types.includes('Files')) return;
                  event.preventDefault();
                  setIsDraggingAttachment(true);
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes('Files')) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  setIsDraggingAttachment(true);
                }}
                onDragLeave={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (!nextTarget || !event.currentTarget.contains(nextTarget as Node)) {
                    setIsDraggingAttachment(false);
                  }
                }}
                onDrop={(event) => {
                  setIsDraggingAttachment(false);
                  if (internalDragRef.current) return;
                  const files = droppedFiles(event.dataTransfer);
                  if (files.files.length > 0 || files.folders > 0) {
                    event.preventDefault();
                    if (files.folders > 0) toast.danger(t('chat.folderUnsupported'));
                    if (files.files.length > 0) void addBrowserFiles(files.files);
                    return;
                  }
                  // Dropped text follows the paste rules; short text drops in
                  // where the pointer is, as plain text (never the rich HTML
                  // the browser would insert).
                  event.preventDefault();
                  const text = event.dataTransfer.getData('text/plain');
                  if (text && !addPastedText(text)) insertPlainTextAt(event.clientX, event.clientY, text);
                }}
                // Capture phase so long text pastes become capsules before the
                // editor inserts them as plain text.
                onPasteCapture={(event) => {
                  const files = clipboardFiles(event.clipboardData);
                  if (files.length > 0) {
                    event.preventDefault();
                    void addBrowserFiles(files, 'clipboard');
                    return;
                  }
                  const text = event.clipboardData.getData('text/plain');
                  if (text && addPastedText(text)) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                onMouseDown={focusComposerFromPadding}
                className={cx(
                  'flex flex-col gap-3 rounded-3xl border border-border-button-default p-2.5',
                  'transition-[border-color,box-shadow] duration-150 ease focus-within:border-border-button-hover',
                  'data-[dragging]:border-border-focus-ring data-[dragging]:ring-2 data-[dragging]:ring-border-focus-ring',
                  readOnly || executionUnknown ? 'cursor-not-allowed' : 'cursor-text',
                )}
              >
                <div className="px-1.5 pt-1.5" onMouseDown={focusComposerFromPadding}>
                  <ReferenceComposer
                    ref={composerRef}
                    value={draft}
                    isDisabled={readOnly || executionUnknown}
                    placeholder={readOnly ? t(conversation.legacyCodex ? 'history.legacyCodexPlaceholder' : 'history.readOnlyPlaceholder')
                      : t('chat.placeholderFull')}
                    onChange={(value) => {
                      setSuggestionIndex(0);
                      session.setConversationChatDraft(conversation.id, value);
                      // A capsule token owns its attachment's lifetime.
                      session.setConversationAttachments(conversation.id, (current) =>
                        current.every((item) => value.includes(attachmentToken(item)))
                          ? current
                          : liveComposerAttachments(value, current));
                    }}
                    onSubmit={submitComposer}
                    onKeyDown={currentProvider === 'pi' ? undefined : handleComposerKeyDown}
                    onSelectionChange={(selection) => session.setConversationComposerSelection(conversation.id, selection)}
                    onCompositionStart={() => { isComposingRef.current = true; }}
                    onCompositionEnd={() => { isComposingRef.current = false; }}
                    resolveTokenLabel={(kind, name) => {
                      const item = attachments.find((entry) => entry.kind === kind && entry.name === name);
                      if (!item) return undefined;
                      if (item.kind === 'reference') return referencePreview(item.textContent) || item.name;
                      if (item.kind === 'text') return referencePreview(item.textContent, 16) || item.name;
                      return item.name;
                    }}
                    onTokenClick={(kind, name) => {
                      const item = attachments.find((entry) => entry.kind === kind && entry.name === name);
                      if (item && !retryAttachmentUpload(item)) setPreviewAttachment(item);
                    }}
                    tokenStates={tokenStates}
                  />
                </div>
                <div className="composer-toolbar flex cursor-default items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-1">
                    <TooltipTrigger delay={200}>
                      <Focusable>
                        <button
                          type="button"
                          aria-label={t('chat.addAttachment')}
                          disabled={attachDisabled}
                          onClick={() => fileInputRef.current?.click()}
                          className={cx(
                            'me-1 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full p-2 outline-none',
                            'bg-composer-panel-add-background transition-colors duration-150 ease hover:bg-composer-panel-add-hover-background',
                            'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                            'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-composer-panel-add-background',
                          )}
                        >
                          <RiAttachment2 aria-hidden className="size-5 text-foreground-icon-primary" />
                        </button>
                      </Focusable>
                      <Tooltip placement="top">
                        {attachments.length >= MAX_COMPOSER_ATTACHMENTS
                          ? t('chat.maxAttachmentsTooltip', { max: MAX_COMPOSER_ATTACHMENTS })
                          : t('chat.addImageOrText')}
                      </Tooltip>
                    </TooltipTrigger>
                    <ComposerSelect
                      label={t('chat.selectAgent')}
                      icon={<ProviderIcon className={COMPOSER_CONTROL_ICON} provider={agentProvider} />}
                      text={agentLabel}
                      selectedKey={currentProvider || agentProvider || null}
                      isDisabled={readOnly || !canSwitchAgent}
                      options={availableProviders.map((item) => ({
                        id: item.id,
                        label: providerDisplayName(item.id, item.displayName),
                        icon: <ProviderIcon provider={item.id} className="size-5 shrink-0" />,
                      }))}
                      onChange={(key) => {
                        if (!key || key === currentProvider) {
                          return;
                        }
                        session.switchConversationAgent(conversation.id, key as ProviderKind);
                      }}
                    />
                    <ComposerPopover
                      label={t('chat.selectModel')}
                      dialogLabel={t('chat.modelPopover')}
                      isDisabled={readOnly || providerModels.length === 0}
                      triggerClassName="composer-model-control__trigger"
                      data-effort={displayedEffortLevel}
                      popoverClassName="w-[min(20.5rem,calc(100vw-2rem))]"
                      trigger={(
                        <>
                          <RiCpuLine aria-hidden className={cx(COMPOSER_CONTROL_ICON, effortClass ?? (displayedReasoningEffort ? 'text-text-accent' : undefined))} />
                          <span className="composer-control__text">{currentModelDescriptor?.displayName || modelDisplayLabel(currentModel, session.modelCatalog)}</span>
                          {displayedReasoningEffort ? (
                            <span className={cx('composer-control__effort text-caption-1-semibold', effortClass ?? 'text-text-accent')}>
                              · {reasoningEffortLabel(displayedReasoningEffort)}
                            </span>
                          ) : null}
                        </>
                      )}
                    >
                      <ModelReasoningCard
                        currentModel={currentModel}
                        currentModelDescriptor={currentModelDescriptor}
                        modelCatalog={session.modelCatalog}
                        providerModels={providerModels}
                        supportedReasoningEfforts={supportedReasoningEfforts}
                        currentReasoningEffort={currentReasoningEffort}
                        displayedReasoningEffort={displayedReasoningEffort}
                        onSelectModel={(modelId) => {
                          session.applyConversationModelSelection(conversation.id, modelId, null);
                        }}
                        onSelectReasoningEffort={(effort) => {
                          session.applyConversationModelSelection(conversation.id, currentModel, effort);
                        }}
                      />
                    </ComposerPopover>
                    <ComposerSelect
                      label={t('chat.selectPermission')}
                      hint={permissionHint}
                      icon={<RiShieldLine aria-hidden className={COMPOSER_CONTROL_ICON} />}
                      text={currentPermission ? permissionModeLabel(currentPermission) : canChoosePermission ? t('chat.permissionSelect') : t('chat.permissionUnavailable')}
                      textTitle={permissionHint}
                      selectedKey={currentPermission}
                      showIndicator={!fixedPermission}
                      isDisabled={readOnly || thinking || executionUnknown || !canChoosePermission || (fixedPermission && currentPermission !== null)}
                      options={permissionModes.map((mode) => ({ id: mode, label: permissionModeLabel(mode), icon: permissionModeIcon(mode) }))}
                      onChange={(key) => {
                        if (permissionModes.includes(key as PermissionMode)) {
                          void session.applyConversationPermissionMode(conversation.id, key as PermissionMode);
                        }
                      }}
                    />
                    {permissionConfig?.supportsPlan ? <ComposerSelect
                      label={t('chat.selectWorkMode')}
                      hint={t('chat.workModeApply')}
                      icon={<RiListCheck2 aria-hidden className={COMPOSER_CONTROL_ICON} />}
                      text={conversation.mode === 'plan' ? t('chat.modePlan') : t('chat.modeImplement')}
                      textTitle={t('chat.workModeApply')}
                      selectedKey={conversation.mode === 'plan' ? 'plan' : 'implement'}
                      isDisabled={readOnly || thinking || executionUnknown}
                      options={[
                        { id: 'implement', label: t('chat.modeImplement'), icon: <RiCodeSSlashLine aria-hidden className={OPTION_ICON} /> },
                        { id: 'plan', label: t('chat.modePlan'), icon: <RiRouteLine aria-hidden className={cx(OPTION_ICON, '-scale-y-100')} /> },
                      ]}
                      onChange={(key) => {
                        if (key === 'plan' || key === 'implement') {
                          void session.applyConversationWorkMode(conversation.id, key);
                        }
                      }}
                    /> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ContextUsageIndicator
                      session={session}
                      provider={conversation.provider}
                      usedTokens={contextUsage?.usedTokens ?? 0}
                      contextWindow={currentContextWindow}
                      inputTokens={contextUsage?.inputTokens ?? 0}
                      outputTokens={contextUsage?.outputTokens ?? 0}
                      cachedInputTokens={contextUsage?.cachedInputTokens ?? 0}
                      cacheWriteTokens={contextUsage?.cacheWriteTokens ?? 0}
                    />
                    {thinking && !readOnly ? (
                      <TooltipTrigger delay={200}>
                        <Focusable>
                          <ComposerRoundButton aria-label={t('chat.stop')} onClick={() => session.stopThinking(conversation.id)}>
                            <RiStopFill aria-hidden className="size-4" />
                          </ComposerRoundButton>
                        </Focusable>
                        <Tooltip placement="top">{t('chat.stop')}</Tooltip>
                      </TooltipTrigger>
                    ) : null}
                    <ComposerSendButton aria-label={t('workbench.send')} disabled={!canSend} onClick={submitComposer}>
                      <RiArrowUpLine aria-hidden className="size-5" />
                    </ComposerSendButton>
                  </div>
                </div>
              </div>
            </ComposerLoader>
          </ConversationPromptInput>
          {currentProvider === 'pi' && runtime ? <PiExtensionPanel placement="belowEditor"
            extensionUi={runtime.extensionUi} /> : null}
        </div>
      </div>
    </div>
  );
}

import { ConversationControls } from '../components/ConversationControls';
import { ComputerLiveView } from '../components/ComputerLiveView';
import { NoticeToast } from '../components/NoticeToast';
import { RiArrowDownDoubleLine, RiAttachment2, RiBarChartBoxLine, RiClipboardLine, RiCpuLine, RiGitBranchLine, RiListCheck2, RiShieldLine, RiStopCircleLine } from '@remixicon/react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { Alert, Button, Label, ListBox, Popover, ScrollShadow, Select, Spinner, Tooltip, toast } from '@heroui/react';
import { ChainOfThought, ChatAttachment, ChatAttachmentGroup, ChatAttachmentInput, ChatMessage, HoverCard, PromptInput, TextShimmer } from '@heroui-pro/react';
import { ChatMessageActions } from '@heroui-pro/react/chat-message-actions';
import { ChatTool, type ToolPartState } from '@heroui-pro/react/chat-tool';
import { Markdown, type MarkdownProps } from '@heroui-pro/react/markdown';
import { baseMarkdownComponents } from '../components/markdownComponents';
import { providerDisplayName, type ProviderKind, type PermissionMode, type SkillCatalogDescriptor } from '@todex/protocol/v2';
import { ConversationPermissionActions, ConversationPromptInput, ConversationRunStatus, PermissionRequestCard, TurnUsageSummary } from '../components/ConversationRunStatus';
import { ReferenceComposer, type ReferenceComposerHandle } from '../components/ReferenceComposer';
import { ComposerAttachmentPreview } from '../components/ComposerAttachmentPreview';
import { SentAttachmentPreview } from '../components/SentAttachmentPreview';
import { activeChatProcessId, buildChatRenderItems, isChatTimelineEntry, isChatToolEntry, latestIncomingEntryIds, sameTimelineEntries, sortChatEntries } from '../components/conversationTimeline';
import type { ChatRenderItem } from '../components/conversationTimeline';
import type { BackgroundTask } from '@todex/protocol/conversationRuntime';
import { ModelReasoningCard } from '../components/ModelReasoningCard';
import { ProviderIcon } from '../components/ProviderIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import {
  conversationPermissionMode,
  conversationPermissionCapabilities,
  attachmentId,
  canSwitchConversationAgent,
  conversationImageInputSupport,
  inferMimeType,
  isImageMimeType,
  isStepProgressEntry,
  isV2Conversation,
  liveComposerAttachments,
  MAX_COMPOSER_ATTACHMENTS,
  SLASH_COMMANDS,
  attachmentToken,
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
  type ComposerAttachmentDraft,
  type MentionTrigger,
  type TimelineEntry,
} from '../session/helpers';
import { selectionInside } from '../lib/selection';
import type { SentAttachment } from '../session/sentAttachments';
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
import { getLocale, t, useT } from '../i18n';

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

const MAX_COMPOSER_IMAGE_BYTES = 2_500_000;
const MAX_COMPOSER_TEXT_BYTES = 512 * 1024;
const HYDRATE_DEBOUNCE_MS = 200;
// Clipboard text longer than this becomes a capsule attachment instead of
// flooding the composer.
const PASTED_TEXT_MAX_LINES = 5;
const COMPOSER_IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const COMPOSER_TEXT_ACCEPT = 'text/*,.md,.mdx,.json,.yaml,.yml,.toml,.csv,.tsv,.ts,.tsx,.js,.jsx,.css,.html,.xml,.svg,.sh,.py,.rs,.go,.java,.kt,.swift';
const SUPPORTED_COMPOSER_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function isSupportedComposerImage(mimeType: string): boolean {
  return SUPPORTED_COMPOSER_IMAGE_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

function isTextFile(file: File): boolean {
  return file.type.startsWith('text/') || /\.(md|mdx|txt|json|ya?ml|toml|csv|tsv|tsx?|jsx?|css|html?|xml|svg|sh|py|rs|go|java|kt|swift)$/i.test(file.name);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(t('chat.readImageFailed')));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  });
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

/** Tool rows name the tool and show its key argument (command, path, query)
 * without expanding; arguments, output and errors stay in the body. */
function toolCardPresentation(entry: TimelineEntry, active: boolean) {
  const tool = describeToolCall(entry.subtitle);
  const state: ToolPartState = tool.status === 'failed' ? 'output-error'
    : tool.status === 'completed' || entry.phase === 'completed' || !active ? 'output-available'
      : 'input-available';
  return {
    label: tool.name || toolKindLabel(tool.kind),
    summary: tool.summary,
    argsText: tool.argsText,
    // ChatTool hides the result section in the error state, so a failed
    // call's output is surfaced as its error text.
    output: state === 'output-error' ? undefined : tool.outputText,
    errorText: state === 'output-error' ? (tool.errorText ?? tool.outputText) : undefined,
    state,
  };
}

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
    <ChainOfThought isStreaming className="chat-process-trace min-w-0">
      <ChainOfThought.Trigger className="min-h-7 py-1 text-xs">{t('chat.waitingBackground', { count: tasks.length })}</ChainOfThought.Trigger>
      <ChainOfThought.Content>
        <ChainOfThought.Steps>
          {tasks.map((task) => {
            const launcher = task.toolUseId ? launchers.get(task.toolUseId) : undefined;
            const tool = launcher ? toolCardPresentation(launcher, true) : undefined;
            const startedAt = task.startedAt ? new Date(task.startedAt) : null;
            const meta = [
              backgroundTaskKind(task.taskType),
              startedAt && !Number.isNaN(startedAt.getTime())
                ? t('chat.backgroundTaskStartedAt', { time: startedAt.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) })
                : '',
            ].filter(Boolean).join(' · ');
            return (
              <ChainOfThought.Step key={task.taskId} label={task.description || tool?.summary || task.taskId}>
                {meta ? <p className="text-muted text-xs">{meta}</p> : null}
                {tool ? <ChatTool defaultExpanded={false} state={tool.state} toolName={tool.summary || tool.label} argsText={tool.argsText} output={tool.output} errorText={tool.errorText} /> : null}
              </ChainOfThought.Step>
            );
          })}
        </ChainOfThought.Steps>
      </ChainOfThought.Content>
    </ChainOfThought>
  );
}

/// Sent attachments open a read-only preview on click/Enter; content comes
/// from the receipt (previewUrl / textContent captured at send time).
function SentAttachmentList({ attachments }: { attachments: SentAttachment[] }) {
  const t = useT();
  const [preview, setPreview] = useState<SentAttachment | null>(null);
  return (
    <>
      <ChatAttachmentGroup aria-label={t('chat.sentAttachments')} className="justify-end text-left" role="list">
        {attachments.map((attachment) => (
          <ChatAttachment
            key={attachment.id}
            mimeType={attachment.mimeType}
            name={attachment.name}
            role="listitem"
            size={attachment.sizeBytes ?? undefined}
            src={attachment.previewUrl}
            className="cursor-pointer"
            tabIndex={0}
            onClick={() => setPreview(attachment)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setPreview(attachment);
              }
            }}
          >
            <ChatAttachment.Preview />
            <ChatAttachment.Info />
          </ChatAttachment>
        ))}
      </ChatAttachmentGroup>
      <SentAttachmentPreview attachment={preview} onOpenChange={(open) => { if (!open) setPreview(null); }} />
    </>
  );
}

const PERMISSION_MODES: readonly PermissionMode[] = ['ask', 'auto', 'full-access'];

function permissionModeLabel(mode: PermissionMode): string {
  switch (mode) {
    case 'ask': return t('chat.permissionAsk');
    case 'auto': return t('chat.permissionAuto');
    default: return t('chat.permissionFullAccess');
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

function ContextUsageIndicator({
  usedTokens,
  contextWindow,
  inputTokens,
  outputTokens,
  cachedInputTokens,
  cacheWriteTokens,
}: {
  usedTokens: number;
  contextWindow?: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
}) {
  const t = useT();
  const percent = contextWindow ? Math.min(100, Math.max(0, usedTokens / contextWindow * 100)) : null;
  const progress = percent ?? 0;
  return (
    <Tooltip delay={100}>
      <Tooltip.Trigger>
        <Button
          isIconOnly
          variant="ghost"
          className="context-usage-ring min-w-0 p-0"
          aria-label={percent === null ? t('chat.contextPending') : t('chat.contextUsed', { percent: percent.toFixed(1) })}
          style={{ background: `conic-gradient(var(--accent) ${progress}%, var(--separator) ${progress}% 100%)` }}
        >
          <span />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <div className="min-w-48 space-y-1 p-1 text-xs">
          <p className="font-medium">{t('chat.contextTitle')}</p>
          {percent === null ? <p className="text-muted">{t('chat.contextWaiting')}</p> : (
            <>
              <p>{formatTokenCount(usedTokens)} / {formatTokenCount(contextWindow!)} tokens · {percent.toFixed(1)}%</p>
              <p className="text-muted">{t('chat.tokensInOut', { input: formatTokenCount(inputTokens), output: formatTokenCount(outputTokens) })}</p>
              <p className="text-muted">{t('chat.tokensCache', { read: formatTokenCount(cachedInputTokens), write: formatTokenCount(cacheWriteTokens) })}</p>
            </>
          )}
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}

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
  const readOnly = conversation?.legacyPlaintext === true;
  const records = entry.turnId ? session.usageRecords.filter(record =>
    (record.conversationId === conversationId || record.conversationId === conversation?.v2ConversationId)
    && record.turnId === entry.turnId) : [];

  return (
    <ChatMessageActions className="mt-1">
      <ChatMessageActions.Copy
        aria-label={t('chat.copyReply')}
        tooltip={t('chat.copyReply')}
        onPress={() => void navigator.clipboard.writeText(entry.subtitle)
          .then(() => toast.success(t('chat.replyCopied')))
          .catch(() => toast.danger(t('chat.copyFailed')))}
      >
        <RiClipboardLine aria-hidden="true" />
      </ChatMessageActions.Copy>
      {readOnly ? null : (
        <ChatMessage.Action
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t('chat.forkConversation')}
          tooltip={canFork ? t('chat.forkConversation') : t('chat.forkUnsupported')}
          isDisabled={!canFork}
          onPress={() => session.forkConversation(conversationId)}
        >
          <RiGitBranchLine aria-hidden="true" />
        </ChatMessage.Action>
      )}
      <HoverCard>
        <HoverCard.Trigger>
          <ChatMessage.Action isIconOnly size="sm" variant="ghost" aria-label={t('chat.replyStats')}>
            <RiBarChartBoxLine aria-hidden="true" />
          </ChatMessage.Action>
        </HoverCard.Trigger>
        <HoverCard.Content>
          <HoverCard.Arrow />
          <TurnUsageSummary records={records} />
        </HoverCard.Content>
      </HoverCard>
    </ChatMessageActions>
  );
}

type ChatTimelineItemProps = {
  item: ChatRenderItem;
  conversationId: string;
  thinking: boolean;
  isStreamingGroup: boolean;
  groupExpanded: boolean;
  groupLoadState: 'loading' | 'error' | undefined;
  groupPendingCount: number;
  request: TodeXSession['pendingRequests'][number] | undefined;
  isActionable: boolean;
  isPendingReply: boolean;
  markdownComponents: NonNullable<MarkdownProps['components']>;
  onHydrateGroup: TodeXSession['hydrateProcessGroup'];
  onApprove: TodeXSession['sendApprovalResponse'];
  setExpandedProcessIds: Dispatch<SetStateAction<Set<string>>>;
  setProcessGroupLoad: Dispatch<SetStateAction<Record<string, 'loading' | 'error'>>>;
  // Excluded from the memo comparison: its members are stable useCallbacks,
  // and the stats AgentMessageActions reads self-correct on the next entry
  // update.
  session: TodeXSession;
};

// Timeline entries keep object identity while unchanged, so an element-wise
// comparison of a group's entries is enough to detect real updates.
/** Rows mounted at the bottom of the chat, and revealed per upward scroll. */
const CHAT_ROW_WINDOW = 60;
const SHOW_ALL_CHAT_ROWS = '\u0000all';

function chatRenderItemKey(item: ChatRenderItem): string {
  return item.type === 'executionGroup' ? item.id : item.entry.id;
}

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
  thinking,
  isStreamingGroup,
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
    return (
      <ChainOfThought
        isExpanded={groupExpanded}
        onExpandedChange={(nextExpanded) => {
          if (nextExpanded && hasStubs) requestDetails();
          setExpandedProcessIds((current) => {
            const next = new Set(current);
            if (nextExpanded) next.add(item.id);
            else next.delete(item.id);
            return next;
          });
        }}
        isStreaming={isStreamingGroup}
        className="chat-process-trace min-w-0"
      >
        <ChainOfThought.Trigger
          className="min-h-7 py-1 text-xs"
        >
          {progressGroupLabel(item.entries, isStreamingGroup, groupPendingCount)}
        </ChainOfThought.Trigger>
        {groupExpanded ? <ChainOfThought.Content>
          {hasStubs ? (
            groupLoadState === 'error' ? (
              <button type="button" className="text-danger cursor-pointer text-xs" onClick={requestDetails}>
                加载过程记录失败，点按重试
              </button>
            ) : (
              <p className="text-muted text-xs">正在加载过程记录…</p>
            )
          ) : (
            <ChainOfThought.Steps>
              {item.entries.map((entry) => {
                if (!isChatToolEntry(entry)) {
                  return (
                    <ChainOfThought.Step key={entry.id} label={entry.title}>
                      <p className="max-w-full overflow-x-auto whitespace-pre-wrap wrap-anywhere text-xs">{entry.subtitle || entry.title}</p>
                    </ChainOfThought.Step>
                  );
                }
                const tool = toolCardPresentation(entry, isStreamingGroup);
                return (
                  <ChainOfThought.Step key={entry.id} label={tool.label}>
                    <ChatTool defaultExpanded={false} state={tool.state} toolName={tool.summary || tool.label} argsText={tool.argsText} output={tool.output} errorText={tool.errorText} />
                  </ChainOfThought.Step>
                );
              })}
            </ChainOfThought.Steps>
          )}
        </ChainOfThought.Content> : null}
      </ChainOfThought>
    );
  }
  const entry = item.entry;
  // End-to-end encrypted history this device holds no key for: one quiet
  // line per turn (docs/history-encryption.md §5.3).
  if (entry.detailLocked) {
    return <p data-message-id={entry.id} role="note" className="text-muted py-1 text-center text-xs">{t('chat.historyLocked')}</p>;
  }
  if (isChatToolEntry(entry)) {
    const tool = toolCardPresentation(entry, thinking);
    return <ChatTool defaultExpanded={false} state={tool.state} toolName={tool.summary ? `${tool.label} · ${tool.summary}` : tool.label} argsText={tool.argsText} output={tool.output} errorText={tool.errorText} triggerPrefix={thinking ? t('chat.toolCalling') : t('chat.toolCalled')} />;
  }
  // Progress narration renders like a normal message; empty detail stubs hide.
  if (entry.category === 'assistant_progress' && !entry.subtitle.trim()) return null;
  const isUser = entry.kind === 'outgoing';
  return (
    <div data-message-id={entry.id} className={`flex gap-3 py-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`min-w-0 max-w-[85%] ${isUser ? 'text-right' : ''}`}>
        {isUser ? <p className="text-muted text-xs font-medium">You</p> : null}
        <div className={`${isUser ? 'mt-1' : ''} text-sm leading-6`}>
          {isUser ? <div className="flex flex-col items-end gap-2">
            {entry.sentAttachments?.length ? (
              <SentAttachmentList attachments={entry.sentAttachments} />
            ) : null}
            {entry.subtitle ? <p className="whitespace-pre-wrap wrap-anywhere">{entry.subtitle === STREAMING_REPLY_PLACEHOLDER ? t('chat.replying') : entry.subtitle}</p> : null}
          </div> : (
            <Markdown
              id={entry.id}
              components={markdownComponents}
            >
              {entry.subtitle === STREAMING_REPLY_PLACEHOLDER ? t('chat.replying') : entry.subtitle}
            </Markdown>
          )}
        </div>
        {entry.kind === 'incoming' && isActionable && !isPendingReply
          ? <AgentMessageActions conversationId={conversationId} entry={entry} session={session} />
          : null}
        {request ? (
          <ChatMessage.Actions>
            <ConversationPermissionActions request={request} deviceSecret={session.settings.deviceSecret} onSelect={(option, data) => { onApprove(option, request, data); }} />
          </ChatMessage.Actions>
        ) : null}
      </div>
      {isUser ? <ChatMessage.Avatar alt="You" fallback="You" /> : null}
    </div>
  );
}, (prev, next) =>
  chatRowItemEqual(prev.item, next.item)
  && prev.conversationId === next.conversationId
  && prev.thinking === next.thinking
  && prev.isStreamingGroup === next.isStreamingGroup
  && prev.groupExpanded === next.groupExpanded
  && prev.groupLoadState === next.groupLoadState
  && prev.groupPendingCount === next.groupPendingCount
  && prev.request === next.request
  && prev.isActionable === next.isActionable
  && prev.isPendingReply === next.isPendingReply
  && prev.markdownComponents === next.markdownComponents
  && prev.onHydrateGroup === next.onHydrateGroup
  && prev.onApprove === next.onApprove);

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
    if (referenceType !== 'app' || hostApps !== null) {
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
  // The session timeline merges every conversation and changes on each
  // streamed frame; this conversation's rows keep their array (and so the
  // render items below) until one of them changes.
  const conversationTimelineRef = useRef<TimelineEntry[]>([]);
  const conversationTimeline = useMemo(() => {
    const next = conversation ? session.timeline.filter((entry) => entry.conversationId === conversation.id) : [];
    if (!sameTimelineEntries(conversationTimelineRef.current, next)) conversationTimelineRef.current = next;
    return conversationTimelineRef.current;
  }, [conversation?.id, session.timeline]);
  const chatEntries = useMemo(() => sortChatEntries(conversationTimeline
    .filter((entry) => isChatTimelineEntry(entry) && !isChatReminderEntry(entry))), [conversationTimeline]);
  const items = useMemo(() => buildChatRenderItems(chatEntries), [chatEntries]);
  const actionableIncoming = useMemo(() => latestIncomingEntryIds(chatEntries), [chatEntries]);
  // Only the newest rows are mounted. Scrolling up reveals loaded rows a
  // window at a time before any older history is fetched; returning to the
  // bottom unmounts them again. `null` slides with the newest rows, a row key
  // pins the window start, and SHOW_ALL_CHAT_ROWS mounts everything.
  const [chatWindowStart, setChatWindowStart] = useState<string | null>(null);
  const chatWindowStartIndex = chatWindowStart === SHOW_ALL_CHAT_ROWS ? 0
    : chatWindowStart ? items.findIndex((item) => chatRenderItemKey(item) === chatWindowStart) : -1;
  const hiddenItemCount = chatWindowStartIndex >= 0 ? chatWindowStartIndex : Math.max(0, items.length - CHAT_ROW_WINDOW);
  const mountedItems = hiddenItemCount > 0 ? items.slice(hiddenItemCount) : items;
  const firstMountedKey = mountedItems[0] ? chatRenderItemKey(mountedItems[0]) : '';
  const pendingMessageJumpRef = useRef('');
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
  const markdownComponents = useMemo<NonNullable<MarkdownProps['components']>>(() => ({
    ...baseMarkdownComponents,
    a: ({ href, children, node: _node, ref: _ref, ...props }) => {
      const target = workspaceLinkTarget(href, workspacePath);
      return (
        <a
          {...props}
          href={href}
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
      oldestEntryId: firstMountedKey,
    };
    if (hiddenItemCount > 0) {
      // Loaded rows are still unmounted: reveal the next window first.
      historyAnchorRef.current = anchor;
      const start = items[Math.max(0, hiddenItemCount - CHAT_ROW_WINDOW)];
      setChatWindowStart(start ? chatRenderItemKey(start) : SHOW_ALL_CHAT_ROWS);
      return;
    }
    if (retry ? !earlierHistoryStatus?.failed || earlierHistoryStatus.loading : !canAutoLoadEarlierHistory(earlierHistoryStatus)) return;
    historyAnchorRef.current = anchor;
    // Fetched rows land above the window start; keep them all mounted.
    setChatWindowStart(SHOW_ALL_CHAT_ROWS);
    void session.loadEarlierHistory(conversation.id);
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
    if (atBottom) {
      // Back at the newest rows: let the window slide again, unmounting the
      // rows revealed while reading older history.
      if (chatWindowStart !== null && !historyAnchorRef.current) setChatWindowStart(null);
    } else if (chatWindowStart === null && hiddenItemCount > 0) {
      // Reading away from the bottom: pin the window so streamed rows do not
      // slide the content under the reader. Functional, so a second scroll
      // event before the re-render cannot undo a reveal already queued.
      setChatWindowStart((current) => current ?? firstMountedKey);
    }
    if (element.scrollTop < 240) requestEarlierHistory();
  };
  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current;
    const element = scrollRef.current;
    if (!element) return;
    if (anchor && anchor.conversationId === conversation?.id) {
      if (firstMountedKey !== anchor.oldestEntryId) {
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
    // top, cannot produce another scroll event: reveal or fetch from here.
    if ((hiddenItemCount > 0 || canAutoLoadEarlierHistory(earlierHistoryStatus))
      && (element.scrollHeight <= element.clientHeight || (!atBottomRef.current && element.scrollTop < 240))) {
      requestEarlierHistory();
    }
    const jumpTarget = pendingMessageJumpRef.current;
    if (jumpTarget) {
      pendingMessageJumpRef.current = '';
      messagesRef.current
        ?.querySelector(`[data-message-id="${CSS.escape(jumpTarget)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [session.timeline, firstMountedKey, earlierHistoryStatus?.loading, conversation?.id]);
  useEffect(() => {
    atBottomRef.current = true;
    lastScrollRef.current = { top: 0, height: 0 };
    setIsAtBottom(true);
    setChatWindowStart(null);
    historyAnchorRef.current = null;
    scrollToLatest();
  }, [conversation?.id]);
  useEffect(() => {
    if (atBottomRef.current) scrollToLatest();
  }, [session.timeline]);
  if (!conversation || !workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <p className="text-sm font-medium">{t('chat.pickConversation')}</p>
        <p className="text-muted mt-1 max-w-sm text-sm">{t('chat.pickConversationHint')}</p>
      </div>
    );
  }

  const attachments = session.composerAttachments[conversation.id] ?? [];
  const currentProvider = isV2Conversation(conversation) ? conversation.provider || '' : '';
  const agentProvider = conversation.provider || (isV2Conversation(conversation) ? '' : 'codex');
  const slashTrigger = draft.trim().startsWith('/') ? draft.trim() : '';
  const liveCommands = currentProvider ? (session.providerCommands[currentProvider as ProviderKind] ?? []) : [];
  const providerSlashCatalog = liveCommands.length > 0
    ? liveCommands.map((item) => ({
      command: `/${item.name}`,
      title: item.name,
      description: item.description || `${item.source} command`,
      category: 'context' as const,
    }))
    : SLASH_COMMANDS;
  const canCompact = !isV2Conversation(conversation)
    || session.v2Providers.find(item => item.id === currentProvider)?.capabilities.controlActions?.includes('compact') === true;
  const slashCatalog = [
    ...(canCompact ? [{ command: '/compact', title: t('chat.compactTitle'), description: t('chat.compactDescription'), category: 'thread' as const }] : []),
    // The synthetic /compact item already covers the catalog entry when the
    // provider offers a native control action; otherwise keep the catalog's.
    ...providerSlashCatalog.filter(item => !canCompact || canonicalSlashCommand(item.command) !== '/compact'),
  ];
  const chooseSlashCommand = (command: string) => {
    if (command === '/compact') {
      if (thinking || executionUnknown || submissionStatus === 'sending' || compaction?.status === 'running') return;
      session.sendSlashCommand(command, conversation.id);
      session.setConversationChatDraft(conversation.id, '');
    } else session.setConversationChatDraft(conversation.id, `${command} `);
  };
  const slashSuggestions = slashTrigger
    ? slashCatalog.filter((item) => canonicalSlashCommand(item.command).startsWith(canonicalSlashCommand(slashTrigger.split(/\s+/)[0] || slashTrigger)))
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
        ? buildChatReferenceSuggestions(referenceQuery, session.conversations, conversation.workspaceId, conversation.id, t('chat.newConversation'))
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
  const thinking = session.thinkingConversations[conversation.id] === true;
  const submissionStatus = session.submissionStatusByConversation[conversation.id];
  const executionUnknown = submissionStatus === 'unknown';
  // Legacy plaintext history (stored before history became end-to-end
  // encrypted): viewable, exportable, archivable and deletable, nothing else.
  const readOnly = conversation.legacyPlaintext === true;
  const runtime = session.conversationRuntimeById[conversation.id];
  const sessionPermissionIds = new Set((runtime?.pendingPermissions ?? []).filter(item => item.scope === 'session').map(item => item.id));
  const pendingPermissionIds = new Set((runtime?.pendingPermissions ?? []).map(item => item.id));
  const permissionRequests = session.pendingRequests.filter(item => item.requestId && pendingPermissionIds.has(item.requestId));
  const compaction = session.compactionByConversation[conversation.id];
  const latestProcessGroupId = activeChatProcessId(items, runtime?.activeTurnId || session.turnIds[conversation.id]);
  // The agent has stopped answering and only waits on provider background tasks (e.g. a CI watcher).
  const backgroundTasks = thinking ? runtime?.backgroundTasks ?? [] : [];
  const backgroundTaskCount = backgroundTasks.length;
  // Once the agent has replied after its last steps, the live status moves
  // below that reply instead of staying on the finished group above it.
  const lastItem = items[items.length - 1];
  const showTrailingStatus = thinking && (backgroundTaskCount > 0 || !latestProcessGroupId) && items.length > 0
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
  const imageInputSupport = conversationImageInputSupport(conversation, session.v2Providers, {
    models: providerModels,
    profileCapability: session.providerImageInput[conversation.id],
  });
  const hasBlockedImageAttachment = !imageInputSupport.supported
    && attachments.some((attachment) => attachment.kind === 'image');
  const attachmentAccept = imageInputSupport.supported
    ? `${COMPOSER_IMAGE_ACCEPT},${COMPOSER_TEXT_ACCEPT}`
    : COMPOSER_TEXT_ACCEPT;
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
  const fastEnabled = workspace.serviceTier === 'priority' || workspace.serviceTier === 'fast';
  const contextUsage = session.contextUsageByConversation[conversation.id];
  const contextModelId = contextUsage?.model || currentModel;
  const currentContextWindow = contextUsage?.contextWindow
    ?? providerModels.find((item) => item.id === contextModelId || item.id.endsWith(`/${contextModelId}`))?.contextWindow;
  const permissionConfig = conversationPermissionCapabilities(conversation, session.v2Providers);
  const permissionModes = (permissionConfig?.modes ?? []).filter((mode) => PERMISSION_MODES.includes(mode));
  const currentPermission = conversationPermissionMode(conversation, workspace, session.v2Providers);
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
      const target = messagesRef.current?.querySelector(`[data-message-id="${CSS.escape(item.messageId)}"]`);
      if (target || hiddenItemCount === 0) {
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      // The quoted message is in the unmounted part of the history.
      pendingMessageJumpRef.current = item.messageId;
      setChatWindowStart(SHOW_ALL_CHAT_ROWS);
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

  const addBrowserFiles = async (files: File[], source: 'clipboard' | 'file' = 'file') => {
    const remaining = MAX_COMPOSER_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      toast.danger(t('chat.maxAttachments', { max: MAX_COMPOSER_ATTACHMENTS }));
      return;
    }
    const nextAttachments: (typeof attachments) = [];
    let reachedLimit = false;
    for (const [index, file] of files.entries()) {
      if (nextAttachments.length >= remaining) {
        reachedLimit = true;
        break;
      }
      try {
        const mimeType = file.type || inferMimeType(file.name);
        const image = isSupportedComposerImage(mimeType);
        if (image && !imageInputSupport.supported) {
          throw new Error(imageInputSupport.reason || t('chat.imageUnsupported'));
        }
        if (!image && isImageMimeType(mimeType) && !isTextFile(file)) {
          throw new Error(t('chat.imageFormats'));
        }
        if (image && file.size > MAX_COMPOSER_IMAGE_BYTES) throw new Error(t('chat.imageTooLarge'));
        if (!image && (!isTextFile(file) || file.size > MAX_COMPOSER_TEXT_BYTES)) {
          throw new Error(t('chat.textAttachmentLimit'));
        }
        const name = uniqueAttachmentName(
          attachmentName(file, index, mimeType, source),
          [...attachments, ...nextAttachments],
          draft,
        );
        nextAttachments.push({
          id: attachmentId(),
          kind: image ? 'image' : 'file',
          name,
          mimeType,
          sizeBytes: file.size,
          dataUrl: image ? await readFileAsDataUrl(file) : '',
          textContent: image ? undefined : await file.text(),
          source,
        });
      } catch (error) {
        toast.danger(error instanceof Error ? error.message : t('chat.attachmentReadFailed'));
      }
    }
    if (nextAttachments.length > 0) {
      session.setConversationAttachments(conversation.id, (current) => [
        ...current,
        ...nextAttachments,
      ].slice(0, MAX_COMPOSER_ATTACHMENTS));
      // Every attachment lives in the draft as a capsule token, exactly like a quote.
      insertAttachmentTokens(nextAttachments.map(attachmentToken));
    }
    if (reachedLimit) {
      toast.danger(t('chat.maxAttachments', { max: MAX_COMPOSER_ATTACHMENTS }));
    }
  };

  // Returns true when the pasted text was converted into a capsule attachment.
  const addPastedText = (text: string): boolean => {
    if (text.replace(/\n+$/, '').split('\n').length <= PASTED_TEXT_MAX_LINES) return false;
    if (attachments.length >= MAX_COMPOSER_ATTACHMENTS) {
      toast.danger(t('chat.maxAttachments', { max: MAX_COMPOSER_ATTACHMENTS }));
      return true;
    }
    const sizeBytes = new TextEncoder().encode(text).length;
    if (sizeBytes > MAX_COMPOSER_TEXT_BYTES) {
      toast.danger(t('chat.textAttachmentLimit'));
      return true;
    }
    const attachment: ComposerAttachmentDraft = {
      id: attachmentId(),
      kind: 'file',
      name: uniqueAttachmentName(t('chat.pastedTextName'), attachments, draft),
      mimeType: 'text/plain',
      sizeBytes,
      dataUrl: '',
      textContent: text,
      source: 'clipboard',
    };
    session.setConversationAttachments(conversation.id, (current) => [...current, attachment]);
    insertAttachmentTokens([attachmentToken(attachment)]);
    return true;
  };

  const submitComposer = () => {
    if (!conversation) return;
    if (readOnly || executionUnknown || submissionStatus === 'sending') return;
    if (hasBlockedImageAttachment) {
      toast.danger(t('chat.imageSendBlocked'), { description: imageInputSupport.reason });
      return;
    }
    if (draft.trim().startsWith('/')) {
      session.sendSlashCommand(draft, conversation.id);
    } else {
      session.submitChat(conversation.id);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <ScrollShadow ref={scrollRef} onScroll={updateScrollPosition} className="h-full px-5 py-5">
        <div ref={messagesRef} className="mx-auto flex max-w-2xl flex-col gap-3">
          {readOnly ? (
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{t('history.readOnlyBanner')}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          {earlierHistoryStatus?.loading ? (
            <p className="text-muted flex items-center justify-center gap-2 py-2 text-xs" role="status">
              <Spinner size="sm" />
              {t('chat.loadingEarlier')}
            </p>
          ) : earlierHistoryStatus?.failed && hiddenItemCount === 0 ? (
            <div className="flex items-center justify-center gap-2 py-1" role="alert">
              <p className="text-danger text-xs">{t('chat.loadEarlierFailed')}</p>
              <Button size="sm" variant="ghost" onPress={() => requestEarlierHistory(true)}>
                {t('chat.retry')}
              </Button>
            </div>
          ) : earlierHistoryStatus?.capped && hiddenItemCount === 0 ? (
            <p className="text-muted py-2 text-center text-xs" role="status">{t('chat.earlierHistoryCapped')}</p>
          ) : earlierHistoryStatus?.hasMore || hiddenItemCount > 0 ? (
            <div className="flex justify-center py-1">
              <Button size="sm" variant="ghost" onPress={() => requestEarlierHistory()}>
                {t('chat.loadEarlier')}
              </Button>
            </div>
          ) : null}
          {items.length === 0 && !thinking && session.openStatusByConversation[conversation.id] === 'failed' ? (
            <div className="flex flex-col items-center gap-2 py-16" role="alert">
              <p className="text-danger text-sm">{t('chat.openHistoryFailed')}</p>
              <Button size="sm" variant="ghost" onPress={() => { void session.recoverConversation(conversation.id); }}>
                {t('chat.retry')}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted py-16 text-center text-sm" role="status">
              {thinking ? t('chat.working')
                : session.openStatusByConversation[conversation.id] === 'opening' ? t('chat.openingHistory')
                  : session.recoveringConversations[conversation.id] ? t('chat.recovering')
                    : t('chat.emptyHint')}
            </p>
          ) : null}
          {mountedItems.map((item) => (
            <ChatTimelineItem
              key={chatRenderItemKey(item)}
              item={item}
              conversationId={conversation.id}
              thinking={thinking}
              isStreamingGroup={item.type === 'executionGroup' && thinking && backgroundTaskCount === 0 && item.id === latestProcessGroupId}
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
              session={session}
            />
          ))}
          {showTrailingStatus ? (
            backgroundTaskCount > 0 ? <BackgroundTasksStatus tasks={backgroundTasks} items={items} /> : (
              <p className="text-muted min-h-7 py-1 text-xs" role="status">
                <TextShimmer>{t('chat.working')}</TextShimmer>
              </p>
            )
          ) : null}
        </div>
        </ScrollShadow>
        {isAtBottom ? null : (
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-4 bottom-3 z-10 shadow-md"
            onPress={() => scrollToLatest('smooth')}
          >
            <RiArrowDownDoubleLine className="size-4" />
            {t('chat.scrollToLatest')}
          </Button>
        )}
      </div>
      {quote ? (
        <div className="fixed z-50 -translate-x-1/2" style={{ left: quote.left, top: quote.top }}>
          <Button size="sm" variant="secondary" onPress={() => {
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
          session.setConversationAttachments(conversation.id, (current) =>
            current.map((entry) => entry.id === item.id
              ? { ...entry, textContent: text, sizeBytes: new TextEncoder().encode(text).length }
              : entry));
          setPreviewAttachment(null);
        }}
      />
      <div className="border-separator border-t px-5 py-4">
        <div className="composer-container mx-auto max-w-2xl">
          <ComputerLiveView session={session} conversationId={conversation.v2ConversationId ?? conversation.id} state={session.conversationRuntimeById[conversation.id]?.desktopComputer} />
          {readOnly ? null : permissionRequests.map(request => <PermissionRequestCard
            key={request.requestId}
            request={request}
            fallbackTitle={sessionPermissionIds.has(request.requestId) ? t('chat.piPluginRequest') : request.title || t('chat.permissionApproval')}
            deviceSecret={session.settings.deviceSecret}
            onSelect={(option, data) => { session.sendApprovalResponse(option, request, data); }}
          />)}
          {(slashSuggestions.length > 0 || referenceSuggestions.length > 0 || (mentionActive && referenceSuggestions.length === 0) || capabilityActive) ? (
            <div ref={suggestionsPopoverRef} className="composer-suggestions-popover">
              {slashSuggestions.length > 0 ? (
                <ListBox
                  aria-label={t('chat.commandSuggestions')}
                  onAction={(key) => {
                    const item = slashSuggestions.find((candidate) => candidate.command === String(key));
                    if (item) chooseSlashCommand(item.command);
                  }}
                >
                  {slashSuggestions.slice(0, 12).map((item, index) => (
                    <ListBox.Item key={item.command} id={item.command} isDisabled={item.command === '/compact' && (thinking || executionUnknown || submissionStatus === 'sending' || compaction?.status === 'running')} textValue={`${item.command} ${item.description}`} className={`composer-suggestion-item ${index === suggestionIndex ? 'composer-suggestion-item--active' : ''}`}>
                      <span className="composer-suggestion-command">{item.command}</span>
                      <span className="composer-suggestion-description">{item.description}</span>
                    </ListBox.Item>
                  ))}
                </ListBox>
              ) : capabilityActive ? (
                capabilitySuggestions.length > 0 ? (
                  <ListBox
                    aria-label={t('chat.capabilitySuggestions')}
                    onAction={(key) => {
                      const item = capabilitySuggestions.find((candidate) => candidate.id === String(key));
                      if (item && capability) applyCapabilitySuggestion(item, capability);
                    }}
                  >
                    {capabilitySuggestions.map((item, index) => (
                      <ListBox.Item key={item.id} id={item.id} textValue={`#${item.name} ${item.description}`} className={`composer-suggestion-item ${index === suggestionIndex ? 'composer-suggestion-item--active' : ''}`}>
                        <span className="composer-suggestion-command">#{item.name}</span>
                        <span className="composer-suggestion-description">{capabilityDescription(item)}</span>
                      </ListBox.Item>
                    ))}
                  </ListBox>
                ) : (
                  <p className="text-muted px-2 py-1 text-xs">{capabilityLoading ? t('chat.loadingCapabilities') : t('chat.noCapabilities')}</p>
                )
              ) : referenceSuggestions.length > 0 ? (
                <>
                  <ListBox
                    aria-label={t('chat.referenceSuggestions')}
                    onAction={(key) => {
                      const item = referenceSuggestions.find((candidate) => candidate.id === String(key));
                      if (item) applyReferenceSuggestion(item);
                    }}
                  >
                    {referenceSuggestions.map((item, index) => (
                      <ListBox.Item key={item.id} id={item.id} textValue={`${item.label} ${item.description}`} className={`composer-suggestion-item ${index === suggestionIndex ? 'composer-suggestion-item--active' : ''}`}>
                        <span className="composer-suggestion-command">{item.label}</span>
                        <span className="composer-suggestion-description">
                          {item.action.kind === 'capability' ? capabilityDescription(item.action.item) : item.description}
                        </span>
                      </ListBox.Item>
                    ))}
                  </ListBox>
                  {referenceType === 'folder' && entryResults.truncated ? <p className="text-muted px-2 py-1 text-xs">{t('chat.folderSearchHint')}</p> : null}
                </>
              ) : mention ? <p className="text-muted px-2 py-1 text-xs">{referenceEmptyText}</p> : null}
            </div>
          ) : null}
          {(session.selectedSkills[conversation.id] ?? []).length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {(session.selectedSkills[conversation.id] ?? []).map((skill) => (
                <Button
                  key={skill.resourceId || `${skill.name}:${skill.path}`}
                  size="sm"
                  variant="tertiary"
                  onPress={() => session.setConversationSelectedSkills(conversation.id, (current) =>
                    current.filter((item) => (item.resourceId || item.name) !== (skill.resourceId || skill.name)))}
                >
                  Skill · {skill.displayName || skill.name} ×
                </Button>
              ))}
            </div>
          ) : null}
          <NoticeToast
            message={!currentPermission && agentProvider !== 'pi' && session.connectionState === 'open'
              && session.v2Providers.some(provider => provider.id === agentProvider) ? permissionHint : null}
            scope={conversation.id}
          />
          <ConversationRunStatus
            isRecovering={session.recoveringConversations[conversation.id] === true}
            isConnected={session.connectionState === 'open'}
            submissionStatus={submissionStatus}
            runtime={runtime}
            compaction={compaction}
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
          <NoticeToast message={hasBlockedImageAttachment ? t('chat.imageSendBlocked') : null}
            description={imageInputSupport.reason} scope={conversation.id} />
          <ChatAttachmentInput
            accept={attachmentAccept}
            disabled={readOnly || executionUnknown || attachments.length >= MAX_COMPOSER_ATTACHMENTS}
            multiple
            onFilesSelected={(files) => { void addBrowserFiles(files); }}
          >
            <ConversationPromptInput
              submissionStatus={submissionStatus}
              value={draft}
              status={submissionStatus === 'sending' ? 'submitted' : thinking ? 'streaming' : 'ready'}
              isDisabled={readOnly || executionUnknown}
              onKeyDownCapture={(event) => {
                if (event.key === 'Enter' && (isComposingRef.current || isImeCompositionKey(event))) {
                  event.stopPropagation();
                }
              }}
              onValueChange={(value: string) => { setSuggestionIndex(0); session.setConversationChatDraft(conversation.id, value); }}
              onSubmit={submitComposer}
              onStop={() => session.stopThinking(conversation.id)}
            >
              <PromptInput.Shell
                data-dragging={isDraggingAttachment || undefined}
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
                  const files = Array.from(event.dataTransfer.files);
                  if (files.length === 0) return;
                  event.preventDefault();
                  setIsDraggingAttachment(false);
                  void addBrowserFiles(files);
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
              >
                <PromptInput.Content
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) {
                      event.preventDefault();
                      composerRef.current?.focus();
                    }
                  }}
                >
                  <ReferenceComposer
                    ref={composerRef}
                    value={draft}
                    isDisabled={readOnly || executionUnknown}
                    placeholder={readOnly ? t('history.readOnlyPlaceholder')
                      : imageInputSupport.supported
                        ? t('chat.placeholderFull')
                        : t('chat.placeholderText')}
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
                    onKeyDown={handleSuggestionKeyDown}
                    onSelectionChange={(selection) => session.setConversationComposerSelection(conversation.id, selection)}
                    onCompositionStart={() => { isComposingRef.current = true; }}
                    onCompositionEnd={() => { isComposingRef.current = false; }}
                    resolveTokenLabel={(kind, name) => {
                      const item = attachments.find((entry) => entry.kind === kind && entry.name === name);
                      if (!item) return undefined;
                      return item.kind === 'reference' ? referencePreview(item.textContent) || item.name : item.name;
                    }}
                    onTokenClick={(kind, name) => {
                      const item = attachments.find((entry) => entry.kind === kind && entry.name === name);
                      if (item) setPreviewAttachment(item);
                    }}
                  />
                </PromptInput.Content>
                <PromptInput.Toolbar className="composer-toolbar">
                  <PromptInput.ToolbarStart className="min-w-0 flex-1">
                    <Select
                      className="composer-control"
                      variant="secondary"
                      placeholder={t('chat.selectAgent')}
                      selectedKey={currentProvider || agentProvider || null}
                      isDisabled={readOnly || !canSwitchAgent}
                      onSelectionChange={(key) => {
                        if (typeof key !== 'string' || !key || key === currentProvider) {
                          return;
                        }
                        session.switchConversationAgent(conversation.id, key as ProviderKind);
                      }}
                    >
                      <Label className="hidden">{t('chat.selectAgent')}</Label>
                      <Select.Trigger className="composer-control__trigger">
                        <Select.Value><ProviderIcon className="composer-control__icon" provider={agentProvider} /><span className="composer-control__text">{agentLabel}</span></Select.Value>
                        <Select.Indicator className="composer-control__indicator" />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {availableProviders.map((item) => (
                            <ListBox.Item
                              key={item.id}
                              id={item.id}
                              textValue={providerDisplayName(item.id, item.displayName)}
                            >
                              <ProviderIcon provider={item.id} />
                              {providerDisplayName(item.id, item.displayName)}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Popover>
                      <Button
                        className={`composer-control composer-model-control__trigger ${displayedReasoningEffort ? 'has-effort' : ''}`}
                        size="sm"
                        variant="secondary"
                        isDisabled={readOnly || providerModels.length === 0}
                        aria-label={t('chat.selectModel')}
                        data-effort={displayedEffortLevel}
                      >
                        <RiCpuLine className={`composer-control__icon ${displayedReasoningEffort ? 'text-accent' : ''}`} />
                        <span className="composer-control__text">{modelDisplayLabel(currentModel, session.modelCatalog)}</span>
                        {displayedReasoningEffort ? (
                          <span className="composer-control__effort">
                            · {reasoningEffortLabel(displayedReasoningEffort)}
                          </span>
                        ) : null}
                      </Button>
                      <Popover.Content className="composer-model-popover" placement="top start" offset={8}>
                        <Popover.Dialog className="composer-model-popover__dialog" aria-label={t('chat.modelPopover')}>
                          <ModelReasoningCard
                            currentModel={currentModel}
                            currentModelDescriptor={currentModelDescriptor}
                            modelCatalog={session.modelCatalog}
                            providerModels={providerModels}
                            supportedReasoningEfforts={supportedReasoningEfforts}
                            currentReasoningEffort={currentReasoningEffort}
                            displayedReasoningEffort={displayedReasoningEffort}
                            fastEnabled={fastEnabled}
                            canToggleFast={agentProvider === 'codex'}
                            onToggleFast={() => session.toggleFastServiceTier(conversation.id)}
                            onSelectModel={(modelId) => {
                              session.applyConversationModelSelection(conversation.id, modelId, null);
                            }}
                            onSelectReasoningEffort={(effort) => {
                              session.applyConversationModelSelection(conversation.id, currentModel, effort);
                            }}
                          />
                        </Popover.Dialog>
                      </Popover.Content>
                    </Popover>
                    <Select
                      className="composer-control"
                      variant="secondary"
                      selectedKey={currentPermission}
                      isDisabled={readOnly || thinking || executionUnknown || !canChoosePermission || (fixedPermission && currentPermission !== null)}
                      onSelectionChange={(key) => {
                        if (typeof key === 'string' && permissionModes.includes(key as PermissionMode)) {
                          void session.applyConversationPermissionMode(conversation.id, key as PermissionMode);
                        }
                      }}
                    >
                      <Label className="hidden">{t('chat.selectPermission')}</Label>
                      <Select.Trigger className="composer-control__trigger">
                        <Select.Value><RiShieldLine className="composer-control__icon" /><span className="composer-control__text" title={permissionHint}>{currentPermission ? permissionModeLabel(currentPermission) : canChoosePermission ? t('chat.permissionSelect') : t('chat.permissionUnavailable')}</span></Select.Value>
                        {!fixedPermission ? <Select.Indicator className="composer-control__indicator" /> : null}
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {permissionModes.map((mode) => (
                            <ListBox.Item key={mode} id={mode} textValue={permissionModeLabel(mode)}>
                              {permissionModeLabel(mode)}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    {permissionConfig?.supportsPlan ? <Select
                      className="composer-control"
                      variant="secondary"
                      selectedKey={conversation.mode === 'plan' ? 'plan' : 'implement'}
                      isDisabled={readOnly || thinking || executionUnknown}
                      onSelectionChange={(key) => {
                        if (key === 'plan' || key === 'implement') {
                          void session.applyConversationWorkMode(conversation.id, key);
                        }
                      }}
                    >
                      <Label className="hidden">{t('chat.selectWorkMode')}</Label>
                      <Select.Trigger className="composer-control__trigger">
                        <Select.Value><RiListCheck2 className="composer-control__icon" /><span className="composer-control__text" title={t('chat.workModeApply')}>{conversation.mode === 'plan' ? t('chat.modePlan') : t('chat.modeImplement')}</span></Select.Value>
                        <Select.Indicator className="composer-control__indicator" />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="implement" textValue={t('chat.modeImplement')}>{t('chat.modeImplement')}<ListBox.ItemIndicator /></ListBox.Item>
                          <ListBox.Item id="plan" textValue={t('chat.modePlan')}>{t('chat.modePlan')}<ListBox.ItemIndicator /></ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select> : null}
                  </PromptInput.ToolbarStart>
                  <PromptInput.ToolbarEnd className="gap-2">
                    <ChatAttachmentInput.Trigger
                      aria-label={t('chat.addAttachment')}
                      render={({ isDisabled, onPress }) => (
                        <Tooltip>
                          <Tooltip.Trigger>
                            <Button isIconOnly variant="ghost" aria-label={t('chat.addAttachment')} isDisabled={isDisabled} onPress={onPress}>
                              <RiAttachment2 className="size-4" />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>
                            {attachments.length >= MAX_COMPOSER_ATTACHMENTS
                              ? t('chat.maxAttachmentsTooltip', { max: MAX_COMPOSER_ATTACHMENTS })
                              : imageInputSupport.supported ? t('chat.addImageOrText') : t('chat.addTextAttachment')}
                          </Tooltip.Content>
                        </Tooltip>
                      )}
                    />
                    <ContextUsageIndicator
                      usedTokens={contextUsage?.usedTokens ?? 0}
                      contextWindow={currentContextWindow}
                      inputTokens={contextUsage?.inputTokens ?? 0}
                      outputTokens={contextUsage?.outputTokens ?? 0}
                      cachedInputTokens={contextUsage?.cachedInputTokens ?? 0}
                      cacheWriteTokens={contextUsage?.cacheWriteTokens ?? 0}
                    />
                    {thinking && !readOnly ? (
                      <Button variant="danger-soft" onPress={() => session.stopThinking(conversation.id)}>
                        <RiStopCircleLine className="size-4" />
                        {t('chat.stop')}
                      </Button>
                    ) : null}
                  </PromptInput.ToolbarEnd>
                </PromptInput.Toolbar>
              </PromptInput.Shell>
            </ConversationPromptInput>
          </ChatAttachmentInput>
        </div>
      </div>
    </div>
  );
}


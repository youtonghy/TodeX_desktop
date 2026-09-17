import { ConversationControls } from '../components/ConversationControls';
import { NoticeToast } from '../components/NoticeToast';
import { RiArrowDownDoubleLine, RiAttachment2, RiBarChartBoxLine, RiClipboardLine, RiCpuLine, RiGitBranchLine, RiListCheck2, RiShieldLine, RiStopCircleLine } from '@remixicon/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button, Label, ListBox, Popover, ScrollShadow, Select, Tooltip, toast } from '@heroui/react';
import { ChainOfThought, ChatAttachment, ChatAttachmentGroup, ChatAttachmentInput, ChatMessage, HoverCard, PromptInput } from '@heroui-pro/react';
import { ChatMessageActions } from '@heroui-pro/react/chat-message-actions';
import { ChatTool } from '@heroui-pro/react/chat-tool';
import { Markdown, type MarkdownProps } from '@heroui-pro/react/markdown';
import { providerDisplayName, type ProviderKind, type PermissionMode } from '@todex/protocol/v2';
import { ConversationPermissionActions, ConversationPromptInput, ConversationRunStatus, TurnUsageSummary } from '../components/ConversationRunStatus';
import { ReferenceComposer, type ReferenceComposerHandle } from '../components/ReferenceComposer';
import { ComposerAttachmentPreview } from '../components/ComposerAttachmentPreview';
import { activeChatProcessId, buildChatRenderItems, isChatTimelineEntry, isChatToolEntry, latestIncomingEntryIds } from '../components/conversationTimeline';
import type { ChatRenderItem } from '../components/conversationTimeline';
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
  buildMentionSuggestions,
  insertMention,
  canonicalSlashCommand,
  modelDisplayLabel,
  reasoningEffortLabel,
  referencePreview,
  referenceToken,
  uniqueAttachmentName,
  workspaceLinkTarget,
  STREAMING_REPLY_PLACEHOLDER,
  type ComposerAttachmentDraft,
} from '../session/helpers';
import { selectionInside } from '../lib/selection';
import { findCapabilityHashTrigger, insertCapabilityReference } from '@todex/protocol/todex';
import { buildCapabilitySuggestions, capabilityCatalogsPending, type CapabilitySuggestion } from '@todex/protocol/capabilityCatalog';
import { getLocale, t, useT } from '../i18n';

type Props = {
  session: TodeXSession;
};

const MAX_COMPOSER_IMAGE_BYTES = 2_500_000;
const MAX_COMPOSER_TEXT_BYTES = 512 * 1024;
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

function toolPresentation(raw: string) {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const toolName = typeof value.toolName === 'string' ? value.toolName
      : typeof value.tool === 'string' ? value.tool
        : typeof value.command === 'string' ? t('chat.toolCommand') : t('chat.toolCall');
    const args = value.arguments ?? value.input ?? (typeof value.command === 'string' ? { command: value.command } : undefined);
    const emptyObject = typeof args === 'object' && args !== null && !Array.isArray(args) && Object.keys(args).length === 0;
    const argsText = typeof args === 'string' ? args
      : args === undefined || args === null || emptyObject ? ''
        : JSON.stringify(args, null, 2);
    return { toolName, argsText };
  } catch {
    return { toolName: t('chat.toolCall'), argsText: raw };
  }
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
  const composerSelectionRef = useRef(session.composerSelections[conversation?.id ?? '']);
  composerSelectionRef.current = session.composerSelections[conversation?.id ?? ''];
  const mention = findMentionTrigger(draft, conversation ? (session.composerSelections[conversation.id]?.end ?? draft.length) : 0);
  const capability = conversation ? findCapabilityHashTrigger(draft, session.composerSelections[conversation.id]?.end ?? draft.length) : null;
  // `@` and `#` can both parse when one wraps the other (`@file#x`); the
  // trigger closest to the caret wins.
  const mentionActive = Boolean(mention && (!capability || mention.start > capability.start));
  const capabilityActive = Boolean(capability && !mentionActive);
  const [mentionSuggestions, setMentionSuggestions] = useState<Array<{ id: string; title: string; description: string; insertText: string }>>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [expandedProcessIds, setExpandedProcessIds] = useState<Set<string>>(() => new Set());
  const [processGroupLoad, setProcessGroupLoad] = useState<Record<string, 'loading' | 'error'>>({});
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<ComposerAttachmentDraft | null>(null);
  const isComposingRef = useRef(false);
  useEffect(() => {
    let active = true;
    if (!mention || !workspace) {
      setMentionSuggestions([]);
      return () => { active = false; };
    }
    void session.fetchWorkspaceEntries(workspace.path, mention.query)
      .then((result) => {
        if (active) setMentionSuggestions(buildMentionSuggestions(mention, result.entries));
      })
      .catch(() => {
        if (active) setMentionSuggestions([]);
      });
    return () => { active = false; };
  }, [mention?.query, mention?.start, workspace?.path, session.fetchWorkspaceEntries]);
  const chatEntries = useMemo(() => {
    if (!conversation) return [];
    return session.timeline
      .filter((entry) => entry.conversationId === conversation.id)
      .filter((entry) => isChatTimelineEntry(entry) && !isChatReminderEntry(entry))
      .slice()
      .sort((left, right) => {
        if (left.sequence !== undefined && right.sequence !== undefined && left.sequence !== right.sequence) {
          return left.sequence - right.sequence;
        }
        if (left.at !== right.at) return left.at - right.at;
        return left.id.localeCompare(right.id);
      });
  }, [conversation?.id, session.timeline]);
  const items = useMemo(() => buildChatRenderItems(chatEntries), [chatEntries]);
  const actionableIncoming = useMemo(() => latestIncomingEntryIds(chatEntries), [chatEntries]);
  /** Folded groups fetched as summary stubs load their full events on expand;
   * a failed load keeps a retryable error state per group. */
  const requestProcessDetails = (item: Extract<ChatRenderItem, { type: 'executionGroup' }>) => {
    if (!conversation) return;
    const sequences = item.entries
      .filter((entry) => entry.detailStub)
      .map((entry) => entry.sequence ?? 0)
      .filter((sequence) => sequence > 0);
    if (!sequences.length || processGroupLoad[item.id] === 'loading') return;
    setProcessGroupLoad((current) => ({ ...current, [item.id]: 'loading' }));
    void session.hydrateProcessGroup(conversation.id, Math.min(...sequences), Math.max(...sequences))
      .then((hydrated) => setProcessGroupLoad((current) => {
        const next = { ...current };
        if (hydrated) delete next[item.id];
        else next[item.id] = 'error';
        return next;
      }))
      .catch(() => setProcessGroupLoad((current) => ({ ...current, [item.id]: 'error' })));
  };
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
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollToLatest = (behavior: ScrollBehavior = 'auto') => {
    const element = scrollRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior });
  };
  const updateScrollPosition = () => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    atBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  };
  useEffect(() => {
    atBottomRef.current = true;
    setIsAtBottom(true);
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
    ...providerSlashCatalog.filter(item => canonicalSlashCommand(item.command) !== '/compact'),
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
  const capabilitySuggestions = capabilityActive && capability
    ? buildCapabilitySuggestions(session.capabilityCatalogs, capabilityProviderOrder, capability.query, {
      isSkillAttached: (skill) => selectedSkillAttachments.some(item =>
        item.resourceId === skill.resourceId || (item.name === skill.name && item.path === skill.source)),
    })
    : [];
  const capabilityLoading = capabilityActive && capabilityCatalogsPending(session.capabilityCatalogs, capabilityProviderOrder);
  const applyCapabilitySuggestion = (item: CapabilitySuggestion) => {
    if (!capability) return;
    if (item.kind === 'skill') {
      // Attaching produces the same chip the capability manager creates, so
      // the `#name` trigger text is dropped instead of sent as literal text.
      session.toggleCatalogSkill(conversation.id, item.skill, item.provider);
      session.setConversationChatDraft(conversation.id, insertCapabilityReference(draft, capability, ''));
      session.setConversationComposerSelection(conversation.id, { start: capability.start, end: capability.start });
      composerRef.current?.focus(capability.start);
      return;
    }
    const insertText = `#${item.name} `;
    session.setConversationChatDraft(conversation.id, insertCapabilityReference(draft, capability, insertText));
    const cursor = capability.start + insertText.length;
    session.setConversationComposerSelection(conversation.id, { start: cursor, end: cursor });
    composerRef.current?.focus(cursor);
  };
  const suggestionCount = slashSuggestions.length > 0
    ? Math.min(12, slashSuggestions.length)
    : capabilityActive ? capabilitySuggestions.length : mentionSuggestions.length;
  const applySuggestion = (index: number) => {
    if (slashSuggestions.length > 0) {
      const item = slashSuggestions[index];
      if (item) chooseSlashCommand(item.command);
      return;
    }
    if (capabilityActive) {
      const item = capabilitySuggestions[index];
      if (item) applyCapabilitySuggestion(item);
      return;
    }
    const item = mentionSuggestions[index];
    if (!item || !mention) return;
    session.setConversationChatDraft(conversation.id, insertMention(draft, mention, item.insertText));
    const cursor = mention.start + item.insertText.length;
    session.setConversationComposerSelection(conversation.id, { start: cursor, end: cursor });
    composerRef.current?.focus(cursor);
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
  const runtime = session.conversationRuntimeById[conversation.id];
  const sessionPermissionIds = new Set((runtime?.pendingPermissions ?? []).filter(item => item.scope === 'session').map(item => item.id));
  const pendingPermissionIds = new Set((runtime?.pendingPermissions ?? []).map(item => item.id));
  const permissionRequests = session.pendingRequests.filter(item => item.requestId && pendingPermissionIds.has(item.requestId));
  const compaction = session.compactionByConversation[conversation.id];
  const latestProcessGroupId = activeChatProcessId(items, runtime?.activeTurnId || session.turnIds[conversation.id]);
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
  const conversationTimeline = session.timeline.filter((entry) => entry.conversationId === conversation.id);
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

  const isToolCallEntry = isChatToolEntry;

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
    if (executionUnknown || submissionStatus === 'sending') return;
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
          {items.length === 0 ? (
            <p className="text-muted py-16 text-center text-sm" role="status">
              {thinking ? t('chat.working')
                : session.recoveringConversations[conversation.id] ? t('chat.recovering')
                  : t('chat.emptyHint')}
            </p>
          ) : null}
          {items.map((item) => {
            if (item.type === 'executionGroup') {
              const expanded = expandedProcessIds.has(item.id);
              const hasStubs = item.entries.some((entry) => entry.detailStub);
              const loadState = processGroupLoad[item.id];
              const pendingCount = item.entries.filter((entry) => entry.requestId && session.pendingRequests.some((request) => request.requestId === entry.requestId)).length;
              return (
                <ChainOfThought
                  key={item.id}
                  isExpanded={expanded}
                  onExpandedChange={(nextExpanded) => {
                    if (nextExpanded && hasStubs) requestProcessDetails(item);
                    setExpandedProcessIds((current) => {
                      const next = new Set(current);
                      if (nextExpanded) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    });
                  }}
                  isStreaming={thinking && item.id === latestProcessGroupId}
                  className="chat-process-trace min-w-0"
                >
                  <ChainOfThought.Trigger
                    className="min-h-7 py-1 text-xs"
                  >
                    {progressGroupLabel(item.entries, thinking && item.id === latestProcessGroupId, pendingCount)}
                  </ChainOfThought.Trigger>
                  {expanded ? <ChainOfThought.Content>
                    {hasStubs ? (
                      loadState === 'error' ? (
                        <button type="button" className="text-danger cursor-pointer text-xs" onClick={() => requestProcessDetails(item)}>
                          加载过程记录失败，点按重试
                        </button>
                      ) : (
                        <p className="text-muted text-xs">正在加载过程记录…</p>
                      )
                    ) : (
                      <ChainOfThought.Steps>
                        {item.entries.map((entry) => (
                          <ChainOfThought.Step key={entry.id} label={entry.title}>
                            {isToolCallEntry(entry) ? (() => {
                              const { toolName, argsText } = toolPresentation(entry.subtitle);
                              return <ChatTool defaultExpanded={false} state={entry.phase === 'completed' ? 'output-available' : 'input-streaming'} toolName={toolName} argsText={argsText} />;
                            })() : <p className="max-w-full overflow-x-auto whitespace-pre-wrap wrap-anywhere text-xs">{entry.subtitle || entry.title}</p>}
                          </ChainOfThought.Step>
                        ))}
                      </ChainOfThought.Steps>
                    )}
                  </ChainOfThought.Content> : null}
                </ChainOfThought>
              );
            }
            const entry = item.entry;
            if (isToolCallEntry(entry)) {
              const { toolName, argsText } = toolPresentation(entry.subtitle);
              return <ChatTool key={entry.id} defaultExpanded={false} state={entry.phase === 'completed' ? 'output-available' : 'input-streaming'} toolName={toolName} argsText={argsText} triggerPrefix={thinking ? t('chat.toolCalling') : t('chat.toolCalled')} />;
            }
            const request = session.pendingRequests.find((pendingItem) => pendingItem.requestId && (entry.requestId === pendingItem.requestId || entry.raw.includes(pendingItem.requestId)));
            const isUser = entry.kind === 'outgoing';
            return (
              <div key={entry.id} data-message-id={entry.id} className={`flex gap-3 py-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`min-w-0 max-w-[85%] ${isUser ? 'text-right' : ''}`}>
                  {isUser ? <p className="text-muted text-xs font-medium">You</p> : null}
                  <div className={`${isUser ? 'mt-1' : ''} text-sm leading-6`}>
                    {isUser ? <div className="flex flex-col items-end gap-2">
                      {entry.sentAttachments?.length ? (
                        <ChatAttachmentGroup aria-label={t('chat.sentAttachments')} className="justify-end text-left" role="list">
                          {entry.sentAttachments.map((attachment) => (
                            <ChatAttachment
                              key={attachment.id}
                              mimeType={attachment.mimeType}
                              name={attachment.name}
                              role="listitem"
                              size={attachment.sizeBytes ?? undefined}
                              src={attachment.previewUrl}
                            >
                              <ChatAttachment.Preview />
                              <ChatAttachment.Info />
                            </ChatAttachment>
                          ))}
                        </ChatAttachmentGroup>
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
                  {entry.kind === 'incoming' && actionableIncoming.has(entry.id) && entry.id !== pendingReplyId
                    ? <AgentMessageActions conversationId={conversation.id} entry={entry} session={session} />
                    : null}
                  {request ? (
                    <ChatMessage.Actions>
                      <ConversationPermissionActions request={request} onSelect={(option, data) => { session.sendApprovalResponse(option, request, data); }} />
                    </ChatMessage.Actions>
                  ) : null}
                </div>
                {isUser ? <ChatMessage.Avatar alt="You" fallback="You" /> : null}
              </div>
            );
          })}
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
          {permissionRequests.map(request => <div key={request.requestId} className="mb-3 rounded-xl border border-separator p-3">
            <p className="mb-2 text-xs font-medium">{sessionPermissionIds.has(request.requestId) ? t('chat.piPluginRequest') : request.title || t('chat.permissionApproval')}</p>
            <ConversationPermissionActions request={request} onSelect={(option, data) => { session.sendApprovalResponse(option, request, data); }} />
          </div>)}
          {(slashSuggestions.length > 0 || mentionSuggestions.length > 0 || (mentionActive && mentionSuggestions.length === 0) || capabilityActive) ? (
            <div className="composer-suggestions-popover">
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
                      if (item) applyCapabilitySuggestion(item);
                    }}
                  >
                    {capabilitySuggestions.map((item, index) => (
                      <ListBox.Item key={item.id} id={item.id} textValue={`#${item.name} ${item.description}`} className={`composer-suggestion-item ${index === suggestionIndex ? 'composer-suggestion-item--active' : ''}`}>
                        <span className="composer-suggestion-command">#{item.name}</span>
                        <span className="composer-suggestion-description">
                          {item.kind === 'skill'
                            ? `Skill${item.attached ? ` · ${t('chat.capabilityAttached')}` : ''}${item.description ? ` · ${item.description}` : ''}`
                            : `MCP${item.description ? ` · ${item.description}` : ''}`}
                        </span>
                      </ListBox.Item>
                    ))}
                  </ListBox>
                ) : (
                  <p className="text-muted px-2 py-1 text-xs">{capabilityLoading ? t('chat.loadingCapabilities') : t('chat.noCapabilities')}</p>
                )
              ) : mentionSuggestions.length > 0 ? (
                <ListBox
                  aria-label={t('chat.fileSuggestions')}
                  onAction={(key) => {
                    const item = mentionSuggestions.find((candidate) => candidate.id === String(key));
                    if (!item || !mention) return;
                    session.setConversationChatDraft(conversation.id, insertMention(draft, mention, item.insertText));
                    const cursor = mention.start + item.insertText.length;
                    session.setConversationComposerSelection(conversation.id, { start: cursor, end: cursor });
                    composerRef.current?.focus(cursor);
                  }}
                >
                  {mentionSuggestions.map((item, index) => (
                    <ListBox.Item key={item.id} id={item.id} textValue={`@${item.title} ${item.description}`} className={`composer-suggestion-item ${index === suggestionIndex ? 'composer-suggestion-item--active' : ''}`}>
                      <span className="composer-suggestion-command">@{item.title}</span>
                      <span className="composer-suggestion-description">{item.description}</span>
                    </ListBox.Item>
                  ))}
                </ListBox>
              ) : mention ? <p className="text-muted px-2 py-1 text-xs">{t('chat.searchingFiles')}</p> : null}
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
            onRecover={() => session.recoverConversation(conversation.id)}
          />
          {conversation.v2ConversationId ? <ConversationControls
            runtime={runtime}
            reportedError={session.lastError}
            running={thinking}
            canUseNativeQueue={providerDescriptor?.capabilities.followUpQueue === true}
            piQueue={currentProvider === 'pi'}
            controlStatus={session.controlStatusByConversation[conversation.id]}
            localQueue={session.queuedChatDrafts[conversation.id] ?? []}
            localPaused={session.queuePausedByConversation[conversation.id] === true}
            onRecover={() => { void session.recoverConversation(conversation.id); }}
            onRemoveNative={itemId => { void session.controlConversation(conversation.id, { action: 'queueRemove', itemId }); }}
            onClearNative={() => { void session.controlConversation(conversation.id, { action: 'queueClear' }); }}
            onRemoveLocal={itemId => session.removeQueuedFollowUp(conversation.id, itemId)}
            onResumeLocal={() => { void session.resumeQueuedFollowUps(conversation.id); }}
            onRevealPath={filePath => session.openPanel('Files', { filePath })}
          /> : null}
          <NoticeToast message={hasBlockedImageAttachment ? t('chat.imageSendBlocked') : null}
            description={imageInputSupport.reason} scope={conversation.id} />
          <ChatAttachmentInput
            accept={attachmentAccept}
            disabled={executionUnknown || attachments.length >= MAX_COMPOSER_ATTACHMENTS}
            multiple
            onFilesSelected={(files) => { void addBrowserFiles(files); }}
          >
            <ConversationPromptInput
              submissionStatus={submissionStatus}
              value={draft}
              status={submissionStatus === 'sending' ? 'submitted' : thinking ? 'streaming' : 'ready'}
              isDisabled={executionUnknown}
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
                    isDisabled={executionUnknown}
                    placeholder={imageInputSupport.supported
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
                      isDisabled={!canSwitchAgent}
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
                        isDisabled={providerModels.length === 0}
                        aria-label={t('chat.selectModel')}
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
                      isDisabled={thinking || executionUnknown || !canChoosePermission || (fixedPermission && currentPermission !== null)}
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
                      isDisabled={thinking || executionUnknown}
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
                    {thinking ? (
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


import { RiAttachment2, RiBarChartBoxLine, RiClipboardLine, RiCpuLine, RiGitBranchLine, RiShieldLine, RiStopCircleLine } from '@remixicon/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Alert, Button, Label, ListBox, Popover, ScrollShadow, Select, Tooltip, toast } from '@heroui/react';
import { ChainOfThought, ChatAttachment, ChatAttachmentGroup, ChatAttachmentInput, ChatMessage, HoverCard, PromptInput } from '@heroui-pro/react';
import { ChatMessageActions } from '@heroui-pro/react/chat-message-actions';
import { ChatTool } from '@heroui-pro/react/chat-tool';
import { Markdown } from '@heroui-pro/react/markdown';
import { providerDisplayName, type ProviderKind } from '@todex/protocol/v2';
import { progressGroupLabel } from '@todex/protocol/mobileParity';
import { permissionActions } from '@todex/protocol/todex';
import { ModelReasoningCard } from '../components/ModelReasoningCard';
import { ProviderIcon } from '../components/ProviderIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import {
  PERMISSION_PRESETS,
  attachmentId,
  buildConversationRenderItems,
  canSwitchConversationAgent,
  conversationImageInputSupport,
  inferMimeType,
  isImageMimeType,
  isStepProgressEntry,
  isV2Conversation,
  MAX_COMPOSER_ATTACHMENTS,
  SLASH_COMMANDS,
  findMentionTrigger,
  buildMentionSuggestions,
  insertMention,
  canonicalSlashCommand,
  modelDisplayLabel,
  reasoningEffortLabel,
  permissionPresetForProfile,
  workspaceLinkTarget,
} from '../session/helpers';
import { findCapabilityHashTrigger } from '@todex/protocol/todex';

type Props = {
  session: TodeXSession;
};

const MAX_COMPOSER_IMAGE_BYTES = 2_500_000;
const MAX_COMPOSER_TEXT_BYTES = 512 * 1024;
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
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片'));
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
        : typeof value.command === 'string' ? '命令执行' : '工具调用';
    const args = value.arguments ?? value.input ?? (typeof value.command === 'string' ? { command: value.command } : {});
    return { toolName, argsText: typeof args === 'string' ? args : JSON.stringify(args, null, 2) };
  } catch {
    return { toolName: '工具调用', argsText: raw };
  }
}

const PERMISSION_LABELS = new Map([
  ['read-only', '只读'],
  ['default', '请求审批'],
  ['auto-review', '自动审批'],
  ['full-access', '完全访问'],
]);

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
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
  const percent = contextWindow ? Math.min(100, Math.max(0, usedTokens / contextWindow * 100)) : null;
  const progress = percent ?? 0;
  return (
    <Tooltip delay={100}>
      <Tooltip.Trigger>
        <button
          type="button"
          className="context-usage-ring"
          aria-label={percent === null ? '上下文用量等待 Provider 返回' : `上下文已使用 ${percent.toFixed(1)}%`}
          style={{ background: `conic-gradient(var(--accent) ${progress}%, var(--separator) ${progress}% 100%)` }}
        >
          <span />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <div className="min-w-48 space-y-1 p-1 text-xs">
          <p className="font-medium">上下文使用情况</p>
          {percent === null ? <p className="text-muted">等待 Provider 返回上下文窗口。</p> : (
            <>
              <p>{formatTokenCount(usedTokens)} / {formatTokenCount(contextWindow!)} tokens · {percent.toFixed(1)}%</p>
              <p className="text-muted">输入 {formatTokenCount(inputTokens)} · 输出 {formatTokenCount(outputTokens)}</p>
              <p className="text-muted">缓存读取 {formatTokenCount(cachedInputTokens)} · 缓存写入 {formatTokenCount(cacheWriteTokens)}</p>
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
  entry: { id: string; subtitle: string; at: number };
  session: TodeXSession;
}) {
  const records = session.usageRecords.filter((record) => record.conversationId === conversationId);
  const usage = records.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  const totalTokens = usage
    ? usage.inputTokens + usage.outputTokens
    : 0;
  const elapsedSeconds = usage ? Math.max(0.001, (usage.updatedAt - entry.at) / 1000) : 0;
  const outputTps = usage && elapsedSeconds > 0 ? usage.outputTokens / elapsedSeconds : 0;

  return (
    <ChatMessageActions className="mt-1">
      <ChatMessageActions.Copy
        aria-label="复制回复"
        tooltip="复制回复"
        onPress={() => void navigator.clipboard.writeText(entry.subtitle)
          .then(() => toast.success('已复制回复'))
          .catch(() => toast.danger('复制失败，请重试'))}
      >
        <RiClipboardLine aria-hidden="true" />
      </ChatMessageActions.Copy>
      <ChatMessage.Action
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label="Fork 对话"
        tooltip="Fork 对话"
        onPress={() => session.forkConversation(conversationId)}
      >
        <RiGitBranchLine aria-hidden="true" />
      </ChatMessage.Action>
      <HoverCard>
        <HoverCard.Trigger>
          <ChatMessage.Action isIconOnly size="sm" variant="ghost" aria-label="查看回复统计">
            <RiBarChartBoxLine aria-hidden="true" />
          </ChatMessage.Action>
        </HoverCard.Trigger>
        <HoverCard.Content>
          <HoverCard.Arrow />
          <div className="min-w-52 space-y-1 p-1 text-xs">
            <p className="font-medium">回复统计</p>
            {usage ? (
              <>
                <p className="text-muted">模型：{usage.model}</p>
                <p>输入 {formatTokenCount(usage.inputTokens)} · 输出 {formatTokenCount(usage.outputTokens)}</p>
                <p>缓存读取 {formatTokenCount(usage.cachedInputTokens)} · 写入 {formatTokenCount(usage.cacheWriteTokens)}</p>
                <p>总计 {formatTokenCount(totalTokens)} tokens · 输出 TPS {outputTps.toFixed(1)}</p>
              </>
            ) : <p className="text-muted">暂无该回复的 usage 数据。</p>}
          </div>
        </HoverCard.Content>
      </HoverCard>
    </ChatMessageActions>
  );
}

export function ChatPanel({ session }: Props) {
  const conversation = session.activeConversation;
  const workspace = session.activeWorkspace;
  const draft = conversation ? (session.chatDrafts[conversation.id] ?? '') : '';
  const mention = findMentionTrigger(draft, conversation ? (session.composerSelections[conversation.id]?.end ?? draft.length) : 0);
  const [mentionSuggestions, setMentionSuggestions] = useState<Array<{ id: string; title: string; description: string; insertText: string }>>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [expandedProcessIds, setExpandedProcessIds] = useState<Set<string>>(() => new Set());
  const [isDraggingAttachment, setIsDraggingAttachment] = useState(false);
  const isComposingRef = useRef(false);
  const lastToastErrorRef = useRef('');
  useEffect(() => {
    if (session.lastError && session.lastError !== lastToastErrorRef.current) {
      lastToastErrorRef.current = session.lastError;
      toast.danger(session.lastError);
    }
  }, [session.lastError]);
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
  const items = useMemo(() => {
    if (!conversation) return [];
    return buildConversationRenderItems(
      session.timeline
        .filter((entry) => entry.conversationId === conversation.id)
        .filter((entry) => (
          entry.kind !== 'system'
          || isStepProgressEntry(entry)
          || entry.category === 'error'
        ) && !isChatReminderEntry(entry))
        .slice()
        .sort((left, right) => {
          if (left.sequence !== undefined && right.sequence !== undefined && left.sequence !== right.sequence) {
            return left.sequence - right.sequence;
          }
          if (left.at !== right.at) return left.at - right.at;
          return left.id.localeCompare(right.id);
        }),
    );
  }, [conversation?.id, session.timeline]);
  if (!conversation || !workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <p className="text-sm font-medium">选择一个对话</p>
        <p className="text-muted mt-1 max-w-sm text-sm">从左侧打开工作区和对话，或新建后开始聊天。</p>
      </div>
    );
  }

  const attachments = session.composerAttachments[conversation.id] ?? [];
  const currentProvider = isV2Conversation(conversation) ? conversation.provider || '' : '';
  const agentProvider = conversation.provider || (isV2Conversation(conversation) ? '' : 'codex');
  const slashTrigger = draft.trim().startsWith('/') ? draft.trim() : '';
  const liveCommands = currentProvider ? (session.providerCommands[currentProvider as ProviderKind] ?? []) : [];
  const slashCatalog = liveCommands.length > 0
    ? liveCommands.map((item) => ({
      command: `/${item.name}`,
      title: item.name,
      description: item.description || `${item.source} command`,
      category: 'context' as const,
    }))
    : SLASH_COMMANDS;
  const slashSuggestions = slashTrigger
    ? slashCatalog.filter((item) => canonicalSlashCommand(item.command).startsWith(canonicalSlashCommand(slashTrigger.split(/\s+/)[0] || slashTrigger)))
    : [];
  const suggestionCount = slashSuggestions.length > 0 ? Math.min(12, slashSuggestions.length) : mentionSuggestions.length;
  const applySuggestion = (index: number) => {
    if (slashSuggestions.length > 0) {
      const item = slashSuggestions[index];
      if (item) session.setConversationChatDraft(conversation.id, `${item.command} `);
      return;
    }
    const item = mentionSuggestions[index];
    if (!item || !mention) return;
    session.setConversationChatDraft(conversation.id, insertMention(draft, mention, item.insertText));
    const cursor = mention.start + item.insertText.length;
    session.setConversationComposerSelection(conversation.id, { start: cursor, end: cursor });
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
  const capability = findCapabilityHashTrigger(draft, session.composerSelections[conversation.id]?.end ?? draft.length);
  const thinking = session.thinkingConversations[conversation.id] === true;
  const latestProcessGroupId = [...items].reverse().find((item) => item.type === 'executionGroup')?.id ?? '';
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
  const imageInputSupport = conversationImageInputSupport(conversation, session.v2Providers);
  const hasBlockedImageAttachment = !imageInputSupport.supported
    && attachments.some((attachment) => attachment.kind === 'image');
  const attachmentAccept = imageInputSupport.supported
    ? `${COMPOSER_IMAGE_ACCEPT},${COMPOSER_TEXT_ACCEPT}`
    : COMPOSER_TEXT_ACCEPT;
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
  const fastEnabled = workspace.serviceTier === 'priority' || workspace.serviceTier === 'fast';
  const contextUsage = session.contextUsageByConversation[conversation.id];
  const contextModelId = contextUsage?.model || currentModel;
  const currentContextWindow = contextUsage?.contextWindow
    ?? providerModels.find((item) => item.id === contextModelId || item.id.endsWith(`/${contextModelId}`))?.contextWindow;
  const currentPermission = permissionPresetForProfile(
    workspace.permissionProfile,
    workspace.approvalsReviewer || session.settings.approvalsReviewer,
  ) ?? PERMISSION_PRESETS.find((preset) =>
    preset.approvalPolicy === workspace.approvalPolicy && preset.sandboxMode === workspace.sandboxMode,
  ) ?? PERMISSION_PRESETS[1];
  const canChoosePermission = currentProvider === 'codex' || currentProvider === 'claude-code';
  const isToolCallEntry = (entry: (typeof session.timeline)[number]) => {
    return entry.category ? entry.category === 'tool' : entry.kind === 'system' && entry.title === '工具调用';
  };

  const addBrowserFiles = async (files: File[], source: 'clipboard' | 'file' = 'file') => {
    const remaining = MAX_COMPOSER_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      toast.danger(`一次最多附加 ${MAX_COMPOSER_ATTACHMENTS} 个文件`);
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
          throw new Error(imageInputSupport.reason || '当前 Agent 不支持图片输入');
        }
        if (!image && isImageMimeType(mimeType) && !isTextFile(file)) {
          throw new Error('仅支持 PNG、JPEG、GIF 或 WebP 图片');
        }
        if (image && file.size > MAX_COMPOSER_IMAGE_BYTES) throw new Error('图片不能超过 2.5 MB');
        if (!image && (!isTextFile(file) || file.size > MAX_COMPOSER_TEXT_BYTES)) {
          throw new Error('仅支持 512 KB 以内的文本文件，其他文件请放入工作区后用 @ 引用');
        }
        nextAttachments.push({
          id: attachmentId(),
          kind: image ? 'image' : 'file',
          name: attachmentName(file, index, mimeType, source),
          mimeType,
          sizeBytes: file.size,
          dataUrl: image ? await readFileAsDataUrl(file) : '',
          textContent: image ? undefined : await file.text(),
          source,
        });
      } catch (error) {
        toast.danger(error instanceof Error ? error.message : '无法读取附件');
      }
    }
    if (nextAttachments.length > 0) {
      session.setConversationAttachments(conversation.id, (current) => [
        ...current,
        ...nextAttachments,
      ].slice(0, MAX_COMPOSER_ATTACHMENTS));
    }
    if (reachedLimit) {
      toast.danger(`一次最多附加 ${MAX_COMPOSER_ATTACHMENTS} 个文件`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollShadow className="min-h-0 flex-1 px-5 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {items.length === 0 ? (
            <p className="text-muted py-16 text-center text-sm" role="status">
              {thinking ? '正在工作' : '还没有消息。输入内容后发送。'}
            </p>
          ) : null}
          {items.map((item) => {
            if (item.type === 'executionGroup') {
              const expanded = expandedProcessIds.has(item.id);
              const pendingCount = item.entries.filter((entry) => entry.requestId && session.pendingRequests.some((request) => request.requestId === entry.requestId)).length;
              return (
                <ChainOfThought
                  key={item.id}
                  isExpanded={expanded}
                  onExpandedChange={(nextExpanded) => setExpandedProcessIds((current) => {
                    const next = new Set(current);
                    if (nextExpanded) next.add(item.id);
                    else next.delete(item.id);
                    return next;
                  })}
                  isStreaming={thinking && item.id === latestProcessGroupId}
                  className="chat-process-trace"
                >
                  <ChainOfThought.Trigger>
                    {progressGroupLabel(item.entries, thinking && item.id === latestProcessGroupId, pendingCount)} · {item.entries.length}
                  </ChainOfThought.Trigger>
                  {expanded ? (
                    <ChainOfThought.Content>
                      <ChainOfThought.Steps>
                        {item.entries.map((entry) => (
                          <ChainOfThought.Step key={entry.id} label={entry.title}>
                            {isToolCallEntry(entry) ? (() => {
                              const { toolName, argsText } = toolPresentation(entry.subtitle);
                              return <ChatTool defaultExpanded={false} state={entry.phase === 'completed' ? 'output-available' : 'input-streaming'} toolName={toolName} argsText={argsText} />;
                            })() : <p className="max-w-full overflow-x-auto whitespace-pre-wrap break-words text-xs">{entry.subtitle || entry.title}</p>}
                          </ChainOfThought.Step>
                        ))}
                      </ChainOfThought.Steps>
                    </ChainOfThought.Content>
                  ) : null}
                </ChainOfThought>
              );
            }
            const entry = item.entry;
            if (isToolCallEntry(entry)) {
              const { toolName, argsText } = toolPresentation(entry.subtitle);
              return <ChatTool key={entry.id} defaultExpanded={false} state={entry.phase === 'completed' ? 'output-available' : 'input-streaming'} toolName={toolName} argsText={argsText} triggerPrefix={thinking ? '正在调用：' : '已调用：'} />;
            }
            const request = session.pendingRequests.find((pendingItem) => pendingItem.requestId && (entry.requestId === pendingItem.requestId || entry.raw.includes(pendingItem.requestId)));
            const isUser = entry.kind === 'outgoing';
            return (
              <div key={entry.id} className={`flex gap-3 py-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`min-w-0 max-w-[85%] ${isUser ? 'text-right' : ''}`}>
                  {isUser ? <p className="text-muted text-xs font-medium">You</p> : null}
                  <div className={`${isUser ? 'mt-1' : ''} text-sm leading-6`}>
                    {isUser ? <p className="whitespace-pre-wrap">{entry.subtitle}</p> : (
                      <Markdown
                        id={entry.id}
                        components={{
                          a: ({ href, children, ...props }) => {
                            const target = workspaceLinkTarget(href, workspace.path);
                            return (
                              <a
                                {...props}
                                href={href}
                                onClick={(event) => {
                                  if (!target) return;
                                  event.preventDefault();
                                  if (target.kind === 'browser-url' || target.kind === 'browser-file') {
                                    session.openPanel('Browser', target.kind === 'browser-url' ? { url: target.url } : { filePath: target.filePath });
                                  } else {
                                    session.openPanel('Files', { filePath: target.filePath });
                                  }
                                }}
                              >
                                {children}
                              </a>
                            );
                          },
                        }}
                      >
                        {entry.subtitle}
                      </Markdown>
                    )}
                  </div>
                  {entry.kind === 'incoming' ? <AgentMessageActions conversationId={conversation.id} entry={entry} session={session} /> : null}
                  {request ? (
                    <ChatMessage.Actions>
                      {permissionActions(request).map((option) => (
                        <Button
                          key={typeof option === 'boolean' ? String(option) : option.optionId}
                          size="sm"
                          variant={typeof option === 'boolean'
                            ? (option ? 'primary' : 'danger-soft')
                            : (option.kind.startsWith('reject') ? 'danger-soft' : 'primary')}
                          onPress={() => session.sendApprovalResponse(option, request)}
                        >
                          {typeof option === 'boolean' ? (option ? '同意' : '拒绝') : option.name}
                        </Button>
                      ))}
                    </ChatMessage.Actions>
                  ) : null}
                </div>
                {isUser ? <ChatMessage.Avatar alt="You" fallback="You" /> : null}
              </div>
            );
          })}
        </div>
      </ScrollShadow>
      <div className="border-separator border-t px-5 py-4">
        <div className="composer-container mx-auto max-w-2xl">
          {(slashSuggestions.length > 0 || mentionSuggestions.length > 0 || (mention && mentionSuggestions.length === 0)) ? (
            <div className="composer-suggestions-popover">
              {slashSuggestions.length > 0 ? (
                <ListBox
                  aria-label="命令建议"
                  onAction={(key) => {
                    const item = slashSuggestions.find((candidate) => candidate.command === String(key));
                    if (item) session.setConversationChatDraft(conversation.id, `${item.command} `);
                  }}
                >
                  {slashSuggestions.slice(0, 12).map((item, index) => (
                    <ListBox.Item key={item.command} id={item.command} textValue={`${item.command} ${item.description}`} className={`composer-suggestion-item ${index === suggestionIndex ? 'composer-suggestion-item--active' : ''}`}>
                      <span className="composer-suggestion-command">{item.command}</span>
                      <span className="composer-suggestion-description">{item.description}</span>
                    </ListBox.Item>
                  ))}
                </ListBox>
              ) : mentionSuggestions.length > 0 ? (
                <ListBox
                  aria-label="文件建议"
                  onAction={(key) => {
                    const item = mentionSuggestions.find((candidate) => candidate.id === String(key));
                    if (!item || !mention) return;
                    session.setConversationChatDraft(conversation.id, insertMention(draft, mention, item.insertText));
                    const cursor = mention.start + item.insertText.length;
                    session.setConversationComposerSelection(conversation.id, { start: cursor, end: cursor });
                  }}
                >
                  {mentionSuggestions.map((item, index) => (
                    <ListBox.Item key={item.id} id={item.id} textValue={`@${item.title} ${item.description}`} className={`composer-suggestion-item ${index === suggestionIndex ? 'composer-suggestion-item--active' : ''}`}>
                      <span className="composer-suggestion-command">@{item.title}</span>
                      <span className="composer-suggestion-description">{item.description}</span>
                    </ListBox.Item>
                  ))}
                </ListBox>
              ) : mention ? <p className="text-muted px-2 py-1 text-xs">正在搜索工作区文件…</p> : null}
            </div>
          ) : null}
          {capability ? <p className="text-muted mb-2 text-xs">输入 # 可引用 Skill 或 MCP。</p> : null}
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
          {hasBlockedImageAttachment ? (
            <Alert status="warning" className="mb-2">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>当前无法发送图片</Alert.Title>
                <Alert.Description>{imageInputSupport.reason}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <ChatAttachmentInput
            accept={attachmentAccept}
            disabled={attachments.length >= MAX_COMPOSER_ATTACHMENTS}
            multiple
            onFilesSelected={(files) => { void addBrowserFiles(files); }}
          >
            <PromptInput
              value={draft}
              status={thinking ? 'streaming' : 'ready'}
              onKeyDownCapture={(event) => {
                if (event.key === 'Enter' && (isComposingRef.current || isImeCompositionKey(event))) {
                  event.stopPropagation();
                }
              }}
              onValueChange={(value: string) => { setSuggestionIndex(0); session.setConversationChatDraft(conversation.id, value); }}
              onSubmit={() => {
                if (hasBlockedImageAttachment) {
                  toast.danger('当前无法发送图片', { description: imageInputSupport.reason });
                  return;
                }
                if (draft.trim().startsWith('/')) {
                  session.sendSlashCommand(draft, conversation.id);
                } else {
                  session.submitChat(conversation.id);
                }
              }}
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
                onPaste={(event) => {
                  const files = clipboardFiles(event.clipboardData);
                  if (files.length === 0) return;
                  event.preventDefault();
                  void addBrowserFiles(files, 'clipboard');
                }}
              >
                <PromptInput.Content>
                  {attachments.length > 0 ? (
                    <PromptInput.Attachments>
                      <ChatAttachmentGroup aria-label="待发送附件" role="list">
                        {attachments.map((attachment) => (
                          <ChatAttachment
                            key={attachment.id}
                            mimeType={attachment.mimeType}
                            name={attachment.name}
                            role="listitem"
                            size={attachment.sizeBytes ?? undefined}
                            src={attachment.kind === 'image' ? attachment.dataUrl : undefined}
                          >
                            <ChatAttachment.Preview />
                            <ChatAttachment.Info />
                            <ChatAttachment.Remove
                              aria-label={`移除附件 ${attachment.name}`}
                              onPress={() => session.setConversationAttachments(conversation.id, (current) =>
                                current.filter((item) => item.id !== attachment.id))}
                            />
                          </ChatAttachment>
                        ))}
                      </ChatAttachmentGroup>
                    </PromptInput.Attachments>
                  ) : null}
                  <PromptInput.TextArea
                    placeholder={imageInputSupport.supported
                      ? '发送消息，或粘贴 / 拖入图片和文件'
                      : '发送消息，或粘贴 / 拖入文本文件'}
                    onCompositionStart={() => { isComposingRef.current = true; }}
                    onCompositionEnd={() => { isComposingRef.current = false; }}
                    onKeyDown={handleSuggestionKeyDown}
                  />
                </PromptInput.Content>
                <PromptInput.Toolbar className="composer-toolbar">
                  <PromptInput.ToolbarStart className="min-w-0 flex-1">
                    <Select
                      className="composer-control"
                      variant="secondary"
                      placeholder="选择 Agent"
                      selectedKey={currentProvider || agentProvider || null}
                      isDisabled={!canSwitchAgent}
                      onSelectionChange={(key) => {
                        if (typeof key !== 'string' || !key || key === currentProvider) {
                          return;
                        }
                        session.switchConversationAgent(conversation.id, key as ProviderKind);
                      }}
                    >
                      <Label className="hidden">选择 Agent</Label>
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
                        aria-label="选择模型和思考强度"
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
                        <Popover.Dialog className="composer-model-popover__dialog" aria-label="模型和思考强度">
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
                    {canChoosePermission ? <Select
                      className="composer-control"
                      variant="secondary"
                      selectedKey={currentPermission.id}
                      onSelectionChange={(key) => {
                        const preset = PERMISSION_PRESETS.find((item) => item.id === key);
                        if (preset) {
                          void session.applyPermissionProfile(
                            conversation.id,
                            preset.profileId,
                            preset.description,
                            preset.approvalsReviewer,
                          );
                        }
                      }}
                    >
                      <Label className="hidden">选择权限</Label>
                      <Select.Trigger className="composer-control__trigger">
                        <Select.Value><RiShieldLine className="composer-control__icon" /><span className="composer-control__text">{PERMISSION_LABELS.get(currentPermission.id) || currentPermission.title}</span></Select.Value>
                        <Select.Indicator className="composer-control__indicator" />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {PERMISSION_PRESETS.map((preset) => (
                            <ListBox.Item key={preset.id} id={preset.id} textValue={PERMISSION_LABELS.get(preset.id) || preset.title}>
                              {PERMISSION_LABELS.get(preset.id) || preset.title}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select> : <Button className="composer-control composer-control__static" size="sm" variant="tertiary" isDisabled aria-label="完全访问权限"><RiShieldLine className="composer-control__icon" /><span className="composer-control__text">完全访问</span></Button>}
                  </PromptInput.ToolbarStart>
                  <PromptInput.ToolbarEnd className="gap-2">
                    <ChatAttachmentInput.Trigger
                      aria-label="添加附件"
                      render={({ isDisabled, onPress }) => (
                        <Tooltip>
                          <Tooltip.Trigger>
                            <Button isIconOnly variant="ghost" aria-label="添加附件" isDisabled={isDisabled} onPress={onPress}>
                              <RiAttachment2 className="size-4" />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>
                            {attachments.length >= MAX_COMPOSER_ATTACHMENTS
                              ? `最多附加 ${MAX_COMPOSER_ATTACHMENTS} 个文件`
                              : imageInputSupport.supported ? '添加图片或文本附件' : '添加文本附件'}
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
                        停止
                      </Button>
                    ) : null}
                  </PromptInput.ToolbarEnd>
                </PromptInput.Toolbar>
              </PromptInput.Shell>
            </PromptInput>
          </ChatAttachmentInput>
        </div>
      </div>
    </div>
  );
}

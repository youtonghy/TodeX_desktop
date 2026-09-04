import { RiBarChartBoxLine, RiClipboardLine, RiCpuLine, RiGitBranchLine, RiShieldLine, RiStopCircleLine } from '@remixicon/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button, Chip, Label, ListBox, Popover, ScrollShadow, Select, Tooltip, toast } from '@heroui/react';
import { ChainOfThought, ChatMessage, HoverCard, PromptInput } from '@heroui-pro/react';
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
  inferMimeType,
  isImageMimeType,
  isStepProgressEntry,
  isV2Conversation,
  MAX_COMPOSER_ATTACHMENTS,
  SLASH_COMMANDS,
  dataUrlFromBase64,
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

  const addFiles = async (paths: string[]) => {
    for (const path of paths) {
      if (attachments.length >= MAX_COMPOSER_ATTACHMENTS) break;
      try {
        const file = await window.todexDesktop.fs.readFile(path);
        const mimeType = file.mimeType || inferMimeType(file.name);
        session.setConversationAttachments(conversation.id, (current) => [
          ...current,
          {
            id: attachmentId(),
            kind: isImageMimeType(mimeType) ? 'image' : 'file',
            name: file.name,
            mimeType,
            sizeBytes: file.sizeBytes,
            dataUrl: dataUrlFromBase64(file.base64, mimeType),
            textContent: file.text,
            source: 'file',
          },
        ]);
      } catch (error) {
        toast.danger(error instanceof Error ? error.message : '无法读取附件');
      }
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
          {attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <Chip key={attachment.id} variant="soft">{attachment.name}</Chip>
              ))}
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
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={async (event) => {
              event.preventDefault();
              const files = Array.from(event.dataTransfer.files);
              const paths = files.map((file) => 'path' in file ? String((file as File & { path?: string }).path ?? '') : '').filter(Boolean);
              if (paths.length) {
                await addFiles(paths);
              }
            }}
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
                if (draft.trim().startsWith('/')) {
                  session.sendSlashCommand(draft, conversation.id);
                } else {
                  session.submitChat(conversation.id);
                }
              }}
              onStop={() => session.stopThinking(conversation.id)}
            >
              <PromptInput.Shell>
                <PromptInput.Content>
                  <PromptInput.TextArea
                    placeholder="发送消息，或输入 / 命令"
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
          </div>
        </div>
      </div>
    </div>
  );
}

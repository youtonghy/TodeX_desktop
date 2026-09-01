import { Cpu, FaceRobot, MagicWand, Paperclip, Shield, Stop } from '@gravity-ui/icons';
import { useEffect, useState } from 'react';
import { Button, Chip, Label, ListBox, ScrollShadow, Select, Tooltip, toast } from '@heroui/react';
import { ChatMessage, PromptInput } from '@heroui-pro/react';
import { providerDisplayName, type ProviderKind } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import {
  PERMISSION_PRESETS,
  attachmentId,
  buildConversationRenderItems,
  canSwitchConversationAgent,
  inferMimeType,
  isImageMimeType,
  isV2Conversation,
  MAX_COMPOSER_ATTACHMENTS,
  SLASH_COMMANDS,
  dataUrlFromBase64,
  findMentionTrigger,
  buildMentionSuggestions,
  insertMention,
  canonicalSlashCommand,
  modelDisplayLabel,
  permissionPresetForProfile,
} from '../session/helpers';
import { findCapabilityHashTrigger } from '@todex/protocol/todex';

type Props = {
  session: TodeXSession;
};

const PERMISSION_LABELS = new Map([
  ['read-only', '只读'],
  ['default', '请求审批'],
  ['auto-review', '自动审批'],
  ['full-access', '完全访问'],
]);

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
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
      <Tooltip.Trigger
        className="context-usage-ring"
        aria-label={percent === null ? '上下文用量等待 Provider 返回' : `上下文已使用 ${percent.toFixed(1)}%`}
        style={{ background: `conic-gradient(var(--accent) ${progress}%, var(--separator) ${progress}% 100%)` }}
      >
        <span />
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

export function ChatPanel({ session }: Props) {
  const conversation = session.activeConversation;
  const workspace = session.activeWorkspace;
  const draft = conversation ? (session.chatDrafts[conversation.id] ?? '') : '';
  const mention = findMentionTrigger(draft, conversation ? (session.composerSelections[conversation.id]?.end ?? draft.length) : 0);
  const [mentionSuggestions, setMentionSuggestions] = useState<Array<{ id: string; title: string; description: string; insertText: string }>>([]);
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
  if (!conversation || !workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <p className="text-sm font-medium">选择一个对话</p>
        <p className="text-muted mt-1 max-w-sm text-sm">从左侧打开工作区和对话，或新建后开始聊天。</p>
      </div>
    );
  }

  const attachments = session.composerAttachments[conversation.id] ?? [];
  const items = buildConversationRenderItems(
    [...session.timeline.filter((entry) => entry.conversationId === conversation.id)]
      .sort((left, right) => left.at - right.at),
  );
  const currentProvider = isV2Conversation(conversation) ? conversation.provider || '' : '';
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
  const capability = findCapabilityHashTrigger(draft, session.composerSelections[conversation.id]?.end ?? draft.length);
  const thinking = session.thinkingConversations[conversation.id] === true;
  const conversationTimeline = session.timeline.filter((entry) => entry.conversationId === conversation.id);
  const canSwitchAgent = canSwitchConversationAgent(conversation, {
    timeline: conversationTimeline,
    thinking,
  });
  const agentLabel = currentProvider
    ? providerDisplayName(currentProvider, 'Agent')
    : '历史';
  const availableProviders = session.v2Providers.filter((item) => item.available);
  const providerDescriptor = session.v2Providers.find((item) => item.id === currentProvider);
  const providerModels = session.providerModels[currentProvider as ProviderKind] ?? providerDescriptor?.models ?? [];
  const currentModel = conversation.model || providerModels.find((item) => item.isDefault)?.id || (currentProvider === 'codex' ? workspace.model || session.settings.defaultModel : '');
  // An unset Pi/agent effort is meaningful: let the provider apply its own default.
  const currentReasoningEffort = conversation.reasoningEffort ?? null;
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
    if (entry.kind !== 'incoming') return false;
    try {
      const value = JSON.parse(entry.subtitle) as Record<string, unknown>;
      return Boolean(value && typeof value === 'object' && (Object.keys(value).length === 0 || 'command' in value || 'tool' in value || 'toolCall' in value));
    } catch {
      return false;
    }
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
            <p className="text-muted py-16 text-center text-sm">还没有消息。输入内容后发送。</p>
          ) : null}
          {items.map((item) => {
            if (item.type === 'executionGroup') {
              return (
                <details key={item.id} className="border-separator border-l-2 px-3 py-1">
                  <summary className="text-muted cursor-pointer text-xs">执行步骤 · {item.entries.length}</summary>
                  <div className="text-muted mt-2 flex flex-col gap-1 text-xs">
                    {item.entries.map((entry) => (
                      <p key={entry.id} className="whitespace-pre-wrap">{entry.subtitle || entry.title}</p>
                    ))}
                  </div>
                </details>
              );
            }
            const entry = item.entry;
            if (isToolCallEntry(entry)) {
              return (
                <details key={entry.id} className="border-separator border-l-2 px-3 py-1">
                  <summary className="text-muted cursor-pointer text-xs">工具调用</summary>
                  <pre className="text-muted mt-2 max-w-full overflow-x-auto whitespace-pre-wrap text-xs">{entry.subtitle}</pre>
                </details>
              );
            }
            const request = session.pendingRequests.find((pendingItem) => pendingItem.requestId && (entry.requestId === pendingItem.requestId || entry.raw.includes(pendingItem.requestId)));
            const isUser = entry.kind === 'outgoing';
            return (
              <div key={entry.id} className={`flex gap-3 py-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={`min-w-0 max-w-[85%] ${isUser ? 'text-right' : ''}`}>
                  {isUser ? <p className="text-muted text-xs font-medium">You</p> : null}
                  <p className={`${isUser ? 'mt-1' : ''} whitespace-pre-wrap text-sm leading-6`}>{entry.subtitle}</p>
                  {request ? (
                    <ChatMessage.Actions>
                      <Button size="sm" onPress={() => session.sendApprovalResponse(true, request)}>同意</Button>
                      <Button size="sm" variant="danger-soft" onPress={() => session.sendApprovalResponse(false, request)}>拒绝</Button>
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
        <div className="mx-auto max-w-2xl">
          {session.lastError ? (
            <p className="text-danger mb-2 text-xs">{session.lastError}</p>
          ) : null}
          {slashSuggestions.length > 0 ? (
            <div className="command-suggestions mb-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {slashSuggestions.slice(0, 12).map((item) => (
                <Button key={item.command} size="sm" variant="tertiary" className="min-h-9 justify-start text-left" onPress={() => session.setConversationChatDraft(conversation.id, `${item.command} `)}>
                  <span className="font-medium">{item.command}</span>
                  <span className="text-muted truncate text-xs">{item.description}</span>
                </Button>
              ))}
            </div>
          ) : null}
          {mentionSuggestions.length > 0 ? (
            <div className="command-suggestions mb-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {mentionSuggestions.map((item) => (
                <Button key={item.id} size="sm" variant="tertiary" className="min-h-9 justify-start text-left" onPress={() => {
                  session.setConversationChatDraft(conversation.id, insertMention(draft, mention!, item.insertText));
                  session.setConversationComposerSelection(conversation.id, { start: mention!.start + item.insertText.length, end: mention!.start + item.insertText.length });
                }}>
                  <span className="font-medium">@{item.title}</span>
                  <span className="text-muted truncate text-xs">{item.description}</span>
                </Button>
              ))}
            </div>
          ) : mention ? <p className="text-muted mb-2 text-xs">正在搜索工作区文件…</p> : null}
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
              onValueChange={(value: string) => session.setConversationChatDraft(conversation.id, value)}
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
                  <PromptInput.TextArea placeholder="发送消息，或输入 / 命令" />
                </PromptInput.Content>
                <PromptInput.Toolbar className="composer-toolbar">
                  <PromptInput.ToolbarStart className="min-w-0 flex-1">
                    <PromptInput.Action
                      aria-label="添加附件"
                      onPress={async () => {
                        const paths = await window.todexDesktop.dialog.openFiles();
                        await addFiles(paths);
                      }}
                    >
                      <Paperclip className="size-4" />
                    </PromptInput.Action>
                    <Select
                      className="composer-control"
                      variant="secondary"
                      placeholder="选择 Agent"
                      selectedKey={currentProvider || null}
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
                        <Select.Value><FaceRobot className="composer-control__icon" /><span className="composer-control__text">{agentLabel}</span></Select.Value>
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
                              {providerDisplayName(item.id, item.displayName)}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Select
                      className="composer-control"
                      variant="secondary"
                      selectedKey={currentModel || null}
                      onSelectionChange={(key) => {
                        if (typeof key === 'string' && key) {
                          session.applyConversationModelSelection(conversation.id, key, currentReasoningEffort);
                        }
                      }}
                    >
                      <Label className="hidden">选择模型</Label>
                      <Select.Trigger className="composer-control__trigger">
                        <Select.Value><Cpu className="composer-control__icon" /><span className="composer-control__text">{modelDisplayLabel(currentModel, session.modelCatalog)}</span></Select.Value>
                        <Select.Indicator className="composer-control__indicator" />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {providerModels.map((item) => (
                            <ListBox.Item key={item.id} id={item.id} textValue={item.displayName}>
                              {item.displayName}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Select
                      className="composer-control"
                      variant="secondary"
                      selectedKey={currentReasoningEffort}
                      onSelectionChange={(key) => {
                        if (typeof key === 'string' && key) {
                          session.applyConversationModelSelection(conversation.id, currentModel, key);
                        }
                      }}
                    >
                      <Label className="hidden">思考强度</Label>
                      <Select.Trigger className="composer-control__trigger">
                        <Select.Value><MagicWand className="composer-control__icon" /><span className="composer-control__text">{currentReasoningEffort || '默认强度'}</span></Select.Value>
                        <Select.Indicator className="composer-control__indicator" />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {(providerModels.find((item) => item.id === currentModel)?.supportedReasoningEfforts ?? []).map((effort) => (
                            <ListBox.Item key={effort} id={effort} textValue={effort}>{effort}</ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
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
                        <Select.Value><Shield className="composer-control__icon" /><span className="composer-control__text">{PERMISSION_LABELS.get(currentPermission.id) || currentPermission.title}</span></Select.Value>
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
                    </Select> : <Button className="composer-control composer-control__static" size="sm" variant="tertiary" isDisabled aria-label="完全访问权限"><Shield className="composer-control__icon" /><span className="composer-control__text">完全访问</span></Button>}
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
                        <Stop className="size-4" />
                        停止
                      </Button>
                    ) : (
                      <PromptInput.Send />
                    )}
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

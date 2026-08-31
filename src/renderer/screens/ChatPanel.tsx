import { Paperclip, Stop } from '@gravity-ui/icons';
import { Button, Chip, Label, ListBox, ScrollShadow, Select, toast } from '@heroui/react';
import { ChatMessage, PromptInput } from '@heroui-pro/react';
import { providerDisplayName, type ProviderKind } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import {
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
  canonicalSlashCommand,
} from '../session/helpers';
import { findCapabilityHashTrigger } from '@todex/protocol/todex';

type Props = {
  session: TodeXSession;
};

export function ChatPanel({ session }: Props) {
  const conversation = session.activeConversation;
  const workspace = session.activeWorkspace;
  if (!conversation || !workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <p className="text-sm font-medium">选择一个对话</p>
        <p className="text-muted mt-1 max-w-sm text-sm">从左侧打开工作区和对话，或新建后开始聊天。</p>
      </div>
    );
  }

  const draft = session.chatDrafts[conversation.id] ?? '';
  const attachments = session.composerAttachments[conversation.id] ?? [];
  const items = buildConversationRenderItems(
    session.timeline.filter((entry) => entry.conversationId === conversation.id),
  );
  const slashTrigger = draft.trim().startsWith('/') ? draft.trim() : '';
  const slashSuggestions = slashTrigger
    ? SLASH_COMMANDS.filter((item) => canonicalSlashCommand(item.command).startsWith(canonicalSlashCommand(slashTrigger.split(/\s+/)[0] || slashTrigger)))
    : [];
  const mention = findMentionTrigger(draft, session.composerSelections[conversation.id]?.end ?? draft.length);
  const capability = findCapabilityHashTrigger(draft, session.composerSelections[conversation.id]?.end ?? draft.length);
  const thinking = session.thinkingConversations[conversation.id] === true;
  const conversationTimeline = session.timeline.filter((entry) => entry.conversationId === conversation.id);
  const canSwitchAgent = canSwitchConversationAgent(conversation, {
    timeline: conversationTimeline,
    thinking,
  });
  const currentProvider = isV2Conversation(conversation) ? conversation.provider || '' : '';
  const agentLabel = currentProvider
    ? providerDisplayName(currentProvider, 'Agent')
    : '历史 Codex';
  const disabledAgentKeys = session.v2Providers
    .filter((item) => !item.available)
    .map((item) => item.id);

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
                <details key={item.id} className="border-separator rounded-xl border px-3 py-2">
                  <summary className="text-muted cursor-pointer text-xs">执行步骤 · {item.entries.length}</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    {item.entries.map((entry) => (
                      <p key={entry.id} className="text-sm whitespace-pre-wrap">{entry.subtitle || entry.title}</p>
                    ))}
                  </div>
                </details>
              );
            }
            const entry = item.entry;
            const request = session.pendingRequests.find((pendingItem) => pendingItem.requestId && (entry.requestId === pendingItem.requestId || entry.raw.includes(pendingItem.requestId)));
            const isUser = entry.kind === 'outgoing';
            const Message = isUser ? ChatMessage.User : ChatMessage.Assistant;
            return (
              <Message key={entry.id}>
                <ChatMessage.Avatar alt={isUser ? 'You' : 'Codex'} fallback={isUser ? 'You' : 'CX'} />
                <ChatMessage.Body>
                  <ChatMessage.Bubble>
                    <ChatMessage.Content>
                      <p className="text-sm font-medium">{entry.title}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{entry.subtitle}</p>
                    </ChatMessage.Content>
                  </ChatMessage.Bubble>
                  {request ? (
                    <ChatMessage.Actions>
                      <Button size="sm" onPress={() => session.sendApprovalResponse(true, request)}>同意</Button>
                      <Button size="sm" variant="danger-soft" onPress={() => session.sendApprovalResponse(false, request)}>拒绝</Button>
                    </ChatMessage.Actions>
                  ) : null}
                </ChatMessage.Body>
              </Message>
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
            <div className="mb-2 flex flex-wrap gap-2">
              {slashSuggestions.slice(0, 8).map((item) => (
                <Button key={item.command} size="sm" variant="tertiary" onPress={() => session.setConversationChatDraft(conversation.id, `${item.command} `)}>
                  {item.command}
                </Button>
              ))}
            </div>
          ) : null}
          {mention ? <p className="text-muted mb-2 text-xs">输入 @ 后接文件名，可引用工作区文件。</p> : null}
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
                <PromptInput.Toolbar>
                  <PromptInput.ToolbarStart>
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
                      className="min-w-32 max-w-44"
                      variant="secondary"
                      placeholder="选择 Agent"
                      selectedKey={currentProvider || undefined}
                      isDisabled={!canSwitchAgent}
                      disabledKeys={disabledAgentKeys}
                      onSelectionChange={(key) => {
                        if (typeof key !== 'string' || !key || key === currentProvider) {
                          return;
                        }
                        session.switchConversationAgent(conversation.id, key as ProviderKind);
                      }}
                    >
                      <Label className="hidden">选择 Agent</Label>
                      <Select.Trigger>
                        <Select.Value>{agentLabel}</Select.Value>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {session.v2Providers.map((item) => (
                            <ListBox.Item
                              key={item.id}
                              id={item.id}
                              textValue={providerDisplayName(item.id, item.displayName)}
                            >
                              {providerDisplayName(item.id, item.displayName)}
                              {item.available ? '' : ` · ${item.unavailableReason || '不可用'}`}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </PromptInput.ToolbarStart>
                  <PromptInput.ToolbarEnd>
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

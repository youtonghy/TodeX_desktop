import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { ChatAttachment, ChatAttachmentGroup } from '@heroui-pro/react';
import { useNoticeToast } from './NoticeToast';
import { WorkspaceFilePreview, type PreviewFile } from './WorkspaceFilePreview';
import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';
import type { ComposerAttachmentDraft, QueuedChatSubmission } from '../session/helpers';

type Props = {
  runtime?: ConversationRuntime;
  reportedError?: string;
  running: boolean;
  canSteer: boolean;
  canUseNativeQueue: boolean;
  piQueue: boolean;
  controlStatus?: 'pending' | 'unknown';
  canSendText: boolean;
  localQueue: readonly QueuedChatSubmission[];
  localPaused: boolean;
  onSteer: () => void;
  onRecover: () => void;
  onRemoveNative: (id: string) => void;
  onClearNative: () => void;
  onRemoveLocal: (id: string) => void;
  onResumeLocal: () => void;
  onRevealPath?: (path: string) => void;
};

type AttachmentPreview = { name: string; order: number; path?: string; file: PreviewFile };

function previewFile(attachment: ComposerAttachmentDraft): PreviewFile {
  return {
    name: attachment.name,
    path: attachment.path ?? attachment.name,
    text: attachment.textContent ?? null,
    mimeType: attachment.mimeType,
    ...(attachment.dataUrl ? { dataUrl: attachment.dataUrl } : {}),
    ...(attachment.sizeBytes !== null ? { sizeBytes: attachment.sizeBytes } : {}),
  };
}

export function ConversationControls({ runtime, reportedError, running, canSteer, canUseNativeQueue,
  piQueue, controlStatus, canSendText, localQueue, localPaused,
  onSteer, onRecover, onRemoveNative, onClearNative, onRemoveLocal, onResumeLocal, onRevealPath }: Props) {
  const nativeItems = runtime?.queueItems.filter(item => ['queued', 'pending', 'delivering', 'unknown'].includes(item.status)) ?? [];
  const disabled = Boolean(controlStatus);
  const showSteer = running && canSteer && canSendText;
  const scope = runtime?.conversationId;
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const openAttachmentPreview = (order: number, attachment: ComposerAttachmentDraft) => {
    setPreview({ name: attachment.name, order, path: attachment.path, file: previewFile(attachment) });
  };
  useNoticeToast(controlStatus === 'unknown' ? '控制请求待确认'
    : runtime?.configurationError && runtime.configurationError !== reportedError ? '配置未应用' : null, {
    description: controlStatus === 'unknown' ? '请求可能已送达。核对记录后再继续，避免重复纠偏或排队。' : runtime?.configurationError,
    scope,
    timeout: controlStatus === 'unknown' ? 0 : undefined,
    actionLabel: controlStatus === 'unknown' ? '核对记录' : undefined,
    onAction: onRecover,
  });
  useNoticeToast(showSteer ? '可发送纠偏' : null, {
    variant: 'info',
    description: '纠偏使用输入框中的文字。',
    scope,
    timeout: 0,
    actionLabel: '发送纠偏',
    actionDisabled: disabled,
    onAction: onSteer,
  });
  return <>
    {nativeItems.length || localQueue.length ? <div className="mb-2 space-y-2">
      {nativeItems.length > 0 ? <div className="border-border rounded-lg border p-2 text-xs">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span>Agent 队列 · {nativeItems.length}{runtime?.queuePaused ? ' · 已暂停，请核对' : ''}</span>
          {piQueue && running && canUseNativeQueue ? <Button size="sm" variant="ghost" isDisabled={disabled}
            onPress={onClearNative}>清空待处理输入（含纠偏）</Button> : null}
        </div>
        {nativeItems.map((item, index) => <div key={item.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate"><span className="text-muted tabular-nums">{index + 1}. </span>{item.text || '待处理消息'}</span>
          {!piQueue && running && canUseNativeQueue ? <Button size="sm" variant="ghost" isDisabled={disabled}
            aria-label={`移除排队消息 ${item.text}`} onPress={() => onRemoveNative(item.id)}>移除</Button> : null}
        </div>)}
      </div> : null}
      {localQueue.length > 0 ? <div className="border-border rounded-lg border p-2 text-xs">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span>候选消息 · {localQueue.length}{localPaused ? ' · 已暂停' : ' · 本轮完成后发送'}</span>
          {!running ? <Button size="sm" variant="secondary" isDisabled={disabled} onPress={onResumeLocal}>继续发送</Button> : null}
        </div>
        <ol className="space-y-1.5">
          {localQueue.map((item, index) => <li key={item.id} className="flex items-start justify-between gap-2">
            <span aria-hidden className="text-muted mt-0.5 w-5 shrink-0 select-none text-right tabular-nums">{index + 1}.</span>
            <div className="min-w-0 flex-1 space-y-1">
              {item.text.trim() ? <p className="whitespace-pre-wrap break-words leading-snug line-clamp-2" title={item.text}>{item.text}</p>
                : !item.attachments.length && !item.skills.length ? <p className="text-muted">（空消息）</p> : null}
              {item.attachments.length > 0 ? (
                <ChatAttachmentGroup aria-label={`候选消息 ${index + 1} 的附件`} role="list">
                  {item.attachments.map((attachment) => (
                    <span key={attachment.id} role="listitem">
                    <ChatAttachment
                      className="cursor-pointer"
                      mimeType={attachment.mimeType}
                      name={attachment.name}
                      role="button"
                      tabIndex={0}
                      size={attachment.sizeBytes ?? undefined}
                      src={attachment.kind === 'image' ? attachment.dataUrl : undefined}
                      title={`查看 ${attachment.name}`}
                      onClick={() => openAttachmentPreview(index + 1, attachment)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openAttachmentPreview(index + 1, attachment);
                        }
                      }}
                    >
                      <ChatAttachment.Preview />
                      <ChatAttachment.Info />
                    </ChatAttachment>
                    </span>
                  ))}
                </ChatAttachmentGroup>
              ) : null}
              {item.skills.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {item.skills.map((skill) => (
                    <span key={skill.resourceId || `${skill.name}:${skill.path}`}
                      className="border-border text-muted rounded-md border px-1.5 py-0.5">
                      Skill · {skill.displayName || skill.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <Button size="sm" variant="ghost" aria-label={`移除候选消息 ${item.text || index + 1}`} onPress={() => onRemoveLocal(item.id)}>移除</Button>
          </li>)}
        </ol>
      </div> : null}
    </div> : null}
    <Modal isOpen={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="max-h-[90vh] sm:max-w-2xl">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{preview?.name}</Modal.Heading>
              <p className="text-muted text-xs">候选消息 {preview?.order}</p>
            </Modal.Header>
            <Modal.Body className="max-h-[70vh] overflow-y-auto">
              <WorkspaceFilePreview file={preview?.file ?? null} />
            </Modal.Body>
            {preview?.path && onRevealPath ? (
              <Modal.Footer>
                <Button variant="secondary" onPress={() => { const path = preview.path; setPreview(null); if (path) onRevealPath(path); }}>在文件中打开</Button>
                <Button onPress={() => setPreview(null)}>关闭</Button>
              </Modal.Footer>
            ) : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  </>;
}

import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { ChatAttachment, ChatAttachmentGroup } from '@heroui-pro/react';
import { useNoticeToast } from './NoticeToast';
import { WorkspaceFilePreview, type PreviewFile } from './WorkspaceFilePreview';
import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';
import { attachmentPrompt, type ComposerAttachmentDraft, type QueuedChatSubmission } from '../session/helpers';
import { useT } from '../i18n';

type Props = {
  runtime?: ConversationRuntime;
  reportedError?: string;
  running: boolean;
  canUseNativeQueue: boolean;
  piQueue: boolean;
  controlStatus?: 'pending' | 'unknown';
  localQueue: readonly QueuedChatSubmission[];
  localPaused: boolean;
  /** Active provider rate-limit wait (e.g. Claude Code's five-hour window). */
  rateLimited?: { until: number; label: string };
  onRecover: () => void;
  onRemoveNative: (id: string) => void;
  onClearNative: () => void;
  onRemoveLocal: (id: string) => void;
  onResumeLocal: () => void;
  /** Daemon-held follow-up queue (`runtime.followUps`) edits. */
  onRemoveBackend: (id: string) => void;
  onClearBackend: () => void;
  onResumeBackend: () => void;
  onRevealPath?: (path: string) => void;
};

type AttachmentPreview = { name: string; order: number; path?: string; file: PreviewFile };

const BACKEND_PAUSE_REASONS = ['turn_failed', 'turn_cancelled', 'turn_interrupted', 'start_failed', 'daemon_restarted'] as const;

function formatResetInstant(until: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(until));
}

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

export function ConversationControls({ runtime, reportedError, running, canUseNativeQueue,
  piQueue, controlStatus, localQueue, localPaused, rateLimited,
  onRecover, onRemoveNative, onClearNative, onRemoveLocal, onResumeLocal,
  onRemoveBackend, onClearBackend, onResumeBackend, onRevealPath }: Props) {
  const t = useT();
  const nativeItems = runtime?.queueItems.filter(item => ['queued', 'pending', 'delivering', 'unknown'].includes(item.status)) ?? [];
  const backendQueue = runtime?.followUps;
  const backendItems = backendQueue?.items ?? [];
  const backendPauseReason = backendQueue?.paused ? (BACKEND_PAUSE_REASONS as readonly string[]).includes(backendQueue.pauseReason)
    ? backendQueue.pauseReason as typeof BACKEND_PAUSE_REASONS[number] : 'other' : null;
  const disabled = Boolean(controlStatus);
  const scope = runtime?.conversationId;
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const openAttachmentPreview = (order: number, attachment: ComposerAttachmentDraft) => {
    setPreview({ name: attachment.name, order, path: attachment.path, file: previewFile(attachment) });
  };
  useNoticeToast(controlStatus === 'unknown' ? t('controls.controlPending')
    : runtime?.configurationError && runtime.configurationError !== reportedError ? t('controls.configNotApplied') : null, {
    description: controlStatus === 'unknown' ? t('controls.controlPendingHint') : runtime?.configurationError,
    scope,
    timeout: controlStatus === 'unknown' ? 0 : undefined,
    actionLabel: controlStatus === 'unknown' ? t('controls.review') : undefined,
    onAction: onRecover,
  });
  return <>
    {nativeItems.length || backendItems.length || localQueue.length || rateLimited ? <div className="mb-2 space-y-2">
      {backendItems.length > 0 ? <div className="border-border rounded-lg border p-2 text-xs">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="min-w-0">{t('controls.backendQueue', { count: backendItems.length })} · {backendPauseReason
            ? <span title={backendQueue?.pauseMessage || undefined}>{t(`controls.backendPaused.${backendPauseReason}`)}</span>
            : t('controls.backendQueueHint')}</span>
          <span className="flex shrink-0 gap-1">
            {backendPauseReason && !running && !rateLimited ? <Button size="sm" variant="secondary" onPress={onResumeBackend}>{t('controls.resumeSend')}</Button> : null}
            <Button size="sm" variant="ghost" onPress={onClearBackend}>{t('controls.clearQueue')}</Button>
          </span>
        </div>
        {backendPauseReason === 'start_failed' && backendQueue?.pauseMessage
          ? <p className="text-danger mb-1 break-words">{backendQueue.pauseMessage}</p> : null}
        <ol className="space-y-1">
          {backendItems.map((item, index) => <li key={item.id} className="flex items-start justify-between gap-2">
            <span aria-hidden className="text-muted mt-0.5 w-5 shrink-0 select-none text-right tabular-nums">{index + 1}.</span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 whitespace-pre-wrap break-words leading-snug" title={item.text}>{item.text.trim() || t('controls.pendingMessage')}</p>
              {item.contentCount || item.skills.length ? <p className="text-muted truncate">
                {[item.contentCount ? t('controls.queuedContent', { count: item.contentCount }) : '',
                  item.skills.length ? `Skill · ${item.skills.join(', ')}` : ''].filter(Boolean).join(' · ')}
              </p> : null}
            </div>
            <Button size="sm" variant="ghost" aria-label={t('controls.removeQueued', { text: item.text })}
              onPress={() => onRemoveBackend(item.id)}>{t('controls.remove')}</Button>
          </li>)}
        </ol>
      </div> : null}
      {nativeItems.length > 0 ? <div className="border-border rounded-lg border p-2 text-xs">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span>{t('controls.agentQueue', { count: nativeItems.length })}{runtime?.queuePaused ? ` · ${t('controls.queuePausedCheck')}` : ''}</span>
          {piQueue && running && canUseNativeQueue ? <Button size="sm" variant="ghost" isDisabled={disabled}
            onPress={onClearNative}>{t('controls.clearPending')}</Button> : null}
        </div>
        {nativeItems.map((item, index) => <div key={item.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate"><span className="text-muted tabular-nums">{index + 1}. </span>{item.text || t('controls.pendingMessage')}</span>
          {!piQueue && running && canUseNativeQueue ? <Button size="sm" variant="ghost" isDisabled={disabled}
            aria-label={t('controls.removeQueued', { text: item.text })} onPress={() => onRemoveNative(item.id)}>{t('controls.remove')}</Button> : null}
        </div>)}
      </div> : null}
      {rateLimited && localQueue.length === 0 ? <div className="border-border rounded-lg border p-2 text-xs text-muted">
        {t('controls.sessionLimitWait', { time: formatResetInstant(rateLimited.until), reset: rateLimited.label })}
      </div> : null}
      {localQueue.length > 0 ? <div className="border-border rounded-lg border p-2 text-xs">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span>{t('controls.localQueue', { count: localQueue.length })}{rateLimited ? ` · ${t('controls.waitingReset', { time: formatResetInstant(rateLimited.until) })}` : localPaused ? ` · ${t('controls.queuePaused')}` : ` · ${t('controls.sendWhenDone')}`}</span>
          {!running && !rateLimited ? <Button size="sm" variant="secondary" isDisabled={disabled} onPress={onResumeLocal}>{t('controls.resumeSend')}</Button> : null}
        </div>
        <ol className="space-y-1.5">
          {localQueue.map((item, index) => {
            // Multiple candidates collapse to one line; hover or keyboard focus
            // expands the full text, attachments, and skills.
            const collapsible = localQueue.length > 1;
            const reveal = 'group-hover:block group-focus-within:block';
            return <li key={item.id} className="group flex items-start justify-between gap-2">
            <span aria-hidden className="text-muted mt-0.5 w-5 shrink-0 select-none text-right tabular-nums">{index + 1}.</span>
            <div className="min-w-0 flex-1 space-y-1">
              {item.text.trim() ? <p className={`whitespace-pre-wrap break-words leading-snug ${collapsible ? 'line-clamp-1 group-hover:line-clamp-none group-focus-within:line-clamp-none' : 'line-clamp-2'}`} title={item.text}>{item.text}</p>
                : !item.attachments.length && !item.skills.length ? <p className="text-muted">{t('controls.emptyMessage')}</p>
                : collapsible ? <p className="text-muted truncate">
                  {[attachmentPrompt([...item.attachments]),
                    item.skills.length ? `Skill · ${item.skills.map(s => s.displayName || s.name).join(', ')}` : '']
                    .filter(Boolean).join(' · ')}
                </p> : null}
              {item.attachments.length > 0 ? (
                <div className={collapsible ? `hidden ${reveal}` : undefined}>
                <ChatAttachmentGroup aria-label={t('controls.queueAttachments', { order: index + 1 })} role="list">
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
                      title={t('controls.viewAttachment', { name: attachment.name })}
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
                </div>
              ) : null}
              {item.skills.length > 0 ? (
                <div className={`flex flex-wrap gap-1 ${collapsible ? `hidden group-hover:flex group-focus-within:flex` : ''}`}>
                  {item.skills.map((skill) => (
                    <span key={skill.resourceId || `${skill.name}:${skill.path}`}
                      className="border-border text-muted rounded-md border px-1.5 py-0.5">
                      Skill · {skill.displayName || skill.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <Button size="sm" variant="ghost" aria-label={t('controls.removeCandidate', { text: item.text || index + 1 })} onPress={() => onRemoveLocal(item.id)}>{t('controls.remove')}</Button>
          </li>;})}
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
              <p className="text-muted text-xs">{t('controls.candidateNumber', { order: preview?.order ?? '' })}</p>
            </Modal.Header>
            <Modal.Body className="max-h-[70vh] overflow-y-auto">
              <WorkspaceFilePreview file={preview?.file ?? null} />
            </Modal.Body>
            {preview?.path && onRevealPath ? (
              <Modal.Footer>
                <Button variant="secondary" onPress={() => { const path = preview.path; setPreview(null); if (path) onRevealPath(path); }}>{t('controls.openInFiles')}</Button>
                <Button onPress={() => setPreview(null)}>{t('controls.close')}</Button>
              </Modal.Footer>
            ) : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  </>;
}

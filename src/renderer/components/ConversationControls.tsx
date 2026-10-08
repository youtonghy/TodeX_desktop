import { Button } from '@heroui/react';
import { useNoticeToast } from './NoticeToast';
import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';
import { formatResetInstant } from '../session/helpers';
import { useT } from '../i18n';

type Props = {
  runtime?: ConversationRuntime;
  reportedError?: string;
  running: boolean;
  canUseNativeQueue: boolean;
  piQueue: boolean;
  controlStatus?: 'pending' | 'unknown';
  /** The backend can pause its queue on request (`backendQueueControl`). */
  canPauseBackend: boolean;
  onRecover: () => void;
  onRemoveNative: (id: string) => void;
  onClearNative: () => void;
  /** Daemon-held follow-up queue (`runtime.followUps`) edits. */
  onRemoveBackend: (id: string) => void;
  onClearBackend: () => void;
  onResumeBackend: () => void;
  onPauseBackend: () => void;
};

const BACKEND_PAUSE_REASONS = ['user', 'turn_failed', 'turn_cancelled', 'turn_interrupted', 'start_failed', 'daemon_restarted', 'rate_limited'] as const;

export function ConversationControls({ runtime, reportedError, running, canUseNativeQueue,
  piQueue, controlStatus, canPauseBackend,
  onRecover, onRemoveNative, onClearNative,
  onRemoveBackend, onClearBackend, onResumeBackend, onPauseBackend }: Props) {
  const t = useT();
  const nativeItems = runtime?.queueItems.filter(item => ['queued', 'pending', 'delivering', 'unknown'].includes(item.status)) ?? [];
  const backendQueue = runtime?.followUps;
  const backendItems = backendQueue?.items ?? [];
  const backendPauseReason = backendQueue?.paused ? (BACKEND_PAUSE_REASONS as readonly string[]).includes(backendQueue.pauseReason)
    ? backendQueue.pauseReason as typeof BACKEND_PAUSE_REASONS[number] : 'other' : null;
  // The daemon resumes a rate-limited queue by itself at `resumeAt`.
  const backendResumeAt = backendPauseReason === 'rate_limited' ? Date.parse(backendQueue?.resumeAt ?? '') : NaN;
  const backendWaitsForReset = backendPauseReason === 'rate_limited';
  // A pause the user asked for can be lifted mid-turn; the daemon then sends
  // the head when the turn ends. Other pauses wait until the agent is idle.
  const canResumeBackend = Boolean(backendPauseReason) && !backendWaitsForReset && (!running || backendPauseReason === 'user');
  const canPause = canPauseBackend && !backendPauseReason && backendItems.length > 0;
  const disabled = Boolean(controlStatus);
  const scope = runtime?.conversationId;
  useNoticeToast(controlStatus === 'unknown' ? t('controls.controlPending')
    : runtime?.configurationError && runtime.configurationError !== reportedError ? t('controls.configNotApplied') : null, {
    description: controlStatus === 'unknown' ? t('controls.controlPendingHint') : runtime?.configurationError,
    scope,
    timeout: controlStatus === 'unknown' ? 0 : undefined,
    actionLabel: controlStatus === 'unknown' ? t('controls.review') : undefined,
    onAction: onRecover,
  });
  return <>
    {nativeItems.length || backendItems.length ? <div className="mb-2 space-y-2">
      {backendItems.length > 0 ? <div className="border-border rounded-lg border p-2 text-xs">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="min-w-0">{t('controls.backendQueue', { count: backendItems.length })} · {backendPauseReason
            ? <span title={backendQueue?.pauseMessage || undefined}>{t(`controls.backendPaused.${backendPauseReason}`,
              { time: Number.isFinite(backendResumeAt) ? formatResetInstant(backendResumeAt) : '—' })}</span>
            : t('controls.sendWhenDone')}</span>
          <span className="flex shrink-0 gap-1">
            {canPause ? <Button size="sm" variant="secondary" isDisabled={disabled} onPress={onPauseBackend}>{t('controls.pauseQueue')}</Button> : null}
            {canResumeBackend ? <Button size="sm" variant="secondary" isDisabled={disabled} onPress={onResumeBackend}>{t('controls.resumeSend')}</Button> : null}
            <Button size="sm" variant="ghost" onPress={onClearBackend}>{t('controls.clearQueue')}</Button>
          </span>
        </div>
        {backendPauseReason === 'start_failed' && backendQueue?.pauseMessage
          ? <p className="text-danger mb-1 break-words">{backendQueue.pauseMessage}</p> : null}
        <ol className="space-y-1.5">
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
    </div> : null}
  </>;
}

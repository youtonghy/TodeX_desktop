import { Button } from '@/components/base/buttons/button';
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

/** Queue card: a white bordered panel above the composer, caption-sized. */
const QUEUE_CARD = 'rounded-2lg border border-border-button-default bg-background-primary-default p-2 text-caption-1-regular text-text-primary';

/** Quiet text action (was a borderless HeroUI button): row hover fill, no border. */
const QUIET_ACTION = [
  'inline-flex h-6 shrink-0 cursor-pointer items-center rounded-md px-1.5 text-caption-1-medium text-text-secondary',
  'outline-none transition-colors duration-150 ease hover:bg-background-secondary-hover hover:text-text-primary',
  'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
].join(' ');

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
      {backendItems.length > 0 ? <div className={QUEUE_CARD}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="min-w-0">{t('controls.backendQueue', { count: backendItems.length })} · {backendPauseReason
            ? <span title={backendQueue?.pauseMessage || undefined}>{t(`controls.backendPaused.${backendPauseReason}`,
              { time: Number.isFinite(backendResumeAt) ? formatResetInstant(backendResumeAt) : '—' })}</span>
            : t('controls.sendWhenDone')}</span>
          <span className="flex shrink-0 gap-1">
            {canPause ? <Button size="xs" variant="secondary" disabled={disabled} onClick={onPauseBackend}>{t('controls.pauseQueue')}</Button> : null}
            {canResumeBackend ? <Button size="xs" variant="secondary" disabled={disabled} onClick={onResumeBackend}>{t('controls.resumeSend')}</Button> : null}
            <button type="button" className={QUIET_ACTION} onClick={onClearBackend}>{t('controls.clearQueue')}</button>
          </span>
        </div>
        {backendPauseReason === 'start_failed' && backendQueue?.pauseMessage
          ? <p className="mb-1 break-words text-text-error-primary">{backendQueue.pauseMessage}</p> : null}
        <ol className="space-y-1.5">
          {backendItems.map((item, index) => <li key={item.id} className="flex items-start justify-between gap-2">
            <span aria-hidden className="mt-0.5 w-5 shrink-0 select-none text-end tabular-nums text-text-tertiary">{index + 1}.</span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 whitespace-pre-wrap break-words" title={item.text}>{item.text.trim() || t('controls.pendingMessage')}</p>
              {item.contentCount || item.skills.length ? <p className="truncate text-text-tertiary">
                {[item.contentCount ? t('controls.queuedContent', { count: item.contentCount }) : '',
                  item.skills.length ? `Skill · ${item.skills.join(', ')}` : ''].filter(Boolean).join(' · ')}
              </p> : null}
            </div>
            <button type="button" className={QUIET_ACTION} aria-label={t('controls.removeQueued', { text: item.text })}
              onClick={() => onRemoveBackend(item.id)}>{t('controls.remove')}</button>
          </li>)}
        </ol>
      </div> : null}
      {nativeItems.length > 0 ? <div className={QUEUE_CARD}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span>{t('controls.agentQueue', { count: nativeItems.length })}{runtime?.queuePaused ? ` · ${t('controls.queuePausedCheck')}` : ''}</span>
          {piQueue && running && canUseNativeQueue ? <button type="button" className={QUIET_ACTION} disabled={disabled}
            onClick={onClearNative}>{t('controls.clearPending')}</button> : null}
        </div>
        {nativeItems.map((item, index) => <div key={item.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate"><span className="tabular-nums text-text-tertiary">{index + 1}. </span>{item.text || t('controls.pendingMessage')}</span>
          {!piQueue && running && canUseNativeQueue ? <button type="button" className={QUIET_ACTION} disabled={disabled}
            aria-label={t('controls.removeQueued', { text: item.text })} onClick={() => onRemoveNative(item.id)}>{t('controls.remove')}</button> : null}
        </div>)}
      </div> : null}
    </div> : null}
  </>;
}

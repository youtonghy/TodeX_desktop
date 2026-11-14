import { useEffect, useMemo, useState } from 'react';
import { RiArrowDownSLine, RiArrowUpSLine, RiComputerLine, RiStopCircleLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { IconAction } from '@/components/ui/icon-action';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import type { DesktopComputerState } from '@todex/protocol/conversationRuntime';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { backendApi } from '../session/helpers';
import { useConversationRuntime } from '../session/conversationStore';

/** Polling cadence of the live frame while it is visible. */
const FRAME_INTERVAL_MS = 350;
/** After a failed frame (session ending, older backend): wait longer. */
const FRAME_RETRY_MS = 2000;

/**
 * The Computer Use live view as a side-panel tab for one conversation
 * (`conversationId` is the local id): it stays after the session ends and
 * only polls while it is the shown tab.
 */
export function ComputerLivePane({ session, conversationId, isActive }: {
  session: TodeXSession;
  conversationId: string;
  isActive: boolean;
}) {
  const state = useConversationRuntime(session.stores, conversationId)?.desktopComputer;
  // The backend knows the conversation by its v2 id, not the local one.
  const backendConversationId = session.conversations.find(item => item.id === conversationId)?.v2ConversationId ?? conversationId;
  return <ComputerLiveView session={session} conversationId={backendConversationId} state={state} variant="pane" isActive={isActive} />;
}

/**
 * While the conversation's agent controls the backend's computer: its
 * screen, live while visible (the latest screenshot the agent took
 * otherwise), the latest action, and Stop. While the person at that
 * computer has not confirmed the first use, it says so. `card` pins it
 * above the composer (only while in use, collapsible); `pane` fills a
 * side-panel tab and polls only while `isActive`.
 */
export function ComputerLiveView({ session, conversationId, state, variant = 'card', isActive = true }: {
  session: TodeXSession;
  /** The backend's (v2) conversation id. */
  conversationId: string;
  state: DesktopComputerState | undefined;
  variant?: 'card' | 'pane';
  isActive?: boolean;
}) {
  const t = useT();
  const pane = variant === 'pane';
  const [folded, setFolded] = useState(false);
  // Not shown: nothing to poll for.
  const collapsed = pane ? !isActive : folded;
  const [stopping, setStopping] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [shot, setShot] = useState<{ shotId: string; dataUrl: string } | null>(null);
  const api = useMemo(
    () => backendApi(session.settings),
    [session.settings.deviceSecret, session.settings.encryptionProtocol, session.settings.encryptionPublicKey, session.settings.transportVerified, session.settings.serverUrl],
  );
  const active = Boolean(state?.active);
  const awaiting = Boolean(state?.awaitingHost) && !active;
  const latest = state?.actions.at(-1);
  // One backward scan per actions change, not an array copy per render.
  const latestShotId = useMemo(() => {
    const actions = state?.actions ?? [];
    for (let index = actions.length - 1; index >= 0; index--) {
      if (actions[index].shotId) return actions[index].shotId;
    }
    return undefined;
  }, [state?.actions]);
  const device = state?.deviceName || t('computerLive.host');

  // Live: the host's screen, only while shown and the page is visible.
  useEffect(() => {
    if (!active || collapsed) {
      setFrame(null);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let delay = FRAME_INTERVAL_MS;
      if (document.visibilityState === 'visible') {
        try {
          const next = await api.getComputerFrame(conversationId);
          if (alive) setFrame(next.dataUrl);
        } catch {
          if (alive) setFrame(null);
          delay = FRAME_RETRY_MS;
        }
      }
      if (alive) timer = setTimeout(() => { void tick(); }, delay);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [active, api, collapsed, conversationId]);

  // Without a live frame: the latest screenshot the agent took.
  useEffect(() => {
    if (!active || collapsed || frame || !latestShotId || shot?.shotId === latestShotId) return;
    let alive = true;
    void api.getAgentShot(conversationId, latestShotId)
      .then(next => { if (alive) setShot({ shotId: latestShotId, dataUrl: next.dataUrl }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [active, api, collapsed, conversationId, frame, latestShotId, shot?.shotId]);

  const stop = async () => {
    setStopping(true);
    try {
      await api.revokeAgentDesktop(conversationId, 'screen');
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('computerLive.stopFailed'));
    } finally {
      setStopping(false);
    }
  };
  const image = frame ?? shot?.dataUrl;

  if (pane) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-separator-border px-3 py-2">
          <RiComputerLine className="size-4 shrink-0 text-foreground-icon-secondary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body-medium text-text-primary">{active ? t('computerLive.title', { device }) : t('computerSettings.title')}</p>
            {latest ? <p className="truncate text-caption-1-regular text-text-tertiary">{latest.summary}{latest.app ? ` · ${latest.app}` : ''}</p> : null}
          </div>
          {frame ? <Chip variant="caption" color="yellow">{t('computerLive.live')}</Chip> : null}
          <Button size="small" variant="danger" leadingIcon={RiStopCircleLine} disabled={!active || stopping} onClick={() => { void stop(); }}>
            {t('computerLive.stop')}
          </Button>
        </div>
        {/* Outlined while in use so the user always sees the agent is in control. */}
        <div className={cx('relative flex min-h-0 flex-1 items-center justify-center bg-background-secondary-default', active && 'outline outline-2 -outline-offset-2 outline-chart-8')}>
          {active && image ? (
            <img src={image} alt={t(frame ? 'computerLive.frame' : 'computerLive.screenshot')} className="h-full w-full object-contain" />
          ) : (
            <p className="px-6 text-center text-body-regular text-text-secondary">
              {awaiting ? t('computerLive.awaitingHost', { device }) : active ? t('computerLive.waiting') : t('computerLive.ended', { device })}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (awaiting) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-2xl border border-chart-8 bg-status-yellow-background px-3 py-2">
        <RiComputerLine className="size-4 shrink-0 text-status-yellow-text" />
        <p className="text-caption-1-regular text-text-primary">{t('computerLive.awaitingHost', { device })}</p>
      </div>
    );
  }
  if (!active) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-chart-8 bg-background-primary-default">
      <div className="flex items-center gap-2 px-3 py-2">
        <RiComputerLine className="size-4 shrink-0 text-status-yellow-text" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption-1-medium text-text-primary">{t('computerLive.title', { device })}</p>
          {latest ? <p className="truncate text-caption-1-regular text-text-tertiary">{latest.summary}{latest.app ? ` · ${latest.app}` : ''}</p> : null}
        </div>
        {frame ? <Chip variant="caption" color="yellow">{t('computerLive.live')}</Chip> : null}
        <IconAction
          icon={collapsed ? RiArrowUpSLine : RiArrowDownSLine}
          size="sm"
          aria-label={collapsed ? t('computerLive.expand') : t('computerLive.collapse')}
          onClick={() => setFolded(value => !value)}
        />
        <Button size="small" variant="danger" leadingIcon={RiStopCircleLine} disabled={stopping} onClick={() => { void stop(); }}>
          {t('computerLive.stop')}
        </Button>
      </div>
      {collapsed ? null : (
        <div className="flex h-60 items-center justify-center bg-background-secondary-default">
          {image ? (
            <img src={image} alt={t(frame ? 'computerLive.frame' : 'computerLive.screenshot')} className="h-full w-full object-contain" />
          ) : (
            <p className="text-caption-1-regular text-text-secondary">{t('computerLive.waiting')}</p>
          )}
        </div>
      )}
    </div>
  );
}

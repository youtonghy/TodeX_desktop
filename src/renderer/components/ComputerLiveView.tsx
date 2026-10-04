import { useEffect, useMemo, useRef, useState } from 'react';
import { RiArrowDownSLine, RiArrowUpSLine, RiComputerLine, RiStopCircleLine } from '@remixicon/react';
import { Button, Chip, toast } from '@heroui/react';
import type { DesktopComputerState } from '@todex/protocol/conversationRuntime';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { V2ApiClient } from '@todex/protocol/v2';
import type { ComputerSessionInfo } from '../../preload/index';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';

/** This Mac's active Computer Use sessions, kept in sync with main. */
function useLocalComputerSessions(): ComputerSessionInfo[] {
  const [sessions, setSessions] = useState<ComputerSessionInfo[]>([]);
  useEffect(() => {
    const api = window.todexDesktop.computer;
    let alive = true;
    const unsubscribe = api.onSessions(next => { if (alive) setSessions(next); });
    void api.sessions().then(next => { if (alive) setSessions(next); });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return sessions;
}

/**
 * Pinned above the composer while the conversation's agent controls a Mac.
 * On that Mac it plays the controlled display live; elsewhere it shows the
 * latest screenshot the agent took.
 */
export function ComputerLiveView({ session, conversationId, state }: {
  session: TodeXSession;
  conversationId: string;
  state: DesktopComputerState | undefined;
}) {
  const t = useT();
  const localSessions = useLocalComputerSessions();
  const local = localSessions.find(item => item.conversationId === conversationId);
  const [collapsed, setCollapsed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [shot, setShot] = useState<{ shotId: string; dataUrl: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const api = useMemo(
    () => new V2ApiClient({ serverUrl: session.settings.serverUrl, device: deviceIdentityFromSecret(session.settings.deviceSecret) }),
    [session.settings.deviceSecret, session.settings.serverUrl],
  );
  const active = Boolean(state?.active || local);
  const latest = state?.actions.at(-1);
  const latestShotId = state ? [...state.actions].reverse().find(action => action.shotId)?.shotId : undefined;
  const live = Boolean(local) && !collapsed;

  // Live: the controlled display, only while visible here.
  useEffect(() => {
    if (!live) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10, width: 1280 }, audio: false })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach(track => track.stop());
          return;
        }
        stream = media;
        if (videoRef.current) videoRef.current.srcObject = media;
      })
      .catch(() => { /* Falls back to screenshots. */ });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [live, local?.displayId]);

  // Elsewhere (or before the stream starts): the latest screenshot.
  useEffect(() => {
    if (!active || collapsed || local || !latestShotId || shot?.shotId === latestShotId) return;
    let alive = true;
    void api.getAgentShot(conversationId, latestShotId)
      .then(next => { if (alive) setShot({ shotId: latestShotId, dataUrl: next.dataUrl }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [active, api, collapsed, conversationId, latestShotId, local, shot?.shotId]);

  if (!active) return null;

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

  const device = state?.deviceName || t('computerLive.thisMac');
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-warning">
      <div className="flex items-center gap-2 px-3 py-2">
        <RiComputerLine className="text-warning size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{t('computerLive.title', { device })}</p>
          {latest ? <p className="text-muted truncate text-xs">{latest.summary}{latest.app ? ` · ${latest.app}` : ''}</p> : null}
        </div>
        {local ? <Chip size="sm" variant="soft" color="warning">{t('computerLive.live')}</Chip> : null}
        <Button isIconOnly size="sm" variant="ghost" aria-label={collapsed ? t('computerLive.expand') : t('computerLive.collapse')} onPress={() => setCollapsed(value => !value)}>
          {collapsed ? <RiArrowUpSLine className="size-4" /> : <RiArrowDownSLine className="size-4" />}
        </Button>
        <Button size="sm" variant="danger-soft" isDisabled={stopping} onPress={() => { void stop(); }}>
          <RiStopCircleLine className="size-4" />
          {t('computerLive.stop')}
        </Button>
      </div>
      {collapsed ? null : (
        <div className="bg-black/80 flex h-60 items-center justify-center">
          {local ? (
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
          ) : shot ? (
            <img src={shot.dataUrl} alt={t('computerLive.screenshot')} className="h-full w-full object-contain" />
          ) : (
            <p className="text-xs text-white/70">{t('computerLive.waiting')}</p>
          )}
        </div>
      )}
    </div>
  );
}

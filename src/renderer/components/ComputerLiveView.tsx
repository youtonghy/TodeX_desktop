import { useEffect, useMemo, useState } from 'react';
import { RiArrowDownSLine, RiArrowUpSLine, RiComputerLine, RiStopCircleLine } from '@remixicon/react';
import { Button, Chip, toast } from '@heroui/react';
import type { DesktopComputerState } from '@todex/protocol/conversationRuntime';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { backendApi } from '../session/helpers';

/** Polling cadence of the live frame while it is visible. */
const FRAME_INTERVAL_MS = 350;
/** After a failed frame (session ending, older backend): wait longer. */
const FRAME_RETRY_MS = 2000;

/**
 * Pinned above the composer while the conversation's agent controls the
 * backend's computer: its screen, live while visible (the latest screenshot
 * the agent took otherwise), the latest action, and Stop. While the person
 * at that computer has not confirmed the first use, it says so.
 */
export function ComputerLiveView({ session, conversationId, state }: {
  session: TodeXSession;
  conversationId: string;
  state: DesktopComputerState | undefined;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
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

  if (awaiting) {
    return (
      <div className="border-warning mb-3 flex items-center gap-2 rounded-xl border px-3 py-2">
        <RiComputerLine className="text-warning size-4 shrink-0" />
        <p className="text-xs">{t('computerLive.awaitingHost', { device })}</p>
      </div>
    );
  }
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

  const image = frame ?? shot?.dataUrl;
  return (
    <div className="border-warning mb-3 overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 px-3 py-2">
        <RiComputerLine className="text-warning size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{t('computerLive.title', { device })}</p>
          {latest ? <p className="text-muted truncate text-xs">{latest.summary}{latest.app ? ` · ${latest.app}` : ''}</p> : null}
        </div>
        {frame ? <Chip size="sm" variant="soft" color="warning">{t('computerLive.live')}</Chip> : null}
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
          {image ? (
            <img src={image} alt={t(frame ? 'computerLive.frame' : 'computerLive.screenshot')} className="h-full w-full object-contain" />
          ) : (
            <p className="text-xs text-white/70">{t('computerLive.waiting')}</p>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { RiGlobalLine, RiStopCircleLine } from '@remixicon/react';
import { Button, Chip, toast } from '@heroui/react';
import type { AgentBrowserFrame } from '@todex/protocol/agentDesktop';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { backendApi } from '../session/helpers';

/** A frame decoded into a bitmap, or the latest screenshot as a data URL. */
type Still = { shotId: string; dataUrl: string };

type Base64Decoding = { fromBase64?: (this: Uint8ArrayConstructor, value: string) => Uint8Array<ArrayBuffer> };

/** Frame bytes from base64: the native decoder where the runtime has one,
 * otherwise atob into a preallocated buffer. */
function decodeFrameBytes(data: string): Uint8Array<ArrayBuffer> {
  const fromBase64 = (Uint8Array as Uint8ArrayConstructor & Base64Decoding).fromBase64;
  if (typeof fromBase64 === 'function') return fromBase64.call(Uint8Array, data);
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * The agent's browser tab for one conversation, live: it runs on the
 * backend's computer and streams here over the session socket while this
 * pane is shown. Without a live frame the latest screenshot stands in.
 */
export function AgentBrowserLiveView({ session, conversationId, isActive }: {
  session: TodeXSession;
  conversationId: string;
  isActive: boolean;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);
  const [closed, setClosed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [still, setStill] = useState<Still | null>(null);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const api = useMemo(
    () => backendApi(session.settings),
    [session.settings.deviceSecret, session.settings.encryptionProtocol, session.settings.encryptionPublicKey, session.settings.serverUrl],
  );
  const state = session.conversationRuntimeById[conversationId]?.desktopBrowser;
  // One backward pass per actions change, not three array copies per render.
  const { latest, page, latestShotId } = useMemo(() => {
    const actions = state?.actions ?? [];
    let pageAction: (typeof actions)[number] | undefined;
    let shotId: string | undefined;
    for (let index = actions.length - 1; index >= 0 && (!pageAction || !shotId); index--) {
      const action = actions[index];
      if (!pageAction && action.ok && (action.url || action.title)) pageAction = action;
      if (!shotId && action.shotId) shotId = action.shotId;
    }
    return { latest: actions.at(-1), page: pageAction, latestShotId: shotId };
  }, [state?.actions]);
  const { watchAgentBrowser } = session;

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // Live frames while shown; only the newest frame waits for decoding.
  useEffect(() => {
    if (!isActive || !visible) {
      setLive(false);
      return;
    }
    let alive = true;
    let decoding = false;
    let pending: AgentBrowserFrame | null = null;
    const draw = async (frame: AgentBrowserFrame) => {
      if (frame.closed) {
        setLive(false);
        setClosed(true);
        return;
      }
      decoding = true;
      try {
        const bytes = decodeFrameBytes(frame.data);
        const bitmap = await createImageBitmap(new Blob([bytes], { type: frame.mimeType }));
        const canvas = canvasRef.current;
        if (alive && canvas) {
          // Assigning a size reallocates and clears the canvas, even when it
          // is unchanged; frames of a steady viewport only draw.
          if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
          if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          setLive(true);
          setClosed(false);
        }
        bitmap.close();
      } catch {
        // A corrupt frame is skipped; the next one replaces it.
      } finally {
        decoding = false;
        const next = pending;
        pending = null;
        if (alive && next) void draw(next);
      }
    };
    const unwatch = watchAgentBrowser(conversationId, (frame) => {
      if (decoding) pending = frame;
      else void draw(frame);
    });
    return () => {
      alive = false;
      unwatch();
    };
  }, [conversationId, isActive, visible, watchAgentBrowser]);

  // Without live frames: the latest screenshot the agent took.
  useEffect(() => {
    if (live || !latestShotId || still?.shotId === latestShotId) return;
    let alive = true;
    void api.getAgentShot(conversationId, latestShotId)
      .then(shot => { if (alive) setStill({ shotId: latestShotId, dataUrl: shot.dataUrl }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [api, conversationId, latestShotId, live, still?.shotId]);

  const stop = async () => {
    setStopping(true);
    try {
      await api.revokeAgentDesktop(conversationId, 'browser');
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentBrowser.stopFailed'));
    } finally {
      setStopping(false);
    }
  };

  const open = Boolean(state?.tabOpen) && !closed;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <RiGlobalLine className="text-muted size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{page?.title || page?.url || t('agentBrowser.title')}</p>
          <p className="text-muted truncate text-xs">
            {latest ? `${latest.summary}${page?.url ? ` · ${page.url}` : ''}` : t('agentBrowser.host', { host: state?.deviceName || t('computerLive.host') })}
          </p>
        </div>
        {live ? <Chip size="sm" variant="soft" color="warning">{t('agentBrowser.live')}</Chip> : null}
        <Button size="sm" variant="danger-soft" isDisabled={!open || stopping} onPress={() => { void stop(); }}>
          <RiStopCircleLine className="size-4" />
          {t('agentBrowser.stop')}
        </Button>
      </div>
      {/* Outlined so the user always sees which page the agent controls. */}
      <div className="bg-black/80 relative flex min-h-0 flex-1 items-center justify-center outline outline-2 -outline-offset-2 outline-warning">
        <canvas ref={canvasRef} className={live ? 'h-full w-full object-contain' : 'hidden'} aria-label={t('agentBrowser.frame')} />
        {!live && still ? <img src={still.dataUrl} alt={t('agentBrowser.screenshot')} className="h-full w-full object-contain" /> : null}
        {!live && !still ? (
          <p className="px-6 text-center text-sm text-white/70">{open ? t('agentBrowser.waiting') : t('agentBrowser.closed')}</p>
        ) : null}
      </div>
    </div>
  );
}

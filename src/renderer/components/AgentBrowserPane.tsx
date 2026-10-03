import { useEffect, useRef, useState } from 'react';
import { RiGlobalLine, RiStopCircleLine } from '@remixicon/react';
import { Button, Chip, toast } from '@heroui/react';
import { V2ApiClient } from '@todex/protocol/v2';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import type { AgentBrowserTab } from '../../preload/index';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';

/** Overlays the native view would cover: dialogs, menus, popovers, listboxes. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover"]';

function overlayOpen(): boolean {
  return document.querySelector(OVERLAY_SELECTOR) !== null;
}

/**
 * The agent's browser tab for one conversation. The page itself is a native
 * view owned by the main process; this pane only reserves its rectangle.
 * Native views draw above the DOM, so while a dialog or menu is open the
 * view is hidden and a still of the page stands in.
 */
export function AgentBrowserPane({ tab, session, isActive, conversationId }: {
  tab: AgentBrowserTab | undefined;
  session: TodeXSession;
  isActive: boolean;
  conversationId: string;
}) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [covered, setCovered] = useState(overlayOpen);
  const [still, setStill] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const key = tab?.key;

  useEffect(() => {
    const observer = new MutationObserver(() => setCovered(overlayOpen()));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-slot'] });
    return () => observer.disconnect();
  }, []);

  // Grab a still before hiding the view behind an overlay.
  useEffect(() => {
    if (!key || !covered) return;
    let alive = true;
    void window.todexDesktop.agentBrowser.capture(key).then(image => { if (alive) setStill(image); });
    return () => { alive = false; };
  }, [covered, key]);

  useEffect(() => {
    const host = hostRef.current;
    if (!key || !host) return;
    const api = window.todexDesktop.agentBrowser;
    const report = () => {
      const rect = host.getBoundingClientRect();
      const visible = isActive && !covered && rect.width > 0 && rect.height > 0 && host.offsetParent !== null;
      api.setBounds(key, visible ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null);
    };
    report();
    const resize = new ResizeObserver(report);
    resize.observe(host);
    window.addEventListener('resize', report);
    // The aside animates its width; follow it frame by frame while it moves.
    let frame = 0;
    const follow = () => { report(); frame = requestAnimationFrame(follow); };
    frame = requestAnimationFrame(follow);
    const stopFollowing = setTimeout(() => cancelAnimationFrame(frame), 600);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', report);
      cancelAnimationFrame(frame);
      clearTimeout(stopFollowing);
      api.setBounds(key, null);
    };
  }, [covered, isActive, key]);

  const stop = async () => {
    setStopping(true);
    try {
      const api = new V2ApiClient({ serverUrl: session.settings.serverUrl, device: deviceIdentityFromSecret(session.settings.deviceSecret) });
      await api.revokeAgentDesktop(conversationId);
      // The daemon releases the tab; close it here too in case it is offline.
      if (key) await window.todexDesktop.agentBrowser.close(key);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentBrowser.stopFailed'));
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <RiGlobalLine className="text-muted size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{tab?.title || tab?.url || t('agentBrowser.title')}</p>
          {tab?.url ? <p className="text-muted truncate text-xs">{tab.url}</p> : null}
        </div>
        {tab?.tunnel ? (
          <span title={t('agentBrowser.tunnelHint')}>
            <Chip size="sm" variant="soft">{t('agentBrowser.tunnel', { remote: tab.tunnel.remotePort, local: tab.tunnel.localPort })}</Chip>
          </span>
        ) : null}
        <Chip size="sm" variant="soft" color="warning">{t('agentBrowser.controlled')}</Chip>
        <Button size="sm" variant="danger-soft" isDisabled={!tab || stopping} onPress={() => { void stop(); }}>
          <RiStopCircleLine className="size-4" />
          {t('agentBrowser.stop')}
        </Button>
      </div>
      {/* Outlined so the user always sees which page the agent controls. */}
      <div ref={hostRef} className="relative min-h-0 flex-1 outline outline-2 -outline-offset-2 outline-warning">
        {!tab ? (
          <div className="text-muted flex h-full items-center justify-center px-6 text-center text-sm">{t('agentBrowser.closed')}</div>
        ) : covered && still ? (
          <img src={still} alt="" className="h-full w-full object-contain object-top" />
        ) : null}
      </div>
    </div>
  );
}

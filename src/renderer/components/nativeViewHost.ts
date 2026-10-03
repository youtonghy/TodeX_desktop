import { useEffect, useRef, useState } from 'react';
import type { AgentBrowserBounds } from '../../preload/index';

/** Overlays a native view would cover: dialogs, menus, popovers, listboxes. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover"]';

function overlayOpen(): boolean {
  return document.querySelector(OVERLAY_SELECTOR) !== null;
}

/**
 * Reserves a DOM rectangle for a native view the main process draws (agent
 * browser, Workbench preview). Native views draw above the DOM, so while a
 * dialog or menu is open the view is hidden and `still`, a capture of the
 * page, should stand in.
 */
export function useNativeViewHost(key: string | undefined, isActive: boolean, api: {
  setBounds: (key: string, bounds: AgentBrowserBounds | null) => void;
  capture: (key: string) => Promise<string | null>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [covered, setCovered] = useState(overlayOpen);
  const [still, setStill] = useState<string | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const observer = new MutationObserver(() => setCovered(overlayOpen()));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-slot'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!key || !covered) return;
    let alive = true;
    void apiRef.current.capture(key).then(image => { if (alive) setStill(image); });
    return () => { alive = false; };
  }, [covered, key]);

  useEffect(() => {
    const host = hostRef.current;
    if (!key || !host) return;
    const report = () => {
      const rect = host.getBoundingClientRect();
      const visible = isActive && !covered && rect.width > 0 && rect.height > 0 && host.offsetParent !== null;
      apiRef.current.setBounds(key, visible ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null);
    };
    report();
    const resize = new ResizeObserver(report);
    resize.observe(host);
    window.addEventListener('resize', report);
    // The aside animates its width; follow it frame by frame for a moment.
    let frame = 0;
    const follow = () => { report(); frame = requestAnimationFrame(follow); };
    frame = requestAnimationFrame(follow);
    const stopFollowing = setTimeout(() => cancelAnimationFrame(frame), 600);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', report);
      cancelAnimationFrame(frame);
      clearTimeout(stopFollowing);
      apiRef.current.setBounds(key, null);
    };
  }, [covered, isActive, key]);

  return { hostRef, covered, still };
}

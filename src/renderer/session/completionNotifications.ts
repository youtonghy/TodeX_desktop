import { useCallback, useEffect, useRef, useState } from 'react';
import { loadJson, saveJson } from '../lib/storage';
import { SETTINGS_STORAGE_KEY, type TimelineEntry } from './helpers';

const STORAGE_KEY = `${SETTINGS_STORAGE_KEY}.completionNotifications.v1`;
const BODY_MAX_LENGTH = 160;

export type CompletionNotificationResult = 'granted' | 'denied' | 'unsupported';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Reply excerpt shown as the notification body; falls back to a generic line. */
export function completionNotificationBody(timeline: TimelineEntry[]): string {
  const reply = timeline.find((entry) => entry.kind === 'incoming' && entry.subtitle.trim());
  const text = (reply?.subtitle ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '任务已完成，点击查看回复。';
  return text.length > BODY_MAX_LENGTH ? `${text.slice(0, BODY_MAX_LENGTH)}…` : text;
}

/**
 * A system notification is only worthwhile for a turn the user is not already
 * watching: an unfocused or hidden window, or a background conversation
 * finishing while another one is on screen.
 */
export function shouldNotifyCompletion(options: {
  enabled: boolean;
  supported: boolean;
  viewingConversation: boolean;
}): boolean {
  if (!options.enabled || !options.supported) return false;
  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return false;
  return !options.viewingConversation;
}

export function postCompletionNotification(options: {
  title: string;
  body: string;
  tag: string;
  onActivate?: () => void;
}): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification(options.title, { body: options.body, tag: options.tag });
    notification.onclick = () => {
      window.todexDesktop?.app?.focus?.();
      options.onActivate?.();
    };
  } catch {
    // Some platforms expose the API but cannot construct notifications.
  }
}

export function useCompletionNotifications() {
  const [enabled, setEnabled] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const changedRef = useRef(false);
  const savesRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    void loadJson<unknown>(STORAGE_KEY, false).then((value) => {
      if (!cancelled && !changedRef.current) setEnabled(value === true);
    }).catch(() => {
      // Keep notifications off when local storage is unavailable.
    }).finally(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback((value: boolean) => {
    savesRef.current = savesRef.current.then(() => saveJson(STORAGE_KEY, value)).catch((error) => {
      console.error('Failed to save completion notification preference', error);
    });
  }, []);

  const setCompletionNotifications = useCallback(async (value: boolean): Promise<CompletionNotificationResult> => {
    if (!value) {
      changedRef.current = true;
      setEnabled(false);
      persist(false);
      return 'granted';
    }
    if (!notificationsSupported()) return 'unsupported';
    if ((await Notification.requestPermission()) !== 'granted') return 'denied';
    changedRef.current = true;
    setEnabled(true);
    persist(true);
    return 'granted';
  }, [persist]);

  return {
    completionNotifications: enabled,
    completionNotificationsHydrated: hydrated,
    completionNotificationsSupported: notificationsSupported(),
    setCompletionNotifications,
  };
}

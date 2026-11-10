import { useCallback, useEffect, useRef, useState } from 'react';
import { loadJson, saveJson } from '../lib/storage';
import { SETTINGS_STORAGE_KEY, type TimelineEntry } from './helpers';
import { t } from '../i18n';
import { platform } from '../platform';
import { permissionRequestSummary, type PendingRequest } from '@todex/protocol/todex';
import { DESKTOP_BROWSER_ACTION_KIND, DESKTOP_BROWSER_GRANT_KIND } from '@todex/protocol/agentDesktop';
import { AGENT_SSH_HOST_GRANT_KIND } from '@todex/protocol/ssh';

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
  if (!text) return t('notify.completedFallback');
  return text.length > BODY_MAX_LENGTH ? `${text.slice(0, BODY_MAX_LENGTH)}…` : text;
}

/** Request kinds that ask the user for an answer (Claude `AskUserQuestion`
 * as `user_input`, MCP elicitations, Pi extension prompts) rather than for
 * an approval. */
const QUESTION_REQUEST_KINDS = new Set(['user_input', 'elicitation', 'extension_ui']);

export type RequestNotificationKind = 'approval' | 'question';

export function requestNotificationKind(request: PendingRequest): RequestNotificationKind {
  return typeof request.data.kind === 'string' && QUESTION_REQUEST_KINDS.has(request.data.kind) ? 'question' : 'approval';
}

const oneLine = (value: unknown): string => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const clip = (text: string): string => text.length > BODY_MAX_LENGTH ? `${text.slice(0, BODY_MAX_LENGTH)}…` : text;

/** The backend titles its agent tool approvals (desktop browser, SSH host
 * connection) in English; build them from the structured details instead. */
export function agentToolRequestTitle(request: PendingRequest, translate: typeof t = t): string | undefined {
  const kind = request.data.kind;
  const details = request.data.details !== null && typeof request.data.details === 'object' && !Array.isArray(request.data.details)
    ? request.data.details as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  if (kind === AGENT_SSH_HOST_GRANT_KIND) {
    if (details.local === true) return translate('agentSsh.localGrantTitle');
    if (text(details.host)) return translate('agentSsh.hostGrantTitle', { host: text(details.host) });
  }
  if (kind === DESKTOP_BROWSER_GRANT_KIND && text(details.host)) return translate('agentBrowser.grantTitle', { host: text(details.host) });
  if (kind === DESKTOP_BROWSER_ACTION_KIND && text(details.action)) return translate('agentBrowser.actionTitle', { action: text(details.action) });
  return undefined;
}

/** The question a question card asks, if the request carries one. */
function requestQuestionText(request: PendingRequest): string {
  const details = request.data.details !== null && typeof request.data.details === 'object' && !Array.isArray(request.data.details)
    ? request.data.details as Record<string, unknown> : {};
  if (Array.isArray(details.questions)) {
    return details.questions.map((question) => {
      const item = question !== null && typeof question === 'object' ? question as Record<string, unknown> : {};
      return oneLine(item.question) || oneLine(item.header);
    }).filter(Boolean).join(' / ');
  }
  return oneLine(details.message) || oneLine(details.title) || oneLine(request.title);
}

/** What an approval or question card asks, as a notification body. */
export function requestNotificationBody(request: PendingRequest): string {
  if (requestNotificationKind(request) === 'question') {
    return clip(requestQuestionText(request) || t('notify.questionFallback'));
  }
  const summary = permissionRequestSummary(request);
  const command = summary.command ? oneLine(summary.command) : '';
  return clip(command ? `${t('runStatus.runCommand')}: ${command}`
    : summary.tool ? t('runStatus.useTool', { tool: summary.tool })
      : agentToolRequestTitle(request) ?? (request.title || t('chat.permissionApproval')));
}

/** Notification title naming the conversation and what it is waiting for. */
export function requestNotificationTitle(request: PendingRequest, name: string): string {
  return requestNotificationKind(request) === 'question'
    ? t('notify.questionTitle', { name })
    : t('notify.approvalTitle', { name });
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

/** Posts a system notification; returns it so the caller can close it once
 * it no longer applies. `requireInteraction` keeps it on screen until the
 * user acts, for requests that block the agent. */
export function postCompletionNotification(options: {
  title: string;
  body: string;
  tag: string;
  requireInteraction?: boolean;
  onActivate?: () => void;
}): Notification | null {
  if (!notificationsSupported() || Notification.permission !== 'granted') return null;
  try {
    const notification = new Notification(options.title, {
      body: options.body,
      tag: options.tag,
      ...(options.requireInteraction ? { requireInteraction: true } : {}),
    });
    notification.onclick = () => {
      platform.app.focus();
      options.onActivate?.();
      notification.close();
    };
    return notification;
  } catch (error) {
    // Some platforms expose the API but cannot construct notifications.
    console.warn('Failed to show system notification', error);
    return null;
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

import { release } from 'node:os';
import {
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  screen,
  session as electronSession,
  systemPreferences,
  type Display,
} from 'electron';
import type {
  AgentBrowserResult,
  ComputerActArgs,
  ComputerObserveArgs,
  ExecutorInvokePayload,
} from '@todex/protocol/agentDesktop';
import { ComputerHelper, computerHelperPath } from './computerHelper';
import {
  checkTarget,
  checkUserActive,
  supportedOs,
  toScreenPoint,
  usesPointer,
  type ShotMapping,
  type Target,
} from './computerPolicy';
import { ExecutorFailure, type ExecutorLogger } from './executorLink';
import { COMPUTER_ENABLED_KEY } from './profiles';

const SCREENSHOT_MAX_WIDTH = 1280;
const SCREENSHOT_QUALITY = 70;
const KILL_SWITCH = 'CommandOrControl+Shift+Escape';
const STOP_URL = 'todex-computer://stop';

export type ComputerSessionInfo = { key: string; profileId: string; conversationId: string; displayId: number; summary: string };
export type ComputerPermissions = { supported: boolean; helper: boolean; screen: string; accessibility: boolean };

type Session = ComputerSessionInfo & { shot?: ShotMapping };

type Strings = { controlling: string; stop: string };

/**
 * Computer Use on this Mac: observes through the helper and Electron's
 * screen capture, applies the desktop-side policy, and keeps the user in
 * control with a visible stop pill and a global kill switch.
 */
export class ComputerController {
  private helper: ComputerHelper | null = null;
  private readonly sessions = new Map<string, Session>();
  private pill: BrowserWindow | null = null;
  private marker: BrowserWindow | null = null;
  private markerTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly readStore: () => Record<string, unknown>,
    private readonly revoke: (profileId: string, conversationId: string) => Promise<void>,
    private readonly onSessions: (sessions: ComputerSessionInfo[]) => void,
    private readonly strings: () => Strings,
    private readonly log: ExecutorLogger,
  ) {}

  permissions(): ComputerPermissions {
    return {
      supported: supportedOs(process.platform, release()),
      helper: computerHelperPath() !== null,
      screen: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unknown',
      accessibility: process.platform === 'darwin' && systemPreferences.isTrustedAccessibilityClient(false),
    };
  }

  /** Prompts for Accessibility and triggers the Screen Recording prompt. */
  async requestPermissions(): Promise<ComputerPermissions> {
    if (process.platform === 'darwin') {
      systemPreferences.isTrustedAccessibilityClient(true);
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => undefined);
    }
    return this.permissions();
  }

  /** Offer the `screen` capability: switched on, supported, helper present, both permissions. */
  available(): boolean {
    if (this.readStore()[COMPUTER_ENABLED_KEY] !== true) return false;
    const status = this.permissions();
    return status.supported && status.helper && status.screen === 'granted' && status.accessibility;
  }

  sessionsInfo(): ComputerSessionInfo[] {
    return [...this.sessions.values()].map(({ shot: _shot, ...info }) => info);
  }

  async invoke(profileId: string, payload: ExecutorInvokePayload, _signal: AbortSignal): Promise<AgentBrowserResult> {
    if (!this.available()) {
      throw new ExecutorFailure('PERMISSION_REQUIRED', 'Computer Use is off on this Mac, or Screen Recording / Accessibility is not granted to TodeX.');
    }
    const key = `${profileId}:${payload.conversationId}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = { key, profileId, conversationId: payload.conversationId, displayId: screen.getPrimaryDisplay().id, summary: '' };
      this.sessions.set(key, session);
      this.sessionsChanged();
    }
    switch (payload.tool) {
      case 'computer_observe':
        return this.observe(session, payload.args as ComputerObserveArgs) as unknown as AgentBrowserResult;
      case 'computer_act':
        return this.act(session, payload.args as ComputerActArgs) as unknown as AgentBrowserResult;
      default:
        throw new ExecutorFailure('INVALID_ARGUMENT', `unknown tool ${String(payload.tool)}`);
    }
  }

  /** The daemon ended the conversation's screen session. */
  release(profileId: string, conversationId: string): void {
    if (this.sessions.delete(`${profileId}:${conversationId}`)) this.sessionsChanged();
  }

  /** The executor connection dropped: its sessions are over. */
  disconnected(profileId: string): void {
    let changed = false;
    for (const [key, session] of this.sessions) {
      if (session.profileId === profileId) {
        this.sessions.delete(key);
        changed = true;
      }
    }
    if (changed) this.sessionsChanged();
  }

  /** The display a live view should show: the newest session's. */
  liveDisplayId(): number | null {
    const sessions = [...this.sessions.values()];
    return sessions.length ? sessions[sessions.length - 1].displayId : null;
  }

  stop(): void {
    this.helper?.stop();
    this.helper = null;
    this.sessions.clear();
    this.sessionsChanged();
  }

  // ---- Tools ----------------------------------------------------------------

  private client(): ComputerHelper {
    if (this.helper) return this.helper;
    const path = computerHelperPath();
    if (!path) throw new ExecutorFailure('PERMISSION_REQUIRED', 'The Computer Use helper is missing from this TodeX build.');
    this.helper = new ComputerHelper(path, this.log);
    return this.helper;
  }

  private async observe(session: Session, args: ComputerObserveArgs) {
    const observed = await this.client().request('observe', {
      ...(args.app ? { app: args.app } : {}),
      ...(typeof args.window === 'number' ? { window: args.window } : {}),
    });
    const displays = screen.getAllDisplays();
    const result: Record<string, unknown> = {
      ...observed,
      displays: displays.map((display, index) => ({
        index, x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height, scale: display.scaleFactor,
      })),
    };
    if (args.screenshot !== false) {
      const window = observed.window as { x: number; y: number; width: number; height: number } | undefined;
      let display: Display;
      let rect: { x: number; y: number; width: number; height: number };
      if (typeof args.display === 'number') {
        display = displays[args.display] ?? screen.getPrimaryDisplay();
        rect = display.bounds;
      } else if (window) {
        display = screen.getDisplayNearestPoint({ x: Math.round(window.x + window.width / 2), y: Math.round(window.y + window.height / 2) });
        rect = intersect(window, display.bounds);
      } else {
        display = screen.getPrimaryDisplay();
        rect = display.bounds;
      }
      const shot = await this.capture(display, rect);
      session.shot = shot.mapping;
      session.displayId = display.id;
      result.screenshot = shot.screenshot;
      this.sessionsChanged();
    }
    session.summary = 'observe';
    return result;
  }

  private async act(session: Session, args: ComputerActArgs) {
    const helper = this.client();
    const hasPoint = typeof args.x === 'number' && typeof args.y === 'number';
    const map = (x?: number, y?: number) => {
      if (typeof x !== 'number' || typeof y !== 'number') return undefined;
      if (!session.shot) throw new ExecutorFailure('INVALID_ARGUMENT', 'x/y refer to a screenshot; call computer_observe first.');
      const point = toScreenPoint(session.shot, x, y);
      if (!point) throw new ExecutorFailure('INVALID_ARGUMENT', `(${x}, ${y}) is outside the latest screenshot.`);
      return point;
    };
    const point = map(args.x, args.y);
    const to = map(args.toX, args.toY);

    if (args.action !== 'wait') {
      const target = await this.target(helper, args, point);
      const failure = checkTarget(target, args.allowedApps ?? [], process.pid);
      if (failure) throw new ExecutorFailure(failure.code, failure.message, failure.detail);
    }
    if (usesPointer(args.action, hasPoint)) {
      const { seconds } = await helper.request('idle') as { seconds?: number };
      const busy = checkUserActive(args.action, hasPoint, Number(seconds ?? Infinity));
      if (busy) throw new ExecutorFailure(busy.code, busy.message);
    }
    session.summary = args.ref ? `${args.action} ${args.ref}` : args.action;
    this.sessionsChanged();
    if (point) this.markPoint(point);
    const result = await helper.request('act', {
      action: args.action,
      ...(args.ref ? { ref: args.ref } : {}),
      ...(point ? { x: point.x, y: point.y } : {}),
      ...(to ? { toX: to.x, toY: to.y } : {}),
      ...(typeof args.text === 'string' ? { text: args.text } : {}),
      ...(args.keys ? { keys: args.keys } : {}),
      ...(args.app ? { app: args.app } : {}),
      ...(typeof args.window === 'number' ? { window: args.window } : {}),
      ...(typeof args.deltaX === 'number' ? { deltaX: args.deltaX } : {}),
      ...(typeof args.deltaY === 'number' ? { deltaY: args.deltaY } : {}),
      ...(typeof args.ms === 'number' ? { ms: args.ms } : {}),
      ...(args.confirmed ? { confirmed: true } : {}),
    }, 45_000);
    return result;
  }

  /** The app an action would touch, for the policy check. */
  private async target(helper: ComputerHelper, args: ComputerActArgs, point?: { x: number; y: number }): Promise<Target> {
    const fields: Record<string, unknown> = args.action === 'open_app'
      ? { action: 'open_app', app: args.app }
      : args.ref
        ? { ref: args.ref }
        : point
          ? { x: point.x, y: point.y }
          : { action: args.action, ...(args.app ? { app: args.app } : {}) };
    const resolved = await helper.request('resolve', fields);
    return {
      bundleId: String(resolved.bundleId ?? ''),
      name: String(resolved.name ?? ''),
      pid: Number(resolved.pid ?? 0),
    };
  }

  private async capture(display: Display, rect: { x: number; y: number; width: number; height: number }) {
    const scale = display.scaleFactor;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) },
    });
    const source = sources.find(item => item.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new ExecutorFailure('PERMISSION_REQUIRED', 'The screen could not be captured; check the Screen Recording permission for TodeX.');
    }
    const full = source.thumbnail;
    const pixelsPerPoint = full.getSize().width / display.bounds.width;
    let image = full.crop({
      x: Math.round((rect.x - display.bounds.x) * pixelsPerPoint),
      y: Math.round((rect.y - display.bounds.y) * pixelsPerPoint),
      width: Math.max(1, Math.round(rect.width * pixelsPerPoint)),
      height: Math.max(1, Math.round(rect.height * pixelsPerPoint)),
    });
    if (image.getSize().width > SCREENSHOT_MAX_WIDTH) image = image.resize({ width: SCREENSHOT_MAX_WIDTH, quality: 'good' });
    const { width, height } = image.getSize();
    const pointsPerPixel = rect.width / width;
    return {
      mapping: { originX: rect.x, originY: rect.y, pointsPerPixel, width, height },
      screenshot: {
        mimeType: 'image/jpeg' as const,
        data: image.toJPEG(SCREENSHOT_QUALITY).toString('base64'),
        width,
        height,
        originX: rect.x,
        originY: rect.y,
        pointsPerPixel,
      },
    };
  }

  // ---- Visible control --------------------------------------------------------

  private sessionsChanged(): void {
    const infos = this.sessionsInfo();
    this.onSessions(infos);
    if (infos.length) {
      this.showPill(infos[infos.length - 1]);
      if (!globalShortcut.isRegistered(KILL_SWITCH)) {
        globalShortcut.register(KILL_SWITCH, () => { void this.stopAll(); });
      }
    } else {
      this.pill?.destroy();
      this.pill = null;
      this.marker?.destroy();
      this.marker = null;
      if (globalShortcut.isRegistered(KILL_SWITCH)) globalShortcut.unregister(KILL_SWITCH);
    }
  }

  /** ⌘⇧⎋ or the pill's Stop: end every session and revoke its access. */
  async stopAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.sessionsChanged();
    await Promise.all(sessions.map(session => this.revoke(session.profileId, session.conversationId).catch(error => {
      this.log('warn', 'computer.revoke.failed', { error: String(error) });
    })));
  }

  private showPill(session: ComputerSessionInfo): void {
    const display = screen.getAllDisplays().find(item => item.id === session.displayId) ?? screen.getPrimaryDisplay();
    const { width: pillWidth, height: pillHeight } = { width: 340, height: 44 };
    const x = display.workArea.x + display.workArea.width - pillWidth - 16;
    const y = display.workArea.y + 12;
    if (!this.pill || this.pill.isDestroyed()) {
      this.pill = new BrowserWindow({
        width: pillWidth, height: pillHeight, x, y, frame: false, resizable: false, movable: false,
        focusable: false, skipTaskbar: true, show: false, transparent: true, hasShadow: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
      });
      this.pill.setAlwaysOnTop(true, 'screen-saver');
      this.pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      // Never part of what the agent (or the live view) sees.
      this.pill.setContentProtection(true);
      this.pill.webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
        if (url.startsWith(STOP_URL)) void this.stopAll();
      });
    }
    this.pill.setBounds({ x, y, width: pillWidth, height: pillHeight });
    const strings = this.strings();
    void this.pill.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pillHtml(strings, session.summary))}`);
    this.pill.showInactive();
  }

  /** A short-lived ring where a pointer action lands. */
  private markPoint(point: { x: number; y: number }): void {
    const size = 36;
    if (!this.marker || this.marker.isDestroyed()) {
      this.marker = new BrowserWindow({
        width: size, height: size, frame: false, transparent: true, focusable: false, skipTaskbar: true,
        show: false, hasShadow: false, resizable: false,
        webPreferences: { sandbox: true, javascript: false },
      });
      this.marker.setAlwaysOnTop(true, 'screen-saver');
      this.marker.setIgnoreMouseEvents(true);
      this.marker.setContentProtection(true);
      const ring = '<body style="margin:0;background:transparent"><div style="width:30px;height:30px;margin:3px;border:3px solid #f59e0b;border-radius:50%;box-sizing:border-box"></div></body>';
      void this.marker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(ring)}`);
    }
    this.marker.setBounds({ x: Math.round(point.x - size / 2), y: Math.round(point.y - size / 2), width: size, height: size });
    this.marker.showInactive();
    if (this.markerTimer) clearTimeout(this.markerTimer);
    this.markerTimer = setTimeout(() => this.marker?.hide(), 1500);
  }
}

function intersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : b;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
}

function pillHtml(strings: Strings, summary: string): string {
  return `<!doctype html><html><body style="margin:0;font:13px -apple-system,system-ui;background:transparent">
<div style="display:flex;align-items:center;gap:8px;height:40px;margin:2px;padding:0 6px 0 12px;border-radius:20px;background:rgba(24,24,27,.92);color:#fff;border:1px solid #f59e0b">
<span style="width:8px;height:8px;border-radius:50%;background:#f59e0b"></span>
<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(strings.controlling)}${summary ? ` · ${escapeHtml(summary)}` : ''}</span>
<a href="${STOP_URL}" style="padding:5px 10px;border-radius:14px;background:#dc2626;color:#fff;text-decoration:none">${escapeHtml(strings.stop)} ⌘⇧⎋</a>
</div></body></html>`;
}

/**
 * Live view: the renderer's getDisplayMedia gets the controlled display,
 * only while a Computer Use session runs and only for the TodeX window.
 */
export function installLiveViewHandler(controller: ComputerController, window: () => BrowserWindow | null): void {
  electronSession.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const main = window();
    const displayId = controller.liveDisplayId();
    if (!main || displayId === null || request.frame?.top?.processId !== main.webContents.getProcessId()) {
      callback({});
      return;
    }
    void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then(sources => {
      const source = sources.find(item => item.display_id === String(displayId)) ?? sources[0];
      callback(source ? { video: source } : {});
    }, () => callback({}));
  });
}

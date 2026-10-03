import { createHash } from 'node:crypto';
import { session as electronSession, WebContentsView, type BrowserWindow, type Rectangle } from 'electron';
import type {
  AgentBrowserResult,
  BrowserActArgs,
  BrowserNavigateArgs,
  BrowserOpenArgs,
  BrowserSnapshotArgs,
  ExecutorInvokePayload,
} from '@todex/protocol/agentDesktop';
import { isLoopbackUrl } from '@todex/protocol/mobileParity';
import { formatAxTree, type AXNode } from './axTree';
import { ExecutorFailure, type ExecutorLogger } from './executorLink';

/** Agent tabs open at once on this desktop. */
const MAX_TABS = 4;
const VIEWPORT = { width: 1280, height: 800 };
/** Off-window bounds for tabs nobody is looking at. A view hidden with
 * setVisible(false) loses its display surface and cannot be captured;
 * a parked one keeps rendering. */
export const PARKED = { x: -VIEWPORT.width - 200, y: 0, ...VIEWPORT };
const SCREENSHOT_MAX_WIDTH = 1280;
const SCREENSHOT_QUALITY = 70;
/** Store key: named partitions and which workspace uses which. */
export const PARTITIONS_KEY = 'todex.desktop.agentBrowserPartitions.v1';

export type PartitionRecord = { id: string; name: string; createdAt: number };
export type PartitionState = { partitions: PartitionRecord[]; workspaces: Record<string, string> };

/** What the renderer shows for one agent tab. */
export type AgentTabInfo = {
  key: string;
  profileId: string;
  conversationId: string;
  url: string;
  title: string;
  tunnel?: { remotePort: number; localPort: number };
};

type Tab = {
  key: string;
  profileId: string;
  conversationId: string;
  /** `workspaceKey()` of the conversation's workspace. */
  workspace: string;
  view: WebContentsView;
  refs: Map<string, number>;
  attached: boolean;
  tunnel?: { remotePort: number; localPort: number };
};

/** Maps a daemon loopback URL to one the desktop can load (tunnel or as-is). */
export type UrlResolver = (profileId: string, conversationId: string, url: string, signal: AbortSignal) =>
  Promise<{ url: string; tunnel?: { remotePort: number; localPort: number } }>;

export type BrowserStore = {
  read(): Record<string, unknown>;
  write(key: string, value: unknown): void;
};

const KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ExecutorFailure('CANCELLED', 'cancelled'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new ExecutorFailure('CANCELLED', 'cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function workspaceKey(profileId: string, workspace: ExecutorInvokePayload['workspace']): string {
  return `${profileId}:${workspace.id || workspace.path}`;
}

/** Electron partition name for a partition id (stable, filesystem-safe). */
export function partitionName(partitionId: string): string {
  return `persist:todex-agent-${createHash('sha256').update(partitionId).digest('hex').slice(0, 24)}`;
}

/**
 * Browser tabs the agents drive: one `WebContentsView` per conversation,
 * shown in the workbench when the renderer reports a rectangle for it.
 * Each workspace browses in its own persistent partition (re-assignable);
 * top-level navigation stays on loopback (or the tunnelled port), while
 * subresources may come from anywhere.
 */
export class AgentBrowser {
  private readonly tabs = new Map<string, Tab>();
  private readonly guardedSessions = new WeakSet<Electron.Session>();

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly store: BrowserStore,
    private readonly resolveUrl: UrlResolver,
    private readonly onTabsChanged: (tabs: AgentTabInfo[]) => void,
    private readonly log: ExecutorLogger,
  ) {}

  tabsInfo(): AgentTabInfo[] {
    return [...this.tabs.values()].map(tab => ({
      key: tab.key,
      profileId: tab.profileId,
      conversationId: tab.conversationId,
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
      ...(tab.tunnel ? { tunnel: tab.tunnel } : {}),
    }));
  }

  async invoke(profileId: string, payload: ExecutorInvokePayload, signal: AbortSignal): Promise<AgentBrowserResult> {
    const key = `${profileId}:${payload.conversationId}`;
    switch (payload.tool) {
      case 'browser_open':
        return this.open(key, profileId, payload, (payload.args as BrowserOpenArgs).url, signal);
      case 'browser_navigate':
        return this.navigate(this.requireTab(key), profileId, payload.args as BrowserNavigateArgs, signal);
      case 'browser_snapshot':
        return this.snapshot(this.requireTab(key), payload.args as BrowserSnapshotArgs);
      case 'browser_act':
        return this.act(this.requireTab(key), payload.args as BrowserActArgs, signal);
      case 'browser_close':
        this.close(key);
        return {};
      default:
        throw new ExecutorFailure('INVALID_ARGUMENT', `unknown tool ${String(payload.tool)}`);
    }
  }

  /** The daemon revoked a conversation's access. */
  release(profileId: string, conversationId: string): void {
    this.close(`${profileId}:${conversationId}`);
  }

  /** The renderer shows (rect) or hides (null) a tab. */
  setBounds(key: string, bounds: Rectangle | null): void {
    const tab = this.tabs.get(key);
    if (!tab) return;
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      tab.view.setBounds({
        x: Math.round(bounds.x), y: Math.round(bounds.y),
        width: Math.round(bounds.width), height: Math.round(bounds.height),
      });
      tab.view.setVisible(true);
    } else {
      tab.view.setBounds(PARKED);
    }
  }

  /** A still for the renderer while the live view is hidden behind an overlay. */
  async capture(key: string): Promise<string | null> {
    const tab = this.tabs.get(key);
    if (!tab) return null;
    const image = await tab.view.webContents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  }

  close(key: string): void {
    const tab = this.tabs.get(key);
    if (!tab) return;
    this.tabs.delete(key);
    this.window()?.contentView.removeChildView(tab.view);
    // A WebContentsView's contents are not destroyed with the view.
    tab.view.webContents.close();
    this.emitTabs();
  }

  closeAll(): void {
    for (const key of [...this.tabs.keys()]) this.close(key);
  }

  // ---- Partitions ---------------------------------------------------------

  partitionState(): PartitionState {
    const raw = this.store.read()[PARTITIONS_KEY] as Partial<PartitionState> | undefined;
    return {
      partitions: Array.isArray(raw?.partitions) ? raw.partitions.filter(p => p && typeof p.id === 'string') : [],
      workspaces: raw?.workspaces && typeof raw.workspaces === 'object' ? { ...raw.workspaces } : {},
    };
  }

  /** The workspace's partition, created on first use. */
  private partitionFor(key: string, label: string): string {
    const state = this.partitionState();
    let id = state.workspaces[key];
    if (!id || !state.partitions.some(partition => partition.id === id)) {
      id = createHash('sha256').update(`${key}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16);
      state.partitions.push({ id, name: label, createdAt: Date.now() });
      state.workspaces[key] = id;
      this.store.write(PARTITIONS_KEY, state);
    }
    return partitionName(id);
  }

  createPartition(name: string): PartitionRecord {
    const state = this.partitionState();
    const record = { id: createHash('sha256').update(`${name}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16), name: name.trim().slice(0, 80) || 'Browser profile', createdAt: Date.now() };
    state.partitions.push(record);
    this.store.write(PARTITIONS_KEY, state);
    return record;
  }

  /** Points a workspace at another partition; its open tabs close so the next open uses it. */
  assignPartition(workspace: string, partitionId: string): void {
    const state = this.partitionState();
    if (!state.partitions.some(partition => partition.id === partitionId)) throw new Error('unknown partition');
    state.workspaces[workspace] = partitionId;
    this.store.write(PARTITIONS_KEY, state);
    for (const tab of [...this.tabs.values()]) {
      if (tab.workspace === workspace) this.close(tab.key);
    }
  }

  /** Deletes a partition and everything stored in it (cookies, storage, cache). */
  async deletePartition(partitionId: string): Promise<void> {
    const name = partitionName(partitionId);
    for (const tab of [...this.tabs.values()]) {
      if (tab.view.webContents.session === electronSession.fromPartition(name)) this.close(tab.key);
    }
    const ses = electronSession.fromPartition(name);
    await ses.clearStorageData();
    await ses.clearCache();
    const state = this.partitionState();
    state.partitions = state.partitions.filter(partition => partition.id !== partitionId);
    for (const [workspace, id] of Object.entries(state.workspaces)) {
      if (id === partitionId) delete state.workspaces[workspace];
    }
    this.store.write(PARTITIONS_KEY, state);
  }

  // ---- Tools ----------------------------------------------------------------

  private requireTab(key: string): Tab {
    const tab = this.tabs.get(key);
    if (!tab) throw new ExecutorFailure('NO_TAB', 'This conversation has no browser tab; call browser_open first.');
    return tab;
  }

  private async open(key: string, profileId: string, payload: ExecutorInvokePayload, url: string, signal: AbortSignal) {
    let tab = this.tabs.get(key);
    if (!tab) {
      if (this.tabs.size >= MAX_TABS) {
        throw new ExecutorFailure('TAB_LIMIT', `At most ${MAX_TABS} agent browser tabs can be open on this desktop.`);
      }
      const label = payload.workspace.path.split(/[\\/]/).filter(Boolean).pop() || payload.workspace.path;
      const workspace = workspaceKey(profileId, payload.workspace);
      tab = this.createTab(key, profileId, payload.conversationId, workspace, this.partitionFor(workspace, label));
    }
    return this.load(tab, profileId, url, signal);
  }

  private async navigate(tab: Tab, profileId: string, args: BrowserNavigateArgs, signal: AbortSignal) {
    const contents = tab.view.webContents;
    if (args.url) return this.load(tab, profileId, args.url, signal);
    if (args.action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    else if (args.action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    else if (args.action === 'reload') contents.reload();
    await abortable(this.settle(contents), signal);
    return this.page(tab);
  }

  private async load(tab: Tab, profileId: string, url: string, signal: AbortSignal) {
    if (!isLoopbackUrl(url)) throw new ExecutorFailure('NAVIGATION_BLOCKED', `${url} is not a local page.`);
    const target = await this.resolveUrl(profileId, tab.conversationId, url, signal);
    tab.tunnel = target.tunnel;
    try {
      await abortable(tab.view.webContents.loadURL(target.url), signal);
    } catch (error) {
      if (error instanceof ExecutorFailure) throw error;
      // Error pages still leave a page to inspect; report but keep the tab.
      this.log('debug', 'agentDesktop.browser.loadFailed', { error: String(error) });
    }
    this.emitTabs();
    return this.page(tab);
  }

  private page(tab: Tab) {
    return {
      url: tab.view.webContents.getURL(),
      title: tab.view.webContents.getTitle(),
      ...(tab.tunnel ? { tunnel: tab.tunnel } : {}),
    };
  }

  private async cdp<T = Record<string, unknown>>(tab: Tab, method: string, params?: Record<string, unknown>): Promise<T> {
    const debuggerApi = tab.view.webContents.debugger;
    if (!tab.attached || !debuggerApi.isAttached()) {
      debuggerApi.attach('1.3');
      tab.attached = true;
    }
    return debuggerApi.sendCommand(method, params) as Promise<T>;
  }

  private async snapshot(tab: Tab, args: BrowserSnapshotArgs) {
    const { nodes } = await this.cdp<{ nodes: AXNode[] }>(tab, 'Accessibility.getFullAXTree');
    const formatted = formatAxTree(nodes);
    tab.refs = formatted.refs;
    const result: Record<string, unknown> = { ...this.page(tab), tree: formatted.tree, truncated: formatted.truncated };
    if (args.screenshot) {
      // capturePage renders a hidden view for the capture; CDP screenshots
      // wait for frames a hidden view never produces.
      let image = await tab.view.webContents.capturePage(undefined, { stayHidden: true });
      if (image.isEmpty()) throw new ExecutorFailure('EXECUTOR_FAILED', 'the page could not be captured');
      const size = image.getSize();
      if (size.width > SCREENSHOT_MAX_WIDTH) image = image.resize({ width: SCREENSHOT_MAX_WIDTH, quality: 'good' });
      const { width, height } = image.getSize();
      result.screenshot = { mimeType: 'image/jpeg', data: image.toJPEG(SCREENSHOT_QUALITY).toString('base64'), width, height };
    }
    return result as AgentBrowserResult;
  }

  private nodeFor(tab: Tab, ref: string | undefined): number {
    const node = ref ? tab.refs.get(ref) : undefined;
    if (!node) throw new ExecutorFailure('REF_NOT_FOUND', `${ref ?? 'ref'} is not in the latest snapshot; call browser_snapshot again.`);
    return node;
  }

  private async center(tab: Tab, backendNodeId: number): Promise<{ x: number; y: number }> {
    await this.cdp(tab, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => undefined);
    const { model } = await this.cdp<{ model: { content: number[] } }>(tab, 'DOM.getBoxModel', { backendNodeId });
    const [x1, y1, , , x3, y3] = model.content;
    return { x: (x1 + x3) / 2, y: (y1 + y3) / 2 };
  }

  private async callOn(tab: Tab, backendNodeId: number, functionDeclaration: string, args: unknown[] = []): Promise<unknown> {
    const { object } = await this.cdp<{ object: { objectId: string } }>(tab, 'DOM.resolveNode', { backendNodeId });
    const { result, exceptionDetails } = await this.cdp<{ result: { value?: unknown }; exceptionDetails?: unknown }>(tab, 'Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration,
      arguments: args.map(value => ({ value })),
      returnByValue: true,
    });
    if (exceptionDetails) throw new ExecutorFailure('EXECUTOR_FAILED', 'the page rejected the action');
    return result.value;
  }

  private async act(tab: Tab, args: BrowserActArgs, signal: AbortSignal) {
    switch (args.action) {
      case 'click':
      case 'hover': {
        const point = await this.center(tab, this.nodeFor(tab, args.ref));
        await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        if (args.action === 'click') {
          await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
          await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
        }
        break;
      }
      case 'type': {
        const node = this.nodeFor(tab, args.ref);
        const isPassword = await this.callOn(tab, node, 'function () { return this instanceof HTMLInputElement && this.type === "password"; }');
        if (isPassword === true && !args.confirmed) {
          throw new ExecutorFailure('SENSITIVE_ACTION', 'typing into a password field');
        }
        await this.callOn(tab, node, 'function () { this.focus(); if (typeof this.select === "function") this.select(); }');
        await this.cdp(tab, 'Input.insertText', { text: args.text ?? '' });
        break;
      }
      case 'select': {
        const matched = await this.callOn(tab, this.nodeFor(tab, args.ref), `function (wanted) {
          if (!(this instanceof HTMLSelectElement)) return false;
          const option = [...this.options].find(o => o.value === wanted || o.label === wanted || o.text.trim() === wanted);
          if (!option) return false;
          this.value = option.value;
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }`, [args.text ?? '']);
        if (matched !== true) throw new ExecutorFailure('INVALID_ARGUMENT', `no option "${args.text}" in ${args.ref}`);
        break;
      }
      case 'press': {
        const keyName = args.key ?? '';
        const known = KEYS[keyName];
        if (!known && keyName.length !== 1) throw new ExecutorFailure('INVALID_ARGUMENT', `unsupported key ${keyName}`);
        if (known) {
          const base = { key: known.key, code: known.code, windowsVirtualKeyCode: known.keyCode, nativeVirtualKeyCode: known.keyCode };
          await this.cdp(tab, 'Input.dispatchKeyEvent', { type: known.text ? 'keyDown' : 'rawKeyDown', ...base, ...(known.text ? { text: known.text } : {}) });
          await this.cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
        } else {
          await this.cdp(tab, 'Input.insertText', { text: keyName });
        }
        break;
      }
      case 'scroll': {
        const bounds = tab.view.getBounds();
        await this.cdp(tab, 'Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: Math.max(1, bounds.width / 2), y: Math.max(1, bounds.height / 2), deltaX: 0, deltaY: args.deltaY ?? 600,
        });
        break;
      }
      case 'wait':
        await abortable(new Promise(resolve => setTimeout(resolve, Math.min(args.ms ?? 1000, 10_000))), signal);
        break;
      default:
        throw new ExecutorFailure('INVALID_ARGUMENT', `unknown action ${String(args.action)}`);
    }
    // Let a click-triggered navigation start before reporting the page.
    await abortable(new Promise(resolve => setTimeout(resolve, 150)), signal);
    await abortable(this.settle(tab.view.webContents), signal);
    return this.page(tab);
  }

  /** Resolves once the page stops loading (bounded). */
  private settle(contents: Electron.WebContents): Promise<void> {
    if (!contents.isLoading()) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(done, 10_000);
      function done() {
        clearTimeout(timer);
        contents.removeListener('did-stop-loading', done);
        resolve();
      }
      contents.once('did-stop-loading', done);
    });
  }

  // ---- Views ------------------------------------------------------------------

  private createTab(key: string, profileId: string, conversationId: string, workspace: string, partition: string): Tab {
    const window = this.window();
    if (!window) throw new ExecutorFailure('EXECUTOR_FAILED', 'the TodeX window is not open');
    const view = new WebContentsView({
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const tab: Tab = { key, profileId, conversationId, workspace, view, refs: new Map(), attached: false };
    this.guardSession(view.webContents.session);
    const contents = view.webContents;
    // Top-level navigation stays local; the page's own subresources do not.
    const allowed = (url: string) => isLoopbackUrl(url) || url === 'about:blank';
    const guard = (event: Electron.Event, url: string) => {
      if (!allowed(url)) {
        event.preventDefault();
        this.log('info', 'agentDesktop.browser.navigationBlocked', { key, url });
      }
    };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', (event) => {
      if (event.isMainFrame && !allowed(event.url)) {
        event.preventDefault();
        this.log('info', 'agentDesktop.browser.redirectBlocked', { key, url: event.url });
      }
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isLoopbackUrl(url)) void contents.loadURL(url).catch(() => undefined);
      return { action: 'deny' };
    });
    contents.on('did-navigate', () => this.emitTabs());
    contents.on('page-title-updated', () => this.emitTabs());
    contents.on('render-process-gone', () => this.close(key));
    // Agents act on pages nobody is looking at; keep their timers running.
    contents.setBackgroundThrottling(false);
    view.setBounds(PARKED);
    window.contentView.addChildView(view);
    this.tabs.set(key, tab);
    this.emitTabs();
    return tab;
  }

  /** Downloads and permission prompts never reach the user from agent pages. */
  private guardSession(ses: Electron.Session): void {
    if (this.guardedSessions.has(ses)) return;
    this.guardedSessions.add(ses);
    ses.on('will-download', (event, item) => {
      event.preventDefault();
      this.log('info', 'agentDesktop.browser.downloadBlocked', { url: item.getURL() });
    });
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  }

  private emitTabs(): void {
    this.onTabsChanged(this.tabsInfo());
  }
}

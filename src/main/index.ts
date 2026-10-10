import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, session, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { startAutoUpdates, refreshUpdateMenu } from './autoUpdates';
import { syncDesktopEntry } from './desktopEntry';
import { PreviewViews, type InspectColors, type PreviewTarget } from './previewViews';
import { isMainLocale, mainT, setMainLocale } from './i18n';
import { openPathRefusal, shellPathRefusal, type PathInfo, type ShellPathRefusal } from './shellPolicy';
import {
  DEBUG_BUILD_VERSION,
  DEBUG_LOG_PATH_KEY,
  DebugLogger,
  chromiumLogPath,
  installConsoleCapture,
  isDebugBuild,
  normalizeConfiguredLogPath,
  type DebugLogLevel,
} from './debugLogger';

const execFileAsync = promisify(execFile);

const MAX_RENDERER_CRASH_RELOADS = 5;
const APP_IDENTITY = 'todex-desktop';
const PROTOCOL_VERSION = 'v2';
/** The `Origin` the bundled renderer presents to backends. A `loadFile` page
 * has none of its own (WebSockets send `file://`, opaque contexts `null`), and
 * anonymous loopback backends refuse those because any web page can produce
 * `null`; they accept this fixed value instead. */
const DESKTOP_APP_ORIGIN = 'todex-desktop://app';
/** Web permissions the renderer uses: completion notifications and the
 * clipboard (copy buttons write only; nothing reads the clipboard). */
const RENDERER_PERMISSIONS = new Set([
  'notifications',
  'clipboard-sanitized-write',
  // Settings lists installed fonts (window.queryLocalFonts).
  'local-fonts',
  // Local Network Access: the renderer talks to user-configured backends on
  // loopback and the LAN.
  'local-network',
  'local-network-access',
  'loopback-network',
]);
const DEFAULT_BACKEND_URL = process.env.TODEX_BACKEND_URL?.trim() || 'http://127.0.0.1:7345';
/** Store keys of the desktop-run agent browser (before it moved to the backend). */
const LEGACY_AGENT_BROWSER_KEYS = ['todex.desktop.agentBrowserPartitions.v1', 'todex.desktop.agentDesktopExecutor.v1', 'todex.desktop.computerUse.v1'];

/** Electron partition directories of that browser (`persist:todex-agent-*`). */
function legacyAgentPartitionDirs(): string[] {
  const root = join(app.getPath('userData'), 'Partitions');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(name => name.startsWith('todex-agent-')).map(name => join(root, name));
}
const BUILD_VERSION = typeof __TODEX_BUILD_VERSION__ === 'string'
  ? __TODEX_BUILD_VERSION__
  : process.env.TODEX_BUILD_VERSION?.trim() || (app.isPackaged ? app.getVersion() : DEBUG_BUILD_VERSION);
const DEBUG_BUILD = isDebugBuild(BUILD_VERSION);

type StoreShape = Record<string, unknown>;

let debugLogger: DebugLogger | null = null;
let mainWindow: BrowserWindow | null = null;
let previews: PreviewViews | null = null;

function debugLog(level: DebugLogLevel, event: string, data?: unknown): void {
  debugLogger?.write(level, event, data);
}

const IPC_VALUE_PREVIEW_CHARS = 512;

// IPC payloads can be arbitrarily large (store:set mirrors whole collections);
// trace logs keep the shape and size without mirroring the payload.
function summarizeIpcValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > IPC_VALUE_PREVIEW_CHARS
      ? `${value.slice(0, IPC_VALUE_PREVIEW_CHARS)}… [${value.length} chars]`
      : value;
  }
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return `[array ${value.length} items]`;
  const keys = Object.keys(value);
  return `[object ${keys.slice(0, 16).join(',')}${keys.length > 16 ? ',…' : ''}]`;
}

/** Store channels can carry device keys (legacy plaintext and secureStore
 * values): trace logs keep the key name and the value's size only. */
const SENSITIVE_IPC_CHANNELS = new Set(['store:get', 'store:set', 'secureStore:get', 'secureStore:set']);

function redactIpcValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return `[redacted ${value.length} chars]`;
  if (Array.isArray(value)) return `[redacted array ${value.length} items]`;
  return `[redacted ${typeof value}]`;
}

function handleIpc(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  const sensitive = SENSITIVE_IPC_CHANNELS.has(channel);
  ipcMain.handle(channel, async (event, ...args: any[]) => {
    const started = Date.now();
    const loggedArgs = sensitive
      ? args.map((arg, index) => (index === 0 ? summarizeIpcValue(arg) : redactIpcValue(arg)))
      : args.map(summarizeIpcValue);
    debugLog('trace', 'ipc.request', { channel, senderId: event.sender.id, args: loggedArgs });
    try {
      const result = await handler(event, ...args);
      debugLog('trace', 'ipc.response', { channel, senderId: event.sender.id, durationMs: Date.now() - started, result: sensitive ? redactIpcValue(result) : summarizeIpcValue(result) });
      return result;
    } catch (error) {
      debugLog('error', 'ipc.error', { channel, senderId: event.sender.id, durationMs: Date.now() - started, error });
      throw error;
    }
  });
}

function sourceRoot(): string {
  try {
    return join(fileURLToPath(new URL('.', import.meta.url)), '../..');
  } catch {
    return process.cwd();
  }
}

function logIdentity(window: BrowserWindow): void {
  const renderer = process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : join(__dirname, '../renderer/index.html');
  console.log(`[${APP_IDENTITY}] app=${APP_IDENTITY}`);
  console.log(`[${APP_IDENTITY}] protocol=${PROTOCOL_VERSION}`);
  console.log(`[${APP_IDENTITY}] electron=${process.versions.electron} chrome=${process.versions.chrome}`);
  console.log(`[${APP_IDENTITY}] execPath=${process.execPath}`);
  console.log(`[${APP_IDENTITY}] sourceRoot=${sourceRoot()}`);
  console.log(`[${APP_IDENTITY}] userData=${app.getPath('userData')}`);
  console.log(`[${APP_IDENTITY}] renderer=${renderer}`);
  console.log(`[${APP_IDENTITY}] defaultBackend=${DEFAULT_BACKEND_URL}`);
  window.webContents.on('did-navigate', (_event, url) => {
    console.log(`[${APP_IDENTITY}] did-navigate ${url}`);
  });
}

function assertElectronBinary(): void {
  if (!existsSync(process.execPath)) {
    throw new Error(`Electron executable missing: ${process.execPath}`);
  }
}

async function probeDefaultBackend(): Promise<void> {
  const target = `${DEFAULT_BACKEND_URL.replace(/\/+$/, '')}/v2/version`;
  debugLog('debug', 'backend.probe.request', { target });
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(2000) });
    debugLog('debug', 'backend.probe.response', { target, status: response.status });
    console.log(`[${APP_IDENTITY}] backendProbe ${target} -> ${response.status}`);
  } catch (error) {
    debugLog('warn', 'backend.probe.error', { target, error });
    console.warn(`[${APP_IDENTITY}] backendProbe ${target} failed: ${error instanceof Error ? error.message : error}`);
  }
}

function secureStoreKey(key: string): string {
  if (typeof key !== 'string' || !key) throw new Error('secureStore key must be a non-empty string');
  return `secure:${key}`;
}

/** safeStorage must be backed by the OS keychain; Linux without a secret
 * service falls back to a hard-coded key (`basic_text`), which is refused. */
async function requireSecureStorage(): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error(mainT('secureStore.unavailable'));
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error(mainT('secureStore.basicText'));
  }
}

/** `secureStore:*` calls per key, in order: encryption is asynchronous, so a
 * delete issued after a set must not finish first and be overwritten. */
const secureStoreQueues = new Map<string, Promise<unknown>>();

function enqueueSecureStore<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (secureStoreQueues.get(key) ?? Promise.resolve()).then(task);
  const tail = run.catch(() => undefined);
  secureStoreQueues.set(key, tail);
  void tail.then(() => {
    if (secureStoreQueues.get(key) === tail) secureStoreQueues.delete(key);
  });
  return run;
}

function storePath(): string {
  return join(app.getPath('userData'), 'todex-desktop-store.json');
}

let storeCache: StoreShape | null = null;
let storeDirty = false;
let storeWriteTimer: ReturnType<typeof setTimeout> | null = null;
const STORE_WRITE_DEBOUNCE_MS = 300;

function readStore(): StoreShape {
  if (storeCache) {
    return storeCache;
  }
  try {
    storeCache = JSON.parse(readFileSync(storePath(), 'utf8')) as StoreShape;
  } catch {
    storeCache = {};
  }
  return storeCache;
}

function flushStore(): void {
  if (storeWriteTimer) {
    clearTimeout(storeWriteTimer);
    storeWriteTimer = null;
  }
  if (!storeDirty || !storeCache) {
    return;
  }
  storeDirty = false;
  try {
    const target = storePath();
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(storeCache), 'utf8');
  } catch (error) {
    debugLog('error', 'store.flush.error', { error });
  }
}

function scheduleStoreWrite(): void {
  storeDirty = true;
  if (storeWriteTimer) {
    return;
  }
  storeWriteTimer = setTimeout(flushStore, STORE_WRITE_DEBOUNCE_MS);
  storeWriteTimer.unref?.();
}

function writeStore(value: StoreShape): void {
  storeCache = value;
  scheduleStoreWrite();
}

function initializeDebugLogging(): void {
  if (!DEBUG_BUILD) return;
  const userDataPath = app.getPath('userData');
  const configuredPath = readStore()[DEBUG_LOG_PATH_KEY];
  const logPath = normalizeConfiguredLogPath(
    process.env.TODEX_DESKTOP_LOG_PATH?.trim() || configuredPath,
    userDataPath,
  );
  const info = {
    enabled: true,
    buildVersion: BUILD_VERSION,
    configPath: storePath(),
    logPath,
    chromiumLogPath: chromiumLogPath(logPath),
  };
  try {
    const store = readStore();
    if (store[DEBUG_LOG_PATH_KEY] !== logPath) {
      store[DEBUG_LOG_PATH_KEY] = logPath;
      writeStore(store);
    }
  } catch {
    // The logger itself remains usable even when the store cannot be updated.
  }
  debugLogger = new DebugLogger(info);
  debugLogger.start();
  installConsoleCapture(debugLogger, 'main');
  debugLog('info', 'app.start', {
    app: APP_IDENTITY,
    buildVersion: BUILD_VERSION,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    userData: userDataPath,
  });
  process.on('unhandledRejection', (reason) => debugLog('error', 'process.unhandledRejection', { reason }));
  process.on('uncaughtException', (error) => {
    debugLog('fatal', 'process.uncaughtException', { error });
    setImmediate(() => process.exit(1));
  });
  app.commandLine.appendSwitch('enable-logging', 'file');
  app.commandLine.appendSwitch('log-file', info.chromiumLogPath);
  app.commandLine.appendSwitch('v', '1');
  try {
    app.setAppLogsPath(dirname(logPath));
  } catch (error) {
    debugLog('warn', 'app.logsPath.error', { error });
  }
}

function appIconPath(variant: 'dark' | 'light' = 'dark'): string {
  const fileName = process.platform === 'win32'
    ? (variant === 'light' ? 'icon-light.ico' : 'icon.ico')
    : (variant === 'light' ? 'icon-light.png' : 'icon.png');
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', fileName)
    : join(__dirname, '../../build', fileName);
}

function themedAppIconPath(): string {
  return appIconPath(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
}

// Rewrites ~/.local/share/applications/todex.desktop so it always points at
// the running AppImage. The updater swaps the file for a new versioned name
// when it installs an update; without this the launcher entry keeps pointing
// at the deleted file and desktops honoring TryExec hide TodeX entirely.
function syncLinuxDesktopEntry(appImagePath?: string): void {
  const appImage = appImagePath ?? process.env.APPIMAGE;
  if (process.platform !== 'linux' || !appImage) return;
  try {
    const result = syncDesktopEntry({
      appImage,
      iconSource: appIconPath(),
      name: 'TodeX',
      comment: 'TodeX desktop client',
      wmClass: app.getName(),
    });
    if (result.rewritten || result.removedEntries.length > 0) {
      const stale = result.removedEntries.length ? `; removed stale: ${result.removedEntries.join(', ')}` : '';
      console.info(`[${APP_IDENTITY}] desktop entry updated (${result.entry})${stale}`);
    }
    debugLog('info', 'desktop.entry.sync', result);
  } catch (error) {
    debugLog('warn', 'desktop.entry.sync.error', { error });
    console.warn(`[${APP_IDENTITY}] desktop entry sync failed: ${error instanceof Error ? error.message : error}`);
  }
}

function applySystemAppIcon(): void {
  const icon = themedAppIconPath();
  if (process.platform === 'darwin') {
    app.dock?.setIcon(icon);
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.setIcon(icon);
  }
}

/** Only web links leave the app; other schemes (file:, custom app handlers,
 * smb:, …) could launch local programs through the OS. */
function isExternalWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function rendererHtmlPath(): string {
  return join(__dirname, '../renderer/index.html');
}

/** The renderer may only (re)load its own entry: the dev server origin in
 * development, the bundled index.html otherwise. */
/** The renderer entry page's origin: the dev server, or `file://` when packaged. */
function isRendererEntryOrigin(origin: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) return origin === new URL(devUrl).origin;
  return origin === 'file://' || origin === 'file:///';
}

function isRendererEntryUrl(target: string): boolean {
  try {
    const url = new URL(target);
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) return url.origin === new URL(devUrl).origin;
    return url.protocol === 'file:' && resolve(fileURLToPath(url)) === resolve(rendererHtmlPath());
  } catch {
    return false;
  }
}

/** Subframes may only hold blank documents; the app embeds no other pages. */
function isAllowedSubframeUrl(target: string): boolean {
  return target === 'about:blank' || target === 'about:srcdoc' || isRendererEntryUrl(target);
}

function pathInfo(target: unknown): PathInfo | null {
  if (typeof target !== 'string') return null;
  try {
    const stats = statSync(target);
    return { isDirectory: stats.isDirectory(), mode: stats.mode };
  } catch {
    return null;
  }
}

function assertShellPath(refusal: ShellPathRefusal | null): void {
  if (refusal === 'relative') throw new Error(mainT('main.pathNotAbsolute'));
  if (refusal === 'missing') throw new Error(mainT('main.fileNotFound'));
  if (refusal === 'launchable') throw new Error(mainT('main.openLaunchable'));
}

/** Rewrites the bundled renderer's `file://` / `null` `Origin` to
 * `DESKTOP_APP_ORIGIN`. Only the main frame of the app's own entry page
 * qualifies, so an opaque (sandboxed) frame cannot borrow the app's origin. */
function desktopRequestHeaders(details: Electron.OnBeforeSendHeadersListenerDetails): Record<string, string> {
  const headers = details.requestHeaders;
  const name = Object.keys(headers).find(key => key.toLowerCase() === 'origin');
  if (!name) return headers;
  const origin = headers[name];
  if (origin !== 'null' && !origin.startsWith('file:')) return headers;
  const { frame, webContents } = details;
  if (!frame || !webContents || frame !== webContents.mainFrame || !isRendererEntryUrl(frame.url)) return headers;
  const next = { ...headers };
  delete next[name];
  next.Origin = DESKTOP_APP_ORIGIN;
  return next;
}

/** Default-session policy for the app window (preview tabs use their own
 * partition with everything denied). */
function installSessionPolicy(): void {
  const defaultSession = session.defaultSession;
  defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const granted = details.isMainFrame && isRendererEntryUrl(details.requestingUrl) && RENDERER_PERMISSIONS.has(permission);
    if (!granted) debugLog('warn', 'permission.denied', { permission, url: details.requestingUrl });
    callback(granted);
  });
  // Checks (as opposed to requests) default to allowed; deny everything the
  // renderer entry page does not need. Origin-only checks (no requesting URL,
  // e.g. notifications) carry `file://` in a packaged build.
  defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const fromEntry = details.requestingUrl
      ? isRendererEntryUrl(details.requestingUrl)
      : isRendererEntryOrigin(requestingOrigin);
    return fromEntry && RENDERER_PERMISSIONS.has(permission);
  });
  defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => callback({ requestHeaders: desktopRequestHeaders(details) }),
  );
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'TodeX',
    icon: themedAppIconPath(),
    // macOS keeps its traffic-light buttons overlaid on the page instead of a
    // separate title bar, so the window reads as one unified surface.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12151c' : '#f4f7f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The default macOS menu binds Cmd+W to closing the window. Intercept it so
  // the renderer can close the active workbench tab first; it falls back to
  // 'window:close' when no workbench tab is available.
  if (process.platform === 'darwin') {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !input.meta || input.control || input.shift || input.alt) return;
      if (input.key.toLowerCase() !== 'w') return;
      event.preventDefault();
      window.webContents.send('app:close-request');
    });
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    const external = isExternalWebUrl(url);
    debugLog(external ? 'debug' : 'warn', 'window.open.request', { url, external });
    if (external) {
      shell.openExternal(url).catch((error: unknown) => debugLog('error', 'window.open.external.error', { url, error }));
    }
    return { action: 'deny' };
  });

  // A link without target=_blank (or injected script) would otherwise replace
  // the app with a remote page that keeps the preload bridge.
  window.webContents.on('will-navigate', (details) => {
    if (isRendererEntryUrl(details.url)) return;
    details.preventDefault();
    const external = isExternalWebUrl(details.url);
    debugLog('warn', 'window.navigate.blocked', { url: details.url, external });
    if (external) {
      shell.openExternal(details.url).catch((error: unknown) => debugLog('error', 'window.open.external.error', { url: details.url, error }));
    }
  });
  // Same rule for subframes (`will-navigate` covers the main frame only).
  window.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame || isAllowedSubframeUrl(details.url)) return;
    details.preventDefault();
    debugLog('warn', 'window.frame-navigate.blocked', { url: details.url });
  });
  // A server redirect lands on its target without `will-navigate`.
  window.webContents.on('will-redirect', (details) => {
    if (details.isMainFrame ? isRendererEntryUrl(details.url) : isAllowedSubframeUrl(details.url)) return;
    details.preventDefault();
    debugLog('warn', 'window.redirect.blocked', { url: details.url, mainFrame: details.isMainFrame });
  });

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    debugLog(level >= 3 ? 'error' : level === 2 ? 'warn' : level === 1 ? 'info' : 'debug', 'renderer.console', {
      level,
      message,
      line,
      sourceId,
      webContentsId: window.webContents.id,
    });
  });
  window.webContents.on('did-start-loading', () => debugLog('debug', 'renderer.did-start-loading', { id: window.webContents.id }));
  window.webContents.on('dom-ready', () => debugLog('debug', 'renderer.dom-ready', { id: window.webContents.id }));
  window.webContents.on('did-stop-loading', () => debugLog('debug', 'renderer.did-stop-loading', { id: window.webContents.id }));
  // The renderer can die from upstream V8 bugs (e.g. JIT bookkeeping SIGTRAPs
  // observed as exit code 5). Reload it instead of leaving a dead window, with
  // exponential backoff so a persistent crash does not spin a reload loop.
  let rendererCrashCount = 0;
  let rendererReloadTimer: ReturnType<typeof setTimeout> | null = null;
  window.on('closed', () => {
    if (rendererReloadTimer) {
      clearTimeout(rendererReloadTimer);
      rendererReloadTimer = null;
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    debugLog('fatal', 'renderer.process-gone', { id: window.webContents.id, details });
    if (!['crashed', 'oom', 'integrity-failure'].includes(details.reason)) return;
    rendererCrashCount += 1;
    if (rendererCrashCount > MAX_RENDERER_CRASH_RELOADS) {
      console.error('TodeX renderer crashed repeatedly; not reloading');
      return;
    }
    const delay = Math.min(500 * 2 ** (rendererCrashCount - 1), 8000);
    rendererReloadTimer = setTimeout(() => {
      rendererReloadTimer = null;
      if (window.isDestroyed() || window.webContents.isDestroyed()) return;
      console.log('TodeX renderer reloading after crash');
      window.webContents.reload();
    }, delay);
    rendererReloadTimer.unref?.();
  });
  window.webContents.on('unresponsive', () => debugLog('error', 'renderer.unresponsive', { id: window.webContents.id }));
  window.webContents.on('responsive', () => debugLog('info', 'renderer.responsive', { id: window.webContents.id }));

  if (process.env.ELECTRON_RENDERER_URL) {
    console.log(`[${APP_IDENTITY}] loading renderer URL ${process.env.ELECTRON_RENDERER_URL}`);
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const html = rendererHtmlPath();
    console.log(`[${APP_IDENTITY}] loading renderer file ${html}`);
    void window.loadFile(html);
  }

  logIdentity(window);

  window.webContents.on('preload-error', (_event, path, error) => {
    debugLog('error', 'renderer.preload-error', { path, error });
    console.error('TodeX preload error', path, error);
  });
  window.webContents.on('did-finish-load', () => {
    rendererCrashCount = 0;
    debugLog('info', 'renderer.did-finish-load', { id: window.webContents.id, url: window.webContents.getURL() });
    console.log('TodeX renderer loaded');
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    debugLog('error', 'renderer.did-fail-load', { code, description, url });
    console.error('TodeX renderer failed to load', code, description, url);
  });

  return window;
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 4 * 1024 * 1024 });
  return result.stdout.trim();
}

async function gitSummary(repoPath: string) {
  const root = await gitText(repoPath, ['rev-parse', '--show-toplevel']);
  const branch = await gitText(root, ['branch', '--show-current']).catch(() => 'HEAD');
  const status = await gitText(root, ['status', '--short', '--untracked-files=all']);
  const stat = await gitText(root, ['diff', '--numstat', 'HEAD']).catch(() => '');
  let additions = 0;
  let deletions = 0;
  for (const line of stat.split('\n')) {
    const [added, removed] = line.split('\t');
    if (/^\d+$/.test(added)) additions += Number(added);
    if (/^\d+$/.test(removed)) deletions += Number(removed);
  }
  const untracked = await gitText(root, ['ls-files', '--others', '--exclude-standard']).catch(() => '');
  for (const relative of untracked.split('\n').filter(Boolean)) {
    try {
      const text = readFileSync(join(root, relative), 'utf8');
      additions += text ? text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0) : 0;
    } catch { /* binary or unreadable files have no line count */ }
  }
  const initialEligible = !(await gitText(root, ['rev-parse', '--verify', 'HEAD']).catch(() => ''));
  let ahead = 0;
  if (!initialEligible) {
    try {
      const aheadText = await gitText(root, ['rev-list', '--count', '@{u}..HEAD']);
      if (/^\d+$/.test(aheadText)) ahead = Number(aheadText);
    } catch {
      try {
        const aheadText = await gitText(root, ['rev-list', '--count', 'HEAD', '--not', '--remotes']);
        if (/^\d+$/.test(aheadText)) ahead = Number(aheadText);
      } catch {
        try {
          const aheadText = await gitText(root, ['rev-list', '--count', 'HEAD']);
          if (/^\d+$/.test(aheadText)) ahead = Number(aheadText);
        } catch {
          ahead = 0;
        }
      }
    }
  }
  return {
    path: root,
    name: root.split(/[\\/]/).pop() || root,
    branch: branch || 'HEAD',
    files: status ? status.split('\n').map((line) => ({ status: line.slice(0, 2), path: line.slice(3) })) : [],
    additions,
    deletions,
    ahead,
    initialEligible,
  };
}

async function findGitRepositories(workspacePath: string): Promise<string[]> {
  const candidates = [workspacePath];
  const scan = (dir: string, depth: number) => {
    if (depth > 2) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue;
        const child = join(dir, entry.name);
        candidates.push(child);
        scan(child, depth + 1);
      }
    } catch { /* inaccessible directories are skipped */ }
  };
  scan(workspacePath, 0);
  const roots = new Set<string>();
  for (const candidate of candidates) {
    try { roots.add((await gitText(candidate, ['rev-parse', '--show-toplevel']))); } catch { /* not a repository */ }
  }
  return [...roots];
}

// Escape hatch for renderer V8 issues (e.g. upstream JIT crashes):
// TODEX_JS_FLAGS="--jitless" pnpm dev
const jsFlags = process.env.TODEX_JS_FLAGS?.trim();
if (jsFlags) {
  app.commandLine.appendSwitch('js-flags', jsFlags);
}

initializeDebugLogging();

app.whenReady().then(() => {
  setMainLocale(app.getLocale());
  debugLog('info', 'app.ready', { readyAt: new Date().toISOString() });
  applySystemAppIcon();
  try {
    assertElectronBinary();
  } catch (error) {
    console.error(`[${APP_IDENTITY}] ${error instanceof Error ? error.message : error}`);
  }
  installSessionPolicy();
  void probeDefaultBackend();
  ipcMain.on('debug:log', (event, payload: { level?: unknown; event?: unknown; data?: unknown }) => {
    if (!DEBUG_BUILD) return;
    const level = payload?.level;
    const accepted: DebugLogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    debugLog(accepted.includes(level as DebugLogLevel) ? level as DebugLogLevel : 'debug', typeof payload?.event === 'string' ? payload.event : 'renderer.event', {
      source: 'renderer',
      webContentsId: event.sender.id,
      data: payload?.data,
    });
  });
  handleIpc('debug:info', () => debugLogger?.info ?? {
    enabled: false,
    buildVersion: BUILD_VERSION,
    configPath: storePath(),
    logPath: '',
    chromiumLogPath: '',
  });
  handleIpc('store:get', (_event, key: string) => {
    return readStore()[key] ?? null;
  });

  handleIpc('store:set', (_event, key: string, value: unknown) => {
    const next = readStore();
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    writeStore(next);
  });

  // Secrets (history device keys) are sealed by the OS keychain and kept in the
  // store as base64 under a `secure:` prefix; the plaintext never touches disk.
  handleIpc('secureStore:get', (_event, key: string) => {
    const storeKey = secureStoreKey(key);
    // Queued behind pending writes so a read sees the latest set.
    return enqueueSecureStore(storeKey, async () => {
      const sealed = readStore()[storeKey];
      if (typeof sealed !== 'string') return null;
      await requireSecureStorage();
      const { result } = await safeStorage.decryptStringAsync(Buffer.from(sealed, 'base64'));
      return result;
    });
  });

  handleIpc('secureStore:set', (_event, key: string, value: string | null) => {
    const storeKey = secureStoreKey(key);
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw new Error('secureStore values must be strings');
    }
    return enqueueSecureStore(storeKey, async () => {
      if (value === null || value === undefined) {
        const next = readStore();
        delete next[storeKey];
        writeStore(next);
        return;
      }
      await requireSecureStorage();
      const sealed = (await safeStorage.encryptStringAsync(value)).toString('base64');
      const next = readStore();
      next[storeKey] = sealed;
      writeStore(next);
    });
  });

  handleIpc('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  const spawnDetached = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

  handleIpc('shell:openPath', async (_event, targetPath: string) => {
    const info = pathInfo(targetPath);
    // A symlink is opened as its target ("notes.txt" -> some.app launches it).
    let real = '';
    try { real = info ? realpathSync(targetPath) : ''; } catch { /* checked as missing below */ }
    assertShellPath(openPathRefusal(targetPath, info, process.platform)
      ?? (real && real !== targetPath ? openPathRefusal(real, info, process.platform) : null));
    const failure = await shell.openPath(targetPath);
    if (failure) {
      throw new Error(failure);
    }
  });

  handleIpc('shell:showItemInFolder', (_event, targetPath: string) => {
    assertShellPath(shellPathRefusal(targetPath, pathInfo(targetPath), process.platform));
    shell.showItemInFolder(targetPath);
  });

  // The user picks the application here, so any existing absolute path may
  // be handed to it.
  handleIpc('shell:openWith', async (_event, targetPath: string) => {
    assertShellPath(shellPathRefusal(targetPath, pathInfo(targetPath), process.platform));
    if (process.platform === 'win32') {
      await spawnDetached('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', targetPath]);
      return;
    }
    const picked = await dialog.showOpenDialog({
      title: mainT('main.chooseApplication'),
      defaultPath: process.platform === 'darwin' ? '/Applications' : '/usr/bin',
      properties: ['openFile'],
      ...(process.platform === 'darwin' ? { filters: [{ name: 'Applications', extensions: ['app'] }] } : {}),
    });
    const appPath = picked.canceled ? '' : picked.filePaths[0] ?? '';
    if (!appPath) return;
    if (process.platform === 'darwin') {
      await execFileAsync('open', ['-a', appPath, targetPath]);
    } else {
      await spawnDetached(appPath, [targetPath]);
    }
  });

  handleIpc('git:scan', async (_event, workspacePath: string) => {
    const repos = await findGitRepositories(workspacePath);
    const summaries = await Promise.all(repos.map(async (repoPath) => {
      try { return await gitSummary(repoPath); }
      catch (error) { return { path: repoPath, name: repoPath.split(/[\\/]/).pop() || repoPath, branch: mainT('main.unknown'), files: [], additions: 0, deletions: 0, initialEligible: false, error: error instanceof Error ? error.message : mainT('main.gitReadFailed') }; }
    }));
    if (!summaries.some((repo) => repo.path === workspacePath)) {
      summaries.unshift({
        path: workspacePath,
        name: workspacePath.split(/[\\/]/).pop() || workspacePath,
        branch: mainT('main.notInitialized'),
        files: [] as { status: string; path: string }[],
        additions: 0,
        deletions: 0,
        ahead: 0,
        initialEligible: true,
      });
    }
    return summaries;
  });

  handleIpc('git:run', async (_event, workspacePath: string, action: 'commit' | 'commit-push' | 'push' | 'initial', message?: string, includeUnstaged = true) => {
    const outputs: string[] = [];
    const repositoryRoot = await gitText(workspacePath, ['rev-parse', '--show-toplevel']).catch(() => '');
    const targets = [repositoryRoot || workspacePath];
    for (const repo of targets) {
      if (action === 'initial') {
        await gitText(repo, ['init']);
        if (includeUnstaged) await gitText(repo, ['add', '-A']);
        await gitText(repo, ['commit', '-m', message?.trim() || 'Initial commit']);
      } else if (action !== 'push') {
        if (includeUnstaged) await gitText(repo, ['add', '-A']);
        const summary = await gitSummary(repo);
        await gitText(repo, ['commit', '-m', message?.trim() || `Update ${summary.files.length} file${summary.files.length === 1 ? '' : 's'} in ${summary.name}`]);
      }
      if (action === 'push' || action === 'commit-push') outputs.push(await gitText(repo, ['push']));
    }
    return { output: outputs.filter(Boolean).join('\n') || mainT('main.operationDone') };
  });

  ipcMain.on('locale:set', (_event, value: unknown) => {
    if (!isMainLocale(value)) return;
    setMainLocale(value);
    refreshUpdateMenu();
  });

  ipcMain.on('window:focus', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  handleIpc('theme:shouldUseDark', () => nativeTheme.shouldUseDarkColors);

  nativeTheme.on('updated', () => {
    debugLog('info', 'theme.updated', { dark: nativeTheme.shouldUseDarkColors });
    applySystemAppIcon();
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('theme:updated', nativeTheme.shouldUseDarkColors);
    }
  });

  mainWindow = createWindow();
  mainWindow.on('closed', () => {
    previews?.closeAll();
  });
  const liveWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  previews = new PreviewViews(
    liveWindow,
    state => liveWindow()?.webContents.send('preview:state', state),
    picked => liveWindow()?.webContents.send('preview:picked', picked),
  );
  handleIpc('preview:open', (_event, key: string, target: PreviewTarget) => previews?.open(String(key), target));
  handleIpc('preview:reload', (_event, key: string) => previews?.reload(String(key)));
  handleIpc('preview:capture', (_event, key: string) => previews?.capture(String(key)) ?? null);
  handleIpc('preview:inspect', (_event, key: string, colors: InspectColors | null) => previews?.inspect(String(key), colors));
  handleIpc('preview:close', (_event, key: string) => previews?.close(String(key)));
  // The agent browser used to run here (Electron partitions and store keys);
  // it runs on the backend now, and settings offer to clear what is left.
  handleIpc('legacyAgentBrowser:hasData', () =>
    legacyAgentPartitionDirs().length > 0 || LEGACY_AGENT_BROWSER_KEYS.some(key => readStore()[key] !== undefined));
  handleIpc('legacyAgentBrowser:clear', async () => {
    for (const dir of legacyAgentPartitionDirs()) await rm(dir, { recursive: true, force: true });
    const next = { ...readStore() };
    for (const key of LEGACY_AGENT_BROWSER_KEYS) delete next[key];
    writeStore(next);
  });
  ipcMain.on('preview:setBounds', (event, key: unknown, bounds: unknown) => {
    if (event.sender !== liveWindow()?.webContents || typeof key !== 'string') return;
    const rect = bounds && typeof bounds === 'object' ? bounds as Electron.Rectangle : null;
    previews?.setBounds(key, rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ? rect : null);
  });
  syncLinuxDesktopEntry();
  startAutoUpdates(BUILD_VERSION, syncLinuxDesktopEntry);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      mainWindow.on('closed', () => {
        previews?.closeAll();
      });
    }
  });
});

app.on('before-quit', () => {
  debugLog('info', 'app.before-quit');
  flushStore();
});
app.on('child-process-gone', (_event, details) => debugLog('error', 'app.child-process-gone', { details }));
app.on('window-all-closed', () => {
  debugLog('info', 'app.window-all-closed', { platform: process.platform });
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

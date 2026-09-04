import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_FILE_ATTACHMENT_BYTES = 512 * 1024;
const APP_IDENTITY = 'todex-desktop';
const PROTOCOL_VERSION = 'v2';
const DEFAULT_BACKEND_URL = process.env.TODEX_BACKEND_URL?.trim() || 'http://127.0.0.1:7345';
const BUILD_VERSION = typeof __TODEX_BUILD_VERSION__ === 'string'
  ? __TODEX_BUILD_VERSION__
  : process.env.TODEX_BUILD_VERSION?.trim() || (app.isPackaged ? app.getVersion() : DEBUG_BUILD_VERSION);
const DEBUG_BUILD = isDebugBuild(BUILD_VERSION);

type StoreShape = Record<string, unknown>;

let debugLogger: DebugLogger | null = null;

function debugLog(level: DebugLogLevel, event: string, data?: unknown): void {
  debugLogger?.write(level, event, data);
}

function handleIpc(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args: any[]) => {
    const started = Date.now();
    debugLog('trace', 'ipc.request', { channel, senderId: event.sender.id, args });
    try {
      const result = await handler(event, ...args);
      debugLog('trace', 'ipc.response', { channel, senderId: event.sender.id, durationMs: Date.now() - started, result });
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

function storePath(): string {
  return join(app.getPath('userData'), 'todex-desktop-store.json');
}

function readStore(): StoreShape {
  try {
    return JSON.parse(readFileSync(storePath(), 'utf8')) as StoreShape;
  } catch {
    return {};
  }
}

function writeStore(value: StoreShape): void {
  const target = storePath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value, null, 2), 'utf8');
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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'TodeX',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12151c' : '#f4f7f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    debugLog('debug', 'window.open.request', { url });
    void shell.openExternal(url);
    return { action: 'deny' };
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
  window.webContents.on('render-process-gone', (_event, details) => debugLog('fatal', 'renderer.process-gone', { id: window.webContents.id, details }));
  window.webContents.on('unresponsive', () => debugLog('error', 'renderer.unresponsive', { id: window.webContents.id }));
  window.webContents.on('responsive', () => debugLog('info', 'renderer.responsive', { id: window.webContents.id }));

  if (process.env.ELECTRON_RENDERER_URL) {
    console.log(`[${APP_IDENTITY}] loading renderer URL ${process.env.ELECTRON_RENDERER_URL}`);
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const html = join(__dirname, '../renderer/index.html');
    console.log(`[${APP_IDENTITY}] loading renderer file ${html}`);
    void window.loadFile(html);
  }

  logIdentity(window);

  window.webContents.on('preload-error', (_event, path, error) => {
    debugLog('error', 'renderer.preload-error', { path, error });
    console.error('TodeX preload error', path, error);
  });
  window.webContents.on('did-finish-load', () => {
    debugLog('info', 'renderer.did-finish-load', { id: window.webContents.id, url: window.webContents.getURL() });
    console.log('TodeX renderer loaded');
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    debugLog('error', 'renderer.did-fail-load', { code, description, url });
    console.error('TodeX renderer failed to load', code, description, url);
  });

  return window;
}

function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.css')) {
    return 'text/plain';
  }
  return 'application/octet-stream';
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

initializeDebugLogging();

app.whenReady().then(() => {
  debugLog('info', 'app.ready', { readyAt: new Date().toISOString() });
  try {
    assertElectronBinary();
  } catch (error) {
    console.error(`[${APP_IDENTITY}] ${error instanceof Error ? error.message : error}`);
  }
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

  handleIpc('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  handleIpc('dialog:openFiles', async (_event, options?: { images?: boolean }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: options?.images
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        : undefined,
    });
    return result.canceled ? [] : result.filePaths;
  });

  handleIpc('fs:readFile', async (_event, filePath: string) => {
    if (!existsSync(filePath)) {
      throw new Error('文件不存在');
    }
    const buffer = readFileSync(filePath);
    const name = filePath.split(/[/\\]/).pop() || 'file';
    const mimeType = mimeFromName(name);
    const isImage = mimeType.startsWith('image/');
    const limit = isImage ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_FILE_ATTACHMENT_BYTES;
    if (buffer.byteLength > limit) {
      throw new Error(`文件过大（最大 ${Math.round(limit / 1024)} KB）`);
    }
    const text = !isImage && buffer.byteLength <= MAX_FILE_ATTACHMENT_BYTES
      ? buffer.toString('utf8')
      : undefined;
    return {
      name,
      mimeType,
      sizeBytes: buffer.byteLength,
      base64: buffer.toString('base64'),
      text,
    };
  });

  handleIpc('git:scan', async (_event, workspacePath: string) => {
    const repos = await findGitRepositories(workspacePath);
    const summaries = await Promise.all(repos.map(async (repoPath) => {
      try { return await gitSummary(repoPath); }
      catch (error) { return { path: repoPath, name: repoPath.split(/[\\/]/).pop() || repoPath, branch: '未知', files: [], additions: 0, deletions: 0, initialEligible: false, error: error instanceof Error ? error.message : 'Git 读取失败' }; }
    }));
    if (!summaries.some((repo) => repo.path === workspacePath)) {
      summaries.unshift({
        path: workspacePath,
        name: workspacePath.split(/[\\/]/).pop() || workspacePath,
        branch: '未初始化',
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
    return { output: outputs.filter(Boolean).join('\n') || '操作完成' };
  });

  handleIpc('theme:shouldUseDark', () => nativeTheme.shouldUseDarkColors);

  nativeTheme.on('updated', () => {
    debugLog('info', 'theme.updated', { dark: nativeTheme.shouldUseDarkColors });
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('theme:updated', nativeTheme.shouldUseDarkColors);
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => debugLog('info', 'app.before-quit'));
app.on('child-process-gone', (_event, details) => debugLog('error', 'app.child-process-gone', { details }));
app.on('window-all-closed', () => {
  debugLog('info', 'app.window-all-closed', { platform: process.platform });
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

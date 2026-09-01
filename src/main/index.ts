import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_FILE_ATTACHMENT_BYTES = 512 * 1024;
const APP_IDENTITY = 'todex-desktop';
const PROTOCOL_VERSION = 'v2';
const DEFAULT_BACKEND_URL = process.env.TODEX_BACKEND_URL?.trim() || 'http://127.0.0.1:7345';

type StoreShape = Record<string, unknown>;

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
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(2000) });
    console.log(`[${APP_IDENTITY}] backendProbe ${target} -> ${response.status}`);
  } catch (error) {
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
    void shell.openExternal(url);
    return { action: 'deny' };
  });

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
    console.error('TodeX preload error', path, error);
  });
  window.webContents.on('did-finish-load', () => {
    console.log('TodeX renderer loaded');
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
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
  return {
    path: root,
    name: root.split(/[\\/]/).pop() || root,
    branch: branch || 'HEAD',
    files: status ? status.split('\n').map((line) => ({ status: line.slice(0, 2), path: line.slice(3) })) : [],
    additions,
    deletions,
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

app.whenReady().then(() => {
  try {
    assertElectronBinary();
  } catch (error) {
    console.error(`[${APP_IDENTITY}] ${error instanceof Error ? error.message : error}`);
  }
  void probeDefaultBackend();
  ipcMain.handle('store:get', (_event, key: string) => {
    return readStore()[key] ?? null;
  });

  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    const next = readStore();
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    writeStore(next);
  });

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:openFiles', async (_event, options?: { images?: boolean }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: options?.images
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        : undefined,
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
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

  ipcMain.handle('git:scan', async (_event, workspacePath: string) => {
    const repos = await findGitRepositories(workspacePath);
    return Promise.all(repos.map(async (repoPath) => {
      try { return await gitSummary(repoPath); }
      catch (error) { return { path: repoPath, name: repoPath.split(/[\\/]/).pop() || repoPath, branch: '未知', files: [], additions: 0, deletions: 0, error: error instanceof Error ? error.message : 'Git 读取失败' }; }
    }));
  });

  ipcMain.handle('git:run', async (_event, workspacePath: string, action: 'commit' | 'commit-push' | 'push', message?: string) => {
    const repos = await findGitRepositories(workspacePath);
    const outputs: string[] = [];
    for (const repo of repos) {
      if (action !== 'push') {
        await gitText(repo, ['add', '-A']);
        await gitText(repo, ['commit', '-m', message?.trim() || 'Update from TodeX']);
      }
      if (action === 'push' || action === 'commit-push') outputs.push(await gitText(repo, ['push']));
    }
    return { output: outputs.filter(Boolean).join('\n') || '操作完成' };
  });

  ipcMain.handle('theme:shouldUseDark', () => nativeTheme.shouldUseDarkColors);

  nativeTheme.on('updated', () => {
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

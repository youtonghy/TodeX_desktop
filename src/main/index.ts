import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

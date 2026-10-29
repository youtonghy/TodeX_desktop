import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// Smoke tests of the desktop shell: the built main + preload (`electron-vite
// build`) with the renderer from the dev server Playwright starts. The app
// gets its own HOME and XDG_CONFIG_HOME and a backend URL nobody listens on,
// so it never reads or writes the real profile, ~/.todex-agent or a daemon.

const root = resolve(import.meta.dirname, '../..');
const rendererUrl = `http://127.0.0.1:${Number(process.env.TODEX_E2E_PORT) || 5299}/`;
// Port 9 (discard) is never served here: the app stays offline.
const OFFLINE_BACKEND = 'http://127.0.0.1:9';

let sandbox: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'todex-e2e-'));
  const configHome = join(sandbox, 'config');
  mkdirSync(join(configHome, 'todex-desktop'), { recursive: true });
  writeFileSync(
    join(configHome, 'todex-desktop', 'todex-desktop-store.json'),
    JSON.stringify({ 'todex.desktop.settings.v1': { serverUrl: OFFLINE_BACKEND } }),
  );
  app = await electron.launch({
    cwd: root,
    // e.g. `--ozone-platform=wayland` on a Wayland desktop; CI runs under xvfb.
    // The labels below are Chinese; pin the UI language whatever the host's is.
    args: [...(process.env.TODEX_E2E_ELECTRON_ARGS?.split(' ').filter(Boolean) ?? []), '--lang=zh-CN', '.'],
    env: {
      ...process.env,
      LANG: 'zh_CN.UTF-8',
      LANGUAGE: 'zh_CN',
      HOME: join(sandbox, 'home'),
      XDG_CONFIG_HOME: configHome,
      ELECTRON_RENDERER_URL: rendererUrl,
    },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

test('opens the window with the renderer and an isolated profile', async () => {
  await expect(page).toHaveTitle(/TodeX/);
  await expect(page.getByRole('textbox', { name: '消息输入' })).toBeVisible({ timeout: 30_000 });
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(userData.startsWith(sandbox)).toBe(true);
});

test('exposes a frozen preload bridge whose calls reach main', async () => {
  const bridge = await page.evaluate(async () => ({
    frozen: Object.isFrozen(window.todexDesktop),
    namespaces: Object.keys(window.todexDesktop).sort(),
    windowState: await window.todexDesktop.app.windowState(),
  }));
  expect(bridge.frozen).toBe(true);
  expect(bridge.namespaces).toEqual(expect.arrayContaining(['app', 'dialog', 'secureStore', 'store', 'theme']));
  expect(bridge.windowState).toEqual({ maximized: expect.any(Boolean), fullScreen: false });
});

test('persists renderer store writes in the sandboxed profile', async () => {
  await page.evaluate(() => window.todexDesktop.store.set('todex.e2e.probe', { ok: true }));
  expect(await page.evaluate(() => window.todexDesktop.store.get('todex.e2e.probe'))).toEqual({ ok: true });
  const file = join(sandbox, 'config', 'todex-desktop', 'todex-desktop-store.json');
  // Main debounces the write to disk.
  await expect.poll(() => JSON.parse(readFileSync(file, 'utf8'))['todex.e2e.probe']).toEqual({ ok: true });
});

test('rejects main-owned store keys with a TodexIpcError', async () => {
  const failure = await page.evaluate(() => window.todexDesktop.store.set('secure:probe', 'x').then(
    () => null,
    (error: Error) => ({ name: error.name, message: error.message }),
  ));
  expect(failure).toEqual({ name: 'TodexIpcError', message: expect.stringContaining('managed by the main process') });
});

test('picks a local folder for a new workspace through the native dialog', async () => {
  const picked = join(sandbox, 'picked-folder');
  // Replace the native dialog in main; a real one would block the run.
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
  }, picked);
  await page.getByRole('button', { name: '新建工作区' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '本机选择' }).click();
  await expect(dialog.getByRole('textbox', { name: '目录' })).toHaveValue(picked);
  await page.keyboard.press('Escape');
});

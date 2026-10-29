import { defineConfig } from '@playwright/test';

// Visual regression runs the renderer's `?demo` fixture preview in headless
// Chromium; the Electron smoke tests launch the built main/preload against
// the same dev server. See README "Tests".
const port = Number(process.env.TODEX_E2E_PORT) || 5299;
const rendererUrl = `http://127.0.0.1:${port}/`;

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Baselines are rendered in the pinned Playwright Linux image only (font
  // rasterization differs between distros), so they carry no platform suffix.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  // Local runs never write them, so a host-rendered baseline is not committed by accident.
  updateSnapshots: process.env.CI ? 'missing' : 'none',
  expect: {
    // Many workers booting the dev-served renderer at once can take a while.
    timeout: 20_000,
    toHaveScreenshot: { maxDiffPixels: 50, threshold: 0.05, animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    baseURL: rendererUrl,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'visual',
      testDir: './tests/visual',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } },
    },
    {
      name: 'electron',
      testDir: './tests/electron',
      // One app instance at a time keeps window focus and the dev server calm.
      fullyParallel: false,
      workers: 1,
    },
  ],
  webServer: {
    command: 'node scripts/dev-demo.mjs',
    env: { PORT: String(port) },
    url: `${rendererUrl}?demo`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

import { expect, test as base, type Locator, type Page } from '@playwright/test';

/** Wall clock every screenshot is taken at; demo fixtures are relative to it. */
export const FIXED_NOW = new Date('2026-10-20T10:00:00+08:00');

export type Theme = 'light' | 'dark';

type DemoFixtures = {
  /** Opens the `?demo` preview in `theme` and waits until it has settled. */
  openDemo: (theme?: Theme) => Promise<void>;
};

export const test = base.extend<DemoFixtures>({
  openDemo: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await use(async (theme = 'light') => {
      // The clock flows from FIXED_NOW, so dates, "today" and relative times
      // render the same on every run while timers still fire.
      await page.clock.install({ time: FIXED_NOW });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto(`/?demo&theme=${theme}`);
      await expect(page.getByRole('textbox', { name: '消息输入' })).toBeVisible();
      await settle(page);
    });
    expect(errors, 'uncaught errors in the renderer').toEqual([]);
  },
});

/** Waits until lazy panels replaced their "加载中…" fallback, web fonts are
 * loaded and two animation frames have passed. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/^加载中/)).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** Live values that legitimately differ between runs. The sidebar identity
 * card shows the measured backend latency; masking the text alone would not
 * do, since its box widens with the digits, so the whole card is masked. */
export function volatile(page: Page): Locator[] {
  return [page.getByRole('button', { name: '个人主页' })];
}

export { expect };

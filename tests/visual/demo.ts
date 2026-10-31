import { expect, test as base, type Locator, type Page } from '@playwright/test';

/** Wall clock every screenshot is taken at; demo fixtures are relative to it. */
export const FIXED_NOW = new Date('2026-10-20T10:00:00+08:00');

export type Theme = 'light' | 'dark';

type DemoFixtures = {
  /** Opens the `?demo` preview in `theme` (plus extra `query` parameters) and waits until it has settled. */
  openDemo: (theme?: Theme, query?: string) => Promise<void>;
};

export const test = base.extend<DemoFixtures>({
  openDemo: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await use(async (theme = 'light', query = '') => {
      // The clock flows from FIXED_NOW, so dates, "today" and relative times
      // render the same on every run while timers still fire.
      await page.clock.install({ time: FIXED_NOW });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto(`/?demo&theme=${theme}${query ? `&${query}` : ''}`);
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
  await scrollSettled(page);
  // The chat pins itself to the bottom while code highlighting and fonts
  // change its height, and how close it lands depends on timing: put every
  // scrolled container at its end, then let it settle again.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('*')) {
      if (element.scrollTop > 0) element.scrollTop = element.scrollHeight;
    }
  });
  await scrollSettled(page);
}

/** Waits until no scroll container moves or grows for a few polls. */
async function scrollSettled(page: Page): Promise<void> {
  const signature = () => page.evaluate(() => Array.from(document.querySelectorAll('*'))
    .filter((element) => element.scrollHeight > element.clientHeight + 1)
    .map((element) => `${element.scrollTop}/${element.scrollHeight}`)
    .join(','));
  let previous = await signature();
  for (let stable = 0, polls = 0; stable < 4; polls++) {
    if (polls > 50) throw new Error('scroll positions kept changing');
    await page.waitForTimeout(100);
    const current = await signature();
    stable = current === previous ? stable + 1 : 0;
    previous = current;
  }
}

/** Live values that legitimately differ between runs. The sidebar identity
 * card shows the measured backend latency; masking the text alone would not
 * do, since its box widens with the digits, so the whole card is masked. */
export function volatile(page: Page): Locator[] {
  return [page.getByRole('button', { name: '个人主页' })];
}

export { expect };

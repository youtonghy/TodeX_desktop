import { expect, settle, test, volatile, type Theme } from './demo';

// Full-window screenshots of the main screens in the `?demo` preview. A diff
// here means a shared style, token or layout changed somewhere visible; update
// the baselines (README "Tests") only when the change is intended.

const SETTINGS_TABS = {
  功能: 'features',
  外观: 'appearance',
  后端连接: 'backends',
  'CLI 管理': 'cli',
  'SSH 连接': 'ssh',
  通知: 'notifications',
  'Agent 桌面工具': 'agent-desktop',
  'Agent 调用': 'agent-calling',
  关于: 'about',
};

for (const theme of ['light', 'dark'] as Theme[]) {
  test.describe(`${theme} theme`, () => {
    test('workbench with an open conversation', async ({ page, openDemo }) => {
      await openDemo(theme);
      await expect(page).toHaveScreenshot(`workbench-${theme}.png`, { mask: volatile(page) });
    });

    test('right panel', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '打开右侧面板' }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`right-panel-${theme}.png`, { mask: volatile(page) });
    });

    test('model and reasoning card', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '选择模型和思考强度' }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`model-card-${theme}.png`, { mask: volatile(page) });
    });

    test('quick search', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '快速搜索' }).click();
      await page.keyboard.type('结账');
      await settle(page);
      await expect(page).toHaveScreenshot(`quick-search-${theme}.png`, { mask: volatile(page) });
    });

    test('new empty conversation', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '新建对话' }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`new-conversation-${theme}.png`, { mask: volatile(page) });
    });

    test('task board', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '任务看板' }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`task-board-${theme}.png`, { mask: volatile(page) });
    });

    test('profile page', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '个人主页' }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`profile-${theme}.png`, { mask: volatile(page) });
    });

    test('settings: general', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await expect(page.getByRole('tab', { name: '通用' })).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`settings-general-${theme}.png`, { mask: volatile(page) });
    });
  });
}

// The remaining settings tabs once, in the light theme: the dark theme rides
// the same tokens, which the screens above already cover.
for (const [tab, slug] of Object.entries(SETTINGS_TABS)) {
  test(`settings: ${tab}`, async ({ page, openDemo }) => {
    await openDemo('light');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await settle(page);
    await expect(page).toHaveScreenshot(`settings-${slug}-light.png`, { mask: volatile(page) });
  });
}

test.describe('compact window', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('workbench', async ({ page, openDemo }) => {
    await openDemo('light');
    await expect(page).toHaveScreenshot('compact-workbench-light.png', { mask: volatile(page) });
  });

  test('settings', async ({ page, openDemo }) => {
    await openDemo('light');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await settle(page);
    await expect(page).toHaveScreenshot('compact-settings-light.png', { mask: volatile(page) });
  });
});

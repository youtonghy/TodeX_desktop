import type { Page } from '@playwright/test';
import { expect, settle, test, volatile, type Theme } from './demo';

// Full-window screenshots of the main screens in the `?demo` preview. A diff
// here means a shared style, token or layout changed somewhere visible; update
// the baselines (README "Tests") only when the change is intended.

/** A category in the settings modal's grouped rail. */
function settingsSection(page: Page, name: string) {
  return page.getByRole('navigation', { name: '设置' }).getByRole('button', { name, exact: true });
}

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

    // `board=busy`: a conversation waits on a permission prompt, so both live lists have rows.
    test('home page', async ({ page, openDemo }) => {
      await openDemo(theme, 'board=busy', 'home');
      await expect(page.getByRole('region', { name: '等待回复' }).getByText('等待授权')).toBeVisible();
      await expect(page.getByText('5 小时窗口')).toBeVisible();
      await expect(page).toHaveScreenshot(`home-${theme}.png`, { mask: volatile(page) });
    });

    test('home page: customizing the layout', async ({ page, openDemo }) => {
      await openDemo(theme, 'board=busy', 'home');
      await expect(page.getByText('5 小时窗口')).toBeVisible();
      await page.getByRole('button', { name: '自定义布局' }).click();
      await page.getByRole('button', { name: '移除「今日用量」' }).click();
      await page.getByRole('button', { name: '添加卡片' }).click();
      await expect(page.getByRole('option', { name: '今日用量' })).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`home-customize-${theme}.png`, { mask: volatile(page) });
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
      await page.getByRole('button', { name: '计划', exact: true }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`task-board-${theme}.png`, { mask: volatile(page) });
    });

    test('plan calendar', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '计划', exact: true }).click();
      await page.getByRole('radio', { name: '日历' }).click();
      await expect(page.getByText('还有 2 项')).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`plan-calendar-${theme}.png`, { mask: volatile(page) });
    });

    test('profile page', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '个人主页' }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`profile-${theme}.png`, { mask: volatile(page) });
    });

    test('profile charts', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '个人主页' }).click();
      await page.getByText('活跃时段').scrollIntoViewIfNeeded();
      await settle(page);
      await expect(page).toHaveScreenshot(`profile-charts-${theme}.png`, { mask: volatile(page) });
    });

    test('agent goal above the composer', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByText('design-tokens', { exact: true }).click();
      await page.getByText('同步 HeroUI 主题变量').first().click();
      await expect(page.getByText(/^目标 · /)).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`goal-${theme}.png`, { mask: volatile(page) });
    });

    test('waiting on background tasks after the turn', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByText('lumen-api', { exact: true }).click();
      await page.getByText('支付回调幂等处理').first().click();
      await expect(page.getByText('等待后台任务（1 个）')).toBeVisible();
      // Only the background tasks keep it working, so they can be stopped.
      await expect(page.getByRole('button', { name: '停止后台任务' })).toBeVisible();
      // The sidebar keeps the conversation marked as working as well.
      await expect(page.getByRole('row', { name: /支付回调幂等处理/ }).getByLabel('正在工作')).toBeVisible();
      // So does the Lumen group folder holding that workspace.
      await expect(page.getByRole('row', { name: 'Lumen', exact: true }).getByLabel('正在工作')).toBeVisible();
      // The composer stays lit while the agent waits; its light fades in.
      await expect.poll(() => page.locator('.bui-composer-loader-rect').first()
        .evaluate(rect => getComputedStyle(rect.closest('svg')!.parentElement!).opacity)).toBe('1');
      await settle(page);
      await expect(page).toHaveScreenshot(`background-tasks-${theme}.png`, { mask: volatile(page) });
    });

    test('private conversation', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByText('infra-scripts', { exact: true }).click();
      await page.getByText('轮换部署密钥').first().click();
      await expect(page.getByText(/^隐私对话：内容只保存在守护进程内存中/)).toBeVisible();
      await expect(page.getByRole('img', { name: '隐私对话' })).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`private-conversation-${theme}.png`, { mask: volatile(page) });
    });

    test('unified sidebar', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await settingsSection(page, '外观').click();
      await page.getByRole('radio', { name: '统一' }).click();
      await page.getByRole('button', { name: '关闭', exact: true }).click();
      // The active workspace opens by itself; a second one opens on click.
      await page.getByRole('row', { name: 'lumen-api' }).click();
      await expect(page.getByRole('row', { name: '支付回调幂等处理' })).toBeVisible();
      await expect(page.getByRole('grid', { name: '对话' })).toHaveCount(0);
      await page.mouse.move(900, 300);
      await settle(page);
      await expect(page).toHaveScreenshot(`unified-sidebar-${theme}.png`, { mask: volatile(page) });
    });

    test('settings: general', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await expect(settingsSection(page, '通用')).toBeVisible();
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
    await settingsSection(page, tab).click();
    await settle(page);
    await expect(page).toHaveScreenshot(`settings-${slug}-light.png`, { mask: volatile(page) });
  });
}

// Computer Use's page with the optional agent-desktop engine picked.
test('settings: computer use engine', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, 'Agent 桌面工具').click();
  await page.getByRole('button', { name: /^Computer Use/ }).click();
  // The switch's input is visually hidden behind its track.
  await page.getByRole('switch', { name: '允许 Agent 控制 lumen-devbox' }).check({ force: true });
  await page.getByRole('button', { name: '内置 引擎' }).click();
  await page.getByRole('option', { name: 'agent-desktop（实验）' }).click();
  await expect(page.getByText('已就绪')).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-computer-use-engine-light.png', { mask: volatile(page) });
});

// Computer Use on a Mac without its OS permissions, one of them asked for.
test('settings: computer use permissions', async ({ page, openDemo }) => {
  await openDemo('light', 'computer=ungranted');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, 'Agent 桌面工具').click();
  await page.getByRole('button', { name: /^Computer Use/ }).click();
  await page.getByRole('button', { name: '请求授权' }).first().click();
  await expect(page.getByText('等待授权', { exact: true })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-computer-use-permissions-light.png', { mask: volatile(page) });
});

// SSH settings with the connection approval switched to per command.
test('settings: SSH approval per command', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, 'SSH 连接').click();
  await page.getByRole('radio', { name: '逐条' }).click();
  await expect(page.getByRole('radio', { name: '逐条' })).toBeChecked();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-ssh-approval-command-light.png', { mask: volatile(page) });
});

// An agent's first connection to a host asks in the conversation, like the
// browser grant; allowing it lets the command run.
for (const theme of ['light', 'dark'] as Theme[]) {
  test(`SSH host approval card (${theme})`, async ({ page, openDemo }) => {
    await openDemo(theme);
    await page.getByRole('textbox', { name: '消息输入' }).fill('看看 gs-dev 服务器的磁盘');
    await page.keyboard.press('Enter');
    const title = page.getByText('允许 Agent 连接到 gs-dev？', { exact: true });
    await expect(title).toBeVisible();
    const card = title.locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
    await settle(page);
    await expect(card).toHaveScreenshot(`ssh-host-approval-${theme}.png`);
    await card.getByRole('button', { name: '本对话内允许' }).click();
    await expect(page.getByText('gs-dev 的根分区已用 41%，还有 46G 可用。')).toBeVisible();
    await expect(title).toHaveCount(0);
  });
}

// Terminal screen: host cards (name and user, no addresses), then a host's right-click menu.
async function openTerminalHosts(page: Page, openDemo: (theme?: Theme, query?: string) => Promise<void>, theme: Theme) {
  await openDemo(theme);
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await expect(page.getByRole('listitem', { name: 'gs-dev' })).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test(`terminal host list (${theme})`, async ({ page, openDemo }) => {
    await openTerminalHosts(page, openDemo, theme);
    // Hovering a row reveals its edit and more buttons.
    await page.getByRole('listitem', { name: 'pp-lax' }).hover();
    await expect(page.getByRole('button', { name: '编辑 pp-lax' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`terminal-hosts-${theme}.png`, { mask: volatile(page) });
  });
}

test('terminal host context menu', async ({ page, openDemo }) => {
  await openTerminalHosts(page, openDemo, 'light');
  await page.getByRole('listitem', { name: 'gs-dev' }).getByRole('heading', { name: 'gs-dev' }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'gs-dev 的更多操作' });
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Agent 访问' })).toHaveAttribute('aria-checked', 'true');
  await settle(page);
  await expect(page).toHaveScreenshot('terminal-host-menu-light.png', { mask: volatile(page) });
});

// Two paired backends (`backends=2`), the second holding slightly different config.
async function openConfigSync(page: Page, openDemo: (theme?: Theme, query?: string, start?: 'conversation' | 'home') => Promise<void>, theme: Theme) {
  await openDemo(theme, 'backends=2');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, '后端连接').click();
  await page.getByRole('button', { name: /^配置同步/ }).click();
  await expect(page.getByText(/^\d+ 项可同步/)).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test(`config sync: two backends side by side (${theme})`, async ({ page, openDemo }) => {
    await openConfigSync(page, openDemo, theme);
    await settle(page);
    await expect(page).toHaveScreenshot(`config-sync-${theme}.png`, { mask: volatile(page) });
  });
}

test('config sync: both values of an item, secrets hidden', async ({ page, openDemo }) => {
  await openConfigSync(page, openDemo, 'light');
  const mcp = page.getByRole('region', { name: 'MCP' });
  await mcp.getByRole('button', { name: '查看内容' }).last().click();
  await expect(mcp.getByText('"••••"')).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('config-sync-values-light.png', { mask: volatile(page) });
});

test('fork from an earlier reply', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByText('design-tokens', { exact: true }).click();
  await page.getByText('同步 HeroUI 主题变量').first().click();
  await page.getByRole('button', { name: '从这条回复分叉' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('fork-from-reply-light.png', { mask: volatile(page) });
});

test('new private conversation', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByRole('button', { name: '新建隐私对话' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Claude Code/ })).toBeChecked();
  await settle(page);
  await expect(page).toHaveScreenshot('new-private-conversation-light.png', { mask: volatile(page) });
});

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

// A second backend that never connects (`backends=offline`): its cached
// workspaces leave the list until the paging row's last step reveals them.
test('sidebar: offline backend workspaces hidden, then revealed', async ({ page, openDemo }) => {
  await openDemo('light', 'backends=offline');
  const sidebar = page.getByRole('complementary');
  const reveal = sidebar.getByRole('button', { name: '显示未连接后端的工作区 (3)' });
  await expect(reveal).toBeVisible();
  await expect(sidebar.getByText('g14-firmware')).toHaveCount(0);
  await settle(page);
  await expect(page).toHaveScreenshot('sidebar-offline-hidden-light.png', { mask: volatile(page) });

  await reveal.click();
  await expect(sidebar.getByText('g14-firmware')).toBeVisible();
  await expect(sidebar.getByRole('button', { name: '收起', exact: true })).toBeAttached();
  // The click leaves the pointer over a row that just moved in; keep its
  // tooltip out of the shot.
  await page.mouse.move(720, 880);
  await settle(page);
  await expect(page).toHaveScreenshot('sidebar-offline-revealed-light.png', { mask: volatile(page) });
});

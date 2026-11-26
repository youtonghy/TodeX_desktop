import type { Page } from '@playwright/test';
import { expect, settle, test, volatile, type Theme } from './demo';

// Full-window screenshots of the main screens in the `?demo` preview. A diff
// here means a shared style, token or layout changed somewhere visible; update
// the baselines (README "Tests") only when the change is intended.

/** A category in the settings modal's grouped rail. */
function settingsSection(page: Page, name: string) {
  return page.getByRole('navigation', { name: '设置' }).getByRole('button', { name, exact: true });
}

test('an old backend refuses Claude submissions and keeps the draft', async ({ page, openDemo }) => {
  await openDemo('light', 'claude-region=legacy');
  const composer = page.getByRole('textbox', { name: '消息输入' });
  await composer.fill('保留这条草稿');
  await composer.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Claude Code 暂不可用' });
  await expect(dialog).toContainText('请将此后端升级');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(composer).toHaveText('保留这条草稿');
});

test('a failed Claude turn restores its draft', async ({ page, openDemo }) => {
  await openDemo('light', 'claude-region=turn');
  const composer = page.getByRole('textbox', { name: '消息输入' });
  await composer.fill('恢复被拒绝的草稿');
  await composer.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Claude Code 暂不可用' });
  await expect(dialog).toContainText('后端无法确认');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(composer).toHaveText('恢复被拒绝的草稿');
});

test('each Claude quota opening rechecks the region', async ({ page, openDemo }) => {
  await openDemo('light', 'claude-region=quota');
  const quota = page.getByRole('button', { name: /^上下文(?:已使用|用量等待)/ });
  for (let attempt = 0; attempt < 2; attempt++) {
    await quota.click();
    const dialog = page.getByRole('dialog', { name: 'Claude Code 暂不可用' });
    await expect(dialog).toContainText('后端无法确认');
    await dialog.getByRole('button', { name: '关闭' }).click();
  }
});

const SETTINGS_TABS = {
  功能: 'features',
  外观: 'appearance',
  后端连接: 'backends',
  后端组: 'mesh',
  'CLI 管理': 'cli',
  'SSH 连接': 'ssh',
  通知: 'notifications',
  'Agent 桌面工具': 'agent-desktop',
  'Agent 调用': 'agent-calling',
  智能工作模式: 'smart-work-mode',
  关于: 'about',
};

for (const theme of ['light', 'dark'] as Theme[]) {
  test.describe(`${theme} theme`, () => {
    test('workbench with an open conversation', async ({ page, openDemo }) => {
      await openDemo(theme);
      await expect(page).toHaveScreenshot(`workbench-${theme}.png`, { mask: volatile(page) });
    });

    test('Claude region refusal keeps the submitted draft', async ({ page, openDemo }) => {
      await openDemo(theme, 'claude-region=prompt');
      const composer = page.getByRole('textbox', { name: '消息输入' });
      await composer.fill('保留这条草稿');
      await composer.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Claude Code 暂不可用' });
      await expect(dialog).toContainText('Anthropic 不支持此后端的连接地区');
      await expect(dialog).toContainText('检测到的地区：XX');
      await expect(dialog).toHaveScreenshot(`claude-region-refused-${theme}.png`);
      await dialog.getByRole('button', { name: '关闭' }).click();
      await expect(composer).toHaveText('保留这条草稿');
    });

    // A finished run is titled by what it did; its steps name the action and
    // the files it touched as chips.
    test('expanded execution group', async ({ page, openDemo }) => {
      await openDemo(theme);
      const header = page.getByRole('button', { name: '编辑 2 个文件 · 运行 1 条命令 · 读取 1 个文件 · 另 1 步' });
      await header.click();
      await expect(page.getByRole('button', { name: /^读取 PaymentForm\.tsx/ })).toBeVisible();
      const group = header.locator('xpath=ancestor::section[1]');
      await settle(page);
      await expect(group).toHaveScreenshot(`execution-group-${theme}.png`);
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

    test('山海经 model table on a long press', async ({ page, openDemo }) => {
      // The table deals models with Math.random; a seeded generator keeps the deal stable.
      await page.addInitScript(() => {
        let state = 20261020;
        Math.random = () => {
          state = (state + 0x6d2b79f5) | 0;
          let value = Math.imul(state ^ (state >>> 15), 1 | state);
          value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
          return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
      });
      await openDemo(theme);
      await page.getByRole('button', { name: '选择模型和思考强度' }).click();
      const trigger = page.getByRole('button', { name: '选择模型', exact: true });
      const box = await trigger.boundingBox();
      if (!box) throw new Error('model picker trigger is not visible');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const table = page.getByRole('dialog', { name: '山海经模型周期表' });
      await expect(table).toBeVisible();
      await page.mouse.up();
      await expect(page.getByRole('dialog', { name: '选择模型' })).toHaveCount(0);
      await page.mouse.move(0, 0);
      await settle(page);
      await expect(page).toHaveScreenshot(`model-shanhai-${theme}.png`, { mask: volatile(page) });
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

    // The running Codex turn's plan: a collapsible checklist above the composer.
    test('agent plan steps above the composer', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByText('排查 Safari 下商品卡片抖动').first().click();
      const steps = page.getByRole('list', { name: '计划步骤' });
      await expect(steps.getByRole('listitem')).toHaveCount(3);
      await expect(page.getByText('先确认抖动来源，再用 WebKit 测试复现并修复。')).toBeVisible();
      const header = page.getByRole('button', { name: '计划 1/3', exact: true });
      await expect(header).toHaveAttribute('aria-expanded', 'true');
      const elapsed = page.getByText(/^\d+m \d{2}s$/);
      await settle(page);
      await expect(page).toHaveScreenshot(`plan-steps-${theme}.png`, { mask: [...volatile(page), elapsed] });
      await header.click();
      await expect(header).toHaveAttribute('aria-expanded', 'false');
      await expect(steps).toBeHidden();
    });

    // Codex's own warning and auto-review outcome: one quiet line each.
    test('Codex warning and auto-review notices', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByText('排查 Safari 下商品卡片抖动').first().click();
      await expect(page.getByRole('note').filter({ hasText: 'Codex CLI 配置警告' })).toBeVisible();
      await expect(page.getByRole('note').filter({ hasText: 'Codex CLI 自动审查已批准：pnpm exec playwright' })).toBeVisible();
      // The conversation is still running: its folded steps show the running
      // tool's elapsed time, which ticks while the test runs.
      const elapsed = page.getByText(/^\d+m \d{2}s$/);
      await expect(elapsed).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`codex-notices-${theme}.png`, { mask: [...volatile(page), elapsed] });
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

    // Files dragged anywhere over the conversation: the drop overlay, then
    // the uploaded file's capsule in the composer.
    test('dropping a file onto the conversation', async ({ page, openDemo }) => {
      await openDemo(theme);
      const composer = page.getByRole('textbox', { name: '消息输入' });
      await expect(composer).toBeVisible();
      const dataTransfer = await page.evaluateHandle(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['# 设计说明\n'], '设计说明.md', { type: 'text/markdown' }));
        return transfer;
      });
      await composer.dispatchEvent('dragenter', { dataTransfer });
      await composer.dispatchEvent('dragover', { dataTransfer });
      await expect(page.getByText('拖到这里添加附件')).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`attachment-drop-${theme}.png`, { mask: volatile(page) });
      await composer.dispatchEvent('drop', { dataTransfer });
      const capsule = composer.locator('.composer-ref').filter({ hasText: '设计说明.md' });
      await expect(capsule).toBeVisible();
      await expect(capsule).not.toHaveAttribute('data-state', /./);
      await settle(page);
      await expect(page).toHaveScreenshot(`attachment-capsule-${theme}.png`, { mask: volatile(page) });
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

    // Scheduled send: the composer's timer button asks only for a time; the
    // conversation's own agent, model and modes go with the message.
    test('scheduled send picker', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('textbox', { name: '消息输入' }).fill('明早跑一遍回归测试');
      await page.getByRole('button', { name: '定时发送' }).click();
      const dialog = page.getByRole('dialog', { name: '定时发送' });
      await expect(dialog.getByText(/^按后端时区/)).toBeVisible();
      await expect(dialog).toHaveScreenshot(`schedule-send-dialog-${theme}.png`);
    });

    // A draft is created on the backend when it is scheduled; the message
    // waits there and the composer empties.
    test('a draft scheduled from the composer', async ({ page, openDemo }) => {
      await openDemo(theme);
      await page.getByRole('button', { name: '新建对话' }).click();
      const composer = page.getByRole('textbox', { name: '消息输入' });
      await composer.fill('明早跑一遍回归测试');
      await page.getByRole('button', { name: '定时发送' }).click();
      const dialog = page.getByRole('dialog', { name: '定时发送' });
      await expect(dialog.getByText(/^按后端时区/)).toBeVisible();
      await dialog.getByRole('button', { name: '定时', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(/^定时对话 · 将于/)).toBeVisible();
      const countdown = page.getByText(/已暂存 1 条$/);
      await expect(countdown).toBeVisible();
      await expect(composer).toHaveText('');
      await page.mouse.move(0, 0);
      await settle(page);
      // The countdown ticks with the flowing clock.
      await expect(page).toHaveScreenshot(`scheduled-draft-${theme}.png`, { mask: [...volatile(page), countdown] });
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

// The agent browser's page: its engine, Chromium, the workspace profiles and
// the sites it may always open.
test('settings: agent browser', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, 'Agent 桌面工具').click();
  await page.getByRole('button', { name: /^Agent 浏览器/ }).click();
  await expect(page.getByRole('button', { name: 'Chromium 引擎' })).toBeVisible();
  await expect(page.getByText('docs.example.com')).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-agent-browser-light.png', { mask: volatile(page) });
});

// The same page with site approval turned off: no question per site.
test('settings: agent browser without site approval', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, 'Agent 桌面工具').click();
  await page.getByRole('button', { name: /^Agent 浏览器/ }).click();
  const approval = page.getByRole('button', { name: /站点审核/ });
  await approval.scrollIntoViewIfNeeded();
  await approval.click();
  await page.getByRole('option', { name: '无需审核' }).click();
  await expect(page.getByText('对话获准使用浏览器后，打开任何站点都不再询问')).toBeVisible();
  await page.getByText('docs.example.com').scrollIntoViewIfNeeded();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-agent-browser-no-approval-light.png', { mask: volatile(page) });
});

// The same page with the experimental Kitesurf engine picked: no workspace profile.
test('settings: agent browser kitesurf', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, 'Agent 桌面工具').click();
  await page.getByRole('button', { name: /^Agent 浏览器/ }).click();
  await page.getByRole('button', { name: 'Chromium 引擎' }).click();
  await page.getByRole('option', { name: 'Kitesurf（实验）' }).click();
  await expect(page.getByText('已就绪')).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-agent-browser-kitesurf-light.png', { mask: volatile(page) });
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

// A device group: this device, a second device and the demo backend (its
// hub), plus a device asking to join (approving it compares the
// verification code).
test('settings: backend group with a join request', async ({ page, openDemo }) => {
  await openDemo('light', 'mesh=1');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, '后端组').click();
  await expect(page.getByText('Pixel 9', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('iPhone', { exact: true })).toBeVisible();
  await expect(page.getByText('中心节点', { exact: true })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-mesh-group-light.png', { mask: volatile(page) });
  await page.getByRole('button', { name: '批准', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: '批准 Pixel 9 加入？' })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-mesh-approve-light.png', { mask: volatile(page) });
  await page.getByRole('dialog', { name: '批准 Pixel 9 加入？' }).getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: 'MBP 的组设置' }).click();
  await expect(page.getByRole('dialog', { name: 'MBP 的组设置' })).toBeVisible();
  // A hub always relays: its relay role is fixed.
  await expect(page.getByRole('dialog', { name: 'MBP 的组设置' }).getByRole('switch', { name: '中心节点' })).toBeChecked();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-mesh-node-light.png', { mask: volatile(page) });
  // The group's name for the node is editable; an empty one cannot be saved.
  const nodeDialog = page.getByRole('dialog', { name: 'MBP 的组设置' });
  await expect(nodeDialog.getByRole('textbox', { name: '名称' })).toHaveValue('MBP');
  await nodeDialog.getByRole('textbox', { name: '名称' }).fill('  ');
  await expect(nodeDialog.getByText('请输入 1 到 80 个字符。', { exact: true })).toBeVisible();
  await expect(nodeDialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'MBP 的组设置' })).toBeHidden();
  // The invite as a QR code a phone scans, above the text to paste.
  await page.getByRole('button', { name: '邀请设备', exact: true }).click();
  await expect(page.getByRole('img', { name: '邀请二维码' })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-mesh-invite-light.png', { mask: volatile(page) });
  await page.keyboard.press('Escape');
  // The only backend is a group node, so Backend connections is empty.
  await settingsSection(page, '后端连接').click();
  await expect(page.getByText('还没有点对点后端', { exact: true })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-backends-groups-only-light.png', { mask: volatile(page) });
});

// Leaving a group whose final roster one node has not confirmed yet: the
// group stays as leaving until it does, or the user removes it anyway.
test('settings: leaving a backend group', async ({ page, openDemo }) => {
  await openDemo('light', 'mesh=leaving');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, '后端组').click();
  await expect(page.getByText('NAS', { exact: true })).toBeVisible();
  await expect(page.getByText('尚未确认', { exact: true })).toBeVisible();
  await expect(page.getByText('iPhone', { exact: true })).toHaveCount(0);
  await settle(page);
  await expect(page).toHaveScreenshot('settings-mesh-leaving-light.png', { mask: volatile(page) });
  await page.getByRole('button', { name: '从本应用移除', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '不等确认就移除“家里”？' })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-mesh-forget-leaving-light.png', { mask: volatile(page) });
});

// This computer's backend is a node of the group and is reached over IPC:
// the group keeps its link to the node as a standby, and the data goes over
// the IPC profile.
test('settings: backend group with this computer over IPC', async ({ page, openDemo }) => {
  await openDemo('light', 'mesh=local');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, '后端组').click();
  await expect(page.getByText('本机 · 数据走 IPC', { exact: true })).toBeVisible();
  // The sidebar's connection tooltip says it too, hidden.
  await expect(page.getByText('已连接', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-mesh-local-light.png', { mask: volatile(page) });
  // Backend connections lists point-to-point backends only: the group's
  // standby link to this computer stays under Backend groups.
  await settingsSection(page, '后端连接').click();
  await expect(page.locator('[data-backend-id="default-backend"]')).toBeVisible();
  await expect(page.locator('[data-backend-id="demo-mesh-standby"]')).toHaveCount(0);
});

// One daemon, one entry: the new-workspace backend picker leaves out
// disabled profiles (the group's standby, a swapped-out loopback one), the
// IPC profile takes its group node's name, and a second profile for the
// same node is merged away.
test('new workspace: each backend listed once, by its group name', async ({ page, openDemo }) => {
  await openDemo('light', 'mesh=duplicates');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, '后端连接').click();
  await expect(page.locator('[data-backend-id="default-backend"]')).toContainText('MBP');
  await page.keyboard.press('Escape');
  await page.getByRole('complementary').getByRole('button', { name: '新建工作区' }).first().click();
  const dialog = page.getByRole('dialog');
  // It starts on an offered backend, not the active disabled standby.
  await expect(dialog.getByRole('button', { name: /连接后端/ })).toContainText('MBP · todex-ipc://local');
  await dialog.getByRole('button', { name: /连接后端/ }).click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(1);
  await expect(options.first()).toHaveText('MBP · todex-ipc://local');
  await settle(page);
  await expect(page).toHaveScreenshot('new-workspace-backends-light.png', { mask: volatile(page) });
});

// The agent starts using the backend's computer: by default its live view
// opens as a side-panel tab.
test('computer use live view in the side panel', async ({ page, openDemo }) => {
  await openDemo('light', 'live=computer');
  await expect(page.getByText('Agent 正在操作 lumen-devbox').first()).toBeVisible();
  await expect(page.getByRole('img', { name: '被控制电脑的实时画面' })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('computer-live-sidebar-light.png', { mask: volatile(page) });
});

// With "Above the composer" picked for the browser, its live view is pinned
// there and no side-panel tab opens.
test('agent browser live view above the composer', async ({ page, openDemo }) => {
  await page.addInitScript(() => localStorage.setItem('todex.agentDesktop.v1', JSON.stringify({ browserPlacement: 'composer' })));
  await openDemo('light', 'live=browser');
  await expect(page.getByRole('img', { name: 'Agent 最新截图' })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('browser-live-composer-light.png', { mask: volatile(page) });
});

// Both live view placement rows on the Computer Use page.
test('settings: live view placement', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, 'Agent 桌面工具').click();
  await page.getByRole('button', { name: /^Computer Use/ }).click();
  await page.getByRole('radio', { name: '输入框上方' }).click();
  await expect(page.getByRole('radio', { name: '输入框上方' })).toBeChecked();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-live-view-placement-light.png', { mask: volatile(page) });
});

// Claude Code's skills: a skill installed as a symlink is tagged and has
// no edit or delete action.
test('settings: Claude Code skills with a linked skill', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, 'CLI 管理').click();
  await page.getByRole('button', { name: /^Claude Code/ }).first().click();
  await page.getByRole('tab', { name: 'MCP / Skill' }).click();
  await expect(page.locator('p', { hasText: /^plan-gate$/ })).toBeVisible();
  await expect(page.getByText('链接', { exact: true })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('settings-claude-skills-linked-light.png', { mask: volatile(page) });
});

// A CLI the backend cannot install: its disabled Install button explains why.
test('settings: CLI install unavailable reason', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, 'CLI 管理').click();
  await page.getByRole('button', { name: /^安装更多/ }).click();
  const row = page.locator('#cli-install-more > div').filter({ hasText: 'Grok Build' });
  await row.locator('span[tabindex="0"]').hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('关闭了设备认证');
  await settle(page);
  await expect(page).toHaveScreenshot('settings-cli-install-unavailable-light.png', { mask: volatile(page) });
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

async function openTerminalKeys(page: Page, openDemo: (theme?: Theme, query?: string) => Promise<void>, theme: Theme) {
  await openTerminalHosts(page, openDemo, theme);
  await page.getByRole('tab', { name: '密钥' }).click();
  await expect(page.getByRole('heading', { name: 'deploy_2026' })).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test(`terminal key list (${theme})`, async ({ page, openDemo }) => {
    await openTerminalKeys(page, openDemo, theme);
    await settle(page);
    await expect(page).toHaveScreenshot(`terminal-keys-${theme}.png`, { mask: volatile(page) });
  });
}

// Deploying a key: the password host is picked by default, the key host and
// the read-only host are listed with their state.
test('terminal key deploy dialog', async ({ page, openDemo }) => {
  await openTerminalKeys(page, openDemo, 'light');
  await page.getByRole('button', { name: '将 deploy_2026 部署到主机' }).click();
  const dialog = page.getByRole('dialog', { name: '部署 deploy_2026 到主机' });
  await expect(dialog.getByRole('checkbox', { name: 'pp-lax' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'build-box' })).toBeDisabled();
  await settle(page);
  await expect(page).toHaveScreenshot('terminal-key-deploy-light.png', { mask: volatile(page) });
});

// Overwriting a key host and turning off password login both need a
// confirmation first.
test('terminal key deploy confirmation', async ({ page, openDemo }) => {
  await openTerminalKeys(page, openDemo, 'light');
  await page.getByRole('button', { name: '将 deploy_2026 部署到主机' }).click();
  const dialog = page.getByRole('dialog', { name: '部署 deploy_2026 到主机' });
  // React Aria hides the inputs; their labels take the click.
  await dialog.getByRole('listitem').filter({ hasText: 'gs-dev' }).locator('label').click();
  await dialog.getByText(/^关闭服务器的密码登录/).click();
  await dialog.getByRole('button', { name: '部署到 2 台主机' }).click();
  await expect(page.getByRole('dialog', { name: '确认部署' })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('terminal-key-deploy-confirm-light.png', { mask: volatile(page) });
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

// Claude Code offers Smart next to Implement and Plan.
test('composer work mode menu with Smart', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByRole('button', { name: /选择工作模式/ }).click();
  await expect(page.getByRole('option', { name: '智能' })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('work-mode-menu-smart-light.png', { mask: volatile(page) });
});

// A smart conversation after its plan was approved: one quiet handoff line,
// and the composer runs the execute stage's model with auto-approval.
test('smart conversation with a plan handoff', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByText('design-tokens', { exact: true }).click();
  await page.getByText('拆分主题构建脚本').first().click();
  await expect(page.getByRole('note').filter({ hasText: '已批准计划，已切换到 Opus · 自动审批执行' })).toBeVisible();
  await expect(page.getByRole('button', { name: /选择工作模式/ })).toContainText('智能 · 执行中');
  await settle(page);
  await expect(page).toHaveScreenshot('smart-plan-handoff-light.png', { mask: volatile(page) });
});

// The same smart conversation taking on a new task: Claude enters Plan mode
// on its own (`plan_reentered`), so it plans again on the plan model and the
// composer shows the planning stage.
test('smart conversation re-entering planning', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByText('design-tokens', { exact: true }).click();
  await page.getByText('拆分主题构建脚本').first().click();
  await expect(page.getByRole('button', { name: /选择工作模式/ })).toContainText('智能 · 执行中');
  await page.getByRole('textbox', { name: '消息输入' }).fill('先给导出加进度提示出个计划');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('note').filter({ hasText: /^Claude 重新进入计划，已切换到 .+ 规划$/ })).toBeVisible();
  await expect(page.getByText('计划待批准', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /选择工作模式/ })).toContainText('智能 · 计划中');
  await settle(page);
  await expect(page).toHaveScreenshot('smart-plan-reentered-light.png', { mask: volatile(page) });
});

// A plan handed in for approval (Claude ExitPlanMode as a plan review): the
// plan is its own timeline row and the composer card approves it or sends
// requested changes back.
for (const theme of ['light', 'dark'] as Theme[]) {
  test(`plan review (${theme})`, async ({ page, openDemo }) => {
    await openDemo(theme);
    await page.getByText('design-tokens', { exact: true }).click();
    await page.getByText('拆分主题构建脚本').first().click();
    await page.getByRole('textbox', { name: '消息输入' }).fill('先给导出加进度提示出个计划');
    await page.keyboard.press('Enter');
    const title = page.getByText('计划待批准', { exact: true });
    await expect(title).toBeVisible();
    const plan = page.getByRole('region', { name: '计划' }).filter({ hasText: '给导出加上进度提示' });
    const card = title.locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
    await settle(page);
    await expect(plan).toHaveScreenshot(`plan-review-plan-${theme}.png`);
    await expect(card).toHaveScreenshot(`plan-review-card-${theme}.png`);
    await card.getByRole('button', { name: '要求修改' }).click();
    await card.getByRole('textbox', { name: '修改意见' }).fill('取消时也要提示用户');
    await card.getByRole('button', { name: '发送修改意见' }).click();
    await expect(page.getByText('好的，我按你的意见修改计划：取消时也要提示用户')).toBeVisible();
    await expect(title).toBeHidden();
  });
}

test('fork from an earlier reply', async ({ page, openDemo }) => {
  await openDemo('light');
  await page.getByText('design-tokens', { exact: true }).click();
  await page.getByText('同步 HeroUI 主题变量').first().click();
  await page.getByRole('button', { name: '从这条回复分叉' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('fork-from-reply-light.png', { mask: volatile(page) });
});

// End-to-end encrypted history this device cannot read: a turn it holds no
// key for, and one whose content failed its integrity check, each one quiet
// line.
test('unreadable encrypted history', async ({ page, openDemo }) => {
  await openDemo('light', 'history=unreadable');
  await expect(page.getByRole('note').filter({ hasText: '此设备尚未获授权查看这段历史' })).toBeVisible();
  await expect(page.getByRole('note').filter({ hasText: '这段历史未通过完整性校验，内容已隐藏' })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('unreadable-history-light.png', { mask: volatile(page) });
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

// This computer's backend, running on macOS: the listen card offers to
// keep the Mac awake on AC power, which the setting toggles in place.
test('settings: local backend keeps the host awake', async ({ page, openDemo }) => {
  await openDemo('light', 'localBackend=1');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await settingsSection(page, '本机 Backend').click();
  const keepAwake = page.getByRole('switch', { name: '接电源时保持唤醒' });
  await expect(keepAwake).toBeChecked();
  await settle(page);
  // settle() parks scrolled panes at their end; bring the listen card back.
  await keepAwake.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(page).toHaveScreenshot('settings-local-backend-light.png', { mask: volatile(page) });
  await keepAwake.click({ force: true });
  await expect(keepAwake).not.toBeChecked();
});

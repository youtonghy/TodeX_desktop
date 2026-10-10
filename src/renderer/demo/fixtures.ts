// Demo-preview fixtures: a fictional "Lumen" team with a few workspaces,
// conversations and the backend data the panels read. Everything here is
// served by the in-memory transport in ./transport.ts.
import type {
  AgentProvidersResponse,
  CliVersionsResponse,
  ConversationEvent,
  ConversationManifest,
  McpCatalog,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderKind,
  ProviderModelDescriptor,
  ProviderQuotasResponse,
  SkillCatalog,
} from '@todex/protocol/v2';
import type { KanbanTask, WorkspaceRecord } from '@todex/protocol/todex';
import type { UsageRecord } from '@todex/protocol/mobileParity';
import type { GitScanResult, GitStatusSummary, GitWorkspaceSnapshot } from '../lib/gitWorkspace';

export const DEMO_SERVER_URL = 'http://127.0.0.1:7399';
export const DEMO_ROOT = '/home/demo/projects';

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const iso = (time: number) => new Date(time).toISOString();

function workspace(id: string, name: string, extra: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id,
    name,
    path: `${DEMO_ROOT}/${name}`,
    sessionId: `session-${id}`,
    tenantId: 'local',
    threadId: '',
    model: 'opus',
    reasoningEffort: 'high',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW - HOUR,
    ...extra,
  };
}

export const demoWorkspaces: WorkspaceRecord[] = [
  workspace('ws-lumen-web', 'lumen-web', { groupId: 'grp-lumen', groupName: 'Lumen', sortOrder: 0, updatedAt: NOW - 5 * MINUTE }),
  workspace('ws-lumen-api', 'lumen-api', { groupId: 'grp-lumen', groupName: 'Lumen', sortOrder: 1 }),
  workspace('ws-design-tokens', 'design-tokens', { sortOrder: 2, icon: 'palette', iconColor: '#7C5CFC' }),
  workspace('ws-infra', 'infra-scripts', { sortOrder: 3, model: 'gpt-5.5' }),
];

const capabilities: ProviderCapabilities = {
  nativeResume: true,
  cancel: true,
  permissions: true,
  toolEvents: true,
  nativeSkills: true,
  nativeMcp: true,
  managedMcp: true,
  modelSelection: true,
  imageInput: true,
  imageInputMode: 'model',
  streaming: true,
  followUpQueue: true,
  permissionConfig: {
    modes: ['ask', 'auto', 'full-access'],
    defaultMode: 'auto',
    supportsPlan: true,
  },
};

function model(id: string, displayName: string, description: string, extra: Partial<ProviderModelDescriptor> = {}): ProviderModelDescriptor {
  return {
    id,
    displayName,
    description,
    isDefault: false,
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'high',
    contextWindow: 200_000,
    imageInput: true,
    ...extra,
  };
}

export const demoModels: Partial<Record<ProviderKind, ProviderModelDescriptor[]>> = {
  'claude-code': [
    model('opus', 'Opus', '最强推理，适合复杂重构', { isDefault: true, family: 'opus' }),
    model('sonnet', 'Sonnet', '速度与质量均衡', { family: 'sonnet' }),
  ],
  codex: [
    model('gpt-5.5', 'GPT-5.5', '默认编码模型', { isDefault: true, contextWindow: 272_000 }),
    model('gpt-5.5-mini', 'GPT-5.5 mini', '轻量快速', { contextWindow: 272_000 }),
  ],
  pi: [model('pi-default', 'Pi Default', 'Pi 默认模型', { isDefault: true, supportedReasoningEfforts: ['medium'] })],
};

function provider(id: ProviderKind, displayName: string, available: boolean, unavailableReason?: string): ProviderDescriptor {
  return {
    id,
    displayName,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
    profiles: ['default'],
    capabilities,
    models: demoModels[id] ?? [],
  };
}

export const demoProviders: ProviderDescriptor[] = [
  provider('claude-code', 'Claude Code', true),
  provider('codex', 'Codex CLI', true),
  provider('pi', 'Pi', true),
  provider('opencode', 'OpenCode', false, 'opencode is not installed'),
  provider('antigravity', 'Antigravity', false, "executable 'agy' was not found"),
];

// --- Conversation journals ---------------------------------------------------

type Journal = { manifest: ConversationManifest; events: ConversationEvent[] };

class JournalBuilder {
  readonly events: ConversationEvent[] = [];
  private time: number;
  private turn = 0;
  private turnId = '';

  constructor(private readonly conversationId: string, private readonly provider: ProviderKind, startedAt: number) {
    this.time = startedAt;
  }

  private push(type: string, payload: Record<string, unknown>, gapMs = 6_000) {
    this.time += gapMs;
    this.events.push({
      schemaVersion: 2,
      eventId: `${this.conversationId}-e${this.events.length + 1}`,
      conversationId: this.conversationId,
      sequence: this.events.length + 1,
      time: iso(this.time),
      type,
      provider: this.provider,
      payload: { turnId: this.turnId, ...payload },
    });
  }

  user(content: string) {
    this.turn += 1;
    this.turnId = `${this.conversationId}-t${this.turn}`;
    this.push('message.created', { role: 'user', content }, 40_000);
    this.push('turn.started', { status: 'running' }, 800);
    return this;
  }

  think(thinking: string) {
    this.push('thought.delta', { thinking }, 3_000);
    return this;
  }

  tool(toolName: string, args: Record<string, unknown>, result?: string) {
    const toolCallId = `${this.turnId}-call${this.events.length}`;
    this.push('tool.started', { toolCallId, toolName, arguments: args }, 2_500);
    if (result !== undefined) this.push('tool.completed', { toolCallId, toolName, arguments: args, result, isError: false }, 4_000);
    return this;
  }

  answer(text: string, usage: { model: string; input: number; output: number; cacheRead: number; cacheWrite: number }) {
    this.push('message.completed', {
      role: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
      block: { category: 'assistant_final', id: `${this.turnId}-answer`, turnId: this.turnId, phase: 'completed' },
    }, 5_000);
    this.push('usage.updated', {
      model: usage.model,
      contextWindow: 200_000,
      usage: { last: { ...usage, total: usage.input + usage.output } },
    }, 200);
    this.push('turn.completed', { status: 'completed' }, 300);
    return this;
  }

  get lastTime() {
    return this.time;
  }
}

function journal(
  id: string,
  workspaceRecord: WorkspaceRecord,
  providerKind: ProviderKind,
  title: string,
  startedAt: number,
  build: (journalBuilder: JournalBuilder) => void,
): Journal {
  const builder = new JournalBuilder(id, providerKind, startedAt);
  build(builder);
  const running = builder.events.at(-1)?.type !== 'turn.completed';
  return {
    events: builder.events,
    manifest: {
      schemaVersion: 2,
      id,
      provider: providerKind,
      ownerId: 'local',
      workspace: workspaceRecord.path,
      workspaceId: workspaceRecord.id,
      title,
      providerProfile: 'default',
      status: running ? 'running' : 'idle',
      lastSequence: builder.events.length,
      createdAt: iso(startedAt),
      updatedAt: iso(builder.lastTime),
    },
  };
}

const [lumenWeb, lumenApi, designTokens, infra] = demoWorkspaces;

const checkoutAnswer = `已把结账页的三处校验收敛成一个 schema，并补上了单元测试。

### 改动概览

| 文件 | 说明 |
| --- | --- |
| \`src/checkout/schema.ts\` | 新增，集中定义地址、联系方式和支付字段 |
| \`src/checkout/useCheckoutForm.ts\` | 改为基于 schema 推导类型与默认值 |
| \`src/checkout/*Form.tsx\` | 删除各自的内联校验，统一读取 \`errors\` |
| \`src/checkout/schema.test.ts\` | 新增 14 个用例 |

### 关键实现

\`\`\`ts
export const checkoutSchema = z.object({
  contact: z.object({
    email: z.string().email('请输入有效的邮箱地址'),
    phone: z.string().regex(/^1\\d{10}$/, '手机号格式不正确'),
  }),
  address: addressSchema,
  payment: paymentSchema.refine(luhnCheck, { message: '卡号校验失败', path: ['cardNumber'] }),
});

export type CheckoutValues = z.infer<typeof checkoutSchema>;
\`\`\`

### 验证

- \`pnpm test checkout\`：**14 passed**
- \`pnpm typecheck\`：通过
- 手动检查了地址自动补全和卡号分组输入，行为与之前一致

下一步建议把 \`PaymentForm\` 的异步卡 BIN 查询也接入 schema 的 \`superRefine\`，这样错误提示能统一出现在字段下方。`;

const copyAnswer = `错误提示已统一为中文，颜色改用设计规范里的语义 token：

1. 字段错误使用 \`text-danger\`，不再写死十六进制颜色。
2. 提示文案集中到 \`src/checkout/messages.ts\`，方便后续接入 i18n。
3. 表单底部的汇总提示改用 HeroUI \`Alert status="danger"\`。

浅色和暗色模式下都检查过对比度，均满足 WCAG AA。`;

export const demoJournals: Journal[] = [
  journal('9b2f6c1e-4a7d-4f1e-9c3a-1d2e3f4a5b6c', lumenWeb, 'claude-code', '重构结账页表单校验', NOW - 3 * HOUR, (j) => {
    j.user('结账页的表单校验逻辑分散在三个组件里，帮我统一成一个 schema，并补上单元测试。')
      .think('先找出现有的校验分布在哪些文件，确认字段与规则，再决定用 zod 收敛成一个 schema，最后补测试。')
      .tool('Grep', { pattern: 'validate|errors\\.', path: 'src/checkout' }, 'src/checkout/AddressForm.tsx:42:  const validate = (values) => {\nsrc/checkout/PaymentForm.tsx:18:  if (!luhn(cardNumber)) errors.cardNumber = ...\nsrc/checkout/ContactForm.tsx:27:  errors.email = isEmail(email) ? undefined : ...')
      .tool('Read', { file_path: 'src/checkout/PaymentForm.tsx' }, 'export function PaymentForm() {\n  const [errors, setErrors] = useState({});\n  // 18 行内联校验……\n}')
      .tool('Write', { file_path: 'src/checkout/schema.ts' }, 'File created successfully at: src/checkout/schema.ts')
      .tool('Edit', { file_path: 'src/checkout/useCheckoutForm.ts', old_string: 'useState<FormErrors>', new_string: 'useForm<CheckoutValues>' }, 'The file src/checkout/useCheckoutForm.ts has been updated.')
      .tool('Bash', { command: 'pnpm test checkout', description: 'Run checkout unit tests' }, ' ✓ src/checkout/schema.test.ts (14 tests) 38ms\n\n Test Files  1 passed (1)\n      Tests  14 passed (14)')
      .answer(checkoutAnswer, { model: 'opus', input: 48_200, output: 6_420, cacheRead: 182_000, cacheWrite: 12_400 });
    j.user('顺便把错误提示文案改成中文，并保持和设计规范一致的颜色。')
      .tool('Edit', { file_path: 'src/checkout/messages.ts' }, 'The file src/checkout/messages.ts has been updated.')
      .tool('Bash', { command: 'pnpm lint src/checkout', description: 'Lint checkout' }, '✔ No problems found')
      .answer(copyAnswer, { model: 'opus', input: 21_300, output: 2_150, cacheRead: 96_000, cacheWrite: 4_100 });
  }),
  journal('3c8d1f2a-6b4e-4d9a-8f1b-2a3b4c5d6e7f', lumenWeb, 'codex', '排查 Safari 下商品卡片抖动', NOW - 25 * MINUTE, (j) => {
    j.user('Safari 17 下商品卡片在滚动时会抖动，帮我查一下原因。')
      .think('抖动通常来自 sticky 元素与 transform 的组合，或图片尺寸在加载后变化。先搜索 sticky 和 will-change。')
      .tool('shell', { command: ['rg', '-n', 'position: sticky|will-change', 'src/catalog'] }, 'src/catalog/ProductCard.css:12:  position: sticky;\nsrc/catalog/ProductCard.css:13:  will-change: transform;')
      .tool('shell', { command: ['pnpm', 'exec', 'playwright', 'test', '--project=webkit', 'catalog'] });
  }),
  journal('5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9', lumenWeb, 'pi', '为订单列表加分页', NOW - 2 * DAY, (j) => {
    j.user('订单列表一次加载全部数据太慢了，改成游标分页，每页 20 条。')
      .tool('read', { path: 'src/orders/OrderList.tsx' }, 'export function OrderList() { … }')
      .tool('edit', { path: 'src/orders/useOrders.ts' }, 'Applied 1 edit.')
      .answer('已改为游标分页：`useOrders` 返回 `fetchNextPage`，列表底部使用 HeroUI Pro `ListView` 的加载更多。首屏请求从 1.8 MB 降到 64 KB。', { model: 'pi-default', input: 18_000, output: 1_900, cacheRead: 0, cacheWrite: 0 });
  }),
  journal('7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', lumenApi, 'claude-code', '支付回调幂等处理', NOW - 1 * DAY, (j) => {
    j.user('支付网关会重复推送回调，订单偶尔被记两次账。请加上幂等处理。')
      .tool('Read', { file_path: 'internal/payment/webhook.go' }, 'func HandleWebhook(w http.ResponseWriter, r *http.Request) { … }')
      .tool('Edit', { file_path: 'internal/payment/webhook.go' }, 'The file internal/payment/webhook.go has been updated.')
      .answer('回调现在以 `event_id` 作为幂等键写入 `payment_events` 表（唯一索引），重复推送会直接返回 200 而不再记账。补充了并发重放测试。', { model: 'sonnet', input: 32_000, output: 3_400, cacheRead: 64_000, cacheWrite: 6_000 });
  }),
  journal('2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a', designTokens, 'codex', '同步 HeroUI 主题变量', NOW - 4 * DAY, (j) => {
    j.user('把设计系统导出的 CSS 变量同步到 tokens 包里。')
      .tool('shell', { command: ['pnpm', 'build:tokens'] }, 'Built 96 tokens → dist/tokens.css')
      .answer('已同步 96 个 token，色相统一为 253.83，并生成了浅色与暗色两套变量。', { model: 'gpt-5.5', input: 12_000, output: 1_100, cacheRead: 40_000, cacheWrite: 0 });
  }),
];

export const demoActiveConversationId = demoJournals[0].manifest.id;

// --- Panel data ----------------------------------------------------------------

export const demoQuota: ProviderQuotasResponse = {
  providers: {
    codex: {
      provider: 'codex', scope: 'account', state: 'ok', planType: 'pro', fetchedAt: NOW - 2 * MINUTE,
      windows: [
        { id: 'primary', usedPercent: 32, resetsAt: Math.floor((NOW + 3 * HOUR) / 1000), durationMins: 300 },
        { id: 'secondary', usedPercent: 58, resetsAt: Math.floor((NOW + 4 * DAY) / 1000), durationMins: 10_080 },
      ],
    },
    'claude-code': {
      provider: 'claude-code', scope: 'account', state: 'ok', planType: 'max', fetchedAt: NOW - 5 * MINUTE,
      windows: [
        { id: 'five_hour', usedPercent: 81, resetsAt: Math.floor((NOW + 90 * MINUTE) / 1000), durationMins: 300 },
        { id: 'seven_day', usedPercent: 46, resetsAt: Math.floor((NOW + 5 * DAY) / 1000), durationMins: 10_080 },
      ],
    },
    antigravity: {
      provider: 'antigravity', scope: 'account', state: 'unavailable', reason: "executable 'agy' was not found",
    },
  },
};

export const demoCliVersions: CliVersionsResponse = {
  checkedAt: iso(NOW - 10 * MINUTE),
  clis: [
    { id: 'claude-code', kind: 'managed', name: 'Claude Code', installed: true, currentVersion: '2.1.296', latestVersion: '2.1.296', status: 'upToDate', upgradeSupported: true, installSupported: true },
    { id: 'codex', kind: 'managed', name: 'Codex', installed: true, currentVersion: '0.162.0', latestVersion: '0.163.1', status: 'updateAvailable', upgradeSupported: true, installSupported: true },
    { id: 'pi', kind: 'managed', name: 'Pi', installed: true, currentVersion: '1.1.0', latestVersion: '1.1.0', status: 'upToDate', upgradeSupported: true, installSupported: true },
    { id: 'opencode', kind: 'managed', name: 'OpenCode', installed: false, latestVersion: '1.18.35', status: 'notInstalled', upgradeSupported: true, installSupported: true },
  ],
};

export const demoAgentProviders: AgentProvidersResponse = {
  updatedAt: NOW - DAY,
  agents: {
    'claude-code': {
      agent: 'claude-code',
      mode: 'exclusive',
      currentProviderId: 'anthropic-official',
      live: { kind: 'exclusive', configured: true, config: null, matchesCurrent: true },
      providers: [
        { id: 'anthropic-official', name: 'Anthropic 官方', settingsConfig: {}, category: 'official', websiteUrl: 'https://www.anthropic.com', createdAt: NOW - 20 * DAY, updatedAt: NOW - 2 * DAY },
        { id: 'team-gateway', name: '团队网关', settingsConfig: {}, category: 'custom', notes: '按项目计费', createdAt: NOW - 9 * DAY, updatedAt: NOW - 9 * DAY },
      ],
    },
    codex: {
      agent: 'codex',
      mode: 'exclusive',
      currentProviderId: 'openai-official',
      live: { kind: 'exclusive', configured: true, config: null, matchesCurrent: true },
      providers: [
        { id: 'openai-official', name: 'OpenAI 官方', settingsConfig: {}, category: 'official', createdAt: NOW - 15 * DAY, updatedAt: NOW - 3 * DAY },
      ],
    },
  },
};

export function demoSkills(providerKind: ProviderKind): SkillCatalog {
  return {
    provider: providerKind,
    skills: [
      { resourceId: `${providerKind}:skill:frontend-review`, name: 'frontend-review', description: '按设计规范审查 UI 的间距、层级与对比度', scope: 'project', source: '.claude/skills/frontend-review', active: true, valid: true },
      { resourceId: `${providerKind}:skill:release-notes`, name: 'release-notes', description: '根据合并的 PR 生成发布说明', scope: 'user', source: '~/.agents/shared/skills/release-notes', active: true, valid: true },
      { resourceId: `${providerKind}:skill:db-migration`, name: 'db-migration', description: '生成可回滚的数据库迁移脚本', scope: 'project', source: '.claude/skills/db-migration', active: false, valid: true },
    ],
  };
}

export function demoMcp(providerKind: ProviderKind): McpCatalog {
  return {
    provider: providerKind,
    servers: [
      { resourceId: `${providerKind}:mcp:github`, name: 'github', provider: providerKind, scope: 'user', source: '~/.agents/shared/mcp.json', transport: 'http', enabled: true, active: true, tools: [{ name: 'search_issues', description: '搜索仓库 issue' }, { name: 'create_pull_request', description: '创建 PR' }] },
      { resourceId: `${providerKind}:mcp:postgres`, name: 'postgres', provider: providerKind, scope: 'project', source: '.mcp.json', transport: 'stdio', enabled: true, active: true, tools: [{ name: 'query', description: '只读 SQL 查询' }] },
    ],
  };
}

export const demoGitWorkspace = (path: string): GitWorkspaceSnapshot => ({
  repositoryPath: path,
  initialized: true,
  currentBranch: 'feat/checkout-schema',
  branches: [
    { name: 'feat/checkout-schema', current: true, remote: false },
    { name: 'main', current: false, remote: false },
    { name: 'origin/main', current: false, remote: true },
  ],
  worktrees: [{ path, branch: 'feat/checkout-schema', current: true, main: true, locked: false, dirty: true, accessible: true }],
  dirty: true,
});

export const demoGitStatus = (path: string): GitStatusSummary => ({
  repositoryPath: path,
  initialized: true,
  branch: 'feat/checkout-schema',
  worktreeKind: 'main',
  changedFiles: 4,
  additions: 186,
  deletions: 52,
  statsTruncated: false,
  upstream: 'origin/feat/checkout-schema',
  ahead: 2,
  behind: 0,
});

export const demoGitScan = (path: string): GitScanResult => ({
  repositories: [{
    path,
    name: path.split('/').pop() ?? path,
    branch: 'feat/checkout-schema',
    additions: 186,
    deletions: 52,
    ahead: 2,
    initialEligible: true,
    files: [
      { path: 'src/checkout/schema.ts', status: 'A', additions: 94, deletions: 0 },
      { path: 'src/checkout/schema.test.ts', status: 'A', additions: 61, deletions: 0 },
      { path: 'src/checkout/useCheckoutForm.ts', status: 'M', additions: 21, deletions: 38 },
      { path: 'src/checkout/PaymentForm.tsx', status: 'M', additions: 10, deletions: 14 },
    ],
  }],
});

export const demoKanbanTasks: KanbanTask[] = [
  { id: 'task-1', workspaceId: lumenWeb.id, title: '结账页表单校验收敛', description: '统一 schema 并补测试', status: 'done', conversationId: demoJournals[0].manifest.id, conversationIds: [demoJournals[0].manifest.id], sortOrder: 0, createdAt: NOW - 3 * DAY, updatedAt: NOW - HOUR },
  { id: 'task-2', workspaceId: lumenWeb.id, title: 'Safari 卡片抖动', status: 'in-progress', conversationId: demoJournals[1].manifest.id, conversationIds: [demoJournals[1].manifest.id], sortOrder: 1, createdAt: NOW - DAY, updatedAt: NOW - 25 * MINUTE },
  { id: 'task-3', workspaceId: lumenWeb.id, title: '订单列表虚拟滚动', description: '超过 500 条时启用', status: 'planned', dueDate: new Date(NOW + 3 * DAY).toISOString().slice(0, 10), sortOrder: 2, createdAt: NOW - DAY, updatedAt: NOW - DAY },
  { id: 'task-4', workspaceId: lumenApi.id, title: '支付回调幂等', status: 'done', conversationId: demoJournals[3].manifest.id, conversationIds: [demoJournals[3].manifest.id], sortOrder: 0, createdAt: NOW - 2 * DAY, updatedAt: NOW - DAY },
  { id: 'task-5', workspaceId: infra.id, title: '夜间备份告警接入飞书', status: 'planned', sortOrder: 0, createdAt: NOW - 5 * DAY, updatedAt: NOW - 5 * DAY },
];

/** Two weeks of per-turn usage so the usage panel has a realistic spread. */
export const demoUsageRecords: UsageRecord[] = Array.from({ length: 42 }, (_, index) => {
  const providers = [
    { provider: 'claude-code', models: ['opus', 'sonnet'] },
    { provider: 'codex', models: ['gpt-5.5', 'gpt-5.5-mini'] },
    { provider: 'pi', models: ['pi-default'] },
  ] as const;
  const pick = providers[index % 5 === 4 ? 2 : index % 3 === 2 ? 1 : 0];
  const modelId = pick.models[index % pick.models.length];
  const scale = 1 + ((index * 37) % 11) / 4;
  const input = Math.round(14_000 * scale);
  const output = Math.round(1_800 * scale);
  return {
    id: `demo-usage-${index}`,
    conversationId: demoJournals[index % demoJournals.length].manifest.id,
    provider: pick.provider,
    model: modelId,
    turnId: `demo-turn-${index}`,
    scope: 'turn',
    inputTokens: input,
    outputTokens: output,
    // Codex counts cached tokens inside input; Claude Code reports them on top.
    cachedInputTokens: pick.provider === 'pi' ? 0 : Math.round(input * (pick.provider === 'codex' ? 0.62 : 2.4)),
    cacheWriteTokens: pick.provider === 'claude-code' ? Math.round(input * 0.25) : 0,
    totalTokens: input + output,
    cacheSemantics: pick.provider === 'codex' ? 'included' : pick.provider === 'claude-code' ? 'additional' : 'unknown',
    updatedAt: NOW - Math.round((index / 42) * 14 * DAY) - HOUR,
  };
});

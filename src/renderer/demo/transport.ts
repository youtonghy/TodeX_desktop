// In-memory stand-in for the todex-agentd transport used by the demo preview.
// REST paths answer from ./fixtures; the socket opens at once, backfills
// subscriptions and plays a canned turn for every prompt, so the real session
// reducers build the timeline, running state and usage exactly as they would.
import type {
  SecureRequest,
  SecureResponse,
  SecureSocket,
  SecureSocketOptions,
  SecureStreamResponse,
  SecureTransport,
} from '@todex/protocol/secureTransport';
import type { AgentCallingSettings, ApiKeySummary, ConversationEvent, ConversationManifest, DshPackage, DshPluginList, DshPluginOperation, DshPluginRow, McpCatalog, McpServerCatalogDescriptor, ProviderKind, SkillCatalog, SkillCatalogDescriptor } from '@todex/protocol/v2';
import { applyMergePatch, setAt, type SettingsObject } from '../lib/cliSettings';
import * as fixtures from './fixtures';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Journal = { manifest: ConversationManifest; events: ConversationEvent[] };

// Mutable copies so prompts, renames and kanban edits persist for the tab.
const journals = new Map<string, Journal>(
  fixtures.demoJournals.map((journal) => [journal.manifest.id, { manifest: { ...journal.manifest }, events: [...journal.events] }]),
);
let workspaces = [...fixtures.demoWorkspaces];
let kanbanTasks = [...fixtures.demoKanbanTasks];
let cleanupPolicy = { enabled: false, maxAgeDays: null as number | null, maxTotalBytes: null as number | null };

/** Stable fake size per conversation: events plus an id-derived base. */
function demoConversationBytes(journal: Journal): number {
  const seed = [...journal.manifest.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return 40_000 + (seed % 97) * 23_000 + journal.events.length * 1_800;
}

type DemoSettingsFile = { path: string; format: 'json' | 'toml' | 'yaml'; text: string; settings: SettingsObject | null };

/** Enough TOML for the demo: scalars and arrays, then one `[table]` per nested object. */
function demoToml(settings: SettingsObject, prefix: string[] = []): string {
  const entries = Object.entries(settings);
  const isTable = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value);
  const scalars = entries.filter(([, value]) => !isTable(value)).map(([key, value]) => `${key} = ${JSON.stringify(value)}\n`).join('');
  const header = prefix.length > 0 && scalars ? `\n[${prefix.join('.')}]\n` : '';
  const tables = entries.filter(([, value]) => isTable(value)).map(([key, value]) => demoToml(value as SettingsObject, [...prefix, key])).join('');
  return header + scalars + tables;
}

function demoSettingsFile(path: string, format: 'json' | 'toml', settings: SettingsObject): DemoSettingsFile {
  const text = format === 'toml' ? demoToml(settings).replace(/^\n/, '') : `${JSON.stringify(settings, null, 2)}\n`;
  return { path, format, text, settings };
}

const demoCliSettings: Record<string, DemoSettingsFile> = {
  'deepseek-harness': {
    path: '/home/demo/.dsh/profiles/acp/cordis.patch.yml',
    format: 'yaml',
    text: "# Your patch layer for this dsh profile, applied after every bundle layer.\n- id: llm-pi-ai\n  config:\n    providers:\n      team-gateway:\n        displayName: 团队网关\n        api: openai-completions\n        baseURL: https://gateway.example.com/v1\n        apiKeyEnv: TODEX_DSH_TEAM_GATEWAY_API_KEY\n        models:\n        - id: qwen3-coder\n- id: acp\n  config:\n    provider: team-gateway\n    model: qwen3-coder\n",
    settings: {},
  },
  'claude-code': demoSettingsFile('/home/demo/.claude/settings.json', 'json', {
    env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com', ANTHROPIC_AUTH_TOKEN: 'sk-demo-0000' },
    permissions: { defaultMode: 'acceptEdits', allow: ['Bash(pnpm test:*)'] },
    attribution: { commit: '', pr: '' },
    theme: 'dark',
    hooks: { Stop: [] },
  }),
  codex: demoSettingsFile('/home/demo/.codex/config.toml', 'toml', {
    model: 'gpt-5.5',
    model_reasoning_effort: 'high',
    approval_policy: 'on-request',
    sandbox_mode: 'workspace-write',
    sandbox_workspace_write: { network_access: true },
    tui: { notifications: ['agent-turn-complete', 'approval-requested'] },
    mcp_servers: { docs: { command: 'docs-mcp' } },
  }),
  pi: demoSettingsFile('/home/demo/.pi/agent/settings.json', 'json', {
    defaultProvider: 'anthropic',
    defaultModel: 'claude-opus-4-5',
    defaultThinkingLevel: 'medium',
    theme: 'dark',
    quietStartup: 'header',
    compaction: { enabled: true, reserveTokens: 16384 },
    enabledModels: ['anthropic/claude-opus-4-5', 'anthropic/claude-sonnet-4-5', 'openai/*'],
    packages: [
      'npm:@gotgenes/pi-permission-system',
      'npm:pi-mcp-adapter',
      'npm:pi-web-access',
      'npm:@tintinweb/pi-subagents',
      { source: 'npm:pi-context-prune', extensions: [], skills: [], prompts: [], themes: [] },
      'npm:pi-cache-optimizer',
      { source: 'npm:pi-skills', skills: ['!legacy/**'] },
      'npm:pi-tool-display',
    ],
    extensions: ['-builtin:mcp'],
  }),
};

function demoCliSettingsDocument(file: DemoSettingsFile) {
  const revision = [...file.text].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(16);
  return { path: file.path, format: file.format, exists: true, revision, text: file.text, settings: file.settings };
}

const demoPiPackageMeta: Record<string, { name: string; version: string; description: string }> = {
  'npm:@gotgenes/pi-permission-system': { name: '@gotgenes/pi-permission-system', version: '40.1.2', description: 'Permission policies for Pi' },
  'npm:pi-mcp-adapter': { name: 'pi-mcp-adapter', version: '5.1.0', description: 'MCP adapter' },
  'npm:pi-web-access': { name: 'pi-web-access', version: '0.37.0', description: 'Web search and fetch' },
  'npm:@tintinweb/pi-subagents': { name: '@tintinweb/pi-subagents', version: '0.20.0', description: 'Subagents' },
  'npm:pi-context-prune': { name: 'pi-context-prune', version: '2.1.0', description: 'Context pruning' },
  'npm:pi-cache-optimizer': { name: 'pi-cache-optimizer', version: '1.4.0', description: 'Prompt cache optimizer' },
  'npm:pi-skills': { name: 'pi-skills', version: '0.3.1', description: 'A collection of community skills for Pi' },
  'npm:pi-tool-display': { name: 'pi-tool-display', version: '0.8.0', description: 'Tool output rendering' },
};
const demoPiPluginConfigs: Record<string, SettingsObject | null> = {
  'permission-system': {
    yoloMode: false,
    permission: {
      '*': 'ask',
      bash: { '*': 'allow', 'rm *': 'ask', 'sudo *': { action: 'deny', reason: 'No root on this host' }, 'git push *': 'ask' },
      path_write: { '~/.ssh/*': 'deny', '~/.pi/agent/settings.json': 'ask' },
    },
  },
  'web-access': { provider: 'exa', braveApiKey: '__todex_secret__', tavilyApiKey: '$TAVILY_API_KEY' },
};
let demoPiMcp: SettingsObject | null = {
  mcpServers: {
    context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'], description: 'Library documentation' },
    linear: { url: 'https://mcp.linear.app/mcp', exposure: 'deferred', enabled: false },
  },
};
let demoPiOperation: { id: string; action: 'install' | 'remove'; source: string; status: string; startedAt: string; finishedAt?: string; error?: string } | null = null;

function demoPiPluginList() {
  const file = demoCliSettings.pi;
  const settings = file.settings ?? {};
  const entries = Array.isArray(settings.packages) ? settings.packages : [];
  const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
  const packages = entries.map((entry) => {
    const object = typeof entry === 'object' && entry !== null ? entry as SettingsObject : null;
    const source = object ? String(object.source) : String(entry);
    const disabled = object !== null && Object.keys(object).length === 5 && ['extensions', 'skills', 'prompts', 'themes'].every((kind) => Array.isArray(object[kind]) && (object[kind] as unknown[]).length === 0);
    const meta = demoPiPackageMeta[source];
    return { source, state: object ? (disabled ? 'disabled' : 'filtered') : 'enabled', installedPath: `/home/demo/.pi/agent/npm/node_modules/${meta?.name ?? source.slice(4)}`, ...meta };
  });
  return {
    settingsPath: file.path,
    revision: demoCliSettingsDocument(file).revision,
    packages,
    builtins: ['mcp', 'codemode', 'tool-search', 'llama.cpp'].map((id) => ({ id, enabled: !extensions.includes(`-builtin:${id}`) })),
  };
}

// --- DeepSeek Harness plugins: a few rows of the composed acp profile ------

const DSH_PROFILE_PATCH = '/home/demo/.dsh/profiles/acp/cordis.patch.yml';
const demoDshRows: DshPluginRow[] = [
  ...['session-log-deepseek', 'plugin-package-inventory-deepseek'].map((id): DshPluginRow => ({
    id, name: `@deepseek-ai/dsh-${id}`, state: { kind: 'disabled' }, source: '@deepseek-ai/dsh-base', sourceLayer: 'bundle', patchedBy: ['/home/demo/.todex-agent/providers/deepseek-harness/todex.patch.yml'], locked: true, overridden: false, toggleable: false, configurable: false,
  })),
  { id: 'plugin-manager', name: '@deepseek-ai/dsh-plugin-manager', state: { kind: 'conditional', expression: "!ctx.get('profileContext')" }, source: '@deepseek-ai/dsh-base', sourceLayer: 'bundle', locked: false, overridden: false, toggleable: false, configurable: false },
  ...['tool-todo', 'tool-subagent', 'goal', 'tool-workflow'].map((id): DshPluginRow => ({
    id, name: `@deepseek-ai/dsh-${id}`, state: { kind: 'enabled' }, source: '@deepseek-ai/dsh-base', sourceLayer: 'bundle', locked: false, overridden: false, toggleable: true, configurable: false,
  })),
  { id: 'web', name: '@deepseek-ai/dsh-web', state: { kind: 'enabled' }, source: '@deepseek-ai/dsh-base', sourceLayer: 'bundle', locked: false, overridden: false, toggleable: true, configurable: true },
  { id: 'web-deepseek-api', name: '@deepseek-ai/dsh-web-deepseek-api', state: { kind: 'enabled' }, source: '@deepseek-ai/dsh-base', sourceLayer: 'bundle', locked: false, overridden: false, toggleable: true, configurable: true },
  { id: 'todex-mcp-docs', name: '@deepseek-ai/dsh-mcp-client', state: { kind: 'enabled' }, source: DSH_PROFILE_PATCH, sourceLayer: 'profile', locked: false, overridden: false, toggleable: true, configurable: false },
];
const demoDshPackages: DshPackage[] = [
  { name: '@deepseek-ai/dsh-base', bundle: true, selected: true, builtin: true },
  { name: '@deepseek-ai/dsh-acp-app', bundle: true, selected: true, builtin: true },
  { name: '@deepseek-ai/dsh-subagent-codex', spec: '0.2.1-rc.2', version: '0.2.1-rc.2', description: 'Codex as a dsh subagent provider', bundle: true, selected: true, builtin: false },
];
const demoDshConfigs: Record<string, SettingsObject> = {
  web: { searchProvider: 'deepseek-official', fetchProvider: 'http' },
  'web-deepseek-api': { sendOriginalQuestion: true, baseURL: 'https://api.deepseek.com/v1/tools' },
};
let demoDshRevision = 1;
let demoDshOperation: DshPluginOperation | null = null;

function demoDshPluginList(): DshPluginList {
  return {
    profilePath: DSH_PROFILE_PATCH,
    revision: `dsh-${demoDshRevision}`,
    manifestRevision: `dsh-manifest-${demoDshRevision}`,
    runtimeVersion: '0.2.1-rc.2',
    pnpmAvailable: true,
    rows: demoDshRows,
    packages: demoDshPackages,
    exemptions: [],
  };
}

function demoDshPluginsRoute(method: string, path: string, body: Record<string, unknown>): SecureResponse | null {
  const base = '/v2/providers/deepseek-harness/';
  if (!path.startsWith(base)) return null;
  const rest = path.slice(base.length);
  const conflict = () => json({ error: { code: 'CONFLICT', message: 'changed on disk' } }, 409);
  if (rest === 'plugins' && method === 'GET') return json(demoDshPluginList());
  if (rest === 'plugins/state' && method === 'PUT') {
    if (body.revision !== demoDshPluginList().revision) return conflict();
    const row = demoDshRows.find((item) => item.id === body.id);
    if (!row?.toggleable) return conflict();
    row.state = { kind: body.enabled ? 'enabled' : 'disabled' };
    demoDshRevision += 1;
    return json(demoDshPluginList());
  }
  if (rest === 'plugins/bundles' && method === 'PUT') {
    const pkg = demoDshPackages.find((item) => item.name === body.name);
    if (!pkg || pkg.builtin) return conflict();
    pkg.selected = Boolean(body.enabled);
    demoDshRevision += 1;
    return json(demoDshPluginList());
  }
  if (rest === 'plugins/operations' && method === 'POST') {
    const action = String(body.action) as DshPluginOperation['action'];
    demoDshOperation = { id: `dshpkg_demo_${Date.now()}`, action, source: String(body.source), status: 'running', startedAt: new Date().toISOString() };
    return json(demoDshOperation);
  }
  const operationId = rest.match(/^plugins\/operations\/([^/]+)$/)?.[1];
  if (operationId && method === 'GET') {
    if (!demoDshOperation || demoDshOperation.id !== operationId) return json({ error: { code: 'NOT_FOUND', message: 'operation not found' } }, 404);
    if (demoDshOperation.status === 'running') {
      // The demo finishes an operation on its first poll.
      const { action, source } = demoDshOperation;
      if (action === 'install' && !demoDshPackages.some((item) => item.name === source)) {
        demoDshPackages.push({ name: source, spec: 'latest', bundle: true, selected: true, builtin: false });
      } else if (action === 'remove') {
        demoDshPackages.splice(demoDshPackages.findIndex((item) => item.name === source), 1);
      }
      demoDshRevision += 1;
      demoDshOperation = { ...demoDshOperation, status: 'succeeded', finishedAt: new Date().toISOString() };
    }
    return json(demoDshOperation);
  }
  const plugin = rest.match(/^plugin-config\/([^/]+)$/)?.[1];
  if (plugin && demoDshConfigs[plugin]) {
    const document = () => ({ id: plugin, revision: `dsh-${demoDshRevision}`, config: demoDshConfigs[plugin], overridden: false });
    if (method === 'GET') return json(document());
    if (method === 'PATCH') {
      if (body.revision !== document().revision) return conflict();
      const patch = body.patch as SettingsObject;
      demoDshConfigs[plugin] = { ...demoDshConfigs[plugin], ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)) };
      demoDshRevision += 1;
      return json(document());
    }
  }
  return null;
}

/** `@tintinweb/pi-subagents` templates: front matter written one `key: value` line each (strings as JSON). */
const DEMO_PI_BUILT_IN_SUBAGENTS = ['general-purpose', 'Explore', 'Plan'];
const demoPiSubagentTemplates = new Map<string, { frontMatter: SettingsObject; body: string }>([
  ['auditor', { frontMatter: { display_name: 'Security Auditor', description: 'Reviews code for vulnerabilities', color: 'red', tools: 'read, grep, find, ls', thinking: 'high' }, body: 'You are a security auditor. Report findings with file paths and severity.' }],
]);

function demoPiSubagentTemplateDocument(file: string) {
  const template = demoPiSubagentTemplates.get(file)!;
  const lines = Object.entries(template.frontMatter).map(([name, value]) => `${name}: ${typeof value === 'string' ? JSON.stringify(value) : String(value)}`);
  const content = `${lines.length ? `---\n${lines.join('\n')}\n---\n\n` : ''}${template.body}\n`;
  return { file, path: `/home/demo/.pi/agent/agents/${file}.md`, revision: demoRevision(content), content, frontMatter: template.frontMatter, body: template.body };
}

function demoPiSubagentTemplateList() {
  const isStub = (file: string) => {
    const template = demoPiSubagentTemplates.get(file)!;
    return DEMO_PI_BUILT_IN_SUBAGENTS.includes(file) && !template.body && Object.keys(template.frontMatter).length === 1 && template.frontMatter.enabled === false;
  };
  const templates = [...demoPiSubagentTemplates.keys()].filter((file) => !isStub(file)).sort().map((file) => {
    const { frontMatter } = demoPiSubagentTemplates.get(file)!;
    const text = (name: string) => (typeof frontMatter[name] === 'string' && frontMatter[name] ? frontMatter[name] as string : undefined);
    const name = text('name') ?? file;
    return { file, name, displayName: text('display_name'), description: text('description'), color: text('color'), model: text('model'), enabled: frontMatter.enabled !== false, overridesBuiltIn: DEMO_PI_BUILT_IN_SUBAGENTS.includes(name) };
  });
  const builtIns = DEMO_PI_BUILT_IN_SUBAGENTS.map((name) => {
    const overriding = templates.find((template) => template.name === name);
    if (overriding) return { name, state: 'overridden' as const, file: overriding.file };
    return demoPiSubagentTemplates.has(name) && isStub(name) ? { name, state: 'disabled' as const, file: name } : { name, state: 'enabled' as const };
  });
  return { dir: '/home/demo/.pi/agent/agents', templates, builtIns };
}

/** Parses the demo's own `key: value` front matter; enough for text typed in the source view. */
function demoParseTemplate(content: string): { frontMatter: SettingsObject; body: string } {
  const match = content.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) return { frontMatter: {}, body: content.trim() };
  const frontMatter: SettingsObject = {};
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const raw = line.slice(at + 1).trim();
    let value: unknown = raw;
    try { value = JSON.parse(raw); } catch { /* a bare string */ }
    if (raw !== '') frontMatter[line.slice(0, at).trim()] = value;
  }
  return { frontMatter, body: match[2].trim() };
}

function demoPiSubagentTemplatesRoute(method: string, path: string, body: Record<string, unknown>): SecureResponse | null {
  const base = '/v2/providers/pi/subagent-templates';
  const conflict = (message: string) => json({ error: { code: 'CONFLICT', message } }, 409);
  const notFound = (file: string) => json({ error: { code: 'NOT_FOUND', message: `${file}.md does not exist` } }, 404);
  const input = (previous?: SettingsObject) => (typeof body.content === 'string'
    ? demoParseTemplate(body.content)
    : { frontMatter: applyMergePatch(previous ?? {}, body.frontMatter as SettingsObject), body: String(body.body ?? '').trim() });
  if (path === base && method === 'GET') return json(demoPiSubagentTemplateList());
  if (path === base && method === 'POST') {
    const file = String(body.file);
    if (demoPiSubagentTemplates.has(file)) return conflict(`${file}.md already exists`);
    demoPiSubagentTemplates.set(file, input());
    return json(demoPiSubagentTemplateDocument(file));
  }
  const builtIn = path.startsWith(`${base}/built-ins/`) ? decodeURIComponent(path.slice(`${base}/built-ins/`.length)) : null;
  if (builtIn !== null && method === 'PUT') {
    const state = demoPiSubagentTemplateList().builtIns.find((item) => item.name === builtIn);
    if (!state) return notFound(builtIn);
    if (state.state === 'overridden') return conflict(`${builtIn} is replaced by ${state.file}.md`);
    if (body.enabled) demoPiSubagentTemplates.delete(builtIn);
    else demoPiSubagentTemplates.set(builtIn, { frontMatter: { enabled: false }, body: '' });
    return json(demoPiSubagentTemplateList());
  }
  const file = path.startsWith(`${base}/`) ? decodeURIComponent(path.slice(base.length + 1)) : null;
  if (file === null) return null;
  if (!demoPiSubagentTemplates.has(file)) return notFound(file);
  if (method === 'GET') return json(demoPiSubagentTemplateDocument(file));
  if (method === 'PUT') {
    if (body.revision !== demoPiSubagentTemplateDocument(file).revision) return conflict(`${file}.md changed on disk`);
    demoPiSubagentTemplates.set(file, input(demoPiSubagentTemplates.get(file)!.frontMatter));
    return json(demoPiSubagentTemplateDocument(file));
  }
  if (method === 'DELETE') {
    demoPiSubagentTemplates.delete(file);
    return json({ file });
  }
  return null;
}

function demoPiPluginsRoute(method: string, path: string, body: Record<string, unknown>): SecureResponse | null {
  const file = demoCliSettings.pi;
  const save = (settings: SettingsObject) => Object.assign(file, demoSettingsFile(file.path, 'json', settings));
  if (path === '/v2/providers/pi/plugins' && method === 'GET') return json(demoPiPluginList());
  if (path === '/v2/providers/pi/plugins/state' && method === 'PUT') {
    if (body.revision !== demoPiPluginList().revision) return json({ error: { code: 'CONFLICT', message: 'settings changed on disk' } }, 409);
    const settings = { ...(file.settings ?? {}) };
    if (typeof body.builtin === 'string') {
      const off = `-builtin:${body.builtin}`;
      const extensions = (Array.isArray(settings.extensions) ? settings.extensions : []).filter((entry) => entry !== off && entry !== `+builtin:${body.builtin}`);
      settings.extensions = body.enabled ? extensions : [...extensions, off];
    } else {
      const source = String(body.source);
      settings.packages = (Array.isArray(settings.packages) ? settings.packages : []).map((entry) => {
        const entrySource = typeof entry === 'object' && entry !== null ? (entry as SettingsObject).source : entry;
        if (entrySource !== source) return entry;
        return body.enabled ? source : { source, extensions: [], skills: [], prompts: [], themes: [] };
      });
    }
    save(settings);
    return json(demoPiPluginList());
  }
  if (path === '/v2/providers/pi/plugins/operations' && method === 'POST') {
    demoPiOperation = { id: `pipkg_demo_${Date.now()}`, action: body.action === 'remove' ? 'remove' : 'install', source: String(body.source), status: 'running', startedAt: new Date().toISOString() };
    return json(demoPiOperation);
  }
  const operationId = path.match(/^\/v2\/providers\/pi\/plugins\/operations\/([^/]+)$/)?.[1];
  if (operationId && method === 'GET') {
    if (!demoPiOperation || demoPiOperation.id !== operationId) return json({ error: { code: 'NOT_FOUND', message: 'operation not found' } }, 404);
    if (demoPiOperation.status === 'running') {
      // The demo finishes an operation on its first poll.
      const { action, source } = demoPiOperation;
      const settings = { ...(file.settings ?? {}) };
      const entries = Array.isArray(settings.packages) ? settings.packages : [];
      const sourceOf = (entry: unknown) => (typeof entry === 'object' && entry !== null ? (entry as SettingsObject).source : entry);
      settings.packages = action === 'install' ? [...entries.filter((entry) => sourceOf(entry) !== source), source] : entries.filter((entry) => sourceOf(entry) !== source);
      save(settings);
      demoPiOperation = { ...demoPiOperation, status: 'succeeded', finishedAt: new Date().toISOString() };
    }
    return json(demoPiOperation);
  }
  const plugin = path.match(/^\/v2\/providers\/pi\/plugin-config\/([^/]+)$/)?.[1];
  if (plugin) {
    const stored = demoPiPluginConfigs[plugin] ?? null;
    const document = () => {
      const current = demoPiPluginConfigs[plugin] ?? null;
      const text = current ? JSON.stringify(current) : null;
      return { plugin, path: `/home/demo/.pi/agent/${plugin}.json`, exists: current !== null, revision: demoRevision(text), settings: current ?? {} };
    };
    if (method === 'GET') return json(document());
    if (method === 'PATCH') {
      if (body.revision !== document().revision) return json({ error: { code: 'CONFLICT', message: 'settings changed on disk' } }, 409);
      let next = applyMergePatch(stored ?? {}, body.patch as SettingsObject);
      for (const replacePath of Array.isArray(body.replace) ? body.replace as string[][] : []) {
        let value: unknown = body.patch;
        for (const key of replacePath) value = (value as SettingsObject | undefined)?.[key];
        next = setAt(next, replacePath, value);
      }
      demoPiPluginConfigs[plugin] = next;
      return json(document());
    }
  }
  const templates = demoPiSubagentTemplatesRoute(method, path, body);
  if (templates) return templates;
  if (path === '/v2/providers/pi/mcp') {
    const document = () => {
      const text = demoPiMcp ? JSON.stringify(demoPiMcp) : null;
      const list = demoPiPluginList();
      return {
        path: '/home/demo/.pi/agent/mcp.json',
        exists: demoPiMcp !== null,
        revision: demoRevision(text),
        config: demoPiMcp ?? {},
        builtinEnabled: list.builtins.some((builtin) => builtin.id === 'mcp' && builtin.enabled),
        adapterInstalled: list.packages.some((pkg) => pkg.source.includes('pi-mcp-adapter') && pkg.state !== 'disabled'),
      };
    };
    if (method === 'GET') return json(document());
    if (method === 'PATCH') {
      if (body.revision !== document().revision) return json({ error: { code: 'CONFLICT', message: 'mcp.json changed on disk' } }, 409);
      const patch = body.patch as SettingsObject;
      const next: SettingsObject = { ...(demoPiMcp ?? {}) };
      const servers = { ...(next.mcpServers as SettingsObject | undefined) };
      for (const [name, entry] of Object.entries((patch.mcpServers as SettingsObject | undefined) ?? {})) {
        if (entry === null) delete servers[name];
        else servers[name] = entry;
      }
      if (patch.mcpServers) next.mcpServers = servers;
      if (patch.autoEnableCodemode === null) delete next.autoEnableCodemode;
      else if (patch.autoEnableCodemode !== undefined) next.autoEnableCodemode = patch.autoEnableCodemode;
      demoPiMcp = next;
      return json(document());
    }
  }
  return null;
}

type DemoInstructionPreset = { id: string; name: string; text: string; revision: number; updatedAt: number };
const demoInstructionFiles: Record<string, { path: string; text: string | null; presetId?: string; written?: string }> = {
  'claude-code': { path: '/home/demo/.claude/CLAUDE.md', text: '# Personal rules\n\n- Answer in Chinese.\n- Prefer pnpm.\n' },
  codex: { path: '/home/demo/.codex/AGENTS.md', text: null },
  pi: { path: '/home/demo/.pi/agent/AGENTS.md', text: null },
  'deepseek-harness': { path: '/home/demo/.dsh/AGENTS.md', text: null },
};
let demoInstructionPresets: DemoInstructionPreset[] = [
  { id: 'demo-preset-team', name: 'Team defaults', text: '# Team defaults\n\n- Run the tests before committing.\n- Keep commits small.\n', revision: 1, updatedAt: Date.now() },
];

const demoRevision = (text: string | null) => (text === null ? 'missing' : [...text].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(16));

function demoInstructionsDocument(provider: string) {
  const file = demoInstructionFiles[provider];
  const revision = demoRevision(file.text);
  return { path: file.path, exists: file.text !== null, revision, text: file.text ?? '', presetId: file.presetId, drifted: Boolean(file.presetId) && file.written !== revision };
}

function demoPresetView(preset: DemoInstructionPreset) {
  return { ...preset, usedBy: Object.keys(demoInstructionFiles).filter((provider) => demoInstructionFiles[provider].presetId === preset.id) };
}

function demoInstructionsRoute(method: string, path: string, body: Record<string, unknown>): SecureResponse | undefined {
  const conflict = () => json({ error: { code: 'CONFLICT', message: 'changed on disk' } }, 409);
  const fileMatch = path.match(/^\/v2\/providers\/(claude-code|codex|pi|deepseek-harness)\/instructions(\/source)?$/);
  if (fileMatch) {
    const [, provider, source] = fileMatch;
    const file = demoInstructionFiles[provider];
    if (method === 'GET' && !source) return json(demoInstructionsDocument(provider));
    if (method !== 'PUT') return undefined;
    if (body.revision !== demoRevision(file.text)) return conflict();
    if (!source) {
      file.text = String(body.text);
      file.presetId = undefined;
    } else if (typeof body.presetId === 'string') {
      const preset = demoInstructionPresets.find((item) => item.id === body.presetId);
      if (!preset) return json({ error: { code: 'NOT_FOUND', message: 'instruction preset not found' } }, 404);
      file.text = preset.text;
      file.presetId = preset.id;
      file.written = demoRevision(preset.text);
    } else {
      file.presetId = undefined;
    }
    return json(demoInstructionsDocument(provider));
  }
  if (path === '/v2/instruction-presets') {
    if (method === 'GET') return json({ presets: demoInstructionPresets.map(demoPresetView) });
    if (method === 'POST') {
      const preset = { id: `demo-preset-${Date.now()}`, name: String(body.name).trim(), text: String(body.text), revision: 1, updatedAt: Date.now() };
      demoInstructionPresets.push(preset);
      return json(demoPresetView(preset), 201);
    }
    return undefined;
  }
  const presetMatch = path.match(/^\/v2\/instruction-presets\/([^/]+)$/);
  const preset = presetMatch ? demoInstructionPresets.find((item) => item.id === decodeURIComponent(presetMatch[1])) : undefined;
  if (!presetMatch) return undefined;
  if (!preset) return json({ error: { code: 'NOT_FOUND', message: 'instruction preset not found' } }, 404);
  if (method === 'DELETE') {
    demoInstructionPresets = demoInstructionPresets.filter((item) => item !== preset);
    for (const file of Object.values(demoInstructionFiles)) if (file.presetId === preset.id) file.presetId = undefined;
    return { status: 204, headers: {}, body: new Uint8Array() };
  }
  if (method !== 'PUT') return undefined;
  if (body.revision !== preset.revision) return conflict();
  const textChanged = preset.text !== body.text;
  Object.assign(preset, { name: String(body.name).trim(), text: String(body.text), revision: preset.revision + 1, updatedAt: Date.now() });
  const sync = textChanged ? Object.entries(demoInstructionFiles).filter(([, file]) => file.presetId === preset.id).map(([provider, file]) => {
    if (demoRevision(file.text) !== file.written) return { provider, status: 'drifted' };
    file.text = preset.text;
    file.written = demoRevision(file.text);
    return { provider, status: 'updated' };
  }) : [];
  return json({ preset: demoPresetView(preset), sync });
}

function demoCleanupPolicy() {
  return { policy: cleanupPolicy, lastRun: null, nextRunAt: cleanupPolicy.enabled ? new Date(Date.now() + 3_600_000).toISOString() : null };
}

type DemoNativeSession = { id: string; title: string | null; cwd: string | null; createdAt: string | null; updatedAt: string; bytes: number | null; referencedBy: string[]; running: boolean };
const DAY = 86_400_000;
const demoNativeAt = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const demoNativeSessions: Record<string, DemoNativeSession[]> = {
  'claude-code': [
    { id: '0f9d6c1e-7a1b-4c55-9e1a-3c1b2a4d5e60', title: '重构结账页表单校验', cwd: `${fixtures.DEMO_ROOT}/lumen-web`, createdAt: demoNativeAt(1), updatedAt: demoNativeAt(0.1), bytes: 4_800_000, referencedBy: ['demo-conversation'], running: false },
    { id: '2b7e1d0c-4f3a-4e2b-8c9d-1a2b3c4d5e6f', title: '排查 Safari 下商品卡片抖动', cwd: `${fixtures.DEMO_ROOT}/lumen-web`, createdAt: demoNativeAt(0.2), updatedAt: demoNativeAt(0.01), bytes: 1_200_000, referencedBy: [], running: true },
    { id: '5c4b3a29-1807-4f6e-9d5c-4b3a29180716', title: '升级 Vite 到 7', cwd: `${fixtures.DEMO_ROOT}/infra-scripts`, createdAt: demoNativeAt(40), updatedAt: demoNativeAt(38), bytes: 9_600_000, referencedBy: [], running: false },
    { id: '7d6e5f40-3a2b-4c1d-8e9f-0a1b2c3d4e5f', title: null, cwd: `${fixtures.DEMO_ROOT}/lumen-api`, createdAt: demoNativeAt(12), updatedAt: demoNativeAt(11), bytes: 310_000, referencedBy: [], running: false },
  ],
  pi: [
    { id: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d', title: '整理 design-tokens 命名', cwd: `${fixtures.DEMO_ROOT}/design-tokens`, createdAt: demoNativeAt(3), updatedAt: demoNativeAt(2), bytes: 420_000, referencedBy: [], running: false },
    { id: 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e', title: '为订单列表加分页', cwd: `${fixtures.DEMO_ROOT}/lumen-web`, createdAt: demoNativeAt(20), updatedAt: demoNativeAt(19), bytes: 880_000, referencedBy: ['demo-conversation-2'], running: false },
  ],
  codex: [
    { id: '019a1b2c-3d4e-7f50-8a6b-7c8d9e0f1a2b', title: '修复 CI 中的 flaky 测试', cwd: `${fixtures.DEMO_ROOT}/lumen-api`, createdAt: demoNativeAt(6), updatedAt: demoNativeAt(5), bytes: 2_300_000, referencedBy: [], running: false },
    { id: '019a1b2c-3d4e-7f50-8a6b-7c8d9e0f1a2c', title: '给支付回调加幂等', cwd: `${fixtures.DEMO_ROOT}/lumen-api`, createdAt: demoNativeAt(2), updatedAt: demoNativeAt(1), bytes: 760_000, referencedBy: ['demo-conversation-3'], running: false },
  ],
  'grok-build': [],
  devin: [
    { id: 'brisk-otter', title: '梳理部署脚本', cwd: `${fixtures.DEMO_ROOT}/infra-scripts`, createdAt: demoNativeAt(9), updatedAt: demoNativeAt(8), bytes: null, referencedBy: [], running: false },
    { id: 'quiet-heron', title: '补充 README', cwd: `${fixtures.DEMO_ROOT}/design-tokens`, createdAt: demoNativeAt(30), updatedAt: demoNativeAt(29), bytes: null, referencedBy: [], running: false },
  ],
};
const DEMO_NATIVE_ROOTS: Record<string, string> = {
  'claude-code': '/home/demo/.claude/projects',
  pi: '/home/demo/.pi/agent/sessions',
  codex: '/home/demo/.codex/sessions',
  'grok-build': '/home/demo/.grok/sessions',
  devin: '/home/demo/.local/share/devin/cli/sessions.db',
};
const demoNativePolicies: Record<string, typeof cleanupPolicy> = {
  'claude-code': { enabled: false, maxAgeDays: null, maxTotalBytes: null },
  pi: { enabled: false, maxAgeDays: null, maxTotalBytes: null },
  codex: { enabled: false, maxAgeDays: null, maxTotalBytes: null },
  'grok-build': { enabled: false, maxAgeDays: null, maxTotalBytes: null },
  devin: { enabled: false, maxAgeDays: null, maxTotalBytes: null },
};
let demoClaudeRetention: number | null = 30;

function demoNativeList(provider: string) {
  const sessions = demoNativeSessions[provider] ?? [];
  const totalBytes = provider === 'devin' ? 18_400_000 : sessions.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  return { provider, root: DEMO_NATIVE_ROOTS[provider] ?? null, totalBytes, count: sessions.length, measuredAt: new Date().toISOString(), sessions };
}

function demoNativePolicy(provider: string) {
  const policy = demoNativePolicies[provider];
  return { policy, lastRun: null, nextRunAt: policy.enabled ? new Date(Date.now() + 3_600_000).toISOString() : null };
}

function demoNativeDelete(provider: string, ids: string[]) {
  const sessions = demoNativeSessions[provider] ?? [];
  const deleted: string[] = [];
  const skipped: Array<{ conversationId: string; code: string; message: string }> = [];
  let freedBytes = 0;
  for (const id of ids) {
    const index = sessions.findIndex((item) => item.id === id);
    if (index < 0) continue;
    const item = sessions[index];
    if (item.running || item.referencedBy.length > 0) {
      skipped.push({ conversationId: id, code: 'CONFLICT', message: 'session is in use' });
      continue;
    }
    freedBytes += item.bytes ?? 0;
    sessions.splice(index, 1);
    deleted.push(id);
  }
  return { deleted, skipped, freedBytes };
}

function demoDelete(ids: string[]) {
  const deleted: string[] = [];
  let freedBytes = 0;
  for (const id of ids) {
    const journal = journals.get(id);
    if (!journal) continue;
    freedBytes += demoConversationBytes(journal);
    journals.delete(id);
    deleted.push(id);
  }
  return { deleted, skipped: [], freedBytes };
}
let agentDesktop = { ...fixtures.demoAgentDesktop };

// Agent Calling: settings as the daemon reports them; listener changes only
// take effect "after a restart", so they leave `listening`/`baseUrl` alone.
const demoListenerRunning = { enabled: true, port: 7346 };
let agentCalling: AgentCallingSettings = {
  scope: { agents: null, models: {} },
  mcp: { enabled: true, approval: 'ask', injected: true },
  apiListener: { enabled: true, host: '127.0.0.1', port: 7346, listening: true, baseUrl: 'http://127.0.0.1:7346/api/v1', pendingRestart: false },
  limits: { maxConcurrentCalls: 4, maxWaitSecs: 1200, defaultWaitSecs: 300 },
};
let apiKeys: ApiKeySummary[] = [
  { id: '3f9c2a7d1b6e4c08', name: 'CI 脚本', prefix: 'tdx_3f9c2a7d1b6e4c08', status: 'active', scopes: { agents: ['codex'], workspaces: [fixtures.DEMO_ROOT] },
    approval: 'auto-approve', createdAt: Date.now() - 12 * 86_400_000, expiresAt: Date.now() + 78 * 86_400_000, lastUsedAt: Date.now() - 3_600_000, revokedAt: null },
  { id: '8a01d55e2f3b9c47', name: '旧笔记本', prefix: 'tdx_8a01d55e2f3b9c47', status: 'revoked', scopes: {},
    approval: 'ask', createdAt: Date.now() - 90 * 86_400_000, expiresAt: null, lastUsedAt: Date.now() - 40 * 86_400_000, revokedAt: Date.now() - 30 * 86_400_000 },
];

function demoAgentCallingUpdate(body: Record<string, unknown>): SecureResponse {
  const scope = body.scope as AgentCallingSettings['scope'] | undefined;
  if (scope && Object.values(scope.models ?? {}).some((models) => !Array.isArray(models) || !models.length)) {
    return json({ error: { code: 'INVALID_REQUEST', message: 'scope.models lists must not be empty' } }, 400);
  }
  const mcpUpdate = (body.mcp ?? {}) as Partial<AgentCallingSettings['mcp']>;
  const nextScope = scope ?? agentCalling.scope;
  const mcpEnabled = typeof mcpUpdate.enabled === 'boolean' ? mcpUpdate.enabled : agentCalling.mcp.enabled;
  agentCalling = {
    ...agentCalling,
    scope: nextScope,
    mcp: {
      enabled: mcpEnabled,
      approval: mcpUpdate.approval ?? agentCalling.mcp.approval,
      injected: mcpEnabled && (nextScope.agents === null || nextScope.agents.length > 0),
    },
  };
  return json(agentCalling);
}

function demoApiListenerUpdate(body: Record<string, unknown>): SecureResponse {
  const port = typeof body.port === 'number' ? body.port : agentCalling.apiListener.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 7345) {
    return json({ error: { code: 'INVALID_REQUEST', message: 'port must be 1-65535 and differ from the main listener' } }, 400);
  }
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : agentCalling.apiListener.enabled;
  agentCalling = {
    ...agentCalling,
    apiListener: { ...agentCalling.apiListener, enabled, port,
      pendingRestart: enabled !== demoListenerRunning.enabled || port !== demoListenerRunning.port },
  };
  return json(agentCalling);
}

function demoApiKeysRoute(method: string, path: string, body: Record<string, unknown>): SecureResponse | null {
  if (path === '/v2/api-keys' && method === 'POST') {
    const id = [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const secret = [...crypto.getRandomValues(new Uint8Array(24))].map((byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 43);
    const key: ApiKeySummary = {
      id, name: String(body.name ?? '').trim() || 'key', prefix: `tdx_${id}`, status: 'active',
      scopes: (body.scopes ?? {}) as ApiKeySummary['scopes'], approval: (body.approval ?? 'ask') as ApiKeySummary['approval'],
      createdAt: Date.now(), expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : null, lastUsedAt: null, revokedAt: null,
    };
    apiKeys = [key, ...apiKeys];
    return json({ ...key, key: `tdx_${id}_${secret}` }, 201);
  }
  const match = path.match(/^\/v2\/api-keys\/([^/]+)$/);
  const key = match ? apiKeys.find((item) => item.id === decodeURIComponent(match[1])) : undefined;
  if (!match || (method !== 'PATCH' && method !== 'DELETE')) return null;
  if (!key) return json({ error: { code: 'NOT_FOUND', message: 'api key not found' } }, 404);
  if (method === 'DELETE') {
    apiKeys = apiKeys.map((item) => (item.id === key.id ? { ...item, status: 'revoked', revokedAt: Date.now() } : item));
    return json({ id: key.id, revoked: key.status !== 'revoked' });
  }
  const next: ApiKeySummary = {
    ...key,
    ...(typeof body.name === 'string' ? { name: body.name.trim() } : {}),
    ...(body.scopes ? { scopes: body.scopes as ApiKeySummary['scopes'] } : {}),
    ...(typeof body.approval === 'string' ? { approval: body.approval as ApiKeySummary['approval'] } : {}),
    ...('expiresAt' in body ? { expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : null } : {}),
  };
  next.status = next.revokedAt ? 'revoked' : next.expiresAt && next.expiresAt <= Date.now() ? 'expired' : 'active';
  apiKeys = apiKeys.map((item) => (item.id === key.id ? next : item));
  return json(next);
}
const sockets = new Set<DemoSocket>();

function json(value: unknown, status = 200): SecureResponse {
  return { status, headers: { 'content-type': 'application/json' }, body: encoder.encode(JSON.stringify(value)) };
}

function notFound(method: string, path: string): SecureResponse {
  console.info(`[demo] ${method} ${path} is not part of the preview`);
  return json({ error: { code: 'NOT_FOUND', message: `${path} is not available in the demo preview` } }, 404);
}

function readBody(request: SecureRequest): Record<string, unknown> {
  if (!request.body) return {};
  try {
    const text = typeof request.body === 'string' ? request.body : decoder.decode(request.body);
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readQuery(request: SecureRequest, url: URL): URLSearchParams {
  const { query } = request;
  if (!query) return url.searchParams;
  if (typeof query === 'string') return new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  return new URLSearchParams(query);
}

function replay(journal: Journal, query: URLSearchParams) {
  const limit = Number(query.get('limit')) || 200;
  const before = query.get('beforeSequence');
  if (before !== null) {
    const events = journal.events.filter((event) => event.sequence <= Number(before)).slice(-limit);
    const first = events[0]?.sequence ?? Number(before) + 1;
    return { conversationId: journal.manifest.id, fromSequence: first, nextSequence: (events.at(-1)?.sequence ?? Number(before)) + 1, hasMore: first > 1, events };
  }
  const after = Number(query.get('afterSequence')) || 0;
  const events = journal.events.filter((event) => event.sequence > after).slice(0, limit);
  // An empty page leaves the cursor where it was; it is not a gap.
  const last = events.at(-1)?.sequence ?? after;
  return { conversationId: journal.manifest.id, fromSequence: after + 1, nextSequence: last + 1, hasMore: last < journal.events.length, events };
}

type DemoCatalog = {
  skills: SkillCatalog;
  mcp: McpCatalog;
  contents: Map<string, string>;
  configs: Map<string, unknown>;
};

// Per-provider copies so created, edited and deleted items stick for the tab.
const catalogs = new Map<ProviderKind, DemoCatalog>();

function demoCatalog(provider: ProviderKind): DemoCatalog {
  let catalog = catalogs.get(provider);
  if (!catalog) {
    const skills = fixtures.demoSkills(provider);
    const mcp = fixtures.demoMcp(provider);
    catalog = {
      skills: { ...skills, editable: true, creatableSources: ['shared-user', 'provider-user', 'shared-project', 'provider-project'] },
      mcp: { ...mcp, editable: true, creatableScopes: ['user', 'project'] },
      contents: new Map(skills.skills.map((skill) => [skill.resourceId, `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n\n演示数据，不会发送到任何后端。\n`])),
      configs: new Map(mcp.servers.map((server) => [server.resourceId, server.transport === 'http'
        ? { type: 'http', url: `https://mcp.example.com/${server.name}` }
        : { command: 'npx', args: ['-y', `${server.name}-mcp`] }])),
    };
    catalogs.set(provider, catalog);
  }
  return catalog;
}

function catalogRoute(method: string, path: string, provider: ProviderKind, body: Record<string, unknown>): SecureResponse {
  const catalog = demoCatalog(provider);
  const mcpConfig = (server: McpServerCatalogDescriptor) => ({
    descriptor: server,
    path: server.scope === 'user' ? '~/.claude.json' : '.mcp.json',
    format: 'json',
    config: catalog.configs.get(server.resourceId) ?? {},
  });
  const descriptionOf = (content: string) => /^description:[ \t]*(.*)$/m.exec(content)?.[1]?.trim() ?? '';
  if (path === '/v2/catalog/skills') {
    if (method === 'GET') return json(catalog.skills);
    const name = String(body.name ?? '');
    const content = String(body.content ?? '');
    const source = String(body.source ?? 'provider-project');
    const skill: SkillCatalogDescriptor = {
      resourceId: `${provider}:skill:${name}:${Date.now()}`,
      name,
      description: descriptionOf(content),
      scope: source.endsWith('user') ? 'user' : 'project',
      source,
      active: true,
      valid: true,
    };
    catalog.skills = { ...catalog.skills, skills: [...catalog.skills.skills, skill] };
    catalog.contents.set(skill.resourceId, content);
    return json(skill);
  }
  if (path === '/v2/catalog/mcp') {
    if (method === 'GET') return json(catalog.mcp);
    const name = String(body.name ?? '');
    const config = body.config as Record<string, unknown> | undefined;
    const server: McpServerCatalogDescriptor = {
      resourceId: `${provider}:mcp:${name}:${Date.now()}`,
      name,
      provider,
      scope: body.scope === 'user' ? 'user' : 'project',
      source: body.scope === 'user' ? 'claude-user' : 'claude-project',
      transport: config && 'url' in config ? 'http' : 'stdio',
      enabled: true,
      active: true,
    };
    catalog.mcp = { ...catalog.mcp, servers: [...catalog.mcp.servers, server] };
    catalog.configs.set(server.resourceId, config ?? {});
    return json(mcpConfig(server));
  }
  const skillMatch = path.match(/^\/v2\/catalog\/skills\/(.+)$/);
  const skill = skillMatch && catalog.skills.skills.find((item) => item.resourceId === decodeURIComponent(skillMatch[1]));
  if (skill) {
    if (method === 'GET') return json({ resourceId: skill.resourceId, content: catalog.contents.get(skill.resourceId) ?? '' });
    if (method === 'DELETE') {
      catalog.skills = { ...catalog.skills, skills: catalog.skills.skills.filter((item) => item !== skill) };
      return json({ resourceId: skill.resourceId, name: skill.name, path: skill.source });
    }
    const content = String(body.content ?? '');
    const updated = { ...skill, description: descriptionOf(content) };
    catalog.skills = { ...catalog.skills, skills: catalog.skills.skills.map((item) => item === skill ? updated : item) };
    catalog.contents.set(skill.resourceId, content);
    return json(updated);
  }
  const mcpMatch = path.match(/^\/v2\/catalog\/mcp\/(.+)$/);
  const server = mcpMatch && catalog.mcp.servers.find((item) => item.resourceId === decodeURIComponent(mcpMatch[1]));
  if (server) {
    if (method === 'GET') return json(mcpConfig(server));
    if (method === 'DELETE') {
      catalog.mcp = { ...catalog.mcp, servers: catalog.mcp.servers.filter((item) => item !== server) };
      return json({ resourceId: server.resourceId, name: server.name, path: mcpConfig(server).path });
    }
    const config = body.config as Record<string, unknown> | undefined;
    const updated = { ...server, name: String(body.name ?? server.name), transport: config && 'url' in config ? 'http' as const : 'stdio' as const };
    catalog.mcp = { ...catalog.mcp, servers: catalog.mcp.servers.map((item) => item === server ? updated : item) };
    catalog.configs.set(server.resourceId, config ?? {});
    return json(mcpConfig(updated));
  }
  return notFound(method, path);
}

function route(request: SecureRequest): SecureResponse {
  const method = request.method.toUpperCase();
  const url = new URL(request.path, fixtures.DEMO_SERVER_URL);
  const path = url.pathname;
  const query = readQuery(request, url);
  const provider = (query.get('provider') ?? 'claude-code') as ProviderKind;
  const now = new Date().toISOString();

  if (path.startsWith('/v2/catalog/')) return catalogRoute(method, path, provider, readBody(request));
  const settingsFile = demoCliSettings[path.match(/^\/v2\/providers\/([^/]+)\/settings$/)?.[1] ?? ''];
  if (settingsFile && method === 'GET') return json(demoCliSettingsDocument(settingsFile));
  const instructionsResponse = demoInstructionsRoute(method, path, readBody(request));
  if (instructionsResponse) return instructionsResponse;
  const piPluginsResponse = demoPiPluginsRoute(method, path, readBody(request));
  if (piPluginsResponse) return piPluginsResponse;
  const dshPluginsResponse = demoDshPluginsRoute(method, path, readBody(request));
  if (dshPluginsResponse) return dshPluginsResponse;

  if (method === 'GET') {
    switch (path) {
      case '/health':
        return json({ status: 'ok' });
      case '/v2/transport-policy':
        return json({ requiredProtocol: 'none' });
      case '/v2/version':
        return json({ name: 'todex-agentd', version: '2.2.0', data_dir: '/home/demo/.todex-agent', workspace_root: fixtures.DEMO_ROOT, scratch_workspace_root: '/home/demo/.todex-agent/workspace' });
      case '/v2/providers':
        return json({ providers: fixtures.demoProviders });
      case '/v2/providers/models':
        return json({ provider, models: fixtures.demoModels[provider] ?? [], source: 'demo', fetchedAt: now });
      case '/v2/providers/image-input':
        return json({ provider, imageInput: true, source: 'demo' });
      case '/v2/providers/commands':
        return json({
          provider,
          source: 'demo',
          fetchedAt: now,
          commands: [
            { name: 'review', description: '审查当前改动', source: 'builtin', invocation: '/review' },
            { name: 'compact', description: '压缩上下文', source: 'builtin', invocation: '/compact' },
          ],
        });
      case '/v2/providers/quota':
        return json(fixtures.demoQuota);
      case '/v2/providers/versions':
        return json(fixtures.demoCliVersions);
      case '/v2/agent-providers':
        return json(fixtures.demoAgentProviders);
      case '/v2/workspaces':
        return json({ workspaces });
      case '/v2/conversations':
        // Agent Calling children are listed only on request, like the daemon.
        return json({ conversations: [...journals.values()].map((journal) => journal.manifest)
          .filter((manifest) => query.get('includeChildren') === 'true' || !manifest.parentConversationId) });
      case '/v2/agent-calling':
        return json(agentCalling);
      case '/v2/api-keys':
        return json({ keys: apiKeys });
      case '/v2/kanban/tasks':
        return json({ tasks: kanbanTasks });
      case '/v2/history/storage': {
        const conversations = [...journals.values()].map((journal) => ({ ...journal.manifest, bytes: demoConversationBytes(journal) }));
        return json({ totalBytes: conversations.reduce((sum, entry) => sum + entry.bytes, 0), count: conversations.length, measuredAt: now, conversations });
      }
      case '/v2/history/cleanup-policy':
        return json(demoCleanupPolicy());
      case '/v2/native-history/providers':
        return json({ providers: (['claude-code', 'pi', 'codex', 'grok-build', 'devin'] as const).map((id) => {
          const list = demoNativeList(id);
          return {
            provider: id, available: id !== 'grok-build', root: list.root, sessionCount: list.count, totalBytes: list.totalBytes, measuredAt: list.measuredAt,
            capabilities: { view: id !== 'devin', sizes: id !== 'devin' },
            native: id === 'claude-code' ? { cleanupPeriodDays: demoClaudeRetention, settingsPath: '/home/demo/.claude/settings.json' } : null,
          };
        }) });
      case '/v2/native-history/claude-code/native-retention':
        return json({ cleanupPeriodDays: demoClaudeRetention, settingsPath: '/home/demo/.claude/settings.json' });
      case '/v2/agent-desktop':
        return json(agentDesktop);
      case '/v2/agent-browser/profiles':
        return json({ profiles: [{ id: 'default', name: '默认资料', createdAt: Date.now() }], workspaces: {} });
      case '/v2/git/workspace':
        return json(fixtures.demoGitWorkspace(query.get('workspacePath') ?? ''));
      case '/v2/git/status':
        return json(fixtures.demoGitStatus(query.get('workspacePath') ?? ''));
      case '/v2/workspace/entries':
        return json(fixtures.demoWorkspaceEntries(query.get('cwd') ?? ''));
      case '/v2/workspace/file':
        return json(fixtures.demoWorkspaceFile(query.get('path') ?? ''));
      case '/v2/git/scan':
        return json(fixtures.demoGitScan(query.get('workspacePath') ?? ''));
      default:
        break;
    }
    const conversation = path.match(/^\/v2\/conversations\/([^/]+)(\/events)?$/);
    const journal = conversation ? journals.get(decodeURIComponent(conversation[1])) : undefined;
    if (journal) return json(conversation?.[2] ? replay(journal, query) : journal.manifest);
    const nativeList = path.match(/^\/v2\/native-history\/(claude-code|pi|codex|grok-build|devin)\/(sessions|policy)$/);
    if (nativeList) return json(nativeList[2] === 'sessions' ? demoNativeList(nativeList[1]) : demoNativePolicy(nativeList[1]));
    const nativeTranscript = path.match(/^\/v2\/native-history\/(claude-code|pi|codex|grok-build|devin)\/sessions\/([^/]+)\/transcript$/);
    if (nativeTranscript) {
      const item = demoNativeSessions[nativeTranscript[1]]?.find((entry) => entry.id === decodeURIComponent(nativeTranscript[2]));
      if (!item) return notFound(method, path);
      return json({
        provider: nativeTranscript[1], id: item.id, title: item.title, cwd: item.cwd, totalMessages: 214, truncated: true,
        messages: [
          { role: 'user', text: item.title ?? '看一下这个目录', at: item.createdAt },
          { role: 'assistant', text: '我先看看相关文件的结构，再给出修改方案。', at: item.createdAt },
          { role: 'tool', text: 'Read: {"file_path":"src/checkout/schema.ts"}', at: item.createdAt },
          { role: 'assistant', text: '改好了：\n- 字段错误改用语义 token\n- 文案集中到 messages.ts', at: item.updatedAt },
        ],
      });
    }
    const live = path.match(/^\/v2\/agent-providers\/([^/]+)\/live$/);
    if (live) {
      const bucket = fixtures.demoAgentProviders.agents[live[1] as keyof typeof fixtures.demoAgentProviders.agents];
      return bucket ? json(bucket.live) : notFound(method, path);
    }
    return notFound(method, path);
  }

  // Prompt attachments: the demo keeps no bytes, only reports a stored path.
  if (path === '/v2/uploads' && method === 'PUT') {
    const bytes = request.body instanceof Uint8Array ? request.body.length : String(request.body ?? '').length;
    const uploadId = query.get('uploadId') || crypto.randomUUID().replace(/-/g, '');
    const name = (query.get('name') ?? '').split(/[\\/]/).pop()?.trim() || 'file';
    return json({ uploadId, path: `/tmp/todex/file/${uploadId}/${name}`, name, mimeType: /\.md$/i.test(name) ? 'text/markdown' : 'application/octet-stream', sizeBytes: Number(query.get('offset') ?? 0) + bytes });
  }
  const body = readBody(request);
  if (path === '/v2/workspaces' && method === 'PUT') {
    if (Array.isArray(body.workspaces)) workspaces = body.workspaces as typeof workspaces;
    return json({ workspaces });
  }
  if (path === '/v2/kanban/tasks' && method === 'PUT') {
    if (Array.isArray(body.tasks)) kanbanTasks = body.tasks as typeof kanbanTasks;
    return json({ tasks: kanbanTasks });
  }
  if (settingsFile && (method === 'PATCH' || method === 'PUT')) {
    const current = demoCliSettingsDocument(settingsFile);
    if (body.revision !== current.revision) return json({ error: { code: 'CONFLICT', message: 'settings changed on disk' } }, 409);
    if (method === 'PUT') {
      settingsFile.text = String(body.text);
      // The demo does not parse TOML; the form keeps the last patched values.
      if (settingsFile.format === 'json') settingsFile.settings = JSON.parse(settingsFile.text) as SettingsObject;
    } else if (settingsFile.format !== 'yaml') {
      Object.assign(settingsFile, demoSettingsFile(settingsFile.path, settingsFile.format, applyMergePatch(settingsFile.settings ?? {}, body.patch as SettingsObject)));
    }
    return json(demoCliSettingsDocument(settingsFile));
  }
  const nativeAction = path.match(/^\/v2\/native-history\/(claude-code|pi|codex|grok-build|devin)\/(cleanup|policy|policy\/run|native-retention)$/);
  if (nativeAction) {
    const [, nativeProvider, action] = nativeAction;
    if (action === 'cleanup') return json(demoNativeDelete(nativeProvider, Array.isArray(body.sessionIds) ? body.sessionIds.map(String) : []));
    if (action === 'native-retention') {
      demoClaudeRetention = typeof body.cleanupPeriodDays === 'number' ? body.cleanupPeriodDays : null;
      return json({ cleanupPeriodDays: demoClaudeRetention, settingsPath: '/home/demo/.claude/settings.json' });
    }
    if (action === 'policy') {
      demoNativePolicies[nativeProvider] = {
        enabled: body.enabled === true,
        maxAgeDays: typeof body.maxAgeDays === 'number' ? body.maxAgeDays : null,
        maxTotalBytes: typeof body.maxTotalBytes === 'number' ? body.maxTotalBytes : null,
      };
      return json(demoNativePolicy(nativeProvider));
    }
    const maxAge = demoNativePolicies[nativeProvider].maxAgeDays;
    const expired = (demoNativeSessions[nativeProvider] ?? []).filter((item) => maxAge != null && Date.parse(item.updatedAt) < Date.now() - maxAge * DAY);
    const result = demoNativeDelete(nativeProvider, expired.map((item) => item.id));
    return json({ ...result, lastRun: { at: now, trigger: 'manual', deleted: result.deleted.length, freedBytes: result.freedBytes, error: null } });
  }
  if (path === '/v2/history/cleanup' && method === 'POST') {
    return json(demoDelete(Array.isArray(body.conversationIds) ? body.conversationIds.map(String) : []));
  }
  if (path === '/v2/history/cleanup-policy' && method === 'PUT') {
    cleanupPolicy = {
      enabled: body.enabled === true,
      maxAgeDays: typeof body.maxAgeDays === 'number' ? body.maxAgeDays : null,
      maxTotalBytes: typeof body.maxTotalBytes === 'number' ? body.maxTotalBytes : null,
    };
    return json(demoCleanupPolicy());
  }
  if (path === '/v2/history/cleanup-policy/run' && method === 'POST') {
    const cutoff = cleanupPolicy.maxAgeDays == null ? null : Date.now() - cleanupPolicy.maxAgeDays * 86_400_000;
    const expired = [...journals.values()].filter((journal) => cutoff != null && Date.parse(journal.manifest.updatedAt) < cutoff);
    const result = demoDelete(expired.map((journal) => journal.manifest.id));
    return json({ ...result, lastRun: { at: now, trigger: 'manual', deleted: result.deleted.length, freedBytes: result.freedBytes, error: null } });
  }
  if (path === '/v2/conversations' && method === 'POST') {
    const id = crypto.randomUUID();
    const manifest: ConversationManifest = {
      schemaVersion: 2,
      id,
      provider: (typeof body.provider === 'string' ? body.provider : 'claude-code') as ProviderKind,
      ownerId: 'local',
      workspace: body.scratchWorkspace === true
        ? `/home/demo/.todex-agent/workspace/${id}`
        : typeof body.workspace === 'string' ? body.workspace : fixtures.demoWorkspaces[0].path,
      ...(body.scratchWorkspace === true ? { scratchWorkspace: true } : {}),
      ...(typeof body.workspaceId === 'string' ? { workspaceId: body.workspaceId } : {}),
      title: typeof body.title === 'string' ? body.title : '新对话',
      status: 'idle',
      lastSequence: 0,
      createdAt: now,
      updatedAt: now,
    };
    journals.set(id, { manifest, events: [] });
    return json(manifest);
  }
  const conversation = path.match(/^\/v2\/conversations\/([^/]+)$/);
  const journal = conversation ? journals.get(decodeURIComponent(conversation[1])) : undefined;
  if (journal && method === 'PATCH') {
    if (typeof body.title === 'string') journal.manifest.title = body.title;
    if (body.archived === true) journal.manifest.archivedAt = now;
    if (body.archived === false) delete journal.manifest.archivedAt;
    return json(journal.manifest);
  }
  if (journal && method === 'DELETE') {
    journals.delete(journal.manifest.id);
    return json({ deleted: true });
  }
  if (path === '/v2/agent-calling' && method === 'PUT') return demoAgentCallingUpdate(body);
  if (path === '/v2/agent-calling/api-listener' && method === 'PUT') return demoApiListenerUpdate(body);
  const apiKeyResponse = demoApiKeysRoute(method, path, body);
  if (apiKeyResponse) return apiKeyResponse;
  const cancel = path.match(/^\/v2\/conversations\/([^/]+)\/cancel$/);
  if (cancel && method === 'POST') {
    const target = journals.get(decodeURIComponent(cancel[1]));
    if (!target) return notFound(method, path);
    return json({ conversationId: target.manifest.id, cancelled: cancelDemoTurn(target, typeof body.turnId === 'string' ? body.turnId : undefined), turnId: body.turnId ?? null });
  }
  if (path.startsWith('/v2/agent-desktop') && (method === 'PUT' || method === 'POST' || method === 'PATCH')) {
    if (typeof body.enabled === 'boolean') agentDesktop = { ...agentDesktop, enabled: body.enabled };
    if (typeof body.computerEnabled === 'boolean') agentDesktop = { ...agentDesktop, computerEnabled: body.computerEnabled };
    return json(agentDesktop);
  }
  const cli = path.match(/^\/v2\/providers\/([^/]+)\/(upgrade|install)$/);
  if (cli) {
    return json({ id: `op-${Date.now()}`, provider: cli[1], action: cli[2], status: 'succeeded', startedAt: now, finishedAt: now });
  }
  return notFound(method, path);
}

// --- Socket -------------------------------------------------------------------

class DemoSocket implements SecureSocket {
  readonly encrypted = false;
  ready = true;
  closed = false;

  constructor(private readonly handlers: SecureSocketOptions) {
    sockets.add(this);
    // The session only accepts onOpen once openSocket has returned.
    setTimeout(() => {
      if (!this.closed) this.handlers.onOpen?.();
    }, 50);
  }

  send(text: string): void {
    let message: { id?: string; type?: string; payload?: Record<string, unknown> };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    const payload = message.payload ?? {};
    let result: Record<string, unknown> = {};
    if (message.type === 'conversation.subscribe') {
      const journal = journals.get(String(payload.conversationId));
      if (journal) {
        const backfill = replay(journal, new URLSearchParams({ afterSequence: String(payload.afterSequence ?? 0), limit: String(payload.limit ?? 200) }));
        for (const event of backfill.events) this.emit({ type: 'conversation.event', payload: event });
        result = { conversationId: journal.manifest.id, nextSequence: backfill.nextSequence, hasMore: backfill.hasMore };
      }
    } else if (message.type === 'conversation.prompt') {
      const journal = journals.get(String(payload.conversationId));
      if (journal) result = { conversationId: journal.manifest.id, turnId: playCannedTurn(journal, String(payload.text ?? '')) };
    } else if (message.type === 'conversation.warm') {
      // The demo has no agent processes to start.
      result = { conversationId: String(payload.conversationId ?? ''), warmed: false, reason: 'demo' };
    }
    if (message.id) this.emit({ type: 'server.result', id: message.id, payload: result });
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    sockets.delete(this);
    setTimeout(() => this.handlers.onClose?.({ code, reason }), 0);
  }

  emit(message: unknown): void {
    if (!this.closed) this.handlers.onMessage?.(JSON.stringify(message));
  }
}

function broadcast(event: ConversationEvent) {
  for (const socket of sockets) socket.emit({ type: 'conversation.event', payload: event });
}

/** One streamed event: delay from the prompt (ms), event type, payload. */
export type DemoTurnStep = [number, string, Record<string, unknown>];
/** A step whose function payload is read when it fires (null skips it). */
type DemoStep = [number, string, Record<string, unknown> | (() => Record<string, unknown> | null)];

// Web only: the landing page's autoplay answers its own prompt with a richer
// scripted turn; anything else typed in the preview gets the canned one below.
let turnScript: ((text: string, turnId: string) => DemoTurnStep[] | null) | null = null;

export function setDemoTurnScript(script: typeof turnScript): void {
  turnScript = script;
}

type DemoRun = { turnId: string; timers: ReturnType<typeof setTimeout>[]; onCancel?: () => void };
/** Scripted turns still playing, by conversation id, so they can be cancelled. */
const demoRuns = new Map<string, DemoRun>();

function appendDemoEvent(journal: Journal, turnId: string, type: string, payload: Record<string, unknown>): void {
  const event: ConversationEvent = {
    schemaVersion: 2,
    eventId: `${turnId}-${type}-${journal.events.length + 1}`,
    conversationId: journal.manifest.id,
    sequence: journal.events.length + 1,
    time: new Date().toISOString(),
    type,
    provider: journal.manifest.provider,
    payload: { turnId, ...payload },
  };
  journal.events.push(event);
  journal.manifest.lastSequence = event.sequence;
  journal.manifest.updatedAt = event.time;
  if (type === 'turn.started') journal.manifest.status = 'running';
  if (type === 'turn.completed' || type === 'turn.cancelled') journal.manifest.status = 'idle';
  broadcast(event);
}

/** Plays `steps` (delay ms, type, payload — a function payload is read when
 * it fires and skips the step when it returns null). */
function scheduleDemoTurn(journal: Journal, turnId: string, steps: DemoStep[], onCancel?: () => void): void {
  const run: DemoRun = { turnId, timers: [], onCancel };
  demoRuns.set(journal.manifest.id, run);
  for (const [delay, type, payload] of steps) {
    run.timers.push(setTimeout(() => {
      const body = typeof payload === 'function' ? payload() : payload;
      if (!body) return;
      appendDemoEvent(journal, turnId, type, body);
      if (type === 'turn.completed' && demoRuns.get(journal.manifest.id) === run) demoRuns.delete(journal.manifest.id);
    }, delay));
  }
}

function cancelDemoTurn(journal: Journal, turnId?: string): boolean {
  const run = demoRuns.get(journal.manifest.id);
  if (!run || (turnId && run.turnId !== turnId)) return false;
  run.timers.forEach(clearTimeout);
  demoRuns.delete(journal.manifest.id);
  appendDemoEvent(journal, run.turnId, 'turn.cancelled', { status: 'cancelled' });
  run.onCancel?.();
  return true;
}

/** Streams a short scripted turn so prompts typed in the preview get an answer. */
function playCannedTurn(journal: Journal, text: string): string {
  const turnId = `${journal.manifest.id}-live-${Date.now()}`;
  const scripted = turnScript?.(text, turnId);
  if (scripted) {
    scheduleDemoTurn(journal, turnId, scripted);
    return turnId;
  }
  if (/agent|调用/i.test(text) && !journal.manifest.parentConversationId) {
    playAgentCallTurn(journal, turnId, text);
    return turnId;
  }
  const toolCallId = `${turnId}-call`;
  scheduleDemoTurn(journal, turnId, [
    [0, 'message.created', { role: 'user', content: text }],
    [150, 'turn.started', { status: 'running' }],
    [700, 'thought.delta', { thinking: '这是演示预览：后端是内存中的模拟数据，下面的步骤和回复都是预设的。' }],
    [1400, 'tool.started', { toolCallId, toolName: 'Read', arguments: { file_path: 'README.md' } }],
    [2600, 'tool.completed', { toolCallId, toolName: 'Read', arguments: { file_path: 'README.md' }, result: '# Lumen\n\n演示项目说明……', isError: false }],
    [3800, 'message.completed', {
      role: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: `收到：「${text.slice(0, 60)}」\n\n这是演示模式的预设回复，用来预览对话流、工具卡片和完成状态的样式。真实对话请在连接后端的正常模式下进行。` }] },
      block: { category: 'assistant_final', id: `${turnId}-answer`, turnId, phase: 'completed' },
    }],
    [3900, 'usage.updated', { model: 'opus', contextWindow: 200_000, usage: { last: { input: 9_800, output: 640, cacheRead: 52_000, cacheWrite: 1_200, total: 10_440 } } }],
    [4000, 'turn.completed', { status: 'completed' }],
  ]);
  return turnId;
}

/** A prompt mentioning agents plays an Agent Calling turn: the agent calls
 * Codex through `mcp__todex_agents__agent_run`, which runs in a child
 * conversation (hidden from the list) whose progress the parent journals as
 * `agent.call.*` events. Cancelling the child cancels the call. */
function playAgentCallTurn(journal: Journal, turnId: string, text: string): void {
  const toolCallId = `${turnId}-agent-run`;
  const childId = crypto.randomUUID();
  const childTurnId = `${childId}-turn-1`;
  const task = '检查 src/checkout 下的表单校验，列出缺少错误提示的字段。';
  const output = '发现 3 个字段缺少错误提示：\n\n- `email`：格式错误时无提示\n- `zip`：长度校验失败时无提示\n- `phone`：只在提交后才校验\n\n建议统一改用 `FieldError` 组件。';
  const toolName = 'mcp__todex_agents__agent_run';
  const args = { agent: 'codex', text: task, reasoningEffort: 'high' };
  const startedAt = Date.now();
  let cancelled = false;
  const call = { childConversationId: childId, childTurnId };
  const now = new Date().toISOString();
  const child: Journal = {
    manifest: { ...journal.manifest, id: childId, provider: 'codex', title: 'Agent call · Codex', status: 'idle', lastSequence: 0,
      createdAt: now, updatedAt: now, parentConversationId: journal.manifest.id },
    events: [],
  };
  delete child.manifest.archivedAt;
  delete child.manifest.schedule;
  delete child.manifest.titleEnc;
  scheduleDemoTurn(journal, turnId, [
    [0, 'message.created', { role: 'user', content: text }],
    [150, 'turn.started', { status: 'running' }],
    [600, 'tool.started', { toolCallId, toolName, arguments: args }],
    [900, 'agent.call.started', () => {
      journals.set(childId, child);
      scheduleDemoTurn(child, childTurnId, [
        [0, 'message.created', { role: 'user', content: task }],
        [100, 'turn.started', { status: 'running' }],
        [1500, 'tool.started', { toolCallId: `${childTurnId}-grep`, toolName: 'shell', arguments: { command: 'rg -n "validate" src/checkout' } }],
        [2400, 'tool.completed', { toolCallId: `${childTurnId}-grep`, toolName: 'shell', arguments: { command: 'rg -n "validate" src/checkout' }, result: 'src/checkout/schema.ts:12: validate(email)', isError: false }],
        [5000, 'message.completed', {
          role: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: output }] },
          block: { category: 'assistant_final', id: `${childTurnId}-answer`, turnId: childTurnId, phase: 'completed' },
        }],
        [5200, 'turn.completed', { status: 'completed' }],
      ], () => {
        cancelled = true;
        appendDemoEvent(journal, turnId, 'agent.call.cancelled', { ...call, status: 'cancelled', output: '', durationMs: Date.now() - startedAt });
      });
      return { ...call, agent: 'codex', model: 'gpt-5.5-codex', reasoningEffort: 'high', text: task, title: 'Agent call · Codex', status: 'running', startedAt: new Date().toISOString() };
    }],
    [2500, 'agent.call.updated', () => (cancelled ? null : { ...call, status: 'waiting_permission' })],
    [4000, 'agent.call.updated', () => (cancelled ? null : { ...call, status: 'running' })],
    [6300, 'agent.call.completed', () => (cancelled ? null : { ...call, status: 'completed', output, durationMs: Date.now() - startedAt })],
    [6400, 'tool.completed', () => ({ toolCallId, toolName, arguments: args, isError: false,
      result: JSON.stringify({ conversationId: childId, turnId: childTurnId, status: cancelled ? 'cancelled' : 'completed', output: cancelled ? '' : output, error: null }) })],
    [6900, 'message.completed', () => ({
      role: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: cancelled ? 'Codex 的调用已取消。' : `Codex 已完成检查：\n\n${output}` }] },
      block: { category: 'assistant_final', id: `${turnId}-answer`, turnId, phase: 'completed' },
    })],
    [7000, 'turn.completed', { status: 'completed' }],
  ]);
}

export const demoTransport: SecureTransport = {
  mode: 'plaintext',
  fetch: async (request) => route(request),
  fetchStream: async (request): Promise<SecureStreamResponse> => {
    const response = route(request);
    return { status: response.status, headers: response.headers, body: (async function* () { yield response.body; })() };
  },
  openSocket: (options = {}) => new DemoSocket(options),
};

/** Answers the two calls that use `window.fetch` directly (health polling and
 * the transport policy probe) from the same routes. */
export function installDemoFetch(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== new URL(fixtures.DEMO_SERVER_URL).origin) return realFetch(input, init);
    const response = route({ method: init?.method ?? 'GET', path: url.pathname, query: url.search });
    return new Response(decoder.decode(response.body), { status: response.status, headers: response.headers });
  };
}

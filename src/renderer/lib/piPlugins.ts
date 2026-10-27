/**
 * What the Pi settings "Plugins" tab knows about Pi packages: a category,
 * how much of the package works when TodeX drives Pi over RPC, and the
 * settings page of the extensions whose configuration file the backend
 * serves (`PiPluginConfigId`). Pages reuse the CLI settings `FieldSpec`s;
 * labels live under `piPlugins.<config id>.*`.
 */

import { PI_SECRET_PLACEHOLDER, type PiPackage, type PiPluginConfigId } from '@todex/protocol/v2';
import type { FieldGroup, SettingsObject } from './cliSettings';

export type PiPluginCategory = 'security' | 'tools' | 'workflow' | 'context' | 'terminal' | 'other';

/** `full`: works in TodeX; `partial`: some commands need Pi's terminal UI; `terminal`: terminal UI only. */
export type PiRpcSupport = 'full' | 'partial' | 'terminal' | 'unknown';

export type KnownPiPlugin = {
  /** i18n slug: `piPlugins.summary.<slug>`. */
  slug: string;
  category: PiPluginCategory;
  rpc: PiRpcSupport;
  config?: PiPluginConfigId;
};

export const PI_PLUGIN_CATEGORIES: PiPluginCategory[] = ['security', 'tools', 'workflow', 'context', 'terminal', 'other'];

/** Known packages by npm package name. */
const KNOWN: Record<string, KnownPiPlugin> = {
  '@gotgenes/pi-permission-system': { slug: 'permissionSystem', category: 'security', rpc: 'full', config: 'permission-system' },
  'pi-mcp-adapter': { slug: 'mcpAdapter', category: 'tools', rpc: 'full', config: 'mcp-adapter' },
  'pi-web-access': { slug: 'webAccess', category: 'tools', rpc: 'full', config: 'web-access' },
  'pi-exa': { slug: 'exa', category: 'tools', rpc: 'full', config: 'exa' },
  '@ff-labs/pi-fff': { slug: 'fff', category: 'tools', rpc: 'full', config: 'fff' },
  '@injaneity/pi-computer-use': { slug: 'computerUse', category: 'tools', rpc: 'partial' },
  'pi-agent-browser-native': { slug: 'agentBrowser', category: 'tools', rpc: 'full' },
  '@tintinweb/pi-subagents': { slug: 'subagents', category: 'workflow', rpc: 'partial', config: 'subagents' },
  '@narumitw/pi-goal': { slug: 'goal', category: 'workflow', rpc: 'full', config: 'goal' },
  '@narumitw/pi-plan-mode': { slug: 'planMode', category: 'workflow', rpc: 'full', config: 'plan-mode' },
  '@tintinweb/pi-tasks': { slug: 'tasks', category: 'workflow', rpc: 'partial', config: 'tasks' },
  'pi-agenticoding': { slug: 'agenticoding', category: 'workflow', rpc: 'partial' },
  '@plannotator/pi-extension': { slug: 'plannotator', category: 'workflow', rpc: 'partial' },
  'pi-context-prune': { slug: 'contextPrune', category: 'context', rpc: 'full', config: 'context-prune' },
  'pi-cache-optimizer': { slug: 'cacheOptimizer', category: 'context', rpc: 'full', config: 'cache-optimizer' },
  'pi-context-usage': { slug: 'contextUsage', category: 'context', rpc: 'partial' },
  'pi-cache-graph': { slug: 'cacheGraph', category: 'context', rpc: 'terminal' },
  'pi-observability': { slug: 'observability', category: 'terminal', rpc: 'terminal' },
  'pi-tool-display': { slug: 'toolDisplay', category: 'terminal', rpc: 'terminal' },
  '@tmustier/pi-usage-extension': { slug: 'usageExtension', category: 'terminal', rpc: 'terminal' },
  'better-custom': { slug: 'betterCustom', category: 'terminal', rpc: 'terminal' },
};

/** The npm name of a package: its `package.json` name, else the `npm:` spec without its version. */
export function piPackageName(pkg: PiPackage): string | undefined {
  if (pkg.name) return pkg.name;
  if (!pkg.source.startsWith('npm:')) return undefined;
  const spec = pkg.source.slice(4);
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

export function knownPiPlugin(pkg: PiPackage): KnownPiPlugin | undefined {
  const name = piPackageName(pkg);
  return name ? KNOWN[name] : undefined;
}

export type PiPluginPage = {
  groups: FieldGroup[];
  /**
   * Written with every save that changes the file when stored differently:
   * cache-optimizer reads `features` only from a version 3 file, and v3
   * accepts everything v1 and v2 do.
   */
  required?: SettingsObject;
};

const THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const PERMISSION_ACTIONS = ['allow', 'ask', 'deny'];
const secret = (key: string) => ({ kind: 'secret' as const, path: [key], secretPlaceholder: PI_SECRET_PLACEHOLDER });

export const PI_PLUGIN_PAGES: Record<PiPluginConfigId, PiPluginPage> = {
  'permission-system': {
    groups: [
      {
        id: 'defaults',
        fields: [
          { kind: 'switch', path: ['yoloMode'], default: false },
          { kind: 'enum', path: ['permission', '*'], options: PERMISSION_ACTIONS, default: 'ask' },
          { kind: 'integer', path: ['forwardingTimeoutMs'], min: 1, max: 86_400_000, default: 600_000 },
        ],
      },
      {
        id: 'rules',
        fields: [
          { kind: 'rules', path: ['permission', 'bash'], actions: PERMISSION_ACTIONS, reasonAction: 'deny', placeholder: 'git push *' },
          { kind: 'rules', path: ['permission', 'path_write'], actions: PERMISSION_ACTIONS, reasonAction: 'deny', placeholder: '~/.ssh/*' },
          { kind: 'rules', path: ['permission', 'external_directory'], actions: PERMISSION_ACTIONS, reasonAction: 'deny', placeholder: '~/projects/*' },
        ],
      },
      {
        id: 'logs',
        fields: [
          { kind: 'switch', path: ['permissionReviewLog'], default: true },
          { kind: 'switch', path: ['debugLog'], default: false },
        ],
      },
    ],
  },
  'mcp-adapter': {
    groups: [
      {
        id: 'behavior',
        fields: [
          { kind: 'enum', path: ['settings', 'approveTools'], options: [true, 'destructive', false], default: false },
          { kind: 'enum', path: ['settings', 'projectServers'], options: ['ask', 'allow'], default: 'ask' },
          { kind: 'enum', path: ['settings', 'toolPrefix'], options: ['server', 'short', 'none', 'mcp'], default: 'server' },
          { kind: 'integer', path: ['settings', 'idleTimeout'], min: 0, max: 1440, default: 10 },
          { kind: 'switch', path: ['settings', 'autoAuth'], default: false },
        ],
      },
    ],
  },
  'web-access': {
    groups: [
      {
        id: 'search',
        fields: [
          { kind: 'enum', path: ['provider'], options: ['auto', 'exa', 'brave', 'tavily', 'perplexity', 'gemini', 'openai', 'searxng', 'jina', 'firecrawl'], default: 'auto' },
          { kind: 'enum', path: ['workflow'], options: ['none', 'auto-summary', 'summary-review'], default: 'none' },
          { kind: 'model', path: ['summaryModel'], format: 'string' },
        ],
      },
      {
        id: 'fetch',
        fields: [
          { kind: 'enum', path: ['fetch', 'defaultMode'], options: ['readable', 'raw', 'answer'], default: 'readable' },
          { kind: 'integer', path: ['fetch', 'timeout'], min: 1, max: 600, default: 30 },
          { kind: 'lines', path: ['ssrf', 'allowRanges'], placeholder: '198.18.0.0/15' },
        ],
      },
      {
        id: 'keys',
        fields: [secret('exaApiKey'), secret('braveApiKey'), secret('tavilyApiKey'), secret('perplexityApiKey'), secret('geminiApiKey'), secret('openaiApiKey'), secret('jinaApiKey'), secret('firecrawlApiKey')],
      },
    ],
  },
  exa: {
    groups: [
      {
        id: 'features',
        fields: [
          { kind: 'switch', path: ['enabled'], default: true },
          { kind: 'switch', path: ['advancedSearchEnabled'], default: false },
          { kind: 'switch', path: ['deepSearchEnabled'], default: true },
          { kind: 'switch', path: ['mcpUseApiKey'], default: false },
        ],
      },
    ],
  },
  fff: {
    groups: [
      {
        id: 'search',
        fields: [
          { kind: 'enum', path: ['mode'], options: ['tools-and-ui', 'tools-only', 'override'], default: 'tools-and-ui' },
          { kind: 'switch', path: ['enableHomeDirScanning'], default: true },
          { kind: 'switch', path: ['warnOnHomeDirScan'], default: true },
          { kind: 'switch', path: ['followSymlinks'], default: true },
          { kind: 'switch', path: ['enableFsRootScanning'], default: false },
        ],
      },
    ],
  },
  subagents: {
    groups: [
      {
        id: 'limits',
        fields: [
          { kind: 'integer', path: ['maxConcurrent'], min: 1, max: 1024, default: 10 },
          { kind: 'integer', path: ['maxConcurrentForeground'], min: 0, max: 1024, default: 0 },
          { kind: 'integer', path: ['defaultMaxTurns'], min: 0, max: 10000, default: 0 },
          { kind: 'integer', path: ['graceTurns'], min: 1, max: 1000, default: 5 },
          { kind: 'integer', path: ['maxSubagentDepth'], min: 0, max: 16, default: 2 },
        ],
      },
      {
        id: 'behavior',
        fields: [
          { kind: 'switch', path: ['backgroundByDefault'], default: true },
          { kind: 'enum', path: ['defaultJoinMode'], options: ['smart', 'async', 'group'], default: 'smart' },
          { kind: 'switch', path: ['worktreeIsolation'], default: true },
          { kind: 'switch', path: ['scopeModels'], default: false },
          { kind: 'switch', path: ['schedulingEnabled'], default: true },
          { kind: 'switch', path: ['workflowsEnabled'], default: true },
          { kind: 'switch', path: ['reportUsage'], default: false },
          { kind: 'switch', path: ['showCost'], default: false },
        ],
      },
    ],
  },
  goal: {
    groups: [
      {
        id: 'limits',
        fields: [
          { kind: 'limit', path: ['continuationLimits', 'automaticTurns'], min: 1, max: 10000, default: 25 },
          { kind: 'limit', path: ['continuationLimits', 'noProgressTurns'], min: 1, max: 1000, default: 3 },
          { kind: 'switch', path: ['rpc', 'enabled'], default: false },
        ],
      },
    ],
  },
  'plan-mode': {
    groups: [
      {
        id: 'plan',
        fields: [
          { kind: 'enum', path: ['thinkingLevel'], options: ['inherit', ...THINKING], default: 'inherit' },
          { kind: 'model', path: ['defaultImplementationModel'], format: 'object' },
          { kind: 'enum', path: ['defaultImplementationThinkingLevel'], options: THINKING },
          { kind: 'enum', path: ['implementationPlanRetention'], options: ['clear-on-start', 'clear-after-first-run', 'keep'], default: 'clear-on-start' },
          { kind: 'text', path: ['defaultPlanExportPath'], placeholder: 'PLAN.md' },
        ],
      },
    ],
  },
  tasks: {
    groups: [
      {
        id: 'tasks',
        fields: [
          { kind: 'enum', path: ['taskScope'], options: ['memory', 'session', 'session-global', 'project'], default: 'session' },
          { kind: 'switch', path: ['autoCascade'], default: false },
          { kind: 'enum', path: ['autoClearCompleted'], options: ['never', 'on_list_complete', 'on_task_complete'], default: 'on_list_complete' },
        ],
      },
    ],
  },
  'context-prune': {
    groups: [
      {
        id: 'prune',
        fields: [
          { kind: 'switch', path: ['enabled'], default: false },
          { kind: 'enum', path: ['pruneOn'], options: ['agentic-auto', 'every-turn', 'agent-message', 'on-context-tag', 'on-demand'], default: 'agentic-auto' },
          { kind: 'enum', path: ['batchingMode'], options: ['agent-message', 'turn'], default: 'agent-message' },
          { kind: 'switch', path: ['remindUnprunedCount'], default: true },
        ],
      },
      {
        id: 'summarizer',
        fields: [
          { kind: 'model', path: ['summarizerModel'], format: 'string', extra: ['default'] },
          { kind: 'enum', path: ['summarizerThinking'], options: ['default', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'], default: 'default' },
        ],
      },
      {
        id: 'notices',
        fields: [
          { kind: 'switch', path: ['notifySkipped'], default: true },
          { kind: 'switch', path: ['showStartupNotice'], default: true },
        ],
      },
    ],
  },
  'cache-optimizer': {
    required: { version: 3 },
    groups: [
      {
        id: 'features',
        fields: [
          { kind: 'switch', path: ['features', 'promptRewrite'], default: true },
          { kind: 'switch', path: ['features', 'skillCompression'], default: true },
          { kind: 'switch', path: ['features', 'openAICacheKey'], default: true },
          { kind: 'switch', path: ['features', 'toolOrder'], default: false },
          { kind: 'switch', path: ['features', 'virtualRewrite'], default: false },
        ],
      },
    ],
  },
};

/** A `@tintinweb/pi-subagents` template's file name, as the backend accepts it. */
export const PI_SUBAGENT_TEMPLATE_FILE = /^(?!\.)[A-Za-z0-9._-]{1,100}$/;

/** The template form; other front matter keys are edited in the source view and kept by form saves. */
export const PI_SUBAGENT_TEMPLATE_GROUPS: FieldGroup[] = [
  {
    id: 'identity',
    fields: [
      { kind: 'text', path: ['display_name'], placeholder: 'Security Auditor' },
      { kind: 'longtext', path: ['description'] },
      { kind: 'enum', path: ['color'], options: ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'] },
      { kind: 'switch', path: ['enabled'], default: true },
    ],
  },
  {
    id: 'run',
    fields: [
      { kind: 'model', path: ['model'], format: 'string' },
      { kind: 'enum', path: ['thinking'], options: THINKING },
      { kind: 'text', path: ['tools'], placeholder: 'read, grep, find, ls' },
      { kind: 'integer', path: ['max_turns'], min: 0, max: 10000 },
      { kind: 'enum', path: ['prompt_mode'], options: ['replace', 'append'], default: 'replace' },
      { kind: 'bool', path: ['run_in_background'] },
      { kind: 'enum', path: ['isolation'], options: ['worktree', 'off'] },
    ],
  },
];

/** What a new template's source view starts from. */
export const PI_SUBAGENT_TEMPLATE_SKELETON = '---\ndescription: \ntools: read, grep, find, ls\n---\n\n';

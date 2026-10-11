/**
 * Editing model for the CLI manager's settings panel over a CLI's user
 * settings file (Claude Code and Pi `settings.json`, Codex `config.toml`).
 * The form edits a draft copy of the settings object; saving sends only the
 * difference as an RFC 7386 merge patch, so keys the form does not know
 * (hooks, plugins, MCP servers…) are never touched.
 */

import type { CliSettingsProvider } from '@todex/protocol/v2';
import type { MessageKey } from '../i18n';

export type SettingsObject = Record<string, unknown>;

/** A JSON scalar a select can choose. */
export type OptionValue = string | number | boolean;

/** Option value that stands for "key not set". */
export const UNSET = '__unset';

export type FieldSpec =
  /** true / false / unset, as a three-way select. */
  | { kind: 'bool'; path: string[] }
  /** Option labels are `<prefix>.option.<id>.<value>`. */
  | { kind: 'enum'; path: string[]; options: OptionValue[] }
  /** Free text; an empty input removes the key. */
  | { kind: 'text'; path: string[]; placeholder?: string }
  /** Multi-line free text; an empty input removes the key. */
  | { kind: 'longtext'; path: string[]; placeholder?: string }
  | { kind: 'integer'; path: string[]; min: number; max: number }
  /** A string array, edited one entry per line. */
  | { kind: 'lines'; path: string[]; placeholder?: string }
  /** Keys whose only value is the string `"disable"`. */
  | { kind: 'disable'; path: string[] }
  /** Default (unset), hidden (empty string) or custom text. */
  | { kind: 'attribution'; path: string[] };

export type FieldGroup = { id: string; fields: FieldSpec[] };

/** What the settings panel shows for one CLI. */
export type CliSettingsSchema = {
  provider: CliSettingsProvider;
  name: string;
  /** i18n prefix of `group.*`, `field.*`, `hint.*` and `option.*` keys. */
  keyPrefix: string;
  groups: FieldGroup[];
  /** String map edited in the Environment tab; none hides the tab. */
  envPath?: string[];
  hints: { scope: MessageKey; moreInRaw: MessageKey; env?: MessageKey; rawHidden: MessageKey };
};

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];

const CLAUDE_SETTINGS_GROUPS: FieldGroup[] = [
  {
    id: 'responses',
    fields: [
      { kind: 'bool', path: ['alwaysThinkingEnabled'] },
      { kind: 'bool', path: ['fastMode'] },
      { kind: 'text', path: ['language'], placeholder: 'chinese' },
      { kind: 'text', path: ['outputStyle'], placeholder: 'Explanatory' },
    ],
  },
  {
    id: 'permissions',
    fields: [
      { kind: 'enum', path: ['permissions', 'defaultMode'], options: PERMISSION_MODES },
      { kind: 'lines', path: ['permissions', 'allow'], placeholder: 'Bash(npm run test:*)' },
      { kind: 'lines', path: ['permissions', 'ask'], placeholder: 'Bash(git push:*)' },
      { kind: 'lines', path: ['permissions', 'deny'], placeholder: 'Read(./.env)' },
      { kind: 'lines', path: ['permissions', 'additionalDirectories'], placeholder: '../docs/' },
      { kind: 'disable', path: ['disableAutoMode'] },
      { kind: 'disable', path: ['permissions', 'disableBypassPermissionsMode'] },
    ],
  },
  {
    id: 'context',
    fields: [
      { kind: 'bool', path: ['autoCompactEnabled'] },
      { kind: 'bool', path: ['autoMemoryEnabled'] },
      { kind: 'bool', path: ['fileCheckpointingEnabled'] },
      { kind: 'integer', path: ['cleanupPeriodDays'], min: 1, max: 3650 },
    ],
  },
  {
    id: 'git',
    fields: [
      { kind: 'attribution', path: ['attribution', 'commit'] },
      { kind: 'attribution', path: ['attribution', 'pr'] },
      { kind: 'bool', path: ['includeGitInstructions'] },
      { kind: 'enum', path: ['worktree', 'baseRef'], options: ['fresh', 'head'] },
    ],
  },
  {
    id: 'interface',
    fields: [
      { kind: 'enum', path: ['theme'], options: ['auto', 'dark', 'light', 'dark-daltonized', 'light-daltonized', 'dark-ansi', 'light-ansi'] },
      { kind: 'enum', path: ['editorMode'], options: ['normal', 'vim'] },
      { kind: 'enum', path: ['viewMode'], options: ['default', 'verbose', 'focus'] },
      { kind: 'enum', path: ['tui'], options: ['default', 'fullscreen'] },
      { kind: 'enum', path: ['timeFormat'], options: ['auto', '12-hour', '24-hour', '24-hour-utc'] },
      { kind: 'bool', path: ['showTurnDuration'] },
      { kind: 'bool', path: ['spinnerTipsEnabled'] },
      { kind: 'bool', path: ['prefersReducedMotion'] },
    ],
  },
  {
    id: 'advanced',
    fields: [
      { kind: 'enum', path: ['autoUpdatesChannel'], options: ['latest', 'stable'] },
      { kind: 'bool', path: ['sandbox', 'enabled'] },
    ],
  },
];

export const CLAUDE_SETTINGS: CliSettingsSchema = {
  provider: 'claude-code',
  name: 'Claude Code',
  keyPrefix: 'cliSettings',
  groups: CLAUDE_SETTINGS_GROUPS,
  envPath: ['env'],
  hints: { scope: 'cliSettings.scopeHint', moreInRaw: 'cliSettings.moreInRaw', env: 'cliSettings.envHint', rawHidden: 'cliSettings.rawHiddenHint' },
};

// Codex CLI `config.toml` keys as of codex-cli 0.162 (config.schema.json).
// `approval_policy = "untrusted"` is a hard error there, so it is not offered.
const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export const CODEX_SETTINGS: CliSettingsSchema = {
  provider: 'codex',
  name: 'Codex',
  keyPrefix: 'cliSettings.codex',
  envPath: ['shell_environment_policy', 'set'],
  hints: {
    scope: 'cliSettings.codex.scopeHint',
    moreInRaw: 'cliSettings.codex.moreInRaw',
    env: 'cliSettings.codex.envHint',
    rawHidden: 'cliSettings.codex.rawHiddenHint',
  },
  groups: [
    {
      id: 'model',
      fields: [
        { kind: 'text', path: ['model'], placeholder: 'gpt-5.5' },
        { kind: 'enum', path: ['model_reasoning_effort'], options: CODEX_EFFORTS },
        { kind: 'enum', path: ['plan_mode_reasoning_effort'], options: CODEX_EFFORTS },
        { kind: 'enum', path: ['model_reasoning_summary'], options: ['auto', 'concise', 'detailed', 'none'] },
        { kind: 'enum', path: ['model_verbosity'], options: ['low', 'medium', 'high'] },
        { kind: 'enum', path: ['service_tier'], options: ['default', 'fast', 'flex'] },
        { kind: 'text', path: ['review_model'] },
      ],
    },
    {
      id: 'permissions',
      fields: [
        { kind: 'enum', path: ['approval_policy'], options: ['on-request', 'never'] },
        { kind: 'enum', path: ['approvals_reviewer'], options: ['user', 'auto_review'] },
        { kind: 'enum', path: ['sandbox_mode'], options: ['read-only', 'workspace-write', 'danger-full-access'] },
        { kind: 'bool', path: ['sandbox_workspace_write', 'network_access'] },
        { kind: 'lines', path: ['sandbox_workspace_write', 'writable_roots'], placeholder: '/home/me/.cache' },
        { kind: 'bool', path: ['sandbox_workspace_write', 'exclude_slash_tmp'] },
        { kind: 'bool', path: ['sandbox_workspace_write', 'exclude_tmpdir_env_var'] },
      ],
    },
    {
      id: 'tools',
      fields: [
        { kind: 'enum', path: ['web_search'], options: ['disabled', 'cached', 'indexed', 'live'] },
        { kind: 'bool', path: ['features', 'memories'] },
        { kind: 'bool', path: ['features', 'multi_agent'] },
        { kind: 'bool', path: ['features', 'shell_snapshot'] },
        { kind: 'bool', path: ['features', 'prevent_idle_sleep'] },
        { kind: 'enum', path: ['shell_environment_policy', 'inherit'], options: ['all', 'core', 'none'] },
      ],
    },
    {
      id: 'instructions',
      fields: [
        { kind: 'longtext', path: ['developer_instructions'] },
        { kind: 'integer', path: ['project_doc_max_bytes'], min: 0, max: 10_485_760 },
        { kind: 'lines', path: ['project_doc_fallback_filenames'], placeholder: 'CLAUDE.md' },
        { kind: 'enum', path: ['history', 'persistence'], options: ['save-all', 'none'] },
        { kind: 'integer', path: ['history', 'max_bytes'], min: 0, max: 1_073_741_824 },
      ],
    },
    {
      id: 'interface',
      fields: [
        { kind: 'text', path: ['tui', 'theme'], placeholder: 'catppuccin-mocha' },
        { kind: 'enum', path: ['tui', 'alternate_screen'], options: ['auto', 'always', 'never'] },
        { kind: 'bool', path: ['tui', 'notifications'] },
        { kind: 'enum', path: ['tui', 'notification_condition'], options: ['unfocused', 'always'] },
        { kind: 'bool', path: ['tui', 'animations'] },
        { kind: 'bool', path: ['tui', 'show_tooltips'] },
        { kind: 'bool', path: ['tui', 'vim_mode_default'] },
        { kind: 'bool', path: ['hide_agent_reasoning'] },
        { kind: 'bool', path: ['show_raw_agent_reasoning'] },
        { kind: 'enum', path: ['file_opener'], options: ['vscode', 'vscode-insiders', 'windsurf', 'cursor', 'none'] },
      ],
    },
    {
      id: 'advanced',
      fields: [
        { kind: 'bool', path: ['check_for_update_on_startup'] },
        { kind: 'enum', path: ['cli_auth_credentials_store'], options: ['file', 'keyring', 'auto', 'ephemeral'] },
        { kind: 'bool', path: ['analytics', 'enabled'] },
        { kind: 'bool', path: ['feedback', 'enabled'] },
      ],
    },
  ],
};

// Pi `settings.json` keys as of Pi 1.1 (docs/settings.md). Pi rewrites the
// file itself when settings change in its /settings panel.
export const PI_SETTINGS: CliSettingsSchema = {
  provider: 'pi',
  name: 'Pi',
  keyPrefix: 'cliSettings.pi',
  hints: { scope: 'cliSettings.pi.scopeHint', moreInRaw: 'cliSettings.pi.moreInRaw', rawHidden: 'cliSettings.pi.rawHiddenHint' },
  groups: [
    {
      id: 'model',
      fields: [
        { kind: 'text', path: ['defaultProvider'], placeholder: 'anthropic' },
        { kind: 'text', path: ['defaultModel'], placeholder: 'claude-opus-4-5' },
        { kind: 'enum', path: ['defaultThinkingLevel'], options: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
        { kind: 'lines', path: ['enabledModels'], placeholder: 'anthropic/*' },
        { kind: 'bool', path: ['hideThinkingBlock'] },
        { kind: 'enum', path: ['cacheWarming'], options: ['off', 'streaming', 'idle'] },
      ],
    },
    {
      id: 'interaction',
      fields: [
        { kind: 'enum', path: ['steeringMode'], options: ['one-at-a-time', 'all'] },
        { kind: 'enum', path: ['followUpMode'], options: ['one-at-a-time', 'all'] },
        { kind: 'enum', path: ['doubleEscapeAction'], options: ['tree', 'fork', 'none'] },
        { kind: 'enum', path: ['defaultProjectTrust'], options: ['ask', 'always', 'never'] },
        { kind: 'lines', path: ['defaultTools'], placeholder: 'read' },
        { kind: 'bool', path: ['enableSkillCommands'] },
      ],
    },
    {
      id: 'context',
      fields: [
        { kind: 'bool', path: ['compaction', 'enabled'] },
        { kind: 'integer', path: ['compaction', 'reserveTokens'], min: 0, max: 1_000_000 },
        { kind: 'integer', path: ['compaction', 'keepRecentTokens'], min: 0, max: 1_000_000 },
        { kind: 'text', path: ['sessionDir'], placeholder: '~/.pi/agent/sessions' },
      ],
    },
    {
      id: 'interface',
      fields: [
        { kind: 'enum', path: ['theme'], options: ['system', 'dark', 'light'] },
        { kind: 'enum', path: ['quietStartup'], options: [false, 'header', true] },
        { kind: 'enum', path: ['tuiMode'], options: ['fullscreen', 'regular'] },
        { kind: 'integer', path: ['editorPaddingX'], min: 0, max: 3 },
        { kind: 'integer', path: ['autocompleteMaxVisible'], min: 3, max: 20 },
        { kind: 'enum', path: ['markdown', 'mermaid'], options: ['streaming', 'final', 'off'] },
        { kind: 'bool', path: ['terminal', 'showImages'] },
        { kind: 'bool', path: ['images', 'autoResize'] },
        { kind: 'bool', path: ['images', 'blockImages'] },
        { kind: 'bool', path: ['collapseChangelog'] },
      ],
    },
    {
      id: 'network',
      fields: [
        { kind: 'enum', path: ['transport'], options: ['auto', 'sse', 'websocket', 'websocket-cached'] },
        { kind: 'text', path: ['httpProxy'], placeholder: 'http://127.0.0.1:7890' },
        { kind: 'bool', path: ['retry', 'enabled'] },
        { kind: 'integer', path: ['retry', 'maxRetries'], min: 0, max: 100 },
        { kind: 'text', path: ['shellPath'], placeholder: '/bin/bash' },
        { kind: 'text', path: ['shellCommandPrefix'], placeholder: 'shopt -s expand_aliases' },
      ],
    },
    {
      id: 'privacy',
      fields: [
        { kind: 'bool', path: ['enableInstallTelemetry'] },
        { kind: 'bool', path: ['enableAnalytics'] },
      ],
    },
  ],
};

export const CLI_SETTINGS: Record<CliSettingsProvider, CliSettingsSchema> = {
  'claude-code': CLAUDE_SETTINGS,
  codex: CODEX_SETTINGS,
  pi: PI_SETTINGS,
};

export function hasCliSettings(provider: string): provider is CliSettingsProvider {
  return provider in CLI_SETTINGS;
}

/** Select option id for a value (the JSON text, so `true` and `"true"` differ). */
export function optionId(value: unknown): string {
  return JSON.stringify(value);
}

/** Stable id for a field path, also its i18n key suffix. */
export function fieldId(path: string[]): string {
  return path.join('.');
}

function isObject(value: unknown): value is SettingsObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getAt(settings: SettingsObject, path: string[]): unknown {
  let current: unknown = settings;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * A copy of `settings` with `path` set to `value`; `undefined` removes the
 * key, and parent objects left empty by the removal go with it.
 */
export function setAt(settings: SettingsObject, path: string[], value: unknown): SettingsObject {
  const [key, ...rest] = path;
  const next = { ...settings };
  if (rest.length === 0) {
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  }
  const child = isObject(next[key]) ? next[key] as SettingsObject : {};
  const updated = setAt(child, rest, value);
  if (Object.keys(updated).length === 0 && value === undefined) delete next[key];
  else next[key] = updated;
  return next;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The RFC 7386 merge patch that turns `before` into `after`. */
export function mergePatch(before: SettingsObject, after: SettingsObject): SettingsObject {
  const patch: SettingsObject = {};
  for (const key of Object.keys(before)) {
    if (!(key in after)) patch[key] = null;
  }
  for (const [key, value] of Object.entries(after)) {
    const previous = before[key];
    if (isObject(previous) && isObject(value)) {
      const nested = mergePatch(previous, value);
      if (Object.keys(nested).length > 0) patch[key] = nested;
    } else if (!sameJson(previous, value)) {
      patch[key] = value;
    }
  }
  return patch;
}

/** Applies a merge patch, as the backend does. */
export function applyMergePatch(target: SettingsObject, patch: SettingsObject): SettingsObject {
  const next = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (isObject(value)) next[key] = applyMergePatch(isObject(next[key]) ? next[key] as SettingsObject : {}, value);
    else next[key] = value;
  }
  return next;
}

/** The env map at `path` as editable rows; non-string values are shown as JSON. */
export function envRows(settings: SettingsObject, path: string[]): { name: string; value: string }[] {
  const env = getAt(settings, path);
  if (!isObject(env)) return [];
  return Object.entries(env).map(([name, value]) => ({ name, value: typeof value === 'string' ? value : JSON.stringify(value) }));
}

/** Rows back into an env map; blank names are dropped, later duplicates win. `undefined` when empty. */
export function envFromRows(rows: { name: string; value: string }[]): SettingsObject | undefined {
  const env: SettingsObject = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) env[name] = row.value;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

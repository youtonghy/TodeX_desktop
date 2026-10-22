import type { ManagedProviderAgent } from '@todex/protocol/v2';

export const MASKED_SECRET = '__TODEX_MASKED__';

/// Pi models.json thinking levels; OpenCode variants omit `off` — a variant
/// *is* an effort choice there, so "no thinking" is simply absent.
export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const OPENCODE_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/// Codex `model_reasoning_effort` values (codex-rs `ReasoningEffort`); rarer
/// or model-defined ones stay editable through JSON mode.
export const CODEX_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/// DeepSeek Harness routes take pi-ai's levels, which match Pi's.
const usesPiLevels = (agent: ManagedProviderAgent) => agent === 'pi' || agent === 'deepseek-harness';

export function thinkingLevelsFor(agent: ManagedProviderAgent): readonly string[] {
  return usesPiLevels(agent) ? PI_THINKING_LEVELS : OPENCODE_THINKING_LEVELS;
}

/// Enabled levels when a model gains reasoning support without an existing
/// map: matches what Pi/OpenCode expose for an unconfigured reasoning model.
export function defaultEfforts(agent: ManagedProviderAgent): string[] {
  return usesPiLevels(agent) ? ['off', 'minimal', 'low', 'medium', 'high'] : ['low', 'medium', 'high'];
}

/// DeepSeek Harness: dsh's built-in DeepSeek route (key and endpoint only)
/// and the wire protocols its OpenAI/Anthropic-compatible routes speak.
export const DSH_DEEPSEEK_ROUTE = 'deepseek-official';
export const DSH_API_KINDS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const;

/// Claude Code `env` switches that pick a cloud platform; a provider profile
/// owns them along with every `ANTHROPIC_*` variable.
const CLAUDE_MANAGED_ENV_SWITCHES = new Set(['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']);
/// Top-level Claude Code settings keys a provider profile owns (besides the
/// managed `env` entries).
const CLAUDE_MANAGED_TOP_LEVEL_KEYS = new Set(['model', 'apiKeyHelper']);

/** Whether a Claude Code settings key is owned by the active provider
 * profile, so switching profiles rewrites (or removes) it. `scope` is `env`
 * for variables inside `env`, `top` for top-level settings keys.
 *
 * Must stay in sync with the managed-key list in the backend's
 * `src/agent_providers/claude.rs`, which is authoritative: only those keys
 * are written to (and cleared from) settings.json on activate and delete. */
export function isClaudeManagedKey(scope: 'env' | 'top', name: string): boolean {
  return scope === 'env'
    ? name.startsWith('ANTHROPIC_') || CLAUDE_MANAGED_ENV_SWITCHES.has(name)
    : CLAUDE_MANAGED_TOP_LEVEL_KEYS.has(name);
}

/** Keys of a Claude Code profile's settingsConfig that the backend no longer
 * writes when switching to it: unmanaged top-level keys as is, unmanaged
 * `env` variables as `env.NAME`. */
export function claudeUnmanagedKeys(settingsConfig: unknown): string[] {
  const settings = asRecord(settingsConfig);
  return Object.entries(settings).flatMap(([key, value]) => {
    if (key === 'env') {
      return Object.keys(asRecord(value)).filter((name) => !isClaudeManagedKey('env', name)).map((name) => `env.${name}`);
    }
    return isClaudeManagedKey('top', key) ? [] : [key];
  });
}

/** Agents whose providers live side by side, one of them the default. */
export function isAdditiveAgent(agent: ManagedProviderAgent): boolean {
  return agent === 'pi' || agent === 'opencode' || agent === 'deepseek-harness';
}

/// Per-model editor row shared by the additive agents: the form edits this
/// normalized shape; buildSettingsConfig maps it back to each native schema.
export type ModelFormEntry = {
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  efforts: string[];
};

export const emptyModelEntry = (id: string): ModelFormEntry => ({
  id,
  name: '',
  contextWindow: '',
  maxTokens: '',
  reasoning: false,
  efforts: [],
});

/// Grok Build credential source: the `grok login` session kept in auth.json
/// (official subscription) or a per-model API key in config.toml.
export type GrokAuthMode = 'subscription' | 'api';

export const GROK_API_BACKENDS = ['chat_completions', 'responses', 'messages'] as const;

/// Public xAI API endpoint Grok Build uses when a model sets no base_url.
export const GROK_XAI_BASE_URL = 'https://api.x.ai/v1';

export type ProviderFormValues = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
  /** Pi `api`; Grok Build `api_backend`. */
  apiKind: string;
  authMode: GrokAuthMode;
  /** Codex `model_context_window` (top-level TOML number). */
  contextWindow: string;
  models: ModelFormEntry[];
};

export const emptyFormValues: ProviderFormValues = {
  name: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  reasoningEffort: '',
  apiKind: '',
  authMode: 'api',
  contextWindow: '',
  models: [],
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberField(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function parsePositiveInt(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function codexConfigText(settings: Record<string, unknown> | undefined): string {
  return asString(settings?.config);
}

/** Selects TOML tables by header: a string matches as a name prefix, a
 * function decides exactly. */
type TableMatcher = string | ((name: string) => boolean);

function tableMatches(matcher: TableMatcher | undefined, name: string): boolean {
  if (matcher === undefined) return true;
  return typeof matcher === 'string' ? name.startsWith(matcher) : matcher(name);
}

function tableHeader(line: string): string | undefined {
  return line.match(/^\s*\[([^\]]+)\]/)?.[1].trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pull the scalar named `key` out of a TOML document's top level or a table. */
function tomlScalar(text: string, key: string, withinTable?: TableMatcher): string {
  let inTargetTable = withinTable === undefined;
  for (const line of text.split('\n')) {
    const header = tableHeader(line);
    if (header !== undefined) {
      inTargetTable = withinTable !== undefined && tableMatches(withinTable, header);
      continue;
    }
    if (!inTargetTable) continue;
    const match = line.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`));
    if (match) return match[1];
  }
  return '';
}

/** Reads a bare integer `key = <n>` from the TOML top level. */
function tomlNumber(text: string, key: string): string {
  let inTable = false;
  for (const line of text.split('\n')) {
    if (/^\s*\[[^\]]+\]/.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable) continue;
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)`));
    if (match) return match[1];
  }
  return '';
}

/** Replaces `key = "…"` lines in the TOML top level or a matching table.
 * Inserts the key when absent instead of dropping user config: into the
 * first matching table, or a new `[newTable]` (defaults to a string matcher). */
function patchTomlScalar(
  text: string,
  key: string,
  value: string,
  withinTable?: TableMatcher,
  newTable: string | undefined = typeof withinTable === 'string' ? withinTable : undefined,
): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const assignment = `${key} = "${escaped}"`;
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  const lines = text.split('\n');
  let inTargetTable = withinTable === undefined;
  let replaced = false;
  let firstTableLine = -1;
  const out = lines.map((line, index) => {
    const header = tableHeader(line);
    if (header !== undefined) {
      inTargetTable = withinTable !== undefined && tableMatches(withinTable, header);
      if (inTargetTable && firstTableLine < 0) firstTableLine = index;
      return line;
    }
    if (!inTargetTable || replaced) return line;
    if (keyPattern.test(line)) {
      replaced = true;
      return assignment;
    }
    return line;
  });
  if (replaced) return out.join('\n');
  if (withinTable === undefined) {
    return `${assignment}\n${text.startsWith('\n') ? '' : '\n'}${text}`;
  }
  if (firstTableLine >= 0) {
    // Table exists without the key: a second header would be invalid TOML.
    out.splice(firstTableLine + 1, 0, assignment);
    return out.join('\n');
  }
  if (newTable === undefined) return text;
  const head = text.trimEnd();
  return `${head}${head ? '\n\n' : ''}[${newTable}]\n${assignment}\n`;
}

/** Drops `key = …` lines on the TOML top level or inside the matching tables. */
function removeTomlKey(text: string, key: string, withinTable?: TableMatcher): string {
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  let inTargetTable = withinTable === undefined;
  return text
    .split('\n')
    .filter((line) => {
      const header = tableHeader(line);
      if (header !== undefined) {
        inTargetTable = withinTable !== undefined && tableMatches(withinTable, header);
        return true;
      }
      return !(inTargetTable && keyPattern.test(line));
    })
    .join('\n');
}

/** Like patchTomlScalar but writes a bare integer on the TOML top level. */
function patchTomlNumber(text: string, key: string, value: number): string {
  const lines = text.split('\n');
  let inTable = false;
  let replaced = false;
  const out = lines.map((line) => {
    if (/^\s*\[[^\]]+\]/.test(line)) {
      inTable = true;
      return line;
    }
    if (inTable || replaced) return line;
    if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
      replaced = true;
      return `${key} = ${value}`;
    }
    return line;
  });
  if (replaced) return out.join('\n');
  return `${key} = ${value}\n${text.startsWith('\n') ? '' : '\n'}${text}`;
}

const CODEX_CONFIG_TEMPLATE = `model_provider = "custom"
model = "gpt-5"

[model_providers.custom]
name = "Custom"
base_url = "https://example.com/v1"
wire_api = "responses"
requires_openai_auth = true
`;

const isModelsTable = (name: string) => name === 'models';

/** `[model.<id>]` header for a Grok Build model entry (quoted unless bare). */
function grokModelHeader(id: string): string {
  return /^[A-Za-z0-9_-]+$/.test(id) ? `model.${id}` : `model."${id.replace(/"/g, '\\"')}"`;
}

function grokModelTable(id: string): (name: string) => boolean {
  const accepted = new Set([`model.${id}`, `model."${id}"`, `model.'${id}'`, grokModelHeader(id)]);
  return (name) => accepted.has(name);
}

type GrokAuthScope = { scope: string; entry: Record<string, unknown> };

function grokAuthScopes(settings: Record<string, unknown>): GrokAuthScope[] {
  return Object.entries(asRecord(settings.auth)).map(([scope, entry]) => ({ scope, entry: asRecord(entry) }));
}

/** Key from a `grok login --api-key` scope, which lives in auth.json. */
function grokAuthApiKey(settings: Record<string, unknown>): string {
  return asString(grokAuthScopes(settings).find(({ entry }) => entry.auth_mode === 'api_key')?.entry.key);
}

function grokHasSession(settings: Record<string, unknown>): boolean {
  return grokAuthScopes(settings).some(({ entry }) => entry.auth_mode !== 'api_key');
}

/** The `[models].default` entry: its catalog key, whether a `[model.<key>]`
 * table exists, and the model id sent to the API (`model`, else the key). */
function grokModelFields(config: string) {
  const key = tomlScalar(config, 'default', isModelsTable);
  const table = key ? grokModelTable(key) : () => false;
  return {
    key,
    hasTable: Boolean(key) && config.split('\n').some((line) => {
      const header = tableHeader(line);
      return header !== undefined && table(header);
    }),
    model: tomlScalar(config, 'model', table) || key,
    apiKey: tomlScalar(config, 'api_key', table),
    baseUrl: tomlScalar(config, 'base_url', table),
    apiBackend: tomlScalar(config, 'api_backend', table),
  };
}

function grokExtract(settings: Record<string, unknown>, isNew: boolean) {
  const fields = grokModelFields(codexConfigText(settings));
  const authApiKey = grokAuthApiKey(settings);
  const authMode: GrokAuthMode = grokHasSession(settings)
    ? 'subscription'
    : fields.apiKey || fields.baseUrl || authApiKey || isNew
      ? 'api'
      : 'subscription';
  return { ...fields, apiKey: fields.apiKey || authApiKey, authMode };
}

/// Subscription: keep the stored `grok login` session and let it
/// authenticate the default model (a per-model api_key would win over it).
/// API: `[models].default` points at a `[model.<key>]` entry carrying the
/// key. An existing entry keeps its catalog key when the model id changes so
/// a masked api_key still restores against the stored profile. auth.json is
/// dropped on activation unless it only holds an unchanged
/// `grok login --api-key` scope.
function grokSettingsFromForm(
  form: ProviderFormValues,
  previous: Record<string, unknown>,
): Record<string, unknown> {
  let config = codexConfigText(previous);
  const before = grokModelFields(config);
  const model = form.model.trim() || before.model;
  const previousAuth = previous.auth && typeof previous.auth === 'object' ? previous.auth : null;
  if (form.authMode === 'subscription') {
    if (model) {
      const key = before.hasTable && before.model === model ? before.key : model;
      config = patchTomlScalar(config, 'default', key, isModelsTable, 'models');
      config = removeTomlKey(config, 'api_key', grokModelTable(key));
    }
    return { auth: previousAuth, config };
  }
  const authApiKey = grokAuthApiKey(previous);
  const keepAuthKey = !before.apiKey && Boolean(authApiKey) && form.apiKey.trim() === authApiKey
    && !grokHasSession(previous);
  if (!model) return { auth: keepAuthKey ? previousAuth : null, config };
  const key = before.hasTable ? before.key : model;
  const table = grokModelTable(key);
  const header = grokModelHeader(key);
  config = patchTomlScalar(config, 'default', key, isModelsTable, 'models');
  config = patchTomlScalar(config, 'model', model, table, header);
  const baseUrl = form.baseUrl.trim() || tomlScalar(config, 'base_url', table) || GROK_XAI_BASE_URL;
  config = patchTomlScalar(config, 'base_url', baseUrl, table, header);
  if (form.apiKey.trim() && !keepAuthKey) config = patchTomlScalar(config, 'api_key', form.apiKey.trim(), table, header);
  if (form.apiKind.trim()) config = patchTomlScalar(config, 'api_backend', form.apiKind.trim(), table, header);
  if (form.name.trim()) config = patchTomlScalar(config, 'name', form.name.trim(), table, header);
  return { auth: keepAuthKey ? previousAuth : null, config };
}

/** Anything carrying a stored/live provider config — a profile, or an
 * unmanaged live node wrapped as `{ name, settingsConfig }`. */
export type ProviderConfigSource = {
  name?: string;
  settingsConfig?: unknown;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function piEntryToForm(entry: Record<string, unknown>): ModelFormEntry {
  const map = asRecord(entry.thinkingLevelMap);
  const reasoning = entry.reasoning === true;
  return {
    id: asString(entry.id),
    name: asString(entry.name),
    contextWindow: numberField(entry.contextWindow),
    maxTokens: numberField(entry.maxTokens),
    reasoning,
    // Mirrors the backend's pi_supported_thinking_levels: absent means enabled
    // for the classic levels; xhigh/max must be declared; null disables.
    efforts: reasoning
      ? PI_THINKING_LEVELS.filter((level) => {
          if (map[level] === null) return false;
          if (level === 'xhigh' || level === 'max') return level in map;
          return true;
        })
      : [],
  };
}

/// A dsh pi-ai model: `reasoningEfforts` maps each offered level to its wire
/// value (`null` turns one off, `false` turns reasoning off).
function dshEntryToForm(entry: Record<string, unknown>): ModelFormEntry {
  const efforts = entry.reasoningEfforts;
  const reasoning = Boolean(efforts) && typeof efforts === 'object';
  const map = asRecord(efforts);
  return {
    id: asString(entry.id),
    name: asString(entry.name),
    contextWindow: numberField(entry.contextWindow),
    maxTokens: numberField(entry.maxTokens),
    reasoning,
    efforts: reasoning ? PI_THINKING_LEVELS.filter((level) => level in map && map[level] !== null) : [],
  };
}

function opencodeEntryToForm(id: string, entry: Record<string, unknown>): ModelFormEntry {
  const limit = asRecord(entry.limit);
  const variants = asRecord(entry.variants);
  return {
    id,
    name: asString(entry.name),
    contextWindow: numberField(limit.context),
    maxTokens: numberField(limit.output),
    reasoning: entry.reasoning === true,
    efforts: OPENCODE_THINKING_LEVELS.filter(
      (level) => level in variants && asRecord(variants[level]).disabled !== true,
    ),
  };
}

/// The `env` variable holding a Claude Code profile's key:
/// `ANTHROPIC_AUTH_TOKEN` wins, as in Claude Code itself; a profile that only
/// has `ANTHROPIC_API_KEY` keeps using it.
function claudeApiKeyEnvName(env: Record<string, unknown>): 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY' {
  return env.ANTHROPIC_AUTH_TOKEN == null && env.ANTHROPIC_API_KEY != null ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN';
}

export function extractFormValues(
  agent: ManagedProviderAgent,
  source?: ProviderConfigSource,
): ProviderFormValues {
  const settings = asRecord(source?.settingsConfig);
  const base = { ...emptyFormValues, name: source?.name ?? '' };
  switch (agent) {
    case 'claude-code': {
      const env = asRecord(settings.env);
      return {
        ...base,
        baseUrl: asString(env.ANTHROPIC_BASE_URL),
        apiKey: asString(env[claudeApiKeyEnvName(env)]),
        model: asString(env.ANTHROPIC_MODEL),
      };
    }
    case 'codex': {
      const config = codexConfigText(settings);
      const auth = asRecord(settings.auth);
      return {
        ...base,
        baseUrl: tomlScalar(config, 'base_url', 'model_providers.'),
        apiKey: asString(auth.OPENAI_API_KEY),
        model: tomlScalar(config, 'model'),
        reasoningEffort: tomlScalar(config, 'model_reasoning_effort'),
        contextWindow: tomlNumber(config, 'model_context_window'),
      };
    }
    case 'grok-build': {
      const grok = grokExtract(settings, source === undefined);
      return {
        ...base,
        authMode: grok.authMode,
        baseUrl: grok.baseUrl,
        apiKey: grok.apiKey,
        model: grok.model,
        apiKind: grok.apiBackend,
      };
    }
    case 'opencode': {
      const options = asRecord(settings.options);
      return {
        ...base,
        baseUrl: asString(options.baseURL ?? options.baseUrl),
        apiKey: asString(options.apiKey),
        models: Object.entries(asRecord(settings.models)).map(([id, entry]) =>
          opencodeEntryToForm(id, asRecord(entry)),
        ),
      };
    }
    case 'pi': {
      const models = Array.isArray(settings.models) ? settings.models : [];
      return {
        ...base,
        baseUrl: asString(settings.baseUrl),
        apiKey: asString(settings.apiKey),
        apiKind: asString(settings.api),
        models: models.map((model) => piEntryToForm(asRecord(model))).filter((m) => m.id),
      };
    }
    case 'deepseek-harness': {
      const models = Array.isArray(settings.models) ? settings.models : [];
      return {
        ...base,
        baseUrl: asString(settings.baseURL),
        apiKey: asString(settings.apiKey),
        apiKind: asString(settings.api),
        models: models.map((model) => dshEntryToForm(asRecord(model))).filter((m) => m.id),
      };
    }
  }
}

export function modelIdsFromText(modelsText: string): string[] {
  return modelsText
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function codexConfigFromForm(
  form: ProviderFormValues,
  existing: Record<string, unknown> | undefined,
): string {
  let config = codexConfigText(existing).trim() || CODEX_CONFIG_TEMPLATE;
  if (form.model.trim()) config = patchTomlScalar(config, 'model', form.model.trim());
  // An empty effort or window means Codex's per-model default: drop the key.
  const effort = form.reasoningEffort.trim();
  config = effort
    ? patchTomlScalar(config, 'model_reasoning_effort', effort)
    : removeTomlKey(config, 'model_reasoning_effort');
  const contextWindow = parsePositiveInt(form.contextWindow);
  config = contextWindow
    ? patchTomlNumber(config, 'model_context_window', contextWindow)
    : removeTomlKey(config, 'model_context_window');
  const providerTable = tomlScalar(config, 'model_provider') || 'custom';
  config = patchTomlScalar(config, 'model_provider', providerTable);
  if (form.baseUrl.trim()) {
    config = patchTomlScalar(config, 'base_url', form.baseUrl.trim(), `model_providers.${providerTable}`);
  }
  if (form.name.trim()) {
    config = patchTomlScalar(config, 'name', form.name.trim(), `model_providers.${providerTable}`);
  }
  return config;
}

function applyName(entry: Record<string, unknown>, model: ModelFormEntry) {
  const name = model.name.trim();
  if (name) entry.name = name;
  else delete entry.name;
}

function applyReasoningFlag(entry: Record<string, unknown>, model: ModelFormEntry, existing: Record<string, unknown>) {
  if (model.reasoning) entry.reasoning = true;
  else if ('reasoning' in existing) entry.reasoning = false;
  else delete entry.reasoning;
}

/// Pi `models[]` entry: reasoning levels land in thinkingLevelMap where an
/// enabled level keeps its existing provider mapping (identity by default)
/// and a disabled level is `null`. The map is left alone when reasoning is
/// off so re-enabling restores the previous choices.
function piModelEntry(model: ModelFormEntry, existing: Record<string, unknown>): Record<string, unknown> {
  const entry: Record<string, unknown> = { ...existing, id: model.id };
  applyName(entry, model);
  const contextWindow = parsePositiveInt(model.contextWindow);
  if (contextWindow) entry.contextWindow = contextWindow;
  else delete entry.contextWindow;
  const maxTokens = parsePositiveInt(model.maxTokens);
  if (maxTokens) entry.maxTokens = maxTokens;
  else delete entry.maxTokens;
  applyReasoningFlag(entry, model, existing);
  if (model.reasoning) {
    const previous = asRecord(existing.thinkingLevelMap);
    const map: Record<string, unknown> = {};
    for (const level of PI_THINKING_LEVELS) {
      map[level] = model.efforts.includes(level)
        ? (typeof previous[level] === 'string' ? previous[level] : level)
        : null;
    }
    entry.thinkingLevelMap = map;
  }
  return entry;
}

/// dsh pi-ai `models[]` entry: offered levels keep their existing wire value
/// (the level name by default), the others are `null`; turning reasoning off
/// writes `false` only when the entry had a map, so the catalog's capability
/// otherwise still applies.
function dshModelEntry(model: ModelFormEntry, existing: Record<string, unknown>): Record<string, unknown> {
  const entry: Record<string, unknown> = { ...existing, id: model.id };
  applyName(entry, model);
  const contextWindow = parsePositiveInt(model.contextWindow);
  if (contextWindow) entry.contextWindow = contextWindow;
  else delete entry.contextWindow;
  const maxTokens = parsePositiveInt(model.maxTokens);
  if (maxTokens) entry.maxTokens = maxTokens;
  else delete entry.maxTokens;
  if (model.reasoning) {
    const previous = asRecord(existing.reasoningEfforts);
    entry.reasoningEfforts = Object.fromEntries(PI_THINKING_LEVELS.map((level) => [
      level,
      model.efforts.includes(level) ? (typeof previous[level] === 'string' ? previous[level] : level) : null,
    ]));
  } else if ('reasoningEfforts' in existing) {
    entry.reasoningEfforts = false;
  }
  return entry;
}

/// OpenCode `models.<id>` entry: context/output live under `limit` (the pair
/// is required by the config schema), effort choices are `variants` named by
/// level carrying `{reasoningEffort}`; unchecking an existing variant keeps
/// it with `disabled: true` so catalog-supplied variants can be turned off.
function opencodeModelEntry(model: ModelFormEntry, existing: Record<string, unknown>): Record<string, unknown> {
  const entry: Record<string, unknown> = { ...existing };
  applyName(entry, model);
  const context = parsePositiveInt(model.contextWindow);
  const output = parsePositiveInt(model.maxTokens);
  const previousLimit = asRecord(existing.limit);
  if (context || output) {
    const resolvedContext = context ?? positiveInt(previousLimit.context);
    const resolvedOutput = output ?? positiveInt(previousLimit.output);
    if (resolvedContext && resolvedOutput) {
      entry.limit = { ...previousLimit, context: resolvedContext, output: resolvedOutput };
    } else {
      // Incomplete pair: validateModelForm reports it before save.
      delete entry.limit;
    }
  } else {
    delete entry.limit;
  }
  applyReasoningFlag(entry, model, existing);
  const previousVariants = asRecord(existing.variants);
  const variants: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(previousVariants)) {
    if (!(OPENCODE_THINKING_LEVELS as readonly string[]).includes(key)) variants[key] = value;
  }
  for (const level of OPENCODE_THINKING_LEVELS) {
    const previous = previousVariants[level];
    if (model.efforts.includes(level)) {
      const merged: Record<string, unknown> = { ...asRecord(previous), reasoningEffort: level };
      delete merged.disabled;
      variants[level] = merged;
    } else if (previous !== undefined) {
      variants[level] = { ...asRecord(previous), disabled: true };
    }
  }
  if (Object.keys(variants).length) entry.variants = variants;
  else delete entry.variants;
  return entry;
}

/// Form-level validation for the structured model fields; returns an i18n
/// key on failure. buildSettingsConfig stays total — invalid numbers are
/// dropped there — so the editor surfaces the error before saving.
export function validateModelForm(
  agent: ManagedProviderAgent,
  form: ProviderFormValues,
  existing?: ProviderConfigSource,
): 'ap.invalidNumber' | 'ap.outputRequired' | 'ap.modelRequired' | null {
  const invalid = (text: string) => text.trim() !== '' && parsePositiveInt(text) === undefined;
  if (agent === 'codex') return invalid(form.contextWindow) ? 'ap.invalidNumber' : null;
  if (agent === 'grok-build') return form.authMode === 'api' && !form.model.trim() ? 'ap.modelRequired' : null;
  if (!isAdditiveAgent(agent)) return null;
  const settings = asRecord(existing?.settingsConfig);
  const existingModels =
    agent !== 'opencode'
      ? Object.fromEntries(
          (Array.isArray(settings.models) ? settings.models : [])
            .map((model) => [asString(asRecord(model).id), model])
            .filter(([id]) => id),
        )
      : asRecord(settings.models);
  for (const model of form.models) {
    if (invalid(model.contextWindow) || invalid(model.maxTokens)) return 'ap.invalidNumber';
    if (agent === 'opencode') {
      const hasContext = model.contextWindow.trim() !== '';
      const hasOutput = model.maxTokens.trim() !== '';
      if (hasContext !== hasOutput) {
        const limit = asRecord(asRecord(existingModels[model.id]).limit);
        const fallback = hasContext ? positiveInt(limit.output) : positiveInt(limit.context);
        if (!fallback) return 'ap.outputRequired';
      }
    }
  }
  return null;
}

/** Build the settingsConfig written on save. Masked secrets pass through
 * unchanged — the backend restores the stored value server-side. */
export function buildSettingsConfig(
  agent: ManagedProviderAgent,
  form: ProviderFormValues,
  existing?: ProviderConfigSource,
): Record<string, unknown> {
  const previous = asRecord(existing?.settingsConfig);
  switch (agent) {
    case 'claude-code': {
      const env: Record<string, unknown> = { ...asRecord(previous.env) };
      // The key goes back where extractFormValues read it from, so a masked
      // value resolves against the same path on the backend.
      const keyName = claudeApiKeyEnvName(env);
      const fields: [string, string][] = [
        ['ANTHROPIC_BASE_URL', form.baseUrl],
        [keyName, form.apiKey],
        ['ANTHROPIC_MODEL', form.model],
      ];
      for (const [name, value] of fields) {
        if (value.trim()) env[name] = value.trim();
        else delete env[name];
      }
      // A cleared key clears the credential, not just the variable shown.
      if (!form.apiKey.trim()) {
        delete env.ANTHROPIC_AUTH_TOKEN;
        delete env.ANTHROPIC_API_KEY;
      }
      return { ...previous, env };
    }
    case 'codex': {
      const auth = form.apiKey.trim()
        ? { OPENAI_API_KEY: form.apiKey.trim() }
        : asRecord(previous.auth);
      return { auth, config: codexConfigFromForm(form, previous) };
    }
    case 'grok-build':
      return grokSettingsFromForm(form, previous);
    case 'opencode': {
      const options = { ...asRecord(previous.options) };
      if (form.baseUrl.trim()) options.baseURL = form.baseUrl.trim();
      if (form.apiKey.trim()) options.apiKey = form.apiKey.trim();
      const existingModels = asRecord(previous.models);
      const models = Object.fromEntries(
        form.models.map((model) => [
          model.id,
          opencodeModelEntry(model, asRecord(existingModels[model.id])),
        ]),
      );
      return { ...previous, options, models };
    }
    case 'pi': {
      const existingById = new Map<string, Record<string, unknown>>();
      if (Array.isArray(previous.models)) {
        for (const model of previous.models) {
          const record = asRecord(model);
          const id = asString(record.id);
          if (id) existingById.set(id, record);
        }
      }
      const models = form.models.map((model) =>
        piModelEntry(model, existingById.get(model.id) ?? {}),
      );
      const next: Record<string, unknown> = { ...previous, models };
      if (form.baseUrl.trim()) next.baseUrl = form.baseUrl.trim();
      if (form.apiKey.trim()) next.apiKey = form.apiKey.trim();
      if (form.apiKind.trim()) next.api = form.apiKind.trim();
      return next;
    }
    case 'deepseek-harness': {
      const next: Record<string, unknown> = { ...previous };
      if (form.baseUrl.trim()) next.baseURL = form.baseUrl.trim();
      else delete next.baseURL;
      if (form.apiKey.trim()) next.apiKey = form.apiKey.trim();
      // The built-in DeepSeek route has no protocol or model list of its own.
      if (!form.apiKind.trim()) return next;
      next.api = form.apiKind.trim();
      if (form.name.trim()) next.displayName = form.name.trim();
      const existingById = new Map<string, Record<string, unknown>>();
      for (const model of Array.isArray(previous.models) ? previous.models : []) {
        const record = asRecord(model);
        if (asString(record.id)) existingById.set(asString(record.id), record);
      }
      next.models = form.models.map((model) => dshModelEntry(model, existingById.get(model.id) ?? {}));
      return next;
    }
  }
}

/** Declared model ids of a stored provider, used for the activate selector. */
export function providerModelIds(agent: ManagedProviderAgent, settings: Record<string, unknown>): string[] {
  switch (agent) {
    case 'opencode':
      return Object.keys(asRecord(settings.models));
    case 'pi':
    case 'deepseek-harness':
      return (Array.isArray(settings.models) ? settings.models : [])
        .map((model) => asString(asRecord(model).id))
        .filter(Boolean);
    case 'claude-code':
      return [asString(asRecord(settings.env).ANTHROPIC_MODEL)].filter(Boolean);
    case 'codex':
      return [tomlScalar(codexConfigText(settings), 'model')].filter(Boolean);
    case 'grok-build':
      return [grokModelFields(codexConfigText(settings)).model].filter(Boolean);
  }
}

/** Human-readable endpoint for the provider card; Grok Build subscription
 * profiles show the signed-in account instead. */
export function providerBaseUrl(agent: ManagedProviderAgent, settings: Record<string, unknown>): string {
  switch (agent) {
    case 'claude-code':
      return asString(asRecord(settings.env).ANTHROPIC_BASE_URL);
    case 'codex':
      return tomlScalar(codexConfigText(settings), 'base_url', 'model_providers.');
    case 'grok-build': {
      const session = grokAuthScopes(settings).find(({ entry }) => entry.auth_mode !== 'api_key');
      return asString(session?.entry.email) || grokModelFields(codexConfigText(settings)).baseUrl;
    }
    case 'opencode': {
      const options = asRecord(settings.options);
      return asString(options.baseURL ?? options.baseUrl);
    }
    case 'pi':
      return asString(settings.baseUrl);
    case 'deepseek-harness':
      return asString(settings.baseURL);
  }
}

import type { ManagedProviderAgent } from '@todex/protocol/v2';

export const MASKED_SECRET = '__TODEX_MASKED__';

/// Pi models.json thinking levels; OpenCode variants omit `off` — a variant
/// *is* an effort choice there, so "no thinking" is simply absent.
export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const OPENCODE_THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export function thinkingLevelsFor(agent: ManagedProviderAgent): readonly string[] {
  return agent === 'pi' ? PI_THINKING_LEVELS : OPENCODE_THINKING_LEVELS;
}

/// Enabled levels when a model gains reasoning support without an existing
/// map: matches what Pi/OpenCode expose for an unconfigured reasoning model.
export function defaultEfforts(agent: ManagedProviderAgent): string[] {
  return agent === 'pi' ? ['off', 'minimal', 'low', 'medium', 'high'] : ['low', 'medium', 'high'];
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

export type ProviderFormValues = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
  apiKind: string;
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

/** Pull the scalar named `key` out of a TOML document's top level or a table. */
function tomlScalar(text: string, key: string, withinTablePrefix?: string): string {
  let inTargetTable = withinTablePrefix === undefined;
  for (const line of text.split('\n')) {
    const tableMatch = line.match(/^\s*\[([^\]]+)\]/);
    if (tableMatch) {
      inTargetTable =
        withinTablePrefix === undefined || tableMatch[1].trim().startsWith(withinTablePrefix);
      continue;
    }
    if (!inTargetTable) continue;
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`));
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

/** Replaces `key = "…"` lines in the TOML top level or a `prefix`-named table.
 * Inserts the key when absent instead of dropping user config. */
function patchTomlScalar(
  text: string,
  key: string,
  value: string,
  withinTablePrefix?: string,
): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = text.split('\n');
  let inTargetTable = withinTablePrefix === undefined;
  let replaced = false;
  const out = lines.map((line) => {
    const tableMatch = line.match(/^\s*\[([^\]]+)\]/);
    if (tableMatch) {
      inTargetTable =
        withinTablePrefix === undefined || tableMatch[1].trim().startsWith(withinTablePrefix);
      return line;
    }
    if (!inTargetTable || replaced) return line;
    if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
      replaced = true;
      return `${key} = "${escaped}"`;
    }
    return line;
  });
  if (replaced) return out.join('\n');
  if (withinTablePrefix === undefined) {
    return `${key} = "${escaped}"\n${text.startsWith('\n') ? '' : '\n'}${text}`;
  }
  // Table missing entirely: append one.
  return `${text.trimEnd()}\n\n[${withinTablePrefix}]\n${key} = "${escaped}"\n`;
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
        apiKey: asString(env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY),
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
  if (form.reasoningEffort.trim()) {
    config = patchTomlScalar(config, 'model_reasoning_effort', form.reasoningEffort.trim());
  }
  const contextWindow = parsePositiveInt(form.contextWindow);
  if (contextWindow) config = patchTomlNumber(config, 'model_context_window', contextWindow);
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
): 'ap.invalidNumber' | 'ap.outputRequired' | null {
  const invalid = (text: string) => text.trim() !== '' && parsePositiveInt(text) === undefined;
  if (agent === 'codex') return invalid(form.contextWindow) ? 'ap.invalidNumber' : null;
  if (agent !== 'pi' && agent !== 'opencode') return null;
  const settings = asRecord(existing?.settingsConfig);
  const existingModels =
    agent === 'pi'
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
      if (form.baseUrl.trim()) env.ANTHROPIC_BASE_URL = form.baseUrl.trim();
      if (form.apiKey.trim()) env.ANTHROPIC_AUTH_TOKEN = form.apiKey.trim();
      if (form.model.trim()) env.ANTHROPIC_MODEL = form.model.trim();
      return { ...previous, env };
    }
    case 'codex': {
      const auth = form.apiKey.trim()
        ? { OPENAI_API_KEY: form.apiKey.trim() }
        : asRecord(previous.auth);
      return { auth, config: codexConfigFromForm(form, previous) };
    }
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
  }
}

/** Declared model ids of a stored provider, used for the activate selector. */
export function providerModelIds(agent: ManagedProviderAgent, settings: Record<string, unknown>): string[] {
  switch (agent) {
    case 'opencode':
      return Object.keys(asRecord(settings.models));
    case 'pi':
      return (Array.isArray(settings.models) ? settings.models : [])
        .map((model) => asString(asRecord(model).id))
        .filter(Boolean);
    case 'claude-code':
      return [asString(asRecord(settings.env).ANTHROPIC_MODEL)].filter(Boolean);
    case 'codex':
      return [tomlScalar(codexConfigText(settings), 'model')].filter(Boolean);
  }
}

/** Human-readable base URL for the provider card. */
export function providerBaseUrl(agent: ManagedProviderAgent, settings: Record<string, unknown>): string {
  switch (agent) {
    case 'claude-code':
      return asString(asRecord(settings.env).ANTHROPIC_BASE_URL);
    case 'codex':
      return tomlScalar(codexConfigText(settings), 'base_url', 'model_providers.');
    case 'opencode': {
      const options = asRecord(settings.options);
      return asString(options.baseURL ?? options.baseUrl);
    }
    case 'pi':
      return asString(settings.baseUrl);
  }
}

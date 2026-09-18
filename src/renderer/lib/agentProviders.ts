import type { ManagedProviderAgent } from '@todex/protocol/v2';

export const MASKED_SECRET = '__TODEX_MASKED__';

export type ProviderFormValues = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
  apiKind: string;
  modelsText: string;
};

export const emptyFormValues: ProviderFormValues = {
  name: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  reasoningEffort: '',
  apiKind: '',
  modelsText: '',
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
      };
    }
    case 'opencode': {
      const options = asRecord(settings.options);
      return {
        ...base,
        baseUrl: asString(options.baseURL ?? options.baseUrl),
        apiKey: asString(options.apiKey),
        modelsText: Object.keys(asRecord(settings.models)).join(', '),
      };
    }
    case 'pi': {
      const models = Array.isArray(settings.models) ? settings.models : [];
      return {
        ...base,
        baseUrl: asString(settings.baseUrl),
        apiKey: asString(settings.apiKey),
        apiKind: asString(settings.api),
        modelsText: models
          .map((model) => asString(asRecord(model).id))
          .filter(Boolean)
          .join(', '),
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
        modelIdsFromText(form.modelsText).map((id) => [id, existingModels[id] ?? {}]),
      );
      return { ...previous, options, models };
    }
    case 'pi': {
      const existingById = new Map<string, unknown>();
      if (Array.isArray(previous.models)) {
        for (const model of previous.models) {
          const record = asRecord(model);
          const id = asString(record.id);
          if (id) existingById.set(id, record);
        }
      }
      const models = modelIdsFromText(form.modelsText).map((id) => existingById.get(id) ?? { id });
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

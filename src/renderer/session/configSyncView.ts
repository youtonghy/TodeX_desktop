import type {
  ConfigSyncCategory,
  ConfigSyncEntry,
  ConfigSyncItem,
  ConfigSyncItemKind,
  ConfigSyncSnapshot,
  ConfigSyncStatus,
} from '@todex/protocol/configSync';

/** A row of the side-by-side view: one config item and where it exists. */
export type ConfigSyncRowStatus = ConfigSyncStatus | 'targetOnly';

export type ConfigSyncRow = {
  key: string;
  category: ConfigSyncCategory;
  kind: ConfigSyncItemKind;
  group: string;
  label: string;
  status: ConfigSyncRowStatus;
  /** The sync plan entry; absent for target-only items, which are never written. */
  entry?: ConfigSyncEntry;
  source?: ConfigSyncItem;
  target?: ConfigSyncItem;
};

/**
 * Lines up the source plan with the target's own items: every planned entry
 * in source order, then what only the target has (sync never deletes it).
 */
export function configSyncRows(entries: readonly ConfigSyncEntry[], target: ConfigSyncSnapshot): ConfigSyncRow[] {
  const targetItems = new Map(target.items.map(item => [item.key, item]));
  const rows: ConfigSyncRow[] = entries.map(entry => ({
    key: entry.key,
    category: entry.category,
    kind: entry.kind,
    group: entry.group,
    label: entry.label,
    status: entry.status,
    entry,
    source: entry.source,
    target: targetItems.get(entry.key),
  }));
  const planned = new Set(entries.map(entry => entry.key));
  for (const item of target.items) {
    if (planned.has(item.key)) continue;
    rows.push({ key: item.key, category: item.category, kind: item.kind, group: item.group, label: item.label, status: 'targetOnly', target: item });
  }
  return rows;
}

export const REDACTED = '••••';

const SECRET_KEY = /key|token|secret|passw|auth|cookie|credential|bearer|private/i;
/** Objects whose every value is a secret-bearing setting (MCP env/headers, CLI env). */
const SECRET_MAPS = new Set(['env', 'headers', 'http_headers', 'env_http_headers']);
/** Values that look like keys even under an innocent name. */
const SECRET_VALUE = /^(sk-|sk_|ghp_|gho_|github_pat_|xox[abp]-|AKIA|AIza|eyJ)|^[A-Za-z0-9+/_=-]{40,}$/;

/**
 * Deep copy with every secret replaced by `REDACTED`: values under
 * secret-looking keys, every value of env/header maps, and strings shaped
 * like keys. The view shows what is set, never the secret itself.
 */
export function redactConfigValue(value: unknown, secret = false): unknown {
  if (Array.isArray(value)) return value.map(item => redactConfigValue(item, secret));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, inner]) => [
      name,
      redactConfigValue(inner, secret || SECRET_KEY.test(name) || SECRET_MAPS.has(name.toLowerCase())),
    ]));
  }
  if (typeof value === 'string') return secret || SECRET_VALUE.test(value.trim()) ? (value ? REDACTED : value) : value;
  if (secret && typeof value === 'number') return REDACTED;
  return value;
}

/** What a side holds for an item, as readable text with secrets redacted. */
export function configSyncItemText(item: ConfigSyncItem): string {
  const payload = item.payload as Record<string, unknown> | null;
  let shown: unknown;
  switch (item.kind) {
    case 'agentProvider': {
      const { id: _id, createdAt: _created, updatedAt: _updated, ...provider } = (payload?.provider ?? {}) as Record<string, unknown>;
      shown = provider;
      break;
    }
    case 'instructionPreset':
    case 'cliInstructions':
      // Prompt text is shown as written: it is not where secrets live.
      return String(payload?.text ?? '');
    case 'cliSetting':
    case 'sshSettings':
    case 'outputFilter':
    case 'agentLocal':
    case 'historyCleanup':
      shown = payload?.value;
      break;
    case 'mcpServer':
      shown = payload?.config;
      break;
    case 'skill': {
      const files = (payload?.files ?? []) as Array<{ path: string; contentBase64?: string }>;
      return files.map(file => `${file.path}  (${base64Bytes(file.contentBase64 ?? '')} B)`).join('\n');
    }
    case 'sshHost':
      shown = payload?.host ?? null;
      break;
  }
  if (typeof shown === 'string') return String(redactConfigValue(shown));
  return JSON.stringify(redactConfigValue(shown), null, 2) ?? '';
}

function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

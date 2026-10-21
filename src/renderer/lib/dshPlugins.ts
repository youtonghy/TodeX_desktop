import type { DshPluginConfigId, DshPluginRow } from '@todex/protocol/v2';
import type { FieldGroup } from './cliSettings';

/**
 * Settings pages of known DeepSeek Harness plugins. The backend serves the
 * composed values and pins the whole row config on save, so each page edits
 * only the fields listed here.
 */
export const DSH_PLUGIN_PAGES: Record<DshPluginConfigId, { groups: FieldGroup[] }> = {
  web: {
    groups: [
      {
        id: 'providers',
        fields: [
          { kind: 'enum', path: ['searchProvider'], options: ['deepseek-official', 'deepseek-search-api'] },
          { kind: 'enum', path: ['fetchProvider'], options: ['http', 'deepseek-fetch-api'] },
        ],
      },
    ],
  },
  'web-deepseek-api': {
    groups: [
      {
        id: 'api',
        fields: [
          { kind: 'bool', path: ['sendOriginalQuestion'] },
          { kind: 'text', path: ['baseURL'], placeholder: 'https://api.deepseek.com/v1/tools' },
        ],
      },
    ],
  },
};

export function isDshPluginConfigId(id: string | undefined): id is DshPluginConfigId {
  return id !== undefined && id in DSH_PLUGIN_PAGES;
}

/** Bundle package or patch file name a row came from, for grouping. */
export function dshRowSourceLabel(row: DshPluginRow): string {
  if (row.sourceLayer === 'bundle') return row.source;
  return row.source.split(/[\\/]/).slice(-3).join('/');
}

/** Rows matching a free-text filter on id, module or source. */
export function filterDshRows(rows: DshPluginRow[], query: string): DshPluginRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => [row.id ?? '', row.name, row.source].some((value) => value.toLowerCase().includes(needle)));
}

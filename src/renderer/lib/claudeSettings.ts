/**
 * Editing model for Claude Code's `settings.json` in the CLI manager. The
 * form edits a draft copy of the settings object; saving sends only the
 * difference as an RFC 7386 merge patch, so keys the form does not know
 * (hooks, plugins, model…) are never touched.
 */

export type SettingsObject = Record<string, unknown>;

/** Option value that stands for "key not set". */
export const UNSET = '__unset';

export type FieldSpec =
  /** true / false / unset, as a three-way select. */
  | { kind: 'bool'; path: string[] }
  | { kind: 'enum'; path: string[]; options: string[] }
  /** Free text; an empty input removes the key. */
  | { kind: 'text'; path: string[]; placeholder?: string }
  | { kind: 'integer'; path: string[]; min: number; max: number }
  /** A string array, edited one entry per line. */
  | { kind: 'lines'; path: string[]; placeholder?: string }
  /** Keys whose only value is the string `"disable"`. */
  | { kind: 'disable'; path: string[] }
  /** Default (unset), hidden (empty string) or custom text. */
  | { kind: 'attribution'; path: string[] };

export type FieldGroup = { id: string; fields: FieldSpec[] };

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];

export const CLAUDE_SETTINGS_GROUPS: FieldGroup[] = [
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

/** `env` as editable rows; non-string values are shown as JSON. */
export function envRows(settings: SettingsObject): { name: string; value: string }[] {
  const env = settings.env;
  if (!isObject(env)) return [];
  return Object.entries(env).map(([name, value]) => ({ name, value: typeof value === 'string' ? value : JSON.stringify(value) }));
}

/** Rows back into `env`; blank names are dropped, later duplicates win. `undefined` when empty. */
export function envFromRows(rows: { name: string; value: string }[]): SettingsObject | undefined {
  const env: SettingsObject = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) env[name] = row.value;
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

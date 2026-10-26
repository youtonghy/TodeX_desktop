/**
 * Setup commands for a new container workspace (dependency installs and the
 * like), run once in the container at the workspace path as the todex user.
 * The image has Node 24 (npm, corepack), git and python3 without pip, so the
 * templates only use those; uv installs itself into ~/.local/bin (on PATH).
 * Pure module: scripts/container-freeze.test.ts.
 */

export type SetupTemplateId = 'pnpm' | 'npm' | 'npm-install' | 'yarn' | 'uv' | 'requirements' | 'submodules';

const UV = 'command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh';
// corepack needs its install directory to exist.
const corepack = (tool: string) => `mkdir -p ~/.local/bin && corepack enable --install-directory ~/.local/bin ${tool}`;

export const SETUP_TEMPLATES: Record<SetupTemplateId, string[]> = {
  pnpm: [corepack('pnpm'), 'pnpm install --frozen-lockfile'],
  npm: ['npm ci'],
  'npm-install': ['npm install'],
  yarn: [corepack('yarn'), 'yarn install --immutable'],
  uv: [UV, 'uv sync'],
  requirements: [UV, 'uv venv', 'uv pip install -r requirements.txt'],
  submodules: ['git submodule update --init --recursive'],
};

/** Templates a folder's marker files suggest, in the order they should run. */
export function detectTemplates(markers: string[]): SetupTemplateId[] {
  const has = (file: string) => markers.includes(file);
  const found: SetupTemplateId[] = [];
  if (has('.gitmodules')) found.push('submodules');
  if (has('pnpm-lock.yaml')) found.push('pnpm');
  else if (has('yarn.lock')) found.push('yarn');
  else if (has('package-lock.json')) found.push('npm');
  else if (has('package.json')) found.push('npm-install');
  if (has('uv.lock') || has('pyproject.toml')) found.push('uv');
  else if (has('requirements.txt')) found.push('requirements');
  return found;
}

/** The editable command text for `templates` (one command per line, shared lines once). */
export function templateText(templates: SetupTemplateId[]): string {
  return [...new Set(templates.flatMap((id) => SETUP_TEMPLATES[id]))].join('\n');
}

/**
 * The bash script for the edited text: blank lines and `#` comments are
 * dropped; it stops at the first failing command and echoes each one.
 * Empty when there is nothing to run.
 */
export function setupScript(text: string): string {
  const commands = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  return commands.length ? ['set -ex', ...commands].join('\n') : '';
}

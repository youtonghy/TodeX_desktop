import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = dirname(fileURLToPath(import.meta.url)).replace(/[/\\]scripts$/, '');
const require = createRequire(join(desktopRoot, 'package.json'));

function fail(message) {
  console.error(`[todex-desktop] electron preflight failed: ${message}`);
  process.exit(1);
}

let electronRoot;
try {
  electronRoot = dirname(require.resolve('electron/package.json'));
} catch (error) {
  fail(`electron package is not installed (${error instanceof Error ? error.message : error})`);
}

const pathFile = join(electronRoot, 'path.txt');
if (!existsSync(pathFile)) {
  fail(`missing ${pathFile}; reinstall electron so postinstall can download the binary`);
}

const relativeBinary = readFileSync(pathFile, 'utf8').trim();
const binary = join(electronRoot, 'dist', relativeBinary);
if (!existsSync(binary)) {
  fail(`electron binary missing at ${binary}`);
}

const result = spawnSync(binary, ['--version'], {
  encoding: 'utf8',
  timeout: 15_000,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
});
if (result.status !== 0) {
  fail(`electron --version exited ${result.status}: ${result.stderr || result.stdout || result.signal || 'no output'}`);
}

console.log(`[todex-desktop] electron preflight ok ${String(result.stdout).trim()} (${binary})`);

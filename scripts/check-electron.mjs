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
const installScript = join(electronRoot, 'install.js');

function getBinary() {
  if (!existsSync(pathFile)) return null;
  const relativeBinary = readFileSync(pathFile, 'utf8').trim();
  const bin = join(electronRoot, 'dist', relativeBinary);
  return existsSync(bin) ? bin : null;
}

let binary = getBinary();
if (!binary && existsSync(installScript)) {
  console.log('[todex-desktop] electron binary missing; running electron install script...');
  const installResult = spawnSync(process.execPath, [installScript], {
    cwd: electronRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (installResult.status === 0) {
    binary = getBinary();
  }
}

if (!existsSync(pathFile)) {
  fail(`missing ${pathFile}; reinstall electron so postinstall can download the binary`);
}

if (!binary) {
  fail(`electron binary missing in ${join(electronRoot, 'dist')}`);
}

const result = spawnSync(
  binary,
  ['-e', "process.stdout.write(process.versions.electron || '')"],
  {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
);
if (result.status !== 0) {
  fail(`electron executable exited ${result.status}: ${result.stderr || result.stdout || result.signal || 'no output'}`);
}

const electronVersion = String(result.stdout).trim();
if (!electronVersion) {
  fail('electron executable did not report an Electron version');
}

console.log(`[todex-desktop] electron preflight ok ${electronVersion} (${binary})`);

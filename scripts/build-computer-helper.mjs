// Builds the macOS Computer Use helper (native/macos/TodexComputer) into
// build/bin/todex-computer, which electron-builder ships in Resources/bin.
// No-op elsewhere: Computer Use is macOS-only.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('[computer-helper] skipped: not macOS');
  process.exit(0);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'native/macos/TodexComputer');
const run = (command, args) => execFileSync(command, args, { cwd: pkg, stdio: 'inherit' });
run('swift', ['build', '-c', 'release', '--arch', 'arm64', '--product', 'todex-computer']);
const binPath = execFileSync('swift', ['build', '-c', 'release', '--arch', 'arm64', '--show-bin-path'], { cwd: pkg, encoding: 'utf8' }).trim();
const target = join(root, 'build/bin/todex-computer');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(join(binPath, 'todex-computer'), target);
chmodSync(target, 0o755);
// Debug symbols stay in the build tree; the shipped binary is stripped.
run('strip', ['-x', target]);
console.log(`[computer-helper] built ${target}`);

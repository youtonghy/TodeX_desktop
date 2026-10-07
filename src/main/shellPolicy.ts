// Checks for the renderer's `shell:*` IPC (open / open with / reveal a
// workspace file). The main process cannot tell which workspace roots are
// real, so it refuses what is dangerous everywhere: relative paths (and with
// them option-like arguments) and, for a plain open, anything the OS would
// run instead of view.
//
// Kept electron-free so it stays importable from plain node tests, like
// updatePolicy.ts and desktopEntry.ts.
import { posix, win32 } from 'node:path';

export type PathInfo = { isDirectory: boolean; mode: number };

export type ShellPathRefusal = 'relative' | 'missing' | 'launchable';

/** Extensions the OS launches, installs or follows instead of showing:
 * macOS bundles and scripts, Windows executables, scripts and shortcuts,
 * Linux launchers. Bundles are directories, so this applies to them too. */
const LAUNCHABLE_EXTENSIONS = new Set([
  // macOS
  'app', 'command', 'tool', 'terminal', 'workflow', 'action', 'pkg', 'mpkg', 'scpt', 'applescript',
  'webloc', 'inetloc', 'fileloc', 'prefpane', 'kext',
  // Windows
  'exe', 'com', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'msi', 'msp', 'msc',
  'scr', 'pif', 'lnk', 'url', 'hta', 'cpl', 'reg', 'inf', 'appref-ms', 'application', 'gadget', 'settingcontent-ms',
  // Linux and cross-platform
  'desktop', 'appimage', 'run', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish', 'jar', 'jnlp',
]);

function extensionOf(path: string, platform: NodeJS.Platform): string {
  const name = (platform === 'win32' ? win32 : posix).basename(path);
  // Windows ignores trailing dots and spaces ("run.exe. " opens run.exe).
  const trimmed = platform === 'win32' ? name.replace(/[. ]+$/, '') : name;
  const dot = trimmed.lastIndexOf('.');
  return dot > 0 ? trimmed.slice(dot + 1).toLowerCase() : '';
}

/** Why `path` must not be revealed or handed to a user-chosen app, or null. */
export function shellPathRefusal(path: unknown, info: PathInfo | null, platform: NodeJS.Platform): ShellPathRefusal | null {
  if (typeof path !== 'string' || !(platform === 'win32' ? win32 : posix).isAbsolute(path)) return 'relative';
  return info ? null : 'missing';
}

/** Why `path` must not be opened with its default handler, or null. */
export function openPathRefusal(path: unknown, info: PathInfo | null, platform: NodeJS.Platform): ShellPathRefusal | null {
  const refusal = shellPathRefusal(path, info, platform);
  if (refusal || typeof path !== 'string' || !info) return refusal;
  if (LAUNCHABLE_EXTENSIONS.has(extensionOf(path, platform))) return 'launchable';
  // macOS and Linux run an executable file (Terminal, or the file manager's
  // "run" action) rather than showing it.
  if (platform !== 'win32' && !info.isDirectory && (info.mode & 0o111) !== 0) return 'launchable';
  return null;
}

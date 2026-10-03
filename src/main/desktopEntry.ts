// Maintains the freedesktop launcher entry on Linux. electron-updater installs
// AppImage updates by deleting the running file and moving the download next to
// it under a new versioned name, which orphans every .desktop entry that
// referenced the old path — desktops honoring TryExec then hide TodeX entirely.
// The managed todex.desktop is rewritten at launch and again when the updater
// reports the installed file's new name; dead entries that still point at
// AppImages the updater already removed are dropped.
//
// Kept electron-free so it stays importable from plain node tests, like
// updatePolicy.ts and i18n.ts.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const DESKTOP_FILE_NAME = 'todex.desktop';
const ICON_NAME = 'todex';
// Release artifact names (electron-builder.yml): TodeX-vX.Y.Z-linux-<arch>.AppImage
const RELEASE_APPIMAGE = /^TodeX-v[^/]*\.AppImage$/;

export interface DesktopSyncOptions {
  appImage: string;
  iconSource?: string;
  name?: string;
  comment?: string;
  wmClass?: string;
  // Test overrides; production values come from XDG_DATA_HOME / $HOME.
  dataHome?: string;
  refreshDatabase?: boolean;
}

export interface DesktopSyncResult {
  entry: string;
  rewritten: boolean;
  icon: string | null;
  removedEntries: string[];
}

// Desktop Entry spec: inside a quoted argument, \, ", ` and $ take a backslash.
export function quoteExecArg(value: string): string {
  return `"${value.replace(/[\\"`$]/g, '\\$&')}"`;
}

export function buildDesktopEntry(options: { exec: string; name: string; comment?: string; wmClass?: string }): string {
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${options.name}`,
    `Exec=${quoteExecArg(options.exec)}`,
    `Icon=${ICON_NAME}`,
    'Terminal=false',
    'Categories=Development;',
  ];
  if (options.comment) lines.push(`Comment=${options.comment}`);
  if (options.wmClass) lines.push(`StartupWMClass=${options.wmClass}`);
  // No TryExec on purpose: a missing TryExec target hides the whole entry,
  // which is exactly the failure this module exists to prevent.
  return `${lines.join('\n')}\n`;
}

export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  // 'IHDR' must be the first chunk; width/height are its first fields.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

// AppImage paths referenced by an entry's Exec/TryExec lines, unquoted and
// with the spec's backslash escapes undone.
function referencedAppImages(content: string): string[] {
  const refs: string[] = [];
  for (const line of content.split('\n')) {
    const match = /^\s*(?:Exec|TryExec)\s*=(.*)$/.exec(line);
    if (!match) continue;
    for (const token of match[1].matchAll(/"((?:[^"\\]|\\.)*\.AppImage)"|(\S+\.AppImage)/g)) {
      refs.push((token[1] ?? token[2]).replace(/\\(.)/g, '$1'));
    }
  }
  return refs;
}

// An entry is stale when it launches a TodeX release AppImage from the
// updater-managed directory that no longer exists.
export function isStaleTodeXEntry(content: string, appImageDir: string): boolean {
  return referencedAppImages(content).some((ref) =>
    dirname(ref) === appImageDir && RELEASE_APPIMAGE.test(basename(ref)) && !existsSync(ref));
}

function installIcon(source: string, dataHome: string): string | null {
  try {
    const bytes = readFileSync(source);
    const dimensions = pngDimensions(bytes);
    if (!dimensions) return null;
    const dir = join(dataHome, 'icons', 'hicolor', `${dimensions.width}x${dimensions.height}`, 'apps');
    const target = join(dir, `${ICON_NAME}.png`);
    const current = existsSync(target) ? readFileSync(target) : null;
    if (!current?.equals(bytes)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(target, bytes);
    }
    return target;
  } catch {
    return null;
  }
}

export function syncDesktopEntry(options: DesktopSyncOptions): DesktopSyncResult {
  // XDG base dirs treat an unset or empty XDG_DATA_HOME the same.
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const dataHome = options.dataHome ?? (xdg || join(homedir(), '.local/share'));
  const applicationsDir = join(dataHome, 'applications');
  const entryPath = join(applicationsDir, DESKTOP_FILE_NAME);
  const icon = options.iconSource ? installIcon(options.iconSource, dataHome) : null;

  const content = buildDesktopEntry({
    exec: options.appImage,
    name: options.name ?? 'TodeX',
    comment: options.comment,
    wmClass: options.wmClass,
  });
  let previous: string | null = null;
  try {
    previous = readFileSync(entryPath, 'utf8');
  } catch { /* missing or unreadable entries get rewritten */ }
  const rewritten = previous !== content;
  if (rewritten) {
    mkdirSync(applicationsDir, { recursive: true });
    writeFileSync(entryPath, content, { mode: 0o644 });
  }

  const appImageDir = dirname(options.appImage);
  const removedEntries: string[] = [];
  for (const file of readdirSync(applicationsDir)) {
    if (file === DESKTOP_FILE_NAME || !file.endsWith('.desktop')) continue;
    const path = join(applicationsDir, file);
    try {
      if (isStaleTodeXEntry(readFileSync(path, 'utf8'), appImageDir)) {
        unlinkSync(path);
        removedEntries.push(file);
      }
    } catch { /* unreadable or busy entries are left for the next pass */ }
  }

  if ((rewritten || removedEntries.length > 0) && options.refreshDatabase !== false) {
    try {
      execFileSync('update-desktop-database', [applicationsDir], { stdio: 'ignore', timeout: 5000 });
    } catch { /* optional tool; desktop daemons watch the directory anyway */ }
  }

  return { entry: entryPath, rewritten, icon, removedEntries };
}

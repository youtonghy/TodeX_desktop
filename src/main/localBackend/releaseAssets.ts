/** Pure helpers for the backend's GitHub release assets (TodeX_backend build-binaries.yml). */

export const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

/** Release asset label of this machine (`build-binaries.yml` targets), or null when none is published. */
export function platformLabel(platform = process.platform, arch = process.arch): string | null {
  if (platform === 'linux' && arch === 'x64') return 'linux-x64-gnu';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64-gnu';
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64';
  if (platform === 'win32' && arch === 'x64') return 'windows-x64';
  if (platform === 'win32' && arch === 'arm64') return 'windows-arm64';
  return null;
}

export function releaseAssetName(version: string, label: string): string {
  return `todex-agentd-v${version}-${label}.${label.startsWith('windows-') ? 'exe' : 'bin'}`;
}

/** The backend release matching a desktop build version; null for dev builds (use the latest release). */
export function matchingBackendVersion(buildVersion: string): string | null {
  const version = buildVersion.trim().replace(/^v/, '');
  return STABLE_VERSION.test(version) && version !== '0.0.0' ? version : null;
}

/** `sha256  name` lines of a `SHA256SUMS` file → the digest for `name`. */
export function checksumFor(sums: string, name: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (match && match[2].trim() === name) return match[1].toLowerCase();
  }
  return null;
}

/** The version a `todex-agentd --version` line reports (`todex-agentd 2.3.6`). */
export function parseVersionOutput(output: string): string | null {
  const match = output.trim().match(/^todex-agentd\s+v?(\S+)/m);
  return match ? match[1] : null;
}

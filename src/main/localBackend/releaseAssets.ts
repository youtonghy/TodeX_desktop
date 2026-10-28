/** Pure helpers for the backend's GitHub release assets (TodeX_backend build-binaries.yml). */
import { verify } from 'node:crypto';

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

/** The backend release signing key: a copy of TodeX_backend's
 * `ci/release-signing.pub.pem` (see its docs/RELEASING.md for rotation). */
export const RELEASE_SIGNING_KEYS: readonly string[] = [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAdKUgyyGFfByhDCxXFpvqlEO09bcxzYudjsoH5ise5Z0=
-----END PUBLIC KEY-----
`,
];

/** Releases up to this one were published before signing; they have no `SHA256SUMS.sig`. */
export const LAST_UNSIGNED_VERSION = '2.3.6';

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

/** Whether `version` must come with a valid `SHA256SUMS.sig` (every release after v2.3.6). */
export function releaseIsSigned(version: string): boolean {
  return compareVersions(version, LAST_UNSIGNED_VERSION) > 0;
}

/**
 * Whether a backend release must come with a valid `SHA256SUMS.sig`: every
 * release after v2.3.6, and also an older one unless it is exactly the
 * version this desktop build pairs with (`matchingVersion`). Otherwise a
 * leaked publishing token could mark an old unsigned release "latest" and
 * dev builds, which install "latest", would take it unsigned.
 */
export function signatureRequired(version: string, matchingVersion: string | null): boolean {
  return releaseIsSigned(version) || version !== matchingVersion;
}

/** Signature domain of backend releases (TodeX_backend build-binaries.yml). */
export const BACKEND_RELEASE_DOMAIN = 'todex-release-v1';

/** Whether `signature` (`SHA256SUMS.sig`) is a release key's Ed25519 signature over
 * `"todex-release-v1\0" + tag + "\0" + manifest`, exactly as the release workflow signs. */
export function releaseSignatureValid(
  tag: string,
  manifest: Uint8Array,
  signature: Uint8Array,
  keys: readonly string[] = RELEASE_SIGNING_KEYS,
): boolean {
  return manifestSignatureValid(BACKEND_RELEASE_DOMAIN, tag, manifest, signature, keys);
}

/** Whether `signature` is a key's Ed25519 signature over `domain + "\0" + tag + "\0" + manifest`. */
export function manifestSignatureValid(
  domain: string,
  tag: string,
  manifest: Uint8Array,
  signature: Uint8Array,
  keys: readonly string[] = RELEASE_SIGNING_KEYS,
): boolean {
  if (signature.byteLength !== 64) return false;
  const encoder = new TextEncoder();
  const message = Buffer.concat([
    encoder.encode(domain),
    new Uint8Array([0]),
    encoder.encode(tag),
    new Uint8Array([0]),
    manifest,
  ]);
  return keys.some((key) => {
    try {
      return verify(null, message, key, signature);
    } catch {
      return false;
    }
  });
}

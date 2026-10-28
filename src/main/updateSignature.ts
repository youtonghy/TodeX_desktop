// Verification of downloaded desktop updates against the release's signed
// `SHA256SUMS` (release-desktop.yml signs it with the same Ed25519 release
// key as the backend, under its own domain). electron-updater only checks the
// sha512 from the same GitHub release, which whoever can publish a release
// controls; the signature ties the installer to the release key instead.
//
// Kept electron-free so it stays importable from plain node tests.
import { RELEASE_SIGNING_KEYS, checksumFor, manifestSignatureValid } from './localBackend/releaseAssets.ts';

/** Signature domain of desktop releases: the signed message is
 * `"todex-desktop-release-v1\0" + tag + "\0" + SHA256SUMS`. */
export const DESKTOP_RELEASE_DOMAIN = 'todex-desktop-release-v1';

/** Upper bound for a release's SHA256SUMS (a few lines per artifact). */
export const MAX_SUMS_BYTES = 1024 * 1024;

export type UpdateDownload = {
  /** Release version, e.g. `1.2.3` (the tag is `v1.2.3`). */
  version: string;
  /** Base name of the downloaded file, as listed in SHA256SUMS. */
  fileName: string;
  /** Hex sha256 of the downloaded file. */
  fileSha256: string;
  sums: Uint8Array;
  signature: Uint8Array;
};

/** Throws unless `signature` signs `sums` for the release tag and `sums` lists `fileSha256` for `fileName`. */
export function verifyUpdateDownload(download: UpdateDownload, keys: readonly string[] = RELEASE_SIGNING_KEYS): void {
  const tag = `v${download.version}`;
  if (download.sums.byteLength > MAX_SUMS_BYTES) throw new Error(`SHA256SUMS of ${tag} is too large`);
  if (!manifestSignatureValid(DESKTOP_RELEASE_DOMAIN, tag, download.sums, download.signature, keys)) {
    throw new Error(`SHA256SUMS of ${tag} is not signed by the TodeX release key`);
  }
  const expected = checksumFor(new TextDecoder().decode(download.sums), download.fileName);
  if (!expected) throw new Error(`SHA256SUMS of ${tag} has no entry for ${download.fileName}`);
  if (expected !== download.fileSha256.toLowerCase()) throw new Error(`${download.fileName} does not match SHA256SUMS of ${tag}`);
}

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants, existsSync, readdirSync } from 'node:fs';
import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { net } from 'electron';
import {
  STABLE_VERSION,
  checksumFor,
  matchingBackendVersion,
  parseVersionOutput,
  platformLabel,
  releaseAssetName,
  releaseIsSigned,
  releaseSignatureValid,
} from './releaseAssets';

export { matchingBackendVersion, platformLabel } from './releaseAssets';

const execFileAsync = promisify(execFile);

export const BACKEND_REPOSITORY = 'youtonghy/TodeX_backend';
const RELEASES_URL = `https://github.com/${BACKEND_REPOSITORY}/releases/download`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${BACKEND_REPOSITORY}/releases/latest`;
const MAX_BINARY_BYTES = 256 * 1024 * 1024;
const BINARY_NAME = process.platform === 'win32' ? 'todex-agentd.exe' : 'todex-agentd';

export class BackendBinaries {
  constructor(private readonly root: string) {}

  managedPath(version: string): string {
    return join(this.root, version, BINARY_NAME);
  }

  installedVersions(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).filter((name) => STABLE_VERSION.test(name) && existsSync(this.managedPath(name)));
  }

  /** `todex-agentd` on PATH or in `~/.local/bin` (where install.sh puts it). */
  async findUserBinary(): Promise<string | null> {
    const dirs = [...(process.env.PATH ?? '').split(delimiter), join(homedir(), '.local', 'bin')].filter(Boolean);
    for (const dir of dirs) {
      const candidate = join(dir, BINARY_NAME);
      try {
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Not here.
      }
    }
    return null;
  }

  async resolveVersion(buildVersion: string): Promise<string> {
    const matching = matchingBackendVersion(buildVersion);
    if (matching) return matching;
    const response = await net.fetch(LATEST_RELEASE_API, { headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`);
    const tag = (await response.json() as { tag_name?: unknown }).tag_name;
    const version = typeof tag === 'string' ? tag.replace(/^v/, '') : '';
    if (!STABLE_VERSION.test(version)) throw new Error(`unexpected latest backend release tag ${String(tag)}`);
    return version;
  }

  /** Downloads `version`, checks it against the release's `SHA256SUMS` and
   * its own `--version`, and only then publishes it at `managedPath`. */
  async install(version: string, onProgress?: (received: number, total: number) => void): Promise<string> {
    const label = platformLabel();
    if (!label) throw Object.assign(new Error(`no published backend build for ${process.platform}-${process.arch}`), { code: 'unsupported_platform' });
    const asset = releaseAssetName(version, label);
    const sumsResponse = await net.fetch(`${RELEASES_URL}/v${version}/SHA256SUMS`);
    if (!sumsResponse.ok) throw new Error(`SHA256SUMS for v${version}: HTTP ${sumsResponse.status}`);
    const sums = new Uint8Array(await sumsResponse.arrayBuffer());
    // The checksums are trusted only once the release key signed them, so
    // a release published without the key (a leaked token) is refused.
    // v2.3.6 and earlier predate signing and only have their checksums.
    if (releaseIsSigned(version)) {
      const signatureResponse = await net.fetch(`${RELEASES_URL}/v${version}/SHA256SUMS.sig`);
      if (!signatureResponse.ok) {
        throw Object.assign(new Error(`SHA256SUMS.sig for v${version}: HTTP ${signatureResponse.status}`), { code: 'signature_invalid' });
      }
      const signature = new Uint8Array(await signatureResponse.arrayBuffer());
      if (!releaseSignatureValid(`v${version}`, sums, signature)) {
        throw Object.assign(new Error(`SHA256SUMS of v${version} is not signed by the TodeX release key`), { code: 'signature_invalid' });
      }
    }
    const expected = checksumFor(new TextDecoder().decode(sums), asset);
    if (!expected) throw new Error(`SHA256SUMS of v${version} has no entry for ${asset}`);

    const response = await net.fetch(`${RELEASES_URL}/v${version}/${asset}`);
    if (!response.ok || !response.body) throw new Error(`${asset}: HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    if (total > MAX_BINARY_BYTES) throw new Error(`${asset} is larger than ${MAX_BINARY_BYTES} bytes`);
    const chunks: Uint8Array[] = [];
    const hash = createHash('sha256');
    let received = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BINARY_BYTES) {
        await reader.cancel();
        throw new Error(`${asset} is larger than ${MAX_BINARY_BYTES} bytes`);
      }
      hash.update(value);
      chunks.push(value);
      onProgress?.(received, total);
    }
    const actual = hash.digest('hex');
    if (actual !== expected) throw Object.assign(new Error(`${asset} does not match SHA256SUMS`), { code: 'checksum_mismatch' });

    const target = this.managedPath(version);
    const dir = join(this.root, version);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const staged = join(dir, `.${BINARY_NAME}.${process.pid}.partial`);
    try {
      await writeFile(staged, Buffer.concat(chunks), { mode: 0o700 });
      if (process.platform !== 'win32') await chmod(staged, 0o755);
      const reported = await binaryVersion(staged);
      if (reported !== version) throw new Error(`${asset} reports version ${reported ?? 'unknown'}, expected ${version}`);
      await rename(staged, target);
    } finally {
      await rm(staged, { force: true });
    }
    return target;
  }

  /** Removes managed versions other than `keep` (the current and previous one stay for rollback). */
  async prune(keep: string[]): Promise<void> {
    for (const version of this.installedVersions()) {
      if (!keep.includes(version)) await rm(join(this.root, version), { recursive: true, force: true });
    }
  }
}

export async function binaryVersion(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], { timeout: 10_000, windowsHide: true });
    return parseVersionOutput(stdout);
  } catch {
    return null;
  }
}

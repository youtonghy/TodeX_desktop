import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RELEASE_SIGNING_KEYS } from '../src/main/localBackend/releaseAssets.ts';
import { DESKTOP_RELEASE_DOMAIN, verifyUpdateDownload } from '../src/main/updateSignature.ts';

// A throwaway key: the real release key never leaves CI secrets.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const keys = [publicPem];

const installer = new TextEncoder().encode('installer bytes');
const installerSha = createHash('sha256').update(installer).digest('hex');
const sums = new TextEncoder().encode(`${installerSha}  TodeX-v1.2.3-linux-x86_64.AppImage\n${'0'.repeat(64)}  latest-linux.yml\n`);

function signed(tag: string, manifest: Uint8Array, domain = DESKTOP_RELEASE_DOMAIN): Uint8Array {
  const message = Buffer.concat([Buffer.from(`${domain}\0${tag}\0`), manifest]);
  return new Uint8Array(sign(null, message, privateKey));
}

const valid = { version: '1.2.3', fileName: 'TodeX-v1.2.3-linux-x86_64.AppImage', fileSha256: installerSha, sums, signature: signed('v1.2.3', sums) };

test('a file listed in signed SHA256SUMS verifies', () => {
  assert.doesNotThrow(() => verifyUpdateDownload(valid, keys));
  assert.doesNotThrow(() => verifyUpdateDownload({ ...valid, fileSha256: installerSha.toUpperCase() }, keys));
});

test('signatures are bound to the key, the tag and the desktop domain', () => {
  assert.throws(() => verifyUpdateDownload(valid), /not signed/);
  assert.throws(() => verifyUpdateDownload({ ...valid, version: '1.2.4' }, keys), /not signed/);
  assert.throws(() => verifyUpdateDownload({ ...valid, signature: signed('v1.2.3', sums, 'todex-release-v1') }, keys), /not signed/);
  assert.throws(() => verifyUpdateDownload({ ...valid, signature: new Uint8Array(64) }, keys), /not signed/);
  assert.throws(() => verifyUpdateDownload({ ...valid, signature: new Uint8Array() }, keys), /not signed/);
  const tampered = new Uint8Array(sums);
  tampered[0] ^= 1;
  assert.throws(() => verifyUpdateDownload({ ...valid, sums: tampered }, keys), /not signed/);
});

test('the downloaded file must match its SHA256SUMS entry', () => {
  assert.throws(() => verifyUpdateDownload({ ...valid, fileSha256: '1'.repeat(64) }, keys), /does not match/);
  assert.throws(() => verifyUpdateDownload({ ...valid, fileName: 'TodeX-v1.2.3-windows-x64.exe' }, keys), /no entry/);
});

test('the CI public key is the release key the app trusts', () => {
  const pem = readFileSync(new URL('../ci/release-signing.pub.pem', import.meta.url), 'utf8');
  assert.equal(pem, RELEASE_SIGNING_KEYS[0]);
});

const hasOpenssl = spawnSync('openssl', ['version']).status === 0;

test('the release workflow signing command produces a signature the app accepts', { skip: !hasOpenssl }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'todex-sign-'));
  try {
    writeFileSync(join(dir, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    writeFileSync(join(dir, 'SHA256SUMS'), sums);
    // Same steps as .github/workflows/release-desktop.yml "Sign checksums".
    const script = [
      `printf '${DESKTOP_RELEASE_DOMAIN}\\0%s\\0' "v1.2.3" > message`,
      'cat SHA256SUMS >> message',
      'openssl pkeyutl -sign -inkey key.pem -rawin -in message -out SHA256SUMS.sig',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], { cwd: dir });
    assert.equal(result.status, 0, result.stderr.toString());
    const signature = new Uint8Array(readFileSync(join(dir, 'SHA256SUMS.sig')));
    assert.doesNotThrow(() => verifyUpdateDownload({ ...valid, signature }, keys));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

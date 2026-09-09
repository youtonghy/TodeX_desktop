import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve('electron-updater'))('js-yaml');
const directory = process.argv[2] ?? 'release';
const version = process.env.TODEX_BUILD_VERSION;
const expectedName = process.platform === 'darwin' ? 'latest-mac.yml'
  : process.platform === 'win32' ? 'latest.yml' : 'latest-linux.yml';
const names = await readdir(directory);
if (!names.includes(expectedName)) throw new Error(`Missing update metadata: ${expectedName}`);
for (const name of names.filter((name) => /^latest.*\.yml$/.test(name))) {
  const metadata = load(await readFile(join(directory, name), 'utf8'));
  if (!version || metadata.version !== version) throw new Error(`${name}: incorrect version`);
  if (!metadata.files?.length) throw new Error(`${name}: no update files`);
  for (const file of metadata.files) {
    const assetName = decodeURIComponent(file.url);
    if (assetName !== basename(assetName)) throw new Error(`${name}: invalid asset path`);
    const path = join(directory, assetName);
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${assetName}: not a file`);
    if (file.size != null && info.size !== file.size) throw new Error(`${assetName}: size mismatch`);
    const hash = createHash('sha512');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest('base64') !== file.sha512) throw new Error(`${assetName}: checksum mismatch`);
  }
  console.log(`Verified ${name} and all referenced assets`);
}

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The checked-in outputs support packaging on every platform. Regeneration uses
// macOS's built-in image tools so the project needs no image-processing package.
if (process.platform !== 'darwin') {
  throw new Error('Regenerate app icons on macOS (sips and iconutil are required).');
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = join(projectRoot, 'src/renderer/assets/brand');
const sourcePath = join(brandDir, 't-icon-dark-beige.png');
const source = readFileSync(sourcePath);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (source.length < 33 || !source.subarray(0, 8).equals(pngSignature)
    || source.readUInt32BE(16) !== 1024 || source.readUInt32BE(20) !== 1024) {
  throw new Error('The source app icon must be a 1024 × 1024 PNG.');
}

const outputDir = join(projectRoot, 'build');
const linuxDir = join(outputDir, 'icons');
const temporaryDir = mkdtempSync(join(tmpdir(), 'todex-icons-'));
const iconsetDir = join(temporaryDir, 'icon.iconset');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function resizePng(input, output, size) {
  execFileSync('/usr/bin/sips', ['--resampleHeightWidth', String(size), String(size), input, '--out', output], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

try {
  mkdirSync(linuxDir, { recursive: true });
  mkdirSync(iconsetDir);
  copyFileSync(sourcePath, join(outputDir, 'icon.png'));

  for (const size of sizes) {
    const target = join(linuxDir, `${size}x${size}.png`);
    if (size === 1024) {
      copyFileSync(sourcePath, target);
    } else {
      resizePng(sourcePath, target, size);
    }
  }

  for (const size of [16, 32, 128, 256, 512]) {
    copyFileSync(join(linuxDir, `${size}x${size}.png`), join(iconsetDir, `icon_${size}x${size}.png`));
    copyFileSync(join(linuxDir, `${size * 2}x${size * 2}.png`), join(iconsetDir, `icon_${size}x${size}@2x.png`));
  }
  execFileSync('/usr/bin/iconutil', ['--convert', 'icns', iconsetDir, '--output', join(outputDir, 'icon.icns')], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  // ICO supports PNG-compressed frames, retaining the source's transparency.
  const windowsSizes = sizes.filter((size) => size <= 256);
  const frames = windowsSizes.map((size) => readFileSync(join(linuxDir, `${size}x${size}.png`)));
  const directory = Buffer.alloc(6 + frames.length * 16);
  directory.writeUInt16LE(1, 2); // Image type: icon.
  directory.writeUInt16LE(frames.length, 4);
  let offset = directory.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    const size = windowsSizes[index];
    directory.writeUInt8(size === 256 ? 0 : size, entry);
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
    directory.writeUInt16LE(1, entry + 4); // Color planes.
    directory.writeUInt16LE(32, entry + 6); // RGBA bits per pixel.
    directory.writeUInt32LE(frame.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  writeFileSync(join(outputDir, 'icon.ico'), Buffer.concat([directory, ...frames]));

  resizePng(sourcePath, join(brandDir, 'favicon-dark.png'), 32);
  resizePng(join(brandDir, 't-icon-light.png'), join(brandDir, 'favicon-light.png'), 32);
  resizePng(sourcePath, join(brandDir, 'apple-touch-icon.png'), 180);
  const publicDir = join(projectRoot, 'src/renderer/public');
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(join(outputDir, 'icon.ico'), join(publicDir, 'favicon.ico'));
  console.log('Generated native app icons, themed favicons, and the Apple touch icon.');
} finally {
  rmSync(temporaryDir, { recursive: true, force: true });
}

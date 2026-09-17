// Builds the PlutoSim app icons from the brand logo.
//
//   node scripts/make-icons.mjs
//
// Writes resources/icons/icon.png (1024 px), icon.icns (macOS) and icon.ico
// (Windows). They are committed, so a build never needs to run this; run it again
// only when the logo changes. macOS only: the .icns step uses `iconutil`.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = fileURLToPath(new URL('..', import.meta.url));
const logo = path.join(root, 'src/assets/brand/plutosim-logo.png');
const outDir = path.join(root, 'resources/icons');
mkdirSync(outDir, { recursive: true });

const SIZE = 1024;
// macOS icons sit inside a margin of the canvas; Windows ones fill it.
const TILE = 824;
const RADIUS = 185;

/** Dark rounded tile in the app's colours, with the logo centred on it. */
async function masterIcon() {
  const tileSvg = Buffer.from(`
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#132238"/>
          <stop offset="1" stop-color="#060a12"/>
        </linearGradient>
        <radialGradient id="glow" cx="0.5" cy="0.42" r="0.55">
          <stop offset="0" stop-color="#38bdf8" stop-opacity="0.28"/>
          <stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect x="${(SIZE - TILE) / 2}" y="${(SIZE - TILE) / 2}" width="${TILE}" height="${TILE}"
            rx="${RADIUS}" fill="url(#bg)" stroke="#38bdf8" stroke-opacity="0.35" stroke-width="6"/>
      <rect x="${(SIZE - TILE) / 2}" y="${(SIZE - TILE) / 2}" width="${TILE}" height="${TILE}"
            rx="${RADIUS}" fill="url(#glow)"/>
    </svg>`);

  const mark = await sharp(logo)
    .trim()
    .resize({ width: Math.round(TILE * 0.8), height: Math.round(TILE * 0.8), fit: 'inside' })
    .toBuffer();
  const meta = await sharp(mark).metadata();

  return sharp(tileSvg)
    .composite([
      {
        input: mark,
        left: Math.round((SIZE - meta.width) / 2),
        top: Math.round((SIZE - meta.height) / 2),
      },
    ])
    .png()
    .toBuffer();
}

/** An .ico holding PNG images, which every Windows since Vista reads. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const master = await masterIcon();
writeFileSync(path.join(outDir, 'icon.png'), master);

// Windows: the tile fills the square, as Windows icons do.
const windowsMaster = await sharp(master)
  .extract({ left: (SIZE - TILE) / 2, top: (SIZE - TILE) / 2, width: TILE, height: TILE })
  .toBuffer();
const icoImages = [];
for (const size of [16, 24, 32, 48, 64, 128, 256]) {
  icoImages.push({ size, data: await sharp(windowsMaster).resize(size, size).png().toBuffer() });
}
writeFileSync(path.join(outDir, 'icon.ico'), buildIco(icoImages));

// macOS: an .iconset folder turned into .icns by the system tool.
const work = mkdtempSync(path.join(os.tmpdir(), 'plutosim-icon-'));
const iconset = path.join(work, 'icon.iconset');
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), await sharp(master).resize(size, size).png().toBuffer());
  writeFileSync(
    path.join(iconset, `icon_${size}x${size}@2x.png`),
    await sharp(master).resize(size * 2, size * 2).png().toBuffer(),
  );
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(outDir, 'icon.icns')]);
rmSync(work, { recursive: true, force: true });

console.log('wrote resources/icons/icon.png, icon.icns, icon.ico');

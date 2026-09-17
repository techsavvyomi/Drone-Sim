// Builds the macOS installer window background: resources/dmg/background.png
// (658x498, the DMG window size) and background@2x.png for Retina screens.
//
//   node scripts/make-dmg-background.mjs
//
// The icon positions it is drawn around are in forge.config.ts (DMG_LAYOUT);
// change both together. Committed, so builds never need to run this.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'resources/dmg');
mkdirSync(outDir, { recursive: true });

const W = 658;
const H = 498;
/** Icon centres, in window points. Must match forge.config.ts. */
const APP = { x: 180, y: 290 };
const APPS = { x: 478, y: 290 };

function svg(scale) {
  const s = (n) => n * scale;
  return Buffer.from(`
  <svg width="${s(W)}" height="${s(H)}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0f1b2d"/>
        <stop offset="1" stop-color="#05080f"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.58" r="0.55">
        <stop offset="0" stop-color="#38bdf8" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
      </radialGradient>
      <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
        <path d="M28 0H0V28" fill="none" stroke="#38bdf8" stroke-opacity="0.05" stroke-width="1"/>
      </pattern>
      <linearGradient id="arrow" gradientUnits="userSpaceOnUse" x1="${APP.x + 78}" y1="0" x2="${APPS.x - 92}" y2="0">
        <stop offset="0" stop-color="#38bdf8" stop-opacity="0.2"/>
        <stop offset="1" stop-color="#38bdf8"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#grid)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>

    <text x="${W / 2}" y="92" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial" font-size="40"
          font-weight="800" font-style="italic" fill="#e9f1fb">Pluto<tspan fill="#38bdf8">Sim</tspan></text>
    <text x="${W / 2}" y="122" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial" font-size="12"
          letter-spacing="4" fill="#7d8da5">DRONE FLIGHT SIMULATOR · DRONA AVIATION</text>

    <!-- Target frame under the Applications link, so the destination reads even
         before Finder has drawn the folder icon. -->
    <rect x="${APPS.x - 70}" y="${APPS.y - 70}" width="140" height="140" rx="26" fill="#38bdf8" fill-opacity="0.06"
          stroke="#38bdf8" stroke-opacity="0.45" stroke-width="2" stroke-dasharray="8 6"/>

    <path d="M${APP.x + 78} ${APP.y} H${APPS.x - 92}" stroke="url(#arrow)" stroke-width="5" stroke-linecap="round"/>
    <path d="M${APPS.x - 106} ${APP.y - 16} L${APPS.x - 86} ${APP.y} L${APPS.x - 106} ${APP.y + 16}" fill="none"
          stroke="#38bdf8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>

    <text x="${W / 2}" y="${H - 44}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial" font-size="15"
          font-weight="600" fill="#e9f1fb">Drag PlutoSim into Applications to install</text>
  </svg>`);
}

await sharp(svg(1)).png().toFile(path.join(outDir, 'background.png'));
await sharp(svg(2)).png().toFile(path.join(outDir, 'background@2x.png'));
console.log('wrote resources/dmg/background.png and background@2x.png');

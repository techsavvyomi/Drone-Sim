// Builds the one-file Apps Script backend: backend/dist/DroneSimulatorAPI.gs.
//
// The backend is kept as several files in backend/apps-script/ so it can be read
// and tested in pieces. Apps Script is happy with either, but pasting one file
// into the editor is far less error-prone than recreating seven, so this joins
// them in dependency order. Run it after changing anything in that folder:
//
//   node scripts/build-apps-script.mjs
//
// tests/backend-bundle.test.ts fails when the bundle is out of date.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = path.join(root, 'backend/apps-script');
const out = path.join(root, 'backend/dist/DroneSimulatorAPI.gs');

/** Constants first, then the layers that use them. */
export const ORDER = ['Schema.js', 'Catalog.js', 'Db.js', 'Api.js', 'Code.js', 'Setup.js', 'Crashes.js', 'Analytics.js'];

export function bundle() {
  const header = [
    '// Drone Simulator API: Google Apps Script backend (generated file).',
    '//',
    '// Paste this whole file into Code.gs of the Apps Script project, set the',
    '// manifest from backend/apps-script/appsscript.json, then deploy as a web app.',
    '// Full steps: backend/README.md.',
    '//',
    '// Do not edit here: edit backend/apps-script/*.js and run',
    '// `node scripts/build-apps-script.mjs`.',
    '',
  ].join('\n');
  const parts = ORDER.map((file) => {
    const body = readFileSync(path.join(src, file), 'utf8').trimEnd();
    return `// ${'='.repeat(74)}\n// ${file}\n// ${'='.repeat(74)}\n\n${body}\n`;
  });
  return `${header}\n${parts.join('\n')}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, bundle());
  console.log(`wrote ${path.relative(root, out)}`);
}

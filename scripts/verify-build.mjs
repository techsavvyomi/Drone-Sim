// Checks that a packaged build is locked down before it goes to anyone.
//
//   npm run package && npm run verify:build
//
// Fails (exit 1) unless, for every packaged app under out/:
//   - everything the app loads is inside app.asar (no loose app folder);
//   - every .glb in app.asar is encrypted (no readable glTF header);
//   - no source maps shipped;
//   - the Electron fuses are set: no run-as-Node, no NODE_OPTIONS or --inspect,
//     asar integrity checked, app loaded only from app.asar.

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');

/** A fuse's state on the wire is the character '0' (off) or '1' (on). */
const FuseState = { DISABLE: '0'.charCodeAt(0), ENABLE: '1'.charCodeAt(0) };

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = path.join(root, 'out');

function findFiles(dir, match, depth = 0, found = []) {
  if (depth > 6 || !existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (match(entry, full)) found.push(full);
    else if (entry.isDirectory() && !entry.name.endsWith('.asar')) findFiles(full, match, depth + 1, found);
  }
  return found;
}

function executableFor(resourcesDir) {
  const appDir = path.dirname(path.dirname(resourcesDir));
  if (appDir.endsWith('.app')) {
    const macos = path.join(appDir, 'Contents', 'MacOS');
    return path.join(macos, readdirSync(macos)[0]);
  }
  const dir = path.dirname(resourcesDir);
  const exe = readdirSync(dir).find(
    (f) => f.endsWith('.exe') || (!f.includes('.') && statSync(path.join(dir, f)).isFile() && f !== 'LICENSE'),
  );
  return exe ? path.join(dir, exe) : null;
}

const asars = findFiles(outDir, (e) => e.isFile() && e.name === 'app.asar');
if (asars.length === 0) {
  console.error('No packaged app found under out/. Run `npm run package` first.');
  process.exit(1);
}

let failed = false;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed = true;
};

for (const archive of asars) {
  const resources = path.dirname(archive);
  console.log(`\n${path.relative(root, archive)}`);

  check(!existsSync(path.join(resources, 'app')), 'no unpacked app folder beside app.asar');

  const files = asar.listPackage(archive, { isPack: false }).map((f) => f.replace(/^[\\/]/, ''));
  const glbs = files.filter((f) => f.toLowerCase().endsWith('.glb'));
  const plain = glbs.filter((f) => {
    const head = asar.extractFile(archive, f).subarray(0, 8).toString('latin1');
    return !head.startsWith('DSIMENC1');
  });
  check(glbs.length > 0 && plain.length === 0, 'every .glb model is encrypted', `${glbs.length - plain.length}/${glbs.length}`);
  plain.forEach((f) => console.log(`        readable: ${f}`));

  const maps = files.filter((f) => f.endsWith('.map'));
  check(maps.length === 0, 'no source maps', maps.slice(0, 3).join(', '));

  const exe = executableFor(resources);
  if (!exe) {
    check(false, 'Electron fuses', 'executable not found');
    continue;
  }
  const wire = await getCurrentFuseWire(exe);
  const want = {
    RunAsNode: FuseState.DISABLE,
    EnableNodeOptionsEnvironmentVariable: FuseState.DISABLE,
    EnableNodeCliInspectArguments: FuseState.DISABLE,
    EnableEmbeddedAsarIntegrityValidation: FuseState.ENABLE,
    OnlyLoadAppFromAsar: FuseState.ENABLE,
  };
  for (const [name, state] of Object.entries(want)) {
    check(wire[FuseV1Options[name]] === state, `fuse ${name} is ${state === FuseState.ENABLE ? 'on' : 'off'}`);
  }
}

console.log(failed ? '\nBuild is NOT locked down.' : '\nBuild is locked down.');
process.exit(failed ? 1 : 0);

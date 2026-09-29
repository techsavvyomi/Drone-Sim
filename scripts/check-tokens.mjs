#!/usr/bin/env node
// ----------------------------------------------------------------------------
// Every colour and font in the UI comes from src/renderer/styles/tokens.css.
//
// This fails when UI code outside tokens.css writes a colour literal
// (#hex, rgb(), rgba(), hsl(), hsla()) or names a font (font-family: 'X',
// fontFamily: …). Change a colour in tokens.css and it has to change
// everywhere — that only holds while nothing else spells one out.
//
// The screens built before the design system still hold their own colours.
// They are listed in LEGACY and skipped; each redesign phase removes its files
// from the list. A listed file that has become clean is also an error, so the
// list can only shrink and never goes stale.
//
//   node scripts/check-tokens.mjs            check the repo
//   node scripts/check-tokens.mjs --list     print every file that offends now
//   node scripts/check-tokens.mjs --root DIR --no-legacy   (tests)
// ----------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/** UI code, relative to the root. The 3D world (scene/, plugins/, missions/
 *  markers) paints materials, not interface, and is out of scope. */
const UI_PATHS = [
  'src/renderer/app',
  'src/renderer/hud',
  'src/renderer/ds',
  'src/renderer/styles',
  'src/renderer/ui',
  'src/renderer/index.css',
];

/** The only file allowed to write colours and font names. */
const TOKENS = 'src/renderer/styles/tokens.css';

/** Pre-redesign files that still carry their own colours (2026-09-28).
 *  Remove a file here when its phase moves it onto the tokens. */
const LEGACY = [
  'src/renderer/hud/AltitudeTape.tsx',
  'src/renderer/hud/ArtificialHorizon.tsx',
  'src/renderer/hud/Compass.tsx',
  'src/renderer/hud/MissionArt.tsx',
  'src/renderer/hud/MissionCityMap.tsx',
  'src/renderer/hud/MissionMap.tsx',
  'src/renderer/hud/StickIndicator.tsx',
  'src/renderer/hud/SupportDebugWidget.tsx',
  'src/renderer/hud/planLayers.ts',
  'src/renderer/index.css',
  'src/renderer/ui/TelemetryChart.tsx',
];

const EXT = /\.(css|tsx?|jsx?)$/;

const RULES = [
  {
    name: 'hex colour',
    re: /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/,
  },
  { name: 'colour function', re: /\b(?:rgba?|hsla?)\s*\(/ },
  // A font-family naming anything but a token or a CSS keyword.
  { name: 'font name', re: /font-family\s*:\s*(?!\s*(?:var\(|(?:inherit|initial|unset)\b))[^;]+/ },
  { name: 'font name', re: /fontFamily\s*:/ },
];

function walk(abs, out) {
  if (!existsSync(abs)) return;
  if (statSync(abs).isDirectory()) {
    for (const name of readdirSync(abs)) walk(join(abs, name), out);
  } else if (EXT.test(abs)) {
    out.push(abs);
  }
}

/** Every offending line in one file's text, with its rule. */
export function findViolations(text) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    // Comments may talk about colours; only code counts.
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/(^|\s)\/\/.*$/, '');
    for (const rule of RULES) {
      if (rule.re.test(code)) {
        found.push({ line: i + 1, rule: rule.name, text: line.trim() });
        break;
      }
    }
  });
  return found;
}

export function check({ root, legacy = LEGACY }) {
  const files = [];
  for (const p of UI_PATHS) walk(join(root, p), files);
  const legacySet = new Set(legacy);
  const offenders = new Map();
  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join('/');
    if (rel === TOKENS) continue;
    const v = findViolations(readFileSync(abs, 'utf8'));
    if (v.length) offenders.set(rel, v);
  }
  const errors = [];
  for (const [rel, v] of offenders) {
    if (legacySet.has(rel)) continue;
    for (const x of v) errors.push(`${rel}:${x.line}  ${x.rule} outside tokens.css  →  ${x.text}`);
  }
  for (const rel of legacy) {
    if (!offenders.has(rel))
      errors.push(
        `${rel}  is on the LEGACY list but is clean now — remove it from scripts/check-tokens.mjs`,
      );
  }
  return { errors, offenders };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const rootAt = args.indexOf('--root');
  const root =
    rootAt >= 0 ? args[rootAt + 1] : join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const legacy = args.includes('--no-legacy') ? [] : LEGACY;
  const { errors, offenders } = check({ root, legacy });
  if (args.includes('--list')) {
    for (const [rel, v] of offenders) console.log(`${rel}  (${v.length})`);
    process.exit(0);
  }
  if (errors.length) {
    console.error(`check-tokens: ${errors.length} problem(s)\n`);
    for (const e of errors) console.error(`  ${e}`);
    console.error(
      '\nColours and fonts belong in src/renderer/styles/tokens.css — read them with var(--name) or token().',
    );
    process.exit(1);
  }
  console.log(`check-tokens: ok (${LEGACY.length} legacy file(s) still to move onto tokens)`);
}

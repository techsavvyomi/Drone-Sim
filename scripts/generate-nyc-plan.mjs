// Generates the top-down city plan the mission map draws.
//
// Why a generated file and not the colliders themselves: `NewYorkColliders.tsx`
// holds ~800 boxes at 1 m footprint resolution, which is the right shape for
// physics and the wrong one for a map. A map wants a few hundred merged
// rectangles it can repaint without thinking about it, and it wants them
// WITHOUT the roof heights, the props, or the sidewalk plates — a plan of the
// city is its blocks, not its lamp posts.
//
// Method: rasterise every building footprint onto a 1 m grid, then merge each
// row of filled cells into runs and each run downwards into a rectangle. The
// output is exact — no cell is dropped or invented — just far fewer boxes.
//
// Usage:
//   node scripts/generate-nyc-plan.mjs
//
// Reads:  src/renderer/scene/environment/NewYorkColliders.tsx
// Writes: src/renderer/scene/environment/NewYorkPlan.ts

import fs from 'node:fs';

const SRC = 'src/renderer/scene/environment/NewYorkColliders.tsx';
const OUT = 'src/renderer/scene/environment/NewYorkPlan.ts';

const BOX =
  /\{ pos: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\], args: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\] \}/;

const src = fs.readFileSync(SRC, 'utf8');
const boxes = [];
let section = null;
for (const line of src.split('\n')) {
  const head = line.match(/^const ([A-Z_]+)\s*:/);
  if (head) {
    section = head[1];
    continue;
  }
  const m = BOX.exec(line);
  if (!m || section !== 'BUILDING_BOXES') continue;
  boxes.push({ x: +m[1], z: +m[3], hx: +m[4], hz: +m[6] });
}
if (boxes.length < 100) throw new Error(`only ${boxes.length} building boxes parsed`);

// The grid, sized to whatever the city actually spans rather than to a constant
// that a regeneration could quietly outgrow.
let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
for (const b of boxes) {
  minX = Math.min(minX, b.x - b.hx);
  maxX = Math.max(maxX, b.x + b.hx);
  minZ = Math.min(minZ, b.z - b.hz);
  maxZ = Math.max(maxZ, b.z + b.hz);
}
const x0 = Math.floor(minX);
const z0 = Math.floor(minZ);
const w = Math.ceil(maxX) - x0;
const d = Math.ceil(maxZ) - z0;

const grid = new Uint8Array(w * d);
for (const b of boxes) {
  const ax = Math.max(0, Math.floor(b.x - b.hx - x0));
  const bx = Math.min(w, Math.ceil(b.x + b.hx - x0));
  const az = Math.max(0, Math.floor(b.z - b.hz - z0));
  const bz = Math.min(d, Math.ceil(b.z + b.hz - z0));
  for (let j = az; j < bz; j++) for (let i = ax; i < bx; i++) grid[j * w + i] = 1;
}

// Runs across, then merged down: a block that is 40 cells wide and 30 deep
// leaves as one rectangle rather than 1200 cells or 30 strips.
const rects = [];
const used = new Uint8Array(w * d);
for (let j = 0; j < d; j++) {
  for (let i = 0; i < w; i++) {
    if (!grid[j * w + i] || used[j * w + i]) continue;
    let i2 = i;
    while (i2 < w && grid[j * w + i2] && !used[j * w + i2]) i2++;
    let j2 = j + 1;
    for (; j2 < d; j2++) {
      let whole = true;
      for (let k = i; k < i2; k++)
        if (!grid[j2 * w + k] || used[j2 * w + k]) {
          whole = false;
          break;
        }
      if (!whole) break;
    }
    for (let r = j; r < j2; r++) for (let k = i; k < i2; k++) used[r * w + k] = 1;
    rects.push([x0 + i, z0 + j, i2 - i, j2 - j]);
    i = i2 - 1;
  }
}

const body = rects.map((r) => `  [${r.join(', ')}],`).join('\n');
fs.writeFileSync(
  OUT,
  `// GENERATED FILE — do not edit by hand.
// Regenerate with:  node scripts/generate-nyc-plan.mjs
//
// The top-down plan of New York City, for the mission map. Building footprints
// only — no heights, no props, no sidewalks: a map of the city is its blocks.
//
// Merged out of the ${boxes.length} collider boxes in NewYorkColliders.tsx, which is
// where the shape actually comes from. The merge is exact — every square metre
// of footprint is covered by exactly one rectangle — so this can never show a
// building the pilot can fly through, or miss one they cannot.

/** One block: [x, z, width, depth] in world metres, x/z the near corner. */
export type PlanRect = readonly [number, number, number, number];

/** The city bounds these rectangles live in, world metres. */
export const NYC_PLAN_BOUNDS = {
  minX: ${x0},
  minZ: ${z0},
  maxX: ${x0 + w},
  maxZ: ${z0 + d},
} as const;

export const NYC_PLAN: readonly PlanRect[] = [
${body}
];
`,
  'utf8',
);
console.log(
  `${boxes.length} collider boxes → ${rects.length} plan rectangles, bounds ${x0}..${x0 + w} x ${z0}..${z0 + d}`,
);

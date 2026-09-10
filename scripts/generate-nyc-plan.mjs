// Generates the top-down city plan the mission map draws.
//
// Why a generated file and not the colliders themselves: `NewYorkColliders.tsx`
// holds ~800 boxes shaped for physics. A map wants them in a form it can paint
// in one pass: roofs it can shade, and the EDGES between roofs it can outline.
//
// Why heights and edges, and not just footprints: the first version of this
// file merged every building footprint into one silhouette per block, and the
// city came out as nine grey blobs. That is not what the model is — each block
// is a dozen buildings, towers, setbacks, roof tanks — and a map that fuses them
// hands the pilot a search area with nothing in it to search. The GLB does not
// help directly: its 38 mesh nodes are one per MATERIAL, not one per building,
// so there is no "building" object to outline. What does separate one building
// from the next is height. Two roofs at different heights are two structures,
// and the line between them is what the eye reads as a building.
//
// Method: rebuild the roof height field from the collider boxes on a 1 m grid,
// then emit
//   - roofs: same-height cells merged into rectangles, each with its height
//   - edges: every boundary between cells whose heights differ by a step, merged
//     into straight runs
// Both are exact to the grid: no roof is dropped and no edge invented.
//
// The GROUND comes from the GLB itself: roads, lane markings, sidewalks, grass
// and tree canopies. None of those collide with anything, so the colliders know
// nothing about them — and a map without them is buildings floating on black,
// which is not the city the pilot is looking at out of the window. Street props
// (lamps, signs, bins) come from the collider props, which is where they are
// already measured.
//
// Everything is emitted as merged rectangles and drawn at runtime. It is vector
// data, not a picture: a baked image of the city was tried and rejected, and
// this is the same information in a form the map paints itself.
//
// Usage:
//   node scripts/generate-nyc-plan.mjs
//
// Reads:  src/renderer/scene/environment/NewYorkColliders.tsx
//         src/assets/models/new_york_city.opt.glb
// Writes: src/renderer/scene/environment/NewYorkPlan.ts

import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const SRC = 'src/renderer/scene/environment/NewYorkColliders.tsx';
const MODEL = 'src/assets/models/new_york_city.opt.glb';
/** Must match CITY_OFFSET in NewYorkEnv.tsx — the plan is world space. */
const CITY_OFFSET = [61.68, 0, -30.56];
const OUT = 'src/renderer/scene/environment/NewYorkPlan.ts';

/**
 * The smallest height difference that counts as a separate structure, metres.
 *
 * The colliders quantise roofs into 3 m bands, so a single flat roof never
 * differs from itself by less than that. Anything under 2 m is the same roof
 * sampled twice, and outlining it would draw a grid across every rooftop.
 */
const STEP = 2;

const BOX =
  /\{ pos: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\], args: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\] \}/;

const src = fs.readFileSync(SRC, 'utf8');
const boxes = [];
const propCells = new Set();
let section = null;
for (const line of src.split('\n')) {
  const head = line.match(/^const ([A-Z_]+)\s*:/);
  if (head) {
    section = head[1];
    continue;
  }
  const m = BOX.exec(line);
  if (!m) continue;
  if (section === 'PROP_BOXES') {
    // A lamp post is dozens of boxes — arm, pole, head, sign. The map wants
    // one dot per thing, so props collapse to the 1 m cell they stand in.
    propCells.add(`${Math.round(+m[1])},${Math.round(+m[3])}`);
    continue;
  }
  if (section !== 'BUILDING_BOXES') continue;
  boxes.push({ x: +m[1], z: +m[3], hx: +m[4], hz: +m[6], top: +m[2] + +m[5] });
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

// Roof height per cell, whole metres. 0 is ground. Where boxes overlap, the
// higher roof wins — that is what is seen from above.
const grid = new Uint8Array(w * d);
for (const b of boxes) {
  const top = Math.min(255, Math.max(1, Math.round(b.top)));
  const ax = Math.max(0, Math.round(b.x - b.hx - x0));
  const bx = Math.min(w, Math.round(b.x + b.hx - x0));
  const az = Math.max(0, Math.round(b.z - b.hz - z0));
  const bz = Math.min(d, Math.round(b.z + b.hz - z0));
  for (let j = az; j < bz; j++)
    for (let i = ax; i < bx; i++) if (top > grid[j * w + i]) grid[j * w + i] = top;
}
const at = (i, j) => (i < 0 || j < 0 || i >= w || j >= d ? 0 : grid[j * w + i]);

// --- Roofs -----------------------------------------------------------------
// Runs across, then merged down, same height only: a roof 40 cells wide and 30
// deep leaves as one rectangle, and the tower on it leaves as another.
const roofs = [];
const used = new Uint8Array(w * d);
for (let j = 0; j < d; j++) {
  for (let i = 0; i < w; i++) {
    const h = grid[j * w + i];
    if (!h || used[j * w + i]) continue;
    let i2 = i;
    while (i2 < w && grid[j * w + i2] === h && !used[j * w + i2]) i2++;
    let j2 = j + 1;
    for (; j2 < d; j2++) {
      let whole = true;
      for (let k = i; k < i2; k++)
        if (grid[j2 * w + k] !== h || used[j2 * w + k]) {
          whole = false;
          break;
        }
      if (!whole) break;
    }
    for (let r = j; r < j2; r++) for (let k = i; k < i2; k++) used[r * w + k] = 1;
    roofs.push([x0 + i, z0 + j, i2 - i, j2 - j, h]);
    i = i2 - 1;
  }
}

// --- Edges -----------------------------------------------------------------
// A unit segment wherever two neighbouring cells differ by a step, then joined
// into straight runs. Horizontal lines sit on the boundary above row j, vertical
// ones on the boundary left of column i.
const edges = [];
const differs = (a, b) => Math.abs(a - b) >= STEP;
for (let j = 0; j <= d; j++) {
  let start = -1;
  for (let i = 0; i <= w; i++) {
    const on = i < w && differs(at(i, j - 1), at(i, j));
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      edges.push([x0 + start, z0 + j, x0 + i, z0 + j]);
      start = -1;
    }
  }
}
for (let i = 0; i <= w; i++) {
  let start = -1;
  for (let j = 0; j <= d; j++) {
    const on = j < d && differs(at(i - 1, j), at(i, j));
    if (on && start < 0) start = j;
    if (!on && start >= 0) {
      edges.push([x0 + i, z0 + start, x0 + i, z0 + j]);
      start = -1;
    }
  }
}

const tallest = roofs.reduce((m, r) => Math.max(m, r[4]), 0);

// --- The ground, from the GLB ----------------------------------------------
//
// Rasterised top-down at 1 m, the highest surface of each kind winning, then
// merged into rectangles per kind. Kinds are read off material names; the same
// names `generate-nyc-colliders.mjs` sorts by.
const GROUND_KINDS = [
  // Lane paint first: it lies ON the road, so a cell holding both is paint.
  { kind: 'lane', re: /_lanes_secondary_color/i, maxY: 1.2 },
  { kind: 'grass', re: /_Grass|basic_dark_green/i, maxY: 5 },
  { kind: 'tree', re: /foliage|leaf|leaves/i, maxY: Infinity },
  { kind: 'walk', re: /side_walks|_Curb/i, maxY: 1.2 },
];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
const doc = await io.read(MODEL);
const layers = Object.fromEntries(GROUND_KINDS.map((k) => [k.kind, new Uint8Array(w * d)]));

const va = [0, 0, 0];
const vb = [0, 0, 0];
const vc = [0, 0, 0];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const t = node.getWorldTranslation();
  const sc = node.getWorldScale();
  const toWorld = (v) => [
    v[0] * sc[0] + t[0] + CITY_OFFSET[0],
    v[1] * sc[1] + t[1] + CITY_OFFSET[1],
    v[2] * sc[2] + t[2] + CITY_OFFSET[2],
  ];
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? '';
    const kind = GROUND_KINDS.find((k) => k.re.test(name));
    if (!kind) continue;
    const layer = layers[kind.kind];
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    for (let q = 0; q + 2 < n; q += 3) {
      pos.getElement(idx ? idx.getScalar(q) : q, va);
      pos.getElement(idx ? idx.getScalar(q + 1) : q + 1, vb);
      pos.getElement(idx ? idx.getScalar(q + 2) : q + 2, vc);
      const A = toWorld(va);
      const B = toWorld(vb);
      const C = toWorld(vc);
      if (Math.min(A[1], B[1], C[1]) > kind.maxY) continue;
      const ix0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]) - x0));
      const ix1 = Math.min(w - 1, Math.floor(Math.max(A[0], B[0], C[0]) - x0));
      const iz0 = Math.max(0, Math.floor(Math.min(A[2], B[2], C[2]) - z0));
      const iz1 = Math.min(d - 1, Math.floor(Math.max(A[2], B[2], C[2]) - z0));
      const thin = ix0 === ix1 || iz0 === iz1;
      for (let iz = iz0; iz <= iz1; iz++)
        for (let ix = ix0; ix <= ix1; ix++) {
          if (!thin) {
            const px = x0 + ix + 0.5;
            const pz = z0 + iz + 0.5;
            const d1 = (px - B[0]) * (A[2] - B[2]) - (A[0] - B[0]) * (pz - B[2]);
            const d2 = (px - C[0]) * (B[2] - C[2]) - (B[0] - C[0]) * (pz - C[2]);
            const d3 = (px - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (pz - A[2]);
            if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) continue;
          }
          layer[iz * w + ix] = 1;
        }
    }
  }
}

/** Merge a 0/1 layer into rectangles: [x, z, w, d] flat. */
function mergeLayer(cells) {
  const out = [];
  const seen = new Uint8Array(w * d);
  for (let j = 0; j < d; j++)
    for (let i = 0; i < w; i++) {
      if (!cells[j * w + i] || seen[j * w + i]) continue;
      let i2 = i;
      while (i2 < w && cells[j * w + i2] && !seen[j * w + i2]) i2++;
      let j2 = j + 1;
      for (; j2 < d; j2++) {
        let whole = true;
        for (let k = i; k < i2; k++)
          if (!cells[j2 * w + k] || seen[j2 * w + k]) {
            whole = false;
            break;
          }
        if (!whole) break;
      }
      for (let r = j; r < j2; r++) for (let k = i; k < i2; k++) seen[r * w + k] = 1;
      out.push([x0 + i, z0 + j, i2 - i, j2 - j]);
      i = i2 - 1;
    }
  return out;
}
const ground = Object.fromEntries(
  Object.entries(layers).map(([kind, cells]) => [kind, mergeLayer(cells)]),
);
const props = [...propCells].map((c) => c.split(',').map(Number));

// Flat arrays rather than arrays of tuples: ~3000 small arrays is a lot of
// module-load garbage for data that is only ever read in fixed-size steps.
const flat = (rows, n) => {
  const out = [];
  for (let k = 0; k < rows.length; k += n)
    out.push(
      '  ' +
        rows
          .slice(k, k + n)
          .map((r) => r.join(', '))
          .join(', ') +
        ',',
    );
  return out.join('\n');
};

fs.writeFileSync(
  OUT,
  `// GENERATED FILE — do not edit by hand.
// Regenerate with:  node scripts/generate-nyc-plan.mjs
//
// The top-down plan of New York City, for the mission map: every roof with its
// height, and every edge where one roof steps to another. Rebuilt from the
// ${boxes.length} collider boxes in NewYorkColliders.tsx, which is where the shape actually
// comes from, so the map can never show a building the pilot can fly through or
// miss one they cannot.

/** The city bounds the plan lives in, world metres. */
export const NYC_PLAN_BOUNDS = {
  minX: ${x0},
  minZ: ${z0},
  maxX: ${x0 + w},
  maxZ: ${z0 + d},
} as const;

/** The tallest roof in the plan, metres — the top of the map's shading ramp. */
export const NYC_PLAN_TALLEST = ${tallest};

/** Roofs, five numbers each: x, z, width, depth, height. World metres, x/z the
 *  near corner. ${roofs.length} roofs. */
export const NYC_ROOFS: readonly number[] = [
${flat(roofs, 4)}
];

/** Edges, four numbers each: x1, z1, x2, z2. World metres. ${edges.length} edges. */
export const NYC_EDGES: readonly number[] = [
${flat(edges, 5)}
];

/** Sidewalks and curbs, four numbers each: x, z, width, depth. ${ground.walk.length} rects. */
export const NYC_WALKS: readonly number[] = [
${flat(ground.walk, 6)}
];

/** Lane paint on the roads, four numbers each. ${ground.lane.length} rects. */
export const NYC_LANES: readonly number[] = [
${flat(ground.lane, 6)}
];

/** Grass and planted beds, four numbers each. ${ground.grass.length} rects. */
export const NYC_GRASS: readonly number[] = [
${flat(ground.grass, 6)}
];

/** Tree canopies seen from above, four numbers each. ${ground.tree.length} rects. */
export const NYC_TREES: readonly number[] = [
${flat(ground.tree, 6)}
];

/** Street props — lamps, signs, bins — one point each: x, z. ${props.length} props. */
export const NYC_PROPS: readonly number[] = [
${flat(props, 10)}
];
`,
  'utf8',
);
console.log(
  `${boxes.length} collider boxes → ${roofs.length} roofs, ${edges.length} edges, tallest ${tallest} m, bounds ${x0}..${x0 + w} x ${z0}..${z0 + d}`,
);
console.log(
  `ground: ${ground.walk.length} walks, ${ground.lane.length} lanes, ${ground.grass.length} grass, ${ground.tree.length} trees, ${props.length} props`,
);

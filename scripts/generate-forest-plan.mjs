// Derives the Forest's top-down plan for the mission map from its GLB.
//
// The mission map draws the ground the pilot is flying over, north up, scrolling
// with the aircraft. New York's plan is rectangles (`generate-nyc-plan.mjs`); a
// forest is not rectangles, so this one is a GRID: one cell every CELL metres
// over the play area, each holding what the ground is there and how high it is,
// and whether there is canopy over it.
//
// Per cell, from straight above:
//   - the TOP ground surface at the cell's centre — terrain, road, rock — found
//     by interpolating every ground triangle that covers the point, and keeping
//     the highest. Roads are laid a few centimetres over the terrain, so a road
//     wins where there is one, which is what a pilot sees from the air.
//   - its HEIGHT, which the map shades by: the gorge reads as a dark cut.
//   - CANOPY, where the leaf cards stand well above that ground.
//
// Usage:
//   node scripts/generate-forest-plan.mjs
//
// Output: src/renderer/scene/environment/ForestPlan.ts

import { writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const MODEL = 'src/assets/models/forest.opt.glb';
const OUT = 'src/renderer/scene/environment/ForestPlan.ts';

/** Must match CLEARING_CENTRE in ForestEnv.tsx, negated (as the colliders). */
const OFFSET = [-2.3, -173.24, -53.7];

/** The play area: the forest spec's bounds, rounded out to whole cells. */
const X0 = -132;
const Z0 = -152;
const X1 = 132;
const Z1 = 66;
/** Cell size, metres. At the map's zoom a metre is under a pixel, so 2 m cells
 *  are about two pixels — fine enough for a road, and a small file. */
const CELL = 2;
const W = (X1 - X0) / CELL;
const H = (Z1 - Z0) / CELL;

/** Heights are stored in half metres from this floor, one byte. */
const Y_FLOOR = -70;

/** Ground kinds, the low three bits of a cell's first byte. */
const KIND = { none: 0, grass: 1, dirt: 2, road: 3, rock: 4 };
const CANOPY_BIT = 8;

/** Which materials are the ground, and what kind each is. Decals, leaves and
 *  undergrowth are not ground: they lie on it and would only add noise. */
function groundKind(mat) {
  if (/Dirt_Road|Road_Edge|Cobblestone/i.test(mat)) return KIND.road;
  if (/Sloped_Rock|Tall_Cliff|Broken_Rocks/i.test(mat)) return KIND.rock;
  if (/Ground_Dirt|Mud_Pile/i.test(mat)) return KIND.dirt;
  if (/Grass_Close|Aerial_Grass|Terrain/i.test(mat)) return KIND.grass;
  return -1;
}
/** The tree crowns: alpha-cut leaf cards. */
const CANOPY_MAT = /^Background_Tree_Atlas$/i;
/** How far over the ground a leaf card has to stand to be canopy, metres —
 *  clear of the undergrowth. */
const CANOPY_MIN = 4;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
console.log(`Reading ${MODEL} ...`);
const doc = await io.read(MODEL);

function xform(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] + OFFSET[0],
    m[1] * x + m[5] * y + m[9] * z + m[13] + OFFSET[1],
    m[2] * x + m[6] * y + m[10] * z + m[14] + OFFSET[2],
  ];
}

/** Every triangle of every primitive whose material matches `pick`, in world
 *  space, handed to `fn(A, B, C, material)`. */
function eachTriangle(pick, fn) {
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()?.getName() ?? '';
      if (!pick(mat)) continue;
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i + 2 < n; i += 3) {
        pos.getElement(idx ? idx.getScalar(i) : i, a);
        pos.getElement(idx ? idx.getScalar(i + 1) : i + 1, b);
        pos.getElement(idx ? idx.getScalar(i + 2) : i + 2, c);
        fn(xform(M, ...a), xform(M, ...b), xform(M, ...c), mat);
      }
    }
  }
}

const ground = new Float32Array(W * H).fill(-Infinity);
const kind = new Uint8Array(W * H);

// --- The ground: the highest surface at each cell's centre --------------------
let groundTris = 0;
eachTriangle(
  (mat) => groundKind(mat) >= 0,
  (A, B, C, mat) => {
    groundTris++;
    const k = groundKind(mat);
    // XZ barycentrics. A triangle standing on edge (a cliff face) has no area
    // from above and covers no cell centre — its top edge is covered by the
    // cliff's own top surface.
    const det = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
    if (Math.abs(det) < 1e-6) return;
    const ix0 = Math.max(0, Math.floor((Math.min(A[0], B[0], C[0]) - X0) / CELL));
    const ix1 = Math.min(W - 1, Math.floor((Math.max(A[0], B[0], C[0]) - X0) / CELL));
    const iz0 = Math.max(0, Math.floor((Math.min(A[2], B[2], C[2]) - Z0) / CELL));
    const iz1 = Math.min(H - 1, Math.floor((Math.max(A[2], B[2], C[2]) - Z0) / CELL));
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = Z0 + (iz + 0.5) * CELL;
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = X0 + (ix + 0.5) * CELL;
        const l1 = ((B[2] - C[2]) * (px - C[0]) + (C[0] - B[0]) * (pz - C[2])) / det;
        const l2 = ((C[2] - A[2]) * (px - C[0]) + (A[0] - C[0]) * (pz - C[2])) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
        const y = l1 * A[1] + l2 * B[1] + l3 * C[1];
        const i = iz * W + ix;
        if (y > ground[i]) {
          ground[i] = y;
          kind[i] = k;
        }
      }
    }
  },
);

// --- The canopy: leaf cards standing well over that ground -------------------
const canopy = new Uint8Array(W * H);
let leafTris = 0;
eachTriangle(
  (mat) => CANOPY_MAT.test(mat),
  (A, B, C) => {
    leafTris++;
    const cx = (A[0] + B[0] + C[0]) / 3;
    const cz = (A[2] + B[2] + C[2]) / 3;
    const top = Math.max(A[1], B[1], C[1]);
    const ix = Math.floor((cx - X0) / CELL);
    const iz = Math.floor((cz - Z0) / CELL);
    if (ix < 0 || iz < 0 || ix >= W || iz >= H) return;
    const i = iz * W + ix;
    if (Number.isFinite(ground[i]) && top - ground[i] < CANOPY_MIN) return;
    canopy[i] = 1;
  },
);

// --- Encode: two bytes a cell ------------------------------------------------
const bytes = new Uint8Array(W * H * 2);
let covered = 0;
let lo = Infinity;
let hi = -Infinity;
for (let i = 0; i < W * H; i++) {
  const has = Number.isFinite(ground[i]);
  if (has) {
    covered++;
    lo = Math.min(lo, ground[i]);
    hi = Math.max(hi, ground[i]);
  }
  bytes[i * 2] = (has ? kind[i] : KIND.none) | (canopy[i] ? CANOPY_BIT : 0);
  bytes[i * 2 + 1] = has ? Math.max(0, Math.min(255, Math.round((ground[i] - Y_FLOOR) * 2))) : 0;
}
const b64 = Buffer.from(bytes).toString('base64');

const out = `// GENERATED FILE — do not edit by hand.
// Regenerate with:  node scripts/generate-forest-plan.mjs
//
// The Forest seen from above, for the mission map: a ${W} x ${H} grid of ${CELL} m
// cells over the play area, two bytes a cell, base64. See the generator for how
// each cell is found.
//
//   byte 0: ground kind in the low three bits (0 none, 1 grass, 2 dirt,
//           3 road, 4 rock), and ${CANOPY_BIT} set where canopy stands over it.
//   byte 1: ground height, half metres above ${Y_FLOOR} m.
//
// Ground found in ${covered} of ${W * H} cells, ${lo.toFixed(1)} to ${hi.toFixed(1)} m.

export const FOREST_PLAN = {
  x0: ${X0},
  z0: ${Z0},
  cell: ${CELL},
  w: ${W},
  h: ${H},
  yFloor: ${Y_FLOOR},
  canopyBit: ${CANOPY_BIT},
  data: '${b64}',
} as const;
`;
writeFileSync(OUT, out);
console.log(
  `${groundTris} ground and ${leafTris} leaf triangles; ground in ${covered}/${W * H} cells ` +
    `(${lo.toFixed(1)}..${hi.toFixed(1)} m); ${(b64.length / 1024).toFixed(1)} KB -> ${OUT}`,
);

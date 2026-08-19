// Derives analytical tree-trunk colliders for the Forest map from its GLB.
//
// Why: the forest's physics used a trimesh built from every SOLID mesh, and the
// two trunk meshes alone were 83,074 of its 140,545 triangles — 59% of the
// geometry the drone queries against at 250 Hz, for objects that are simply
// vertical posts. Terrain has to stay a trimesh (it is real uneven ground you
// land on), but trunks do not.
//
// Method matches scripts/generate-nyc-colliders.mjs: rasterise triangle
// footprints into a grid, greedy-merge cells into rectangles, fit each box to
// the real geometry bounds, and span only the height the geometry occupies.
//
// Usage:
//   node scripts/generate-forest-colliders.mjs
//   node scripts/generate-forest-colliders.mjs --check
//
// Output: src/renderer/scene/environment/ForestColliders.tsx

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';
import process from 'node:process';

const MODEL = 'src/assets/models/forest.opt.glb';
const OUT = 'src/renderer/scene/environment/ForestColliders.tsx';

/** Must match CLEARING_CENTRE in ForestEnv.tsx, negated. */
const OFFSET = [-2.3, -173.24, -53.7];

/** Which meshes become analytical colliders here. Terrain stays a trimesh. */
const TRUNK_RE = /Trunk_/i;

/**
 * The leaf-card meshes. Their material is `Background_Tree_Atlas`; the node name
 * carries it too, so match on the material to avoid catching the trunks.
 *
 * These are NOT collided directly — they are thousands of intersecting flat
 * planes, and turning them into geometry would hang invisible walls in mid-air
 * wherever a card sits. They are used only to find how HIGH each tree reaches,
 * so a trunk collider can be extended to the top of its own canopy. Without
 * that, everything above the modelled trunk is empty air and the drone flies
 * straight through the crown of the tree.
 */
const CANOPY_MAT = /^Background_Tree_Atlas$/i;

/** Footprint cell for the canopy height lookup — coarse is fine, it is a max. */
const CANOPY_CELL = 3;
/** How far around a trunk box to look for canopy above it, metres. */
const CANOPY_REACH = 4;

/** Footprint cell size, metres. Trunks are thin, so this stays small. */
const CELL = 0.6;
/** Vertical banding — a trunk is one tall box, not a stack of them. */
const BAND = 8;
/** Ignore geometry thinner than this after merging (leaf-litter stragglers). */
const MIN_FOOTPRINT = 0.25;

const CHECK_ONLY = process.argv.slice(2).includes('--check');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

console.log(`Reading ${MODEL} ...`);
const doc = await io.read(MODEL);

/** Apply a column-major glTF world matrix to a point. */
function xform(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * Rasterise trunk triangle footprints into a grid, keeping the real XZ extent
 * and vertical span of the geometry in each cell.
 */
function trunkField() {
  const grid = new Map();
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];

  const mark = (ix, iz, yLo, yHi, x0, x1, z0, z1) => {
    const k = `${ix},${iz}`;
    const cur = grid.get(k);
    const cxLo = Math.max(x0, ix * CELL);
    const cxHi = Math.min(x1, (ix + 1) * CELL);
    const czLo = Math.max(z0, iz * CELL);
    const czHi = Math.min(z1, (iz + 1) * CELL);
    if (cur === undefined) {
      grid.set(k, { yLo, yHi, x0: cxLo, x1: cxHi, z0: czLo, z1: czHi });
      return;
    }
    if (yHi > cur.yHi) cur.yHi = yHi;
    if (yLo < cur.yLo) cur.yLo = yLo;
    if (cxLo < cur.x0) cur.x0 = cxLo;
    if (cxHi > cur.x1) cur.x1 = cxHi;
    if (czLo < cur.z0) cur.z0 = czLo;
    if (czHi > cur.z1) cur.z1 = czHi;
  };

  let tris = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (!TRUNK_RE.test(node.getName() || mesh.getName() || '')) continue;
    const M = node.getWorldMatrix();

    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();

      for (let i = 0; i + 2 < n; i += 3) {
        pos.getElement(idx ? idx.getScalar(i) : i, a);
        pos.getElement(idx ? idx.getScalar(i + 1) : i + 1, b);
        pos.getElement(idx ? idx.getScalar(i + 2) : i + 2, c);
        const A = xform(M, a[0], a[1], a[2]);
        const B = xform(M, b[0], b[1], b[2]);
        const C = xform(M, c[0], c[1], c[2]);
        for (const P of [A, B, C]) {
          P[0] += OFFSET[0];
          P[1] += OFFSET[1];
          P[2] += OFFSET[2];
        }
        tris++;

        const wx0 = Math.min(A[0], B[0], C[0]);
        const wx1 = Math.max(A[0], B[0], C[0]);
        const wz0 = Math.min(A[2], B[2], C[2]);
        const wz1 = Math.max(A[2], B[2], C[2]);
        const yLo = Math.min(A[1], B[1], C[1]);
        const yHi = Math.max(A[1], B[1], C[1]);

        const x0 = Math.floor(wx0 / CELL);
        const x1 = Math.floor(wx1 / CELL);
        const z0 = Math.floor(wz0 / CELL);
        const z1 = Math.floor(wz1 / CELL);
        // A trunk wall seen from above collapses to a line; its bbox is one cell
        // wide and a point-in-triangle test would reject every centre.
        const degenerate = x0 === x1 || z0 === z1;

        for (let ix = x0; ix <= x1; ix++) {
          for (let iz = z0; iz <= z1; iz++) {
            if (degenerate) {
              mark(ix, iz, yLo, yHi, wx0, wx1, wz0, wz1);
              continue;
            }
            const px = ix * CELL + CELL / 2;
            const pz = iz * CELL + CELL / 2;
            const d1 = (px - B[0]) * (A[2] - B[2]) - (A[0] - B[0]) * (pz - B[2]);
            const d2 = (px - C[0]) * (B[2] - C[2]) - (B[0] - C[0]) * (pz - C[2]);
            const d3 = (px - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (pz - A[2]);
            const neg = d1 < 0 || d2 < 0 || d3 < 0;
            const posv = d1 > 0 || d2 > 0 || d3 > 0;
            if (!(neg && posv)) mark(ix, iz, yLo, yHi, wx0, wx1, wz0, wz1);
          }
        }
      }
    }
  }
  console.log(`  trunk triangles rasterised: ${tris.toLocaleString()}`);
  return grid;
}

/** Highest canopy vertex per coarse cell, for extending trunks to treetop. */
function canopyField() {
  const grid = new Map();
  const v = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat || !CANOPY_MAT.test(mat.getName())) continue;
      const pos = prim.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const w = xform(M, v[0], v[1], v[2]);
        const x = w[0] + OFFSET[0];
        const y = w[1] + OFFSET[1];
        const z = w[2] + OFFSET[2];
        const k = `${Math.floor(x / CANOPY_CELL)},${Math.floor(z / CANOPY_CELL)}`;
        const cur = grid.get(k);
        if (cur === undefined || y > cur) grid.set(k, y);
      }
    }
  }
  return grid;
}

/** Highest canopy anywhere within CANOPY_REACH of a box footprint. */
function canopyTopNear(canopy, x0, x1, z0, z1) {
  const ix0 = Math.floor((x0 - CANOPY_REACH) / CANOPY_CELL);
  const ix1 = Math.floor((x1 + CANOPY_REACH) / CANOPY_CELL);
  const iz0 = Math.floor((z0 - CANOPY_REACH) / CANOPY_CELL);
  const iz1 = Math.floor((z1 + CANOPY_REACH) / CANOPY_CELL);
  let top = -Infinity;
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const y = canopy.get(`${ix},${iz}`);
      if (y !== undefined && y > top) top = y;
    }
  }
  return top;
}

/** Greedy maximal-rectangle merge over a set of grid keys. */
function mergeRects(cells) {
  const remaining = new Set(cells);
  const key = (x, z) => `${x},${z}`;
  const rects = [];
  const sorted = [...cells]
    .map((k) => k.split(',').map(Number))
    .sort((p, q) => p[1] - q[1] || p[0] - q[0]);

  for (const [sx, sz] of sorted) {
    if (!remaining.has(key(sx, sz))) continue;
    let w = 1;
    while (remaining.has(key(sx + w, sz))) w++;
    let h = 1;
    for (;;) {
      let ok = true;
      for (let x = sx; x < sx + w; x++) {
        if (!remaining.has(key(x, sz + h))) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      h++;
    }
    for (let z = sz; z < sz + h; z++)
      for (let x = sx; x < sx + w; x++) remaining.delete(key(x, z));
    rects.push({ x: sx, z: sz, w, h });
  }
  return rects;
}

const round = (n) => Math.round(n * 100) / 100;

console.log('Rasterising trunks ...');
const grid = trunkField();
console.log('Sampling canopy heights ...');
const canopy = canopyField();
console.log(`  canopy cells: ${canopy.size}`);
let extended = 0;
let totalRaise = 0;

// Bucket by vertical band so a tall trunk is not merged with a low stump.
const bands = new Map();
for (const [k, c] of grid) {
  const key = `${Math.floor(c.yLo / BAND)}|${Math.ceil(c.yHi / BAND)}`;
  if (!bands.has(key)) bands.set(key, []);
  bands.get(key).push(k);
}

const boxes = [];
for (const cells of bands.values()) {
  for (const r of mergeRects(cells)) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let yLo = Infinity;
    let yHi = -Infinity;
    for (let ix = r.x; ix < r.x + r.w; ix++) {
      for (let iz = r.z; iz < r.z + r.h; iz++) {
        const c = grid.get(`${ix},${iz}`);
        if (!c) continue;
        if (c.x0 < x0) x0 = c.x0;
        if (c.x1 > x1) x1 = c.x1;
        if (c.z0 < z0) z0 = c.z0;
        if (c.z1 > z1) z1 = c.z1;
        if (c.yLo < yLo) yLo = c.yLo;
        if (c.yHi > yHi) yHi = c.yHi;
      }
    }
    if (!isFinite(x0)) continue;

    // Give a knife-thin footprint some substance, or nothing can hit it.
    const T = MIN_FOOTPRINT;
    if (x1 - x0 < T) {
      const m = (x0 + x1) / 2;
      x0 = m - T / 2;
      x1 = m + T / 2;
    }
    if (z1 - z0 < T) {
      const m = (z0 + z1) / 2;
      z0 = m - T / 2;
      z1 = m + T / 2;
    }
    // Carry the collider up to the top of this tree's own canopy. The modelled
    // trunk usually stops partway up — everything above it is leaf cards, which
    // are not collided — so without this the drone flies clean through the crown
    // of every tree. Extending the trunk keeps the footprint narrow, so you can
    // still fly BETWEEN trees, just not THROUGH one.
    const top = canopyTopNear(canopy, x0, x1, z0, z1);
    if (top > yHi) {
      totalRaise += top - yHi;
      extended++;
      yHi = top;
    }

    const halfY = Math.max((yHi - yLo) / 2, 0.1);
    boxes.push({
      pos: [round((x0 + x1) / 2), round(yLo + halfY), round((z0 + z1) / 2)],
      args: [round((x1 - x0) / 2), round(halfY), round((z1 - z0) / 2)],
    });
  }
}

console.log('');
console.log(`Trunk cells   : ${grid.size}`);
console.log(`Trunk boxes   : ${boxes.length}`);
console.log(`Extended to canopy: ${extended} boxes, average raise ${(totalRaise / Math.max(extended, 1)).toFixed(1)} m`);
console.log(`Replaces      : 83,074 trimesh triangles`);

if (CHECK_ONLY) {
  console.log('\n--check: nothing written.');
  process.exit(0);
}

const body = boxes
  .map((b) => `  { pos: [${b.pos.join(', ')}], args: [${b.args.join(', ')}] },`)
  .join('\n');

fs.writeFileSync(
  OUT,
  `import { CuboidCollider, RigidBody } from '@react-three/rapier';

// GENERATED FILE — do not edit by hand.
// Regenerate with:  node scripts/generate-forest-colliders.mjs
//
// Analytical tree-trunk colliders for the Forest map, derived from the visual
// GLB. These replace the two trunk meshes in the scene's physics trimesh, which
// were 83,074 of its 140,545 triangles — 59% of the geometry the drone queried
// against on every one of the 250 physics steps per second, for objects that are
// simply vertical posts.
//
// Terrain deliberately stays a trimesh: it is real uneven ground the drone lands
// on, and approximating it with boxes would be felt immediately.
//
// Coordinates are WORLD space — ForestEnv's clearing offset is already applied.
// Do not offset these again.

const TRUNK_BOXES: Array<{ pos: [number, number, number]; args: [number, number, number] }> = [
${body}
];

export function ForestColliders() {
  return (
    <RigidBody type="fixed" colliders={false} name="forest-trunks">
      {TRUNK_BOXES.map((b, i) => (
        <CuboidCollider key={\`trunk-\${i}\`} args={b.args} position={b.pos} friction={0.7} restitution={0} />
      ))}
    </RigidBody>
  );
}
`,
  'utf8',
);
console.log(`\nWrote ${OUT}`);

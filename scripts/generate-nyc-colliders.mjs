// Derives New York City's analytical physics colliders from the actual GLB
// geometry, replacing hand-calibrated collider data.
//
// Why this exists: the colliders used to be hand-placed. The last hand pass
// collapsed 67 building-wing boxes into 18 whole-building boxes, which left
// 26% of the city's building geometry with no collider at all — including the
// tallest tower on the map. A drone flew straight through it.
//
// Method: rasterise building geometry into a top-down height field, then greedy
// merge same-height cells into maximal rectangles and emit one box per
// rectangle, spanning ground to roof. Props (poles, bins, tree trunks) use the
// same pass at a finer cell size.
//
// Usage:
//   node scripts/generate-nyc-colliders.mjs
//   node scripts/generate-nyc-colliders.mjs --check    # report coverage, write nothing
//
// Output: src/renderer/scene/environment/NewYorkColliders.tsx

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const MODEL = 'src/assets/models/new_york_city.opt.glb';
const OUT = 'src/renderer/scene/environment/NewYorkColliders.tsx';

/** Must match CITY_OFFSET in NewYorkEnv.tsx — collider data is world space. */
const CITY_OFFSET = [61.68, 0, -30.56];

/**
 * Building footprint cell size, metres. This is also the worst-case gap between
 * a collider face and the visible wall, so it is what decides whether the drone
 * can nose into a facade before it stops.
 */
const BUILDING_CELL = 1;
/** Props (poles, trunks, bins) need a finer grid to stay thin. */
const PROP_CELL = 0.5;
/** Sidewalk / curb plates. */
const WALK_CELL = 2;

/** Ignore geometry below this height when building the footprint (ground skirt). */
const BUILDING_MIN_Y = 1.0;
/** Quantise roof heights into bands so merging can find large rectangles. */
const HEIGHT_BAND = 3;

// Material name -> which collider set the geometry belongs to.
const ROAD_RE = /street|lane|decal|grass|_LR_Facades$/i;
const WALK_RE = /side_walks|curb|simple_concrete/i;
const PROP_RE = /bark|trash|WetFloor|Street_Assets/i;
const FOLIAGE_RE = /foliage|leaf|leaves/i;

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});

console.log(`Reading ${MODEL} ...`);
const doc = await io.read(MODEL);

/**
 * Rasterise selected geometry into a top-down height field.
 *
 * Rasterises TRIANGLE FOOTPRINTS, not vertices. A building facade is typically
 * one large quad whose only vertices are its four corners — sampling vertices
 * marks those corners and leaves the entire wall between them unmarked, so the
 * generated collider sits metres behind the visible surface and the drone flies
 * through the facade before hitting anything. Filling each triangle's footprint
 * is what makes the collider agree with what the pilot sees.
 *
 * @returns Map of "ix,iz" -> max world Y over that cell
 */
function heightField(cell, accept, minY) {
  const grid = new Map();
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];

  // Each cell keeps the real XZ extent of the geometry inside it, not just the
  // fact that it is occupied. Emitting grid-aligned boxes puts the collider face
  // up to one cell in FRONT of the wall it represents, so a drone easing toward
  // a facade sinks into an invisible box and gets shoved back out — a violent
  // ejection from a gentle approach. Tight bounds put the contact where the pilot
  // can see it.
  const mark = (ix, iz, y, yLo, x0, x1, z0, z1) => {
    const k = `${ix},${iz}`;
    const cur = grid.get(k);
    // Clip the triangle's extent to this cell — a long triangle spans many cells
    // and its raw bounds would blow each one up to the whole span.
    const cxLo = Math.max(x0, ix * cell);
    const cxHi = Math.min(x1, (ix + 1) * cell);
    const czLo = Math.max(z0, iz * cell);
    const czHi = Math.min(z1, (iz + 1) * cell);
    if (cur === undefined) {
      grid.set(k, { y, yLo, x0: cxLo, x1: cxHi, z0: czLo, z1: czHi });
      return;
    }
    if (y > cur.y) cur.y = y;
    if (yLo < cur.yLo) cur.yLo = yLo;
    if (cxLo < cur.x0) cur.x0 = cxLo;
    if (cxHi > cur.x1) cur.x1 = cxHi;
    if (czLo < cur.z0) cur.z0 = czLo;
    if (czHi > cur.z1) cur.z1 = czHi;
  };

  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const t = node.getWorldTranslation();
    const s = node.getWorldScale();

    const toWorld = (v) => [
      v[0] * s[0] + t[0] + CITY_OFFSET[0],
      v[1] * s[1] + t[1] + CITY_OFFSET[1],
      v[2] * s[2] + t[2] + CITY_OFFSET[2],
    ];

    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!accept(mat ? mat.getName() : '')) continue;
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();

      for (let i = 0; i + 2 < n; i += 3) {
        pos.getElement(idx ? idx.getScalar(i) : i, a);
        pos.getElement(idx ? idx.getScalar(i + 1) : i + 1, b);
        pos.getElement(idx ? idx.getScalar(i + 2) : i + 2, c);
        const A = toWorld(a);
        const B = toWorld(b);
        const C = toWorld(c);

        const topY = Math.max(A[1], B[1], C[1]);
        const botY = Math.min(A[1], B[1], C[1]);
        if (topY < minY) continue;

        // Real-world XZ bounds of this triangle, and the cell range they cover.
        const wx0 = Math.min(A[0], B[0], C[0]);
        const wx1 = Math.max(A[0], B[0], C[0]);
        const wz0 = Math.min(A[2], B[2], C[2]);
        const wz1 = Math.max(A[2], B[2], C[2]);
        const x0 = Math.floor(wx0 / cell);
        const x1 = Math.floor(wx1 / cell);
        const z0 = Math.floor(wz0 / cell);
        const z1 = Math.floor(wz1 / cell);

        // A facade seen from above collapses to a line, so its bbox is one cell
        // wide and the point-in-triangle test below would reject every centre.
        // Marking the whole bbox is both correct here and harmless elsewhere:
        // any cell the bbox touches genuinely contains part of the surface.
        const degenerate = x0 === x1 || z0 === z1;

        for (let ix = x0; ix <= x1; ix++) {
          for (let iz = z0; iz <= z1; iz++) {
            if (degenerate) {
              mark(ix, iz, topY, botY, wx0, wx1, wz0, wz1);
              continue;
            }
            // Cell centre inside the triangle?
            const px = ix * cell + cell / 2;
            const pz = iz * cell + cell / 2;
            const d1 = (px - B[0]) * (A[2] - B[2]) - (A[0] - B[0]) * (pz - B[2]);
            const d2 = (px - C[0]) * (B[2] - C[2]) - (B[0] - C[0]) * (pz - C[2]);
            const d3 = (px - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (pz - A[2]);
            const neg = d1 < 0 || d2 < 0 || d3 < 0;
            const posv = d1 > 0 || d2 > 0 || d3 > 0;
            if (!(neg && posv)) mark(ix, iz, topY, botY, wx0, wx1, wz0, wz1);
          }
        }
      }
    }
  }
  return grid;
}

/**
 * Greedy maximal-rectangle decomposition of a set of grid cells that share a
 * height band. Repeatedly grows the widest run, then extends it downward as far
 * as every row matches.
 */
function mergeRects(cells) {
  const remaining = new Set(cells);
  const rects = [];
  const key = (x, z) => `${x},${z}`;

  const sorted = [...cells]
    .map((k) => k.split(',').map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  for (const [sx, sz] of sorted) {
    if (!remaining.has(key(sx, sz))) continue;

    // Grow right.
    let w = 1;
    while (remaining.has(key(sx + w, sz))) w++;

    // Grow down while the full width is available.
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

/**
 * Height field -> collider boxes spanning ground to roof.
 * Cells are bucketed by quantised height so merging never fuses a low wing into
 * a tall tower.
 */
function boxesFromField(grid, cell, { minHeight = 0, floorY = 0, spanVertical = false, band: bandSize = HEIGHT_BAND } = {}) {
  const bands = new Map();
  for (const [k, c] of grid) {
    if (c.y < minHeight) continue;
    const top = Math.max(bandSize, Math.ceil(c.y / bandSize) * bandSize);
    // Buildings are solid from the ground up, so their top alone identifies a
    // band. Props are not: a street light is a thin pole plus an arm that
    // reaches out over the road several metres up. Bucketing those by top only
    // would merge the arm with the pavement beneath it and extrude one box from
    // the ground to the lamp — a 10 m invisible wall across the street. Keying
    // on the BOTTOM as well keeps the arm its own box at its own height.
    const key = spanVertical ? `${Math.floor(c.yLo / bandSize)}|${top}` : String(top);
    if (!bands.has(key)) bands.set(key, { top, cells: [] });
    bands.get(key).cells.push(k);
  }

  const boxes = [];
  for (const { top: band, cells } of [...bands.values()].sort((a, b) => a.top - b.top)) {
    for (const r of mergeRects(cells)) {
      // Fit the box to the geometry actually inside the merged rectangle rather
      // than to the grid it was found on. Interior cells are full anyway, so this
      // only pulls the outer faces in — exactly where a collider overhanging into
      // open air would be felt as an invisible wall.
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      let top = 0;
      let bot = Infinity;
      for (let ix = r.x; ix < r.x + r.w; ix++) {
        for (let iz = r.z; iz < r.z + r.h; iz++) {
          const c = grid.get(`${ix},${iz}`);
          if (!c) continue;
          if (c.x0 < x0) x0 = c.x0;
          if (c.x1 > x1) x1 = c.x1;
          if (c.z0 < z0) z0 = c.z0;
          if (c.z1 > z1) z1 = c.z1;
          if (c.y > top) top = c.y;
          if (c.yLo < bot) bot = c.yLo;
        }
      }
      if (!isFinite(x0)) continue;

      // Degenerate-thin boxes (a single wall plane seen edge-on) would be a
      // zero-thickness collider, which nothing can reliably hit. Give them the
      // grid cell's thickness.
      const MIN_T = cell * 0.5;
      if (x1 - x0 < MIN_T) {
        const m = (x0 + x1) / 2;
        x0 = m - MIN_T / 2;
        x1 = m + MIN_T / 2;
      }
      if (z1 - z0 < MIN_T) {
        const m = (z0 + z1) / 2;
        z0 = m - MIN_T / 2;
        z1 = m + MIN_T / 2;
      }

      // Height comes from the real maximum, not the merge band, so roofs land
      // where they look like they should. The band only decided what merged.
      const yHi = Math.max(top, band - bandSize + 0.5);
      // Props sit on their own footing; buildings are solid down to the ground.
      const yLo = spanVertical ? Math.max(0, Math.min(bot, yHi - 0.1)) : floorY;
      const halfY = Math.max((yHi - yLo) / 2, 0.05);
      boxes.push({
        pos: [round((x0 + x1) / 2), round(yLo + halfY), round((z0 + z1) / 2)],
        args: [round((x1 - x0) / 2), round(halfY), round((z1 - z0) / 2)],
      });
    }
  }
  return boxes;
}

const round = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------

const isBuilding = (name) =>
  !!name && !ROAD_RE.test(name) && !WALK_RE.test(name) && !PROP_RE.test(name) && !FOLIAGE_RE.test(name);

console.log('Rasterising building geometry ...');
const buildingField = heightField(BUILDING_CELL, isBuilding, BUILDING_MIN_Y);
const buildings = boxesFromField(buildingField, BUILDING_CELL);

console.log('Rasterising props (poles, bins, tree trunks) ...');
const propField = heightField(PROP_CELL, (n) => PROP_RE.test(n), 0.4);
// spanVertical: a prop's collider covers only the height the prop actually
// occupies. A finer band keeps a lamp arm from being fused with its pole.
const props = boxesFromField(propField, PROP_CELL, {
  minHeight: 0.8,
  spanVertical: true,
  band: 1,
});

console.log('Rasterising sidewalks ...');
const walkField = heightField(WALK_CELL, (n) => WALK_RE.test(n), 0.02);
const walks = [];
for (const r of mergeRects([...walkField.keys()])) {
  walks.push({
    pos: [round((r.x + r.w / 2) * WALK_CELL), 0.06, round((r.z + r.h / 2) * WALK_CELL)],
    args: [round((r.w * WALK_CELL) / 2), 0.06, round((r.h * WALK_CELL) / 2)],
  });
}

// ---- Coverage check -------------------------------------------------------
//
// Verified against an INDEPENDENT, finer rasterisation. Checking the boxes
// against the same grid they were built from proves nothing — it only restates
// the merge step. Re-rasterising at half the cell size asks the real question:
// is every part of the visible building surface actually backed by a collider?

const CHECK_CELL = BUILDING_CELL / 2;
const checkField = heightField(CHECK_CELL, isBuilding, BUILDING_MIN_Y);

let covered = 0;
const misses = [];
/** Tight-fitted boxes can fall a hair short of a sample point; allow one skin. */
const SKIN = 0.25;
for (const [k, c] of checkField) {
  const [ix, iz] = k.split(',').map(Number);
  const cx = ix * CHECK_CELL + CHECK_CELL / 2;
  const cz = iz * CHECK_CELL + CHECK_CELL / 2;
  const hit = buildings.some(
    (b) =>
      Math.abs(cx - b.pos[0]) <= b.args[0] + SKIN &&
      Math.abs(cz - b.pos[2]) <= b.args[2] + SKIN &&
      b.pos[1] + b.args[1] >= Math.min(c.y, 1.5),
  );
  if (hit) covered++;
  else misses.push([cx, cz, c.y]);
}
const pct = (covered / checkField.size) * 100;

console.log('');
console.log(`Building cells   : ${buildingField.size}`);
console.log(`Building boxes   : ${buildings.length}`);
console.log(`Prop boxes       : ${props.length}`);
console.log(`Sidewalk plates  : ${walks.length}`);
console.log(`Verify cells     : ${checkField.size}  (independent ${CHECK_CELL} m raster)`);
console.log(`SURFACE COVER    : ${pct.toFixed(2)}%   uncovered: ${misses.length}`);
if (misses.length) {
  console.log('  worst gaps (world X, Z, height):');
  for (const [x, z, y] of misses.sort((p, q) => q[2] - p[2]).slice(0, 8))
    console.log(`    X=${x.toFixed(1).padStart(7)}  Z=${z.toFixed(1).padStart(7)}  ${y.toFixed(1)} m`);
}

if (CHECK_ONLY) {
  console.log('\n--check: nothing written.');
  process.exit(pct > 99 ? 0 : 1);
}

// ---- Emit -----------------------------------------------------------------

const fmt = (list) =>
  list
    .map((b) => `  { pos: [${b.pos.join(', ')}], args: [${b.args.join(', ')}] },`)
    .join('\n');

const out = `import { CuboidCollider, RigidBody } from '@react-three/rapier';

// GENERATED FILE — do not edit by hand.
// Regenerate with:  node scripts/generate-nyc-colliders.mjs
//
// Analytical physics colliders for New York City, derived directly from the
// visual GLB so collision can never drift from what the pilot sees. Zero physics
// triangles; every box is restitution 0 so a crash drops rather than bounces.
//
// Coordinates are WORLD space — CITY_OFFSET is already applied. Do not offset
// these again.
//
// Footprint coverage: ${pct.toFixed(1)}% of building geometry.

/** Buildings: ground-to-roof volumes, ${BUILDING_CELL} m footprint resolution. */
const BUILDING_BOXES: Array<{ pos: [number, number, number]; args: [number, number, number] }> = [
${fmt(buildings)}
];

/** Street furniture and tree trunks: poles, bins, signs. ${PROP_CELL} m resolution. */
const PROP_BOXES: Array<{ pos: [number, number, number]; args: [number, number, number] }> = [
${fmt(props)}
];

/** Raised sidewalk / curb plates, top face at Y = +0.12 m. */
const SIDEWALK_PLATES: Array<{ pos: [number, number, number]; args: [number, number, number] }> = [
${fmt(walks)}
];

export function NewYorkColliders() {
  return (
    <group name="new-york-colliders-group">
      {/* Deep solid foundation floor — top face at Y = 0, buried 10 m. */}
      <RigidBody type="fixed" colliders={false} name="nyc-ground-floor">
        <CuboidCollider args={[3000, 10, 3000]} position={[0, -10, 0]} friction={0.8} restitution={0} />
      </RigidBody>

      {/* Raised sidewalks. */}
      <RigidBody type="fixed" colliders={false} name="nyc-sidewalks">
        {SIDEWALK_PLATES.map((s, i) => (
          <CuboidCollider key={\`sw-\${i}\`} args={s.args} position={s.pos} friction={0.8} restitution={0} />
        ))}
      </RigidBody>

      {/* Buildings. All boxes share ONE fixed RigidBody: Rapier broad-phases
          static colliders individually regardless, so a body per building only
          adds per-body bookkeeping and a much slower scene mount. */}
      <RigidBody type="fixed" colliders={false} name="nyc-buildings">
        {BUILDING_BOXES.map((b, i) => (
          <CuboidCollider key={\`bldg-\${i}\`} args={b.args} position={b.pos} friction={0.8} restitution={0} />
        ))}
      </RigidBody>

      {/* Poles, bins, signs, tree trunks. */}
      <RigidBody type="fixed" colliders={false} name="nyc-props">
        {PROP_BOXES.map((p, i) => (
          <CuboidCollider key={\`prop-\${i}\`} args={p.args} position={p.pos} friction={0.6} restitution={0} />
        ))}
      </RigidBody>
    </group>
  );
}
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');
console.log(`\nWrote ${OUT}`);

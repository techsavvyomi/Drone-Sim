// Checks that every node of every tiger patrol on Mission 5 stands on the ground
// it says it does, and has room above it for a drone with a light cone.
//
// Why this exists, on top of `check-forest-route.mjs`: that script checks the
// Forest Fire mission's rings, zones and corridor. This one checks a different
// kind of thing — a PATH an animal walks, whose nodes are not marks, are not
// drawn, and have no zone to be measured against. What they do have is two
// promises that fail silently when broken:
//
//   1. THE BAKED GROUND HEIGHT. The forest deliberately ships without
//      `EnvironmentSpec.groundY` — the clearing is at zero and the terrain falls
//      sixty metres away from it — so each node carries its own measured
//      `ground`. A number typed a metre out floats the tiger over the deck or
//      buries it in the hill, and the mission's whole AGL rule is measured from
//      it, so the spotlight cone is wrong with it.
//   2. THE AIRSPACE ABOVE IT. A tree here is solid all the way to its own
//      treetop (docs/forest-map.md §2), so the gap between two trunks is far
//      narrower than the render suggests. A node under a canopy is a node the
//      pilot cannot hold a hover over, which turns into "the tiger walked
//      somewhere I could not follow" — the least debuggable bug this mission
//      can have.
//
// Method: read the ground meshes straight out of the GLB, apply ForestEnv's
// clearing offset, and sample the terrain under each node; read the generated
// trunk boxes and report the nearest one to the column above it.
//
// Usage:
//   node scripts/check-tiger-routes.mjs            # report, exit 1 if anything is wrong
//   node scripts/check-tiger-routes.mjs --verbose  # also print every node
//
// Reads:  src/assets/models/forest.opt.glb
//         src/renderer/scene/environment/ForestColliders.tsx
//         src/renderer/missions/tigerRoutes.ts
//         src/renderer/missions/nightTracking.ts

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';
import process from 'node:process';

const MODEL = 'src/assets/models/forest.opt.glb';
const COLLIDERS = 'src/renderer/scene/environment/ForestColliders.tsx';
const ROUTES = 'src/renderer/missions/tigerRoutes.ts';
const MISSION = 'src/renderer/missions/nightTracking.ts';

/** Must match CLEARING_CENTRE in ForestEnv.tsx, negated. */
const OFFSET = [-2.3, -173.24, -53.7];

/** The meshes that are the floor. The same subset `check-forest-route.mjs`
 *  uses: fences, logs and rocks stand ON the ground, and taking their height as
 *  the ground would read a log as a hill. */
const GROUND = /Terrain|Aerial_Grass|Ground_Dirt|Dirt_Road|Cobblestone|Sloped_Rock/i;

/** How far a node's baked `ground` may sit from the measured terrain, metres.
 *  The same tolerance the fire mission's zones are held to. */
const GROUND_TOLERANCE = 0.6;

/**
 * Metres of clear air the column above a node must hold.
 *
 * Not a clearance for the animal — it walks under the canopy quite happily and
 * a tiger is 0.4 m wide. It is a clearance for the DRONE, which has to hold a
 * lit hover over that spot: the Guru spans 1.44 m at mission scale, and the
 * pilot is placing it at night by the edge of a light pool. Four and a half
 * metres is the aircraft plus enough daylight that a drift does not put a rotor
 * into a trunk the pilot cannot see.
 */
const COLUMN_MIN = 4.5;

const VERBOSE = process.argv.slice(2).includes('--verbose');

// ---------------------------------------------------------------------------
// The mission's own numbers
// ---------------------------------------------------------------------------

const missionSrc = fs.readFileSync(MISSION, 'utf8');
const aglMatch = missionSrc.match(/maxTrackAgl:\s*([\d.]+)/);
if (!aglMatch) {
  console.error(`No maxTrackAgl found in ${MISSION}. Has the mission changed shape?`);
  process.exit(1);
}

/** How far up the column is checked, metres above the node's own ground: the
 *  mission's `maxTrackAgl`, read from the mission rather than repeated here. A
 *  default would be a second copy of the number that could quietly disagree. */
const COLUMN_TOP = Number(aglMatch[1]);

const safeMatch = missionSrc.match(/minSafeDistance:\s*([\d.]+)/);
const coneMatch = missionSrc.match(/coneDeg:\s*([\d.]+)/);
const MIN_SAFE = safeMatch ? Number(safeMatch[1]) : 9;
const CONE = coneMatch ? Number(coneMatch[1]) : 26;

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

const routesSrc = fs.readFileSync(ROUTES, 'utf8');
const routes = [];
for (const block of routesSrc.matchAll(
  /id: '([\w-]+)',\s*\n\s*label: '[^']*',\s*\n\s*path: \[([\s\S]*?)\n {2}\],/g,
)) {
  const nodes = [
    ...block[2].matchAll(/\{ at: \[(-?[\d.]+), (-?[\d.]+)\], ground: (-?[\d.]+) \}/g),
  ].map((m) => ({ x: +m[1], z: +m[2], ground: +m[3] }));
  routes.push({ id: block[1], nodes });
}
if (routes.length === 0) {
  console.error(`No routes parsed from ${ROUTES}. Has its format changed?`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The terrain
// ---------------------------------------------------------------------------

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

const CELL = 4;
const terrain = new Map();
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || !GROUND.test(`${node.getName()} ${mesh.getName()}`)) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const p = [0, 0, 0];
    for (let i = 0; i < n; i += 3) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        pos.getElement(idx ? idx.getScalar(i + k) : i + k, p);
        const w = xform(m, p[0], p[1], p[2]);
        tri.push([w[0] + OFFSET[0], w[1] + OFFSET[1], w[2] + OFFSET[2]]);
      }
      const xs = tri.map((v) => v[0]);
      const zs = tri.map((v) => v[2]);
      for (
        let a = Math.floor(Math.min(...xs) / CELL);
        a <= Math.floor(Math.max(...xs) / CELL);
        a++
      ) {
        for (
          let b = Math.floor(Math.min(...zs) / CELL);
          b <= Math.floor(Math.max(...zs) / CELL);
          b++
        ) {
          const key = `${a},${b}`;
          let bucket = terrain.get(key);
          if (!bucket) terrain.set(key, (bucket = []));
          bucket.push(tri);
        }
      }
    }
  }
}

/** The HIGHEST surface at one XZ, or null off the map — the export overlaps a
 *  road onto the terrain under it in places, and taking either arbitrarily gives
 *  a node that floats or sinks depending on triangle order in the file. */
function groundAt(x, z) {
  const bucket = terrain.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  if (!bucket) return null;
  let best = null;
  for (const [a, b, c] of bucket) {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
    if (best === null || y > best) best = y;
  }
  return best;
}

// ---------------------------------------------------------------------------
// The trunks
// ---------------------------------------------------------------------------

const trunks = [
  ...fs
    .readFileSync(COLLIDERS, 'utf8')
    .matchAll(
      /\{ pos: \[([-\d.]+), ([-\d.]+), ([-\d.]+)\], args: \[([-\d.]+), ([-\d.]+), ([-\d.]+)\] \}/g,
    ),
].map((m) => ({ x: +m[1], y: +m[2], z: +m[3], hx: +m[4], hy: +m[5], hz: +m[6] }));
if (trunks.length === 0) {
  console.error(`No trunk boxes parsed from ${COLLIDERS}. Has its format changed?`);
  process.exit(1);
}

/** Distance from a point to the nearest trunk box surface, metres. */
function clearance(x, y, z) {
  let best = Infinity;
  for (const t of trunks) {
    const dx = Math.max(0, Math.abs(x - t.x) - t.hx);
    const dy = Math.max(0, Math.abs(y - t.y) - t.hy);
    const dz = Math.max(0, Math.abs(z - t.z) - t.hz);
    const d = Math.hypot(dx, dy, dz);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

console.log(
  `${routes.length} routes · ${trunks.length} trunk boxes · column ${COLUMN_MIN} m wide to ${COLUMN_TOP} m\n`,
);

let bad = 0;
for (const route of routes) {
  let length = 0;
  for (let i = 1; i < route.nodes.length; i++) {
    length += Math.hypot(
      route.nodes[i].x - route.nodes[i - 1].x,
      route.nodes[i].z - route.nodes[i - 1].z,
    );
  }
  console.log(`${route.id} — ${route.nodes.length} nodes, ${length.toFixed(1)} m walked`);

  let tightest = Infinity;
  for (const n of route.nodes) {
    const measured = groundAt(n.x, n.z);
    if (measured === null) {
      console.log(`  ✗ (${n.x}, ${n.z}) is off the terrain entirely`);
      bad++;
      continue;
    }
    const drift = Math.abs(measured - n.ground);

    // The column the drone has to hold a hover in, sampled from just over the
    // animal's head up to the mission's own tracking ceiling.
    let column = Infinity;
    for (let h = 2; h <= COLUMN_TOP; h += 2) {
      column = Math.min(column, clearance(n.x, measured + h, n.z));
    }
    if (column < tightest) tightest = column;

    const groundOk = drift <= GROUND_TOLERANCE;
    const columnOk = column >= COLUMN_MIN;
    if (!groundOk || !columnOk) bad++;
    if (VERBOSE || !groundOk || !columnOk) {
      const mark = groundOk && columnOk ? '·' : '✗';
      console.log(
        `  ${mark} (${n.x}, ${n.z})  baked ${n.ground.toFixed(2)}  measured ${measured.toFixed(2)}` +
          `  drift ${drift.toFixed(2)}  column ${column.toFixed(1)} m`,
      );
    }
  }
  console.log(`  tightest column on this route: ${tightest.toFixed(1)} m\n`);
}

// One derived fact worth printing every run: the mission's numbers have to leave
// the pilot somewhere to fly. At the safe distance, straight above the animal,
// the light pool has to be wide enough to hold it — otherwise the only way to
// complete the lock is to break the rule that ends the attempt.
const poolAtSafe = Math.tan((CONE * Math.PI) / 180) * MIN_SAFE;
console.log(
  `At the ${MIN_SAFE} m safe distance the ${CONE}° cone makes a ${poolAtSafe.toFixed(1)} m pool.`,
);
if (poolAtSafe < 1) {
  console.log('  ✗ The pool is narrower than a metre: the lock cannot be flown legally.');
  bad++;
}

if (bad > 0) {
  console.log(`\n${bad} problem(s). Fix the route or re-measure.`);
  process.exit(1);
}
console.log('\nEvery node stands on its own ground with room above it.');

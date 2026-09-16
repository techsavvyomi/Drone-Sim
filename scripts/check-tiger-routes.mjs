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

/** The road meshes. A patrol node must not stand on one, nor near one. */
const ROAD = /Dirt_Road|Cobblestone/i;

/** Nearest road surface a node may be, metres. The tiger lives in the trees. */
const ROAD_MIN = 8;

/** Clear air around the animal at shoulder height, metres: at a node, and at
 *  every half metre along the stretch to the next one. */
const TIGER_ROOM = 0.6;

/**
 * Clear air the DRONE needs around a hover point, metres — half the Guru's
 * 1.44 m span plus a margin for a pilot placing it at night.
 *
 * It used to be a 4.5 m column straight ABOVE every node, for a drone hovering
 * over the animal. In this forest a trunk is solid to its treetop, so the only
 * such columns were the roads, and every patrol ended up on one. The beam now
 * points 60° ahead and the hold counts only within `lockRange`, so what a node
 * needs is a hover the pilot can REACH within that range, not one on top of it.
 */
const HOVER_ROOM = 1.5;

const VERBOSE = process.argv.slice(2).includes('--verbose');

// ---------------------------------------------------------------------------
// The mission's own numbers
// ---------------------------------------------------------------------------

const missionSrc = fs.readFileSync(MISSION, 'utf8');
const lockMatch = missionSrc.match(/lockRange:\s*([\d.]+)/);
if (!lockMatch) {
  console.error(`No lockRange found in ${MISSION}. Has the mission changed shape?`);
  process.exit(1);
}

/** How far out the hover may be, metres: the mission's `lockRange`, read from
 *  the mission rather than repeated here, so the two cannot disagree. */
const LOCK_RANGE = Number(lockMatch[1]);

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
  const meshName = `${node.getName()} ${mesh?.getName()}`;
  if (!mesh || !GROUND.test(meshName)) continue;
  const isRoad = ROAD.test(meshName);
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
      tri.road = isRoad;
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

/** The HIGHEST surface at one XZ — and whether it is a road — or null off the
 *  map. The export overlaps a road onto the terrain under it in places, and
 *  taking either arbitrarily gives a node that floats or sinks depending on
 *  triangle order in the file. */
function surfaceAt(x, z) {
  const bucket = terrain.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  if (!bucket) return null;
  let best = null;
  let road = false;
  for (const tri of bucket) {
    const [a, b, c] = tri;
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
    if (best === null || y > best) {
      best = y;
      road = tri.road;
    }
  }
  return best === null ? null : { y: best, road };
}

/** Nearest road surface within `reach` metres of (x, z), sampled on a 1 m ring
 *  grid, or Infinity. */
function roadWithin(x, z, reach) {
  let best = Infinity;
  for (let r = 0; r <= reach; r += 1) {
    const steps = Math.max(1, Math.round((Math.PI * 2 * r) / 1));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const s = surfaceAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (s?.road) return r;
    }
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
  `${routes.length} routes · ${trunks.length} trunk boxes · off-road ${ROAD_MIN} m · ` +
    `tiger room ${TIGER_ROOM} m · hover room ${HOVER_ROOM} m within ${LOCK_RANGE} m\n`,
);

/** A hover point within the lock range of a node, clear by HOVER_ROOM, or null.
 *  Searched on rings 3–8 m out and 3–6 m up — outside the keep-off distance. */
function hoverInReach(x, z, ground) {
  for (const r of [3, 4, 5, 6, 7, 8]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const hx = x + Math.cos(a) * r;
      const hz = z + Math.sin(a) * r;
      for (const h of [3, 4.5, 6]) {
        const range = Math.hypot(r, h);
        if (range < MIN_SAFE + 0.5 || range > LOCK_RANGE) continue;
        const room = clearance(hx, ground + h, hz);
        if (room >= HOVER_ROOM) return { range, room };
      }
    }
  }
  return null;
}

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

  for (const [idx, n] of route.nodes.entries()) {
    const surface = surfaceAt(n.x, n.z);
    if (surface === null) {
      console.log(`  ✗ (${n.x}, ${n.z}) is off the terrain entirely`);
      bad++;
      continue;
    }
    const drift = Math.abs(surface.y - n.ground);
    const road = roadWithin(n.x, n.z, ROAD_MIN);
    const room = clearance(n.x, surface.y + 0.5, n.z);
    const hover = hoverInReach(n.x, n.z, surface.y);

    // The stretch to the next node: the animal must fit between the trunks the
    // whole way, and never step onto a road.
    let stretchOk = true;
    const next = route.nodes[idx + 1];
    if (next) {
      const len = Math.hypot(next.x - n.x, next.z - n.z);
      for (let d = 0.5; d < len; d += 0.5) {
        const x = n.x + ((next.x - n.x) * d) / len;
        const z = n.z + ((next.z - n.z) * d) / len;
        const s2 = surfaceAt(x, z);
        if (!s2 || s2.road || clearance(x, s2.y + 0.5, z) < TIGER_ROOM) {
          stretchOk = false;
          break;
        }
      }
    }

    const groundOk = drift <= GROUND_TOLERANCE;
    const roadOk = !surface.road && road === Infinity;
    const roomOk = room >= TIGER_ROOM;
    const hoverOk = hover !== null;
    const ok = groundOk && roadOk && roomOk && hoverOk && stretchOk;
    if (!ok) bad++;
    if (VERBOSE || !ok) {
      console.log(
        `  ${ok ? '·' : '✗'} (${n.x}, ${n.z})  baked ${n.ground.toFixed(2)}  measured ${surface.y.toFixed(2)}` +
          `  drift ${drift.toFixed(2)}${groundOk ? '' : ' ✗'}` +
          `  road ${road === Infinity ? `>${ROAD_MIN}` : road} m${roadOk ? '' : ' ✗'}` +
          `  room ${room.toFixed(1)} m${roomOk ? '' : ' ✗'}` +
          `  hover ${hover ? `${hover.range.toFixed(1)} m out` : 'none ✗'}` +
          `${next ? `  stretch ${stretchOk ? 'clear' : 'blocked ✗'}` : ''}`,
      );
    }
  }
  console.log('');
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
console.log('\nEvery node stands on its own ground, off the road, with a hover in reach.');

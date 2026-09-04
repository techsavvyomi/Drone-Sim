// Checks that every Forest Fire ring, zone and corridor has real room around it,
// and that every mark's baked ground height still matches the terrain.
//
// Why this exists, on top of the New York one: this map is worse than the city
// for guessing at, in two ways the city never was.
//
//   1. IT HAS NO GROUND. The forest deliberately ships without
//      `EnvironmentSpec.groundY` — the clearing is at zero and the terrain falls
//      62 m away from it — so every mission zone here carries its own measured
//      deck height. A number typed a metre out puts the hover band under the
//      terrain, and nothing in a diff or a typecheck can see that.
//   2. A TREE IS SOLID TO ITS OWN TREETOP. The generated trunk colliders are
//      extended up to the top of each canopy (docs/forest-map.md §2), so the
//      airspace between two trees is much narrower than the modelled trunks
//      suggest, and a ring placed by eye off the visual is routinely inside one.
//
// Method: read the ground meshes straight out of the GLB, apply ForestEnv's
// clearing offset, and sample the terrain under each mark; read the generated
// trunk boxes and report the nearest one to every ring, every zone column and
// the corridor between them.
//
// Usage:
//   node scripts/check-forest-route.mjs            # report, exit 1 if anything is tight
//   node scripts/check-forest-route.mjs --verbose  # also print each corridor sample
//
// Reads:  src/assets/models/forest.opt.glb
//         src/renderer/scene/environment/ForestColliders.tsx
//         src/renderer/missions/forestFire.ts

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';
import process from 'node:process';

const MODEL = 'src/assets/models/forest.opt.glb';
const COLLIDERS = 'src/renderer/scene/environment/ForestColliders.tsx';
const MISSION = 'src/renderer/missions/forestFire.ts';

/** Must match CLEARING_CENTRE in ForestEnv.tsx, negated. */
const OFFSET = [-2.3, -173.24, -53.7];

/** The meshes that are the floor. A subset of ForestEnv's SOLID: the fences,
 *  logs and rocks are things standing ON the ground, and taking their height as
 *  the ground would read a log as a hill. */
const GROUND = /Terrain|Aerial_Grass|Ground_Dirt|Dirt_Road|Cobblestone|Sloped_Rock/i;

/**
 * Metres of clear air a ring must have all round it.
 *
 * The ball is 3 m across the radius, so this is that plus 1.4 m of daylight —
 * the same floor the city's route uses, for the same reason. It is not a
 * clearance for the aircraft; it is a clearance for the MARKER, so it hangs in
 * an opening rather than half inside a tree.
 */
const RING_MIN = 4.4;
/** Metres of clear air a zone needs, through the whole column the pilot
 *  descends down. Wider than a ring's, because the drone has to come to a stop
 *  in it and hold there. */
const ZONE_MIN = 5;
/** How far above a zone's own deck the column is checked, metres. */
const ZONE_TOP = 22;
/**
 * Metres of clear air the SUGGESTED line between rings must hold.
 *
 * Deliberately soft, and softer than the city's. Nothing is drawn on this line,
 * every ring on this mission is optional, and the brief is explicit that the
 * pilot picks their own way through the trees — so this is not a corridor that
 * has to be flyable, it is a sanity check that the rings are not strung through
 * the middle of a trunk. The real promise the mission makes is the one the
 * over-canopy line keeps, which is checked separately below.
 */
const CORRIDOR_MIN = 2;
/** How far apart the corridor is sampled, metres. */
const CORRIDOR_STEP = 2;
/** Ground samples are taken on a grid this size; a mark is also probed at its
 *  four corners to report how flat it is. */
const FLAT_PROBE = 3;
/** How much the ground may vary across a zone before it is called uneven. */
const FLAT_MAX = 1.6;
/** How far a zone's baked `groundY` may sit from the measured terrain. */
const GROUND_TOLERANCE = 0.6;

const VERBOSE = process.argv.slice(2).includes('--verbose');

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

/** Every ground triangle in world space, bucketed by XZ so a lookup does not
 *  walk all forty thousand of them. */
const CELL = 4;
const terrain = new Map();
let triCount = 0;
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
      triCount++;
      const xs = tri.map((v) => v[0]);
      const zs = tri.map((v) => v[2]);
      for (
        let i2 = Math.floor(Math.min(...xs) / CELL);
        i2 <= Math.floor(Math.max(...xs) / CELL);
        i2++
      ) {
        for (
          let j = Math.floor(Math.min(...zs) / CELL);
          j <= Math.floor(Math.max(...zs) / CELL);
          j++
        ) {
          const key = `${i2},${j}`;
          let bucket = terrain.get(key);
          if (!bucket) terrain.set(key, (bucket = []));
          bucket.push(tri);
        }
      }
    }
  }
}

/**
 * The height of the ground at one XZ, or null off the map.
 *
 * The HIGHEST surface, not the first hit: the export overlaps a road onto the
 * terrain under it in places, and taking either one arbitrarily gives a mark
 * that floats or sinks depending on which triangle came first in the file.
 */
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

const trunkSrc = fs.readFileSync(COLLIDERS, 'utf8');
const trunks = [
  ...trunkSrc.matchAll(
    /\{ pos: \[([-\d.]+), ([-\d.]+), ([-\d.]+)\], args: \[([-\d.]+), ([-\d.]+), ([-\d.]+)\] \}/g,
  ),
].map((m) => ({
  x: +m[1],
  y: +m[2],
  z: +m[3],
  hx: +m[4],
  hy: +m[5],
  hz: +m[6],
}));
if (trunks.length === 0) {
  console.error(`No trunk boxes parsed from ${COLLIDERS}. Has its format changed?`);
  process.exit(1);
}

/** Distance from a point to the nearest trunk box surface, in metres. */
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
// The mission
// ---------------------------------------------------------------------------

const src = fs.readFileSync(MISSION, 'utf8');

/** `ring('F1', 22, ALT, -17)` — with ALT and the other consts resolved. */
const consts = {};
for (const m of src.matchAll(/^const ([A-Z_]+) = (-?[\d.]+);/gm)) consts[m[1]] = +m[2];
const num = (tok) => (tok in consts ? consts[tok] : Number(tok));

const rings = [...src.matchAll(/ring\('([^']+)',\s*(-?[\w.]+),\s*(-?[\w.]+),\s*(-?[\w.]+)\)/g)].map(
  (m) => ({ label: m[1], x: num(m[2]), y: num(m[3]), z: num(m[4]) }),
);

/** Each zone's mark, its band and its baked deck height. */
const zones = [
  ...src.matchAll(
    /kind: '(pickup|drop|base)',\s*\n\s*at: \[(-?[\d.]+), (-?[\d.]+)\],[\s\S]*?band: \{ min: (-?[\d.]+), max: (-?[\d.]+) \}/g,
  ),
].map((m) => ({
  kind: m[1],
  x: +m[2],
  z: +m[3],
  bandMin: +m[4],
  bandMax: +m[5],
}));
// The deck a zone is judged against: its own `groundY` where it has one, else the
// mission's. Resolved exactly the way the runtime's `zoneGroundY` resolves it —
// if these two ever disagree, this script is checking a mission nobody flies.
//
// `mission.groundY` is the first one in the file, above the zones, so the plain
// match finds it before any zone's override.
const missionGroundMatch = src.match(/groundY: ([A-Z_]+|-?[\d.]+),/);
const missionGroundY = missionGroundMatch ? num(missionGroundMatch[1]) : 0;
for (const zone of zones) {
  const from = src.indexOf(`kind: '${zone.kind}'`);
  const to = src.indexOf('kind: ', from + 10);
  const block = src.slice(from, to === -1 ? undefined : to);
  const own = block.match(/groundY: ([A-Z_]+|-?[\d.]+),/);
  zone.groundY = own ? num(own[1]) : missionGroundY;
}

if (rings.length === 0 || zones.length !== 3) {
  console.error(
    `Parsed ${rings.length} rings and ${zones.length} zones from ${MISSION}. Has its shape changed?`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

let failures = 0;
const fail = (line) => {
  failures++;
  console.log(`  FAIL  ${line}`);
};

console.log(`\n${triCount} ground triangles, ${trunks.length} trunk boxes\n`);

console.log('Zones');
for (const zone of zones) {
  const measured = groundAt(zone.x, zone.z);
  if (measured === null) {
    fail(`${zone.kind}: no terrain at (${zone.x}, ${zone.z}) — the mark is off the map`);
    continue;
  }
  const drift = Math.abs(measured - zone.groundY);
  // How level the mark is, which is what a landing and a settle test both need.
  let lo = measured;
  let hi = measured;
  for (const [dx, dz] of [
    [FLAT_PROBE, 0],
    [-FLAT_PROBE, 0],
    [0, FLAT_PROBE],
    [0, -FLAT_PROBE],
  ]) {
    const h = groundAt(zone.x + dx, zone.z + dz);
    if (h === null) continue;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  // The whole column the pilot descends through, not just the band: they have to
  // get down to it.
  let worst = Infinity;
  let worstAt = 0;
  for (let h = 0; h <= ZONE_TOP; h += 1) {
    const c = clearance(zone.x, zone.groundY + h, zone.z);
    if (c < worst) {
      worst = c;
      worstAt = h;
    }
  }
  console.log(
    `  ${zone.kind.padEnd(7)} (${zone.x}, ${zone.z})  ground ${measured.toFixed(2)} ` +
      `(declared ${zone.groundY})  flat ${(hi - lo).toFixed(2)} m  ` +
      `column ${worst.toFixed(2)} m at +${worstAt} m  band ${zone.bandMin}..${zone.bandMax}`,
  );
  if (drift > GROUND_TOLERANCE) {
    fail(
      `${zone.kind}: declared groundY ${zone.groundY} but the terrain is at ` +
        `${measured.toFixed(2)} — the height band is measured off the wrong deck`,
    );
  }
  if (hi - lo > FLAT_MAX) {
    fail(`${zone.kind}: ground varies ${(hi - lo).toFixed(2)} m across the mark (max ${FLAT_MAX})`);
  }
  if (worst < ZONE_MIN) {
    fail(
      `${zone.kind}: only ${worst.toFixed(2)} m of clear air at +${worstAt} m (min ${ZONE_MIN})`,
    );
  }
}

console.log('\nRings');
for (const ring of rings) {
  const c = clearance(ring.x, ring.y, ring.z);
  const ground = groundAt(ring.x, ring.z);
  console.log(
    `  ${ring.label.padEnd(4)} (${ring.x}, ${ring.y}, ${ring.z})  nearest trunk ${c.toFixed(2)} m  ` +
      `ground ${ground === null ? 'off map' : ground.toFixed(1)}  ` +
      `${ground === null ? '' : `height above it ${(ring.y - ground).toFixed(1)} m`}`,
  );
  if (c < RING_MIN) fail(`${ring.label}: ${c.toFixed(2)} m to the nearest trunk (min ${RING_MIN})`);
  if (ground !== null && ring.y - ground < 2) {
    fail(`${ring.label}: only ${(ring.y - ground).toFixed(1)} m above the ground`);
  }
}

console.log('\nCorridor (the suggested line, ring to ring)');
const line = [
  {
    label: 'pickup',
    x: zones.find((z) => z.kind === 'pickup').x,
    y: rings[0].y,
    z: zones.find((z) => z.kind === 'pickup').z,
  },
  ...rings,
  {
    label: 'fire',
    x: zones.find((z) => z.kind === 'drop').x,
    y: zones.find((z) => z.kind === 'drop').groundY + zones.find((z) => z.kind === 'drop').bandMax,
    z: zones.find((z) => z.kind === 'drop').z,
  },
];
for (let i = 0; i < line.length - 1; i++) {
  const a = line[i];
  const b = line[i + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const steps = Math.max(1, Math.round(len / CORRIDOR_STEP));
  let worst = Infinity;
  let at = null;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    const c = clearance(x, y, z);
    if (VERBOSE)
      console.log(`      ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}  ${c.toFixed(2)} m`);
    if (c < worst) {
      worst = c;
      at = [x, y, z];
    }
  }
  console.log(
    `  ${a.label} -> ${b.label}  ${len.toFixed(0)} m  worst ${worst.toFixed(2)} m at ` +
      `(${at[0].toFixed(1)}, ${at[1].toFixed(1)}, ${at[2].toFixed(1)})`,
  );
  if (worst < CORRIDOR_MIN) {
    fail(`${a.label} -> ${b.label}: ${worst.toFixed(2)} m of clearance (min ${CORRIDOR_MIN})`);
  }
}

console.log(
  failures === 0
    ? '\nOK — every mark, ring and corridor has room, and every deck height matches the terrain.\n'
    : `\n${failures} problem(s). Fix the coordinates in ${MISSION}.\n`,
);
process.exit(failures === 0 ? 0 : 1);

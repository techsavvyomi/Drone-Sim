// Checks that every Precision Delivery checkpoint, zone and corridor has real
// room around it in New York City.
//
// Why this exists: the mission's coordinates are numbers in a source file, and
// nothing about reading them tells you whether a drone can get there. NYC's
// colliders are generated from the GLB and its street furniture sits far closer
// than the art suggests — the map spec records a spawn that had to move 4 m up
// the street for exactly that reason. A checkpoint dropped inside a building is
// invisible in the diff, invisible in review, and obvious only to the pilot who
// cannot score it.
//
// Method: parse the generated collider boxes and the mission's own coordinates,
// then report the nearest solid surface to every point and along every leg
// between them.
//
// Usage:
//   node scripts/check-mission-route.mjs            # report, exit 1 if anything is tight
//   node scripts/check-mission-route.mjs --verbose  # also print each corridor sample
//
// Reads:  src/renderer/scene/environment/NewYorkColliders.tsx
//         src/renderer/missions/precisionDelivery.ts

import fs from 'node:fs';
import process from 'node:process';

const COLLIDERS = 'src/renderer/scene/environment/NewYorkColliders.tsx';
const MISSION = 'src/renderer/missions/precisionDelivery.ts';

/**
 * Metres of clear air a route checkpoint must have all round it.
 *
 * It protects the ORB, not the drone: the ball drawn on a checkpoint is 3 m
 * across the radius, so this is that plus 1.4 m of daylight — enough that the
 * marker hangs beside a facade rather than half buried in one.
 *
 * It has come DOWN twice, and both times because the checkpoints deliberately
 * moved closer to the buildings rather than because a check was failing. The
 * orb is additively blended: it adds light to whatever is behind it and can
 * hide nothing. Out in the middle of a street it is seen against that street's
 * own vanishing point, which is sky, and a pale city plus open sky is exactly
 * what an additive magenta disappears into. Pushed to one side it is seen
 * against the facades running down that side, and the same ball reads as a lit
 * sphere. So "as much clearance as possible" is the wrong target here: what is
 * wanted is as little as the ball can safely take.
 */
const CP_MIN = 4.4;
/** Metres of clear air a zone needs, from the deck up through the approach. */
const ZONE_MIN = 3.5;
/** How high the zone approach column is checked to, metres. */
const ZONE_TOP = 25;
/**
 * Metres of clear air the corridor between checkpoints must hold.
 *
 * A much softer number than the checkpoints', because this line is a SUGGESTION
 * and nothing is drawn on it. It protects an aircraft 0.6 m across at its
 * widest, flying a line it is free to leave at any moment, so 3 m is a wide
 * berth rather than a squeeze. Lowered with the route's height for the same
 * reason `CP_MIN` was.
 */
const CORRIDOR_MIN = 3;

const verbose = process.argv.includes('--verbose');

// ---- Colliders --------------------------------------------------------------

const BOX =
  /\{ pos: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\], args: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\] \}/;

function loadBoxes() {
  const src = fs.readFileSync(COLLIDERS, 'utf8');
  const wanted = new Set(['BUILDING_BOXES', 'PROP_BOXES']);
  const boxes = [];
  let section = null;
  for (const line of src.split('\n')) {
    const head = line.match(/^const ([A-Z_]+)\s*:/);
    if (head) {
      section = head[1];
      continue;
    }
    const m = BOX.exec(line);
    // Sidewalk plates are the ground you land on, not something you hit.
    if (m && section && wanted.has(section)) {
      boxes.push({ p: [+m[1], +m[2], +m[3]], h: [+m[4], +m[5], +m[6]] });
    }
  }
  if (boxes.length < 100)
    throw new Error(`only ${boxes.length} colliders parsed — has the generated format changed?`);
  return boxes;
}

const boxes = loadBoxes();

/** Distance from a point to the nearest collider surface, 0 when inside one. */
function clearance(x, y, z) {
  let min = Infinity;
  for (const b of boxes) {
    if (Math.abs(x - b.p[0]) - b.h[0] > min) continue;
    if (Math.abs(z - b.p[2]) - b.h[2] > min) continue;
    const dx = Math.max(Math.abs(x - b.p[0]) - b.h[0], 0);
    const dy = Math.max(Math.abs(y - b.p[1]) - b.h[1], 0);
    const dz = Math.max(Math.abs(z - b.p[2]) - b.h[2], 0);
    const d = Math.hypot(dx, dy, dz);
    if (d < min) min = d;
    if (min === 0) return 0;
  }
  return min;
}

/** The tightest point in the column over a ground mark, and the height of it. */
function column(x, z, top = ZONE_TOP) {
  let worst = Infinity;
  let at = 0;
  for (let y = 0.6; y <= top; y += 0.5) {
    const c = clearance(x, y, z);
    if (c < worst) {
      worst = c;
      at = y;
    }
  }
  return { worst, at };
}

// ---- Mission coordinates ----------------------------------------------------

function loadMission() {
  const src = fs.readFileSync(MISSION, 'utf8');

  const alt = Number(/^const ALT = ([\d.]+);/m.exec(src)?.[1]);
  // Each checkpoint carries its OWN height — the route deliberately climbs and
  // descends rather than running flat — so y is read per point and `ALT` is
  // only the band's middle, used for the corridor between them.
  const route = [
    ...src.matchAll(/cp\('([A-Z]\d+)', (-?[\d.]+), (-?[\d.]+), (-?[\d.]+), '(\w+)'\)/g),
  ].map((m) => ({
    label: m[1],
    x: +m[2],
    y: +m[3],
    z: +m[4],
    leg: m[5],
  }));
  const zones = [
    ...src.matchAll(/kind: '(pickup|drop|base)',\s*\n\s*at: \[(-?[\d.]+), (-?[\d.]+)\]/g),
  ].map((m) => ({
    kind: m[1],
    x: +m[2],
    z: +m[3],
  }));

  if (!Number.isFinite(alt)) throw new Error('could not read ALT from the mission file');
  // A floor rather than an exact count: the route grows, and a check that has to
  // be edited every time one is added is a check people start editing without
  // reading. Too FEW means the regex has stopped matching, which is the failure
  // worth catching here.
  if (route.length < 10)
    throw new Error(`only ${route.length} route checkpoints parsed — has the cp() format changed?`);
  if (zones.length !== 3) throw new Error(`expected 3 zones, parsed ${zones.length}`);
  const homeVia = [...src.matchAll(/^\s*\[(-?[\d.]+), (-?[\d.]+)\],$/gm)].map((m) => ({
    x: +m[1],
    z: +m[2],
  }));
  if (homeVia.length < 2)
    throw new Error(`parsed ${homeVia.length} homeVia waypoints — has HOME_VIA changed shape?`);
  return { alt, route, zones, homeVia };
}

const { alt, route, zones, homeVia } = loadMission();

// ---- Report -----------------------------------------------------------------

let failures = 0;

function line(name, detail, value, min) {
  const tight = value < min;
  if (tight) failures++;
  console.log(
    `${tight ? 'TIGHT' : '  ok '}  ${name.padEnd(10)} ${detail.padEnd(26)} ${value.toFixed(1).padStart(6)} m   (min ${min})`,
  );
}

console.log(`\nPrecision Delivery — route clearance in New York City`);
console.log(`${boxes.length} building and prop colliders, route flown around ${alt} m\n`);

console.log('ZONES — clear column from the deck to 25 m');
const byKind = Object.fromEntries(zones.map((z) => [z.kind, z]));
for (const kind of ['pickup', 'drop', 'base']) {
  const z = byKind[kind];
  const { worst, at } = column(z.x, z.z);
  line(kind, `[${z.x}, ${z.z}] tightest at ${at} m`, worst, ZONE_MIN);
}

console.log('\nROUTE CHECKPOINTS');
for (const c of route) {
  line(c.label, `[${c.x}, ${c.y}, ${c.z}] ${c.leg}`, clearance(c.x, c.y, c.z), CP_MIN);
}

console.log('\nCORRIDOR — the suggested line between them, sampled every half metre');
const legs = [
  ['base to pickup', [byKind.base, ...route.filter((c) => c.leg === 'toPickup'), byKind.pickup]],
  ['pickup to drop', [byKind.pickup, ...route.filter((c) => c.leg === 'toDrop'), byKind.drop]],
  // The way home carries no checkpoints — every ring is on the way out, so the
  // release can gate on all of them. `homeVia` is the line a sensible pilot
  // takes instead, and it is what gets measured.
  ['drop to base', [byKind.drop, ...homeVia, byKind.base]],
];
for (const [name, pts] of legs) {
  let worst = Infinity;
  let where = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.ceil(span * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const c = clearance(x, alt, z);
      if (verbose) console.log(`        ${x.toFixed(1)}, ${z.toFixed(1)} -> ${c.toFixed(1)}`);
      if (c < worst) {
        worst = c;
        where = [x, z];
      }
    }
  }
  line(
    name.split(' ')[0],
    `${name}, worst at [${where[0].toFixed(0)}, ${where[1].toFixed(0)}]`,
    worst,
    CORRIDOR_MIN,
  );
}

console.log(
  failures === 0
    ? '\nAll clear.\n'
    : `\n${failures} position(s) below the minimum. Move them, or lower the minimum on purpose.\n`,
);
process.exit(failures === 0 ? 0 : 1);

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
const STOREFRONTS = 'src/renderer/missions/pickupStorefront.ts';
const ENVIRONMENT = 'src/renderer/plugins/environments/newYork.ts';

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
/**
 * The same, for a zone on a storefront's pickup deck: the 1 m ring plus the
 * 1.7 m a rotor can reach from a drone inside it. The deck is a small placed
 * hover, not an open street mark, and `pickupStorefront.ts` measured Lake City
 * Pharmacy's street lamp against exactly this.
 */
const DECK_MIN = 2.7;
/**
 * The same, for the base on the launch helipad: the 1.2 m landing ring must not
 * be drawn into anything. The pad was swept as a spawn (see `newYork.ts`) with a
 * tower face 1.56 m behind it, so this is a floor, not a comfortable berth.
 */
const PAD_MIN = 1.2;
/**
 * Metres around the helipad the corridor does not sample.
 *
 * Over the pad the aircraft climbs out and comes down vertically; it is never at
 * cruise height beside the tower, and that column is `PAD_MIN`'s to judge. The
 * cruise corridor clears 3 m about 2 m out from the H's centre.
 */
const PAD_CLIMB = 2.5;
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
  const obstacles = new Set(['BUILDING_BOXES', 'PROP_BOXES']);
  const boxes = [];
  const surfaces = [];
  let section = null;
  for (const line of src.split('\n')) {
    const head = line.match(/^const ([A-Z_]+)\s*:/);
    if (head) {
      section = head[1];
      continue;
    }
    const m = BOX.exec(line);
    if (!m || !section) continue;
    const box = { p: [+m[1], +m[2], +m[3]], h: [+m[4], +m[5], +m[6]] };
    // Sidewalk plates are the ground you land ON, not something you hit — so
    // they are out of the clearance list and in the surface list.
    surfaces.push(box);
    if (obstacles.has(section)) boxes.push(box);
  }
  if (boxes.length < 100)
    throw new Error(`only ${boxes.length} colliders parsed — has the generated format changed?`);
  return { boxes, surfaces };
}

const { boxes, surfaces } = loadBoxes();

/**
 * The height of the solid surface under a point.
 *
 * Here because this mission declares no `groundY` on any of its zones, which
 * means it is asserting that all three stand on the map's own ground at y = 0.
 * That is true today and nothing was checking it. Multi-Point Delivery put a
 * bay on a sidewalk plate 0.12 m up while declaring 0, and delivered its first
 * package buried to the waist in the pavement with the height band 12 cm low —
 * a mistake invisible in the diff and invisible to a clearance check, because a
 * kerb is not an obstacle. If a zone here is ever moved onto one, this says so.
 */
function surfaceUnder(x, z) {
  let top = 0;
  for (const b of surfaces) {
    if (Math.abs(x - b.p[0]) <= b.h[0] && Math.abs(z - b.p[2]) <= b.h[2]) {
      top = Math.max(top, b.p[1] + b.h[1]);
    }
  }
  return top;
}

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

/** Lake City Pharmacy's deck centre, world x, z — `deckAtOf(LAKE_CITY_PHARMACY)`. */
function pharmacyDeck() {
  const src = fs.readFileSync(STOREFRONTS, 'utf8');
  const out = Number(/PICKUP_DECK_OUT = ([\d.]+);/.exec(src)?.[1]);
  const m =
    /LAKE_CITY_PHARMACY: StorefrontSite = \{ wall: \[(-?[\d.]+), (-?[\d.]+)\], out: \[(-?[\d.]+), (-?[\d.]+)\] \}/.exec(
      src,
    );
  if (!m || !Number.isFinite(out))
    throw new Error('could not read LAKE_CITY_PHARMACY from pickupStorefront.ts');
  return [+m[1] + +m[3] * out, +m[2] + +m[4] * out];
}

/** The launch helipad's centre, world x, z — `NEW_YORK_HELIPAD_AT`, which is
 *  the environment's spawn. */
function helipad() {
  const src = fs.readFileSync(ENVIRONMENT, 'utf8');
  const m = /spawn: \{ position: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\]/.exec(src);
  if (!m) throw new Error('could not read the spawn from newYork.ts');
  return [+m[1], +m[3]];
}

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
  // A zone is a literal `[x, z]`, Lake City Pharmacy's deck, or the launch
  // helipad — the last two resolved from their own files so nothing can drift.
  const zones = [
    ...src.matchAll(
      /kind: '(pickup|drop|base)',\s*\n\s*at: (?:\[(-?[\d.]+), (-?[\d.]+)\]|(PHARMACY_DECK_AT)|(NEW_YORK_HELIPAD_AT))/g,
    ),
  ].map((m) => {
    const [x, z] = m[4] ? pharmacyDeck() : m[5] ? helipad() : [+m[2], +m[3]];
    // A zone that names its own `groundY` stands on a deck or a sidewalk plate,
    // not on the map's ground, so the surface check below does not apply.
    const block = src.slice(m.index, src.indexOf('}', m.index));
    return { kind: m[1], x, z, ownGround: /groundY:/.test(block), pad: Boolean(m[5]) };
  });

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
  const min = z.pad ? PAD_MIN : z.ownGround ? DECK_MIN : ZONE_MIN;
  line(kind, `[${z.x}, ${z.z}] tightest at ${at} m`, worst, min);
  // A zone without its own `groundY` is claiming to stand on the map's flat
  // ground. Checked rather than assumed — see `surfaceUnder`.
  const deck = surfaceUnder(z.x, z.z);
  if (deck !== 0 && !z.ownGround) {
    failures++;
    console.log(
      `TIGHT  ${kind.padEnd(10)} stands on a surface at ${deck.toFixed(2)} m, but declares no groundY`,
    );
  }
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
      if ([a, b].some((p) => p.pad && Math.hypot(x - p.x, z - p.z) < PAD_CLIMB)) continue;
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

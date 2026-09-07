// Checks that every Multi-Point Delivery mark and every leg between them has
// real room around it in New York City.
//
// Why this exists, and why it is not `check-mission-route.mjs`: that script
// measures ONE crossing at ONE height against a route of rings. This mission has
// no rings and three destinations, two of which are on ROOFS — so the question
// is a different one. A rooftop mark is not judged on the clear column above the
// street beneath it; it is judged on the deck it actually stands on, on the air
// above THAT deck, and on whether anything nearby rises past it.
//
// It also answers the question that decided this mission's shape: which roofs on
// this map can the Guru reach at all. `--roofs` prints every flat, reachable
// roof patch in the city.
//
// Usage:
//   node scripts/check-multi-delivery-route.mjs           # report, exit 1 if tight
//   node scripts/check-multi-delivery-route.mjs --roofs    # every reachable roof
//   node scripts/check-multi-delivery-route.mjs --verbose  # print each sample
//
// Reads:  src/renderer/scene/environment/NewYorkColliders.tsx
//         src/renderer/missions/multiPointDelivery.ts

import fs from 'node:fs';
import process from 'node:process';

const COLLIDERS = 'src/renderer/scene/environment/NewYorkColliders.tsx';
const MISSION = 'src/renderer/missions/multiPointDelivery.ts';

/** Metres of clear air a ground mark needs in the column above it. Same number
 *  `check-mission-route` uses: it protects an aircraft 0.6 m across coming
 *  straight down onto a mark it has to stop over. */
const ZONE_MIN = 3.5;
/** How high a street mark's approach column is checked to, metres. */
const ZONE_TOP = 25;
/**
 * Metres of clear air a ROOFTOP mark needs beside it, measured only against
 * things that rise above the roof.
 *
 * Lower than a street mark's, and it has to be. The whole reason this mission
 * has rooftop deliveries at all is that the city has exactly three roofs the
 * aircraft can climb to, and the best of them has 10 m while the tightest has
 * 4.6. Asking for more would mean asking for roofs that do not exist.
 */
const ROOF_MIN = 3.5;
/** Metres of clear air the corridor between marks must hold. A SUGGESTION, not
 *  a drawn line: nothing is scored on it and the pilot is free to leave it, so
 *  this is a wide berth for a 0.6 m aircraft rather than a squeeze. */
const CORRIDOR_MIN = 3;
/** How far out from a rooftop mark the horizontal corridor stops being measured,
 *  metres — see `overARoof`. Comfortably wider than either roof's own slab. */
const ROOF_SKIP = 10;
/**
 * The aircraft's own ceiling, metres — the Guru's `maxAltitude`, which every
 * mission is flown on.
 *
 * Checked rather than assumed. A rooftop mark whose height band reached past
 * this would be a delivery the mission's own aircraft cannot climb to, and it
 * would fail silently: the pilot would hold a perfect hover a metre under the
 * band with the release refusing and nothing on screen able to say why.
 */
const CEILING = 30;
/** The controller fades the climb rate to zero over the last two metres of the
 *  ceiling, so anything a pilot has to REACH should sit below this. */
const CEILING_FADE = CEILING - 2;
/**
 * New York's spawn point, from `plugins/environments/newYork.ts`. The mission
 * cannot move it — it belongs to the environment — so it is a fixed fact the
 * mission's own marks have to be placed around.
 */
const SPAWN = { x: 0, z: 26 };
/**
 * How far the hub must sit from that spawn, metres.
 *
 * The hub was three metres from it to begin with, and the mission opened with
 * the pilot armed in the middle of three parcels, standing on the mark, with the
 * radar's P under their own aircraft — the first objective already met and
 * nothing to fly to. A depot is somewhere you GO. This is the check that keeps
 * it that way if the pad is ever moved again.
 */
const SPAWN_MIN = 12;

const verbose = process.argv.includes('--verbose');

// ---- Colliders --------------------------------------------------------------

const BOX =
  /\{ pos: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\], args: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\] \}/;

/**
 * Two lists out of one file, because the two questions are different.
 *
 * `boxes` is what you can HIT: buildings and props. Sidewalk plates are not in
 * it — they are the ground, and a mark measured against them would report zero
 * clearance for standing on the pavement.
 *
 * `surfaces` is what you can STAND ON: all three sections. A mark's declared
 * deck is checked against this one. Getting these the same way round is the
 * whole of the sidewalk bug — see `deck`.
 */
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
    surfaces.push(box);
    if (obstacles.has(section)) boxes.push(box);
  }
  if (boxes.length < 100)
    throw new Error(`only ${boxes.length} colliders parsed — has the generated format changed?`);
  if (surfaces.length <= boxes.length)
    throw new Error('no sidewalk plates parsed — has the generated format changed?');
  return { boxes, surfaces };
}

const { boxes, surfaces } = loadBoxes();

/** Distance from a point to the nearest collider surface, 0 when inside one. */
function clearance(x, y, z, skip) {
  let min = Infinity;
  for (const b of boxes) {
    if (skip && skip(b)) continue;
    const dx = Math.max(Math.abs(x - b.p[0]) - b.h[0], 0);
    const dy = Math.max(Math.abs(y - b.p[1]) - b.h[1], 0);
    const dz = Math.max(Math.abs(z - b.p[2]) - b.h[2], 0);
    const d = Math.hypot(dx, dy, dz);
    if (d < min) min = d;
    if (min === 0) return 0;
  }
  return min;
}

/**
 * Clearance that ignores the deck you are standing on.
 *
 * Over a roof, the plain distance to the nearest surface is the distance to the
 * roof itself, which is always tiny and always uninteresting. What matters up
 * there is what STICKS UP past you — a parapet, a plant room, the tower next
 * door — so only boxes whose top is above the sample height are counted.
 */
function above(x, y, z) {
  return clearance(x, y, z, (b) => b.p[1] + b.h[1] <= y + 0.05);
}

/**
 * The height of the solid surface under a point: a roof, a kerb, or the road.
 *
 * Measured against EVERY collider section, sidewalk plates included — which is
 * the opposite of what `clearance` wants, and the distinction cost a bug. A
 * sidewalk plate is not an obstacle, so it is rightly absent from the clearance
 * boxes; but it IS the ground, and this function's whole job is to answer what a
 * mark is standing on. Skipping them here made the deck check report `measured
 * 0.00 m` for a bay that actually sits on a plate 0.12 m up, so the one test
 * that existed to catch a wrong `groundY` passed the exact case it was written
 * for — and the delivered package was buried to its waist in the pavement.
 */
function deck(x, z) {
  let top = 0;
  for (const b of surfaces) {
    if (Math.abs(x - b.p[0]) <= b.h[0] && Math.abs(z - b.p[2]) <= b.h[2]) {
      top = Math.max(top, b.p[1] + b.h[1]);
    }
  }
  return top;
}

/** The tightest point in a column, and the height it happens at. */
function column(x, z, from, to, fn = clearance) {
  let worst = Infinity;
  let at = from;
  for (let y = from; y <= to; y += 0.5) {
    const c = fn(x, y, z);
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

  const cruise = Number(/^const CRUISE = ([\d.]+);/m.exec(src)?.[1]);
  const hub = /^const HUB: readonly \[number, number\] = \[(-?[\d.]+), (-?[\d.]+)\];/m.exec(src);
  /** The waypoint pairs inside one `via: [ ... ]` or `HOME_VIA` block. */
  const points = (block) =>
    [...block.matchAll(/\[(-?[\d.]+), (-?[\d.]+)\]/g)].map((m) => ({ x: +m[1], z: +m[2] }));

  // One entry at a time, rather than two independent sweeps for the marks and
  // the waypoints. A destination without a `via` is a straight run from the hub,
  // and matching the two separately silently shifted every other destination's
  // waypoints onto the wrong package the first time this was written.
  const list = /const DELIVERIES[^=]*= \[([\s\S]*?)\n\];/.exec(src);
  if (!list) throw new Error('could not read DELIVERIES from the mission file');
  const drops = list[1]
    .split(/\n {2}\{\n/)
    .slice(1)
    .map((entry) => {
      const m =
        /bay\('([^']+)', (-?[\d.]+), (-?[\d.]+), \{ deck: (-?[\d.]+), radius: ([\d.]+), max: ([\d.]+) \}\)/.exec(
          entry,
        );
      if (!m) throw new Error(`could not read a destination from:\n${entry}`);
      const via = /via: \[([\s\S]*?)\n\s*\],/.exec(entry);
      return {
        label: m[1],
        x: +m[2],
        z: +m[3],
        deck: +m[4],
        radius: +m[5],
        max: +m[6],
        via: via ? points(via[1]) : [],
      };
    });

  const homeBlock = /const HOME_VIA[^=]*= \[([\s\S]*?)\];/.exec(src);
  if (!homeBlock) throw new Error('could not read HOME_VIA from the mission file');
  const homeVia = points(homeBlock[1]);

  if (!Number.isFinite(cruise)) throw new Error('could not read CRUISE from the mission file');
  if (!hub) throw new Error('could not read HUB from the mission file');
  // An exact count rather than a floor: this mission IS three deliveries. If the
  // regex stops matching one of them the report would quietly check two marks
  // and pass, which is the failure this whole script exists to prevent.
  if (drops.length !== 3) throw new Error(`parsed ${drops.length} destinations, expected 3`);
  if (homeVia.length < 1)
    throw new Error(`parsed ${homeVia.length} homeVia waypoints — has HOME_VIA changed shape?`);
  return { cruise, hub: { x: +hub[1], z: +hub[2] }, drops, homeVia };
}

const { cruise, hub, drops, homeVia } = loadMission();

// ---- Report -----------------------------------------------------------------

let failures = 0;

function line(name, detail, value, min) {
  const tight = value < min;
  if (tight) failures++;
  console.log(
    `${tight ? 'TIGHT' : '  ok '}  ${name.padEnd(14)} ${detail.padEnd(38)} ${value.toFixed(1).padStart(6)} m   (min ${min})`,
  );
}

function note(ok, name, detail) {
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'TIGHT'}  ${name.padEnd(14)} ${detail}`);
}

if (process.argv.includes('--roofs')) {
  // Every flat patch of roof the Guru can reach. This is the sweep the mission's
  // two rooftop destinations were chosen out of; re-run it after regenerating
  // the colliders to see whether the answer has changed.
  console.log(`\nReachable roofs in New York City (deck between 3 m and ${CEILING_FADE} m)\n`);
  const found = [];
  for (let x = -115; x <= 115; x += 0.5) {
    for (let z = -95; z <= 95; z += 0.5) {
      const top = deck(x, z);
      if (top < 3 || top > CEILING_FADE) continue;
      let flat = true;
      for (const [dx, dz] of [
        [1.5, 0],
        [-1.5, 0],
        [0, 1.5],
        [0, -1.5],
      ]) {
        if (Math.abs(deck(x + dx, z + dz) - top) > 0.4) {
          flat = false;
          break;
        }
      }
      if (!flat) continue;
      const { worst } = column(x, z, top + 0.5, Math.min(top + 10, CEILING - 1), above);
      if (worst < ROOF_MIN) continue;
      found.push({ x, z, top, clear: worst });
    }
  }
  const best = new Map();
  for (const f of found) {
    const key = f.top.toFixed(2);
    if (!best.has(key) || best.get(key).clear < f.clear) best.set(key, f);
  }
  for (const [top, f] of best) {
    console.log(
      `  deck ${top.padStart(6)} m   best pad [${f.x}, ${f.z}]   ${f.clear.toFixed(1)} m of clear air`,
    );
  }
  console.log(`\n${best.size} distinct reachable roof(s), ${found.length} usable samples.\n`);
  process.exit(0);
}

console.log(`\nMulti-Point Delivery — clearance in New York City`);
console.log(`${boxes.length} building and prop colliders, corridor sampled at ${cruise} m\n`);

console.log('THE HUB — pickup and base share one mark');
{
  const { worst, at } = column(hub.x, hub.z, 0.6, ZONE_TOP);
  line('hub', `[${hub.x}, ${hub.z}] tightest at ${at} m`, worst, ZONE_MIN);
  // The hub declares no deck of its own, so the surface under it has to BE the
  // mission's ground height — the same trap Bay A fell into.
  note(deck(hub.x, hub.z) === 0, 'hub deck', `street level, deck reads ${deck(hub.x, hub.z)} m`);
  const fromSpawn = Math.hypot(hub.x - SPAWN.x, hub.z - SPAWN.z);
  line(
    'off the spawn',
    `${fromSpawn.toFixed(1)} m from [${SPAWN.x}, ${SPAWN.z}]`,
    fromSpawn,
    SPAWN_MIN,
  );
}

console.log('\nDESTINATIONS');
for (const d of drops) {
  const real = deck(d.x, d.z);
  // The declared deck has to BE the deck. A rooftop mark whose groundY is a
  // guess puts the height band inside the building or in the air above it, and
  // the pilot meets it as a release that never fires.
  // Tight, and tighter than the package is tall. The tolerance was 0.15 m,
  // which is wider than the 0.12 m kerb it failed to notice — a tolerance that
  // covers the mistake is not a check.
  note(
    Math.abs(real - d.deck) < 0.02,
    d.label,
    `declared deck ${d.deck} m, measured ${real.toFixed(2)} m`,
  );
  // A ROOF is anything the drone has to climb a building to reach. A kerb is
  // not one, however carefully its 12 cm are declared: it is still a street mark
  // and it still wants the full column from the deck up, which is where the
  // lamps and the sign arms are.
  if (d.deck <= 1) {
    const { worst, at } = column(d.x, d.z, real + 0.6, ZONE_TOP);
    line(d.label, `[${d.x}, ${d.z}] column, tightest at ${at} m`, worst, ZONE_MIN);
  } else {
    const { worst, at } = column(d.x, d.z, real + 0.5, Math.min(real + 10, CEILING - 1), above);
    line(d.label, `[${d.x}, ${d.z}] over the roof at ${at} m`, worst, ROOF_MIN);
    // The top of the height band is the highest the pilot ever has to hold. It
    // must sit clear of the ceiling's fade, or the last metre of the approach is
    // flown against a climb rate the controller is taking away.
    const bandTop = real + d.max;
    note(
      bandTop <= CEILING_FADE,
      d.label,
      `band tops out at ${bandTop.toFixed(2)} m, ceiling fades from ${CEILING_FADE} m`,
    );
  }
}

console.log('\nCORRIDOR — the line flown between the marks, sampled every half metre');
// One leg per crossing, out and back, plus the flight home from the last roof.
// The out-and-back legs are the same line in both directions, so each is
// measured once and named for the delivery it serves.
const legs = [];
drops.forEach((d) => legs.push([`hub <-> ${d.label}`, [hub, ...d.via, d]]));
legs.push([`home from ${drops[2].label}`, [drops[2], ...homeVia, hub]]);

/**
 * Samples directly over a rooftop destination are not measured.
 *
 * The corridor is a horizontal line at cruise height, and cruise height is
 * BELOW both roofs — so the last few metres of an approach to one of them would
 * always report zero clearance against the building the package is being
 * delivered onto. That part of the flight is a vertical climb over the pad, and
 * it is measured properly by the roof column check above.
 */
const overARoof = (x, z) =>
  drops.some((d) => d.deck > cruise && Math.hypot(x - d.x, z - d.z) <= ROOF_SKIP);

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
      if (overARoof(x, z)) continue;
      const c = clearance(x, cruise, z);
      if (verbose) console.log(`        ${x.toFixed(1)}, ${z.toFixed(1)} -> ${c.toFixed(1)}`);
      if (c < worst) {
        worst = c;
        where = [x, z];
      }
    }
  }
  line(name, `worst at [${where[0].toFixed(0)}, ${where[1].toFixed(0)}]`, worst, CORRIDOR_MIN);
}

console.log(
  failures === 0
    ? '\nAll clear.\n'
    : `\n${failures} position(s) below the minimum. Move them, or lower the minimum on purpose.\n`,
);
process.exit(failures === 0 ? 0 : 1);

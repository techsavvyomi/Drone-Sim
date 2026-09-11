// Checks that every one of Search & Rescue's candidate locations is a place a
// drone can actually hover over, and that they are far enough apart to be
// separate searches rather than one.
//
// Why this exists: this mission's difficulty comes from NOT being told where to
// go, which means a site that turns out to be unreachable is invisible in every
// other way. There is no marker to notice hanging inside a building, no route
// line to see cutting through a block — the pilot simply searches the red zone,
// finds the beacon, flies to it and cannot hold the hover, with nothing on
// screen saying why. A bad site here is a mission that fails one attempt in
// four.
//
// Method: parse the generated collider boxes and the mission's own site list,
// then measure the clear column at each site through the whole hover band, the
// separation between them, and the distance from base.
//
// Usage:
//   node scripts/check-search-sites.mjs
//   node scripts/check-search-sites.mjs --verbose
//
// Reads:  src/renderer/scene/environment/NewYorkColliders.tsx
//         src/renderer/missions/searchRescueSites.ts

import fs from 'node:fs';
import process from 'node:process';

const COLLIDERS = 'src/renderer/scene/environment/NewYorkColliders.tsx';
const SITES = 'src/renderer/missions/searchRescueSites.ts';

/** The base pad, from `searchRescue.ts`. */
const BASE = [0, 29];

/**
 * Metres of clear air a site needs all round its hover column.
 *
 * It protects the RESCUE ZONE, not the aircraft: the zone is 4.5 m across the
 * radius, and a zone whose edge is inside a facade is a hover the pilot is asked
 * to hold in a wall. Half a metre of daylight on top of that.
 */
const SITE_MIN = 5;
/** The hover band, plus the descent through it. From `searchRescue.ts`. */
const BAND_MIN = 12;
const BAND_MAX = 22;
/**
 * The rooftop band, measured from each site's deck rather than from the street,
 * and the ceiling it has to fit under.
 *
 * On this mission the ceiling is the binding constraint rather than a
 * comfortable margin — the highest deck is 67.8 m and the limit is 80 — so it is
 * checked here rather than trusted.
 */
const ROOF_BAND_MIN = 4;
const ROOF_BAND_MAX = 9;
/** The mission's own ceiling, from `searchRescue.ts` — NOT the Guru's 30 m. The
 *  whole reason four rooftop sites exist is that the mission raises it. */
const CEILING = 80;
/**
 * The column is checked from ONE metre, not from the band's floor.
 *
 * The pilot descends into the band and climbs out of it, and this city's lamps,
 * signs and traffic lights top out at 10.5 m — the whole of that is below the
 * band and would go unmeasured by a check that started at 12.
 */
const COLUMN_FLOOR = 1;

/**
 * How far apart two sites must be to be two searches, metres.
 *
 * Seventy while the sites were down streets, where it meant one hover could
 * never take in two. On a rooftop that rule is meaningless — from 45 m up the
 * pilot sees most of the city — and the thing that has to stay true instead is
 * that one red zone can never hold two sites. That is asserted directly below;
 * this is the floor that leaves it room.
 */
const MIN_SEPARATION = 50;
/** How far a site must be from the base pad. Close enough and the pilot finds it
 *  on the way up rather than by searching. */
const MIN_FROM_BASE = 45;

const verbose = process.argv.includes('--verbose');

const BOX =
  /\{ pos: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\], args: \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\] \}/;

function loadBoxes() {
  const src = fs.readFileSync(COLLIDERS, 'utf8');
  const obstacles = new Set(['BUILDING_BOXES', 'PROP_BOXES']);
  const boxes = [];
  let section = null;
  for (const line of src.split('\n')) {
    const head = line.match(/^const ([A-Z_]+)\s*:/);
    if (head) {
      section = head[1];
      continue;
    }
    const m = BOX.exec(line);
    if (!m || !section || !obstacles.has(section)) continue;
    boxes.push({ p: [+m[1], +m[2], +m[3]], h: [+m[4], +m[5], +m[6]] });
  }
  if (boxes.length < 100)
    throw new Error(`only ${boxes.length} colliders parsed — has the generated format changed?`);
  return boxes;
}

/** The sites, read out of the source rather than imported: this is a plain node
 *  script and that file is TypeScript. The shape is fixed and asserted below. */
function loadSites() {
  const src = fs.readFileSync(SITES, 'utf8');
  const sites = [];
  const re =
    /id: '([abcd])',\s*\n\s*at: \[(-?[\d.]+), (-?[\d.]+)\],\s*\n\s*roof: ([\d.]+),\s*\n\s*deck: ([\d.]+),\s*\n\s*landmarkHeight: ([\d.]+),/g;
  let m;
  while ((m = re.exec(src))) {
    sites.push({
      id: m[1],
      at: [+m[2], +m[3]],
      roof: +m[4],
      deck: +m[5],
      landmarkHeight: +m[6],
    });
  }
  // One site per compass direction. The count is asserted rather than inferred
  // so that a site silently failing to parse — a reformat, a renamed field —
  // shows up as a broken check rather than as a check that quietly measures
  // three of the four.
  if (sites.length !== 4)
    throw new Error(`parsed ${sites.length} sites, expected 4 — has the file's shape changed?`);
  return sites;
}

const top = (b) => b.p[1] + b.h[1];
const bottom = (b) => b.p[1] - b.h[1];

function flatTo(b, x, z) {
  const dx = Math.max(Math.abs(x - b.p[0]) - b.h[0], 0);
  const dz = Math.max(Math.abs(z - b.p[2]) - b.h[2], 0);
  return Math.hypot(dx, dz);
}

/** Nearest solid surface to a vertical column at (x, z) between y0 and y1. */
function column(boxes, x, z, y0, y1) {
  let best = Infinity;
  let which = null;
  for (const b of boxes) {
    if (top(b) < y0 || bottom(b) > y1) continue;
    const d = flatTo(b, x, z);
    if (d < best) {
      best = d;
      which = b;
    }
  }
  return { clear: best, box: which };
}

/** The tallest building within `r` metres — what makes a site a place. */
function tallestNear(boxes, x, z, r) {
  let best = 0;
  for (const b of boxes) {
    if (flatTo(b, x, z) <= r) best = Math.max(best, top(b));
  }
  return best;
}

const boxes = loadBoxes();
const sites = loadSites();
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};

console.log(`Search & Rescue — ${sites.length} candidate sites, ${boxes.length} colliders\n`);

for (const s of sites) {
  const [x, z] = s.at;
  const roof = s.roof > 0;
  // Everything is measured from the site's own DECK. On the roof site a column
  // started at the street would run through the building the casualty is lying
  // on and report no clear air at all.
  // Bands from the VISIBLE roof — where the mark is drawn — and the column from
  // the collider deck, which is the parapet and the lowest the aircraft can be.
  const bandLo = s.roof + (roof ? ROOF_BAND_MIN : BAND_MIN);
  const bandHi = s.roof + (roof ? ROOF_BAND_MAX : BAND_MAX);
  const floor = roof ? s.deck + 0.5 : COLUMN_FLOOR;
  const hover = column(boxes, x, z, bandLo, bandHi);
  const whole = column(boxes, x, z, floor, bandHi);
  const fromBase = Math.hypot(x - BASE[0], z - BASE[1]);
  const tall = tallestNear(boxes, x, z, 30);

  console.log(
    `site ${s.id.toUpperCase()}  [${x}, ${z}]  ${roof ? `roof ${s.roof} m, parapet ${s.deck} m` : 'street'}`,
  );
  console.log(
    `  hover band ${bandLo.toFixed(1)}-${bandHi.toFixed(1)} m : ${hover.clear.toFixed(2)} m clear`,
  );
  console.log(
    `  full column ${floor.toFixed(1)}-${bandHi.toFixed(1)} m: ${whole.clear.toFixed(2)} m clear`,
  );
  console.log(`  from base            : ${fromBase.toFixed(1)} m`);
  console.log(`  tallest within 30 m  : ${tall.toFixed(1)} m (placed against ${s.landmarkHeight})`);
  if (verbose && whole.box) console.log(`  nearest solid        : ${JSON.stringify(whole.box)}`);

  if (whole.clear < SITE_MIN)
    fail(`site ${s.id}: ${whole.clear.toFixed(2)} m of clear column, needs ${SITE_MIN}`);
  if (fromBase < MIN_FROM_BASE)
    fail(`site ${s.id}: ${fromBase.toFixed(1)} m from base, needs ${MIN_FROM_BASE}`);
  // The rooftop's whole reason for having its own band: the top of it has to
  // stay under the aircraft's limiter, or the hover cannot be flown at all.
  if (bandHi >= CEILING)
    fail(`site ${s.id}: hover band reaches ${bandHi.toFixed(1)} m, the ceiling is ${CEILING}`);
  // The mark is drawn on the roof the pilot sees, which sits under the collider
  // parapet. That is only honest while the hover it asks for starts ABOVE the
  // parapet — otherwise the bottom of the band is inside the building.
  if (roof && bandLo <= s.deck)
    fail(
      `site ${s.id}: hover band starts at ${bandLo.toFixed(2)} m, under the ${s.deck} m parapet`,
    );
  if (roof && s.deck < s.roof)
    fail(`site ${s.id}: collider deck ${s.deck} is below the visible roof ${s.roof}`);
  // Nothing quotes this number on screen any more, but it is what makes a site
  // a PLACE — somewhere a pilot flying the red zone recognises as worth a second
  // look — rather than a coordinate on an empty street. A collider regeneration
  // that flattens the tower must not be allowed to leave the site standing
  // beside nothing.
  if (Math.abs(tall - s.landmarkHeight) > 2)
    fail(
      `site ${s.id}: tallest building within 30 m is now ${tall.toFixed(1)} m, the site was placed against ${s.landmarkHeight}`,
    );
  console.log('');
}

console.log('separations');
for (let i = 0; i < sites.length; i++) {
  for (let j = i + 1; j < sites.length; j++) {
    const d = Math.hypot(sites[i].at[0] - sites[j].at[0], sites[i].at[1] - sites[j].at[1]);
    console.log(`  ${sites[i].id.toUpperCase()}-${sites[j].id.toUpperCase()}: ${d.toFixed(1)} m`);
    if (d < MIN_SEPARATION)
      fail(
        `sites ${sites[i].id} and ${sites[j].id} are ${d.toFixed(1)} m apart, needs ${MIN_SEPARATION}`,
      );
  }
}

// The red zone: it has to CONTAIN the site it is drawn for, and it has to fit on
// the map. A zone that hangs off the edge invites the pilot to search open
// nothing, and one that misses its own site is the mission's single
// unrecoverable state — a pilot who searches the circle honestly and completely
// finds no one. `searchZone.ts` guarantees both; this asserts the numbers those
// guarantees rest on are still true of the map that actually exists.
const ZONE_RADIUS = 22;
const OFFSET_FRACTION = 0.55;
const PLAN = 'src/renderer/scene/environment/NewYorkPlan.ts';
const planSrc = fs.readFileSync(PLAN, 'utf8');
const bounds = Object.fromEntries(
  ['minX', 'minZ', 'maxX', 'maxZ'].map((k) => {
    const m = planSrc.match(new RegExp(`${k}: (-?\\d+)`));
    if (!m) throw new Error(`no ${k} in ${PLAN} — regenerate it`);
    return [k, +m[1]];
  }),
);
console.log(
  `\nred zone: ${ZONE_RADIUS} m radius, centre within ${(ZONE_RADIUS * OFFSET_FRACTION).toFixed(1)} m of the site`,
);
console.log(`map bounds: ${bounds.minX}..${bounds.maxX} x ${bounds.minZ}..${bounds.maxZ}`);
// The clamp that keeps a zone on the map can only move its centre; if that move
// is ever larger than the offset, it can push the circle off its own site.
const OFFSET = ZONE_RADIUS * OFFSET_FRACTION;
// One red zone must never hold two sites. The furthest a zone can reach from its
// own site is the offset plus the radius; any other site has to be beyond that.
for (let i = 0; i < sites.length; i++)
  for (let j = 0; j < sites.length; j++) {
    if (i === j) continue;
    const d = Math.hypot(sites[i].at[0] - sites[j].at[0], sites[i].at[1] - sites[j].at[1]);
    if (d <= OFFSET + ZONE_RADIUS)
      fail(
        `site ${sites[j].id} is ${d.toFixed(1)} m from ${sites[i].id} — inside the ${(OFFSET + ZONE_RADIUS).toFixed(1)} m a zone round ${sites[i].id} can reach`,
      );
  }
const keep = ZONE_RADIUS - OFFSET;
const room = {
  x: [bounds.minX + keep, bounds.maxX - keep],
  z: [bounds.minZ + keep, bounds.maxZ - keep],
};
if (room.x[0] > room.x[1] || room.z[0] > room.z[1])
  fail(`a ${ZONE_RADIUS} m zone does not fit inside the map at all`);
// The worst the two clamps in `zoneFor` can do between them, sampled at the
// four extremes of the draw. What matters is not where the centre lands but how
// far it lands FROM THE SITE: a pilot who searches the whole circle has to find
// somebody.
for (const s of sites) {
  const [x, z] = s.at;
  const axis = (v, r) =>
    Math.max(
      Math.abs(clampTo(clampTo(v + OFFSET, r), [v - OFFSET, v + OFFSET]) - v),
      Math.abs(clampTo(clampTo(v - OFFSET, r), [v - OFFSET, v + OFFSET]) - v),
    );
  const worst = Math.hypot(axis(x, room.x), axis(z, room.z));
  console.log(`  site ${s.id.toUpperCase()}: worst-case centre offset ${worst.toFixed(1)} m`);
  if (worst >= ZONE_RADIUS)
    fail(`site ${s.id} can fall outside its own red zone (offset ${worst.toFixed(1)} m)`);
}

function clampTo(v, [lo, hi]) {
  return Math.min(Math.max(v, lo), hi);
}

console.log(
  failures === 0
    ? `\nOK — all ${sites.length} sites are flyable and distinct`
    : `\n${failures} problem(s)`,
);
process.exit(failures === 0 ? 0 : 1);

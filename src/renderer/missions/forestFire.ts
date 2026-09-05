import type { Mission, MissionCheckpoint } from './types';

// ----------------------------------------------------------------------------
// Forest Fire Emergency — the forest map.
//
// Collect a suppression tank from the emergency station on the road, cross the
// woods, hold a hover over the fire until it is out, then come home and land.
// Seven points: five optional rings on the way, plus the fire and the landing.
//
// WHY THE RINGS ARE OPTIONAL HERE, when Precision Delivery's are compulsory.
//
// The city is a grid of streets and a route through it is a route a delivery
// pilot would fly anyway, so gating the drop on it costs nothing. A forest has
// no streets. The brief for this mission is explicit that the pilot chooses
// their own way through the trees, and a required ring is a corridor whatever
// you call it: it would turn "fly through a forest" into "fly this line". So
// these five score, they light the way, and skipping every one of them still
// leaves the tank ready over the fire.
//
// EVERY COORDINATE HERE WAS MEASURED, NOT CHOSEN.
//
// This map is worse than the city for guessing at. It has no flat ground — the
// clearing is at zero and the terrain falls 62 m away from it — and its trunk
// colliders are extended to the top of each canopy, so a tree is solid to its
// own treetop and the airspace between two of them is genuinely narrow. Every
// number below came out of:
//
//     node scripts/check-forest-route.mjs
//
// which reports the ground height under each mark, the nearest trunk to every
// ring, and the clear column above every zone. Re-run it after ANY change here
// or after regenerating the forest colliders.
// ----------------------------------------------------------------------------

/**
 * The height the guidance rings hang at, in metres above the LOCAL forest floor.
 *
 * Above the floor rather than above the clearing, because the ground falls 12 m
 * between the road and the fire and a single world height would put the first
 * ring at head height and the last one underground. Every ring's `y` below is
 * its own number, and they are all within a metre of this.
 *
 * THIS ROUTE GOES THROUGH THE TREES, NOT OVER THEM, and that was not a choice.
 * The obvious design is an over-canopy line: the tallest trunk collider on this
 * crossing tops out at 34.2 m, so 40 m would be clear air the whole way. The
 * Guru cannot get there. Its `maxAltitude` is 30 m, enforced as a soft ceiling
 * in the flight controller, and a mission is flown on the Guru — so a route
 * above the canopy is a route the mission's own aircraft cannot fly. Anything
 * above 30 m in this file is a mistake, whatever the collider check says about
 * it.
 *
 * So the crossing is what a forest crossing should be: a weave between trunks.
 * The rings mark the widest line through them, found by searching the collider
 * field for the path with the largest bottleneck rather than drawn by eye — the
 * straight line from the road to the fire has 0.4 m of clearance in places and
 * is not flyable at all.
 */
const ALT = 8;

/** Ring reach and drawn radius, the same pair Precision Delivery uses: what you
 *  can see is what you have to fly into. */
const REACH = 3.5;
const BALL = 3;

/** The clearing's own ground height. The forest map has no `groundY` in its
 *  spec at all — deliberately, it has no single ground height — so this is the
 *  height of the road the drone spawns and lands on, and the fire carries its
 *  own. */
const CLEARING_Y = 0;

/**
 * The floor of the hollow the fire burns in, in metres.
 *
 * Twelve and a half metres BELOW the clearing. This is the number that makes a
 * per-zone ground height necessary at all: a hover band measured from the
 * clearing would put the drone thirteen metres over the flames, outside the
 * band, with the HUD insisting it was too low.
 */
const FIRE_Y = -12.5;

function ring(label: string, x: number, y: number, z: number): MissionCheckpoint {
  return {
    id: `ff-${label.toLowerCase()}`,
    label,
    at: [x, y, z],
    reach: REACH,
    radius: BALL,
    leg: 'toDrop',
    // Guidance and score, never a gate. See the header.
    required: false,
  };
}

/**
 * The line over the canopy, from the clearing out to the fire.
 *
 * It runs EAST along the old trail and then SOUTH, which is a dog-leg rather
 * than the straight line the map suggests. The straight line does not exist:
 * it passes through trunks. This is the widest corridor the collider field has,
 * and its bottleneck is 4.19 m — comfortable for a 0.6 m airframe, tight enough
 * that it is still flying.
 *
 * Every ring sits 8 to 9 m above the ground under it, which is over the fallen
 * logs and the undergrowth and well under the canopy. The route descends with
 * the terrain: F1 is at world height 8 and F5 at -2, because the forest floor
 * drops away that far on the way to the fire.
 *
 * The bend between F2 and F3 is where the corridor turns, and it is the reason
 * there are five of these rather than three: with a ring at each end of the
 * turn and nothing in it, the suggested line cuts the corner and the check
 * reports 1.6 m.
 */
const ROUTE = [
  ring('F1', 33, 8, -7),
  ring('F2', 54, 7, -8),
  ring('F3', 79, 4, -16),
  ring('F4', 84, 1, -30),
  ring('F5', 78, -2, -46),
];

/** The way home, as bare waypoints — the same idea as the city's: they score
 *  nothing and draw nothing, and exist so the route check measures a line a
 *  sensible pilot would actually fly rather than a straight line through the
 *  trunks. */
const HOME_VIA: readonly (readonly [number, number])[] = [
  [78, -46],
  [84, -30],
  [79, -16],
  [54, -8],
];

/** The point thresholds, named once so the card and the scoring cannot drift. */
const GOLD = 7;
const SILVER = 6;

export const forestFire: Mission = {
  id: 'forest-fire',
  order: 2,
  name: 'Forest Fire Emergency',
  subtitle: 'Fly a suppression tank out to a fire in the woods',
  kind: 'suppression',
  envId: 'forest',
  blurb:
    'Collect the suppression tank, cross the forest, hold a hover over the fire until it is out, then come home and land.',
  story:
    'A fire has taken hold deep in the forest, in a hollow the ground crews cannot reach. A suppression tank has been prepared at the emergency station on the road. Your job is to fly it out, put the fire down, and come back.',
  flow: [
    { label: 'Collect', note: 'Descend onto the tank on the road', art: 'collect' },
    { label: 'Cross', note: 'Weave out through the trees', art: 'forest' },
    { label: 'Suppress', note: 'Hold your position over the fire', art: 'suppress' },
    { label: 'Come home', note: 'Land back at the station', art: 'land' },
  ],
  objectives: [
    'Collect the suppression tank at the emergency station.',
    'Cross the forest and find the fire.',
    'Hold your position over the fire until it is out.',
    'Return to the emergency base and land safely.',
  ],
  mapNote: 'Dense forest, uneven ground',
  // Longer than the city's, and it needs to be: this crossing includes a climb
  // to forty metres and a descent into a hollow, on a stick softened to 55%.
  timeLimitSec: 420,
  parTimeSec: 270,
  groundY: CLEARING_Y,
  medals: { bronze: 6, silver: SILVER, gold: GOLD },
  routeAltitude: ALT,
  route: ROUTE,
  homeVia: HOME_VIA,

  // 150 m from the base, which is fifty clear metres past the fire — the
  // furthest thing on the route, at 100.4 m. A pilot flying any line at all
  // through the trees stays well inside it; a pilot who has lost their bearings
  // entirely is told so instead of timing out in silence.
  strayRadius: 150,

  // Trunks everywhere and not one building: a column that ignores depth cannot
  // put a light in front of something the pilot would have to fly round.
  seeThroughMarks: true,

  fire: {
    // Ten seconds, which is what the brief asks for and what makes this a
    // mission about holding a hover rather than about touching a marker.
    suppressSec: 10,
    // Nine metres. Wider than the hover zone by a good margin: an aircraft
    // nudged off the mark by a gust is repositioning, and being thrown back onto
    // the navigation leg for it would be the mission punishing a correction.
    breakRadius: 9,
    // The burning ground. The hover zone sits inside it, so a pilot who is over
    // the fire at all is already most of the way to being over the mark.
    burnRadius: 6,
  },

  zones: {
    // On the bare dirt road, 11.7 m up from the spawn point and dead flat: the
    // ground varies by 3 cm across the whole mark and there is 11.75 m of clear
    // column above it.
    //
    // It used to sit at (20, -8), 21.5 m out and 68 degrees off the spawn
    // heading, which put the first thing the pilot is asked to find OUTSIDE the
    // view they start in. They had to turn to look for it, and behind a trunk
    // from a lot of the headings in between there was nothing to see at all. A
    // mark this close is in the picture the moment the mission opens, and the
    // leg is still a flight rather than a hop: the tank is 11.7 m away and 0.9 m
    // off the deck.
    pickup: {
      kind: 'pickup',
      at: [11, -4],
      label: 'Emergency station',
      // The city's numbers, unchanged. Directly over the tank and down onto it,
      // not merely somewhere in the neighbourhood.
      radius: 0.6,
      band: { min: 0, max: 0.9 },
      maxGroundSpeed: 1.1,
      maxVerticalSpeed: 1,
      hold: 0.8,
    },
    // The fire. 95 m out, in a hollow 12.5 m below the clearing, with 10.5 m of
    // clear air around the column above it.
    drop: {
      kind: 'drop',
      at: [76, -56],
      label: 'Fire zone',
      // Much wider than a delivery's mark, and it has to be: this is a
      // ten second hover rather than a one second one, held over an object six
      // metres across, and a 1.8 m circle would make it a test of trim rather
      // than of flying.
      radius: 3.5,
      // Well ABOVE the flames. The band is 5 to 11 m over the floor of the
      // hollow: high enough that the drone is over the fire rather than in it,
      // low enough that the spray reaches, and 6 m deep so holding it is a
      // hover rather than a tightrope.
      band: { min: 5, max: 11 },
      maxGroundSpeed: 1.2,
      maxVerticalSpeed: 1,
      // Unused on a suppression mission: what the hold is measured against is
      // `fire.suppressSec`, which is ten times longer and survives an
      // interruption. Left at zero rather than duplicated, so there is only ever
      // one number saying how long the hover is.
      hold: 0,
      groundY: FIRE_Y,
    },
    // The emergency station's pad, 6 m up the road from the spawn point — as
    // close to "where you started" as the road allows, on ground that is flat to
    // 8 cm with 15.7 m of clearance in the column.
    base: {
      kind: 'base',
      at: [-6, 2],
      label: 'Emergency base',
      radius: 2.5,
      band: { min: 0, max: 3 },
      // Landing is judged by ground contact and stillness in the Director, so
      // these only gate the "LANDING ZONE REACHED" call.
      maxGroundSpeed: 12,
      maxVerticalSpeed: 12,
      hold: 0,
    },
  },

  radio: {
    start: {
      id: 'start',
      text: 'Pilot, we have an emergency. A fire is burning deep in the forest. The suppression tank is on the road ahead of you: get over it, come down and hold steady.',
    },
    pickup: {
      id: 'pickup',
      text: 'Tank secured. The fire is marked. Head east along the trail and watch the trunks.',
    },
    far: {
      id: 'far',
      text: 'The arrow is on the fire. Take whatever line you like through the woods.',
    },
    near: { id: 'near', text: 'You are getting close. Start looking for the smoke column.' },
    approach: {
      id: 'approach',
      text: 'The fire is below you. Come down into the marked band and hold it there.',
    },
    spraying: { id: 'spraying', text: 'Suppression system active. Hold your position.' },
    half: { id: 'half', text: 'Fire intensity is dropping. Keep the drone steady.' },
    delivered: { id: 'delivered', text: 'Fire contained. The affected area is under control.' },
    home: { id: 'home', text: 'Good work, pilot. Return to the emergency base.' },
    landing: { id: 'landing', text: 'Base reached. Land the drone safely.' },
    complete: {
      id: 'complete',
      text: 'Mission complete. The forest fire has been successfully contained.',
    },
  },

  ranks: [
    {
      stars: 3,
      text: 'All 7 points, no crashes, home inside 4:30',
      test: (r) =>
        r.delivered && r.landed && r.points >= GOLD && r.collisions === 0 && r.timeSec <= 270,
    },
    {
      stars: 2,
      text: 'Fire out and home, one crash at most',
      test: (r) => r.delivered && r.landed && r.points >= SILVER && r.collisions <= 1,
    },
    {
      stars: 1,
      text: 'Put the fire out and land back at base',
      test: (r) => r.delivered && r.landed,
    },
  ],
};

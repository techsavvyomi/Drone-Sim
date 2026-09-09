import type { Mission, MissionCheckpoint } from './types';

// ----------------------------------------------------------------------------
// Forest Fire Emergency — the forest map.
//
// Collect a suppression tank from the emergency station on the road, cross the
// woods, and hold a hover over the fire until it is out. Six points: five
// optional rings on the way, plus the fire itself.
//
// THE MISSION ENDS OVER THE FIRE (`endsAtDrop`). There is no flight home and no
// landing, unlike Precision Delivery. Putting the fire out IS the job here — the
// crossing has already been flown and scored by the time the tank empties, and
// making the pilot weave ninety-five metres back through the same trunks to a
// pad proves nothing the outward leg did not already prove. It also ends the
// mission on its own climax rather than four minutes after it.
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

/**
 * The way home, as bare waypoints.
 *
 * Kept even though this mission ENDS at the fire and nobody flies these: they
 * are what `check-mission-route` walks back along, and the return corridor is
 * the outward one reversed, so deleting them would leave the route checker
 * measuring a straight line from the fire to the pad — through the trunks — and
 * reporting a bottleneck no pilot will ever be in.
 */
const HOME_VIA: readonly (readonly [number, number])[] = [
  [78, -46],
  [84, -30],
  [79, -16],
  [54, -8],
];

/** The point thresholds, named once so the card and the scoring cannot drift. */
const GOLD = 6;
const SILVER = 5;

export const forestFire: Mission = {
  id: 'forest-fire',
  order: 2,
  name: 'Forest Fire Emergency',
  subtitle: 'Fly a suppression tank out to a fire in the woods',
  kind: 'suppression',
  envId: 'forest',
  blurb:
    'Collect the suppression tank, cross the forest, and hold a hover over the fire until it is out.',
  story:
    'A fire has taken hold deep in the forest, in a hollow the ground crews cannot reach. A suppression tank has been prepared at the emergency station on the road. Your job is to fly it out and put the fire down.',
  flow: [
    { label: 'Collect', note: 'Descend onto the tank on the road', art: 'collect' },
    { label: 'Cross', note: 'Weave out through the trees', art: 'forest' },
    { label: 'Suppress', note: 'Hold your position until the fire is out', art: 'suppress' },
    { label: 'Extinguish', note: 'The fire goes out beneath you', art: 'suppress' },
  ],
  objectives: [
    'Collect the suppression tank at the emergency station.',
    'Cross the forest and find the fire.',
    'Hold your position over the fire until it is out.',
  ],
  mapNote: 'Dense forest, uneven ground',
  // Longer than the city's, and it needs to be: this crossing includes a climb
  // to forty metres and a descent into a hollow, on a stick softened to 55%.
  timeLimitSec: 420,
  parTimeSec: 270,
  groundY: CLEARING_Y,
  medals: { bronze: 4, silver: SILVER, gold: GOLD },
  routeAltitude: ALT,
  route: ROUTE,
  homeVia: HOME_VIA,

  // The run is scored the moment the fire is out. See the header.
  endsAtDrop: true,

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
    // Twelve metres. Wider than the hover zone by a good margin: an aircraft
    // nudged off the mark by a gust is repositioning, and being thrown back onto
    // the navigation leg for it would be the mission punishing a correction.
    breakRadius: 12,
    // The burning ground. The hover zone sits inside it, so a pilot who is over
    // the fire at all is already over the mark.
    burnRadius: 8,
    // Three metres over the floor of the hollow, which is two metres BELOW the
    // band the hover is judged in. That gap is the warning: a pilot who sinks
    // out of the band has already lost the hold and watched IN BAND go out
    // before anything is taken off them. Under it the drone is in the flames
    // rather than over them, and the tank goes.
    loseLoadAgl: 3,
  },

  zones: {
    // On the bare dirt road, 11.7 m up from the spawn point and dead flat: the
    // ground varies by 3 cm across the whole mark and there is 11.75 m of clear
    // column above it.
    pickup: {
      kind: 'pickup',
      at: [11, -4],
      label: 'Emergency station',
      radius: 1.8,
      band: { min: 0, max: 2.2 },
      maxGroundSpeed: 1.8,
      maxVerticalSpeed: 1.5,
      hold: 0.35,
    },
    // The fire. 95 m out, in a hollow 12.5 m below the clearing, with 10.5 m of
    // clear air around the column above it.
    drop: {
      kind: 'drop',
      at: [76, -56],
      label: 'Fire zone',
      // Generous radius covering the fire area, so finding the fire is not the
      // hard part — HOLDING over it is. Being inside this circle is necessary
      // and nowhere near sufficient: see the speed limits below.
      radius: 6.5,
      // Broad vertical band 5 to 16 m over the floor of the hollow (-7.5 m to
      // +3.5 m in world Y): the pilot may sit anywhere in eleven metres of it
      // rather than being forced into an extreme low descent over flame.
      band: { min: 5, max: 16 },
      // WHAT COUNTS AS HELD STILL, and why it is not the 2.2 / 1.8 it was.
      //
      // Those were set to let suppression start "as soon as the drone
      // approaches", and they do — 2.2 m/s across the ground is a brisk pass,
      // not a hover, and 1.8 m/s of vertical is a fast descent. The tank came on
      // while the aircraft was still moving, so the one thing the pilot is asked
      // to do here, HOLD A POSITION, was not actually what turned the spray on.
      //
      // These are the delivery drop's numbers, which is the right comparison: a
      // hover over a mark is a hover over a mark, and the fire's zone is already
      // far more forgiving than the delivery's on the two axes that matter to a
      // pilot arriving — a 6.5 m radius against 1.8, and an eleven metre band.
      maxGroundSpeed: 0.9,
      maxVerticalSpeed: 0.8,
      // Unused on a suppression mission: what the hold is measured against is
      // `fire.suppressSec`, which is ten times longer and survives an
      // interruption. Left at zero rather than duplicated, so there is only ever
      // one number saying how long the hover is.
      hold: 0,
      groundY: FIRE_Y,
      ringLift: 0.45,
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
      // The road undulates about half a metre along its length, and the pad is
      // approached from low and from any heading at the end of the flight. At
      // the default 3 cm the ring sank behind whatever rise was between the
      // camera and it, so the mark vanished and came back as the pilot circled.
      // 0.35 clears the lip from every direction and is still low enough to read
      // as a mark painted on the ground rather than a hoop floating over it.
      ringLift: 0.35,
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
    complete: {
      id: 'complete',
      text: 'Mission complete. The forest fire has been successfully contained. Good work, pilot.',
    },
  },

  // `r.landed` is deliberately tested on NO rung here. This mission ends over
  // the fire, so the flag is false on every attempt including a perfect one, and
  // a rung that asked for it would be a rung nothing could ever pass.
  ranks: [
    {
      stars: 3,
      text: 'All 6 points, no crashes, fire out inside 4:30',
      test: (r) => r.delivered && r.points >= GOLD && r.collisions === 0 && r.timeSec <= 270,
    },
    {
      stars: 2,
      text: 'Fire out, one crash at most',
      test: (r) => r.delivered && r.points >= SILVER && r.collisions <= 1,
    },
    {
      stars: 1,
      text: 'Put the fire out',
      test: (r) => r.delivered,
    },
  ],
};

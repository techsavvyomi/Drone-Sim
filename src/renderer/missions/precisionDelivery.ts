import { HELIPAD_LAND_RADIUS, NEW_YORK_HELIPAD_AT, NEW_YORK_HELIPAD_GROUND } from './helipad';
import { PHARMACY_DECK_AT, PICKUP_DECK_TOP } from './pickupStorefront';
import type { Mission, MissionCheckpoint, MissionLegId } from './types';

// ----------------------------------------------------------------------------
// Precision Delivery — New York City.
//
// Fly to the pickup, carry the package across the city, put it down accurately
// on the drop mark, come home and land. Sixteen points: thirteen optional route
// checkpoints, one each, plus the three zones the mission cannot skip.
//
// EVERY COORDINATE HERE WAS MEASURED, NOT CHOSEN.
//
// New York's colliders are generated from the GLB (see docs/new-york-map.md §3)
// and its street furniture closes in much faster than the art suggests — the map
// spec records a spawn that had to move 4 m up the street for exactly that
// reason. So the route was laid out against the generated boxes and every point
// checked for clearance:
//
//     node scripts/check-mission-route.mjs
//
// which reports the nearest collider to each checkpoint, each zone, and the
// corridor between them. Current worst case: 9.5 m along the route, 4.1 m in the
// landing column. Re-run it after ANY change to a number in this file or after
// regenerating the colliders. A checkpoint you cannot fly to is not a checkpoint.
// ----------------------------------------------------------------------------

/** The middle of the height band the route is flown in, in metres.
 *
 *  The route is NOT flat: each ring carries its own height, and they sit as low
 *  as the city lets them. Most of the avenue's rings bottom out at 14 m — below
 *  that the 3 m ball starts touching the facade it is hung beside, which
 *  `check-mission-route` reports as the clearance falling under 4.4 m. Four of
 *  them stand in wider spots and go down to 11.5 m, a metre clear of the tallest
 *  street furniture on the map. That difference is the route's rise and fall.
 *
 *  Every one of these was found by walking the height down half a metre at a
 *  time against the collider check rather than chosen: these ARE the floor.
 *  Lower is not a matter of taste, it is a ball inside a wall.
 *
 *  Height also costs CONTRAST, which is why nothing here reaches for the sky.
 *  The orb is additively blended — it only adds light to what is behind it — and
 *  this city is pale: white facades, open sky down every street. Low keeps the
 *  ball against the dark asphalt, the one large dark surface on the map.
 *
 *  This number is only the band's middle: the docs quote it and
 *  `check-mission-route` samples the corridor BETWEEN the rings at it. Moving
 *  any height means re-running that script. */
const ALT = 14;

/** A checkpoint's scoring radius, and the ball drawn inside it.
 *
 *  The two are nearly the same number on purpose. Reach was 5.5 against a 3 m
 *  ball, which meant a drone could pass two and a half metres OUTSIDE the light
 *  and still score it: pilots watched rings tick over that they were certain
 *  they had flown past, and then could not tell which of the remaining ones the
 *  release was waiting on. Half a metre of margin is enough to forgive the
 *  frame the trigger is sampled on, and close enough that what you can see is
 *  what you have to fly into. */
const REACH = 3.5;
const BALL = 3;

/*
 * WHERE THE CHECKPOINTS SIT ACROSS THE STREET, and why it is not the middle.
 *
 * Every one of them is pushed to ONE SIDE of its street, about 4.5 m off the
 * nearest facade — as close to a wall as a 3 m ball can safely get. That is the
 * opposite of what the placement started as, and the opposite of what "as much
 * clearance as possible" would give you.
 *
 * The orb is additively blended. It adds light to whatever is behind it and can
 * hide nothing, so it is only ever as visible as its backdrop is dark. Hung in
 * the middle of a street it is seen down that street's own vanishing point,
 * which is sky; and against a bright sky over a pale city, adding magenta to
 * something already near white leaves it near white. The pilot is looking for a
 * ball that is not there. Pushed to one side it is seen against the facades
 * running down that side, and the same ball reads as a lit sphere.
 *
 * So the rule for moving one of these is: keep it beside a building, not in the
 * open, and never give it more room than the ball needs. `check-mission-route`
 * enforces the floor (4.4 m, the ball plus daylight); the ceiling is this note.
 */

/**
 * One checkpoint, at its own height.
 *
 * The height is per point rather than one number for the route. A whole route
 * flown at a single altitude is a rail: the pilot trims once, forgets the
 * throttle and flies a flat line across the city. Mixing the heights means
 * every leg between two balls is a climb or a descent as well as a turn, which
 * is the thing a delivery pilot actually has to do. `ALT` is the middle of that
 * band and the number the HUD and the docs quote.
 */
function cp(label: string, x: number, y: number, z: number, leg: MissionLegId): MissionCheckpoint {
  return {
    id: `pd-${label.toLowerCase()}`,
    label,
    at: [x, y, z],
    reach: REACH,
    radius: BALL,
    leg,
  };
}

/** Leg 1, base to pickup: no rings.
 *
 *  The run to the package used to carry one, which put a green dot on the radar
 *  and a lit ball over the street before the pilot had anything to deliver. The
 *  first leg has exactly one job — get to the box and pick it up — and the
 *  guidance should say that and nothing else. The rings start when the cargo
 *  does. */
const LEG_1: MissionCheckpoint[] = [];

/** Leg 2, the carry: the whole length of the WEST avenue north, east along the
 *  top of the city, then the whole length of the EAST avenue south and out to
 *  the bottom corner. All thirteen rings are here, and every one of them is
 *  required before the package will release: the pilot is carrying from the
 *  first of them to the last.
 *
 *  The route USED to put three of its rings on the way home, where they could
 *  not gate anything: the package had already gone by the time the pilot
 *  reached them. That made "collect the rings, then deliver" a rule with three
 *  exceptions, and a pilot who had taken every ring they could see still had
 *  three showing as outstanding at the end. Every ring is now on the way out,
 *  and the way home is a flight rather than a collection.
 *
 *  Spacing is ~40 m where the street runs straight. It was ~22 m once, which is
 *  close enough that the next ball is already in view through the one being
 *  flown, so the route stopped being navigation and became a corridor to be
 *  threaded. Every coordinate here is collider-checked. */
const LEG_2 = [
  cp('B1', -25.5, 14, 6.2, 'toDrop'),
  cp('B2', -26.5, 11.5, -30, 'toDrop'),
  cp('B3', -27.5, 14, -63.6, 'toDrop'),
  // The north-west bend and the top street. These three sit closer together
  // than anything else on the route — about 22 m rather than 40 — and they stay
  // that way because the geometry decides it, not the pacing: the avenue turns
  // into the top street and then the top street itself bends, and a single mark
  // at either end of a bend sends the suggested line straight through the block
  // on the inside of it. `check-mission-route` fails without them.
  cp('B4', -16.9, 14, -83.6, 'toDrop'),
  cp('B5', 7.9, 14, -87.5, 'toDrop'),
  cp('B6', 28, 14, -81.5, 'toDrop'),
  cp('B7', 27.7, 11.5, -60.5, 'toDrop'),
  cp('B8', 27.5, 14, -39.3, 'toDrop'),
  cp('B9', 28.5, 11.5, -13, 'toDrop'),
  cp('B10', 29.5, 14, 12.8, 'toDrop'),
  cp('B11', 28.5, 14, 38, 'toDrop'),
  cp('B12', 27.5, 14, 63.5, 'toDrop'),
  // B13 is the LAST ring, and there is no B14.
  //
  // There used to be one out at [52, 95], on the argument that the drop sits off
  // the avenue in the far corner and the straight line to it clips the block on
  // the way out. It does not: `check-mission-route` samples the corridor every
  // half metre and B13 to the drop is clear the whole way. What the extra ring
  // actually did was send the pilot PAST the mark and back, and it was the last
  // thing the route asked for before the delivery — so the run ended on a detour.
  //
  // After B13 the drop is simply there, down and to the right, in sight.
  cp('B13', 30.5, 14, 84.8, 'toDrop'),
];

/**
 * The way home, as bare waypoints.
 *
 * NOT checkpoints. They score nothing, draw nothing and gate nothing — the
 * return leg is a flight, not a collection. They exist because the straight
 * line from the drop back to the pad cuts through two blocks, so a route check
 * that measured that line would be measuring a flight nobody should fly. This
 * is the line a sensible pilot takes home, and `check-mission-route` samples
 * the corridor along it.
 */
const HOME_VIA: readonly (readonly [number, number])[] = [
  [9.4, 86],
  [-26, 84],
  [-26, 42],
];

/** The point thresholds, named once. `medals` publishes them to the registry and
 *  the star rungs test against them, so the card and the scoring agree.
 *
 *  They are close together now, and they have to be: every ring is required, so
 *  a package that came off at all was released by a pilot who had taken all
 *  thirteen. Delivering is 14 and landing is 15 — there is no such thing as a
 *  finished run scoring less. What separates a three-star delivery from a
 *  one-star one is therefore the FLYING: whether it was done cleanly and
 *  whether it was done in time. */
const GOLD = 15;
const SILVER = 14;

export const precisionDelivery: Mission = {
  id: 'precision-delivery',
  order: 1,
  name: 'Precision Delivery',
  // Two halves, like the Flight School subtitles: what is carried and where it
  // ends up. The long form said the same thing in eight words, and this line
  // sits under a mission NAME that already says "delivery" — the blurb below is
  // where the sentence belongs.
  subtitle: 'Carry a medical package across the city',
  kind: 'delivery',
  envId: 'new-york',
  blurb: 'Collect a medical package, fly it across the city, land it on the mark and come home.',
  story:
    'A medical package is waiting on the drone dispatch deck at Lake City Pharmacy, a short hop from the pad. It has to be across the city inside eight minutes, and the streets are not going to do it. You are the pilot.',
  flow: [
    { label: 'Collect', note: 'Line up over the box, then descend', art: 'collect' },
    { label: 'Fly', note: 'Take all thirteen rings', art: 'city' },
    { label: 'Deliver', note: 'Hold still on the yellow mark', art: 'deliver' },
    { label: 'Come home', note: 'Land back on the pad', art: 'land' },
  ],
  // Four lines, one per beat, in the order the pilot flies them. Short
  // sentences, and each one names the thing on screen it is about. Colours are
  // used only where they are unambiguous: the pickup mark and the home pad are
  // BOTH green, so home is "the pad you started from" rather than "the green
  // mark", which was sending pilots to the wrong end of the city.
  objectives: [
    'Collect the medical package from Lake City Pharmacy.',
    'Carry it through all thirteen rings across the city.',
    'Deliver it by holding still over the yellow mark.',
    'Return to the pad you started from and land.',
  ],
  mapNote: 'Buildings and roads only',
  timeLimitSec: 480,
  parTimeSec: 300,
  groundY: 0,
  medals: { bronze: 14, silver: SILVER, gold: GOLD },
  routeAltitude: ALT,
  route: [...LEG_1, ...LEG_2],
  homeVia: HOME_VIA,

  zones: {
    // The package waits on Lake City Pharmacy's raised drone dispatch deck, a
    // short hop from the pad — the same shop and deck Multi-Point Delivery
    // collects from. See `pickupStorefront.ts` for how the spot was measured.
    pickup: {
      kind: 'pickup',
      at: PHARMACY_DECK_AT,
      label: 'Lake City Pharmacy',
      /* The deck's top, not the street. */
      groundY: PICKUP_DECK_TOP,
      ringLift: 0.04,
      // You have to come DOWN to it. The band used to reach 4 m, which is above
      // the box by more than the drone is wide: a pilot arriving at route height
      // and easing off the throttle had the package clip on while they were
      // still well over it, and the clamp read as something that happened TO
      // them rather than something they did. 1.6 m was the first attempt and was
      // still generous enough to catch a pilot easing past overhead; a metre
      // puts the airframe genuinely down beside the box, and the hold below
      // means it has stopped there rather than dipped through.
      // Beside the box counts, not only on top of it.
      //
      // 0.6 m of radius under a 0.9 m ceiling is the box plus a little, and it
      // was tuned against the opposite complaint: at 2 m the package jumped up
      // to anyone who came down in the neighbourhood, which read as picking
      // itself up. That correction went too far. The Guru is flown at 2.5x
      // scale here, so most of a 0.6 m circle is under the airframe itself —
      // the pilot has to put the aircraft in a space barely wider than the
      // aircraft, and then hold it there, and the mission's opening beat became
      // its hardest.
      //
      // These are the numbers the multi-point delivery already settled on for
      // the same test, for the same reason (see `multiPointDelivery`): the
      // pilot still has to come down out of the cruise and stop over the pad,
      // but at chest height beside the box rather than sitting on it.
      //
      // What is NOT relaxed is the rest of the test — still centred, still
      // slowed, still held for most of a second. A fly-past collects nothing,
      // which is what the tight version was really protecting.
      //
      // 1 m rather than 1.4 m since the box moved onto the pharmacy's 2.6 m
      // deck: a wider ring would hang off its edge.
      radius: 1,
      band: { min: 0, max: 2 },
      // Still the gentler of the two tests — the strict one is the DROP, which
      // is tighter on every axis — but a fly-through no longer counts: the
      // drone has to be slowed and settled, not merely passing low.
      maxGroundSpeed: 1.1,
      maxVerticalSpeed: 1,
      hold: 0.8,
    },
    // Diagonally opposite, ~90 m out, so the carry is a real crossing rather
    // than a hop. The most open ground on the route: 10.8 m of clearance.
    drop: {
      kind: 'drop',
      at: [55, 92],
      label: 'Drop zone',
      // The strict one. Every number here is what stops a fly-past counting:
      // centred within 1.8 m, low, and actually stopped.
      radius: 1.8,
      band: { min: 0.3, max: 2 },
      maxGroundSpeed: 0.9,
      maxVerticalSpeed: 0.8,
      hold: 1,
    },
    // The helipad the drone launched from. Home is the H, not a mark down the
    // street — see `helipad.ts`.
    base: {
      kind: 'base',
      at: NEW_YORK_HELIPAD_AT,
      label: 'Helipad',
      groundY: NEW_YORK_HELIPAD_GROUND,
      radius: HELIPAD_LAND_RADIUS,
      band: { min: 0, max: 3 },
      // Landing is judged by ground contact and stillness (see the Director),
      // so these only gate the "LANDING ZONE REACHED" call.
      maxGroundSpeed: 12,
      maxVerticalSpeed: 12,
      hold: 0,
    },
  },

  radio: {
    start: {
      id: 'start',
      text: 'A medical package is waiting on the dispatch deck at Lake City Pharmacy, a short hop from you. Get directly over the box, come down onto it and hold steady.',
    },
    pickup: {
      id: 'pickup',
      text: 'Package on board. The drop is now marked in yellow. Head over.',
    },
    far: {
      id: 'far',
      text: 'The arrow is on the drop. Take any line through the city you like.',
    },
    near: { id: 'near', text: 'Drop zone ahead. Start slowing down.' },
    approach: {
      id: 'approach',
      text: 'Come down inside the rings and hold it steady over the mark.',
    },
    delivered: {
      id: 'delivered',
      text: 'Package delivered. Nice placement.',
    },
    home: { id: 'home', text: 'Good work. Now fly back to the pad you started from and land.' },
    landing: { id: 'landing', text: 'Base is right below you. Bring it down gently.' },
    complete: { id: 'complete', text: 'Mission complete. That was a clean flight.' },
  },

  // The full 15 first, then the flying. A pilot who bounced off two buildings on
  // the way has not flown a three-star delivery even with every point in hand.
  ranks: [
    {
      stars: 3,
      text: 'All 15 points, no crashes, home inside 5:00',
      test: (r) =>
        r.delivered && r.landed && r.points >= GOLD && r.collisions === 0 && r.timeSec <= 300,
    },
    {
      stars: 2,
      text: 'Delivered and home, one crash at most',
      test: (r) => r.delivered && r.landed && r.points >= SILVER && r.collisions <= 1,
    },
    {
      stars: 1,
      text: 'Deliver the package and land back at base',
      test: (r) => r.delivered && r.landed,
    },
  ],
};

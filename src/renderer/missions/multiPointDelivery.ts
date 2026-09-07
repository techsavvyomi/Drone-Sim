import type { Mission, MissionDelivery, MissionZone } from './types';

// ----------------------------------------------------------------------------
// Multi-Point Delivery — New York City.
//
// Three medical packages, one at a time, out of a central logistics hub. Collect
// A, place it, come back for B, place it, come back for C, place it, come home
// and land. Four points: one per delivery and one for the landing.
//
// THE JOB IS THE LOOP, WHICH IS WHY THERE ARE NO RINGS.
//
// Precision Delivery gates its release on fourteen checkpoints because its
// single crossing needs a route to be. This mission's difficulty is the workflow
// itself — three round trips, a payload that can only ever be the next one in
// order, and two destinations that are on ROOFS rather than on the street. A
// corridor of pink balls laid over that would be a second thing to follow at the
// moment the pilot is already counting packages.
//
// So `route` is empty, `requiredCheckpoints` is empty, the release gate is
// always open, and what stops a pilot skipping to package C is the state machine
// (`missionStore.runIndex`) rather than a line of scenery.
//
// EVERY COORDINATE HERE WAS MEASURED, NOT CHOSEN.
//
//     node scripts/check-multi-delivery-route.mjs
//
// reports the deck height under each mark, the clear air above it, and the
// corridor flown between them. Re-run it after ANY change to a number in this
// file or after regenerating the colliders.
//
// WHY ONLY TWO OF THE THREE DESTINATIONS ARE ROOFTOPS.
//
// The brief asks for three rooftops. Every mission is flown on the Guru and the
// Guru's `maxAltitude` is 30 m, enforced as a soft ceiling in the flight
// controller; this city's roofs start at 45 m and the tallest is 112 m. A sweep
// of the generated colliders over the whole map found exactly three flat,
// reachable roof patches — 24.5 m, 25.1 m and 26.5 m — and all three sit in the
// same north-west corner. Two of them are used here. The third destination is a
// street-level loading bay, because a rooftop the aircraft cannot climb to is
// not a destination, and pretending otherwise would have shipped a mission whose
// second package could never be delivered.
// ----------------------------------------------------------------------------

/**
 * The logistics hub: where all three packages wait, and where the drone lands at
 * the end.
 *
 * ONE PLACE, TWO ZONES. The pickup and the base sit on the same mark because on
 * this mission they are the same thing — the brief's "return to the logistics
 * centre" is the same flight as its "return to base", and giving them separate
 * marks would put two rings on one pad and ask the pilot which of them was
 * theirs. They are never live at the same time, so only one is ever drawn.
 *
 * IT IS DELIBERATELY NOT WHERE THE DRONE TAKES OFF FROM.
 *
 * It sat three metres from NYC's spawn to begin with, which is Precision
 * Delivery's pad. On a mission that carries ONE package that is fine — the pad
 * is bare and the box is somewhere else. Here it meant the pilot armed the
 * aircraft standing in the middle of three parcels, on top of the mark, with the
 * radar's P sitting under their own aircraft: the mission opened with its first
 * objective already met and nothing to fly to. Twenty-five metres down the cross
 * street the depot is a PLACE the pilot goes to, the first thing they do is
 * reposition, and the spawn is clear ground again.
 *
 * Measured, not moved by eye: 8.8 m of clear column here against 4.1 m at the
 * old pad, so it is also the better thing to descend onto — which matters, since
 * this one is landed on as well as collected from.
 */
const HUB: readonly [number, number] = [-25, 29];

/**
 * The cruise height the corridor between the marks is measured at, in metres.
 *
 * Above the street furniture — lamps, signs and traffic lights top out at
 * 10.5 m — and below the two roofs the mission delivers to, so the run out to
 * either of them is a climb rather than a level line. It is not a rail: nothing
 * is drawn at this height and nothing is scored on it. It is the number
 * `check-multi-delivery-route` samples the city at, and the number the docs
 * quote.
 */
const CRUISE = 20;

/**
 * One destination.
 *
 * The strict numbers are Precision Delivery's, deliberately: centred within
 * 1.8 m, low over its own deck, and actually stopped for a second. A pilot who
 * has flown mission 1 already knows what this test feels like, and the new thing
 * to learn here is that there are three of them and that two are on a roof.
 */
function bay(
  label: string,
  x: number,
  z: number,
  over: { deck: number; radius: number; max: number },
): MissionZone {
  return {
    kind: 'drop',
    at: [x, z],
    label,
    radius: over.radius,
    // Measured from THIS mark's own deck. On a roof that deck is twenty-five
    // metres up, and a band judged against the street would ask the pilot to
    // hover inside the building.
    band: { min: 0.3, max: over.max },
    maxGroundSpeed: 0.9,
    maxVerticalSpeed: 0.8,
    hold: 1,
    /*
     * THE DECK, ALWAYS DECLARED, even when it is nearly the street.
     *
     * `groundY` was only set on the roofs to begin with, on the reasoning that a
     * street mark is at the mission's own ground height. Bay A is not: it stands
     * on a sidewalk plate whose top is 0.12 m, and 0.12 m is exactly half of the
     * package. So the first box delivered there was placed at y = 0 and buried
     * to its waist in the pavement — and the height band the release is judged
     * on was 12 cm low too, over a kerb the drone would have set down on.
     *
     * The rule this leaves behind: a mark declares the surface it is ON, read
     * off the colliders, never the map's nominal ground. `check-multi-delivery-
     * route` measures it against every collider section INCLUDING the sidewalk
     * plates, which is what it failed to do the first time.
     */
    groundY: over.deck,
    // A ROOF is a slab with a lip, not a road: 3 cm of lift z-fights the deck
    // the ring is painted on from a low approach, which is exactly the approach
    // a rooftop delivery is flown on. A kerb 12 cm up is still flat ground and
    // wants the default.
    ringLift: over.deck > 1 ? 0.09 : undefined,
  };
}

/**
 * The three packages, in the order they are flown.
 *
 * The ORDER IS THE MISSION. `missionStore.runIndex` walks this list and is only
 * ever advanced by completing the delivery it is on, so B cannot be collected
 * before A is down and B cannot be placed on C's roof — while the index says B,
 * C's mark is not being tested by anything.
 *
 * A — SHORT, AND ON THE STREET. A loading bay 28 m south-west of the hub, in
 * open ground, and pointedly in the OPPOSITE direction to the two roofs. It
 * exists to teach the loop — collect, place, come back — and sending the pilot
 * the other way for it means the second package is not simply the first one
 * again with more of it.
 *
 * B — A ROOF. 25.1 m up and 51 m out, with ten metres of clear air above the
 * slab. The roomier of the city's two reachable roofs, which is why it is the
 * one the pilot meets first: the new skill here is holding a hover over a deck
 * that is not the ground, and it should be learnt somewhere forgiving.
 *
 * C — THE HARD ONE, AND THE FURTHEST. 26.5 m up, 59 m out, and the tightest
 * approach on the map: 4.6 m of clear air beside the pad, and a deck high enough
 * that the flight controller's soft ceiling (30 m, fading from 28) is already
 * taking the climb rate off.
 *
 * The ramp is therefore both the brief's and the map's: 28 m, 51 m, 59 m of
 * range, and open street, open roof, tight roof of approach. It only became both
 * when the hub moved off the spawn — from the old pad the two roofs sat within
 * two metres of the same range and distance had nothing left to say by the third
 * delivery.
 */
const DELIVERIES: readonly MissionDelivery[] = [
  {
    id: 'a',
    name: 'Package A',
    cargo: 'Emergency medicine',
    // Measured: this corner is a sidewalk plate, not the road. See `bay`.
    zone: bay('Bay A', -45, 9, { deck: 0.12, radius: 1.8, max: 2 }),
  },
  {
    id: 'b',
    name: 'Package B',
    cargo: 'Medical equipment',
    zone: bay('Rooftop B', -15.5, 79, { deck: 25.14, radius: 1.8, max: 1.8 }),
    // West to the avenue at x = -29, north up it, then in over the roof. The
    // straight line from the hub goes through a block at z = 43.
    via: [
      [-29, 40],
      [-29, 76],
    ],
  },
  {
    id: 'c',
    name: 'Package C',
    cargo: 'Emergency supplies',
    // A metre tighter than the others on every axis. It is the last thing the
    // mission asks for and the only place on the map where the ceiling and the
    // scenery are both close.
    zone: bay('Rooftop C', 7, 78.5, { deck: 26.54, radius: 1.6, max: 1.4 }),
    // The same avenue, carried further north and round the top of the city:
    // cutting east at z = 79 as the run to B does would fly through B's own
    // building, which is the one on this map tall enough to be in the way at
    // cruise height.
    via: [
      [-29, 40],
      [-29, 84],
      [0, 86],
    ],
  },
];

/**
 * The way home from the last roof, as bare waypoints.
 *
 * NOT checkpoints — they score nothing and draw nothing. The straight line from
 * C back to the hub runs down the middle of a block, so a corridor check
 * measured on it would be measuring a flight nobody can make. This is C's own
 * outbound line flown backwards — over the top of the city, down the west
 * avenue, in to the pad — and it is what `check-multi-delivery-route` samples.
 */
const HOME_VIA: readonly (readonly [number, number])[] = [
  [0, 86],
  [-29, 84],
  [-29, 40],
];

/** Points, named once so the card, the medals and the star rungs cannot drift:
 *  one for each package placed, one for getting the aircraft home. */
const GOLD = 4;
const SILVER = 4;

export const multiPointDelivery: Mission = {
  id: 'multi-point-delivery',
  order: 3,
  name: 'Multi-Point Delivery',
  subtitle: 'Three packages, three destinations, one drone',
  kind: 'delivery',
  envId: 'new-york',
  blurb:
    'Run three medical packages out of a central hub to three destinations across the city, one at a time, and bring the drone home.',
  story:
    'A hospital network has gone to emergency distribution and the logistics hub has three packages on the pad. There is one drone on the roster and no second one behind it. Take them out one at a time — the hub will not release the next until the last one is down.',
  flow: [
    { label: 'Collect', note: 'One package at a time', art: 'collect' },
    { label: 'Deliver', note: 'Street bay, then two roofs', art: 'deliver' },
    { label: 'Return', note: 'Back to the hub for the next', art: 'city' },
    { label: 'Come home', note: 'Land on the hub pad', art: 'land' },
  ],
  objectives: [
    'Collect Package A from the logistics hub and place it in Bay A.',
    'Return to the hub for Package B and hold it over Rooftop B to release.',
    'Return once more for Package C and release it over Rooftop C.',
    'Fly back to the hub and land on the pad.',
  ],
  mapNote: 'Buildings, roads and two reachable roofs',
  // Three round trips is roughly 280 m of flying plus three placements and a
  // landing. Ten minutes is a comfortable flight and seven is a brisk one, which
  // is the gap the top rating lives in.
  timeLimitSec: 600,
  parTimeSec: 420,
  groundY: 0,
  medals: { bronze: 3, silver: SILVER, gold: GOLD },
  routeAltitude: CRUISE,
  // No rings. See the header — the workflow is the difficulty here.
  route: [],
  homeVia: HOME_VIA,
  deliveries: DELIVERIES,

  zones: {
    pickup: {
      kind: 'pickup',
      at: [HUB[0], HUB[1]],
      label: 'Logistics hub',
      /*
       * LOOSER THAN PRECISION DELIVERY'S PICKUP, on purpose.
       *
       * That one is 0.6 m across with a band reaching 0.9 m, and it is right for
       * a mission where the pilot collects ONCE: it makes the collection a
       * deliberate little piece of flying rather than something that happens as
       * they drift past overhead.
       *
       * This mission collects THREE TIMES. The same test flown three times is
       * not three times the lesson, it is the same lesson twice more with the
       * drone scraping the tarmac each go — and the second and third collections
       * come after a delivery, which is the part that is actually meant to be
       * hard. So the band reaches 2 m: the pilot still has to come down out of
       * the cruise and stop over the pad, but they are hovering at chest height
       * over the box rather than sitting on it.
       *
       * What is NOT relaxed is the rest of it. Still centred, still slowed, still
       * held for most of a second — a fly-past at 2 m does not collect anything,
       * which is the thing the tight version was really protecting.
       */
      radius: 1,
      band: { min: 0, max: 2 },
      maxGroundSpeed: 1.1,
      maxVerticalSpeed: 1,
      hold: 0.8,
    },
    // The first delivery's mark, as the single-drop half of the model still
    // sees it. The SAME object as `DELIVERIES[0].zone`, not a copy: anything
    // that reads `zones.drop` without asking which run is live gets the opening
    // destination rather than a stale duplicate that could drift from it.
    drop: DELIVERIES[0].zone,
    base: {
      kind: 'base',
      at: [HUB[0], HUB[1]],
      label: 'Logistics hub',
      radius: 2.5,
      band: { min: 0, max: 3 },
      // Landing is judged on ground contact and stillness in the Director; these
      // only gate the "LANDING ZONE REACHED" call.
      maxGroundSpeed: 12,
      maxVerticalSpeed: 12,
      hold: 0,
    },
  },

  // The city is 248 m by 196 m and this mission uses about a quarter of it, so
  // a pilot who has lost the hub can be a long way from anything that matters
  // with nothing on screen saying so. Wide enough to contain every mark with
  // room to overshoot, tight enough to be a real boundary.
  strayRadius: 95,

  // Mission Control. The generic keys are the fall-back; a key suffixed with a
  // package's id is preferred over it for that run — see `say()` in the
  // Director. That is what lets one crossing be narrated three times without
  // three copies of the same four lines.
  radio: {
    start: {
      id: 'start',
      text: 'The logistics hub is a short hop west of you, with three packages on the pad. Get over Package A, come down onto the box and hold steady.',
    },
    pickup: { id: 'pickup', text: 'Package on board. Your destination is marked.' },
    'pickup-a': {
      id: 'pickup-a',
      text: 'Package A attached. Bay A is south-west of you, down at street level.',
    },
    'pickup-b': {
      id: 'pickup-b',
      text: 'Package B attached. Rooftop B is north — climb to twenty-five metres and hold it over the slab. Do not put the skids down on a roof.',
    },
    'pickup-c': {
      id: 'pickup-c',
      text: 'Package C attached. Rooftop C is the furthest and the tightest of the three. Take your time.',
    },
    near: { id: 'near', text: 'Destination ahead. Start slowing down.' },
    'near-b': { id: 'near-b', text: 'Rooftop B ahead. Get your height on before you get there.' },
    'near-c': {
      id: 'near-c',
      text: 'Rooftop C ahead. It is a metre higher than the last one and half the size.',
    },
    approach: { id: 'approach', text: 'Centre over the mark and come down onto it.' },
    delivered: { id: 'delivered', text: 'Delivery confirmed.' },
    'delivered-a': { id: 'delivered-a', text: 'First delivery confirmed. Two more remain.' },
    'delivered-b': { id: 'delivered-b', text: 'Second delivery confirmed. One final package.' },
    'delivered-c': {
      id: 'delivered-c',
      text: 'Final delivery confirmed. All emergency supplies have reached their destinations.',
    },
    // Said after a delivery that is NOT the last: the pilot has to go back for
    // the next box rather than on to the next mark.
    back: { id: 'back', text: 'Return to the logistics hub for the next package.' },
    'back-a': {
      id: 'back-a',
      text: 'Return to the logistics hub. Package B is waiting on the pad.',
    },
    'back-b': { id: 'back-b', text: 'Back to the hub once more. Package C is the last one.' },
    home: { id: 'home', text: 'All deliveries are complete. Return to the hub and land safely.' },
    landing: { id: 'landing', text: 'The pad is right below you. Bring it down gently.' },
    complete: {
      id: 'complete',
      text: 'Excellent work, pilot. All three deliveries completed successfully.',
    },
  },

  // All four points first, then the flying. Every finished run scores at least
  // three, so what separates the ratings is whether the city was flown cleanly
  // and whether the round trips were flown briskly.
  ranks: [
    {
      stars: 3,
      text: 'All 3 delivered and home, no crashes, inside 7:00',
      test: (r) =>
        r.delivered && r.landed && r.points >= GOLD && r.collisions === 0 && r.timeSec <= 420,
    },
    {
      stars: 2,
      text: 'All 3 delivered and home, one crash at most',
      test: (r) => r.delivered && r.landed && r.points >= SILVER && r.collisions <= 1,
    },
    {
      stars: 1,
      text: 'Deliver all three packages and land back at the hub',
      test: (r) => r.delivered && r.landed,
    },
  ],
};

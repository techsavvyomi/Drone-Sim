import type { Mission, MissionSearchSite, MissionZone } from './types';
import { SEARCH_SITES } from './searchRescueSites';
import { PICKUP_DECK_AT, PICKUP_DECK_TOP } from './pickupStorefront';
import { HELIPAD_LAND_RADIUS, NEW_YORK_HELIPAD_AT, NEW_YORK_HELIPAD_GROUND } from './helipad';

// ----------------------------------------------------------------------------
// Mission 4 — Logistics Drones: a food drop to a person stranded on a roof (New York City).
//
// The first mission in this project that is not "fly to the mark". The three
// before it teach hovering, height and placement along a route the app draws;
// this one removes the drawing and asks the pilot to work out where the route
// goes from a red zone on the map and what they can see out of the window.
//
// The rule that makes it a different mission rather than a fourth route is
// `hideGuidanceUntilFound`, and it is deliberately a FLAG. Every one of the four
// things that could give the answer away — the lit mark, the radar dot, the
// DISTANCE readout, the in-picture pointer — is drawn by default by a runtime
// three missions have been built on. A mission that merely declined to fill in a
// destination would get them pointing at whatever the fallback is, and the next
// change to any of those four would restore the guidance with nothing failing.
// An absence cannot be tested. See docs/mission-search-rescue.md §4.
//
// Positions come from `searchRescueSites.ts`, measured against the generated
// colliders — never chosen by eye. Re-measure with:
//
//     node scripts/check-search-sites.mjs
// ----------------------------------------------------------------------------


/**
 * The rescue zone, built from a site rather than written three times.
 *
 * Sized like Forest Fire's fire zone rather than like a delivery drop, and that
 * is the deliberate difference. A delivery pilot arrives at a mark they have
 * been flying towards for ninety seconds and descends onto 1.8 m of it. A search
 * pilot arrives having just realised where they are — they are orienting, not
 * placing — and a 1.8 m circle would turn the moment of finding the casualty
 * into a precision drill they have already been taught three times.
 *
 * The radius has a hard ceiling the sites impose: the tightest of the three has
 * 6.01 m of clear air around its column, so 4.5 m leaves the zone entirely
 * inside the space the drone can actually occupy.
 */
function rescueZone(site: {
  id: string;
  at: readonly [number, number];
  roof: number;
}): MissionZone {
  return {
    kind: 'drop',
    at: site.at,
    label: 'Rescue zone',
    /* Three and a half, where a street site had four and a half. A roof is a
     * slab with edges: the sweep that placed these accepted only roof that is
     * flat out to 4.5 m, so a wider ring would hang off the side of the building
     * it is drawn on. */
    radius: 3.5,
    /*
     * The roof the PILOT SEES, not the collider deck.
     *
     * The colliders fill a building to the tallest thing in each cell, so a roof
     * with a parapet is solid up to the parapet — a mark drawn at that height
     * hangs a metre or two above the slab, and that is precisely what it looked
     * like in flight: a rescue ring floating over the roof it belongs to. The
     * band starts four metres up, which clears every parapet here, so nothing
     * asks the aircraft to be somewhere it cannot go.
     */
    groundY: site.roof,
    /* A roof is a slab with a lip, not a road: 3 cm of lift z-fights the deck it
     * is drawn on. The same number Multi-Point Delivery lifts its rooftop ring
     * by, and for the same reason. */
    ringLift: 0.09,
    /*
     * FOUR TO NINE METRES ABOVE THE DECK, and the ceiling sizes it.
     *
     * Measured from the roof the casualty is lying on, not from the street, so
     * the same band works on the 25 m deck and on the 48 m ones. There is no
     * street furniture up here to clear — that is what forced the old 12 m floor
     * when the sites were in canyons — so the only question is how low a hover
     * still reads as being OVER someone, and four metres does.
     *
     * The top is what the mission's 80 m ceiling pays for. The highest roof is
     * 66.12, so nine metres puts the top of the hover at 75.1 — clear of the
     * limiter. A band that reached the ceiling would be a hover fighting the
     * aircraft's own air-brake.
     */
    band: { min: 4, max: 9 },
    /* The delivery drop's limits, not the fire's original 2.2. Forest Fire's own
     * amendment record is explicit about why: 2.2 m/s is a brisk pass, not a
     * hover, and this mission asks for a position HELD. */
    maxGroundSpeed: 0.9,
    maxVerticalSpeed: 0.8,
    /* Two seconds, down from five: the search is the mission, and once the
     * pilot is over the person a long hold is a wait, not a skill. */
    hold: 2,
  };
}

const SITES: readonly MissionSearchSite[] = SEARCH_SITES.map((s) => ({
  id: s.id,
  at: s.at,
  zone: rescueZone(s),
}));

/** Points: the food box delivered, and the drone landed home. Collecting the box
 *  scores nothing on its own, as on every delivery. */
const GOLD = 2;

/** Where the food box waits: on the drone pickup deck in front of Lotus
 *  Kitchen, a restaurant on the block west of the base. See
 *  `pickupStorefront.ts` for how the spot was measured. */
const PICKUP = PICKUP_DECK_AT;

export const searchRescue: Mission = {
  id: 'search-rescue',
  order: 4,
  name: 'Logistics Drones',
  subtitle: 'A distress signal, and no position to fly to',
  kind: 'search',
  envId: 'new-york',
  blurb:
    'Someone is stranded on a rooftop with no food, and there is no GPS fix. Collect a food box, find them inside the red search zone, drop it to them, and land back at base.',
  story:
    'A person is stranded on a rooftop somewhere in this sector and has had nothing to eat. Their signal is too weak to place — the best we can do is the red zone on your map. Collect the food box from the drone pickup deck at Lotus Kitchen, get up over the roofline, search the zone until you find them, and hold a steady hover over them so the box comes down beside them. Then bring the drone home and land.',
  flow: [
    { label: 'Pick up', note: 'The food box', art: 'collect' },
    { label: 'Search', note: 'A person on a roof', art: 'city' },
    { label: 'Deliver', note: 'Hover over them for 2 s', art: 'deliver' },
    { label: 'Come home', note: 'Land back on the pad', art: 'land' },
  ],
  objectives: [
    'Fly to Lotus Kitchen and collect the food box from its drone pickup deck.',
    'Climb above the rooftops and search the red zone by eye for the person on the roof.',
    'Hold a steady hover over them for two seconds to drop the food box.',
    'Fly back to base and land on the pad.',
  ],
  mapNote: 'The city, and the red search zone. No marker, no route',
  /*
   * EIGHT MINUTES, against a four minute par, and both are longer than the job.
   *
   * Every other mission's time limit is a flight plus a margin, because every
   * other mission knows where the pilot is going. A search does not: the same
   * pilot flying the same standard can find the site in ninety seconds or in
   * five minutes depending on which third of the map they start with. The limit
   * has to be generous enough that bad luck is not a failure, and the par is
   * what the rating is actually measured against.
   */
  timeLimitSec: 480,
  parTimeSec: 240,
  groundY: 0,
  /*
   * EIGHTY METRES, against the Guru's own thirty.
   *
   * The casualties are on roofs, and this city's roofs start at 45 m: on the
   * stock airframe all but one of them is somewhere the aircraft cannot get
   * above at all. Sixty was enough for four roofs, but those four were all close
   * to the restaurant the food box comes from. Eighty is what four FAR roofs
   * cost — the nearest 110 m from the pickup. The highest roof is 66.12 m, so
   * its hover band tops out at 75.1 and the air-brake keeps its margin.
   *
   * It is scoped to this mission and it only ever raises: the drone picker still
   * says 30 m, because 30 m is still what the aircraft does. Flying a rescue
   * over the rooftops is the exception the briefing sells, not a quiet upgrade
   * to the Guru.
   */
  ceiling: 80,
  medals: { bronze: 1, silver: GOLD, gold: GOLD },
  /* Nothing hangs at this height — the mission has no route — but the field is
   * required and is what the briefing quotes as a sensible search altitude.
   * Seventy puts the pilot just over the roofline the casualties are on (48 to
   * 66 m), which is the height the whole search is flown at. */
  routeAltitude: 70,
  /*
   * NO CHECKPOINTS, and this is the one mission where that is a design decision
   * rather than an omission. A ring is an answer. Even one ring, even an
   * optional one, would tell the pilot which third of the map to fly to before
   * they had seen the red zone.
   */
  route: [],
  /*
   * NO STRAY RADIUS either, and for the same reason it exists on Forest Fire.
   * There, a pilot who has lost the fire in a trackless forest can fly the whole
   * map the wrong way with nothing saying so, and the recall is a kindness. Here
   * flying the wrong part of the map IS the mission — it is what searching a
   * zone without a fix looks like — and a banner telling the pilot they have
   * gone too far would be the app quietly narrowing the search for them. The
   * red zone has already narrowed it, once, honestly and on the map.
   */
  hideGuidanceUntilFound: true,
  search: {
    sites: SITES,
    /*
     * EIGHTEEN METRES to first detection — down from forty, then twenty-six.
     *
     * Forty was about three blocks, and the HUD announced the casualty while
     * the pilot was still a street away and had seen nothing: the instrument
     * did the finding and the beacon arrived as confirmation, which is exactly
     * backwards for a mission about looking OUT of the window. Twenty-six fixed
     * that, and then became the floor under the red zone: a zone no wider than
     * the detect range announces the casualty the moment it is entered, so the
     * circle is the answer rather than the search. Shrinking the zone meant
     * shrinking this with it.
     *
     * Eighteen is the street the beacon stands in. The pilot sees the smoke,
     * turns towards it, and the readout agrees — the order the two are meant to
     * happen in. The beacon is drawn out to 220 m, so seeing it first is
     * guaranteed, and it is still comfortably wider than the 7 m confirmation.
     */
    detectRadius: 18,
    /*
     * EIGHT METRES to confirmation — deliberately wider than the rescue zone's
     * own 4.5.
     *
     * The reveal happens as the pilot ARRIVES, so the zone appears in front of
     * them and they settle into it. Confirming on the zone's own boundary would
     * mean the mark appeared at the instant they were already inside it, which
     * reads as the app noticing late.
     */
    confirmRadius: 7,
    /* How high the beacon's smoke and light stand. Under the hover band's floor,
     * so the pilot holds ABOVE the plume rather than inside it — the forest's
     * fire column was removed for exactly this: warm translucent haze where real
     * smoke already is reads as smoke, not as a marker. */
    beaconHeight: 10,
    /*
     * TWENTY-TWO METRES of red zone — down from forty-five, then thirty-two.
     *
     * Forty-five was set when the map was a sketch of nine grey blocks, and a
     * zone had to be wide for the search to take any time. On a map that shows
     * every roof, tree and sidewalk, anything that size read as most of the
     * city painted red.
     *
     * It has a hard floor, which is the detect radius: see above. Twenty-two
     * leaves four metres past the eighteen at which the signal is heard, so the
     * pilot enters the zone before the HUD says anything and has to look.
     */
    zoneRadius: 22,
    /*
     * TWENTY-FIVE METRES ABOVE THE CASUALTY'S OWN DECK, against a hover band
     * that tops out at nine.
     *
     * Well clear of the band, so a pilot settling into the hover from above is
     * never dropped out of range mid-descent — losing the signal on the way DOWN
     * to the casualty would read as a fault. What it still catches is the pilot
     * who climbs to the 80 m ceiling and cruises the whole city from above: over
     * the two 48 m roofs that is more than 25 m up and hears nothing. It is a
     * backstop, not the rule.
     */
    maxDetectAgl: 25,
  },
  homeVia: [],
  /*
   * THE FOOD BOX waits on the restaurant's raised pickup deck, with its ring,
   * and the attempt opens flying to it. Mission 3's collection numbers: a 1 m circle
   * and a 2 m band, so a fly-past collects nothing but a placed hover does.
   */
  zones: {
    pickup: {
      kind: 'pickup',
      at: PICKUP,
      label: 'Lotus Kitchen',
      /* The deck's top, not the street: the box is collected off the
       * restaurant's pickup deck. */
      groundY: PICKUP_DECK_TOP,
      ringLift: 0.04,
      radius: 1,
      band: { min: 0, max: 2 },
      maxGroundSpeed: 1.1,
      maxVerticalSpeed: 1,
      hold: 0.8,
    },
    /* The FIRST site's zone, exactly as a multi-point delivery's `zones.drop` is
     * its first package's — the same object, not a copy. Anything that still
     * reads `zones.drop` without asking which site is live gets a real zone
     * rather than nothing. What is actually judged is `rescueZoneOf`. */
    drop: SITES[0].zone,
    /* The helipad the drone launched from — the landing is judged on the H,
     * not on a mark down the street. See `helipad.ts`. */
    base: {
      kind: 'base',
      at: NEW_YORK_HELIPAD_AT,
      label: 'Helipad',
      groundY: NEW_YORK_HELIPAD_GROUND,
      radius: HELIPAD_LAND_RADIUS,
      band: { min: 0, max: 3 },
      maxGroundSpeed: 1.1,
      maxVerticalSpeed: 1,
      hold: 0.8,
    },
  },

  radio: {
    start: {
      id: 'sr-start',
      text: 'Pilot, someone is stranded on a rooftop in this sector with no food, and the GPS fix is too weak to place them. Collect the food box from the pickup deck at Lotus Kitchen first — it is on the block just west of you.',
    },
    pickup: {
      id: 'sr-pickup',
      text: 'Food box on board. Now search the red zone on your map — look for someone on a roof.',
    },
    /* Never played by name — `radio` is an open record and nothing calls for
     * this key. It is the line the briefing quotes, kept beside the others so
     * the mission's voice lives in one place. */
    zone: {
      id: 'sr-zone',
      text: 'The red zone on your map is as close as we can place it. Climb above the roofline, get inside it, and start looking. You are cleared to eighty metres.',
    },
    /* Said once, the first time the signal is heard at all. The percentage on
     * the strip carries it from here — a second radio line at 60% would be
     * Mission Control narrating a number the pilot is already watching. */
    detected: {
      id: 'sr-detected',
      text: 'We have something. Weak emergency signal — you are in the right area. Slow down and look.',
    },
    located: {
      id: 'sr-located',
      text: 'That is them. Get over them and hold a steady hover — the box will come down beside them.',
    },
    delivered: {
      id: 'sr-confirmed',
      text: 'Food box delivered. That will keep them going until the ground team gets there. Good work, pilot.',
    },
    home: { id: 'sr-home', text: 'Nothing more you can do up there. Return to base and land.' },
    landing: { id: 'sr-landing', text: 'The pad is right below you. Bring it down gently.' },
    complete: {
      id: 'sr-complete',
      text: 'They would not have been found without you, pilot. That is what this aircraft is for.',
    },
  },

  /*
   * The rating, and what it deliberately does NOT measure.
   *
   * There is no "search efficiency" rung. The obvious one — distance flown
   * against the distance to the target — punishes the pilot for not knowing the
   * answer, which is the whole mission. The honest version, distance against a
   * systematic sweep of the red zone, cannot be computed without deciding what
   * a systematic sweep is, and a rating nobody can predict is a rating nobody
   * trusts. So TIME carries it: a pilot who went straight to the zone and
   * searched it is fast, and one who swept the whole city is not.
   */
  ranks: [
    {
      stars: 3,
      text: 'Food delivered and home, no collisions, inside 4:00',
      test: (r) =>
        r.delivered && r.landed && r.points >= GOLD && r.collisions === 0 && r.timeSec <= 240,
    },
    {
      stars: 2,
      text: 'Food delivered and home, one collision at most',
      test: (r) => r.delivered && r.landed && r.points >= GOLD && r.collisions <= 1,
    },
    { stars: 1, text: 'Get the food box to them', test: (r) => r.delivered },
  ],
};

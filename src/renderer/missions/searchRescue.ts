import type { Mission, MissionSearchSite, MissionZone } from './types';
import { SEARCH_SITES } from './searchRescueSites';

// ----------------------------------------------------------------------------
// Mission 4 — Missing Person: Search & Rescue (New York City).
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

/** The base pad, on the street. The same place Multi-Point Delivery puts its
 *  hub, and for the same measured reason: the spawn at [0, 26] has a lamp arm
 *  over it at 10 m leaving 1.1 m of clear column, and nothing that has to be
 *  descended onto can go there. At [0, 29] there is 4.1 m. */
const BASE: readonly [number, number] = [0, 29];

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
function rescueZone(site: { id: string; at: readonly [number, number] }): MissionZone {
  return {
    kind: 'drop',
    at: site.at,
    label: 'Rescue zone',
    radius: 4.5,
    /*
     * WELL ABOVE THE STREET, and not by preference.
     *
     * This city's lamps, signs and traffic lights top out at 10.5 m and the
     * sites sit in corridors 11 to 13 m wide. A band that let the pilot hover at
     * six metres would be asking them to hold a position among the furniture, in
     * a canyon, at the one moment they are looking down rather than ahead.
     *
     * The top of the band is under the Guru's 30 m ceiling with room to spare —
     * a band that reached the ceiling would be a hover fighting the aircraft's
     * own limiter.
     */
    band: { min: 12, max: 22 },
    /* The delivery drop's limits, not the fire's original 2.2. Forest Fire's own
     * amendment record is explicit about why: 2.2 m/s is a brisk pass, not a
     * hover, and this mission asks for a position HELD. */
    maxGroundSpeed: 0.9,
    maxVerticalSpeed: 0.8,
    hold: 5,
  };
}

const SITES: readonly MissionSearchSite[] = SEARCH_SITES.map((s) => ({
  id: s.id,
  at: s.at,
  zone: rescueZone(s),
}));

/** Points: confirming the rescue location, and getting the aircraft home. */
const GOLD = 2;

export const searchRescue: Mission = {
  id: 'search-rescue',
  order: 4,
  name: 'Missing Person',
  subtitle: 'A distress signal, and no position to fly to',
  kind: 'search',
  envId: 'new-york',
  blurb:
    'A distress signal somewhere in the city and no GPS fix. Fly to the red search zone, find the casualty by eye, and confirm the rescue location.',
  story:
    'A distress signal was received somewhere in this sector, but it is too weak to place. The best we can do is narrow it to an area — the red zone on your map. There is no position to fly to inside it and there will not be one. Get there, search it, find the casualty, and hold over them long enough for the coordinates to lock.',
  flow: [
    { label: 'Read', note: 'A red zone, no marker', art: 'collect' },
    { label: 'Search', note: 'Fly the zone and look', art: 'city' },
    { label: 'Confirm', note: 'Hold the hover for 5 s', art: 'deliver' },
    { label: 'Come home', note: 'Land back on the pad', art: 'land' },
  ],
  objectives: [
    'Find the red search zone on the map — it is the only thing that says where to go.',
    'Fly into the zone and search it by eye until the emergency signal is picked up.',
    'Close on the beacon and hold your position over the rescue zone for five seconds.',
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
  medals: { bronze: 1, silver: 2, gold: GOLD },
  /* Nothing hangs at this height — the mission has no route — but the field is
   * required and is what the briefing quotes as a sensible search altitude. The
   * map's own note is why it is 18: the street grid is open through 14 to 20 m
   * and narrows to 2.5 m by 12. */
  routeAltitude: 18,
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
     * TWENTY-SIX METRES to first detection, and it came DOWN from forty.
     *
     * Forty metres is about three blocks on this map, which meant the HUD
     * announced the casualty while the pilot was still a street away and had not
     * yet seen anything — so the mission's own instrument was doing the finding
     * and the beacon was arriving afterwards as confirmation. That is exactly
     * backwards: this mission exists to teach a pilot to look OUT of the window.
     *
     * Twenty-six is inside the block the beacon is on. The pilot sees the smoke,
     * turns towards it, and the readout catches up and agrees — which is the
     * order the two are meant to happen in. The beacon is drawn out to 220 m
     * against this, so seeing it first is not luck, it is guaranteed.
     */
    detectRadius: 26,
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
     * FORTY-FIVE METRES of red zone — about a sixth of the city.
     *
     * The number is set from the two ways it can be wrong. Too tight and the
     * pilot sees the whole circle from its edge, so the zone IS the answer and
     * the mission is a marker with a red border. Too wide and it has narrowed
     * nothing: a third of the map is what the pilot would have swept anyway.
     *
     * Ninety metres across is three or four blocks of this city. The pilot
     * flies to it, drops among the buildings, and has a real search in front of
     * them — one that fits inside the four minute par with time to fly it
     * properly rather than to rush it.
     */
    zoneRadius: 45,
    /*
     * TWENTY-FIVE METRES, three above the hover band's own ceiling of 22.
     *
     * The number is the band's top plus enough room that a pilot settling into
     * the hover from above is never dropped out of range mid-descent — losing
     * the signal on the way DOWN to the casualty would read as a fault. Above
     * it the drone is over the roofline with the whole sector in view, and the
     * mission stops answering: at that height finding someone is not searching,
     * it is climbing until everything is inside the radius.
     */
    maxDetectAgl: 25,
  },
  homeVia: [],
  /*
   * THE PICKUP IS THE BASE PAD, and it is never live.
   *
   * `zones` is a record of three kinds and cannot grow, but this mission has
   * nothing to collect: the pilot launches empty and lands empty. The state
   * machine never enters `toPickup` on a search mission — `freshAttempt` opens
   * on `searching` — so nothing ever tests or draws this zone. It is filled with
   * the pad rather than with a plausible-looking street corner precisely so that
   * if something ever DID reach it, the pilot would be sent somewhere harmless
   * and obvious rather than to a mark invented to satisfy a type.
   */
  zones: {
    pickup: {
      kind: 'pickup',
      at: BASE,
      label: 'Base pad',
      radius: 2.5,
      band: { min: 0, max: 3 },
      maxGroundSpeed: 1.1,
      maxVerticalSpeed: 1,
      hold: 0.8,
    },
    /* The FIRST site's zone, exactly as a multi-point delivery's `zones.drop` is
     * its first package's — the same object, not a copy. Anything that still
     * reads `zones.drop` without asking which site is live gets a real zone
     * rather than nothing. What is actually judged is `rescueZoneOf`. */
    drop: SITES[0].zone,
    base: {
      kind: 'base',
      at: BASE,
      label: 'Base pad',
      radius: 2.5,
      band: { min: 0, max: 3 },
      maxGroundSpeed: 1.1,
      maxVerticalSpeed: 1,
      hold: 0.8,
    },
  },

  radio: {
    start: {
      id: 'sr-start',
      text: 'Pilot, we have an emergency. A distress signal somewhere in this sector, and the GPS fix is too weak to place it. Your drone is our only way to search.',
    },
    /* Never played by name — `radio` is an open record and nothing calls for
     * this key. It is the line the briefing quotes, kept beside the others so
     * the mission's voice lives in one place. */
    zone: {
      id: 'sr-zone',
      text: 'The red zone on your map is as close as we can place it. Get inside it and start looking.',
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
      text: 'That is them. Get over the rescue zone and hold it there while the coordinates lock.',
    },
    delivered: {
      id: 'sr-confirmed',
      text: 'Rescue location confirmed. The emergency team has the coordinates. Good work, pilot.',
    },
    home: { id: 'sr-home', text: 'Nothing more you can do here. Return to base.' },
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
      text: 'Rescue confirmed and home, no collisions, inside 4:00',
      test: (r) =>
        r.delivered && r.landed && r.points >= GOLD && r.collisions === 0 && r.timeSec <= 240,
    },
    {
      stars: 2,
      text: 'Rescue confirmed and home, one collision at most',
      test: (r) => r.delivered && r.landed && r.points >= GOLD && r.collisions <= 1,
    },
    { stars: 1, text: 'Find the casualty and land back at base', test: (r) => r.delivered },
  ],
};

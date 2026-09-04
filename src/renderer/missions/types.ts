import type { MissionSpec, Vec3 } from '@shared/types';

// ----------------------------------------------------------------------------
// The mission content model.
//
// A mission is pure data, the way a lesson is: a route, three zones, the tests
// that open and close them, and the lines Mission Control says. It never touches
// the engine — `MissionDirector` walks it and `missionStore` holds the live
// state, so the same shape can describe a second mission without a second
// runtime.
//
// It deliberately does NOT reuse `Lesson`. A lesson is Explain -> Demonstrate ->
// Practice -> Reward and carries a demo timeline, a validator and a star rubric
// keyed to one drill. A mission has none of those phases; what it shares with a
// lesson is the CHECKPOINT — and that piece is shared for real, through
// `CheckpointSphere`, which both draw.
// ----------------------------------------------------------------------------

/** Which leg of the flight a checkpoint belongs to. */
export type MissionLegId = 'toPickup' | 'toDrop' | 'toBase';

/**
 * One optional scoring point on the route, worth exactly one point.
 *
 * OPTIONAL is the whole design. The brief says the pilot decides how to fly
 * between the buildings, so a checkpoint that gated the next leg would quietly
 * turn the city into a corridor. A checkpoint the pilot flies past is a point
 * not taken — never a failure, never a block — which is what lets a suggested
 * line and free navigation live in the same mission.
 */
export interface MissionCheckpoint {
  id: string;
  /** Shown in the HUD as the next one along: 'A1', 'B3'. */
  label: string;
  /** Centre of the scoring sphere, world metres. */
  at: Vec3;
  /** How close the drone's centre must get, in metres. Also the visual trigger:
   *  `CheckpointSphere` draws the ball inside this, so what you can see is what
   *  you fly into. */
  reach: number;
  /** Radius of the drawn ball. Smaller than `reach` so the light sits wholly
   *  inside the volume that scores. */
  radius: number;
  leg: MissionLegId;
  /**
   * Whether the payload is GATED on this one. Default true.
   *
   * Precision Delivery makes every ring required: the package will not release
   * until they are all taken, which is what turns a scattering of bonuses into a
   * route. Forest Fire cannot do that — its brief asks for a pilot who picks
   * their own way through the trees — so its rings are pure guidance and pure
   * score, and skipping the lot still lets the tank open over the fire.
   */
  required?: boolean;
}

/** The three mandatory zones: where the package is, where it goes, where home is. */
export type MissionZoneKind = 'pickup' | 'drop' | 'base';

/**
 * A place on the ground the mission cannot move past.
 *
 * Unlike a checkpoint this is a volume with a HEIGHT BAND and a settle test, not
 * a sphere to fly through — a package is picked up and put down by a drone that
 * is over the mark and slow, which is a different question from "did you pass
 * through here".
 */
export interface MissionZone {
  kind: MissionZoneKind;
  /** Ground position, world metres. The mark is drawn on the deck at `groundY`. */
  at: readonly [number, number];
  /** What the HUD calls it. */
  label: string;
  /** How far off centre, horizontally, still counts. */
  radius: number;
  /** Altitude band above the ground that counts, in metres. */
  band: { min: number; max: number };
  /** Ceiling on horizontal speed while the test is being held, m/s. */
  maxGroundSpeed: number;
  /** Ceiling on climb/descent rate while the test is being held, m/s. */
  maxVerticalSpeed: number;
  /** Seconds every condition must hold together before the zone fires. */
  hold: number;
  /**
   * The ground height under THIS mark, when it is not the mission's own.
   *
   * New York is a flat plane and one `groundY` describes all three of its zones.
   * The forest is not: its clearing is at zero and the hollow the fire burns in
   * is twelve and a half metres below it (measured — see
   * `scripts/check-forest-route.mjs`). A height band judged against the
   * clearing would ask the pilot to hover under the terrain.
   *
   * Measured, never guessed. The forest map has no `groundY` in its spec at all,
   * precisely because it has no single ground height.
   */
  groundY?: number;
}

/** One rung of the mission's rating, best first. */
export interface MissionRank {
  stars: 1 | 2 | 3;
  /** What it takes, in the pilot's words — shown before the flight and after. */
  text: string;
  test: (r: MissionResult) => boolean;
}

/** What a finished attempt is judged on. */
export interface MissionResult {
  points: number;
  maxPoints: number;
  timeSec: number;
  collisions: number;
  delivered: boolean;
  landed: boolean;
}

/**
 * One beat of the mission, for the briefing card's flow row.
 *
 * The shape of the job before any of the prose: four words that say what this
 * mission IS. A card that opens with four paragraphs makes the pilot read to
 * find that out, and most of them will not — the flow answers it in a glance and
 * lets the prose be what it should be, the detail underneath.
 *
 * Written by the mission rather than derived from the legs: the state machine's
 * names are engineering ('carrying', 'toDrop'), and a briefing should read like
 * a job sheet.
 */
export interface MissionStep {
  /** One word, upper-cased on screen: 'Collect', 'Carry'. */
  label: string;
  /** A few words under it, in the pilot's language. */
  note: string;
  /**
   * Which picture the briefing draws over this beat.
   *
   * A KEY, not an image path. The briefing card wants a thumbnail per step and
   * this app has no image assets at all — `src/assets` is models and nothing
   * else, and a strict CSP means a texture cannot be fetched from anywhere. So
   * each beat names a small scene the card draws in SVG: the package on its lit
   * mark, the drone threading the towers, the tank open over the fire. Drawn
   * rather than photographed also means they stay right when a mission's numbers
   * move, which a screenshot would not.
   */
  art: MissionArt;
}

/** The scenes the briefing card knows how to draw. */
export type MissionArt = 'collect' | 'city' | 'forest' | 'deliver' | 'suppress' | 'land';

/** A line from Mission Control, played once when its leg begins. */
export interface RadioLine {
  /** Store key, so a line can never be played twice. */
  id: string;
  text: string;
}

/**
 * What KIND of job the mission is, which is the one thing the runtime branches
 * on.
 *
 * 'delivery' puts something down on a mark. 'suppression' holds a position over
 * a target while a tank empties into it. They share the whole of the rest of the
 * mission — collect, carry, come home, land — and they share the zone that
 * judges the middle of it: in both cases the pilot has to be centred, at the
 * right height and stopped. What differs is how long, and what the holding is
 * FOR.
 */
export type MissionKind = 'delivery' | 'suppression';

/**
 * The fire, for a suppression mission.
 *
 * Only the numbers the runtime needs. Where it burns is the `drop` zone — the
 * mission has exactly one place in the middle it must get to, and giving the
 * fire a fourth zone would mean two marks, two radars and two sets of release
 * conditions describing one hover.
 */
export interface MissionFire {
  /** Seconds of unbroken, correctly positioned hover that puts the fire out.
   *  The whole point of the mission: a fire that went out on contact would be a
   *  marker to touch rather than a position to hold. */
  suppressSec: number;
  /** How far off centre the drone can drift before suppression is INTERRUPTED,
   *  in metres. Wider than the zone's own radius: losing the hold is a warning
   *  and a pause, not a reset, and a boundary the pilot bounces in and out of
   *  every second would be unflyable. */
  breakRadius: number;
  /** Radius of the burning ground, metres — what the fire and its scorch mark
   *  are drawn at. Bigger than the hover zone, which sits inside it. */
  burnRadius: number;
}

export interface Mission {
  id: string;
  /** 1-based position in the mission list, and what the card and the in-flight
   *  badge call it: "MISSION 1". Also drives unlock order, the way a lesson's
   *  `order` does — the list is a path you work along, not a menu. */
  order: number;
  name: string;
  /** One short line under the name on the card. */
  subtitle: string;
  /** Delivery or suppression. Drives the runtime's middle leg, the HUD's
   *  wording and the result sheet — nothing else. */
  kind: MissionKind;
  /** Environment the mission is flown in. */
  envId: string;
  /** One-line summary for the mission card. */
  blurb: string;
  /**
   * The situation, in two or three sentences, told rather than instructed.
   *
   * The WHY, and the first thing on the card. The HOW used to sit beside it as
   * four paragraphs of `briefing` prose; it is gone, because nobody read it. A
   * pilot arrives at this card wanting to fly, and what they take in is the
   * story, the four beats and the objectives — so those three now have to carry
   * the mission on their own.
   */
  story: string;
  /** The job as four numbered lines, one per beat of `flow`. Whole sentences,
   *  in the pilot's language — this is the part of the card most pilots read
   *  instead of the prose. */
  objectives: readonly string[];
  /** One word for the card's difficulty tile. */
  difficulty: string;
  /** A few words under the map's name: what is out there. */
  mapNote: string;
  /** The job in four beats, shown as a numbered row above the briefing. */
  flow: readonly MissionStep[];
  /** Seconds before the mission times out. */
  timeLimitSec: number;
  /** Seconds under which a flight counts as fast, for the top rating. */
  parTimeSec: number;
  /** The flat ground height of this map — zones are drawn and judged from it. */
  groundY: number;
  /** Height the route checkpoints hang at, for the marker and the HUD. */
  routeAltitude: number;
  /** Points needed for each rating. The SAME numbers the rungs below test, so
   *  the registry's summary of this mission and the mission itself cannot drift:
   *  `ranks` reads them rather than repeating them. */
  medals: { bronze: number; silver: number; gold: number };
  /** The fire, on a suppression mission. Absent on a delivery. */
  fire?: MissionFire;
  route: readonly MissionCheckpoint[];
  /** Bare waypoints for the flight home: the line a sensible pilot takes from
   *  the drop back to the pad. They score nothing and draw nothing — the return
   *  leg is a flight, not a collection — and exist so `check-mission-route` can
   *  measure a corridor that is actually flown rather than the straight line
   *  from the drop to the pad, which cuts through two blocks. */
  homeVia: readonly (readonly [number, number])[];
  zones: Record<MissionZoneKind, MissionZone>;
  radio: Record<string, RadioLine>;
  ranks: readonly MissionRank[];
}

/**
 * The mission as the plugin registry sees it.
 *
 * Derived rather than written twice. The registry is the app's content index —
 * every drone, map and lesson is reachable through it — and a mission that is
 * only reachable through its own module is a mission the rest of the engine
 * cannot be told about.
 */
export function toMissionSpec(m: Mission): MissionSpec {
  return {
    id: m.id,
    name: m.name,
    type: m.kind === 'suppression' ? 'rescue' : 'delivery',
    description: m.blurb,
    medalThresholds: m.medals,
  };
}

/**
 * The checkpoints that have to be taken before the package will release.
 *
 * Everything on the way OUT: the run to the pickup and the carry itself. The
 * return leg's are not in here and cannot be — they come after the delivery, so
 * requiring them would make the mission impossible.
 *
 * This is what turns a scattering of optional bonuses into a route the package
 * has to travel. The pilot still picks their own line between them; what they
 * cannot do is skip the city and go straight to the mark.
 */
export function requiredCheckpoints(m: Mission): readonly MissionCheckpoint[] {
  return m.route.filter(
    (c) => c.required !== false && (c.leg === 'toPickup' || c.leg === 'toDrop'),
  );
}

/** How many of those are still outstanding. */
export function requiredLeft(m: Mission, collected: Record<string, true>): number {
  return requiredCheckpoints(m).filter((c) => !collected[c.id]).length;
}

/**
 * The one place that answers "where now".
 *
 * The lit ring in the world, the radar dot and the DISTANCE readout all come
 * from here, so they can never disagree — one ring is lit over the city and it
 * is the one the dial is pointing at.
 *
 * The rule is ROUTE ORDER: the first ring on this leg that has not been taken.
 * It was "the nearest outstanding one" while every ring was lit at once, which
 * let a pilot who skipped one be sent to whichever was now cheapest. With one
 * ring lit at a time that rule turns the route into a thing that jumps around
 * as the drone moves — the lit ball would change under the pilot mid-approach —
 * and the route was laid out as a line through the city in the first place.
 */
export function nextCheckpointOf(
  m: Mission,
  leg: 'toPickup' | 'toDrop' | 'toBase' | null,
  collected: Record<string, true>,
  from?: { x: number; z: number },
): MissionCheckpoint | null {
  if (!leg) return null;
  // Every outstanding ring on this leg, required or not. The lit ring is
  // GUIDANCE — it is what the radar dot and the DISTANCE readout point at — and
  // a mission whose rings are all optional (Forest Fire) would otherwise fly
  // past a route with nothing ever lit on it.
  //
  // But an OPTIONAL ring the pilot has flown past has to stop being the
  // guidance, or a pilot who chose the low line through the trees is sent back
  // to a ring behind them for the rest of the mission while the fire burns. A
  // required ring never drops out: it has to be taken, and pointing at it is the
  // correct answer however far past it the drone is.
  //
  // "Past" is measured against the DESTINATION, not against the drone's own
  // path: a ring is still AHEAD while it is closer to the mark than the drone
  // is, and behind the moment it is not. Measuring against the drone instead
  // would drop rings it is merely flying wide of.
  const goal = m.zones[ZONE_OF_LEG[leg]].at;
  return (
    m.route.find((c) => {
      if (c.leg !== leg || collected[c.id]) return false;
      if (c.required !== false || !from) return true;
      return flatDist({ x: c.at[0], z: c.at[2] }, goal) < flatDist(from, goal);
    }) ?? null
  );
}

/** Which mark each leg of the route is heading for. */
const ZONE_OF_LEG: Record<'toPickup' | 'toDrop' | 'toBase', MissionZoneKind> = {
  toPickup: 'pickup',
  toDrop: 'drop',
  toBase: 'base',
};

/** The same answer as a world position, for the radar and the DISTANCE
 *  readout. Null once the leg's rings are all taken, and the caller falls back
 *  to the mark itself. */
export function nextTargetOf(
  m: Mission,
  leg: 'toPickup' | 'toDrop' | 'toBase' | null,
  collected: Record<string, true>,
  from?: { x: number; z: number },
): readonly [number, number, number] | null {
  return nextCheckpointOf(m, leg, collected, from)?.at ?? null;
}

/**
 * Points available: every ring on the way out, plus the delivery and the
 * landing.
 *
 * The PICKUP scores nothing. It is not an achievement, it is the start of the
 * job — the mission has not begun until the package is on board, and a point
 * for collecting it made the score say a pilot was one sixteenth of the way
 * through a delivery they had not flown a metre of. What the score counts is
 * the rings, then putting the package down, then getting home.
 */
export function maxPointsOf(m: Mission): number {
  return m.route.length + 2;
}

/** The rating an attempt earns: the best rung it passes, or one for finishing. */
export function rankFor(ranks: readonly MissionRank[], r: MissionResult): 1 | 2 | 3 {
  for (const rank of ranks) if (rank.test(r)) return rank.stars;
  return 1;
}

/**
 * The ground height under one zone.
 *
 * The mission's own, unless the zone carries its own — which only the forest
 * needs, and only because its fire burns in a hollow twelve metres below the
 * clearing it launches from. Read through this everywhere rather than through
 * `mission.groundY` directly: a height band measured against the wrong deck is
 * a hover the pilot cannot reach, and it fails silently.
 */
export function zoneGroundY(m: Mission, zone: MissionZone): number {
  return zone.groundY ?? m.groundY;
}

/** Horizontal distance between a point and a ground mark, in metres. */
export function flatDist(p: { x: number; z: number }, at: readonly [number, number]): number {
  return Math.hypot(p.x - at[0], p.z - at[1]);
}

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
}

/** A line from Mission Control, played once when its leg begins. */
export interface RadioLine {
  /** Store key, so a line can never be played twice. */
  id: string;
  text: string;
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
  /** Environment the mission is flown in. */
  envId: string;
  /** One-line summary for the mission card. */
  blurb: string;
  /** The briefing shown before launch, as short paragraphs. */
  briefing: string[];
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
    type: 'delivery',
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
  return m.route.filter((c) => c.leg === 'toPickup' || c.leg === 'toDrop');
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
): MissionCheckpoint | null {
  if (!leg) return null;
  const required = requiredCheckpoints(m);
  return (
    m.route.find((c) => c.leg === leg && !collected[c.id] && required.some((r) => r.id === c.id)) ??
    null
  );
}

/** The same answer as a world position, for the radar and the DISTANCE
 *  readout. Null once the leg's rings are all taken, and the caller falls back
 *  to the mark itself. */
export function nextTargetOf(
  m: Mission,
  leg: 'toPickup' | 'toDrop' | 'toBase' | null,
  collected: Record<string, true>,
): readonly [number, number, number] | null {
  return nextCheckpointOf(m, leg, collected)?.at ?? null;
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

/** Horizontal distance between a point and a ground mark, in metres. */
export function flatDist(p: { x: number; z: number }, at: readonly [number, number]): number {
  return Math.hypot(p.x - at[0], p.z - at[1]);
}

import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';
import {
  CUE,
  clamp01,
  flyRoute,
  holdFor,
  horizontalDist,
  type Checkpoint,
  type LessonMemory,
  type Probe,
  type ValidationResult,
} from './types';

// ----------------------------------------------------------------------------
// A whole flight, as one validator.
//
// The stick modules hand the pilot an aircraft that is already hovering, because
// the drill is the stick and nothing else. From Straight Flight onwards the
// lesson is a FLIGHT: arm it, take off, fly the route — and, if the module asks
// for one, put it down again. A validator that only watched the route left the
// pilot to guess the two things at the start and the one at the end.
//
// WHETHER it lands, and where, is the lesson's to say. Module 8 comes home to
// the "H", which is the default. Module 7 does not land at all: it is the
// module that teaches ONE stick, the flight is over when the distance is flown,
// and a touchdown tacked onto the end is a second exercise — one Module 2 has
// already taught — standing between the pilot and the result.
//
// Both whole-flight modules get up and down on SPACE — the sequences Modules 1
// and 2 taught — so that is what this asks for. Neither shows a throttle cap:
// Module 7 is about holding a line, Module 8 about holding a ratio, and a third
// channel moving underneath either of them is a different exercise.
//
// `flyMission` walks those stages in order and, at every moment, reports one
// instruction and one control to press. The stage weights below are what the
// progress bar reads, so "half way" means half the flight, not half the route.
//
// The STEP ROW reads the same walk. A whole flight's steps are Arm, Take off,
// the legs, Land — not the checkpoints, which is what the row used to show: a
// module flown to a distance put a chip on screen saying "12 M OUT" and nothing
// saying arm or take off, so the two things the pilot had to do first were the
// two things the row never mentioned. `mem.wp` is written here, stage by stage,
// and the lesson lists those stages in `Lesson.stages`.
// ----------------------------------------------------------------------------

/** How close to the landing spot the touchdown has to be, in metres. */
const PAD_R = 1.6;
/** Landing's share of the bar, redistributed when a module does not land. */
/** Above this the drone counts as airborne and the route begins. */
const AIRBORNE_ALT = 1.2;
/** Seconds the drone must sit still on the pad before the landing counts. */
const SETTLE_SEC = 0.8;
/** Arming is refused above this throttle, so say so rather than let the pilot
 *  press ENTER at a controller that is ignoring it. */
const ARM_THROTTLE_MAX = 0.62;

/** Where the route sits in the step row: after Arm and Take off. */
const ROUTE_STEP = 2;
/** The route walks on its own cursor, because `mem.wp` is the STEP row's. */
const ROUTE_KEY = 'rt';

/** Share of the bar each stage of the flight is worth. They sum to 1. */
const W_ARM = 0.08;
const W_TAKEOFF = 0.12;
const W_ROUTE = 0.6;
const W_LAND = 0.2;

/** One leg of the route: what to say, and which control says it without words. */
export interface MissionLeg {
  /** What to tell the pilot while this leg is being flown. */
  hint: string;
  cue: readonly string[];
}

/** Where a flight ends, for the modules that end by landing. */
export interface LandingSpot {
  /** Ground position to come down on, [x, z]. */
  at: readonly [number, number];
  /** What to call it on screen, as it reads mid-sentence: 'the "H"'. */
  name: string;
}

/** The default: back on the painted "H" the flight took off from. */
export const HOME: LandingSpot = { at: ACADEMY_PAD.center, name: 'the "H"' };

/** What a whole flight does beyond arm, fly and land. */
export interface MissionOpts {
  /** Where to come down. Omitted is the "H"; `null` is a flight that ends when
   *  the route does and never lands. */
  spot?: LandingSpot | null;
  /** Reaching a LATER checkpoint first ends the attempt. The navigation modules
   *  want it — a route you are allowed to shortcut is not a route — and nothing
   *  else does, because an early corner on a shape is simply not the corner
   *  that was asked for. */
  strict?: boolean;
  /** What to say when that happens. */
  wrongHint?: string;
}

/**
 * Arm, take off, fly the route, land — on the "H" unless `spot` says otherwise.
 *
 * `spot: null` is a flight that does not land: the route IS the exercise, and it
 * is finished the moment the last checkpoint is taken. The bar then spreads the
 * landing's share across the stages that are actually flown, so a module that
 * skips it still reaches 100% instead of stopping at four fifths.
 *
 * `legs` lines up with `route` one for one. A leg the caller does not describe
 * falls back to naming its checkpoint, so a route can grow without the lesson
 * having to describe every leg twice.
 */
export function flyMission(
  p: Probe,
  mem: LessonMemory,
  route: readonly Checkpoint[],
  legs: readonly MissionLeg[],
  opts: MissionOpts = {},
): ValidationResult {
  const spot = opts.spot === undefined ? HOME : opts.spot;
  // Everything the bar has to fit into. Without a landing that is the first
  // three stages, scaled back up to a full bar.
  const scale = spot ? 1 : 1 / (W_ARM + W_TAKEOFF + W_ROUTE);
  if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };

  // Stage 1 — arm.
  if (!p.armed && !mem.wasArmed) {
    mem.wp = 0;
    if (p.throttle > ARM_THROTTLE_MAX) {
      mem.blocked = 1;
      return {
        done: false,
        progress: 0,
        hint: 'Throttle is up. Centre it first, then arm',
        cue: CUE.throttleDown,
      };
    }
    return { done: false, progress: 0, hint: 'Press ENTER to arm', cue: CUE.arm };
  }
  if (p.armed) mem.wasArmed = 1;

  // Stage 2 — take off.
  if (!mem.airborne) {
    if (p.altitude >= AIRBORNE_ALT) mem.airborne = 1;
    else {
      mem.wp = 1;
      return {
        done: false,
        progress: scale * (W_ARM + W_TAKEOFF * clamp01(p.altitude / AIRBORNE_ALT)),
        hint: 'Press SPACE to take off',
        cue: CUE.autoTakeoff,
      };
    }
  }

  // Stage 3 — the route.
  const r = flyRoute(mem, p.position, route, { key: ROUTE_KEY, strict: opts.strict });
  if (r.outOfOrder) {
    return {
      done: false,
      failed: true,
      hint: opts.wrongHint ?? 'Wrong one. Start again',
      cue: [],
    };
  }
  if (!r.complete) {
    mem.wp = ROUTE_STEP + r.next;
    const leg = legs[r.next];
    return {
      done: false,
      progress: scale * (W_ARM + W_TAKEOFF + W_ROUTE * clamp01(r.progress)),
      hint: leg?.hint ?? `Fly to ${route[r.next]?.label ?? 'the next point'}`,
      cue: leg?.cue ?? [],
    };
  }

  // The route is the whole exercise for a module that does not land.
  if (!spot) {
    mem.wp = ROUTE_STEP + route.length;
    return { done: true, progress: 1, hint: 'Distance flown. Nicely held', cue: [] };
  }

  // Stage 4 — put it down. The route is flown; this is the part the pilot has
  // to be TOLD, because nothing on screen is asking for it any more.
  mem.wp = ROUTE_STEP + route.length;
  const flown = W_ARM + W_TAKEOFF + W_ROUTE;
  const dist = horizontalDist(p.position, spot.at[0], spot.at[1]);
  const offSpot = dist > PAD_R;
  if (!p.onGround && offSpot) {
    return {
      done: false,
      progress: flown,
      hint: `Route complete. Line up over ${spot.name}`,
      cue: [],
    };
  }
  if (p.onGround && offSpot) {
    return {
      done: false,
      progress: flown,
      hint: `Down off the pad. Take off and line up on ${spot.name}`,
      cue: CUE.autoTakeoff,
    };
  }

  // Remember the hardest touchdown near the ground, for the lesson to score on.
  if (!p.onGround && p.altitude < 1.0 && p.verticalSpeed < 0) {
    mem.touchVs = Math.max(mem.touchVs ?? 0, Math.abs(p.verticalSpeed));
  }

  const settled = holdFor(
    mem,
    'settle',
    p.onGround && !offSpot && Math.abs(p.verticalSpeed) < 0.4,
    p.dt,
    SETTLE_SEC,
  );
  if (settled >= 1) {
    // How far off centre it came down, for a lesson that scores the touchdown.
    mem.finalDist = dist;
    return { done: true, progress: 1, hint: `Landed on ${spot.name}. Well flown`, cue: [] };
  }

  // The descent runs for several seconds, so it moves the bar WHILE IT RUNS
  // rather than leaving it parked at the end of the route until the wheels are
  // down. A bar that does not move while the pilot is doing the right thing
  // reads as the input having been ignored — and `Director.tickPractice` runs
  // its replay off a STALL clock, so a frozen bar is also an attempt the
  // Director believes has gone nowhere.
  mem.landTop = Math.max(mem.landTop ?? 0, p.altitude);
  const fall = clamp01(
    (mem.landTop - p.altitude) / Math.max(mem.landTop - ACADEMY_PAD.surfaceY, 0.01),
  );

  return {
    done: false,
    progress: flown + W_LAND * (p.onGround ? 0.7 + 0.3 * settled : 0.7 * fall),
    hint: p.onGround ? 'Hold it steady' : 'Distance done. Press SPACE to land',
    cue: CUE.autoLand,
  };
}

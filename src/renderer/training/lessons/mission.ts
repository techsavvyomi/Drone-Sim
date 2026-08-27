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
import { preflight, PREFLIGHT_STEPS, W_ARM, W_TAKEOFF } from './preflight';

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
/** Seconds the drone must sit still on the pad before the landing counts. */
const SETTLE_SEC = 0.8;

/** Where the route sits in the step row: after Arm and Take off. */
const ROUTE_STEP = PREFLIGHT_STEPS;
/** The route walks on its own cursor, because `mem.wp` is the STEP row's. */
const ROUTE_KEY = 'rt';

/** Share of the bar each stage of the flight is worth. They sum to 1.
 *  Arm and take-off's shares live in `preflight.ts`, which owns those stages. */
const W_ROUTE = 0.6;
const W_LAND = 0.2;
/** A stick drill's share, for `withFlight`. Same budget as a route. */
const W_DRILL = W_ROUTE;

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

  // Stages 1 and 2 — arm, then take off. Shared with every other module now
  // that they all begin on the pad; see `preflight.ts`.
  const pre = preflight(p, mem, scale);
  if (pre) return pre;

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
  return landOn(p, mem, spot, W_ARM + W_TAKEOFF + W_ROUTE, W_LAND, 'Distance done');
}

/**
 * Bring it down on `spot` — the last stage of any flight that ends on the deck.
 *
 * Shared because it is the same walk whether the flight was a route or a stick
 * drill: line up, come down, sit still. `base` is where the bar already stands
 * and `span` is what the landing is worth, so a caller can spend its own budget
 * on it. `done` is what to call the part just finished, for the hint.
 */
export function landOn(
  p: Probe,
  mem: LessonMemory,
  spot: LandingSpot,
  base: number,
  span: number,
  done = 'Route complete',
): ValidationResult {
  const flown = base;
  const dist = horizontalDist(p.position, spot.at[0], spot.at[1]);
  const offSpot = dist > PAD_R;
  if (!p.onGround && offSpot) {
    return {
      done: false,
      progress: flown,
      hint: `${done}. Line up over ${spot.name}`,
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
    return {
      done: true,
      progress: base + span,
      hint: `Landed on ${spot.name}. Well flown`,
      cue: [],
    };
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
    progress: flown + span * (p.onGround ? 0.7 + 0.3 * settled : 0.7 * fall),
    hint: p.onGround ? 'Hold it steady' : `${done}. Press SPACE to land`,
    cue: CUE.autoLand,
  };
}

/**
 * A stick drill flown as a whole flight: arm, take off, the drill, land.
 *
 * `flyMission` is this for a lesson whose middle is a ROUTE. This is the same
 * frame around a drill that is not — the throttle band, a quarter turn, a run
 * out to a marker — so Modules 3 to 6 are complete flights rather than exercises
 * suspended in mid-air. Every module already began on the pad; this is what puts
 * it back on one.
 *
 * The drill's own `done` is a LATCH, not the lesson's: once it fires the drill
 * stops being asked and the landing takes over. That is also what keeps a
 * module which treats an early touchdown as a write-off (Module 3) from failing
 * the pilot for the landing it has just been told to make.
 *
 * `drillSteps` is how many step chips the drill contributes, so the Land chip
 * can be numbered without every lesson counting its own row twice.
 */
export function withFlight(
  p: Probe,
  mem: LessonMemory,
  drill: (p: Probe, mem: LessonMemory) => ValidationResult,
  drillSteps: number,
  spot: LandingSpot = HOME,
): ValidationResult {
  if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };

  const pre = preflight(p, mem);
  if (pre) return pre;

  if (!mem.drillDone) {
    const r = drill(p, mem);
    if (typeof mem.wp === 'number') mem.wp += PREFLIGHT_STEPS;
    if (!r.done) {
      if (r.progress === undefined) return r;
      return { ...r, progress: W_ARM + W_TAKEOFF + W_DRILL * clamp01(r.progress) };
    }
    mem.drillDone = 1;
  }

  mem.wp = PREFLIGHT_STEPS + drillSteps;
  return landOn(p, mem, spot, W_ARM + W_TAKEOFF + W_DRILL, W_LAND, 'Drill done');
}

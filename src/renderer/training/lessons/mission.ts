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
// the drill is the stick and nothing else. From Straight-Line Flight onwards the
// lesson is a FLIGHT: arm it, take off, fly the route, bring it home and land.
// That is four separate things to get right, and a validator that only watched
// the route left the pilot to guess the two at the start and the one at the end.
//
// `flyMission` walks those stages in order and, at every moment, reports one
// instruction and one control to press. The stage weights below are what the
// progress bar reads, so "half way" means half the flight, not half the route.
// ----------------------------------------------------------------------------

const [PAD_X, PAD_Z] = ACADEMY_PAD.center;

/** How close to the "H" the landing has to be, in metres. */
const PAD_R = 1.6;
/** Above this the drone counts as airborne and the route begins. */
const AIRBORNE_ALT = 1.2;
/** Seconds the drone must sit still on the pad before the landing counts. */
const SETTLE_SEC = 0.8;
/** Arming is refused above this throttle, so say so rather than let the pilot
 *  press ENTER at a controller that is ignoring it. */
const ARM_THROTTLE_MAX = 0.62;

/** Share of the bar each stage of the flight is worth. They sum to 1. */
const W_ARM = 0.08;
const W_TAKEOFF = 0.12;
const W_ROUTE = 0.6;
const W_LAND = 0.2;

/** One leg of the route: what to say, and which control says it without words. */
export interface MissionLeg {
  hint: string;
  cue: readonly string[];
}

/**
 * Arm, take off, fly the route, land on the "H".
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
): ValidationResult {
  if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };

  // Stage 1 — arm.
  if (!p.armed && !mem.wasArmed) {
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
      return {
        done: false,
        progress: W_ARM + W_TAKEOFF * clamp01(p.altitude / AIRBORNE_ALT),
        hint: 'Throttle up to take off',
        cue: CUE.takeoff,
      };
    }
  }

  // Stage 3 — the route.
  const r = flyRoute(mem, p.position, route);
  if (!r.complete) {
    const leg = legs[r.next];
    return {
      done: false,
      progress: W_ARM + W_TAKEOFF + W_ROUTE * clamp01(r.progress),
      hint: leg?.hint ?? `Fly to ${route[r.next]?.label ?? 'the next point'}`,
      cue: leg?.cue ?? [],
    };
  }

  // Stage 4 — land back on the "H". The route is flown; this is the part the
  // pilot has to be TOLD, because nothing on screen is asking for it any more.
  const flown = W_ARM + W_TAKEOFF + W_ROUTE;
  const dist = horizontalDist(p.position, PAD_X, PAD_Z);
  if (!p.onGround && dist > PAD_R) {
    return {
      done: false,
      progress: flown,
      hint: 'Route complete. Fly back over the "H"',
      cue: [],
    };
  }
  if (p.onGround && dist > PAD_R) {
    return {
      done: false,
      progress: flown,
      hint: 'Down off the pad. Take off and line up on the "H"',
      cue: CUE.takeoff,
    };
  }

  // Remember the hardest touchdown near the ground, for the lesson to score on.
  if (!p.onGround && p.altitude < 1.0 && p.verticalSpeed < 0) {
    mem.touchVs = Math.max(mem.touchVs ?? 0, Math.abs(p.verticalSpeed));
  }

  const settled = holdFor(
    mem,
    'settle',
    p.onGround && dist <= PAD_R && Math.abs(p.verticalSpeed) < 0.4,
    p.dt,
    SETTLE_SEC,
  );
  if (settled >= 1) {
    mem.finalDist = dist;
    return { done: true, progress: 1, hint: 'Landed on the "H". Well flown', cue: [] };
  }

  return {
    done: false,
    progress: flown + W_LAND * settled,
    hint: p.onGround ? 'Hold it steady on the pad' : 'Now land. Ease the throttle down',
    cue: CUE.land,
  };
}

import { CUE, clamp01, type LessonMemory, type Probe, type ValidationResult } from './types';
import type { DemoStep, KeyHint, LessonStage } from './types';

// ----------------------------------------------------------------------------
// Arm, then take off — the two steps every lesson now opens with.
//
// The stick drills used to be handed an aircraft that was already hovering
// (`startAirborne`), on the reasoning that the drill is the stick and watching a
// take-off first is the previous lesson all over again. That is true of any one
// module and wrong across the syllabus: a pilot could reach Module 11 having
// pressed ENTER exactly once, in Module 1, and the two keys that begin every
// real flight were the two the course practised least.
//
// So every module is a flight now. This file is the one implementation of the
// part they share — the validator stages, the two step chips, the two keycaps
// and the two demonstration beats — so a lesson opts in by composing rather than
// by copying, and there is one place to change how arming works.
//
// `mission.ts` walks the same stages for the whole-flight modules; it calls
// `preflight` rather than keeping a second copy of it.
// ----------------------------------------------------------------------------

/** Above this the drone counts as airborne and the lesson's own drill begins. */
export const AIRBORNE_ALT = 1.2;
/**
 * Arming is refused above this throttle, so say so rather than let the pilot
 * press ENTER at a controller that is ignoring it.
 */
export const ARM_THROTTLE_MAX = 0.62;

/** How many step chips the preflight puts before a lesson's own: Arm, Take off. */
export const PREFLIGHT_STEPS = 2;

/**
 * Where a lesson that runs behind the preflight keeps its ROUTE cursor.
 *
 * Not `mem.wp`. That field is the STEP ROW's, and behind the preflight it has
 * two owners already: `preflight` writes 0 and 1 into it for Arm and Take off,
 * and `withPreflight`/`withFlight` shift whatever the drill leaves there past
 * those two steps. A route walked on the same field is therefore walked by the
 * wrapper as well — it opens at 1, because the take-off put it there, and gains
 * PREFLIGHT_STEPS more every frame — so the cursor runs off the end of the route
 * within a few frames of lift-off and the lesson scores itself complete with the
 * drone still over the "H". Modules 5, 6, 9 and 10 all did exactly that.
 *
 * The Director already reads THIS field for the route cursor on any lesson with
 * `stages`, which behind the preflight is every lesson, so it is also what walks
 * the guide's beams and lights along the route.
 */
export const ROUTE_CURSOR = 'rt';

/** Share of the progress bar each preflight stage is worth. */
export const W_ARM = 0.08;
export const W_TAKEOFF = 0.12;
/** What the preflight costs the bar in total, leaving the rest for the drill. */
export const PREFLIGHT_WEIGHT = W_ARM + W_TAKEOFF;

/** The two chips every lesson's step row opens with. */
export const PREFLIGHT_STAGES: readonly LessonStage[] = [
  { label: 'Arm', cap: 'ENTER' },
  { label: 'Take off', cap: 'SPACE' },
];

/**
 * The two caps a lesson's keycap row opens with when the flight does not land.
 *
 * SPACE reads "Take Off" rather than "Take Off / Land" there: naming a step the
 * lesson never asks for is how a pilot ends up looking for it.
 */
export const PREFLIGHT_KEYS: readonly KeyHint[] = [
  { code: 'Enter', label: 'ENTER', hint: 'Arm' },
  { code: 'Space', label: 'SPACE', hint: 'Take Off' },
];

/** ...and when it does. The same two keys, doing both halves of their job. */
export const FLIGHT_KEYS: readonly KeyHint[] = [
  { code: 'Enter', label: 'ENTER', hint: 'Arm' },
  { code: 'Space', label: 'SPACE', hint: 'Take Off / Land' },
];

/** The chip that closes a flight that comes back down. */
export const LAND_STAGE: LessonStage = { label: 'Land', cap: 'SPACE' };

// ----------------------------------------------------------------------------
// The four control pairs, named once.
//
// A module keeps every control the modules before it taught: Module 4 flies yaw
// AND still has the throttle, Module 6 has all four pairs. A pilot who has been
// shown a control does not un-learn it at the next lesson, and a row that takes
// keys away reads as the aircraft having lost them.
//
// Each lesson lists its OWN pair first and the inherited ones behind, so the row
// answers "what is today about" before it answers "what else can I do".
// ----------------------------------------------------------------------------

export const KEYS_THROTTLE: readonly KeyHint[] = [
  { code: 'KeyS', label: 'S', hint: 'Throttle Down' },
  { code: 'KeyW', label: 'W', hint: 'Throttle Up' },
];

export const KEYS_YAW: readonly KeyHint[] = [
  { code: 'KeyA', label: 'A', hint: 'Yaw Left' },
  { code: 'KeyD', label: 'D', hint: 'Yaw Right' },
];

export const KEYS_PITCH: readonly KeyHint[] = [
  { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
  { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
];

export const KEYS_ROLL: readonly KeyHint[] = [
  { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
  { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
];

/**
 * Arm and take off, as validator stages.
 *
 * Returns a result while the drone is still on the pad or climbing, and `null`
 * once it is airborne and the lesson's own drill can begin. `scale` compresses
 * the progress it reports, for a caller whose bar has to fit more in.
 *
 * `mem.wasArmed` and `mem.airborne` are the latches, and they are the same two
 * `flyMission` uses — a lesson that reads `mem.airborne` afterwards (to tell a
 * touchdown from the moment before lift-off) is reading the flag this set.
 */
export function preflight(p: Probe, mem: LessonMemory, scale = 1): ValidationResult | null {
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
    if (p.altitude >= AIRBORNE_ALT) {
      mem.airborne = 1;
    } else {
      mem.wp = 1;
      return {
        done: false,
        progress: scale * (W_ARM + W_TAKEOFF * clamp01(p.altitude / AIRBORNE_ALT)),
        hint: 'Press SPACE to take off',
        cue: CUE.autoTakeoff,
      };
    }
  }

  return null;
}

/**
 * Run a lesson's own drill behind the preflight.
 *
 * Arm and take off first, then `drill` — whose result is shifted into the band
 * the preflight left: its step numbers move past Arm and Take off, and its
 * progress is squeezed into the top of the bar so "half way" still means half
 * the flight rather than half the drill.
 *
 * A CRASH is not checked here, and no validator checks it any more. A wreck ends
 * the attempt on every module alike, so the Director decides it before a lesson
 * is asked anything — see `tickPractice`. Fourteen copies of one rule is a rule
 * that gets missed, and it was: Modules 7 and 8 never had theirs.
 *
 * A drill that reports no progress at all (an early-out failure) is left alone;
 * rescaling `undefined` would put the bar back at the take-off.
 */
export function withPreflight(
  p: Probe,
  mem: LessonMemory,
  drill: (p: Probe, mem: LessonMemory) => ValidationResult,
): ValidationResult {
  const pre = preflight(p, mem);
  if (pre) return pre;

  const r = drill(p, mem);
  if (typeof mem.wp === 'number') mem.wp += PREFLIGHT_STEPS;
  if (r.progress === undefined) return r;
  return { ...r, progress: PREFLIGHT_WEIGHT + (1 - PREFLIGHT_WEIGHT) * clamp01(r.progress) };
}

/**
 * The demonstration's own arm and take-off, and what they cost the clock.
 *
 * Each gets its own beat: fired together — which is what the whole-flight demos
 * used to do at t = 0 — the drone is in the air before a single key has been
 * shown being pressed.
 */
export const ARM_AT = 1.2;
export const TAKEOFF_AT = 4.0;
/** When the drill's own first beat may start, so the climb has finished. */
export const PREFLIGHT_DEMO_SEC = TAKEOFF_AT + 1.6;

/** The two opening beats of every demonstration. */
export function preflightDemo(climbCaption = 'SPACE: it climbs to a hover on its own'): DemoStep[] {
  return [
    { at: 0.0, caption: 'On the pad, motors off' },
    {
      at: ARM_AT,
      stage: 0,
      cmd: 'arm',
      key: 'Enter',
      caption: 'ENTER: armed and live, still on the ground',
    },
    { at: TAKEOFF_AT, stage: 1, cmd: 'takeoffLand', key: 'Space', caption: climbCaption },
  ];
}

/**
 * Move a planned demonstration in behind the preflight.
 *
 * Both axes shift: the clock, so the drill starts once the drone is at its
 * hover, and the step numbers, so the row lights the drill's steps rather than
 * Arm and Take off a second time. `planDemo` already solves the flight itself,
 * so nothing here touches the sticks.
 */
export function afterPreflightDemo(steps: readonly DemoStep[]): DemoStep[] {
  return steps.map((s) => ({
    ...s,
    at: s.at + PREFLIGHT_DEMO_SEC,
    ...(s.stage !== undefined && { stage: s.stage + PREFLIGHT_STEPS }),
    ...(s.rt !== undefined && { rt: s.rt }),
  }));
}

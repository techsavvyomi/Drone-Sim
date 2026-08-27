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
 * The two caps every lesson's keycap row opens with.
 *
 * SPACE reads "Take Off" rather than "Take Off / Land" on a module that does not
 * land: naming a step the lesson never asks for is how a pilot ends up looking
 * for it. The whole-flight modules write their own pair.
 */
export const PREFLIGHT_KEYS: readonly KeyHint[] = [
  { code: 'Enter', label: 'ENTER', hint: 'Arm' },
  { code: 'Space', label: 'SPACE', hint: 'Take Off' },
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
 * The crash check comes first, then arm and take off, then `drill` — whose
 * result is shifted into the band the preflight left: its step numbers move past
 * Arm and Take off, and its progress is squeezed into the top of the bar so
 * "half way" still means half the flight rather than half the drill.
 *
 * A drill that reports no progress at all (an early-out failure) is left alone;
 * rescaling `undefined` would put the bar back at the take-off.
 */
export function withPreflight(
  p: Probe,
  mem: LessonMemory,
  drill: (p: Probe, mem: LessonMemory) => ValidationResult,
): ValidationResult {
  if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };

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
export function preflightDemo(
  climbCaption = 'SPACE — it climbs to a hover on its own',
): DemoStep[] {
  return [
    { at: 0.0, caption: 'On the pad, motors off' },
    {
      at: ARM_AT,
      stage: 0,
      cmd: 'arm',
      key: 'Enter',
      caption: 'ENTER — armed and live, still on the ground',
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

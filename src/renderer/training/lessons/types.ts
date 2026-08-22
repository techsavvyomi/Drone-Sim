import type { StickInput, Vec3 } from '@shared/types';
import type { DroneStatus } from '../../state/flightStore';

// ----------------------------------------------------------------------------
// Pluto Flight School — lesson content model.
//
// A lesson is pure data + pure functions. It never touches the engine directly:
// it declares a demonstration timeline, a per-frame validator, an optional 3D
// scene and a scorer. The generic Director (../Director.tsx) runs any lesson
// through Explain -> Demonstrate -> Practice -> Validate -> Reward.
// ----------------------------------------------------------------------------

/** A live snapshot handed to a validator each frame during Practice. */
export interface Probe {
  armed: boolean;
  onGround: boolean;
  crashed: boolean;
  status: DroneStatus;
  altitude: number;
  position: Vec3;
  /** Heading in radians (sim yaw). */
  yaw: number;
  verticalSpeed: number;
  groundSpeed: number;
  roll: number;
  pitch: number;
  /** Throttle stick position 0..1 (0.5 = centre in altitude-managed modes). */
  throttle: number;
  /** This frame's delta time, seconds. */
  dt: number;
  /** Seconds elapsed since the Practice phase began. */
  elapsed: number;
}

export type DemoCommand = 'arm' | 'disarm' | 'takeoffLand';

/** One keyframe of a scripted demonstration, timed from the demo's start. */
export interface DemoStep {
  /** Seconds from the start of the demo at which to apply this step. */
  at: number;
  /** Discrete command to issue (arm/disarm/take-off-land). */
  cmd?: DemoCommand;
  /** Stick channels to set (unset channels keep their current value). */
  stick?: Partial<StickInput>;
  /** Caption shown in the demo banner while this step is the latest applied. */
  caption?: string;
  /** KeyboardEvent.code to flash on the keycap row while this step plays. */
  key?: string;
  /** Turn to this heading, in radians, and HOLD it — `null` releases the yaw.
   *
   *  The only closed-loop channel in a demonstration, and it has to be. Every
   *  other channel is open-loop by design: a leg that lands a metre off still
   *  looks like the manoeuvre it is teaching. A turn that lands ten degrees off
   *  does not — the heading is the frame the next leg's sticks are computed in,
   *  so the error does not stay in the turn, it rotates the whole rest of the
   *  route. Timed yaw holds got this right on some runs and not others; the
   *  Director drives this one from the drone's real heading instead. */
  yawTo?: number | null;
}

/** A keycap shown under the flight view, highlighted while its key is active. */
export interface KeyHint {
  /** KeyboardEvent.code, e.g. 'Enter', 'KeyW', 'Space'. */
  code: string;
  /** Short face label, e.g. 'ENTER', 'W', 'SPACE'. */
  label: string;
  /** What the key does in this lesson. */
  hint: string;
}

/** What a validator returns each frame. */
export interface ValidationResult {
  /** The success condition is fully met — advance to Reward. */
  done: boolean;
  /** A hard failure (crash, out of bounds) — surface "Try Again". */
  failed?: boolean;
  /** 0..1 completion for the on-screen progress bar. */
  progress?: number;
  /** Contextual guidance to show right now (e.g. "Hold this altitude"). */
  hint?: string;
}

/** Mutable per-attempt scratch pad for validators (hold timers, accumulators). */
export type LessonMemory = Record<string, number>;

/** Standard performance metrics the Director collects for scoring. */
export interface ScoreInput {
  /** Seconds taken to satisfy the lesson. */
  timeSec: number;
  /** Collisions/crashes during the attempt. */
  collisions: number;
  /** Control smoothness 0..1 (1 = very smooth), from stick jerk. */
  smoothness: number;
  /** The same scratch pad the validator wrote to — for lesson-specific scoring. */
  mem: LessonMemory;
}

export type Stars = 1 | 2 | 3;

/** How the route guide draws a highlight over the arena object it names. */
export type MarkKind = 'gate' | 'pad' | 'marker' | 'helipad';

/**
 * One point in the ACADEMY ARENA that a lesson sends the pilot to.
 *
 * A checkpoint never creates scenery. It names something already standing in
 * the arena — a racing gate, a painted landing pad, one of the white markers
 * ringing the helipad — and the guide puts a highlight on THAT. Lessons used to
 * draw their own rings and pylons a few metres from the "H"; the pilot then
 * learned an arena that does not exist outside the lesson.
 *
 * The same list drives all three things that have to agree: what the validator
 * accepts, what the demonstration flies, and what is lit up on screen.
 */
export interface Checkpoint {
  /** Shown in the HUD as the target: 'A', 'B', 'blue gate'... */
  label: string;
  /** World position of the point to reach — for a gate, the centre of its
   *  opening, so "reached it" and "flew through it" are the same test. */
  at: readonly [number, number, number];
  /** How close counts, in metres, measured in 3-D. */
  reach: number;
  /** Which arena object this is, so the guide draws the right highlight. */
  mark: MarkKind;
  /** Size of that object — a gate's opening, a pad's painted radius. */
  markSize?: number;
  /** Accent for the highlight; defaults to the object's own colour. */
  color?: string;
  /** For a gate: the unit direction THROUGH its opening, in world space.
   *
   *  A gate is not a place to arrive at, it is a hole to pass through, and a
   *  demonstration that brakes on the centre point stops inside the frame. With
   *  an axis the planner can line the drone up in front of the gate and carry it
   *  out the far side — the flight the lesson is actually asking for. */
  axis?: readonly [number, number, number];
}

export interface Lesson {
  id: string;
  /** 1-based position in the curriculum; also drives unlock order. */
  order: number;
  title: string;
  subtitle: string;

  /** Step 1 — Introduction. */
  explain: { title: string; body: string[]; durationHint?: string };

  /** Step 2 — Demonstration timeline (scripted autopilot). */
  demo: DemoStep[];

  /** Step 3 — Practice prompt + a default standing hint. */
  practice: { prompt: string; hint: string };

  /** The arena checkpoints this lesson flies, in order.
   *
   *  Drives the validator, the demonstration and the on-screen highlight from
   *  one list, so the demo cannot show a route the attempt does not ask for. */
  route?: readonly Checkpoint[];

  /** 💡 Pilot tips — best-practice pointers, shown on the intro card. */
  tips?: string[];
  /** ⚠ Common mistakes beginners make, shown on the intro card. */
  commonMistakes?: string[];

  /** Keycaps to show under the flight view for this lesson's controls. */
  keys?: KeyHint[];

  /** Step 4 — Validation, evaluated every frame during Practice. */
  validate: (p: Probe, mem: LessonMemory) => ValidationResult;

  /** Step 5 — Reward: turn performance into a 1..3 star rating. */
  score: (input: ScoreInput) => Stars;

  /** Optional setup run once when the lesson starts (e.g. pre-arm the drone). */
  setup?: () => void;

  /** Seconds of *no progress* before the demo auto-replays (default 45). The
   *  clock restarts whenever the attempt gets closer to the goal, so this is a
   *  stall timeout, not a time limit on the lesson. */
  practiceTimeout?: number;
}

// ---- Small validator helpers ------------------------------------------------

/** Clamp to 0..1. Progress bars read straight off this, and an un-clamped
 *  "1 - distance/span" goes negative the moment the drone is further out than
 *  the span, which the HUD then renders as a negative percentage. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Track "condition held continuously for `seconds`". Returns the held fraction
 * 0..1; reaching 1 means the hold is complete. Uses `mem[key]` as the timer.
 */
export function holdFor(
  mem: LessonMemory,
  key: string,
  condition: boolean,
  dt: number,
  seconds: number,
): number {
  const t = (mem[key] ?? 0) + (condition ? dt : -dt * 2);
  mem[key] = Math.max(0, Math.min(seconds, t));
  return mem[key] / seconds;
}

/**
 * Once true, stays true for the rest of the attempt.
 *
 * A validator that reports `done` from a live check — "am I within 1.3 m of the
 * marker *right now*" — flickers: the drone arrives, one frame says done, and a
 * hand's width of drift says not-done again. The Director needs the success to
 * hold continuously for over a second before it awards the lesson, so an attempt
 * that visibly reached the target could run out of time having never finished.
 * `flyRoute` latches its checkpoints for the same reason; this is the same rule
 * for the lessons judged on a held condition rather than on a route.
 */
export function latch(mem: LessonMemory, key: string, condition: boolean): boolean {
  if (condition) mem[key] = 1;
  return mem[key] === 1;
}

/** Straight-line distance from the drone to a world point, height included. */
export function dist3(position: Vec3, at: readonly [number, number, number]): number {
  return Math.hypot(position[0] - at[0], position[1] - at[1], position[2] - at[2]);
}

/** What `flyRoute` saw this frame. */
export interface RouteState {
  /** Index of the checkpoint being flown to now. */
  next: number;
  /** Every checkpoint has been taken, in order. */
  complete: boolean;
  /** A LATER checkpoint was reached first — the route was cut. */
  outOfOrder: boolean;
  /** Distance to the current target. */
  distance: number;
  /** 0..1 across the whole route, counting part-way along the current leg. */
  progress: number;
}

/**
 * Walk a lesson's checkpoints in order.
 *
 * The one route walker for every lesson that has a route. It replaced an XZ-only
 * pair of walkers once checkpoints became arena gates with a height, rather
 * than marks drawn on the floor beside the pad. Arrival LATCHES: passing through a gate
 * at speed counts, and the success cannot then be lost to the drift on the far
 * side.
 *
 * `strict` reports reaching a LATER checkpoint first as `outOfOrder`, so a
 * navigation lesson can end the attempt; without it an early corner is simply
 * not the corner that was asked for, and is ignored.
 */
export function flyRoute(
  mem: LessonMemory,
  position: Vec3,
  route: readonly Checkpoint[],
  opts: { strict?: boolean; spread?: number } = {},
): RouteState {
  const next = mem.wp ?? 0;
  if (next >= route.length) {
    return { next: route.length, complete: true, outOfOrder: false, distance: 0, progress: 1 };
  }

  const target = route[next];
  const distance = dist3(position, target.at);
  if (distance < target.reach) {
    mem.wp = next + 1;
    const done = next + 1;
    return {
      next: done,
      complete: done >= route.length,
      outOfOrder: false,
      distance: 0,
      progress: done / route.length,
    };
  }

  if (opts.strict) {
    // A later checkpoint only counts as CUT once the drone has actually been
    // clear of it. Without that guard a route which finishes where it starts —
    // Module 13 ends back over the "H" it took off from — fails on its very
    // first frame, before the pilot has moved.
    let left = mem.left ?? 0;
    for (let j = next + 1; j < route.length; j++) {
      const bit = 1 << j;
      const away = dist3(position, route[j].at);
      if (away >= route[j].reach * 1.6) left |= bit;
      else if (left & bit) {
        mem.left = left;
        return { next, complete: false, outOfOrder: true, distance, progress: next / route.length };
      }
    }
    mem.left = left;
  }

  // How far along this leg, measured against the spread the lesson expects
  // rather than the leg's true length: a bar that only moves in the last two
  // metres of a forty-metre leg reads as a lesson that is not responding.
  const spread = opts.spread ?? 14;
  const leg = Math.max(0, Math.min(1, 1 - (distance - target.reach) / spread));
  return {
    next,
    complete: false,
    outOfOrder: false,
    distance,
    progress: (next + leg) / route.length,
  };
}

/** Horizontal distance from a world position to a world XZ point. */
export function horizontalDist(position: Vec3, x: number, z: number): number {
  return Math.hypot(position[0] - x, position[2] - z);
}

/**
 * How far the drone has strayed sideways from the straight line A->B, in metres.
 * Shape lessons score on this: reaching the corners is the task, holding the
 * line between them is the skill.
 */
export function lineDeviation(
  position: Vec3,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return horizontalDist(position, ax, az);
  // Perpendicular distance from the point to the infinite line through A and B.
  return Math.abs((position[0] - ax) * dz - (position[2] - az) * dx) / len;
}

/** Smallest signed difference a-b between two angles (radians), in degrees. */
export function angleDiffDeg(a: number, b: number): number {
  let d = ((a - b) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

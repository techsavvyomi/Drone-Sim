import type { FC } from 'react';
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

  /** Keycaps to show under the flight view for this lesson's controls. */
  keys?: KeyHint[];

  /** Step 4 — Validation, evaluated every frame during Practice. */
  validate: (p: Probe, mem: LessonMemory) => ValidationResult;

  /** Step 5 — Reward: turn performance into a 1..3 star rating. */
  score: (input: ScoreInput) => Stars;

  /** Optional lesson-specific 3D props, rendered inside the training Canvas. */
  Scene?: FC;

  /** Optional setup run once when the lesson starts (e.g. pre-arm the drone). */
  setup?: () => void;

  /** Seconds of failing/idle practice before the demo auto-replays (default 20). */
  practiceTimeout?: number;
}

// ---- Small validator helpers ------------------------------------------------

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

/** Horizontal distance from a world position to a world XZ point. */
export function horizontalDist(position: Vec3, x: number, z: number): number {
  return Math.hypot(position[0] - x, position[2] - z);
}

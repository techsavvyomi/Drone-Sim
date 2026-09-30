import type { Lesson } from './lessons/types';
import { ACADEMY_PAD } from '../plugins/environments/droneAcademy';

// The lesson's flight clock and the box it is kept in (Phase 4 brief: "the
// practice timer starts at take-off, not on load, and pauses while the drone is
// outside the box").
//
// It is the time the stars are judged on. It is NOT the validators' clock:
// `Probe.elapsed` still runs from the start of practice, because Land & Disarm
// times its shutdown on it and the stall rescue has to count a pilot sitting on
// the pad. Pure, and allocation-free per tick — the Director calls it every frame.

/** Metres of room around the furthest point of the exercise. */
export const BOX_MARGIN_M = 5;
/** Smallest half-size of the box around the pad, metres — the on-the-spot
 *  modules have no route beyond the "H", and the pad itself is 7 m across. */
export const BOX_MIN_HALF_M = 9;

/** Where the lesson is flown, from above: world X and Z, metres. */
export interface LessonBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The helipad, every checkpoint and the lap ring, with room around them. */
export function lessonBox(lesson: Lesson): LessonBox {
  const [px, pz] = ACADEMY_PAD.center;
  // Around the pad before the margin: the lap ring, or enough that the margin
  // takes it to the minimum half-size.
  const core = Math.max(lesson.guideRing?.radius ?? 0, BOX_MIN_HALF_M - BOX_MARGIN_M);
  let minX = px - core;
  let maxX = px + core;
  let minZ = pz - core;
  let maxZ = pz + core;
  for (const c of lesson.route ?? []) {
    minX = Math.min(minX, c.at[0]);
    maxX = Math.max(maxX, c.at[0]);
    minZ = Math.min(minZ, c.at[2]);
    maxZ = Math.max(maxZ, c.at[2]);
  }
  return {
    minX: minX - BOX_MARGIN_M,
    maxX: maxX + BOX_MARGIN_M,
    minZ: minZ - BOX_MARGIN_M,
    maxZ: maxZ + BOX_MARGIN_M,
  };
}

export function insideBox(box: LessonBox, x: number, z: number): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
}

/** waiting = not yet off the ground this attempt; running; paused = outside the box. */
export type ClockState = 'waiting' | 'running' | 'paused';

export interface FlightClock {
  state: ClockState;
  seconds: number;
}

export function newFlightClock(): FlightClock {
  return { state: 'waiting', seconds: 0 };
}

export function resetFlightClock(c: FlightClock): void {
  c.state = 'waiting';
  c.seconds = 0;
}

/**
 * Whether the drone counts as flying, for the clock's take-off latch: armed AND
 * off the ground. Off the ground alone is not enough — as practice opens after
 * the demonstration the drone is put back on the pad, and for a frame or two
 * `onGround` still holds the demo's "in the air". The clock latched on that and
 * timed a drone that had not even been armed (found flying Module 3, 2026-09-30).
 */
export function isAirborne(armed: boolean, onGround: boolean): boolean {
  return armed && !onGround;
}

/** One frame. Take-off latches: a landing later in the attempt does not stop the
 *  clock (the landing is part of the flight), only leaving the box does. */
export function tickFlightClock(
  c: FlightClock,
  airborne: boolean,
  inside: boolean,
  dt: number,
): void {
  if (c.state === 'waiting' && !airborne) return;
  c.state = inside ? 'running' : 'paused';
  if (inside) c.seconds += dt;
}

import type { Lesson } from './types';
import { armTakeoffLesson } from './armTakeoff';
import { landDisarmLesson } from './landDisarm';
import { throttleLesson } from './throttle';
import { pitchLesson } from './pitch';
import { rollLesson } from './roll';
import { yawLesson } from './yaw';
import { straightLineLesson } from './straightLine';
import { diagonalLesson } from './diagonal';
import { squareLesson } from './square';
import { triangleLesson } from './triangle';
import { circleLesson } from './circle';
import { navABLesson, navABCLesson, navABCDLesson } from './navRoutes';

// The Flight School curriculum, in order. Adding a lesson is a one-line push
// here plus its data file — the Director, HUD and lesson-select UI are generic.
//
// The syllabus runs as one progression:
//   1-2    Arm & Take Off, Land & Disarm — the two ends of a flight
//   3-5    one control at a time         — throttle, pitch, roll
//   6-7    whole flights                 — arm, take off, fly a line, land
//   8-10   Formation                     — closed shapes flown as one route
//   11-13  Navigation                    — set routes through gates, in order
//   14     Yaw                           — turning on the spot
//
// Landing sits SECOND, not last. It used to close the course, on the reasoning
// that you only need it once the flight is over; in practice a student who has
// taken off has to get down again in the very next minute, so the two belong
// together at the front.
//
// Arm/Takeoff and Landing/Disarm are each taught as one action: arming alone
// shows nothing (the motors stay stopped until the throttle moves) and a
// landing is not finished until the motors are off.
//
// Pitch + Roll was retired here — Diagonal Run (7) teaches the same "both
// sticks together" idea over a longer run and with a landing at the end. It is
// in git history if the syllabus ever wants it back.
export const LESSONS: Lesson[] = [
  armTakeoffLesson,
  landDisarmLesson,
  throttleLesson,
  pitchLesson,
  rollLesson,
  straightLineLesson,
  diagonalLesson,
  squareLesson,
  triangleLesson,
  circleLesson,
  navABLesson,
  navABCLesson,
  navABCDLesson,
  yawLesson,
].sort((a, b) => a.order - b.order);

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function lessonIndex(id: string): number {
  return LESSONS.findIndex((l) => l.id === id);
}

/** The lesson after `id`, or undefined if it was the last. */
export function nextLesson(id: string): Lesson | undefined {
  const i = lessonIndex(id);
  return i >= 0 ? LESSONS[i + 1] : undefined;
}

export type { Lesson } from './types';

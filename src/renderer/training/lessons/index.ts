import type { Lesson } from './types';
import { armTakeoffLesson } from './armTakeoff';
import { landDisarmLesson } from './landDisarm';
import { pitchLesson } from './pitch';
import { rollLesson } from './roll';
import { yawLesson } from './yaw';
import { pitchRollLesson } from './pitchRoll';
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
//   1      Arm & Take Off      — get airborne
//   2-7    each stick alone, then together, then held along a line
//   8-10   Formation           — closed shapes flown as one continuous route
//   11-13  Navigation          — set routes through gates, checked for order
//   14     Land & Disarm       — bring it home and shut it down
//
// Landing sits LAST on purpose. It reads like a step-two skill, but it is the
// one thing you only need once the flight is over, and it is the natural close
// to the course rather than a detour two lessons in.
//
// Arm/Takeoff and Landing/Disarm used to be four separate lessons. They were
// merged because arming on its own no longer shows anything — the motors stay
// stopped until the throttle moves — and a landing is not finished until the
// motors are off. The old `arm`, `takeoff`, `landing`, `disarm`, `throttle` and
// `hover` lessons were retired with them; they are in git history if the
// syllabus ever wants them back.
export const LESSONS: Lesson[] = [
  armTakeoffLesson,
  pitchLesson,
  rollLesson,
  yawLesson,
  pitchRollLesson,
  straightLineLesson,
  diagonalLesson,
  squareLesson,
  triangleLesson,
  circleLesson,
  navABLesson,
  navABCLesson,
  navABCDLesson,
  landDisarmLesson,
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

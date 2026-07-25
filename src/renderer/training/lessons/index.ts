import type { Lesson } from './types';
import { armLesson } from './arm';
import { disarmLesson } from './disarm';
import { takeoffLesson } from './takeoff';
import { throttleLesson } from './throttle';
import { yawLesson } from './yaw';
import { pitchLesson } from './pitch';
import { rollLesson } from './roll';
import { hoverLesson } from './hover';
import { landingLesson } from './landing';

// The Flight School curriculum, in order. Adding a lesson is a one-line push
// here plus its data file — the Director, HUD and lesson-select UI are generic.
export const LESSONS: Lesson[] = [
  armLesson,
  disarmLesson,
  takeoffLesson,
  throttleLesson,
  yawLesson,
  pitchLesson,
  rollLesson,
  hoverLesson,
  landingLesson,
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

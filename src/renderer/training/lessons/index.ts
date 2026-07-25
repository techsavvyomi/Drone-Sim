import type { Lesson } from './types';
import { armLesson } from './arm';
import { disarmLesson } from './disarm';
import { throttleLesson } from './throttle';
import { landingLesson } from './landing';

// The Flight School curriculum, in order. Adding a lesson is a one-line push
// here plus its data file — the Director, HUD and lesson-select UI are generic.
export const LESSONS: Lesson[] = [armLesson, disarmLesson, throttleLesson, landingLesson].sort(
  (a, b) => a.order - b.order,
);

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

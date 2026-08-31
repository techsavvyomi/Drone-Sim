import { describe, expect, it } from 'vitest';
import { LESSONS, getLesson, lessonIndex, nextLesson } from '../src/renderer/training/lessons';

// The shape of the syllabus itself. These guard the data, not the flying: a
// duplicate id or a gap in `order` breaks unlocking silently, and the lesson
// list is the one place the whole course is described.

describe('the curriculum', () => {
  it('TC-128 the course is fourteen modules', () => {
    expect(LESSONS).toHaveLength(14);
  });

  it('TC-128 order values are unique and run 1 to 14 with no gaps', () => {
    // invariants #25: the array is SORTED on `order`, so moving a lesson is a
    // one-number edit in its own file. A duplicate would make the order
    // arbitrary and a gap would mean a lesson was lost from the import list.
    const orders = LESSONS.map((l) => l.order);

    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
    expect(orders).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
  });

  it('TC-128 every id is unique', () => {
    const ids = LESSONS.map((l) => l.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('TC-128 every module has the text the intro card needs', () => {
    for (const l of LESSONS) {
      expect(l.title, l.id).toBeTruthy();
      expect(l.subtitle, l.id).toBeTruthy();
      expect(l.explain.title, l.id).toBeTruthy();
      expect(l.explain.body.length, l.id).toBeGreaterThan(0);
      expect(l.practice.prompt, l.id).toBeTruthy();
      expect(l.practice.hint, l.id).toBeTruthy();
    }
  });

  it('TC-159 every module puts a keycap row on screen', () => {
    // invariants #41: the row is what the pilot HAS, not just what the drill
    // names, so a module with no keys at all is the bug coming back.
    for (const l of LESSONS) {
      expect(l.keys?.length, l.id).toBeGreaterThan(0);
      for (const k of l.keys ?? []) {
        expect(k.code, l.id).toBeTruthy();
        expect(k.label, l.id).toBeTruthy();
        expect(k.hint, l.id).toBeTruthy();
      }
    }
  });

  it('TC-159 every module offers Enter and Space, because every module is flown from the pad', () => {
    // invariants #40: `startAirborne` is gone. Every module arms and takes off.
    for (const l of LESSONS) {
      const codes = (l.keys ?? []).map((k) => k.code);
      expect(codes, l.id).toContain('Enter');
      expect(codes, l.id).toContain('Space');
    }
  });

  it('TC-128 every module has a demonstration to play', () => {
    for (const l of LESSONS) {
      expect(l.demo.length, l.id).toBeGreaterThan(0);
      // A demo's beats must be in time order or the Director drains them wrongly.
      const times = l.demo.map((s) => s.at);
      expect(times, l.id).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it('TC-146 the stall timeout is a real number of seconds where a module sets one', () => {
    // invariants #27: this is a STALL timeout, not a time limit. The old 20 s
    // default made the long modules impossible.
    for (const l of LESSONS) {
      if (l.practiceTimeout === undefined) continue;
      expect(l.practiceTimeout, l.id).toBeGreaterThanOrEqual(30);
    }
  });

  it('TC-131 lookup, index and next walk the course in order', () => {
    expect(getLesson(LESSONS[0].id)).toBe(LESSONS[0]);
    expect(getLesson('no-such-lesson')).toBeUndefined();
    expect(lessonIndex(LESSONS[3].id)).toBe(3);
    expect(nextLesson(LESSONS[0].id)).toBe(LESSONS[1]);
    // The last module has nothing after it.
    expect(nextLesson(LESSONS[13].id)).toBeUndefined();
  });
});

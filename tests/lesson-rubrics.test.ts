import { describe, expect, it } from 'vitest';
import { LESSONS } from '../src/renderer/training/lessons';
import { starsFor, type ScoreInput } from '../src/renderer/training/lessons/types';

// Star rubrics. Each rung carries its promise text and its test in the SAME
// object so the card cannot promise a standard the module does not award
// (invariants #31's cousin). These tests hold the rules that apply to every
// module, whatever its own drill is.

/** An attempt so good that only a lesson-specific `mem` requirement can fail it. */
function perfect(over: Partial<ScoreInput> = {}): ScoreInput {
  return {
    timeSec: 1,
    collisions: 0,
    touches: 0,
    smoothness: 1,
    // Generous values for every scratch-pad field any rubric reads, so the
    // only thing these tests vary is the flight quality itself.
    mem: { altDev: 0, dev: 0, radiusDev: 0, sideDev: 0, headingErr: 0, lap: 1 },
    ...over,
  };
}

describe('every module', () => {
  it('TC-142 offers a three-star rung and a two-star rung, best first', () => {
    for (const l of LESSONS) {
      expect(l.stars.length, l.id).toBeGreaterThanOrEqual(2);
      // Best rung first: starsFor returns the first rule that passes, so a
      // rubric listed the other way round would hand out two stars for a
      // three-star flight.
      expect(l.stars[0].stars, l.id).toBe(3);
      expect(l.stars[1].stars, l.id).toBe(2);
    }
  });

  it('TC-142 words every rung in the pilot own terms', () => {
    for (const l of LESSONS) {
      for (const rule of l.stars) {
        expect(rule.text, l.id).toBeTruthy();
        expect(rule.text.length, l.id).toBeGreaterThan(8);
      }
    }
  });

  it('TC-151 caps a crashed attempt at one star', () => {
    // A crash ends the attempt on every module (invariants: the Director owns
    // this), and no rubric may award more than the finishing star for one.
    for (const l of LESSONS) {
      expect(starsFor(l.stars, perfect({ collisions: 1 })), l.id).toBe(1);
    }
  });

  it('TC-152 refuses three stars to a flight that touched something', () => {
    // invariants #40: clean counts TOUCHES, not crashes. Every top rung asks
    // for zero, because scraping a gate upright used to cost nothing at all.
    for (const l of LESSONS) {
      expect(l.stars[0].test(perfect({ touches: 1 })), l.id).toBe(false);
      // ...and the promise has to say so, or the words and the test have drifted.
      expect(l.stars[0].text.toLowerCase(), l.id).toContain('nothing touched');
    }
  });

  it('TC-142 refuses three stars to an attempt that took far too long', () => {
    for (const l of LESSONS) {
      expect(l.stars[0].test(perfect({ timeSec: 10_000 })), l.id).toBe(false);
    }
  });

  it('TC-142 awards one star for finishing when no rung is met', () => {
    for (const l of LESSONS) {
      const awful: ScoreInput = {
        timeSec: 10_000,
        collisions: 3,
        touches: 9,
        smoothness: 0,
        mem: { altDev: 99, dev: 99, radiusDev: 99, sideDev: 99, headingErr: 99 },
      };
      expect(starsFor(l.stars, awful), l.id).toBe(1);
    }
  });

  it('TC-142 never returns a value outside one to three', () => {
    for (const l of LESSONS) {
      for (const input of [perfect(), perfect({ touches: 1 }), perfect({ collisions: 1 })]) {
        const stars = starsFor(l.stars, input);
        expect([1, 2, 3], l.id).toContain(stars);
      }
    }
  });

  it('TC-142 a rubric test never throws on an empty scratch pad', () => {
    // A validator that never ran leaves `mem` empty; scoring must still answer.
    for (const l of LESSONS) {
      for (const rule of l.stars) {
        expect(() => rule.test({ timeSec: 5, collisions: 0, touches: 0, smoothness: 1, mem: {} }),
          `${l.id} / ${rule.stars} stars`).not.toThrow();
      }
    }
  });
});

describe('starsFor', () => {
  it('TC-142 takes the best rung the attempt passes', () => {
    const rules = [
      { stars: 3 as const, text: 'three', test: () => false },
      { stars: 2 as const, text: 'two', test: () => true },
    ];

    expect(starsFor(rules, perfect())).toBe(2);
  });

  it('TC-142 falls back to one star when nothing passes', () => {
    const rules = [{ stars: 3 as const, text: 'three', test: () => false }];

    expect(starsFor(rules, perfect())).toBe(1);
  });

  it('TC-142 stops at the first rung that passes', () => {
    const rules = [
      { stars: 3 as const, text: 'three', test: () => true },
      { stars: 2 as const, text: 'two', test: () => true },
    ];

    expect(starsFor(rules, perfect())).toBe(3);
  });
});

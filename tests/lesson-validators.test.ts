import { describe, expect, it } from 'vitest';
import { LESSONS, getLesson } from '../src/renderer/training/lessons';
import { clamp01, holdFor, latch, type LessonMemory } from '../src/renderer/training/lessons/types';
import { SQUARE_CIRCUIT } from '../src/renderer/training/lessons/square';
import { hovering, probe } from './helpers/probe';

// Every module's per-frame validator, driven with synthetic frames.
//
// A validator is a pure function of (Probe, LessonMemory), so the whole of
// Flight School's marking can be exercised here without an engine, a window or
// a frame. What it CANNOT cover is the flying itself — collisions, the arena,
// the camera — which stays in the manual suite.
//
// Note the division of labour: the DIRECTOR ends an attempt on a crash, before
// the lesson is asked anything (invariants: the fourteen copies of that check
// are gone). So these tests never hand a validator a crashed probe.

/** Run a validator for `seconds` of frames on one steady probe. */
function fly(
  lessonId: string,
  p: ReturnType<typeof probe>,
  seconds: number,
  mem: LessonMemory = {},
) {
  const lesson = getLesson(lessonId)!;
  let last = lesson.validate(p, mem);
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    last = lesson.validate({ ...p, elapsed: i / 60 }, mem);
  }
  return { result: last, mem };
}

describe('every module', () => {
  it('TC-139 opens by asking the pilot to arm', () => {
    // invariants #40: every module is flown from the pad, so the first thing
    // the validator says is always the same thing.
    for (const l of LESSONS) {
      const r = l.validate(probe(), {});

      expect(r.done, l.id).toBe(false);
      expect(r.hint, l.id).toBeTruthy();
      expect(r.hint?.toLowerCase(), l.id).toContain('enter');
    }
  });

  it('TC-139 points at the arm key while it is waiting for one', () => {
    for (const l of LESSONS) {
      const r = l.validate(probe(), {});

      expect(r.cue, l.id).toContain('Enter');
    }
  });

  it('TC-141 keeps progress inside nought and one, whatever it is handed', () => {
    // The HUD renders this straight, so an un-clamped value shows as a negative
    // or a 300% bar.
    const frames = [
      probe(),
      probe({ armed: true }),
      hovering(1.8),
      hovering(30),
      hovering(1.8, { position: [80, 1.8, -80], groundSpeed: 12 }),
      hovering(0.05, { verticalSpeed: -4 }),
      probe({ armed: true, throttle: 1, altitude: 0 }),
    ];

    for (const l of LESSONS) {
      for (const p of frames) {
        const r = l.validate(p, {});
        if (r.progress === undefined) continue;
        expect(r.progress, `${l.id} progress`).toBeGreaterThanOrEqual(0);
        expect(r.progress, `${l.id} progress`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('TC-141 never throws on an unexpected frame', () => {
    const nasty = [
      probe({ altitude: -50, position: [-999, -50, 999] }),
      probe({ armed: true, yaw: 40, roll: 3, pitch: -3 }),
      hovering(500, { groundSpeed: 200, verticalSpeed: -90 }),
      probe({ dt: 0 }),
    ];

    for (const l of LESSONS) {
      for (const p of nasty) {
        expect(() => l.validate(p, {}), l.id).not.toThrow();
      }
    }
  });

  it('TC-140 only ever cues real keyboard codes', () => {
    // The keycap row and the on-screen sticks both look these up, so a typo
    // simply lights nothing and the pilot is told to press an invisible key.
    const KNOWN = new Set([
      'Enter',
      'Space',
      'KeyW',
      'KeyS',
      'KeyA',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]);
    const frames = [probe(), probe({ armed: true }), hovering(1.8), hovering(3.3), hovering(8)];

    for (const l of LESSONS) {
      for (const p of frames) {
        for (const code of l.validate(p, {}).cue ?? []) {
          expect(KNOWN, `${l.id} cued ${code}`).toContain(code);
        }
      }
    }
  });

  it('TC-141 does not finish a module the moment it is armed', () => {
    for (const l of LESSONS) {
      const r = l.validate(probe({ armed: true }), {});

      expect(r.done, l.id).toBe(false);
    }
  });

  it('TC-158 leaves the aircraft armed and flyable on an ordinary hover', () => {
    // A steady hover at the lesson's own height is never a failure or a wreck,
    // however little else the pilot has done yet.
    for (const l of LESSONS) {
      const { result } = fly(l.id, hovering(l.hoverHeight ?? 1.8), 2);

      expect(result.failed ?? false, l.id).toBe(false);
      expect(result.wrecked ?? false, l.id).toBe(false);
    }
  });
});

describe('Module 1, Arm and Take Off', () => {
  it('TC-165 explains the arm refusal instead of leaving the key dead', () => {
    const r = getLesson('arm-takeoff')!.validate(probe({ throttle: 0.9 }), {});

    expect(r.hint?.toLowerCase()).toContain('centre it first');
    expect(r.done).toBe(false);
  });

  it('TC-165 a blocked arming is remembered, and caps the result at two stars', () => {
    const lesson = getLesson('arm-takeoff')!;
    const mem: LessonMemory = {};

    lesson.validate(probe({ throttle: 0.9 }), mem);

    expect(mem.blocked).toBe(1);
    // The three-star rung reads that same flag.
    expect(
      lesson.stars[0].test({ timeSec: 5, collisions: 0, touches: 0, smoothness: 1, mem }),
    ).toBe(false);
  });

  it('TC-164 asks for Space once the drone is armed and still down', () => {
    const r = getLesson('arm-takeoff')!.validate(probe({ armed: true }), {});

    expect(r.hint?.toLowerCase()).toContain('space');
    expect(r.cue).toContain('Space');
  });

  it('TC-164 completes on a hover held steady at the pad height', () => {
    const { result } = fly('arm-takeoff', hovering(1.8, { verticalSpeed: 0 }), 3);

    expect(result.done).toBe(true);
    expect(result.progress).toBe(1);
  });

  it('TC-164 does not complete on a climb that never settles', () => {
    const { result } = fly('arm-takeoff', hovering(1.8, { verticalSpeed: 2.5 }), 3);

    expect(result.done).toBe(false);
  });

  it('TC-164 says so when the drone has gone too high', () => {
    const { result } = fly('arm-takeoff', hovering(9), 1);

    expect(result.hint?.toLowerCase()).toContain('too high');
  });
});

describe('latching', () => {
  it('TC-152 a success that has been earned is not taken back by drift', () => {
    // invariants #26: this is exactly how Roll Control shipped unfinishable —
    // the pilot slid through the far marker at 100% and ordinary momentum put
    // the lesson back to 58%.
    const mem: LessonMemory = {};

    expect(latch(mem, 'reached', true)).toBe(true);
    expect(latch(mem, 'reached', false)).toBe(true);
    expect(latch(mem, 'reached', false)).toBe(true);
  });

  it('TC-152 a latch does not fire before its condition ever holds', () => {
    const mem: LessonMemory = {};

    expect(latch(mem, 'reached', false)).toBe(false);
  });

  it('TC-145 a hold builds while the condition holds and decays faster when it breaks', () => {
    const mem: LessonMemory = {};
    const dt = 1 / 60;

    for (let i = 0; i < 60; i++) holdFor(mem, 'h', true, dt, 1.5);
    const built = mem.h;
    for (let i = 0; i < 10; i++) holdFor(mem, 'h', false, dt, 1.5);

    expect(built).toBeGreaterThan(0.9);
    expect(mem.h).toBeLessThan(built);
    // Decay is twice as fast as the build, so a broken hover costs real time.
    expect(built - mem.h).toBeGreaterThan((10 / 60) * 1.5);
  });

  it('TC-145 a hold never runs past its own target or below zero', () => {
    const mem: LessonMemory = {};

    for (let i = 0; i < 600; i++) holdFor(mem, 'h', true, 1 / 60, 1.5);
    expect(mem.h).toBe(1.5);

    for (let i = 0; i < 600; i++) holdFor(mem, 'h', false, 1 / 60, 1.5);
    expect(mem.h).toBe(0);
  });

  it('TC-141 clamp01 keeps a progress figure on the bar', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.42)).toBeCloseTo(0.42);
    expect(clamp01(9)).toBe(1);
  });
});

describe('Module 10, Square Circuit using Yaw', () => {
  const lesson = getLesson('square-yaw')!;
  const { route, start, height } = SQUARE_CIRCUIT;
  /** Hovering on the circuit, at a spot and a heading. TC-218's whole fixture. */
  const on = (at: readonly [number, number, number], yaw: number) =>
    hovering(height, { position: [at[0], at[1], at[2]], yaw });

  // The lap now opens with an ENTRY leg straight out in front of the pad, so
  // the square's own first leg — out to Corner A — is route cursor 1, not 0.
  const ON_A: LessonMemory = { rt: 1 };

  it('TC-218 opens with a push forward and no turn at all', () => {
    // The entry runs straight out on the heading the take-off left behind, so
    // the first thing asked for after the climb is the pitch stick. Nothing is
    // scored as turned onto: the nose was already pointing at it.
    const mem: LessonMemory = {};
    const r = lesson.validate(on(start, 0), mem);

    expect(r.hint).toContain('Push forward');
    expect(r.cue).toEqual(['ArrowUp']);
    expect(mem.facedLegs ?? 0).toBe(0);
  });

  it('TC-218 asks for the turn before it asks for the side', () => {
    // Over the "H" at the start heading, Corner A is 35° off the nose.
    const r = lesson.validate(on(start, 0), { ...ON_A });

    expect(r.hint?.toLowerCase()).toContain('turn the nose');
    expect(r.hint).toContain('Corner A');
    expect(r.cue).toEqual(['KeyD']);
  });

  it('TC-218 cues the way the nose actually has to go', () => {
    // Corner A is off the front-RIGHT of the pad, so from a heading that has
    // already overshot past it the turn back is to the LEFT. Turning left is the
    // direction of increasing heading, which is the A key.
    const past = lesson.validate(on(start, -Math.PI / 2), { ...ON_A });

    expect(past.cue).toEqual(['KeyA']);
  });

  it('TC-218 wants one stick down the side once the nose is on the corner', () => {
    const facing = Math.atan2(-(route[0].at[0] - start[0]), -(route[0].at[2] - start[2]));
    const r = lesson.validate(on(start, facing), { ...ON_A });

    expect(r.cue).toEqual(['ArrowUp']);
    expect(r.hint).toContain('Push forward');
    expect(r.done).toBe(false);
  });

  it('TC-218 keeps the side judged on the line, not on the heading', () => {
    // Nose on Corner B but flown from the middle of the pad: the side from A to
    // B runs up the right-hand edge, so this is a cut across the square.
    const mem: LessonMemory = { rt: 2 };
    const facing = Math.atan2(-(route[1].at[0] - 0), -(route[1].at[2] - 0));
    const r = lesson.validate(on([0, height, 0], facing), mem);

    expect(r.hint?.toLowerCase()).toContain('do not cross the middle');
    expect(mem.cut).toBeGreaterThan(3);
  });

  it('TC-218 counts a leg as turned onto only when the nose was actually put on it', () => {
    const facing = Math.atan2(-(route[0].at[0] - start[0]), -(route[0].at[2] - start[2]));
    const crabbed: LessonMemory = { ...ON_A };
    lesson.validate(on(start, 0), crabbed);
    const turned: LessonMemory = { ...ON_A };
    lesson.validate(on(start, facing), turned);

    expect(crabbed.facedLegs ?? 0).toBe(0);
    expect(turned.facedLegs).toBe(1);
  });

  it('TC-218 refuses three stars to a lap that was crabbed round', () => {
    // Everything else perfect: clean, quick, dead on the lines — and the nose
    // never put on a single corner. That is Module 9's lap, not this one's.
    const crabbed = {
      timeSec: 40,
      collisions: 0,
      touches: 0,
      smoothness: 1,
      mem: { cut: 0, crab: 0, facedLegs: 0 },
    };

    expect(lesson.stars[0].test(crabbed)).toBe(false);
    expect(
      lesson.stars[0].test({ ...crabbed, mem: { ...crabbed.mem, facedLegs: route.length } }),
    ).toBe(true);
  });

  it('TC-218 defines the full 13-stage progression including turns and legs', () => {
    const stageLabels = lesson.stages?.map((s) => s.label);
    expect(stageLabels).toEqual([
      'Arm',
      'Take off',
      'Pitch forward',
      'Yaw right',
      'Pitch forward A',
      'Yaw right',
      'Pitch forward B',
      'Yaw right',
      'Pitch forward C',
      'Yaw right',
      'Pitch forward D',
      'Yaw right',
      'Close at A',
    ]);
  });

  it('TC-218 demonstration visits all stages in increasing order', () => {
    const stagesInDemo = lesson.demo
      .filter((s) => s.stage !== undefined)
      .map((s) => s.stage!);
    const uniqueStages = [...new Set(stagesInDemo)];
    expect(uniqueStages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
});

import { CUE, angleDiffDeg, clamp01, latch, type Lesson } from './types';
import { home } from './arena';
import { yawTime } from './demoFlight';

// Module 4 — Yaw. Rotate the drone about its vertical axis without
// changing position. Practice: turn ~90°, then rotate back to the start heading.
const TURN = 90;
const REACH_TOL = 12; // within this of the target counts
const RETURN_TOL = 12;
/** Demo yaw stick, and how long it takes to turn TURN degrees at that rate.
 *  Yaw is a rate command, so the angle is rate x time — hand-timed, the demo
 *  spun 134 degrees while the caption claimed 90. */
const DEMO_YAW = 0.5;
const TURN_SEC = yawTime(TURN, DEMO_YAW);

export const yawLesson: Lesson = {
  id: 'yaw',
  order: 4,
  title: 'Yaw Control',
  subtitle: 'Spin the nose, hold the spot',

  explain: {
    title: 'Yaw Control',
    body: [
      'Yaw spins the drone in place. Only the nose moves.',
      'Turn about 90 degrees, then turn back.',
    ],
  },

  // The drone turns on the spot, so the only thing to highlight is the spot.
  route: [home('H')],

  stages: [
    { label: 'Turn 90°', cap: 'A' },
    { label: 'Turn back', cap: 'D' },
  ],

  // Opens at a hover: the drone is placed there rather than flying up to it,
  // so the lesson starts on its own drill instead of on a take-off.
  startAirborne: true,

  demo: [
    { at: 0.0, caption: 'Armed and hovering over the pad' },
    {
      at: 3.0,
      stick: { yaw: -DEMO_YAW },
      key: 'KeyA',
      caption: 'Yaw left — the nose swings round',
    },
    { at: 3.0 + TURN_SEC, stick: { yaw: 0 }, caption: 'Centre the stick — the turn stops there' },
    {
      at: 3.0 + TURN_SEC + 1.2,
      stick: { yaw: DEMO_YAW },
      key: 'KeyD',
      caption: 'Yaw right — back to centre',
    },
    { at: 3.0 + 2 * TURN_SEC + 1.2, stick: { yaw: 0 }, caption: 'Back to the start heading' },
  ],

  practice: {
    prompt: 'Yaw ~90°, then rotate back to your start heading',
    hint: 'Hold yaw left to rotate',
  },

  keys: [
    { code: 'KeyA', label: 'A', hint: 'Yaw Left' },
    { code: 'KeyD', label: 'D', hint: 'Yaw Right' },
  ],

  tips: ['Use short taps. Yaw speeds up fast.', 'Watch the heading as you turn.'],
  commonMistakes: ['Turning too far past the target.', 'Mixing up yaw with roll.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };
    if (mem.startSet !== 1) {
      mem.startYaw = p.yaw;
      mem.startSet = 1;
    }

    const delta = Math.abs(angleDiffDeg(p.yaw, mem.startYaw ?? 0));
    mem.overshoot = Math.max(mem.overshoot ?? 0, delta - (TURN + REACH_TOL));

    if ((mem.stage ?? 0) === 0) {
      if (Math.abs(delta - TURN) <= REACH_TOL) mem.stage = 1;
      mem.wp = mem.stage ?? 0;
      return {
        done: false,
        progress: 0.5 * clamp01(delta / TURN),
        hint: `Turn to about 90°. Now at ${delta.toFixed(0)}°`,
        cue: CUE.yawLeft,
      };
    }

    // Latched — see `latch`: yaw drifts, and holding a heading is not what this
    // lesson is testing.
    const back = latch(mem, 'back', delta <= RETURN_TOL);
    mem.wp = back ? 2 : 1;
    return {
      done: back,
      progress: back ? 1 : 0.5 + 0.5 * clamp01(1 - (delta - RETURN_TOL) / TURN),
      hint: back ? 'On heading' : `Turn back to the start. Now at ${delta.toFixed(0)}°`,
      cue: back ? [] : CUE.yawRight,
    };
  },

  stars: [
    {
      stars: 3,
      text: 'Both turns within 8°, under 18s, nothing touched',
      test: ({ touches, timeSec, collisions, mem }) =>
        collisions === 0 && touches === 0 && (mem.overshoot ?? 0) <= 8 && timeSec <= 18,
    },
    {
      stars: 2,
      text: 'Both turns within 25°, under 35s',
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.overshoot ?? 0) <= 25 && timeSec <= 35,
    },
  ],

  // A quarter turn out and back is quick, but tapping yaw accurately is not —
  // and yaw is the first lesson where overshooting costs a correction.
  practiceTimeout: 40,
};

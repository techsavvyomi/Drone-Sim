import { CUE, angleDiffDeg, clamp01, latch, type Lesson } from './types';
import { home } from './arena';
import { yawTime } from './demoFlight';
import {
  PREFLIGHT_KEYS,
  PREFLIGHT_STAGES,
  afterPreflightDemo,
  preflightDemo,
  withPreflight,
} from './preflight';

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

  stages: [...PREFLIGHT_STAGES, { label: 'Turn 90°', cap: 'A' }, { label: 'Turn back', cap: 'D' }],

  demo: [
    ...preflightDemo(),
    ...afterPreflightDemo([
      { at: 0.0, caption: 'Hovering over the pad. The drill is the nose' },
      {
        at: 1.4,
        stage: 0,
        stick: { yaw: -DEMO_YAW },
        key: 'KeyA',
        caption: 'Yaw left — the nose swings round',
      },
      { at: 1.4 + TURN_SEC, stick: { yaw: 0 }, caption: 'Centre the stick — the turn stops there' },
      {
        at: 1.4 + TURN_SEC + 1.2,
        stage: 1,
        stick: { yaw: DEMO_YAW },
        key: 'KeyD',
        caption: 'Yaw right — back to centre',
      },
      { at: 1.4 + 2 * TURN_SEC + 1.2, stick: { yaw: 0 }, caption: 'Back to the start heading' },
    ]),
  ],

  practice: {
    prompt: 'Arm, take off, yaw ~90°, then rotate back to your start heading',
    hint: 'Press ENTER to arm',
  },

  keys: [
    ...PREFLIGHT_KEYS,
    { code: 'KeyA', label: 'A', hint: 'Yaw Left' },
    { code: 'KeyD', label: 'D', hint: 'Yaw Right' },
  ],

  tips: ['Use short taps. Yaw speeds up fast.', 'Watch the heading as you turn.'],
  commonMistakes: ['Turning too far past the target.', 'Mixing up yaw with roll.'],

  validate: (p, mem) =>
    withPreflight(p, mem, (p, mem) => {
      // Same rule as Module 3: this is a drill flown at a hover, and it has no
      // landing in it. Without this the turns could be finished sitting on the
      // deck, which is not the skill the lesson is marking.
      if (p.onGround) {
        return {
          done: false,
          failed: true,
          wrecked: true,
          hint: 'You put it down. Hold the hover while you turn',
          cue: [],
        };
      }
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
    }),

  // Both limits carry the take-off now — about eight seconds before the first
  // turn can begin.
  stars: [
    {
      stars: 3,
      text: 'Both turns within 8°, under 26s, nothing touched',
      test: ({ touches, timeSec, collisions, mem }) =>
        collisions === 0 && touches === 0 && (mem.overshoot ?? 0) <= 8 && timeSec <= 26,
    },
    {
      stars: 2,
      text: 'Both turns within 25°, under 45s',
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.overshoot ?? 0) <= 25 && timeSec <= 45,
    },
  ],

  // A quarter turn out and back is quick, but tapping yaw accurately is not —
  // and yaw is the first lesson where overshooting costs a correction.
  practiceTimeout: 50,
};

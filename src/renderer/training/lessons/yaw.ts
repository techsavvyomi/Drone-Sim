import { angleDiffDeg, clamp01, latch, type Lesson } from './types';
import { home } from './arena';
import { yawTime } from './demoFlight';
import { useFlightStore } from '../../state/flightStore';

// Lesson (Module 4) — Yaw. Rotate the drone about its vertical axis without
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
      'Yaw rotates the drone left or right without moving its position.',
      'It changes which way the drone is facing — vital for orientation.',
      'Your goal: yaw about 90°, then rotate back to your starting heading.',
    ],
  },

  // The drone turns on the spot, so the only thing to highlight is the spot.
  route: [home('H')],

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.0, stick: { yaw: -DEMO_YAW }, key: 'KeyA', caption: 'Yaw left — the nose swings round' },
    { at: 3.0 + TURN_SEC, stick: { yaw: 0 }, caption: 'Centre the stick — the turn stops there' },
    {
      at: 3.0 + TURN_SEC + 1.2,
      stick: { yaw: DEMO_YAW },
      key: 'KeyD',
      caption: 'Yaw right — back to centre',
    },
    { at: 3.0 + 2 * TURN_SEC + 1.2, stick: { yaw: 0 }, caption: 'Back to the start heading' },
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    // Takeoff no longer arms on the pilot's behalf, so a lesson that drops the
    // student straight into the air has to arm the aircraft itself first.
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Yaw ~90°, then rotate back to your start heading',
    hint: 'Hold yaw left to rotate',
  },

  keys: [
    { code: 'KeyA', label: 'A', hint: 'Yaw Left' },
    { code: 'KeyD', label: 'D', hint: 'Yaw Right' },
  ],

  tips: ['Use short taps — yaw builds up quickly.', 'Watch the compass heading as you turn.'],
  commonMistakes: ['Over-rotating past the target.', 'Confusing yaw (spin) with roll (slide sideways).'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    if (mem.startSet !== 1) {
      mem.startYaw = p.yaw;
      mem.startSet = 1;
    }

    const delta = Math.abs(angleDiffDeg(p.yaw, mem.startYaw ?? 0));
    mem.overshoot = Math.max(mem.overshoot ?? 0, delta - (TURN + REACH_TOL));

    if ((mem.stage ?? 0) === 0) {
      if (Math.abs(delta - TURN) <= REACH_TOL) mem.stage = 1;
      return {
        done: false,
        progress: 0.5 * clamp01(delta / TURN),
        hint: `Rotate to about 90° — now at ${delta.toFixed(0)}°`,
      };
    }

    // Latched — see `latch`: yaw drifts, and holding a heading is not what this
    // lesson is testing.
    const back = latch(mem, 'back', delta <= RETURN_TOL);
    return {
      done: back,
      progress: back ? 1 : 0.5 + 0.5 * clamp01(1 - (delta - RETURN_TOL) / TURN),
      hint: back ? 'On heading' : `Rotate back to centre — now at ${delta.toFixed(0)}°`,
    };
  },

  score: ({ timeSec, collisions, mem }) => {
    if (collisions > 0) return 1;
    const overshoot = mem.overshoot ?? 0;
    if (overshoot <= 8 && timeSec <= 18) return 3;
    if (overshoot <= 25 && timeSec <= 35) return 2;
    return 1;
  },

  // A quarter turn out and back is quick, but tapping yaw accurately is not —
  // and yaw is the first lesson where overshooting costs a correction.
  practiceTimeout: 40,
};

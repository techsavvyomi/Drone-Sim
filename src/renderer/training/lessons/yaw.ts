import { angleDiffDeg, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';

// Lesson (Module 5) — Yaw. Rotate the drone about its vertical axis without
// changing position. Practice: turn ~90°, then rotate back to the start heading.
const TURN = 90;
const REACH_TOL = 12; // within this of the target counts
const RETURN_TOL = 12;

export const yawLesson: Lesson = {
  id: 'yaw',
  order: 5,
  title: 'Yaw Control',
  subtitle: 'Rotate on the spot',

  explain: {
    title: 'Yaw',
    body: [
      'Yaw rotates the drone left or right without moving its position.',
      'It changes which way the drone is facing — vital for orientation.',
      'Your goal: yaw about 90°, then rotate back to your starting heading.',
    ],
  },

  demo: [
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.2, stick: { yaw: -0.5 }, key: 'KeyA', caption: 'Yaw left — the nose swings round' },
    { at: 5.0, stick: { yaw: 0 }, caption: 'Stop at about 90°' },
    { at: 6.2, stick: { yaw: 0.5 }, key: 'KeyD', caption: 'Yaw right — back to centre' },
    { at: 8.0, stick: { yaw: 0 }, caption: 'Back to the start heading' },
  ],

  setup: () => {
    useFlightStore.getState().requestTakeoffLand();
  },

  practice: {
    prompt: 'Yaw ~90°, then rotate back to your start heading',
    hint: 'Hold yaw left to rotate',
  },

  keys: [
    { code: 'KeyA', label: 'A', hint: 'Yaw left' },
    { code: 'KeyD', label: 'D', hint: 'Yaw right' },
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
        progress: 0.5 * Math.min(1, delta / TURN),
        hint: `Rotate to about 90° — now at ${delta.toFixed(0)}°`,
      };
    }

    const back = delta <= RETURN_TOL;
    return {
      done: back,
      progress: 0.5 + 0.5 * Math.min(1, 1 - (delta - RETURN_TOL) / TURN),
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
};

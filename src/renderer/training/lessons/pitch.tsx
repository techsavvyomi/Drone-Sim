import { horizontalDist, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';
import { Checkpoint } from './props';

// Lesson (Module 6) — Pitch. Move forward and back by tilting the drone. Fly out
// to a checkpoint ahead, then return to the start.
const CP_X = 0;
const CP_Z = -4; // forward is -Z for the default heading
const REACH = 1.0;
const HOME = 1.0;
const HOVER_ALT = 1.5;

export const pitchLesson: Lesson = {
  id: 'pitch',
  order: 6,
  title: 'Pitch Control',
  subtitle: 'Fly forward and back',

  explain: {
    title: 'Pitch',
    body: [
      'Pitch tilts the drone forward or backward to move it in that direction.',
      'The more you tilt, the faster it flies — ease off to slow down.',
      'Your goal: fly forward to the checkpoint, then return to the start.',
    ],
  },

  Scene: () => <Checkpoint position={[CP_X, HOVER_ALT, CP_Z]} color="#38bdf8" />,

  demo: [
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.2, stick: { pitch: 0.4 }, key: 'ArrowUp', caption: 'Pitch forward — fly to the checkpoint' },
    { at: 5.4, stick: { pitch: 0 }, caption: 'Level off at the checkpoint' },
    { at: 6.2, stick: { pitch: -0.4 }, key: 'ArrowDown', caption: 'Pitch back — return home' },
    { at: 8.6, stick: { pitch: 0 }, caption: 'Back at the start' },
  ],

  setup: () => {
    useFlightStore.getState().requestTakeoffLand();
  },

  practice: {
    prompt: 'Fly forward to the checkpoint, then return',
    hint: 'Pitch forward to fly to the checkpoint',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Backward' },
  ],

  tips: ['Keep your altitude steady while moving.', 'Level the drone to stop — don’t rely on drag alone.'],
  commonMistakes: ['Losing height as you pitch forward.', 'Tilting too hard and overshooting.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - HOVER_ALT));

    if ((mem.stage ?? 0) === 0) {
      const d = horizontalDist(p.position, CP_X, CP_Z);
      if (d < REACH) mem.stage = 1;
      return { done: false, progress: 0.5 * Math.min(1, 1 - (d - REACH) / 4), hint: 'Pitch forward to the checkpoint' };
    }

    const d = horizontalDist(p.position, 0, 0);
    const home = d < HOME;
    return {
      done: home,
      progress: 0.5 + 0.5 * Math.min(1, 1 - (d - HOME) / 4),
      hint: home ? 'Home' : 'Pitch back to return to the start',
    };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const altDev = mem.altDev ?? 0;
    if (altDev <= 0.6 && timeSec <= 22 && smoothness >= 0.35) return 3;
    if (altDev <= 1.2 && timeSec <= 40) return 2;
    return 1;
  },
};

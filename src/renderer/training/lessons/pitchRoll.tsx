import { horizontalDist, visitInOrder, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';
import { Checkpoint } from './props';

// Step 6 — Pitch + Roll together. The first lesson where neither stick axis is
// enough on its own: every target sits off both axes, so it has to be reached
// by holding pitch and roll at the same time rather than flying an L-shape.
const ALT = 1.6;
const R = 3;
/** Two opposite corners — each needs pitch AND roll held together to reach. */
const ROUTE = [
  [R, -R],
  [-R, R],
  [0, 0],
] as const;
const REACH = 1.0;

export const pitchRollLesson: Lesson = {
  id: 'pitch-roll',
  order: 5,
  title: 'Pitch + Roll',
  subtitle: 'Both sticks together',

  explain: {
    title: 'Combining Pitch and Roll',
    body: [
      'So far each stick moved the drone along one axis. Real flying mixes them.',
      'Holding pitch and roll together carries the drone diagonally, in one smooth move.',
      'Your goal: reach the far corner, cross to the opposite one, then come home.',
      'Fly it as one motion — do not go forward first and then sideways.',
    ],
  },

  Scene: () => (
    <>
      <Checkpoint position={[R, ALT, -R]} color="#38bdf8" />
      <Checkpoint position={[-R, ALT, R]} color="#a855f7" />
    </>
  ),

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.2, stick: { pitch: 0.32, roll: 0.32 }, caption: 'Both sticks — forward AND right together' },
    { at: 6.0, stick: { pitch: 0, roll: 0 }, caption: 'Level off at the first corner' },
    { at: 7.0, stick: { pitch: -0.32, roll: -0.32 }, caption: 'Reverse both — cross to the far corner' },
    { at: 11.0, stick: { pitch: 0, roll: 0 }, caption: 'Level off' },
    { at: 12.0, stick: { pitch: 0.28, roll: 0.28 }, caption: 'Back to the middle' },
    { at: 14.4, stick: { pitch: 0, roll: 0 }, caption: 'Home — one smooth diagonal each way' },
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Reach both corners, then return to the middle',
    hint: 'Hold pitch and roll together — one diagonal move',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Left' },
    { code: 'ArrowRight', label: '→', hint: 'Right' },
  ],

  tips: [
    'Move both sticks by a similar amount — that is what makes the path diagonal.',
    'Hold your altitude while you do it; combined input tends to sink.',
  ],
  commonMistakes: [
    'Flying an L-shape — all pitch, then all roll.',
    'Letting the nose drift, which turns the diagonal into a curve.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - ALT));

    const i = visitInOrder(mem, 'wp', p.position, ROUTE, REACH);
    if (i >= ROUTE.length) return { done: true, progress: 1, hint: 'Home — nicely coordinated' };

    const [tx, tz] = ROUTE[i];
    const d = horizontalDist(p.position, tx, tz);
    const legProgress = Math.max(0, Math.min(1, 1 - (d - REACH) / 6));
    const hint =
      i === ROUTE.length - 1 ? 'Now back to the middle' : 'Hold both sticks — go diagonally';
    return { done: false, progress: (i + legProgress) / ROUTE.length, hint };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const altDev = mem.altDev ?? 0;
    if (altDev <= 0.7 && timeSec <= 32 && smoothness >= 0.35) return 3;
    if (altDev <= 1.4 && timeSec <= 55) return 2;
    return 1;
  },

  practiceTimeout: 45,
};

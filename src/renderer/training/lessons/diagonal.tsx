import { horizontalDist, lineDeviation, visitInOrder, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';
import { Pylon } from './props';

// Step 8 — Diagonal. Straight Line held a path with one stick; this holds one
// with two. The pitch:roll ratio has to stay fixed for the whole run, which is
// what makes a diagonal harder than either axis alone.
const ALT = 1.6;
const A: readonly [number, number] = [-4, 4];
const B: readonly [number, number] = [4, -4];
const REACH = 1.1;
const ROUTE = [B, A] as const;

export const diagonalLesson: Lesson = {
  id: 'diagonal',
  order: 7,
  title: 'Diagonal',
  subtitle: 'Across the corners',

  explain: {
    title: 'Flying a Diagonal',
    body: [
      'A diagonal is a straight line that needs both sticks at once.',
      'Hold pitch and roll in a steady ratio and the drone tracks corner to corner.',
      'Let one drift and the path bows into a curve — that is what is being measured.',
      'Fly across to the far corner, then back again.',
    ],
  },

  Scene: () => (
    <>
      <Pylon position={[B[0], 0, B[1]]} color="#38bdf8" />
      <Pylon position={[A[0], 0, A[1]]} color="#34d399" />
    </>
  ),

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.2, stick: { pitch: 0.3, roll: 0.3 }, caption: 'Equal pitch and roll — track the diagonal' },
    { at: 7.4, stick: { pitch: 0, roll: 0 }, caption: 'Level off at the far corner' },
    { at: 8.6, stick: { pitch: -0.3, roll: -0.3 }, caption: 'Reverse both — back down the same diagonal' },
    { at: 13.0, stick: { pitch: 0, roll: 0 }, caption: 'Home — the ratio never changed' },
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Cross to the far corner and back, on the diagonal',
    hint: 'Hold pitch and roll in the same ratio',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Left' },
    { code: 'ArrowRight', label: '→', hint: 'Right' },
  ],

  tips: [
    'Set both sticks together and then leave them alone — corrections curve the line.',
    'Equal amounts give a 45° track; that is the line the pylons mark.',
  ],
  commonMistakes: [
    'Leading with one axis so the path starts as a curve.',
    'Losing height, which is easy with both sticks deflected.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - ALT));

    const drift = lineDeviation(p.position, A[0], A[1], B[0], B[1]);
    if (p.groundSpeed > 0.3) mem.maxDrift = Math.max(mem.maxDrift ?? 0, drift);

    const i = visitInOrder(mem, 'wp', p.position, ROUTE, REACH);
    if (i >= ROUTE.length) return { done: true, progress: 1, hint: 'Home — diagonal held' };

    const [tx, tz] = ROUTE[i];
    const d = horizontalDist(p.position, tx, tz);
    const legProgress = Math.max(0, Math.min(1, 1 - (d - REACH) / 8));
    const hint =
      drift > 1.4 ? 'Bowing off the diagonal — even the two sticks up' : 'Hold the ratio steady';
    return { done: false, progress: (i + legProgress) / ROUTE.length, hint };
  },

  score: ({ timeSec, collisions, mem }) => {
    if (collisions > 0) return 1;
    const drift = mem.maxDrift ?? 99;
    const altDev = mem.altDev ?? 0;
    if (drift <= 0.8 && altDev <= 0.7 && timeSec <= 34) return 3;
    if (drift <= 1.6 && altDev <= 1.4) return 2;
    return 1;
  },

  practiceTimeout: 45,
};

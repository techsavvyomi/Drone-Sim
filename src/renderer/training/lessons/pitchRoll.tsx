import { clamp01, flyRoute, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { gate, home, routeLegs } from './arena';
import { useFlightStore } from '../../state/flightStore';

// Module 5 — Pitch + Roll. One diagonal held on both sticks at once, flown to
// the red ring out on the left. Of the six gates it is the one furthest off the
// nose — 14 m across for 20 m of run — so reaching it on pitch alone, or roll
// alone, is not possible. That is the point: an L-shape does not get there.
const ROUTE = [gate('red-left', 'Red ring', { ease: 1.4 }), home('H')] as const;

export const pitchRollLesson: Lesson = {
  id: 'pitch-roll',
  order: 5,
  title: 'Pitch + Roll',
  subtitle: 'Both sticks at once, one clean diagonal',

  explain: {
    title: 'Combining Pitch and Roll',
    body: [
      'Real flying is rarely along one axis. Held together, pitch and roll move the drone diagonally.',
      'The red ring out to your left is off BOTH axes — you cannot reach it on one stick.',
      'Hold both together and the path is a straight diagonal; take turns and you fly an L.',
      'Your goal: out to the red ring, then straight back to the "H".',
    ],
  },

  route: ROUTE,

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    ...planDemo(
      routeLegs(
        ROUTE,
        [
          {
            caption: 'Forward AND left together — one straight diagonal',
            arrive: 'Both sticks back to stop at the ring',
          },
          { caption: 'Reverse both — the same diagonal home', arrive: 'Home — one line each way' },
        ],
        0.42,
      ),
    ),
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Diagonal out to the red ring, then straight back',
    hint: 'Hold pitch and roll together — one diagonal move',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: ['Start both sticks at the same moment.', 'Equal amounts on each stick gives a 45° line.'],
  commonMistakes: ['Flying an L instead of a diagonal.', 'Leading with one stick and correcting with the other.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };

    const r = flyRoute(mem, p.position, ROUTE);
    if (r.complete) return { done: true, progress: 1, hint: 'Home — nicely coordinated' };
    return {
      done: false,
      progress: clamp01(r.progress),
      hint: r.next === 0 ? 'Hold both sticks — go diagonally' : 'Now back to the "H", same line',
    };
  },

  score: ({ timeSec, collisions, smoothness }) => {
    if (collisions > 0) return 1;
    if (timeSec <= 34 && smoothness >= 0.32) return 3;
    if (timeSec <= 60) return 2;
    return 1;
  },

  practiceTimeout: 50,
};

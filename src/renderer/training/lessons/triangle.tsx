import { clamp01, flyRoute, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { marker, routeLegs } from './arena';
import { useFlightStore } from '../../state/flightStore';

// Module 9 — Triangle Circuit, on three of the helipad's white markers: one
// straight behind the "H" and two out in front, symmetrical either side. Unlike
// the square, not one of these legs lines up with an axis, so every side needs
// both sticks held in a different ratio and every corner is a real turn.
const CORNERS = [
  marker(4, 'Corner 1'), //  behind the pad
  marker(9, 'Corner 2'), //  front-left
  marker(15, 'Corner 3'), // front-right
] as const;
const ROUTE = [...CORNERS, { ...CORNERS[0], label: 'Corner 1 again' }] as const;

export const triangleLesson: Lesson = {
  id: 'triangle',
  order: 9,
  title: 'Triangle Circuit',
  subtitle: 'Three legs, three sharp turns',

  explain: {
    title: 'Flying a Triangle',
    body: [
      'The square gave you four sides on one stick each. A triangle gives you none.',
      'Every leg here runs at an angle, so each one is a different mix of pitch and roll.',
      'Three corners means three real turns — stop, re-aim, go.',
      'Fly the three markers in order and close the loop.',
    ],
  },

  route: ROUTE,

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    ...planDemo(
      routeLegs(ROUTE, [
        { caption: 'Back to the first corner', arrive: 'Stop on it' },
        { caption: 'Leg 2 — a different mix of both sticks', arrive: 'Stop at the corner' },
        { caption: 'Leg 3 — across the front', arrive: 'Stop at the corner' },
        { caption: 'Close the loop', arrive: 'Triangle complete' },
      ]),
    ),
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Fly the three markers in order and close the triangle',
    hint: 'Back to the first corner',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: ['Aim at the next corner before you start moving.', 'Each leg is a different stick ratio — set it, then hold it.'],
  commonMistakes: ['Flying the legs as L-shapes.', 'Drifting past a corner instead of stopping on it.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };

    const r = flyRoute(mem, p.position, ROUTE, { spread: 10 });
    if (r.complete) return { done: true, progress: 1, hint: 'Triangle complete' };
    return {
      done: false,
      progress: clamp01(r.progress),
      hint: r.next === ROUTE.length - 1 ? 'Close the loop — back to the first corner' : `Next: ${ROUTE[r.next].label}`,
    };
  },

  score: ({ timeSec, collisions, smoothness }) => {
    if (collisions > 0) return 1;
    if (timeSec <= 55 && smoothness >= 0.3) return 3;
    if (timeSec <= 90) return 2;
    return 1;
  },

  practiceTimeout: 60,
};

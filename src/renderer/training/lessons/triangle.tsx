import { clamp01, cueBetween, flyRoute, lineDeviation, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { HOVER, marker, routeLegs } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';

// Module 9 — Triangle Circuit, on three of the helipad's white markers: one
// straight behind the "H" and two out in front, symmetrical either side. Unlike
// the square, not one of these legs lines up with an axis, so every side needs
// both sticks held in a different ratio and every corner is a real turn.
//
// The three sides are drawn on the field and the point being flown to is the
// only one named, so the route reads as a shape rather than as a set of letters.
const CORNERS = [
  marker(4, 'Corner 1'), //  behind the pad
  marker(9, 'Corner 2'), //  front-left
  marker(15, 'Corner 3'), // front-right
] as const;
const ROUTE = [...CORNERS, { ...CORNERS[0], label: 'Corner 1 again' }] as const;

const START: readonly [number, number, number] = [
  ACADEMY_PAD.center[0],
  HOVER,
  ACADEMY_PAD.center[1],
];

/** How far off a side counts as cutting the corner, in metres. */
const SIDE_TOL = 3.5;

export const triangleLesson: Lesson = {
  id: 'triangle',
  order: 9,
  title: 'Triangle Circuit',
  subtitle: 'Three sides, three sharp turns',

  explain: {
    title: 'Flying a Triangle',
    body: [
      'Take off, fly the three corners in order along the sides, and close the loop.',
      'No side lines up with one stick here, so every side is a mix of two.',
      'Stop at each corner, aim at the next one, then go.',
    ],
  },

  route: ROUTE,

  // Opens at a hover: the drone is placed there rather than flying up to it,
  // so the lesson starts on its own drill instead of on a take-off.
  startAirborne: true,

  demo: [
    ...planDemo(
      routeLegs(ROUTE, [
        { caption: 'Back to the first corner', arrive: 'Stop on it' },
        { caption: 'Side 2 — a different mix of both sticks', arrive: 'Stop at the corner' },
        { caption: 'Side 3 — across the front', arrive: 'Stop at the corner' },
        { caption: 'Close the loop', arrive: 'Triangle complete' },
      ]),
    ),
  ],

  practice: {
    prompt: 'Fly the three corners in order and close the triangle',
    hint: 'Back to the first corner',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: [
    'Aim at the next corner before you start moving.',
    'Set the stick mix for the side, then hold it.',
  ],
  commonMistakes: [
    'Flying the sides as L-shapes.',
    'Drifting past a corner instead of stopping on it.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };

    const r = flyRoute(mem, p.position, ROUTE);
    if (r.complete) return { done: true, progress: 1, hint: 'Triangle complete', cue: [] };

    const target = ROUTE[r.next];
    const from = r.next === 0 ? START : ROUTE[r.next - 1].at;
    const off = lineDeviation(p.position, from[0], from[2], target.at[0], target.at[2]);
    if (r.next > 0) mem.cut = Math.max(mem.cut ?? 0, off);

    const wandered = r.next > 0 && off > SIDE_TOL;
    return {
      done: false,
      progress: clamp01(r.progress),
      hint: wandered
        ? 'Off the side. Get back on the line to the next corner'
        : r.next === ROUTE.length - 1
          ? 'Last side — close the triangle back at the first corner'
          : `Fly the side to ${target.label}`,
      cue: cueBetween(from, target.at),
    };
  },

  stars: [
    {
      stars: 3,
      text: 'Sides held within 2.5 m, circuit under 55 seconds',
      test: ({ timeSec, collisions, smoothness, mem }) =>
        collisions === 0 && (mem.cut ?? 0) <= 2.5 && timeSec <= 55 && smoothness >= 0.3,
    },
    {
      stars: 2,
      text: `Never more than ${SIDE_TOL} m off a side, circuit under 90 seconds`,
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.cut ?? 0) <= SIDE_TOL && timeSec <= 90,
    },
  ],

  practiceTimeout: 60,
};

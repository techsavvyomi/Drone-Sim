import { clamp01, cueBetween, flyRoute, lineDeviation, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { HOVER, marker, routeLegs } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';

// Module 8 — Square Circuit, flown on four of the white markers ringing the
// helipad. They sit at the four diagonals of the ring, which puts them at the
// corners of a square about 9.6 m on a side — and, because that square is
// aligned with the pad, every side is ONE stick. That is the drill: a side is a
// straight line on one control, a corner is a full stop before the next one.
//
// A square that can be crossed down the middle is not a square, and that is
// what it used to look like on screen: four lettered points and no sides. The
// sides are now drawn on the field, each one names the single stick that flies
// it, and straying off a side says so and costs stars.
const CORNERS = [
  marker(14, 'Corner 1'), // front-right
  marker(2, 'Corner 2'), //  back-right
  marker(6, 'Corner 3'), //  back-left
  marker(10, 'Corner 4'), // front-left
] as const;
/** Back to the first corner to close the loop. */
const ROUTE = [...CORNERS, { ...CORNERS[0], label: 'Corner 1 again' }] as const;

/** Where the drone starts the circuit from: the hover over the "H". */
const START: readonly [number, number, number] = [
  ACADEMY_PAD.center[0],
  HOVER,
  ACADEMY_PAD.center[1],
];

/** How far off a side counts as cutting the corner, in metres. */
const SIDE_TOL = 3;

export const squareLesson: Lesson = {
  id: 'square',
  order: 8,
  title: 'Square Circuit',
  subtitle: 'Four straight sides, four square corners',

  explain: {
    title: 'Flying a Square',
    body: [
      'Fly the four corners in order, along the sides. Do not cut across the middle.',
      'Each side is one stick only: forward, left, back, right.',
      'Stop at every corner before you start the next side.',
    ],
  },

  route: ROUTE,

  // Opens at a hover: the drone is placed there rather than flying up to it,
  // so the lesson starts on its own drill instead of on a take-off.
  startAirborne: true,

  demo: [
    ...planDemo(
      routeLegs(ROUTE, [
        { caption: 'Out to the first corner', arrive: 'Stop square on it' },
        { caption: 'Side 1 — one stick only', arrive: 'Stop at the corner' },
        { caption: 'Side 2 — one stick only', arrive: 'Stop at the corner' },
        { caption: 'Side 3 — one stick only', arrive: 'Stop at the corner' },
        { caption: 'Side 4 — the loop is closed', arrive: 'One clean square' },
      ]),
    ),
  ],

  practice: {
    prompt: 'Fly the four corners in order, along the sides',
    hint: 'Out to the first corner',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: [
    'Come to a stop at each corner before starting the next side.',
    'A side needs one stick. If you are using both, you have drifted off it.',
  ],
  commonMistakes: [
    'Cutting across the middle instead of flying the side.',
    'Rounding the corners into a circle.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };

    const r = flyRoute(mem, p.position, ROUTE);
    if (r.complete) return { done: true, progress: 1, hint: 'Square complete', cue: [] };

    // How far off the side being flown. The first leg runs from the pad out to
    // corner 1 and is not part of the square, so it is not judged.
    const target = ROUTE[r.next];
    const from = r.next === 0 ? START : ROUTE[r.next - 1].at;
    const off = lineDeviation(p.position, from[0], from[2], target.at[0], target.at[2]);
    if (r.next > 0) mem.cut = Math.max(mem.cut ?? 0, off);

    const wandered = r.next > 0 && off > SIDE_TOL;
    return {
      done: false,
      progress: clamp01(r.progress),
      hint: wandered
        ? 'Off the side. Get back on the line, do not cross the middle'
        : r.next === ROUTE.length - 1
          ? 'Last side — close the square back at the first corner'
          : `Fly the side to ${target.label}`,
      cue: cueBetween(from, target.at),
    };
  },

  stars: [
    {
      stars: 3,
      text: 'Sides held within 2.2 m, circuit under 60 seconds',
      test: ({ timeSec, collisions, smoothness, mem }) =>
        collisions === 0 && (mem.cut ?? 0) <= 2.2 && timeSec <= 60 && smoothness >= 0.3,
    },
    {
      stars: 2,
      text: `Never more than ${SIDE_TOL} m off a side, circuit under 95 seconds`,
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.cut ?? 0) <= SIDE_TOL && timeSec <= 95,
    },
  ],

  practiceTimeout: 60,
};

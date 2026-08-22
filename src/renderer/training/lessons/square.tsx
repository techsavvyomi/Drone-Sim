import { clamp01, flyRoute, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { marker, routeLegs } from './arena';
import { useFlightStore } from '../../state/flightStore';

// Module 8 — Square Circuit, flown on four of the white markers ringing the
// helipad. They sit at the four diagonals of the ring, which puts them at the
// corners of a square about 9.6 m on a side — and, because that square is
// aligned with the pad, every side is ONE stick. That is the drill: a side is a
// straight line on one control, a corner is a full stop before the next one.
const CORNERS = [
  marker(14, 'Corner 1'), // front-right
  marker(2, 'Corner 2'), //  back-right
  marker(6, 'Corner 3'), //  back-left
  marker(10, 'Corner 4'), // front-left
] as const;
/** Back to the first corner to close the loop. */
const ROUTE = [...CORNERS, { ...CORNERS[0], label: 'Corner 1 again' }] as const;

export const squareLesson: Lesson = {
  id: 'square',
  order: 8,
  title: 'Square Circuit',
  subtitle: 'Four straight sides, four square corners',

  explain: {
    title: 'Flying a Square',
    body: [
      'A square is four straight sides joined by four square corners.',
      'The four markers you are flying sit square to the pad, so each side needs only ONE stick.',
      'The skill is the corner: come to a stop, then start the next side cleanly.',
      'Fly the markers in order and close the loop back at the first one.',
    ],
  },

  route: ROUTE,

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    ...planDemo(
      routeLegs(ROUTE, [
        { caption: 'Out to the first corner', arrive: 'Stop square on it' },
        { caption: 'Side 1 — pitch back, one stick only', arrive: 'Stop at the corner' },
        { caption: 'Side 2 — roll left', arrive: 'Stop at the corner' },
        { caption: 'Side 3 — pitch forward', arrive: 'Stop at the corner' },
        { caption: 'Side 4 — roll right', arrive: 'Loop closed — one clean square' },
      ]),
    ),
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Fly the four markers in order and close the square',
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
    'Sides are single-axis — if you need both sticks, you have drifted.',
  ],
  commonMistakes: [
    'Rounding the corners into a circle.',
    'Sinking a little on every side until the square is a spiral.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };

    const r = flyRoute(mem, p.position, ROUTE, { spread: 10 });
    if (r.complete) return { done: true, progress: 1, hint: 'Square complete' };
    return {
      done: false,
      progress: clamp01(r.progress),
      hint: r.next === ROUTE.length - 1 ? 'Close the loop — back to the first corner' : `Next: ${ROUTE[r.next].label}`,
    };
  },

  score: ({ timeSec, collisions, smoothness }) => {
    if (collisions > 0) return 1;
    if (timeSec <= 60 && smoothness >= 0.3) return 3;
    if (timeSec <= 95) return 2;
    return 1;
  },

  practiceTimeout: 60,
};

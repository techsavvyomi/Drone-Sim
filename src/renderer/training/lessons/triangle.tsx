import { clamp01, cueBetween, flyRoute, lineDeviation, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { marker, routeLegs } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';

// Module 10 — Triangle Circuit, on three of the helipad's white markers: an
// apex straight out IN FRONT of the "H" and two behind it, symmetrical either
// side. The two long sides are diagonals, so each needs both sticks held in a
// different ratio; only the short side joining the two rear corners is a single
// stick.
//
// The apex points away from the pilot on purpose. With it behind the pad the
// shape opened by sending the drone backwards, over the pilot's own shoulder,
// which is the one direction a beginner cannot read — and the first leg of a
// shape is where they are still working out which stick does what.
//
// The corners are three markers already standing in the ring, and the guide
// paints A, B and C on the deck at them. Without that the row's "Corner B"
// names one of sixteen identical white spheres and the pilot has no way to tell
// which — the same complaint that retired 'Pad E'. The letter goes on the field,
// not the whole phrase: "Corner B" is right for a chip and far too much for a
// patch of deck beside a 0.9 m sphere.
//
// Nothing is drawn BETWEEN them. A line over the arena has to skip depth
// testing to be seen at all, and it then lies flat on the ground instead of
// hanging where the drone flies. Straying off a side is what the hint and the
// score are for.
/** How high the circuit is flown, in metres.
 *
 *  Higher than the standard 1.8 m hover, and it is a question of SEEING rather
 *  than of flying: the corners are lettered on the deck, and from 1.8 m the far
 *  ones are read edge-on across the pad. From here the pilot is looking down at
 *  the shape. The checkpoints move up with it — they are judged in 3-D — and so
 *  does the point the demonstration flies from.
 */
const FLY_AT = 3.3;

const CORNERS = [
  marker(12, 'Corner A', { tag: 'A', height: FLY_AT }), // the apex, straight ahead
  marker(6, 'Corner B', { tag: 'B', height: FLY_AT }), //  back-left
  marker(2, 'Corner C', { tag: 'C', height: FLY_AT }), //  back-right
] as const;
/** The loop closes where it began. Named as a RETURN, not as another corner:
 *  the intro card lays the route out as a numbered flow, and "Corner A again"
 *  sitting in the fourth slot of a three-corner shape reads as a fourth corner
 *  the pilot has not been told about. */
const ROUTE = [...CORNERS, { ...CORNERS[0], label: 'Return to Corner A' }] as const;

const START: readonly [number, number, number] = [
  ACADEMY_PAD.center[0],
  FLY_AT,
  ACADEMY_PAD.center[1],
];

/** How far off a side counts as cutting the corner, in metres. */
const SIDE_TOL = 3.5;

export const triangleLesson: Lesson = {
  id: 'triangle',
  order: 10,
  title: 'Triangle Circuit',
  subtitle: 'Three sides, three sharp turns',

  explain: {
    title: 'Flying a Triangle',
    body: [
      'A is straight ahead. B and C are behind you, one on each side.',
      'Fly A, then B, then C, then back to A. The slanted sides need both sticks.',
    ],
  },

  route: ROUTE,

  // Opens at a hover: the drone is placed there rather than flying up to it,
  // so the lesson starts on its own drill instead of on a take-off.
  startAirborne: true,
  hoverHeight: FLY_AT,

  demo: [
    ...planDemo(
      routeLegs(
        ROUTE,
        [
          { caption: 'Straight ahead to A', arrive: 'Stop on A' },
          { caption: 'A to B — both sticks, back and to the left', arrive: 'Stop on B' },
          { caption: 'B to C — straight across, one stick', arrive: 'Stop on C' },
          { caption: 'C back up to A, and the loop is closed', arrive: 'Triangle complete' },
        ],
        undefined,
        { from: START },
      ),
      { from: START },
    ),
  ],

  practice: {
    prompt: 'Fly A, B and C in order along the sides, then back to A',
    hint: 'Fly straight ahead to Corner A',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: [
    'Aim at the next corner before you start moving.',
    'Set both sticks for the side, then hold them.',
  ],
  commonMistakes: [
    'Flying the sides as L shapes.',
    'Floating past a corner instead of stopping on it.',
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
          ? 'Last side — close the triangle back at Corner A'
          : `Fly the side to ${target.label}`,
      cue: cueBetween(from, target.at),
    };
  },

  stars: [
    {
      stars: 3,
      text: 'Sides within 2.5 m, lap under 55s, nothing touched',
      test: ({ touches, timeSec, collisions, smoothness, mem }) =>
        collisions === 0 &&
        touches === 0 &&
        (mem.cut ?? 0) <= 2.5 &&
        timeSec <= 55 &&
        smoothness >= 0.3,
    },
    {
      stars: 2,
      text: `Sides within ${SIDE_TOL} m, lap under 90s`,
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.cut ?? 0) <= SIDE_TOL && timeSec <= 90,
    },
  ],

  practiceTimeout: 60,
};

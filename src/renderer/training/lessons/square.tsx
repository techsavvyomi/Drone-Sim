import { clamp01, cueBetween, flyRoute, lineDeviation, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { marker, routeLegs } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';
import {
  KEYS_PITCH,
  KEYS_ROLL,
  KEYS_THROTTLE,
  KEYS_YAW,
  PREFLIGHT_KEYS,
  PREFLIGHT_STAGES,
  ROUTE_CURSOR,
  afterPreflightDemo,
  preflightDemo,
  withPreflight,
} from './preflight';

// Module 9 — Square Circuit, flown on four of the white markers ringing the
// helipad. They sit at the four diagonals of the ring, which puts them at the
// corners of a square about 9.6 m on a side — and, because that square is
// aligned with the pad, every side is ONE stick. That is the drill: a side is a
// straight line on one control, a corner is a full stop before the next one.
//
// A square that can be crossed down the middle is not a square. The sides are
// not drawn — a guide line over the arena has to skip depth testing to be seen,
// which paints it flat on the ground rather than hanging where the drone flies.
// Instead each side names the single stick that flies it, and straying off one
// says so in the hint and costs stars.
//
// Each corner stands a BEACON: a hollow cylinder of light as wide as the
// checkpoint's own acceptance radius, solid where it meets the deck and faded
// out to nothing overhead, with a glowing ring on the ground at its foot.
// Sitting over the ring is what takes the corner, and it goes out behind the
// aircraft.
//
// It replaces the PILLAR that stood here: the same acceptance volume drawn as a
// solid column of pink light, which answered the question by filling the space
// the drone was being flown into, so the pilot read the mark from inside it at
// the very height they were trying to hold. Hollow, and fading out above the
// circuit, the mark is the FOOT and the column is only what makes the foot
// visible from the far side of the pad. The ring's middle is cut out for the
// last mile of the same reasoning: the drone hovers over the centre of its own
// mark, so the centre is the part hidden under the airframe.
//
// The painted LETTERS stay, and the beacon does not replace them — the two
// answer different questions and the module needs both. A letter says WHICH of
// sixteen identical white spheres this is, which is what the step row and the
// hint mean when they say "Corner C"; the light says how close is close enough,
// which no letter can. They were taken off once, on the reasoning that a corner
// carrying a light does not need a name as well. It does: without them the row
// names a corner the field does not, and the pilot is left counting markers.
/** How high the circuit is flown, in metres.
 *
 *  Higher than the standard 1.8 m hover, and it is a question of SEEING rather
 *  than of flying: the corners are marked on the deck, and from 1.8 m the far
 *  ones are read edge-on across the pad. From here the pilot is looking down at
 *  the shape. The checkpoints move up with it — they are judged in 3-D — and so
 *  does the point the demonstration flies from.
 */
const FLY_AT = 3.3;

const CORNERS = [
  marker(14, 'Corner A', { tag: 'A', height: FLY_AT, beacon: true }), // front-right
  marker(2, 'Corner B', { tag: 'B', height: FLY_AT, beacon: true }), //  back-right
  marker(6, 'Corner C', { tag: 'C', height: FLY_AT, beacon: true }), //  back-left
  marker(10, 'Corner D', { tag: 'D', height: FLY_AT, beacon: true }), // front-left
] as const;
/** The loop closes where it began. Named as a RETURN, not as another corner:
 *  the intro card lays the route out as a numbered flow, and "Corner A again"
 *  sitting in the fourth slot of a three-corner shape reads as a fourth corner
 *  the pilot has not been told about. */
const ROUTE = [...CORNERS, { ...CORNERS[0], label: 'Return to Corner A' }] as const;

/** Where the drone starts the circuit from: the hover over the "H". */
const START: readonly [number, number, number] = [
  ACADEMY_PAD.center[0],
  FLY_AT,
  ACADEMY_PAD.center[1],
];

/** How far off a side counts as cutting the corner, in metres. */
const SIDE_TOL = 3;

export const squareLesson: Lesson = {
  id: 'square',
  order: 9,
  title: 'Square Circuit',
  subtitle: 'Four straight sides, four square corners',

  explain: {
    title: 'Flying a Square',
    body: [
      'Fly the four corners in order. Do not cut across the middle.',
      'Each side uses one stick: forward, left, back, right.',
    ],
  },

  route: ROUTE,
  hoverHeight: FLY_AT,

  // The row lists what the pilot does, in order — the two that get the drone
  // up, then the corners.
  stages: [
    ...PREFLIGHT_STAGES,
    { label: 'Out to A' },
    { label: 'Side to B' },
    { label: 'Side to C' },
    { label: 'Side to D' },
    { label: 'Close at A' },
  ],

  demo: [
    ...preflightDemo('SPACE — it climbs to the circuit height on its own'),
    ...afterPreflightDemo(
      planDemo(
        routeLegs(
          ROUTE,
          [
            { caption: 'Out to A', arrive: 'Stop square on it' },
            { caption: 'Side 1 — one stick only', arrive: 'Stop on B' },
            { caption: 'Side 2 — one stick only', arrive: 'Stop on C' },
            { caption: 'Side 3 — one stick only', arrive: 'Stop on D' },
            { caption: 'Side 4 — back to A, the loop is closed', arrive: 'One clean square' },
          ],
          undefined,
          { from: START },
        ),
        { from: START },
      ),
    ),
  ],

  practice: {
    prompt: 'Arm, take off, then fly A, B, C and D in order along the sides, and back to A',
    hint: 'Press ENTER to arm',
  },

  // The circuit is flown on pitch and roll, so those go first — but the left
  // gimbal is not empty just because today's drill does not name it. A module
  // keeps every control the modules before it taught, and without the throttle
  // and yaw pairs the caps under the left stick vanish from Module 7 onward: the
  // pilot is shown a stick they were taught to use and then told nothing about
  // it, on the very lessons where they are holding height through a whole lap.
  keys: [...PREFLIGHT_KEYS, ...KEYS_PITCH, ...KEYS_ROLL, ...KEYS_THROTTLE, ...KEYS_YAW],

  tips: [
    'Stop at each corner before the next side.',
    'A side needs one stick. Two means you have drifted off.',
  ],
  commonMistakes: ['Cutting across the middle.', 'Making the corners round.'],

  validate: (p, mem) =>
    withPreflight(p, mem, (p, mem) => {
      // The circuit walks on its OWN cursor, and the step row is written from
      // it — see `ROUTE_CURSOR`. Walked on `mem.wp` instead, the preflight
      // wrapper walks it too, and the square scored itself complete three
      // frames after lift-off with the drone still over the "H".
      const r = flyRoute(mem, p.position, ROUTE, { key: ROUTE_CURSOR });
      mem.wp = r.next;
      if (r.complete) return { done: true, progress: 1, hint: 'Square complete', cue: [] };

      // How far off the side being flown. The first leg runs from the pad out to
      // Corner A and is not part of the square, so it is not judged.
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
            ? 'Last side — close the square back at Corner A'
            : `Fly the side to ${target.label}`,
        cue: cueBetween(from, target.at),
      };
    }),

  stars: [
    {
      stars: 3,
      text: 'Off the pad, sides within 2.2 m, lap under 70s, nothing touched',
      test: ({ touches, timeSec, collisions, smoothness, mem }) =>
        collisions === 0 &&
        touches === 0 &&
        (mem.cut ?? 0) <= 2.2 &&
        timeSec <= 70 &&
        smoothness >= 0.3,
    },
    {
      stars: 2,
      text: `Off the pad, sides within ${SIDE_TOL} m, lap under 105s`,
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.cut ?? 0) <= SIDE_TOL && timeSec <= 105,
    },
  ],

  practiceTimeout: 70,
};

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
// The corners are three markers already standing in the ring, and each carries a
// BALL of light drawn at the checkpoint's own acceptance radius — so the pink is
// not a token near the corner, it IS the corner: inside the light is scored and
// outside it is not, and the turn is made by flying INTO it rather than by
// judging a distance to a 0.9 m sphere from three metres above it.
//
// The ball replaces two things that stood here. A painted LETTER on the deck,
// which answered "which of sixteen identical white spheres" but said nothing
// about how close was close enough; and, before that, a PILLAR — the same volume
// drawn as a column standing on the deck. The column is the better answer to
// "which marker", because it has a foot; the ball is the better answer to "am I
// there", because it is the shape the checkpoint actually is. This module wants
// the second question answered.
//
// What that costs, and it is worth knowing: the balls go OUT as they are taken,
// so the triangle comes apart as it is flown. The letters used to stay up for
// the whole lesson for exactly that reason. What is left to hold the shape
// together is the step row, the intro card's numbered flow, and the corner still
// ahead — Corner A's light survives the first pass, because the loop closes on
// it, so there is always a lit corner to be heading for.
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
  marker(12, 'Corner A', { height: FLY_AT, orb: true }), // the apex, straight ahead
  marker(6, 'Corner B', { height: FLY_AT, orb: true }), //  back-left
  marker(2, 'Corner C', { height: FLY_AT, orb: true }), //  back-right
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
  order: 11,
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

  hoverHeight: FLY_AT,

  stages: [
    ...PREFLIGHT_STAGES,
    { label: 'Out to A' },
    { label: 'Side to B' },
    { label: 'Side to C' },
    { label: 'Close at A' },
  ],

  demo: [
    ...preflightDemo('SPACE — it climbs to the circuit height on its own'),
    ...afterPreflightDemo(
      planDemo(
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
    ),
  ],

  practice: {
    prompt: 'Arm, take off, then fly A, B and C in order along the sides, and back to A',
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
    'Aim at the next corner before you start moving.',
    'Set both sticks for the side, then hold them.',
  ],
  commonMistakes: [
    'Flying the sides as L shapes.',
    'Floating past a corner instead of stopping on it.',
  ],

  validate: (p, mem) =>
    withPreflight(p, mem, (p, mem) => {
      // Its own cursor, not `mem.wp` — see `ROUTE_CURSOR`. The step row is
      // written from it below; the preflight wrapper then shifts that past Arm
      // and Take off.
      const r = flyRoute(mem, p.position, ROUTE, { key: ROUTE_CURSOR });
      mem.wp = r.next;
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
    }),

  stars: [
    {
      stars: 3,
      text: 'Off the pad, sides within 2.5 m, lap under 65s, nothing touched',
      test: ({ touches, timeSec, collisions, smoothness, mem }) =>
        collisions === 0 &&
        touches === 0 &&
        (mem.cut ?? 0) <= 2.5 &&
        timeSec <= 65 &&
        smoothness >= 0.3,
    },
    {
      stars: 2,
      text: `Off the pad, sides within ${SIDE_TOL} m, lap under 100s`,
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.cut ?? 0) <= SIDE_TOL && timeSec <= 100,
    },
  ],

  practiceTimeout: 70,
};

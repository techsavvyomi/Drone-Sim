import {
  CUE,
  angleDiffDeg,
  bearingTo,
  clamp01,
  flyRoute,
  latch,
  lineDeviation,
  type Lesson,
} from './types';
import { planDemo } from './demoFlight';
import { routeLegs } from './arena';
import { SQUARE_CIRCUIT } from './square';
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

// Module 10 — the SAME square as Module 9, flown on the nose.
//
// Module 9 is a crab: the square is aligned with the pad, so its four sides are
// forward, left, back and right, and the drone faces the same way the whole lap.
// That is the right first square — one side, one stick — and it is not how a
// circuit is actually flown. A real one turns: nose onto the next corner, then
// straight down the line, so the aircraft always goes where it is looking.
//
// So the shape is deliberately unchanged and only the TECHNIQUE is new. The
// corners, the height and the tolerance all come from `SQUARE_CIRCUIT`, which is
// Module 9's own geometry — a pilot who has just flown this shape sideways flies
// the identical shape again and feels the difference in the sticks rather than
// hunting for a new set of markers.
//
// What the drill actually asks for, at every one of the five legs:
//
//   1. TURN until the nose points at the corner being flown to. The hint counts
//      the error down in degrees and the A/D caps light for the way round.
//   2. Then PUSH FORWARD. Every side is the same stick from here — that is the
//      whole payoff, and it is why the roll keys are never the answer.
//
// Yaw is a rate command with nothing to brake, so overshooting a corner and
// setting off crooked is the mistake this module exists to drill out. Two
// numbers mark it. `crab` is the worst the nose wandered off the corner while a
// side was being flown, and `facedLegs` counts the legs that were genuinely
// turned onto — without the second, a pilot could crab the whole lap exactly as
// in Module 9, ignore every hint, and still take the corners.
const { route: ROUTE, start: START, height: FLY_AT, sideTol: SIDE_TOL } = SQUARE_CIRCUIT;

/** How close the nose must point at the corner for the turn to count, degrees.
 *
 *  Generous on purpose. The point is that the drone is FLYING at the corner
 *  rather than sliding at it; a 20 degree cone is unmistakably that, and asking
 *  for the yaw lesson's 12 would turn a circuit into four heading-hold drills. */
const FACE_TOL = 20;

/** Inside this many metres of the corner the nose is no longer marked.
 *
 *  A bearing to a point you are nearly on top of swings wildly for a few
 *  centimetres of drift, so the last stretch onto a corner would read as the
 *  nose flailing when nothing has changed. Comfortably outside the checkpoint's
 *  own 1.8 m acceptance, so the turn is still required for the whole side. */
const FACE_NEAR = 2.5;

export const squareYawLesson: Lesson = {
  id: 'square-yaw',
  order: 10,
  title: 'Square Circuit using Yaw',
  subtitle: 'Turn the nose onto every side',

  explain: {
    title: 'Flying a Square on the Nose',
    body: [
      'The same square as the last module, flown a different way.',
      'At each corner, turn the nose onto the next corner first.',
      'Then every side is one stick: push forward.',
    ],
  },

  route: ROUTE,
  hoverHeight: FLY_AT,

  // Five chips, exactly as Module 9 — this is the same lap — but each one names
  // the turn that now opens it. The row is not the place to spell the drill out
  // twice: a chip per turn AND per side is ten chips plus the preflight, and the
  // live one then sits off the end of a strip that does not scroll itself.
  stages: [
    ...PREFLIGHT_STAGES,
    { label: 'Turn, out to A' },
    { label: 'Turn, side to B' },
    { label: 'Turn, side to C' },
    { label: 'Turn, side to D' },
    { label: 'Turn, close at A' },
  ],

  // `face: true` is the whole difference in the demonstration: the planner puts
  // a closed-loop turn in front of every leg and solves the leg's sticks in the
  // heading it leaves behind, so what is flown on screen is a nose-first lap and
  // the yaw caps light on each corner rather than sitting dark all the way round.
  demo: [
    ...preflightDemo('SPACE — it climbs to the circuit height on its own'),
    ...afterPreflightDemo(
      planDemo(
        routeLegs(
          ROUTE,
          [
            { caption: 'Nose on A — now straight out to it', arrive: 'Stop square on it' },
            { caption: 'Side 1 — one stick, straight down the nose', arrive: 'Stop on B' },
            { caption: 'Side 2 — turn first, then the same stick', arrive: 'Stop on C' },
            { caption: 'Side 3 — turn first, then the same stick', arrive: 'Stop on D' },
            {
              caption: 'Side 4 — back to A, the loop is closed',
              arrive: 'One square, flown on the nose',
            },
          ],
          undefined,
          { from: START, face: true },
        ),
        { from: START },
      ),
    ),
  ],

  practice: {
    prompt: 'Arm, take off, then turn onto each corner and fly the side — A, B, C, D and back to A',
    hint: 'Press ENTER to arm',
  },

  // Yaw is today's pair, so it leads the row; the rest stay because a module
  // never takes back a control the course has already handed over. Roll is on
  // the row and is deliberately not the answer to anything here — reaching for
  // it IS the mistake, and a pilot cannot recognise that in a key they have not
  // been shown.
  keys: [...PREFLIGHT_KEYS, ...KEYS_YAW, ...KEYS_PITCH, ...KEYS_THROTTLE, ...KEYS_ROLL],

  tips: [
    'Turn first, then push forward. Never both at once.',
    'Short taps on A and D. Yaw speeds up fast.',
  ],
  commonMistakes: [
    'Sliding down a side instead of turning the nose onto it.',
    'Turning past the corner and setting off crooked.',
  ],

  validate: (p, mem) =>
    withPreflight(p, mem, (p, mem) => {
      // The circuit walks on its OWN cursor, not `mem.wp` — see `ROUTE_CURSOR`.
      const r = flyRoute(mem, p.position, ROUTE, { key: ROUTE_CURSOR });
      mem.wp = r.next;
      if (r.complete) {
        return { done: true, progress: 1, hint: 'Square complete, flown on the nose', cue: [] };
      }

      const target = ROUTE[r.next];
      const from = r.next === 0 ? START : ROUTE[r.next - 1].at;
      // How far off the side being flown. The first leg runs from the pad out to
      // Corner A and is not part of the square, so it is not judged.
      const off = lineDeviation(p.position, from[0], from[2], target.at[0], target.at[2]);
      if (r.next > 0) mem.cut = Math.max(mem.cut ?? 0, off);

      // The heading that points at the corner FROM WHERE THE DRONE IS, not from
      // the corner behind it. A pilot who has drifted off the line is told to
      // point at the mark they are flying to, which is both the honest answer
      // and the one that walks them back onto it.
      const err = angleDiffDeg(bearingTo(p.position, target.at), p.yaw);
      const adrift = Math.abs(err);
      const near =
        Math.hypot(target.at[0] - p.position[0], target.at[2] - p.position[2]) <= FACE_NEAR;

      // Turning LEFT is the direction of INCREASING heading — the controller
      // negates the yaw stick, so left is the negative stick and the A key. A
      // positive error therefore wants A, not D; the two were easy to swap here
      // and a cue pointing the wrong way round is worse than no cue at all.
      const turnCue = err > 0 ? CUE.yawLeft : CUE.yawRight;

      // Latched per leg: yaw drifts, and once the nose has been put on the
      // corner the drill has moved on to flying the side. Counting the legs that
      // latch is what stops the whole lap being crabbed through the hints.
      const key = `face${r.next}`;
      if (!mem[key] && adrift <= FACE_TOL) mem.facedLegs = (mem.facedLegs ?? 0) + 1;
      const faced = latch(mem, key, adrift <= FACE_TOL);

      if (!faced && !near) {
        return {
          done: false,
          progress: clamp01(r.progress),
          hint: `Turn the nose onto ${target.label} — ${adrift.toFixed(0)}° to go`,
          cue: turnCue,
        };
      }

      // Only once the leg has been turned onto: before that the error is the
      // turn itself, and marking it would score every corner as a crab.
      if (!near) mem.crab = Math.max(mem.crab ?? 0, adrift);

      const wandered = r.next > 0 && off > SIDE_TOL;
      const swung = !near && adrift > FACE_TOL * 1.5;
      return {
        done: false,
        progress: clamp01(r.progress),
        hint: wandered
          ? 'Off the side. Get back on the line, do not cross the middle'
          : swung
            ? `Nose has swung off ${target.label}. Line it up again`
            : r.next === ROUTE.length - 1
              ? 'Last side — close the square back at Corner A'
              : `Nose is on ${target.label}. Push forward`,
        // Once the nose is on the corner there is only ever one stick left, and
        // it is the same one on all four sides. That is the lesson.
        cue: swung ? turnCue : CUE.forward,
      };
    }),

  // Slower than Module 9's 70 s and 105 s, and it has to be: five turns at a
  // rate-commanded yaw, each with a settle before the side can start, is most of
  // half a minute that the crabbed lap never spends.
  stars: [
    {
      stars: 3,
      text: 'Every side turned onto, nose within 25°, sides within 2.2 m, lap under 95s, nothing touched',
      test: ({ touches, timeSec, collisions, smoothness, mem }) =>
        collisions === 0 &&
        touches === 0 &&
        (mem.facedLegs ?? 0) >= ROUTE.length &&
        (mem.crab ?? 0) <= 25 &&
        (mem.cut ?? 0) <= 2.2 &&
        timeSec <= 95 &&
        smoothness >= 0.3,
    },
    {
      stars: 2,
      text: `At least three sides turned onto, sides within ${SIDE_TOL} m, lap under 140s`,
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 &&
        (mem.facedLegs ?? 0) >= 3 &&
        (mem.cut ?? 0) <= SIDE_TOL &&
        timeSec <= 140,
    },
  ],

  practiceTimeout: 70,
};

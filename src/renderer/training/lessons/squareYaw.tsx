import {
  CUE,
  angleDiffDeg,
  bearingTo,
  clamp01,
  flyRoute,
  latch,
  lineDeviation,
  type Checkpoint,
  type DemoStep,
  type Lesson,
} from './types';
import {
  DEFAULT_GAP,
  DEFAULT_STICK,
  MIN_TURN_DEG,
  solveLeg,
  yawTime,
  YAW_SETTLE,
  YAW_STICK,
} from './demoFlight';
import { SQUARE_CIRCUIT } from './square';
import {
  KEYS_PITCH,
  KEYS_ROLL,
  KEYS_THROTTLE,
  KEYS_YAW,
  PREFLIGHT_DEMO_SEC,
  PREFLIGHT_KEYS,
  PREFLIGHT_STAGES,
  ROUTE_CURSOR,
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
// The lap opens with a leg that has no turn in it at all — see `ENTRY`. Then,
// at every one of the five legs that follow, the drill asks for:
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
const { route: CIRCUIT, start: START, height: FLY_AT, sideTol: SIDE_TOL } = SQUARE_CIRCUIT;

/** How far out in front of the pad the circuit is entered, in metres.
 *
 *  A real push on the pitch stick rather than a nudge, and comfortably short of
 *  the A-D side of the square (6.8 m out), so the entry point stays inside the
 *  circuit and the turn onto Corner A is still a turn worth making — about 60
 *  degrees from here, against 35 from over the "H". */
const LEAD_OUT = 4;

/**
 * Where the lap is entered from: straight out in front of the pad.
 *
 * Module 10 is "turn, THEN push forward", and until this leg existed the very
 * first thing the pilot did after the take-off was a turn. The forward stick —
 * the half of the pair that actually flies every side — did not appear until
 * Corner A had already been lined up, so the module introduced its two halves
 * in the opposite order to the one it teaches. This leg puts the push first:
 * leave the nose exactly where the take-off left it, one press forward, and
 * only then start taking corners.
 *
 * It sits on the spawn heading (yaw 0 faces -Z), which is the way the drone is
 * already pointing and the way the pilot is looking from behind the pad, so
 * there is genuinely no turn to make here — and the validator does not ask for
 * one, see `r.next === 0` below.
 *
 * A beacon and NO letter. It is a place to get to, not a corner of the square,
 * and the four letters painted on the deck have to go on meaning the four
 * corners; a fifth lettered mark inside the shape would read as a fifth corner.
 */
const ENTRY: Checkpoint = {
  label: 'Out front',
  at: [START[0], FLY_AT, START[2] - LEAD_OUT],
  reach: 1.8,
  mark: 'marker',
  markSize: 0.9,
  color: '#e2e8f0',
  beacon: true,
};

/** The entry leg, then Module 9's square unchanged. */
const ROUTE: readonly Checkpoint[] = [ENTRY, ...CIRCUIT];

/** How many legs are TURNED onto: everything but the entry. What the star test
 *  counts, so the entry — which latches as "faced" the instant it is judged,
 *  because the nose is already on it — cannot be sold as a turn. */
const TURNS = ROUTE.length - 1;

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

function buildSquareYawDemo(): DemoStep[] {
  const steps: DemoStep[] = [
    ...preflightDemo('SPACE — it climbs to the circuit height on its own'),
  ];
  let at = PREFLIGHT_DEMO_SEC;
  let heading = 0;
  let [x, , z] = START;

  const legs = [
    {
      to: ROUTE[0].at,
      turnStage: -1,
      pitchStage: 2,
      rt: 1,
      turnCaption: '',
      pitchCaption: 'Push forward — leave the nose where it is',
      arriveCaption: 'Stop out in front of the pad',
    },
    {
      to: ROUTE[1].at,
      turnStage: 3,
      pitchStage: 4,
      rt: 2,
      turnCaption: 'Yaw right — turn the nose onto Corner A',
      pitchCaption: 'Pitch forward to Corner A',
      arriveCaption: 'Stop on Corner A',
    },
    {
      to: ROUTE[2].at,
      turnStage: 5,
      pitchStage: 6,
      rt: 3,
      turnCaption: 'Yaw right — turn the nose onto Corner B',
      pitchCaption: 'Pitch forward to Corner B',
      arriveCaption: 'Stop on Corner B',
    },
    {
      to: ROUTE[3].at,
      turnStage: 7,
      pitchStage: 8,
      rt: 4,
      turnCaption: 'Yaw right — turn the nose onto Corner C',
      pitchCaption: 'Pitch forward to Corner C',
      arriveCaption: 'Stop on Corner C',
    },
    {
      to: ROUTE[4].at,
      turnStage: 9,
      pitchStage: 10,
      rt: 5,
      turnCaption: 'Yaw right — turn the nose onto Corner D',
      pitchCaption: 'Pitch forward to Corner D',
      arriveCaption: 'Stop on Corner D',
    },
    {
      to: ROUTE[5].at,
      turnStage: 11,
      pitchStage: 12,
      rt: 6,
      turnCaption: 'Yaw right — turn the nose onto Corner A',
      pitchCaption: 'Pitch forward — close the square at Corner A',
      arriveCaption: 'One square, flown on the nose',
    },
  ];

  for (const leg of legs) {
    const dx = leg.to[0] - x;
    const dz = leg.to[2] - z;
    const dist = Math.hypot(dx, dz);
    const stick = DEFAULT_STICK;
    const { tAccel, tBrake } = solveLeg(dist, stick);

    if (leg.turnStage >= 0) {
      const want = Math.atan2(-dx / dist, -dz / dist);
      let turn = want - heading;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;

      if (Math.abs(turn) > MIN_TURN_DEG * (Math.PI / 180)) {
        const tTurn = yawTime(Math.abs(turn) / (Math.PI / 180), YAW_STICK) + YAW_SETTLE;
        steps.push({
          at,
          yawTo: want,
          stage: leg.turnStage,
          caption: leg.turnCaption,
        });
        steps.push({
          at: at + tTurn,
          yawTo: null,
          stage: leg.turnStage,
        });
        at += tTurn + DEFAULT_GAP;
        heading = want;
      }
    }

    steps.push({
      at,
      stick: { roll: 0, pitch: stick },
      stage: leg.pitchStage,
      caption: leg.pitchCaption,
    });
    steps.push({
      at: at + tAccel,
      stick: { roll: 0, pitch: -stick },
      stage: leg.pitchStage,
      caption: leg.arriveCaption,
      rt: leg.rt,
    });
    steps.push({
      at: at + tAccel + tBrake,
      stick: { roll: 0, pitch: 0 },
      stage: leg.pitchStage,
    });

    at += tAccel + tBrake + DEFAULT_GAP;
    [x, , z] = leg.to;
  }

  steps.push({
    at,
    stage: 13,
  });

  return steps.sort((a, b) => a.at - b.at);
}

export const squareYawLesson: Lesson = {
  id: 'square-yaw',
  order: 10,
  title: 'Square Circuit using Yaw',
  subtitle: 'Turn the nose onto every side',

  explain: {
    title: 'Flying a Square on the Nose',
    body: [
      'The same square as the last module, flown a different way.',
      'Push straight forward off the pad to get out onto the circuit.',
      'At each corner, turn the nose onto the next corner first.',
      'Then every side is one stick: push forward.',
    ],
  },

  route: ROUTE,
  hoverHeight: FLY_AT,

  stages: [
    ...PREFLIGHT_STAGES,
    { label: 'Pitch forward', cap: '↑' },
    { label: 'Yaw right', cap: 'D' },
    { label: 'Pitch forward A', cap: '↑' },
    { label: 'Yaw right', cap: 'D' },
    { label: 'Pitch forward B', cap: '↑' },
    { label: 'Yaw right', cap: 'D' },
    { label: 'Pitch forward C', cap: '↑' },
    { label: 'Yaw right', cap: 'D' },
    { label: 'Pitch forward D', cap: '↑' },
    { label: 'Yaw right', cap: 'D' },
    { label: 'Close at A', cap: '↑' },
  ],

  demo: buildSquareYawDemo(),

  practice: {
    prompt:
      'Arm, take off, push straight forward off the pad, then turn onto each corner and fly the side — A, B, C, D and back to A',
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
      if (r.complete) {
        mem.wp = 11;
        return { done: true, progress: 1, hint: 'Square complete, flown on the nose', cue: [] };
      }

      // The ENTRY leg, and the only one with no turn in it: it runs straight out
      // on the heading the take-off left the drone at. The whole facing block
      // below is skipped rather than allowed to no-op, for two reasons — a yaw
      // cue on a leg with a nought-degree error points the pilot at a stick
      // that has nothing to do, and the leg would latch as "faced" on its first
      // frame and hand the star test a turn nobody made.
      if (r.next === 0) {
        mem.wp = 0;
        return {
          done: false,
          progress: clamp01(r.progress),
          hint: 'Push forward off the pad — leave the nose where it is',
          cue: CUE.forward,
        };
      }

      const target = ROUTE[r.next];
      const from = ROUTE[r.next - 1].at;
      // Is this leg one of the SQUARE'S OWN SIDES? The entry push and the leg out
      // to Corner A both cut across the inside of the shape to get onto it, so
      // neither is judged on the line — and both halves of that judgement, the
      // score and the hint, have to agree about which legs they cover.
      const onSquare = r.next > 1;
      // How far off the side being flown.
      const off = lineDeviation(p.position, from[0], from[2], target.at[0], target.at[2]);
      if (onSquare) mem.cut = Math.max(mem.cut ?? 0, off);

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
        mem.wp = (r.next - 1) * 2 + 1;
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

      mem.wp = (r.next - 1) * 2 + 2;
      const wandered = onSquare && off > SIDE_TOL;
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
  // half a minute that the crabbed lap never spends — plus the entry push, which
  // is another leg and another stop before the first corner is even reached.
  stars: [
    {
      stars: 3,
      text: 'Every side turned onto, nose within 25°, sides within 2.2 m, lap under 105s, nothing touched',
      test: ({ touches, timeSec, collisions, smoothness, mem }) =>
        collisions === 0 &&
        touches === 0 &&
        (mem.facedLegs ?? 0) >= TURNS &&
        (mem.crab ?? 0) <= 25 &&
        (mem.cut ?? 0) <= 2.2 &&
        timeSec <= 105 &&
        smoothness >= 0.3,
    },
    {
      stars: 2,
      text: `At least three sides turned onto, sides within ${SIDE_TOL} m, lap under 150s`,
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 &&
        (mem.facedLegs ?? 0) >= 3 &&
        (mem.cut ?? 0) <= SIDE_TOL &&
        timeSec <= 150,
    },
  ],

  practiceTimeout: 70,
};

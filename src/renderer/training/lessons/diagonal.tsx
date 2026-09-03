import { CUE, lineDeviation, type Lesson } from './types';
import { flyMission } from './mission';
import { planDemo } from './demoFlight';
import { gate, home, routeLegs } from './arena';
import { KEYS_PITCH, KEYS_ROLL, KEYS_THROTTLE, KEYS_YAW } from './preflight';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';

// Module 8 — Diagonal Run. Out to the RED CIRCLE on the right, 25 m away and
// off to one side, and back. Module 6 taught the roll stick alone; this holds
// pitch and roll TOGETHER for a full run, and scores the line.
//
// Flown as a whole flight, like Module 7: arm, take off, out, back, land. The
// checkpoint row carries the pilot through it, and the landing is the step the
// screen has to ask for, because by then nothing else is.
//
// TWO sticks, and only those two. The throttle used to be a third — the target
// stood well above the hover and the module asked the pilot to climb to it — but
// the lesson is the RATIO between pitch and roll, and a third channel moving at
// the same time is a different exercise.
//
// The circle is 3.2 m up, and the pilot still never touches the throttle: the
// module takes off to the circle's OWN height (`hoverHeight`), so SPACE delivers
// the aircraft at the height of the opening and the run out is flat. That is the
// same trick the shape circuits use, and it is what lets the checkpoint sit in
// the middle of the gate instead of somewhere under it.
//
// It is flown THROUGH, not stopped at. A circle is a hole, and the pass is the
// exercise — so the checkpoint carries the gate's axis, the demonstration lines
// up on it and carries out the far side rather than parking in the frame, and
// what scores is being inside the OPENING rather than inside a sphere wide
// enough to hang out past the ring.
//
// A BALL of light in the opening instead of a letter beside it, the way Module 7
// marks its gate. The exercise here is the PASS, not the name — there is one
// target and then the way home — so a letter answers a question nobody is
// asking, while the ball answers "where exactly, and did I get it". Sitting on
// the checkpoint, it now hangs in the middle of the circle, which is the thing
// the pilot flies at.
//
// `tag` stays, but only for the MAP. The letter was still being painted in the
// arena — twice, in fact: the ball writes the name in its own middle and the
// guide hung a second badge over it — so the module that says it marks its gate
// with a light was showing a light with an "A" stamped across it. `tagMapOnly`
// is what the paragraph above always meant: nothing on the field, and the
// minimap still names the checkpoint.
const TARGET = gate('red-right', 'Red circle', {
  ease: 1.4,
  through: true,
  tag: 'A',
  tagMapOnly: true,
  orb: true,
});
/** The height the run is flown at: the circle's own centre, so the pass goes
 *  through the middle of the opening and the pilot holds one height throughout.
 *  Read off the gate rather than typed, so moving the gate moves the lesson. */
const FLY_AT = TARGET.at[1];
const ROUTE = [TARGET, home('H', { height: FLY_AT })] as const;
/** Where the run starts from: the hover over the "H", at the circuit height. */
const START: readonly [number, number, number] = [
  ACADEMY_PAD.center[0],
  FLY_AT,
  ACADEMY_PAD.center[1],
];

const LEGS = [
  {
    hint: 'Both sticks together: forward and right, held in the same balance',
    cue: [...CUE.forward, ...CUE.right],
  },
  { hint: 'Reverse both, back down the same diagonal', cue: [...CUE.backward, ...CUE.left] },
];

/** The arm and the take-off each get their own beat. Firing them together — the
 *  demo used to arm and lift off at t = 0 — put the drone in the air before a
 *  single key had been shown being pressed. */
const ARM_AT = 1.2;
const TAKEOFF_AT = 4.0;
/** How many steps come before the route on the row: Arm, then Take off. */
const ROUTE_STEP = 2;

const FLIGHT = planDemo(
  routeLegs(
    ROUTE,
    [
      {
        caption: 'Forward and right together, one long diagonal',
        arrive: 'Straight through the middle of the circle',
      },
      { caption: 'Reverse both, back down the same diagonal', arrive: 'Back over the "H"' },
    ],
    0.45,
    { from: START },
  ).map((leg) => ({ ...leg, stage: (leg.stage ?? 0) + ROUTE_STEP })),
  { startAt: TAKEOFF_AT + 1.4 },
);
const LANDS_AT = (FLIGHT[FLIGHT.length - 1]?.at ?? 0) + 1.4;

export const diagonalLesson: Lesson = {
  id: 'diagonal',
  order: 8,
  title: 'Diagonal Run',
  subtitle: 'Pitch and roll together, then land',

  explain: {
    title: 'Flying a Diagonal',
    body: [
      'A diagonal is one move with both sticks together, not two.',
      'Push both the same amount and the path stays straight.',
    ],
  },

  route: ROUTE,
  hoverHeight: FLY_AT,

  // The steps of the flight, not its checkpoints — same as Module 7.
  stages: [
    { label: 'Arm', cap: 'ENTER' },
    { label: 'Take off', cap: 'SPACE' },
    { label: 'Out to the circle', cap: '↑ →' },
    { label: 'Back to the "H"', cap: '↓ ←' },
    { label: 'Land', cap: 'SPACE' },
  ],

  demo: [
    { at: 0.0, caption: 'On the pad, motors off' },
    {
      at: ARM_AT,
      stage: 0,
      cmd: 'arm',
      key: 'Enter',
      caption: 'ENTER: armed and live, still on the ground',
    },
    {
      at: TAKEOFF_AT,
      stage: 1,
      cmd: 'takeoffLand',
      key: 'Space',
      caption: "SPACE: it climbs to the circle's height on its own",
    },
    ...FLIGHT,
    {
      at: LANDS_AT,
      stage: ROUTE_STEP + ROUTE.length,
      // On the "H", not merely at the time the plan said it would be — a 72 m
      // out-and-back is long enough to arrive late.
      waitNear: { x: ACADEMY_PAD.center[0], z: ACADEMY_PAD.center[1], reach: 3 },
      cmd: 'takeoffLand',
      key: 'Space',
      caption: 'Back over the "H". SPACE puts it down',
    },
    {
      at: LANDS_AT + 3.0,
      cmd: 'disarm',
      key: 'Enter',
      caption: 'Motors off. The ratio never changed',
    },
  ],

  practice: {
    prompt: 'Arm, take off, diagonal through the red circle and back, then land',
    hint: 'Press ENTER to arm',
  },

  // The two sticks the lesson is about, plus the two keys that start and end
  // any flight. The throttle caps used to sit here as well, which made a lesson
  // about holding ONE ratio look like a lesson about three channels at once.
  // The DRILL is two sticks and stays two sticks — see the header; a third
  // channel moving through the run is a different exercise. The ROW is not the
  // drill, though. It is what the pilot has, and the throttle and yaw pairs are
  // both taught by now, so leaving them off emptied the left gimbal on a module
  // flown level for 25 m — a pilot who drifts off height or off heading was
  // being shown a stick with nothing under it and left to guess.
  keys: [
    { code: 'Enter', label: 'ENTER', hint: 'Arm' },
    { code: 'Space', label: 'SPACE', hint: 'Take Off / Land' },
    ...KEYS_PITCH,
    ...KEYS_ROLL,
    ...KEYS_THROTTLE,
    ...KEYS_YAW,
  ],

  tips: [
    'Move both sticks together, then leave them alone.',
    'Bring both back together. One at a time bends the line.',
  ],
  commonMistakes: [
    'Moving one stick first, which bends the line into an L.',
    'Letting go of one stick before the other.',
  ],

  validate: (p, mem) => {
    if (mem.airborne) {
      mem.drift = Math.max(
        mem.drift ?? 0,
        lineDeviation(p.position, 0, 0, TARGET.at[0], TARGET.at[2]),
      );
    }
    return flyMission(p, mem, ROUTE, LEGS);
  },

  stars: [
    {
      stars: 3,
      text: 'Within 3 m of the line, under 75s, nothing touched',
      test: ({ touches, timeSec, collisions, mem }) =>
        collisions === 0 && touches === 0 && (mem.drift ?? 99) <= 3 && timeSec <= 75,
    },
    {
      stars: 2,
      text: 'Within 6 m of the line',
      test: ({ collisions, mem }) => collisions === 0 && (mem.drift ?? 99) <= 6,
    },
  ],

  practiceTimeout: 60,
};

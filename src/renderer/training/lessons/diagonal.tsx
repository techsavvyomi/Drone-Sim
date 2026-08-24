import { CUE, lineDeviation, type Lesson } from './types';
import { flyMission } from './mission';
import { planDemo } from './demoFlight';
import { HOVER, gate, home, routeLegs } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';

// Module 8 — Diagonal Run. The long diagonal of the arena: the green rectangle
// away to the right, 36 m out. Module 6 taught the roll stick alone; this holds
// pitch and roll TOGETHER for a full run, and scores the line.
//
// Flown as a whole flight, like Module 7: arm, take off, out, back, land. The
// checkpoint row carries the pilot through it, and the landing is the step the
// screen has to ask for, because by then nothing else is.
//
// TWO sticks, and only those two. The throttle used to be a third — the gate
// stands 5 m up and the module asked the pilot to climb to it — but the lesson
// is the RATIO between pitch and roll, and a third channel moving at the same
// time is a different exercise. It is flown level in altitude hold now, judged
// at hover height the way Module 5 judges its gate, and it takes off and lands
// on the SPACE sequences from Modules 1 and 2 like Module 7 does.
const TARGET = gate('green-right', 'Green gate', { ease: 1.4, height: HOVER, tag: 'A' });
const ROUTE = [TARGET, home('H')] as const;

const LEGS = [
  {
    hint: 'Both sticks together — forward and right, held in the same balance',
    cue: [...CUE.forward, ...CUE.right],
  },
  { hint: 'Reverse both — back down the same diagonal', cue: [...CUE.backward, ...CUE.left] },
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
        caption: 'Forward and right together — one long diagonal',
        arrive: 'Both sticks back to stop at the gate',
      },
      { caption: 'Reverse both — back down the same diagonal', arrive: 'Back over the "H"' },
    ],
    0.45,
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
      'A diagonal is one move with both sticks held together, not two moves.',
      'ENTER to arm, SPACE to take off, both sticks out to the green gate and back, SPACE to land.',
      'Hold the same balance between the sticks and the path stays straight.',
    ],
  },

  route: ROUTE,

  // The steps of the flight, not its checkpoints — same as Module 7.
  stages: [
    { label: 'Arm', cap: 'ENTER' },
    { label: 'Take off', cap: 'SPACE' },
    { label: 'Out to the gate', cap: '↑ →' },
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
      caption: 'ENTER — armed and live, still on the ground',
    },
    {
      at: TAKEOFF_AT,
      stage: 1,
      cmd: 'takeoffLand',
      key: 'Space',
      caption: 'SPACE — it climbs to a hover on its own',
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
    prompt: 'Arm, take off, diagonal to the green gate and back, then land',
    hint: 'Press ENTER to arm',
  },

  // The two sticks the lesson is about, plus the two keys that start and end
  // any flight. The throttle caps used to sit here as well, which made a lesson
  // about holding ONE ratio look like a lesson about three channels at once.
  keys: [
    { code: 'Enter', label: 'ENTER', hint: 'Arm' },
    { code: 'Space', label: 'SPACE', hint: 'Take Off / Land' },
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: [
    'Set both sticks together, then leave them alone.',
    'Reverse both together too. One at a time bends the line back.',
  ],
  commonMistakes: [
    'Letting one stick lead, so the line bends into an L.',
    'Easing off one stick before the other on the way back.',
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
      text: 'Hold the diagonal within 3 m, whole flight under 75 seconds, nothing touched',
      test: ({ touches, timeSec, collisions, mem }) =>
        collisions === 0 && touches === 0 && (mem.drift ?? 99) <= 3 && timeSec <= 75,
    },
    {
      stars: 2,
      text: 'Hold the diagonal within 6 m',
      test: ({ collisions, mem }) => collisions === 0 && (mem.drift ?? 99) <= 6,
    },
  ],

  practiceTimeout: 60,
};

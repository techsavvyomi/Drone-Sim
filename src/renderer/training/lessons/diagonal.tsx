import { CUE, lineDeviation, type Lesson } from './types';
import { flyMission } from './mission';
import { planDemo } from './demoFlight';
import { gate, home, routeLegs } from './arena';

// Module 7 — Diagonal Run. The long diagonal of the arena: the green rectangle
// away to the right, 36 m out and 5 m up. Module 5 taught the roll stick alone;
// this holds pitch and roll TOGETHER for a full run while the throttle is also
// working, and scores the line.
//
// Flown as a whole flight, like Module 6: arm, take off, out, back, land. The
// checkpoint row carries the pilot through it, and the landing is the step the
// screen has to ask for, because by then nothing else is.
const TARGET = gate('green-right', 'Green gate', { ease: 1.4 });
const ROUTE = [TARGET, home('H')] as const;

const LEGS = [
  {
    hint: 'Both sticks together — forward and right, climbing',
    cue: [...CUE.forward, ...CUE.right, ...CUE.throttleUp],
  },
  { hint: 'Reverse both — back down the same diagonal', cue: [...CUE.backward, ...CUE.left] },
];

const FLIGHT = planDemo(
  routeLegs(
    ROUTE,
    [
      {
        caption: 'Forward and right together, climbing — one long diagonal',
        arrive: 'Both sticks back to stop at the gate',
      },
      { caption: 'Reverse both — back down the same diagonal', arrive: 'Back over the "H"' },
    ],
    0.45,
  ),
);
const LANDS_AT = (FLIGHT[FLIGHT.length - 1]?.at ?? 0) + 1.4;

export const diagonalLesson: Lesson = {
  id: 'diagonal',
  order: 7,
  title: 'Diagonal Run',
  subtitle: 'Pitch and roll together, then land',

  explain: {
    title: 'Flying a Diagonal',
    body: [
      'A diagonal is one move with both sticks held together, not two moves.',
      'Arm, take off, fly out to the green gate on the diagonal, come back, then land.',
      'Hold the same balance between the sticks and the path stays straight.',
    ],
  },

  route: ROUTE,
  landing: true,

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm the drone' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    ...FLIGHT,
    { at: LANDS_AT, cmd: 'takeoffLand', key: 'Space', caption: 'Now land on the "H"' },
    { at: LANDS_AT + 3.0, cmd: 'disarm', key: 'Enter', caption: 'Down. The ratio never changed' },
  ],

  practice: {
    prompt: 'Arm, take off, diagonal to the green gate and back, then land',
    hint: 'Press ENTER to arm',
  },

  keys: [
    { code: 'Enter', label: 'ENTER', hint: 'Arm' },
    { code: 'KeyW', label: 'W', hint: 'Throttle Up' },
    { code: 'KeyS', label: 'S', hint: 'Throttle Down' },
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: [
    'Set both sticks together, then leave them alone.',
    'Add throttle early. Arrive at the height, not below it.',
  ],
  commonMistakes: [
    'Letting one stick lead, so the line bends into an L.',
    'Reaching the gate below its opening.',
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
      text: 'Hold the diagonal within 3 m, whole flight under 75 seconds',
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.drift ?? 99) <= 3 && timeSec <= 75,
    },
    {
      stars: 2,
      text: 'Hold the diagonal within 6 m',
      test: ({ collisions, mem }) => collisions === 0 && (mem.drift ?? 99) <= 6,
    },
  ],

  practiceTimeout: 60,
};

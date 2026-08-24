import { CUE, lineDeviation, type Lesson } from './types';
import { flyMission } from './mission';
import { planDemo } from './demoFlight';
import { gate, home, routeLegs } from './arena';

// Module 6 — Straight-Line Flight. The first module flown as a whole FLIGHT:
// arm it, take off, fly the line, bring it home and land. Modules 1 to 5 each
// drilled one piece of that; this is the first time the pieces are put together,
// which is why the drone is no longer handed over hovering.
//
// The far blue square stands 39 m out, long enough that a drone left to itself
// will wander, and the score is the worst sideways drift off the line.
const TARGET = gate('blue-far', 'Far blue gate', { ease: 1.4 });
const ROUTE = [TARGET, home('H')] as const;

const LEGS = [
  { hint: 'Fly straight out to the far blue gate', cue: CUE.forward },
  { hint: 'Straight back down the same line to the "H"', cue: CUE.backward },
];

const FLIGHT = planDemo(
  routeLegs(
    ROUTE,
    [
      {
        caption: 'Pitch forward — one long straight run at the far gate',
        arrive: 'Pitch back to stop at the gate',
      },
      { caption: 'Straight back down the same line', arrive: 'Back over the "H"' },
    ],
    0.45,
  ),
);
const LANDS_AT = (FLIGHT[FLIGHT.length - 1]?.at ?? 0) + 1.4;

export const straightLineLesson: Lesson = {
  id: 'straight-line',
  order: 6,
  title: 'Straight-Line Flight',
  subtitle: 'Take off, fly the line, land',

  explain: {
    title: 'Flying a Straight Line',
    body: [
      'Four steps: arm, take off, fly straight out to the far blue gate and back, then land.',
      'The line you have to hold is drawn on the field. Stay on it.',
      'You are scored on how far you drift sideways, not on how fast you get there.',
    ],
  },

  route: ROUTE,
  landing: true,

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm the drone' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    ...FLIGHT,
    { at: LANDS_AT, cmd: 'takeoffLand', key: 'Space', caption: 'Now land on the "H"' },
    { at: LANDS_AT + 3.0, cmd: 'disarm', key: 'Enter', caption: 'Down. One clean line each way' },
  ],

  practice: {
    prompt: 'Arm, take off, out to the far gate and back, then land',
    hint: 'Press ENTER to arm',
  },

  keys: [
    { code: 'Enter', label: 'ENTER', hint: 'Arm' },
    { code: 'KeyW', label: 'W', hint: 'Throttle Up' },
    { code: 'KeyS', label: 'S', hint: 'Throttle Down' },
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
  ],

  tips: [
    'Correct early and gently. A late correction becomes a swerve.',
    'Keep the gate centred as you fly at it.',
  ],
  commonMistakes: [
    'Letting a small drift build over the whole run.',
    'Forgetting to land at the end.',
  ],

  validate: (p, mem) => {
    // Drift off the line between the pad and the gate — the whole point of the
    // lesson, measured on the way out AND on the way back.
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
      text: 'Stay within 2.5 m of the line, whole flight under 75 seconds',
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.drift ?? 99) <= 2.5 && timeSec <= 75,
    },
    {
      stars: 2,
      text: 'Stay within 5 m of the line',
      test: ({ collisions, mem }) => collisions === 0 && (mem.drift ?? 99) <= 5,
    },
  ],

  practiceTimeout: 60,
};

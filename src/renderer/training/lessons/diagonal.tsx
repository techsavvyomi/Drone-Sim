import { clamp01, flyRoute, lineDeviation, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { gate, home, routeLegs } from './arena';
import { useFlightStore } from '../../state/flightStore';

// Module 7 — Diagonal Run. The long diagonal of the arena: the green rectangle
// away to the right, 36 m out and 5 m up. Module 5 taught two sticks held
// together over a short hop; this one holds the same ratio for a full run while
// the throttle is also working, and scores the line.
const TARGET = gate('green-right', 'Green gate', { ease: 1.4 });
const ROUTE = [TARGET, home('H')] as const;

export const diagonalLesson: Lesson = {
  id: 'diagonal',
  order: 7,
  title: 'Diagonal Run',
  subtitle: 'Corner to corner, holding the line',

  explain: {
    title: 'Flying a Diagonal',
    body: [
      'A diagonal is not two moves. It is one move with both sticks held in proportion.',
      'The green rectangle out to the right is the arena’s longest diagonal, and the highest gate on the field.',
      'Hold the ratio between pitch and roll and the path stays straight; change it and the line bends.',
      'Climb as you go — arriving level with the opening is part of the run.',
    ],
  },

  route: ROUTE,

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    ...planDemo(
      routeLegs(
        ROUTE,
        [
          {
            caption: 'Forward and right together, climbing — one long diagonal',
            arrive: 'Both sticks back to stop at the gate',
          },
          { caption: 'Reverse both — back down the same diagonal', arrive: 'Home — the ratio never changed' },
        ],
        0.45,
      ),
    ),
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Diagonal out to the green gate, then back',
    hint: 'Hold pitch and roll in the same ratio, and climb',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
    { code: 'KeyW', label: 'W', hint: 'Throttle Up' },
    { code: 'KeyS', label: 'S', hint: 'Throttle Down' },
  ],

  tips: ['Set both sticks together and then leave them alone.', 'Add throttle early — arrive at the height, not below it.'],
  commonMistakes: ['Letting the ratio slip so the line bends.', 'Reaching the gate below its opening.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.drift = Math.max(
      mem.drift ?? 0,
      lineDeviation(p.position, 0, 0, TARGET.at[0], TARGET.at[2]),
    );

    const r = flyRoute(mem, p.position, ROUTE);
    if (r.complete) return { done: true, progress: 1, hint: 'Home — diagonal held' };
    return {
      done: false,
      progress: clamp01(r.progress),
      hint: r.next === 0 ? 'Both sticks together, out to the green gate' : 'Back down the same diagonal',
    };
  },

  score: ({ timeSec, collisions, mem }) => {
    if (collisions > 0) return 1;
    const drift = mem.drift ?? 99;
    if (drift <= 3 && timeSec <= 55) return 3;
    if (drift <= 6) return 2;
    return 1;
  },

  practiceTimeout: 55,
};

import { clamp01, flyRoute, lineDeviation, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { gate, home, routeLegs } from './arena';
import { useFlightStore } from '../../state/flightStore';

// Module 6 — Straight-Line Flight. Module 2 taught "reach the gate"; this one is
// about the path taken to get there. The far blue square stands 39 m out, which
// is long enough that a drone left to itself will wander — and the score is the
// worst sideways drift off the line, not the time.
const TARGET = gate('blue-far', 'Far blue gate', { ease: 1.4 });
const ROUTE = [TARGET, home('H')] as const;

export const straightLineLesson: Lesson = {
  id: 'straight-line',
  order: 6,
  title: 'Straight-Line Flight',
  subtitle: 'Out and back without wandering',

  explain: {
    title: 'Flying a Straight Line',
    body: [
      'Reaching a marker is easy. Reaching it in a straight line is the skill.',
      'The far blue square is nearly 40 m out — long enough for a drift to become a curve.',
      'Fly out to it and back, staying on the line between the "H" and the gate.',
      'You are scored on how far you drift sideways, not on how fast you get there.',
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
            caption: 'Pitch forward — one long straight run at the far gate',
            arrive: 'Pitch back to stop at the gate',
          },
          { caption: 'Straight back down the same line', arrive: 'Home — one clean line each way' },
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
    prompt: 'Out to the far blue gate and back, on the line',
    hint: 'Straight out — hold the line to the far gate',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: ['Correct early and gently — a late correction becomes a swerve.', 'Keep the gate centred as you fly at it.'],
  commonMistakes: ['Letting a small drift build over the whole run.', 'Zig-zagging while trying to correct.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    // Drift off the line between the pad and the gate — the whole point of the
    // lesson, measured on the way out AND on the way back.
    mem.drift = Math.max(
      mem.drift ?? 0,
      lineDeviation(p.position, 0, 0, TARGET.at[0], TARGET.at[2]),
    );

    const r = flyRoute(mem, p.position, ROUTE);
    if (r.complete) return { done: true, progress: 1, hint: 'Home — line held' };
    return {
      done: false,
      progress: clamp01(r.progress),
      hint: r.next === 0 ? 'Hold the line out to the far gate' : 'Straight back down the same line',
    };
  },

  score: ({ timeSec, collisions, mem }) => {
    if (collisions > 0) return 1;
    const drift = mem.drift ?? 99;
    if (drift <= 2.5 && timeSec <= 55) return 3;
    if (drift <= 5) return 2;
    return 1;
  },

  practiceTimeout: 55,
};

import { clamp01, flyRoute, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { gate, home, routeLegs } from './arena';
import { useFlightStore } from '../../state/flightStore';

// Module 2 — Pitch Control. Forward and back on one stick, flown to the blue
// square gate standing 16 m straight off the nose. It is the first thing a
// pilot sees from the pad and it is dead ahead, so "fly forward" needs no
// further explanation — and the small climb to its opening is the throttle
// lesson from Module 1 put to use.
const ROUTE = [gate('blue-near', 'Blue gate', { ease: 1.3 }), home('H')] as const;

export const pitchLesson: Lesson = {
  id: 'pitch',
  order: 2,
  title: 'Pitch Control',
  subtitle: 'Fly out to the marker, then back',

  explain: {
    title: 'Pitch Control',
    body: [
      'Pitch tilts the drone forward or backward to move it in that direction.',
      'The more you tilt, the faster it flies — ease off to slow down.',
      'Your goal: fly out to the blue square gate ahead, then return to the "H".',
      'The gate sits a little above hover height, so add a touch of throttle on the way.',
    ],
  },

  route: ROUTE,

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    ...planDemo(
      routeLegs(ROUTE, [
        {
          caption: 'Pitch forward — straight out to the blue gate',
          arrive: 'Pitch BACK to stop on it — levelling off only coasts',
        },
        { caption: 'Pitch back — return to the "H"', arrive: 'And forward again to stop' },
      ]),
    ),
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    // Take-off no longer arms on the pilot's behalf, so a lesson that drops the
    // student straight into the air has to arm the aircraft itself first.
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Fly out to the blue gate, then back to the "H"',
    hint: 'Pitch forward toward the blue gate',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'KeyW', label: 'W', hint: 'Throttle Up' },
    { code: 'KeyS', label: 'S', hint: 'Throttle Down' },
  ],

  tips: ['Keep the nose pointing straight ahead.', 'Level the drone to stop — don’t rely on drag alone.'],
  commonMistakes: ['Tilting too hard and overshooting the gate.', 'Forgetting to climb to the opening.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.wander = Math.max(mem.wander ?? 0, Math.abs(p.position[0]));

    const r = flyRoute(mem, p.position, ROUTE);
    if (r.complete) return { done: true, progress: 1, hint: 'Back home — nicely flown' };
    return {
      done: false,
      progress: clamp01(r.progress),
      hint: r.next === 0 ? 'Pitch forward to the blue gate' : 'Pitch back to the "H"',
    };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const wander = mem.wander ?? 0;
    if (wander <= 2.5 && timeSec <= 32 && smoothness >= 0.3) return 3;
    if (wander <= 5 && timeSec <= 55) return 2;
    return 1;
  },

  practiceTimeout: 45,
};

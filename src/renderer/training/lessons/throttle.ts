import { holdFor, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';

// Lesson 3 — Throttle. First continuous-control lesson: climb to a target
// altitude and hold it. In the default Altitude-Hold mode the throttle stick is
// spring-centred (centre holds height, up climbs, down descends).
const TARGET = 2.0;
const TOL = 0.2;
const HOLD_SEC = 3;

export const throttleLesson: Lesson = {
  id: 'throttle',
  order: 3,
  title: 'Throttle',
  subtitle: 'Control your altitude',

  explain: {
    title: 'Throttle & Altitude',
    body: [
      'Throttle changes the drone’s altitude.',
      'Push the throttle up to climb, pull it down to descend.',
      'Your goal: climb to 2 metres and hold it steady for 3 seconds.',
    ],
  },

  demo: [
    { at: 0.0, caption: 'Throttle controls altitude' },
    { at: 0.4, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.6, stick: { throttle: 0.7 }, key: 'KeyW', caption: 'Push up to climb toward 2 m' },
    { at: 5.6, stick: { throttle: 0.5 }, caption: 'Centre the stick to hold' },
    { at: 7.4, caption: 'Altitude locked at 2 m' },
  ],

  // Start the pilot already hovering so the lesson is about the throttle, not
  // the take-off (that was Practice's own drill elsewhere).
  setup: () => {
    useFlightStore.getState().requestTakeoffLand();
  },

  practice: {
    prompt: 'Climb to 2 m and hold for 3 seconds',
    hint: 'Increase throttle to climb',
  },

  keys: [
    { code: 'KeyW', label: 'W', hint: 'Climb' },
    { code: 'KeyS', label: 'S', hint: 'Descend' },
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };

    const err = Math.abs(p.altitude - TARGET);
    const inRange = err <= TOL;
    const held = holdFor(mem, 'hold', inRange, p.dt, HOLD_SEC);

    // Accumulate in-range error for the star rating.
    if (inRange) {
      mem.errSum = (mem.errSum ?? 0) + err * p.dt;
      mem.errT = (mem.errT ?? 0) + p.dt;
    }

    let hint: string;
    if (inRange) {
      const remaining = Math.max(0, HOLD_SEC - held * HOLD_SEC);
      hint = `Good! Hold this altitude — ${remaining.toFixed(1)}s`;
    } else if (p.altitude < TARGET - TOL) {
      hint = 'Increase throttle to climb';
    } else {
      hint = 'Reduce throttle to descend smoothly';
    }

    return { done: held >= 1, progress: held, hint };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const avgErr = mem.errT ? mem.errSum / mem.errT : TOL;
    if (avgErr <= 0.1 && timeSec <= 22 && smoothness >= 0.45) return 3;
    if (avgErr <= 0.15 && timeSec <= 40 && smoothness >= 0.2) return 2;
    return 1;
  },
};

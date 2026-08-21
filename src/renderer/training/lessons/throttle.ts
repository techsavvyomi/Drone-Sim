import { holdFor, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';

// Lesson (Module 4) — Throttle control. Climb to 2 m, descend to 1 m, then hold
// altitude. In the default Altitude-Hold mode the throttle stick is spring-
// centred: centre holds height, up climbs, down descends.
const CLIMB_TARGET = 2.0;
const HOLD_TARGET = 1.0;
const TOL = 0.2;
const HOLD_SEC = 4;

export const throttleLesson: Lesson = {
  id: 'throttle',
  order: 4,
  title: 'Throttle Control',
  subtitle: 'Master your altitude',

  explain: {
    title: 'Throttle & Altitude',
    body: [
      'Throttle changes the drone’s altitude — push up to climb, pull down to descend.',
      'Centre the stick to hold your current height.',
      'Your goal: climb to 2 m, come back down to 1 m, and hold it steady.',
    ],
  },

  demo: [
    { at: 0.0, caption: 'Throttle controls altitude' },
    { at: 0.4, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.4, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.6, stick: { throttle: 0.72 }, key: 'KeyW', caption: 'Push up — climb to 2 m' },
    { at: 5.6, stick: { throttle: 0.32 }, key: 'KeyS', caption: 'Ease down toward 1 m' },
    { at: 7.6, stick: { throttle: 0.5 }, caption: 'Centre the stick to hold' },
    { at: 9.2, caption: 'Altitude locked at 1 m' },
  ],

  // Start already hovering so the drill is about the throttle, not the take-off.
  setup: () => {
    const flight = useFlightStore.getState();
    // Takeoff no longer arms on the pilot's behalf, so a lesson that drops the
    // student straight into the air has to arm the aircraft itself first.
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Climb to 2 m, then descend to 1 m and hold',
    hint: 'Increase throttle to climb to 2 m',
  },

  keys: [
    { code: 'KeyW', label: 'W', hint: 'Climb' },
    { code: 'KeyS', label: 'S', hint: 'Descend' },
  ],

  tips: ['Use small, gentle inputs.', 'Avoid full throttle — you only need a nudge.'],
  commonMistakes: ['Over-correcting and porpoising up and down.', 'Slamming the throttle to the stops.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };

    // Stage 0: reach 2 m. Stage 1: descend to 1 m and hold.
    if ((mem.stage ?? 0) === 0) {
      if (Math.abs(p.altitude - CLIMB_TARGET) <= TOL) mem.stage = 1;
      const climb = Math.min(1, p.altitude / CLIMB_TARGET);
      return {
        done: false,
        progress: 0.4 * climb,
        hint: p.altitude < CLIMB_TARGET - TOL ? 'Increase throttle to climb to 2 m' : 'Good — now ease down to 1 m',
      };
    }

    const err = Math.abs(p.altitude - HOLD_TARGET);
    const inRange = err <= TOL;
    const held = holdFor(mem, 'hold', inRange, p.dt, HOLD_SEC);
    if (inRange) {
      mem.errSum = (mem.errSum ?? 0) + err * p.dt;
      mem.errT = (mem.errT ?? 0) + p.dt;
    }

    let hint: string;
    if (inRange) {
      hint = `Good! Hold at 1 m — ${Math.max(0, HOLD_SEC - held * HOLD_SEC).toFixed(1)}s`;
    } else if (p.altitude > HOLD_TARGET + TOL) {
      hint = 'Reduce throttle to descend to 1 m';
    } else {
      hint = 'A touch more throttle to hold 1 m';
    }

    return { done: held >= 1, progress: 0.4 + 0.6 * held, hint };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const avgErr = mem.errT ? mem.errSum / mem.errT : TOL;
    if (avgErr <= 0.1 && timeSec <= 28 && smoothness >= 0.4) return 3;
    if (avgErr <= 0.15 && timeSec <= 50 && smoothness >= 0.2) return 2;
    return 1;
  },
};

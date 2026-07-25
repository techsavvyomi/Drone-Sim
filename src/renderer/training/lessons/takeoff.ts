import { holdFor, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';

// Lesson (Module 3) — Takeoff. Arm on the ground, then apply smooth throttle to
// lift into a stable hover at a safe height. Distinct from Arm (which only idles
// the motors) and from Throttle (fine altitude control once airborne).
const MIN_ALT = 1.3;
const MAX_ALT = 2.6;
const HOLD_SEC = 1.5;

export const takeoffLesson: Lesson = {
  id: 'takeoff',
  order: 3,
  title: 'Takeoff',
  subtitle: 'Lift off smoothly',

  explain: {
    title: 'Takeoff',
    body: [
      'Arming only spins the motors — to fly you must apply throttle.',
      'Raise the throttle smoothly to lift off and climb to a safe height (1.5–2 m).',
      'Then ease back to centre to settle into a stable hover.',
    ],
  },

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 2.0, stick: { throttle: 0.66 }, key: 'KeyW', caption: 'Smooth throttle — lift off' },
    { at: 4.6, stick: { throttle: 0.5 }, caption: 'Ease to centre at ~1.8 m' },
    { at: 6.2, caption: 'Stable hover — takeoff complete' },
  ],

  // Arm on the ground; the pilot performs the take-off themselves.
  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
  },

  practice: {
    prompt: 'Take off and hold a steady hover at ~2 m',
    hint: 'Raise the throttle smoothly to lift off',
  },

  keys: [
    { code: 'KeyW', label: 'W', hint: 'Climb' },
    { code: 'KeyS', label: 'S', hint: 'Descend' },
  ],

  tips: ['Feed in throttle gradually — no jerks.', 'Keep the drone level as it leaves the ground.'],
  commonMistakes: [
    'Applying too much throttle and shooting up.',
    'Tilting the drone the instant it lifts off.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };

    const inBand = p.altitude >= MIN_ALT && p.altitude <= MAX_ALT;
    const steady = inBand && Math.abs(p.verticalSpeed) < 0.4;
    const held = holdFor(mem, 'hold', steady, p.dt, HOLD_SEC);

    let hint: string;
    if (p.altitude < MIN_ALT) hint = 'Raise the throttle smoothly to climb';
    else if (p.altitude > MAX_ALT) hint = 'Ease off — you are climbing too high';
    else hint = `Good — hold the hover ${Math.max(0, HOLD_SEC - held * HOLD_SEC).toFixed(1)}s`;

    return { done: held >= 1, progress: held, hint };
  },

  score: ({ timeSec, collisions, smoothness }) => {
    if (collisions > 0) return 1;
    if (smoothness >= 0.5 && timeSec <= 12) return 3;
    if (smoothness >= 0.25 && timeSec <= 25) return 2;
    return 1;
  },
};

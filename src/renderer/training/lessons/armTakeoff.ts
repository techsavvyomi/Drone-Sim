import { holdFor, type Lesson } from './types';

// Step 1 — Arm & Take Off. The two halves of getting airborne, taught as one
// action because that is how they are flown: arming alone does nothing visible
// any more (the motors stay stopped), so it only makes sense paired with the
// throttle that follows it.
const MIN_ALT = 1.3;
const MAX_ALT = 2.6;
const HOLD_SEC = 1.5;

export const armTakeoffLesson: Lesson = {
  id: 'arm-takeoff',
  order: 1,
  title: 'Arm & Take Off',
  subtitle: 'Spin up and leave the ground',

  explain: {
    title: 'Arming and Taking Off',
    body: [
      'Before a drone can fly it must be armed. Arming enables the flight controller.',
      'The motors will not turn at all until you arm — that is a safety feature, not a fault.',
      'Arming alone will not lift the drone. Raise the throttle smoothly to climb to about 2 m,',
      'then ease back to centre to settle into a steady hover.',
    ],
    durationHint: '15–20 seconds',
  },

  demo: [
    { at: 0.0, caption: 'Watch: press ENTER to arm' },
    { at: 0.8, cmd: 'arm', key: 'Enter', caption: 'ENTER → the aircraft is live' },
    { at: 2.4, caption: 'Armed — but nothing turns until you ask it to' },
    { at: 3.4, stick: { throttle: 0.66 }, key: 'KeyW', caption: 'Smooth throttle — lift off' },
    { at: 6.0, stick: { throttle: 0.5 }, caption: 'Ease to centre at ~1.8 m' },
    { at: 7.6, caption: 'Stable hover — you are flying' },
  ],

  practice: {
    prompt: 'Arm the drone, then take off to a steady hover',
    hint: 'Throttle centred — press ENTER to arm',
  },

  keys: [
    { code: 'Enter', label: 'ENTER', hint: 'Arm' },
    { code: 'KeyW', label: 'W', hint: 'Climb' },
    { code: 'KeyS', label: 'S', hint: 'Descend' },
  ],

  tips: [
    'Check the area is clear before arming, and keep hands away from the props.',
    'Feed the throttle in gradually — no jerks.',
    'Keep the drone level as it leaves the ground.',
  ],
  commonMistakes: [
    'Arming with the throttle stick pushed up — the interlock will refuse.',
    'Applying too much throttle and shooting up past the hover height.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };

    // Stage 1: get it armed. The interlock refuses with the throttle raised, so
    // say why rather than leaving the pilot pressing a key that does nothing.
    if (!p.armed && !mem.wasArmed) {
      if (p.throttle > 0.62) {
        mem.blocked = 1;
        return {
          done: false,
          progress: 0,
          hint: 'Throttle is up — centre it first (arming is blocked for safety)',
        };
      }
      return { done: false, progress: 0, hint: 'Throttle centred — press ENTER to arm' };
    }
    if (p.armed) mem.wasArmed = 1;

    // Stage 2: climb into the hover band and hold it.
    const inBand = p.altitude >= MIN_ALT && p.altitude <= MAX_ALT;
    const steady = inBand && Math.abs(p.verticalSpeed) < 0.4;
    const held = holdFor(mem, 'hold', steady, p.dt, HOLD_SEC);

    let hint: string;
    if (!p.armed) hint = 'Disarmed — press ENTER to arm again';
    else if (p.altitude < MIN_ALT) hint = 'Raise the throttle smoothly to climb';
    else if (p.altitude > MAX_ALT) hint = 'Ease off — you are climbing too high';
    else hint = `Good — hold the hover ${Math.max(0, HOLD_SEC - held * HOLD_SEC).toFixed(1)}s`;

    return { done: p.armed && held >= 1, progress: 0.25 + 0.75 * held, hint };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    if (mem.blocked) return 2; // tried to arm with the throttle up
    if (smoothness >= 0.5 && timeSec <= 16) return 3;
    if (smoothness >= 0.25 && timeSec <= 30) return 2;
    return 1;
  },

  practiceTimeout: 30,
};

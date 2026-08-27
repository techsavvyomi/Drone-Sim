import { CUE, clamp01, holdFor, latch, type Lesson } from './types';
import { HOVER, home } from './arena';

// Module 3 — Throttle. The drone is handed over already armed and already
// hovering, so the whole lesson is one stick: down to the low band, hold it
// there, then back up to the hover.
//
// Three steps, and the middle one matters most. Without the hold, "down" and
// "up" are two taps and the pilot never learns the thing the throttle actually
// asks of them — that centring the stick is itself a command.
const LOW_MIN = 0.7;
const LOW_MAX = 1.3;
/** Below this the descent has gone too far and the pilot needs to ease back up. */
const TOO_LOW = 0.55;
const HIGH_MIN = 1.6;
const HIGH_MAX = 2.6;
const HOLD_SEC = 1.2;
const BACK_SEC = 0.8;

export const throttleLesson: Lesson = {
  id: 'throttle',
  order: 3,
  title: 'Throttle Up & Down',
  subtitle: 'One stick, down and back up',

  explain: {
    title: 'Throttle Control',
    body: [
      'The throttle is the only control that changes height.',
      'You are already in the air. Go down to about a metre, hold, then come back up.',
    ],
    durationHint: '20 seconds',
  },

  // Nothing to fly to, so the guide simply rings the pad being hovered over.
  route: [home('H')],

  stages: [
    { label: 'Come down', cap: 'S' },
    { label: 'Hold steady' },
    { label: 'Throttle up', cap: 'W' },
  ],

  // Opens at a hover: the drone is placed there rather than flying up to it,
  // so the lesson starts on its own drill instead of on a take-off.
  startAirborne: true,

  demo: [
    { at: 0.0, stage: 0, caption: 'Armed and hovering at about 2 m' },
    { at: 2.4, stick: { throttle: 0.34 }, key: 'KeyS', caption: 'Throttle DOWN — it comes down' },
    { at: 4.8, stage: 1, stick: { throttle: 0.5 }, caption: 'Centre the stick — it holds height' },
    { at: 6.2, caption: 'Steady, about a metre up' },
    {
      at: 7.4,
      stage: 2,
      stick: { throttle: 0.66 },
      key: 'KeyW',
      caption: 'Throttle UP — the same stick, the other way',
    },
    { at: 9.4, stick: { throttle: 0.5 }, caption: 'Centre again, and it holds at the top' },
  ],

  practice: {
    prompt: 'Down to about a metre, hold it, then back up',
    hint: 'Throttle down to come down',
  },

  keys: [
    { code: 'KeyS', label: 'S', hint: 'Throttle Down' },
    { code: 'KeyW', label: 'W', hint: 'Throttle Up' },
  ],

  tips: ['Move the stick a little at a time.', 'Put the stick back in the middle to hold height.'],
  commonMistakes: [
    'Pushing the throttle all the way down and landing.',
    'Never centring the stick, so the height keeps moving.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };

    // Landing ends the attempt. This is the one drill where the throttle is the
    // whole lesson, and its own listed mistake is "pushing the throttle all the
    // way down and landing" — so putting the drone on the deck has to cost
    // something. It used to cost nothing: the drone sat there being told to ease
    // up, and eventually the stall timer lifted it back to the hover on its own,
    // which reads as the sim undoing the mistake for the pilot.
    //
    // `wrecked` raises a real crash, so this ends the way any other write-off
    // does — the crash card, one star, and R to go again.
    if (p.onGround && mem.airborne === 1) {
      return {
        done: false,
        failed: true,
        wrecked: true,
        hint: 'You put it down. Throttle down is not a landing',
        cue: [],
      };
    }
    // Handed over at a hover, so "has been flying" is true from the first frame
    // it is off the deck — this only guards the moment before the drone settles.
    if (!p.onGround) mem.airborne = 1;

    // Steps 1 and 2 — down into the low band, and hold it there.
    const low = p.altitude >= LOW_MIN && p.altitude <= LOW_MAX;
    const steadyLow = low && Math.abs(p.verticalSpeed) < 0.4;
    const held = holdFor(mem, 'low', steadyLow, p.dt, HOLD_SEC);
    const wasLow = latch(mem, 'wasLow', held >= 1);

    if (!wasLow) {
      mem.wp = low ? 1 : 0;
      if (p.altitude < TOO_LOW) {
        return {
          done: false,
          progress: 0.4,
          hint: 'A little too low. Ease the throttle up',
          cue: CUE.throttleUp,
        };
      }
      // Measured from the height it was handed over at, so the bar sits at zero
      // until the drone actually starts coming down.
      const dropped = clamp01((HOVER - p.altitude) / Math.max(HOVER - LOW_MAX, 0.01));
      return {
        done: false,
        progress: 0.4 * dropped + 0.2 * clamp01(held),
        hint: low
          ? `Hold it here ${Math.max(0, HOLD_SEC - held * HOLD_SEC).toFixed(1)}s`
          : 'Throttle down to come down',
        cue: low ? [] : CUE.throttleDown,
      };
    }

    // Step 3 — back up to the hover it started from.
    const high = p.altitude >= HIGH_MIN && p.altitude <= HIGH_MAX;
    const steadyHigh = high && Math.abs(p.verticalSpeed) < 0.5;
    const back = holdFor(mem, 'high', steadyHigh, p.dt, BACK_SEC);
    const done = latch(mem, 'wasHigh', back >= 1);
    mem.wp = done ? 3 : 2;

    return {
      done,
      progress: done ? 1 : 0.6 + 0.4 * clamp01(back),
      hint: done
        ? 'Down and back up. Well flown'
        : p.altitude > HIGH_MAX
          ? 'Too high. Ease the throttle down'
          : high
            ? 'Centre the stick and let it settle'
            : 'Now throttle up, back to about 2 m',
      cue: done || high ? [] : p.altitude > HIGH_MAX ? CUE.throttleDown : CUE.throttleUp,
    };
  },

  stars: [
    {
      stars: 3,
      text: 'Down, held and back up in 22s, smoothly, nothing touched',
      test: ({ touches, timeSec, collisions, smoothness }) =>
        collisions === 0 && touches === 0 && smoothness >= 0.5 && timeSec <= 22,
    },
    {
      stars: 2,
      text: 'Down, held and back up in 40s',
      test: ({ timeSec, collisions, smoothness }) =>
        collisions === 0 && smoothness >= 0.25 && timeSec <= 40,
    },
  ],

  practiceTimeout: 35,
};

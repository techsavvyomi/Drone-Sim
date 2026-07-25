import type { Lesson } from './types';

// Lesson 1 — Arming the drone. A pure discrete-action lesson: success is simply
// that the flight controller is armed. Motors spinning up to idle is the demo's
// whole story.
export const armLesson: Lesson = {
  id: 'arm',
  order: 1,
  title: 'Arm',
  subtitle: 'Wake the motors',

  explain: {
    title: 'Arming the Drone',
    body: [
      'Before a drone can fly, it must be armed.',
      'Arming enables the flight controller and starts the motors at idle speed.',
      'The motors will not spin at all until you arm — this is a safety feature.',
    ],
    durationHint: '5–10 seconds',
  },

  demo: [
    { at: 0.0, caption: 'Watch: press ENTER to arm' },
    { at: 0.6, cmd: 'arm', key: 'Enter', caption: 'ENTER → motors start at idle' },
    { at: 2.4, caption: 'Propellers spinning — drone is armed' },
  ],

  practice: {
    prompt: 'Press ENTER to Arm the Drone',
    hint: 'Press ENTER',
  },

  keys: [{ code: 'Enter', label: 'ENTER', hint: 'Arm' }],

  tips: [
    'Always check the area is clear before arming.',
    'Keep your hands well clear of the propellers.',
  ],
  commonMistakes: [
    'Arming with the throttle stick pushed up.',
    'Arming near people or obstacles.',
  ],

  validate: (p, mem) => {
    if (p.armed) return { done: true, progress: 1, hint: 'Drone armed' };
    // The safety interlock refuses to arm with the throttle raised — teach why.
    if (p.throttle > 0.62) {
      mem.blocked = 1; // remember the mistake for scoring
      return {
        done: false,
        progress: 0,
        failed: false,
        hint: 'Throttle is up — centre it first (arming is blocked for safety)',
      };
    }
    return { done: false, progress: 0, hint: 'Throttle centred — press ENTER to arm' };
  },

  // Clean arm = 3★; if you tried to arm with the throttle up along the way, 2★.
  score: ({ mem }) => (mem.blocked ? 2 : 3),
};

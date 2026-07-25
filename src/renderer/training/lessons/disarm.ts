import type { Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';

// Lesson 2 — Disarming. Mirror of Arm. The drone is pre-armed on entry so the
// pilot has something to disarm; success is that the motors are off again.
export const disarmLesson: Lesson = {
  id: 'disarm',
  order: 2,
  title: 'Disarm',
  subtitle: 'Cut the motors safely',

  explain: {
    title: 'Disarming the Drone',
    body: [
      'Always disarm the drone after landing.',
      'Disarming stops the motors and locks out the flight controller.',
      'A drone left armed on the ground can spin its props unexpectedly — never leave it armed.',
    ],
    durationHint: '5–10 seconds',
  },

  // Arm first so there is something to disarm, then show the disarm.
  demo: [
    { at: 0.0, cmd: 'arm', caption: 'The drone is armed…' },
    { at: 1.6, cmd: 'disarm', key: 'Enter', caption: 'ENTER → motors stop' },
    { at: 3.0, caption: 'Disarmed — safe to handle' },
  ],

  // Start Practice with the drone armed and resting on the pad.
  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
  },

  practice: {
    prompt: 'Press ENTER to Disarm the Drone',
    hint: 'Press ENTER',
  },

  keys: [{ code: 'Enter', label: 'ENTER', hint: 'Disarm' }],

  tips: [
    'Always disarm immediately after landing.',
    'Disarming is your fastest emergency stop.',
  ],
  commonMistakes: [
    'Leaving the drone armed on the ground.',
    'Forgetting to disarm after a hard landing.',
  ],

  validate: (p) => {
    if (!p.armed) return { done: true, progress: 1, hint: 'Drone disarmed' };
    return { done: false, progress: 0, hint: 'Press ENTER to disarm the drone' };
  },

  // Reward a prompt disarm — dithering after landing is the habit to avoid.
  score: ({ timeSec }) => (timeSec <= 4 ? 3 : timeSec <= 10 ? 2 : 1),
};


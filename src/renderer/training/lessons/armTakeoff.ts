import { CUE, holdFor, latch, type Lesson } from './types';
import { home } from './arena';

// Module 1 — Arm & Take Off. The two halves of getting airborne, taught as one
// action because that is how they are flown: arming alone does nothing visible
// (the motors stay stopped), so it only makes sense paired with the take-off
// that follows it.
//
// Nothing else appears in this module. No throttle, no pitch, no roll, no yaw:
// the pilot has two things to do, in order, and the screen shows exactly those
// two. SPACE does the climb, so the lesson is the ORDER, not the stick work.
const MIN_ALT = 1.3;
const MAX_ALT = 2.6;
const HOLD_SEC = 1.5;

export const armTakeoffLesson: Lesson = {
  id: 'arm-takeoff',
  order: 1,
  title: 'Arm & Take Off',
  subtitle: 'Power up, then lift off the pad',

  explain: {
    title: 'Arm, then Take Off',
    body: [
      'Arming turns the motors on. Nothing spins before that.',
      'Then press SPACE and the drone lifts up and holds there.',
    ],
    durationHint: '15 seconds',
  },

  // The two steps, shown as a flow on the intro card and walked through on the
  // checkpoint row while the pilot flies them.
  stages: [{ label: 'Arm', cap: 'ENTER' }, { label: 'Take off', cap: 'SPACE' }, { label: 'Hover' }],

  // Nothing to fly to — the guide simply rings the pad being taken off from.
  route: [home('H')],

  // `stage` walks the step row on screen with the demonstration, so the flow the
  // intro card showed is the flow the pilot watches being flown.
  demo: [
    { at: 0.0, stage: 0, caption: 'Step 1 — press ENTER to arm' },
    { at: 0.8, cmd: 'arm', key: 'Enter', caption: 'Armed. The drone is live' },
    { at: 2.4, stage: 1, caption: 'Armed, but still on the ground' },
    {
      at: 3.4,
      stage: 1,
      cmd: 'takeoffLand',
      key: 'Space',
      caption: 'Step 2 — press SPACE to take off',
    },
    // The Director holds the demo clock while auto take-off owns the aircraft,
    // so this beat lands at the hover rather than part way up the climb.
    { at: 4.4, stage: 2, caption: 'It climbs to about 2 m on its own' },
    { at: 6.0, caption: 'Steady hover. You are flying' },
  ],

  practice: {
    prompt: 'Arm the drone, then take off to a steady hover',
    hint: 'Press ENTER to arm',
  },

  // Two keys, one per step, both on screen from the start — the breathing cue is
  // what says which one is wanted now. The throttle caps used to sit here too,
  // which made a one-answer question look like it had three answers, and the
  // throttle is Module 3's lesson, not this one. SPACE climbs to the hover
  // height on its own, which is the band this lesson is judged on.
  keys: [
    { code: 'Enter', label: 'ENTER', hint: 'Arm' },
    { code: 'Space', label: 'SPACE', hint: 'Take Off' },
  ],

  tips: ['Check the area is clear first.', 'Arm first, then take off.'],
  commonMistakes: ['Pressing SPACE before arming.', 'Trying to arm with the throttle up.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };

    // Stage 1 — get it armed. The interlock refuses with the throttle raised,
    // so say why rather than leaving the pilot pressing a key that does nothing.
    if (!p.armed && !mem.wasArmed) {
      mem.wp = 0;
      if (p.throttle > 0.62) {
        mem.blocked = 1;
        return {
          done: false,
          progress: 0,
          hint: 'Throttle is up. Centre it first, then arm',
          cue: [],
        };
      }
      return { done: false, progress: 0, hint: 'Press ENTER to arm', cue: CUE.arm };
    }
    if (p.armed) mem.wasArmed = 1;

    // Stage 2 — climb into the hover band and hold it.
    const inBand = p.altitude >= MIN_ALT && p.altitude <= MAX_ALT;
    const steady = inBand && Math.abs(p.verticalSpeed) < 0.4;
    const held = holdFor(mem, 'hold', steady, p.dt, HOLD_SEC);
    mem.wp = inBand ? 2 : 1;

    let hint: string;
    let cue: readonly string[];
    if (!p.armed) {
      hint = 'Disarmed. Press ENTER to arm again';
      cue = CUE.arm;
    } else if (p.altitude < MIN_ALT) {
      hint = 'Press SPACE to take off';
      cue = CUE.autoTakeoff;
    } else if (p.altitude > MAX_ALT) {
      hint = 'Too high. Let it settle back down';
      cue = [];
    } else {
      hint = `Hold the hover ${Math.max(0, HOLD_SEC - held * HOLD_SEC).toFixed(1)}s`;
      cue = [];
    }

    // The 1.5 s hover hold is the whole task, so latch it: the Director then
    // holds the "✓" for its own confirmation beat instead of demanding a second
    // steady stretch on top of the one the pilot was asked for.
    const hovered = latch(mem, 'hovered', p.armed && held >= 1);
    if (hovered) mem.wp = 3;
    return { done: hovered, progress: hovered ? 1 : 0.25 + 0.75 * held, hint, cue };
  },

  stars: [
    {
      stars: 3,
      text: 'Hovering in 16s, smoothly, nothing touched',
      // A blocked arming (throttle up) is capped at two, however quick the rest was.
      test: ({ touches, timeSec, collisions, smoothness, mem }) =>
        collisions === 0 && touches === 0 && !mem.blocked && smoothness >= 0.5 && timeSec <= 16,
    },
    {
      stars: 2,
      text: 'Hovering in 30s',
      test: ({ timeSec, collisions, smoothness, mem }) =>
        collisions === 0 && (!!mem.blocked || (smoothness >= 0.25 && timeSec <= 30)),
    },
  ],

  practiceTimeout: 30,
};

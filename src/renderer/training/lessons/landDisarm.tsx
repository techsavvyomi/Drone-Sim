import { CUE, holdFor, horizontalDist, type Lesson } from './types';
import { home } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';

const [PAD_X, PAD_Z] = ACADEMY_PAD.center;
/*
 * The touchdown circle is deliberately NOT the helipad's own radius. The pad is
 * 7 m across and the painted ring 4.5 — land anywhere on either and the drill
 * scores itself, which teaches nothing. This is the target drawn on the "H" at
 * the pad centre, and it is the same 0.9 m the lesson has always been judged on.
 */
const PAD_R = 0.9;

// Module 2 — Land & Disarm. The mirror of Module 1, and taught as one action for
// the same reason: a landing is not finished until the motors are off. The drill
// deliberately fails if the pilot stops at touchdown.
//
// Like Module 1 it shows only its own controls. The drone is PLACED at a hover
// over the pad (`startAirborne`), so there is nothing to fly TO — only down, and
// the lesson opens on the situation it is about instead of on a take-off.
export const landDisarmLesson: Lesson = {
  id: 'land-disarm',
  order: 2,
  title: 'Land & Disarm',
  subtitle: 'Set it down, then shut it off',

  explain: {
    title: 'Landing and Disarming',
    body: [
      'Press SPACE and the drone comes down onto the circle by itself.',
      'Once it is down, press ENTER to stop the motors. Never stop them in the air.',
    ],
    durationHint: '20 seconds',
  },

  stages: [
    { label: 'Land', cap: 'SPACE' },
    { label: 'Disarm', cap: 'ENTER' },
  ],

  // Opens in the air. The drill is the descent and the shutdown, so the drone is
  // PLACED at a hover over the pad rather than taking off first.
  startAirborne: true,

  // The touchdown circle on the "H" is the only target, and the guide rings the
  // pad the arena already has rather than adding one.
  route: [home('H', { reach: PAD_R })],

  // Timed against a clock the Director HOLDS while an auto sequence is running,
  // so these beats play where the captions say they do: the drone is really at a
  // hover before the land step, and really on the ground before the disarm.
  // Timed against a clock the Director HOLDS while the descent is running, so
  // the disarm beat plays when the drone is really on the ground.
  demo: [
    { at: 0.0, stage: 0, caption: 'Armed, hovering over the pad' },
    { at: 2.0, caption: 'Holding here. Nothing happens on its own' },
    { at: 3.6, caption: 'Step 1 — press SPACE to land' },
    { at: 4.2, cmd: 'takeoffLand', key: 'Space', caption: 'It comes down onto the circle' },
    { at: 5.0, caption: 'Soft touchdown inside the circle' },
    { at: 6.0, stage: 1, cmd: 'disarm', key: 'Enter', caption: 'Step 2 — ENTER stops the motors' },
    { at: 7.2, caption: 'Motors off. Safe to handle' },
  ],

  practice: {
    prompt: 'Land inside the circle, then disarm',
    hint: 'Press SPACE to land',
  },

  // Two keys, one per step, matching Module 1, both on screen from the start.
  // The throttle cap went out with Module 1's: feeding a descent in by hand is
  // Module 3's lesson, and this one is about the ORDER — down first, motors off
  // second.
  keys: [
    { code: 'Space', label: 'SPACE', hint: 'Land' },
    { code: 'Enter', label: 'ENTER', hint: 'Disarm' },
  ],

  tips: [
    'Wait for it to settle on the pad before you disarm.',
    'Disarm as soon as you are down. It is also the fastest emergency stop.',
  ],
  commonMistakes: [
    'Cutting the motors while still in the air.',
    'Walking away with the drone still armed.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Hard landing. Try again', cue: [] };

    if (p.altitude > 1.0) mem.airborne = 1;
    const dist = horizontalDist(p.position, PAD_X, PAD_Z);

    // Remember the fastest descent seen near the ground, for scoring the touchdown.
    if (!p.onGround && p.altitude < 1.0 && p.verticalSpeed < 0) {
      mem.touchVs = Math.max(mem.touchVs ?? 0, Math.abs(p.verticalSpeed));
    }

    const onPad = p.onGround && dist <= PAD_R;
    if (onPad) mem.finalDist = dist;
    const settled = holdFor(mem, 'settle', onPad && Math.abs(p.verticalSpeed) < 0.4, p.dt, 0.8);
    const landed = mem.airborne === 1 && settled >= 1;
    if (landed) mem.landed = 1;

    // Second half: the motors have to be off before this counts as finished.
    if (mem.landed) {
      mem.wp = 1;
      if (!p.armed) {
        mem.wp = 2;
        return { done: true, progress: 1, hint: 'Down and disarmed. Well flown', cue: [] };
      }
      return {
        done: false,
        progress: 0.8,
        hint: 'Down safely. Now press ENTER to disarm',
        cue: CUE.arm,
      };
    }

    mem.wp = 0;

    // Already on the way down: stop asking for the key that started it. A cap
    // that keeps blinking after it has been pressed reads as "that did not
    // work", and the pilot presses it again — which aborts the descent.
    const descending = !p.onGround && p.verticalSpeed < -0.15;

    let hint: string;
    if (p.onGround && dist > PAD_R) hint = 'Off the circle. Take off and line up again';
    else if (!p.onGround && dist > PAD_R) hint = 'Move back over the landing circle';
    else if (descending) hint = 'Coming down onto the circle';
    else if (!p.onGround) hint = 'Press SPACE to land';
    else hint = 'Hold it steady on the pad';

    return {
      done: false,
      progress: onPad ? 0.6 * settled : 0,
      hint,
      cue: descending ? [] : CUE.autoLand,
    };
  },

  stars: [
    {
      stars: 3,
      text: 'Touch down within 30 cm of the centre, softly',
      test: ({ collisions, smoothness, mem }) =>
        collisions === 0 &&
        (mem.finalDist ?? PAD_R) <= PAD_R * 0.35 &&
        (mem.touchVs ?? 1) <= 0.5 &&
        smoothness >= 0.4,
    },
    {
      stars: 2,
      text: 'Touch down inside the circle, gently',
      test: ({ collisions, mem }) =>
        collisions === 0 && (mem.finalDist ?? PAD_R) <= PAD_R * 0.7 && (mem.touchVs ?? 1) <= 0.9,
    },
  ],

  practiceTimeout: 40,
};

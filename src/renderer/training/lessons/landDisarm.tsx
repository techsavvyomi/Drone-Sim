import { CUE, clamp01, holdFor, horizontalDist, type Lesson } from './types';
import { home } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';
import { PREFLIGHT_STAGES, afterPreflightDemo, preflightDemo, withPreflight } from './preflight';

const [PAD_X, PAD_Z] = ACADEMY_PAD.center;

/*
 * How far off the "H" a touchdown may be and still count: the painted ring, the
 * whole 4.5 m of it.
 *
 * It used to be 0.9 m — a precision circle at the pad centre — and that was a
 * standard this module cannot ask for. Module 2 shows SPACE and ENTER and
 * nothing else: there is no roll or pitch key on screen, so the pilot has no
 * way to answer the outdoor ambient drift that pushes a hovering drone around
 * while it waits in altitude hold. A metre or two of wander before the pilot
 * even presses SPACE is the NORMAL outcome, and the drill then landed outside
 * its own circle, scored zero, refused the disarm it had just asked for, and
 * told the pilot to "take off and line up again" using controls the module does
 * not give them. A dead end.
 *
 * A lesson may only be judged on an axis it hands the pilot a control for. This
 * one is judged on the descent and the shutdown; where on the pad it comes down
 * is the drift's doing, not the pilot's.
 */
const TOUCHDOWN_R = ACADEMY_PAD.markRadius;

// Module 2 — Land & Disarm. The mirror of Module 1, and taught as one action for
// the same reason: a landing is not finished until the motors are off. The drill
// deliberately fails if the pilot stops at touchdown.
//
// Like Module 1 it shows only its own controls — and here they are the SAME two,
// doing the other half of their job: ENTER armed, now it disarms; SPACE lifted,
// now it puts the drone down. The module used to open at a hover to get straight
// to its own drill, but a syllabus where only Module 1 ever arms an aircraft
// teaches the two keys that begin every real flight the least.
export const landDisarmLesson: Lesson = {
  id: 'land-disarm',
  order: 2,
  title: 'Land & Disarm',
  subtitle: 'Set it down, then shut it off',

  explain: {
    title: 'Landing and Disarming',
    body: [
      'Press SPACE and the drone comes down on the pad by itself.',
      'Once it is down, press ENTER to stop the motors. Never in the air.',
    ],
    durationHint: '20 seconds',
  },

  stages: [...PREFLIGHT_STAGES, { label: 'Land', cap: 'SPACE' }, { label: 'Disarm', cap: 'ENTER' }],

  // The helipad is the only target, and the guide rings the pad the arena
  // already has rather than adding one.
  route: [home('H', { reach: TOUCHDOWN_R })],

  // Timed against a clock the Director HOLDS while an auto sequence is running,
  // so these beats play where the captions say they do: the drone is really at a
  // hover before the land step, and really on the ground before the disarm.
  demo: [
    ...preflightDemo(),
    ...afterPreflightDemo([
      { at: 0.0, stage: 0, caption: 'Hovering over the pad. Now put it back down' },
      { at: 1.0, caption: 'Holding here. Nothing happens on its own' },
      { at: 2.2, caption: 'Step 1: press SPACE again to land' },
      { at: 2.8, cmd: 'takeoffLand', key: 'Space', caption: 'It comes down onto the pad' },
      { at: 3.6, caption: 'Soft touchdown on the pad' },
      {
        at: 4.6,
        stage: 1,
        cmd: 'disarm',
        key: 'Enter',
        caption: 'Step 2: ENTER stops the motors',
      },
      { at: 5.8, caption: 'Motors off. Safe to handle' },
    ]),
  ],

  practice: {
    prompt: 'Arm, take off, then land back on the pad and disarm',
    hint: 'Press ENTER to arm',
  },

  // Two keys, one per step, matching Module 1, both on screen from the start.
  // The throttle cap went out with Module 1's: feeding a descent in by hand is
  // Module 3's lesson, and this one is about the ORDER — down first, motors off
  // second.
  // The same two caps do all four steps: ENTER arms and then disarms, SPACE
  // lifts and then puts it down. That IS the lesson — the order, not the keys.
  keys: [
    { code: 'Enter', label: 'ENTER', hint: 'Arm / Disarm' },
    { code: 'Space', label: 'SPACE', hint: 'Take Off / Land' },
  ],

  tips: ['Let it sit still on the pad first.', 'Stop the motors as soon as you land.'],
  commonMistakes: [
    'Stopping the motors while still in the air.',
    'Walking away with the drone still armed.',
  ],

  validate: (p, mem) =>
    withPreflight(p, mem, (p, mem) => {
      // The highest the drone has been this attempt, so the descent can be scored
      // against the height it actually has to lose.
      mem.top = Math.max(mem.top ?? 0, p.altitude);

      const dist = horizontalDist(p.position, PAD_X, PAD_Z);

      // Remember the fastest descent seen near the ground, for scoring the touchdown.
      if (!p.onGround && p.altitude < 1.0 && p.verticalSpeed < 0) {
        mem.touchVs = Math.max(mem.touchVs ?? 0, Math.abs(p.verticalSpeed));
      }

      const down = p.onGround && dist <= TOUCHDOWN_R;
      const settled = holdFor(mem, 'settle', down && Math.abs(p.verticalSpeed) < 0.4, p.dt, 0.8);
      const landed = mem.airborne === 1 && settled >= 1;
      if (landed) {
        mem.landed = 1;
        // When it touched down, so the shutdown can be timed from it. Module 2's
        // whole point is that the motors come off PROMPTLY once the drone is down.
        if (mem.landAt === undefined) mem.landAt = p.elapsed;
      }

      // Second half: the motors have to be off before this counts as finished.
      if (mem.landed) {
        mem.wp = 1;
        if (!p.armed) {
          mem.wp = 2;
          if (mem.shutdown === undefined) mem.shutdown = p.elapsed - (mem.landAt ?? p.elapsed);
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

      // Down, but clean off the helipad. There is no lateral control in this
      // module to walk it back with, so the attempt ENDS and the Director puts the
      // drone back over the "H" — a fresh try, rather than a hint asking for a key
      // that is not on screen.
      if (p.onGround && dist > TOUCHDOWN_R) {
        return { done: false, failed: true, hint: 'Landed off the pad. Try again', cue: [] };
      }

      // Already on the way down: stop asking for the key that started it. A cap
      // that keeps blinking after it has been pressed reads as "that did not
      // work", and the pilot presses it again — which aborts the descent.
      const descending = !p.onGround && p.verticalSpeed < -0.15;

      // The descent IS the first half of the drill, so it is worth half the bar
      // WHILE IT RUNS. It used to be worth nothing until the wheels were down: the
      // pilot pressed the one key the lesson asked for, watched four seconds of
      // descent with the bar still reading 0%, and read that as the key having
      // done nothing.
      const fall = clamp01((mem.top - p.altitude) / Math.max(mem.top - ACADEMY_PAD.surfaceY, 0.01));

      let hint: string;
      if (descending) hint = 'Coming down onto the pad';
      else if (!p.onGround) hint = 'Press SPACE to land';
      else hint = 'Hold it steady on the pad';

      return {
        done: false,
        progress: p.onGround ? 0.6 + 0.2 * settled : 0.6 * fall,
        hint,
        cue: descending ? [] : CUE.autoLand,
      };
    }),

  // Scored on the two things this module's controls decide: how softly it
  // arrives, and how quickly the motors come off once it has. Precision on the
  // pad is not on the list — see TOUCHDOWN_R above.
  stars: [
    {
      stars: 3,
      text: 'Soft landing, motors off in 2s, nothing touched',
      test: ({ touches, collisions, smoothness, mem }) =>
        collisions === 0 &&
        touches === 0 &&
        (mem.touchVs ?? 1) <= 0.5 &&
        (mem.shutdown ?? 99) <= 2.0 &&
        smoothness >= 0.4,
    },
    {
      stars: 2,
      text: 'Gentle landing, motors off in 5s',
      test: ({ collisions, mem }) =>
        collisions === 0 && (mem.touchVs ?? 1) <= 0.9 && (mem.shutdown ?? 99) <= 5.0,
    },
  ],

  practiceTimeout: 40,
};

import { CUE, lineDeviation, type Lesson } from './types';
import { flyMission } from './mission';
import { solveCoast } from './demoFlight';
import { KEYS_THROTTLE } from './preflight';
import { HOVER, gate, home } from './arena';

// Module 7 — Straight Flight. The first module flown as a whole FLIGHT: arm it,
// take off, fly straight forward to a point, land on it. Modules 1 to 6 each
// drilled one piece of that; this is the first time the pieces are put together,
// which is why the drone is no longer handed over hovering.
//
// It goes out and STAYS out, and it does not land: three steps, ENTER, SPACE,
// pitch forward, and the flight is over the moment the distance is flown. A
// touchdown on the end would be a second exercise — Module 2's, already taught —
// standing between the pilot and the result, on a module whose whole point is
// one stick held straight.
//
// The target is the blue square gate standing 16 m dead ahead — the first thing
// seen from the pad, and the only thing on the centre line. The task is to take
// the drone THROUGH it, which is why it is a gate and not a spot on the ground:
// a hole you either went through or did not is a clearer test of a straight
// line than a circle you stopped somewhere near.
//
// The lesson calls it "A", and what stands in the opening is a lit pink sphere
// rather than the letter. Nothing is painted on the gate itself and "the blue
// one" stops being enough the moment there is a second blue one on the field,
// so the gate has to be marked either way — but a letter is a name, and this
// module does not need the gate NAMED, it needs the hole aimed at. The ball
// hangs on the checkpoint, at the height the pass is judged at, so lining up on
// the light and flying through it IS the exercise. It goes out as the drone
// goes through, which is the pilot being told the run counted by the arena
// rather than by the HUD.
//
// Judged at hover height, not at the gate's own 2.6 m. The DRILL is one stick
// held straight, so the checkpoint has to sit where a level pass finds it; a
// checkpoint at the middle of the opening would turn the module into a climb.
// The opening runs from 0.9 m to 4.3 m, so a level pass goes through it. The
// throttle is on the row — it has been since Module 3 — but as the answer to a
// drift, not as a fourth thing to fly.
const START = home('H');
const TARGET = gate('blue-near', 'A', { ease: 1.3, height: HOVER, tag: 'A', orb: true });
const ROUTE = [TARGET] as const;

/** How far out A is, measured rather than written down — the demonstration
 *  solves its run against it, so the demo follows the arena if the arena moves. */
const OUT_M = Math.hypot(TARGET.at[0] - START.at[0], TARGET.at[2] - START.at[2]);

const LEGS = [{ hint: 'Pitch forward — take it straight through A', cue: CUE.forward }];

// ONE stick in the DEMONSTRATION: pitch, and only forward. Getting up and
// getting down are the SPACE take-off and landing already taught in Modules 1
// and 2, so the demo presses arm, take off and pitch forward and nothing else —
// what the pilot is asked to copy is one straight run, not a three-channel
// flight.
//
// With no pitch-back key there is no brake, so the run is flown the only way it
// can be: push, let go early, and drift onto the mark. `solveCoast` sizes the
// push so the drone crosses the distance at a walking pace, which is the same
// thing the tip and the caption tell the pilot to do.

/** Tilt for the run out.
 *
 *  POSITIVE is forward. The sticks tilt the drone in its own frame, and at
 *  heading 0 — which is where this whole module is flown — the nose faces -Z,
 *  so a leg running out to -Z is `+stick` of pitch. Getting that backwards flew
 *  the demonstration away from the line and lit the pitch-backward channel,
 *  which is not even a key this module shows. */
const RUN_STICK = 0.35;
/** How fast it is still going as it reaches A, m/s.
 *
 *  Brisk, because the task is to go THROUGH the gate and out the far side, not
 *  to park in the frame — and because a slower arrival means a longer coast to
 *  sit through. It carries the drone several metres past A before the demo
 *  ends, which is the flight the module is asking for. */
const RUN_ARRIVE = 1.2;
const RUN = solveCoast(OUT_M, RUN_STICK, RUN_ARRIVE);

/** When each beat of the demonstration falls. The arm and the take-off each get
 *  their own: they are two of the four steps this module teaches, and firing
 *  both at t = 0 — which is what this used to do — put the drone in the air
 *  before the demonstration had shown a single key being pressed. */
const ARM_AT = 1.2;
const TAKEOFF_AT = 4.0;
const RUN_AT = TAKEOFF_AT + 1.4;
const ARRIVES_AT = RUN_AT + RUN.tArrive;

export const straightLineLesson: Lesson = {
  id: 'straight-line',
  order: 7,
  title: 'Straight Flight',
  subtitle: 'Take off and fly one straight line through A',

  explain: {
    title: 'Flying a Straight Line',
    body: [
      'Arm, take off, then push forward through gate A.',
      'A is the blue square ahead of you. Keep it in the middle of your view.',
    ],
  },

  route: ROUTE,

  // What the pilot has to DO, in order — which is what the step row should say.
  // It used to read the route instead, so a module flown to a distance put one
  // chip on screen saying "12 M OUT" and never mentioned arming or taking off,
  // the two things that come first. The landing is the hint line's to ask for
  // when the distance runs out; it is not a fourth thing to keep an eye on.
  stages: [
    { label: 'Arm', cap: 'ENTER' },
    { label: 'Take off', cap: 'SPACE' },
    { label: 'Pitch forward', cap: '↑' },
  ],

  demo: [
    { at: 0.0, caption: 'On the pad, motors off. Nothing turns until it is armed' },
    { at: ARM_AT, stage: 0, cmd: 'arm', key: 'Enter', caption: 'Step 1 — ENTER arms it' },
    { at: ARM_AT + 1.4, caption: 'Armed and live, but still on the ground' },
    {
      at: TAKEOFF_AT,
      stage: 1,
      cmd: 'takeoffLand',
      key: 'Space',
      caption: 'Step 2 — SPACE, and it climbs to a hover on its own',
    },
    {
      at: RUN_AT,
      stage: 2,
      stick: { pitch: RUN_STICK },
      caption: 'Step 3 — pitch forward, one straight run at A',
    },
    {
      at: RUN_AT + RUN.tPush,
      stage: 2,
      stick: { pitch: 0 },
      caption: 'Let go early. It keeps going, and the count keeps running down',
    },
    // `rt` says the checkpoint is BEHIND the aircraft, and it is what puts the
  // light out mid-demonstration. Without it the demo flew through a sphere that
  // stayed lit and the pilot was shown a pass that did not register.
  { at: ARRIVES_AT, stage: 3, rt: 1, caption: 'Straight through A. That is the flight' },
    { at: ARRIVES_AT + 2.4, caption: 'Out the far side, still on the line' },
  ],

  practice: {
    prompt: 'Arm, take off, and fly straight forward through gate A',
    hint: 'Press ENTER to arm',
  },

  // PITCH FORWARD is the whole drill — the module is one stick held straight —
  // but the throttle stays on the row from Module 3. A pilot who drifts off
  // height has the control to answer it; the row taking it away is what made a
  // recoverable flight look unrecoverable.
  keys: [
    { code: 'Enter', label: 'ENTER', hint: 'Arm' },
    { code: 'Space', label: 'SPACE', hint: 'Take Off / Land' },
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    ...KEYS_THROTTLE,
  ],

  tips: [
    'If A moves to one side, you have moved too.',
    'Let go early. It keeps gliding, and only has to pass through.',
  ],
  commonMistakes: [
    'Letting a small drift grow over the whole run.',
    'Fixing a small drift with one big push.',
  ],

  validate: (p, mem) => {
    // Drift off the line between the "H" and the pad — the whole point of the
    // lesson, and the only thing the run out is judged on.
    if (mem.airborne) {
      mem.drift = Math.max(
        mem.drift ?? 0,
        lineDeviation(p.position, START.at[0], START.at[2], TARGET.at[0], TARGET.at[2]),
      );
    }
    return flyMission(p, mem, ROUTE, LEGS, { spot: null });
  },

  stars: [
    {
      stars: 3,
      text: 'Within 1.5 m of the line, under 40s, nothing touched',
      test: ({ touches, timeSec, collisions, mem }) =>
        collisions === 0 && touches === 0 && (mem.drift ?? 99) <= 1.5 && timeSec <= 40,
    },
    {
      stars: 2,
      text: 'Within 3 m of the line',
      test: ({ collisions, mem }) => collisions === 0 && (mem.drift ?? 99) <= 3,
    },
  ],

  practiceTimeout: 60,
};

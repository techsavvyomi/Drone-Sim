import { holdFor, horizontalDist, type Lesson } from './types';
import { home } from './arena';
import { useFlightStore } from '../../state/flightStore';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';

const [PAD_X, PAD_Z] = ACADEMY_PAD.center;
/*
 * The touchdown circle is deliberately NOT the helipad's own radius. The pad is
 * 7 m across and the painted ring 4.5 — land anywhere on either and the drill
 * scores itself, which teaches nothing. This is the target drawn on the "H" at
 * the pad centre, and it is the same 0.9 m the lesson has always been judged on.
 */
const PAD_R = 0.9;

// Step 2 — Land & Disarm. The mirror of Arm & Take Off, and taught as one action
// for the same reason: a landing is not finished until the motors are off. The
// drill deliberately fails if the pilot stops at touchdown.
export const landDisarmLesson: Lesson = {
  id: 'land-disarm',
  order: 14,
  title: 'Land & Disarm',
  subtitle: 'Bring it home, set it down, shut it off',

  explain: {
    title: 'Landing and Disarming',
    body: [
      'Reduce throttle gradually to descend — never cut the motors in the air.',
      'Aim to touch down softly inside the highlighted landing circle.',
      'Then press ENTER to disarm. A drone left armed on the ground can spin its',
      'propellers unexpectedly, so the landing is not over until the motors are off.',
    ],
  },


  // The touchdown circle on the "H" is the only target, and the guide rings the
  // pad the arena already has rather than adding one.
  route: [home('H', { reach: PAD_R })],

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Armed and hovering' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.4, caption: 'Line up over the circle…' },
    { at: 3.8, cmd: 'takeoffLand', key: 'Space', caption: 'Reduce throttle smoothly to descend' },
    { at: 6.8, caption: 'Soft touchdown inside the circle' },
    { at: 7.8, cmd: 'disarm', key: 'Enter', caption: 'ENTER → motors stop. Safe to handle' },
  ],

  // Begin hovering so the drill is the descent and the shutdown, not the climb.
  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Land inside the circle, then disarm',
    hint: 'Fly over the circle, then reduce throttle to descend',
  },

  keys: [
    { code: 'KeyW', label: 'W', hint: 'Throttle Up' },
    { code: 'KeyS', label: 'S', hint: 'Throttle Down' },
    { code: 'Space', label: 'SPACE', hint: 'Auto-land' },
    { code: 'Enter', label: 'ENTER', hint: 'Disarm' },
  ],

  tips: [
    'Line up over the pad before you start descending.',
    'Descend slowly — a soft touchdown scores highest.',
    'Disarm immediately once you are down. It is also your fastest emergency stop.',
  ],
  commonMistakes: [
    'Cutting the motors while still in the air.',
    'Drifting off the pad during the descent.',
    'Walking away with the drone still armed.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Hard landing — try again' };

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
      if (!p.armed) return { done: true, progress: 1, hint: 'Down and disarmed — well flown' };
      return { done: false, progress: 0.8, hint: 'Down safely — now press ENTER to disarm' };
    }

    let hint: string;
    if (p.onGround && dist > PAD_R) hint = 'Off the pad — take off and line up again';
    else if (!p.onGround && dist > PAD_R) hint = 'Fly over the landing circle';
    else if (!p.onGround) hint = 'Reduce throttle to descend gently';
    else hint = 'Hold it steady on the pad';

    return { done: false, progress: onPad ? 0.6 * settled : 0, hint };
  },

  score: ({ collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const dist = mem.finalDist ?? PAD_R;
    const vs = mem.touchVs ?? 1;
    if (dist <= PAD_R * 0.35 && vs <= 0.5 && smoothness >= 0.4) return 3;
    if (dist <= PAD_R * 0.7 && vs <= 0.9) return 2;
    return 1;
  },

  practiceTimeout: 40,
};

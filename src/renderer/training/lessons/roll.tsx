import { CUE, clamp01, flyRoute, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { marker, routeLegs } from './arena';

// Module 5 — Roll Control. Pure sideways movement, flown between the white
// markers ringing the helipad. They are level with the pad, symmetrical either
// side of the "H" and close in, so the drill stays about the roll stick rather
// than about covering ground. Marker 8 is straight out to the left, marker 0
// straight out to the right.
// Two legs, one per direction. It used to be four — out, back to the centre,
// out the other way, back again — which is the same two movements done twice and
// twice as long to sit through. Roll left once, roll right once, done.
const ROUTE = [marker(8, 'Left marker'), marker(0, 'Right marker')] as const;

/** Which way each leg goes, for the hint and the stick highlight. */
const LEGS = [
  { hint: 'Roll left to the left marker', cue: CUE.left },
  { hint: 'Roll right, across to the right marker', cue: CUE.right },
] as const;

export const rollLesson: Lesson = {
  id: 'roll',
  order: 5,
  title: 'Roll Control',
  subtitle: 'Left and right',

  explain: {
    title: 'Roll: Left and Right',
    body: [
      'Roll moves the drone sideways, left and right. Nothing else.',
      'Roll left to reach the left marker, then roll right across to the right one.',
      'The nose keeps pointing straight ahead the whole time.',
    ],
  },

  route: ROUTE,

  // Opens at a hover: the drone is placed there rather than flying up to it,
  // so the lesson starts on its own drill instead of on a take-off.
  startAirborne: true,

  demo: [
    ...planDemo(
      routeLegs(ROUTE, [
        {
          caption: 'ROLL LEFT — slide out to the left marker',
          arrive: 'ROLL RIGHT to stop on it. Levelling off only coasts',
        },
        {
          caption: 'ROLL RIGHT — straight across to the right marker',
          arrive: 'ROLL LEFT again to stop on it. Both markers cleared',
        },
      ]),
    ),
  ],

  practice: {
    prompt: 'Roll left to the left marker, then roll right to the right one',
    hint: 'Roll left to the left marker',
  },

  keys: [
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: ['Hold your height while you slide sideways.', 'Small movements stay controllable.'],
  commonMistakes: [
    'Rolling too hard and overshooting the marker.',
    'Letting the nose swing round. That is yaw, not roll.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };
    mem.wander = Math.max(mem.wander ?? 0, Math.abs(p.position[2]));

    const r = flyRoute(mem, p.position, ROUTE);
    if (r.complete) return { done: true, progress: 1, hint: 'Both markers cleared', cue: [] };
    const leg = LEGS[r.next];
    return { done: false, progress: clamp01(r.progress), hint: leg.hint, cue: leg.cue };
  },

  stars: [
    {
      stars: 3,
      text: 'Both markers in 24 seconds, drifting under 2 m forward or back',
      test: ({ timeSec, collisions, smoothness, mem }) =>
        collisions === 0 && (mem.wander ?? 0) <= 2 && timeSec <= 24 && smoothness >= 0.3,
    },
    {
      stars: 2,
      text: 'Both markers in 40 seconds, drifting under 4 m',
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.wander ?? 0) <= 4 && timeSec <= 40,
    },
  ],

  practiceTimeout: 45,
};

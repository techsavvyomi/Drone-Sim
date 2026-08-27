import { CUE, clamp01, flyRoute, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { marker, routeLegs } from './arena';
import {
  PREFLIGHT_KEYS,
  PREFLIGHT_STAGES,
  afterPreflightDemo,
  preflightDemo,
  withPreflight,
} from './preflight';

// Module 6 — Roll Control. Pure sideways movement, flown between the white
// markers ringing the helipad. They are level with the pad, symmetrical either
// side of the "H" and close in, so the drill stays about the roll stick rather
// than about covering ground. Marker 8 is straight out to the left, marker 0
// straight out to the right.
// Two legs, one per direction. It used to be four — out, back to the centre,
// out the other way, back again — which is the same two movements done twice and
// twice as long to sit through. Roll left once, roll right once, done.
const ROUTE = [
  marker(8, 'Left marker', { tag: 'A' }),
  marker(0, 'Right marker', { tag: 'B' }),
] as const;

/** Which way each leg goes, for the hint and the stick highlight. */
const LEGS = [
  { hint: 'Roll left to the left marker', cue: CUE.left },
  { hint: 'Roll right, across to the right marker', cue: CUE.right },
] as const;

export const rollLesson: Lesson = {
  id: 'roll',
  order: 6,
  title: 'Roll Control',
  subtitle: 'Left and right',

  explain: {
    title: 'Roll: Left and Right',
    body: [
      'Roll moves the drone sideways. Nothing else.',
      'Go left to the left marker, then right across to the other one.',
    ],
  },

  route: ROUTE,

  stages: [
    ...PREFLIGHT_STAGES,
    { label: 'Out to the left marker', cap: '←' },
    { label: 'Across to the right', cap: '→' },
  ],

  demo: [
    ...preflightDemo(),
    ...afterPreflightDemo(
      planDemo(
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
    ),
  ],

  practice: {
    prompt: 'Arm, take off, roll left to the left marker, then right to the other',
    hint: 'Press ENTER to arm',
  },

  keys: [
    ...PREFLIGHT_KEYS,
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: ['Hold your height while you move sideways.', 'Small moves are easier to control.'],
  commonMistakes: [
    'Rolling too hard and going too far.',
    'Letting the nose turn. That is yaw, not roll.',
  ],

  validate: (p, mem) =>
    withPreflight(p, mem, (p, mem) => {
      mem.wander = Math.max(mem.wander ?? 0, Math.abs(p.position[2]));

      const r = flyRoute(mem, p.position, ROUTE);
      if (r.complete) return { done: true, progress: 1, hint: 'Both markers cleared', cue: [] };
      const leg = LEGS[r.next];
      return { done: false, progress: clamp01(r.progress), hint: leg.hint, cue: leg.cue };
    }),

  stars: [
    {
      stars: 3,
      text: 'Off the pad, both markers in 32s, under 2 m off line, nothing touched',
      test: ({ touches, timeSec, collisions, smoothness, mem }) =>
        collisions === 0 &&
        touches === 0 &&
        (mem.wander ?? 0) <= 2 &&
        timeSec <= 32 &&
        smoothness >= 0.3,
    },
    {
      stars: 2,
      text: 'Off the pad, both markers in 50s, under 4 m off line',
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.wander ?? 0) <= 4 && timeSec <= 50,
    },
  ],

  practiceTimeout: 55,
};

import { CUE, clamp01, flyRoute, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { HOVER, gate, home, routeLegs } from './arena';

// Module 5 — Pitch Control. Forward and back on one stick, flown to the blue
// square gate standing 16 m straight off the nose. It is the first thing a
// pilot sees from the pad and it is dead ahead, so "fly forward" needs no
// further explanation.
//
// One axis only. The drone is handed over hovering and the height looks after
// itself, so the module shows two keys and asks for two directions.
// Judged at hover height, not at the gate's own 2.6 m. This module shows two
// keys and neither of them is the throttle, so the whole exercise is flown level
// in altitude hold — and the demonstration then flies level too, instead of
// climbing on the way out and sinking on the way back, which is a throttle
// lesson the pilot has not had yet. The blue square's opening runs from 0.9 m to
// 4.3 m, so a level pass still goes through it.
const ROUTE = [
  gate('blue-near', 'Blue gate', { ease: 1.3, height: HOVER, tag: 'A' }),
  home('Back to start'),
] as const;

export const pitchLesson: Lesson = {
  id: 'pitch',
  order: 5,
  title: 'Pitch Control',
  subtitle: 'Forward and backward',

  explain: {
    title: 'Pitch: Forward and Backward',
    body: [
      'Pitch moves the drone forward and back. Nothing else.',
      'Forward to the blue gate, back to come home.',
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
          caption: 'PITCH FORWARD — straight out to the blue gate',
          arrive: 'PITCH BACKWARD to stop on it. Levelling off only coasts',
        },
        {
          caption: 'PITCH BACKWARD — all the way back to the start',
          arrive: 'PITCH FORWARD again to stop on the spot',
        },
      ]),
    ),
  ],

  practice: {
    prompt: 'Pitch forward to the blue gate, then pitch backward to the start',
    hint: 'Pitch forward to the blue gate',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
  ],

  tips: [
    'Keep the nose pointing straight ahead.',
    'Pull back to stop. It will not stop on its own.',
  ],
  commonMistakes: ['Pushing too hard and flying past the gate.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };
    mem.wander = Math.max(mem.wander ?? 0, Math.abs(p.position[0]));

    const r = flyRoute(mem, p.position, ROUTE);
    if (r.complete)
      return { done: true, progress: 1, hint: 'Back at the start. Nicely flown', cue: [] };
    return {
      done: false,
      progress: clamp01(r.progress),
      hint: r.next === 0 ? 'Pitch forward to the blue gate' : 'Pitch backward, back to the start',
      cue: r.next === 0 ? CUE.forward : CUE.backward,
    };
  },

  stars: [
    {
      stars: 3,
      text: 'Out and back in 32s, under 2.5 m sideways, nothing touched',
      test: ({ touches, timeSec, collisions, smoothness, mem }) =>
        collisions === 0 &&
        touches === 0 &&
        (mem.wander ?? 0) <= 2.5 &&
        timeSec <= 32 &&
        smoothness >= 0.3,
    },
    {
      stars: 2,
      text: 'Out and back in 55s, under 5 m sideways',
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.wander ?? 0) <= 5 && timeSec <= 55,
    },
  ],

  practiceTimeout: 45,
};

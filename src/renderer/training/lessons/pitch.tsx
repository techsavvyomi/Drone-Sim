import { CUE, clamp01, flyRoute, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { HOVER, gate, home, routeLegs } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';
import {
  FLIGHT_KEYS,
  KEYS_PITCH,
  KEYS_THROTTLE,
  KEYS_YAW,
  LAND_STAGE,
  PREFLIGHT_STAGES,
  ROUTE_CURSOR,
  afterPreflightDemo,
  preflightDemo,
} from './preflight';
import { withFlight } from './mission';

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
//
// A BALL of light on the checkpoint instead of a letter beside it, the way
// Modules 7 and 8 mark theirs. There is one target on this route and the way
// home, so nobody has to tell one gate from another — the question the pilot is
// actually asking is "am I on it yet", and a letter cannot answer that. The ball
// is drawn at the checkpoint's own reach, so the light IS the volume that
// scores: stop inside the pink and the leg is done.
//
// It matters here because this module is where a pilot first has to STOP on
// something rather than just reach it. A letter gives no depth cue at 16 m, so
// the natural mistake is to level off short or coast through; a ball you are
// visibly inside of does.
const ROUTE = [
  gate('blue-near', 'Blue gate', { ease: 1.3, height: HOVER, tag: 'A', orb: true }),
  home('Back to start'),
] as const;

/** The Land chip's index: Arm, Take off, out, back, then this. */
const STAGE_LAND = 4;

const FLIGHT = afterPreflightDemo(
  planDemo(
    routeLegs(ROUTE, [
      {
        caption: 'PITCH FORWARD: straight out to the blue gate',
        arrive: 'PITCH BACKWARD to stop on it. Levelling off only coasts',
      },
      {
        caption: 'PITCH BACKWARD: all the way back to the start',
        arrive: 'PITCH FORWARD again to stop on the spot',
      },
    ]),
  ),
);
const LANDS_AT = (FLIGHT[FLIGHT.length - 1]?.at ?? 0) + 1.6;

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

  stages: [
    ...PREFLIGHT_STAGES,
    { label: 'Out to the gate', cap: '↑' },
    { label: 'Back to the start', cap: '↓' },
    LAND_STAGE,
  ],

  demo: [
    ...preflightDemo(),
    ...FLIGHT,
    {
      at: LANDS_AT,
      stage: STAGE_LAND,
      waitNear: { x: ACADEMY_PAD.center[0], z: ACADEMY_PAD.center[1], reach: 3 },
      cmd: 'takeoffLand',
      key: 'Space',
      caption: 'Back over the "H". SPACE puts it down',
    },
    { at: LANDS_AT + 3.5, cmd: 'disarm', key: 'Enter', caption: 'Motors off' },
  ],

  practice: {
    prompt: 'Arm, take off, pitch out to the blue gate, back to the start, then land',
    hint: 'Press ENTER to arm',
  },

  // Pitch is today's pair; yaw and the throttle stay from Modules 3 and 4.
  keys: [...FLIGHT_KEYS, ...KEYS_PITCH, ...KEYS_THROTTLE, ...KEYS_YAW],

  tips: [
    'Keep the nose pointing straight ahead.',
    'Pull back to stop. It will not stop on its own.',
  ],
  commonMistakes: ['Pushing too hard and flying past the gate.'],

  validate: (p, mem) =>
    withFlight(
      p,
      mem,
      (p, mem) => {
        mem.wander = Math.max(mem.wander ?? 0, Math.abs(p.position[0]));

        // Its own cursor, not `mem.wp` — see `ROUTE_CURSOR`. `withFlight`
        // owns `mem.wp`, so a route walked there is walked twice over and the
        // out-and-back scored itself finished the frame after lift-off.
        const r = flyRoute(mem, p.position, ROUTE, { key: ROUTE_CURSOR });
        mem.wp = r.next;
        if (r.complete)
          return { done: true, progress: 1, hint: 'Back at the start. Nicely flown', cue: [] };
        return {
          done: false,
          progress: clamp01(r.progress),
          hint:
            r.next === 0 ? 'Pitch forward to the blue gate' : 'Pitch backward, back to the start',
          cue: r.next === 0 ? CUE.forward : CUE.backward,
        };
      },
      2,
    ),

  stars: [
    {
      stars: 3,
      text: 'Pad to pad, out and back in 55s, under 2.5 m sideways, nothing touched',
      test: ({ touches, timeSec, collisions, smoothness, mem }) =>
        collisions === 0 &&
        touches === 0 &&
        (mem.wander ?? 0) <= 2.5 &&
        timeSec <= 55 &&
        smoothness >= 0.3,
    },
    {
      stars: 2,
      text: 'Pad to pad, out and back in 85s, under 5 m sideways',
      test: ({ timeSec, collisions, mem }) =>
        collisions === 0 && (mem.wander ?? 0) <= 5 && timeSec <= 85,
    },
  ],

  practiceTimeout: 75,
};

import { cueBetween, latch, type Lesson } from './types';
import { planCircle } from './demoFlight';
import { HOVER } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';
import {
  KEYS_PITCH,
  KEYS_ROLL,
  KEYS_THROTTLE,
  KEYS_YAW,
  PREFLIGHT_KEYS,
  PREFLIGHT_STAGES,
  afterPreflightDemo,
  preflightDemo,
  withPreflight,
} from './preflight';

// Module 11 — Circle. The square and the triangle are straight lines joined by
// stops. A circle never stops: both sticks stay in and their ratio changes
// continuously all the way round. Scored on swept angle and how even the radius
// stayed, so cutting a corner cannot pass.
const ALT = HOVER;
/** The helipad's own ring of white markers. The lap line is painted along it,
 *  so the sixteen dots and the red stripe are the same circle. */
const RADIUS = ACADEMY_PAD.lightRadius;
/** How far off the line still counts as being ON the ring — outside this the
 *  lap stops accumulating. Scaled to the bigger ring: the old 1.5 m band was set
 *  for a 4 m circle. */
const BAND = 1.8;
/** The lane the lap is meant to be held in, and what three stars asks for. Drawn
 *  on the map, quoted in the rubric, and the point at which the hint starts
 *  saying which way to nudge — one number, so the three cannot disagree. */
const LANE = 1.2;
/** Full turn, minus a little, so the finish does not depend on a perfect close. */
const TARGET_SWEEP = Math.PI * 2 * 0.95;

export const circleLesson: Lesson = {
  id: 'circle',
  order: 12,
  title: 'Full Circle',
  subtitle: 'One smooth lap, never stopping',

  explain: {
    title: 'Flying a Circle',
    body: [
      'Fly one lap around the helipad, on the red ring.',
      'There are no corners to stop at. Stay the same distance from the middle.',
    ],
  },

  // The ring is the task, so the guide PAINTS the whole circle on the deck
  // rather than marking a handful of points on it. Chopping it into checkpoints
  // would turn the one shape with no corners into a rounded polygon.
  guideRing: { radius: RADIUS, band: LANE },

  // A circle has no corners, but it does have two halves to the task: get out
  // onto the ring, then hold it all the way round — behind the two that get the
  // drone off the pad in the first place.
  stages: [...PREFLIGHT_STAGES, { label: 'Reach the ring' }, { label: 'Fly the lap' }],

  demo: [
    ...preflightDemo(),
    ...afterPreflightDemo(
      planCircle({
        radius: RADIUS,
        height: ALT,
        captions: [
          'Out to the ring of white markers',
          'Build some speed ALONG the ring, not across it',
          'Now lean INTO the middle — and keep leaning',
          'The lean points at the centre the whole way round',
          'Same lean, new direction — that is all a circle is',
          'Round the far side and back to the start',
          'Level out — one continuous arc, no stops',
        ],
      }),
    ),
  ],

  practice: {
    prompt: 'Arm, take off, then one full lap around the helipad, on the ring',
    hint: 'Press ENTER to arm',
  },

  // The circuit is flown on pitch and roll, so those go first — but the left
  // gimbal is not empty just because today's drill does not name it. A module
  // keeps every control the modules before it taught, and without the throttle
  // and yaw pairs the caps under the left stick vanish from Module 7 onward: the
  // pilot is shown a stick they were taught to use and then told nothing about
  // it, on the very lessons where they are holding height through a whole lap.
  keys: [...PREFLIGHT_KEYS, ...KEYS_PITCH, ...KEYS_ROLL, ...KEYS_THROTTLE, ...KEYS_YAW],

  tips: [
    'Get on the ring and steady before you start turning.',
    'Slowly turn the direction you push. Do not fly four curves.',
  ],
  commonMistakes: [
    'Cutting inside the ring on the far side.',
    'Stopping at four points, which makes it a square.',
  ],

  validate: (p, mem) =>
    withPreflight(p, mem, (p, mem) => {
      mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - ALT));

      const r = Math.hypot(p.position[0], p.position[2]);
      const onRing = Math.abs(r - RADIUS) <= BAND;
      const angle = Math.atan2(p.position[2], p.position[0]);

      // Sweep only accumulates while on the ring, so cutting across the middle
      // banks no progress. mem starts empty, hence the explicit "started" flag.
      if (!onRing) {
        mem.started = 0;
        if (!mem.sweep) mem.wp = 0;
        // Point at the nearest place on the ring, so "get back on it" is a
        // direction on the sticks rather than a sentence about radius.
        const scale = RADIUS / Math.max(r, 1e-3);
        return {
          done: false,
          progress: (mem.sweep ?? 0) / TARGET_SWEEP,
          hint: r < RADIUS ? 'Too tight. Move out to the ring' : 'Too wide. Come in to the ring',
          cue: cueBetween(p.position, [p.position[0] * scale, ALT, p.position[2] * scale]),
        };
      }

      if (!mem.started) {
        mem.started = 1;
        mem.prevAngle = angle;
      } else {
        let d = angle - (mem.prevAngle ?? angle);
        // Shortest way round, so crossing the -pi/+pi seam does not add a full turn.
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        mem.prevAngle = angle;
        // Direction is set by the first real movement; reversing cancels progress,
        // which is what stops someone wobbling back and forth to farm sweep.
        if (!mem.dir && Math.abs(d) > 1e-3) mem.dir = Math.sign(d);
        mem.sweep = Math.max(0, (mem.sweep ?? 0) + d * (mem.dir || 1));
        mem.radiusDev = Math.max(mem.radiusDev ?? 0, Math.abs(r - RADIUS));
      }

      const swept = mem.sweep ?? 0;
      const pct = Math.round((swept / (Math.PI * 2)) * 100);

      // Which way to nudge, said in metres and shown on the sticks.
      //
      // On the ring the module used to say nothing but the percentage, so a pilot
      // slowly winding inwards got no word about it until they fell out of the
      // band altogether and the lap stopped counting. The correction is small and
      // continuous — that is the whole skill — so the feedback has to be too.
      const off = r - RADIUS;
      const scale = RADIUS / Math.max(r, 1e-3);
      const toRing = cueBetween(p.position, [p.position[0] * scale, ALT, p.position[2] * scale]);
      // Latched: sweep unwinds if the pilot drifts back the other way, and losing
      // a completed circle to a wobble on the last metre is not a lesson in
      // anything.
      const round = latch(mem, 'round', swept >= TARGET_SWEEP);
      mem.wp = round ? 2 : 1;
      return {
        done: round,
        progress: round ? 1 : Math.min(1, swept / TARGET_SWEEP),
        hint: round
          ? 'Circle complete'
          : Math.abs(off) <= LANE * 0.5
            ? `On the line. ${pct}% round`
            : off < 0
              ? `${(-off).toFixed(1)} m inside — ease out. ${pct}% round`
              : `${off.toFixed(1)} m wide — ease in. ${pct}% round`,
        cue: Math.abs(off) <= LANE * 0.5 ? [] : toRing,
      };
    }),

  // Widened with the ring: the lap is now 43 m round rather than 25.
  stars: [
    {
      stars: 3,
      text: `Off the pad, within ${LANE} m of the ring, height within 0.9 m, lap under 80s, nothing touched`,
      test: ({ touches, timeSec, collisions, smoothness, mem }) =>
        collisions === 0 &&
        touches === 0 &&
        (mem.radiusDev ?? 99) <= LANE &&
        (mem.altDev ?? 0) <= 0.9 &&
        smoothness >= 0.35 &&
        timeSec <= 80,
    },
    {
      stars: 2,
      text: 'Within 1.8 m of the ring, height within 1.8 m',
      test: ({ collisions, mem }) =>
        collisions === 0 && (mem.radiusDev ?? 99) <= 1.8 && (mem.altDev ?? 0) <= 1.8,
    },
  ],

  practiceTimeout: 85,
};

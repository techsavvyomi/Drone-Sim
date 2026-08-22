import { latch, type Lesson } from './types';
import { planCircle } from './demoFlight';
import { HOVER } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';
import { useFlightStore } from '../../state/flightStore';

// Step 11 — Circle. The square and the triangle are straight lines joined by
// stops. A circle never stops: both sticks stay in and their ratio changes
// continuously all the way round. Scored on swept angle and how even the radius
// stayed, so cutting a corner cannot pass.
const ALT = HOVER;
/** The helipad's own ring of white markers — the circle is already painted on
 *  the field, so the lesson does not draw one. */
const RADIUS = ACADEMY_PAD.lightRadius;
/** Scaled to the bigger ring: the old 1.5 m band was set for a 4 m circle. */
const BAND = 1.8;
/** Full turn, minus a little, so the finish does not depend on a perfect close. */
const TARGET_SWEEP = Math.PI * 2 * 0.95;

export const circleLesson: Lesson = {
  id: 'circle',
  order: 10,
  title: 'Full Circle',
  subtitle: 'One smooth lap, never stopping',

  explain: {
    title: 'Flying a Circle',
    body: [
      'A circle is the one shape with no corners to rest at.',
      'Both sticks stay in the whole way round, and their balance changes continuously.',
      'Follow the ring of white markers around the helipad, keeping the radius even.',
      'Smooth and round beats fast — cutting in close will not count.',
    ],
  },

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    ...planCircle({
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
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'One full lap around the helipad, on the ring of markers',
    hint: 'Get out to the ring first, then start the arc',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: [
    'Fly out to the ring and settle before you start turning.',
    'Think of it as slowly rotating the direction you are pushing, not as four arcs.',
  ],
  commonMistakes: [
    'Cutting inside the ring on the far half.',
    'Turning it into a rounded square by pausing at four points.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - ALT));

    const r = Math.hypot(p.position[0], p.position[2]);
    const onRing = Math.abs(r - RADIUS) <= BAND;
    const angle = Math.atan2(p.position[2], p.position[0]);

    // Sweep only accumulates while on the ring, so cutting across the middle
    // banks no progress. mem starts empty, hence the explicit "started" flag.
    if (!onRing) {
      mem.started = 0;
      return {
        done: false,
        progress: (mem.sweep ?? 0) / TARGET_SWEEP,
        hint: r < RADIUS ? 'Too tight — move out to the ring' : 'Too wide — come in to the ring',
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
    // Latched: sweep unwinds if the pilot drifts back the other way, and losing
    // a completed circle to a wobble on the last metre is not a lesson in
    // anything.
    const round = latch(mem, 'round', swept >= TARGET_SWEEP);
    return {
      done: round,
      progress: round ? 1 : Math.min(1, swept / TARGET_SWEEP),
      hint: round ? 'Circle complete' : `Keep the arc going — ${pct}% round`,
    };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const rDev = mem.radiusDev ?? 99;
    const altDev = mem.altDev ?? 0;
    // Widened with the ring: the lap is now 43 m round rather than 25.
    if (rDev <= 1.2 && altDev <= 0.9 && smoothness >= 0.35 && timeSec <= 70) return 3;
    if (rDev <= 1.8 && altDev <= 1.8) return 2;
    return 1;
  },

  practiceTimeout: 75,
};

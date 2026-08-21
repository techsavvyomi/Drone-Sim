import { type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';
import { Pylon } from './props';

// Step 11 — Circle. The square and the triangle are straight lines joined by
// stops. A circle never stops: both sticks stay in and their ratio changes
// continuously all the way round. Scored on swept angle and how even the radius
// stayed, so cutting a corner cannot pass.
const ALT = 1.6;
const RADIUS = 4;
const BAND = 1.5;
/** Full turn, minus a little, so the finish does not depend on a perfect close. */
const TARGET_SWEEP = Math.PI * 2 * 0.95;

/** The path to follow, drawn flat on the ground. */
function CirclePath() {
  return (
    <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[RADIUS - 0.08, RADIUS + 0.08, 96]} />
      <meshBasicMaterial color="#38bdf8" transparent opacity={0.45} depthWrite={false} />
    </mesh>
  );
}

export const circleLesson: Lesson = {
  id: 'circle',
  order: 10,
  title: 'Circle',
  subtitle: 'One continuous arc',

  explain: {
    title: 'Flying a Circle',
    body: [
      'A circle is the one shape with no corners to rest at.',
      'Both sticks stay in the whole way round, and their balance changes continuously.',
      'Follow the marked ring around the centre pylon, keeping the radius even.',
      'Smooth and round beats fast — cutting in close will not count.',
    ],
  },

  Scene: () => (
    <>
      <CirclePath />
      <Pylon position={[0, 0, 0]} color="#34d399" />
    </>
  ),

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.0, stick: { roll: 0.3 }, key: 'ArrowRight', caption: 'Roll out to the ring' },
    { at: 5.2, stick: { roll: 0.26, pitch: 0.26 }, caption: 'Now blend pitch in — start the arc' },
    { at: 8.0, stick: { roll: -0.26, pitch: 0.26 }, caption: 'Keep rotating the mix…' },
    { at: 11.0, stick: { roll: -0.26, pitch: -0.26 }, caption: '…the balance never stops changing' },
    { at: 14.0, stick: { roll: 0.26, pitch: -0.26 }, caption: 'Round the far side' },
    { at: 17.0, stick: { roll: 0, pitch: 0 }, caption: 'Full circle — one continuous arc' },
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Fly one full circle around the pylon, on the ring',
    hint: 'Get out to the ring first, then start the arc',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Left' },
    { code: 'ArrowRight', label: '→', hint: 'Right' },
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
    return {
      done: swept >= TARGET_SWEEP,
      progress: Math.min(1, swept / TARGET_SWEEP),
      hint: swept >= TARGET_SWEEP ? 'Circle complete' : `Keep the arc going — ${pct}% round`,
    };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const rDev = mem.radiusDev ?? 99;
    const altDev = mem.altDev ?? 0;
    if (rDev <= 0.9 && altDev <= 0.8 && smoothness >= 0.35 && timeSec <= 55) return 3;
    if (rDev <= 1.4 && altDev <= 1.6) return 2;
    return 1;
  },

  practiceTimeout: 75,
};

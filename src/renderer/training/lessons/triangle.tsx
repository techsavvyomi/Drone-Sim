import { horizontalDist, visitInOrder, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';
import { Pylon } from './props';

// Step 10 — Triangle. Same closed-route idea as the square, but no side lines up
// with an axis, so every leg is a held pitch/roll mix — and each is a different
// mix. That is the step up from the square.
const ALT = 1.6;
const R = 4;
/** Three points on a circle of radius R, starting at the far side. */
const CORNERS = [0, 1, 2].map((k) => {
  const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
  return [Math.cos(a) * R, Math.sin(a) * R] as const;
});
const ROUTE = [...CORNERS, CORNERS[0]] as const;
const REACH = 1.1;

export const triangleLesson: Lesson = {
  id: 'triangle',
  order: 9,
  title: 'Triangle',
  subtitle: 'Three angled legs',

  explain: {
    title: 'Flying a Triangle',
    body: [
      'A triangle has no side that lines up with a stick.',
      'Every leg is a held mix of pitch and roll — and each leg needs a different mix.',
      'Fly the three pylons in order, then close the loop at the first.',
      'Judge each new heading before you set off, rather than correcting mid-leg.',
    ],
  },

  Scene: () => (
    <>
      {CORNERS.map(([x, z], i) => (
        <Pylon key={i} position={[x, 0, z]} color={i === 0 ? '#34d399' : '#f5a524'} />
      ))}
    </>
  ),

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.0, stick: { pitch: 0.34 }, caption: 'Leg 1 — out to the first pylon' },
    { at: 6.0, stick: { pitch: 0 }, caption: 'Corner' },
    { at: 6.8, stick: { pitch: -0.2, roll: 0.34 }, caption: 'Leg 2 — a different mix of both' },
    { at: 10.6, stick: { pitch: 0, roll: 0 }, caption: 'Corner' },
    { at: 11.4, stick: { pitch: -0.2, roll: -0.34 }, caption: 'Leg 3 — mirror of the last' },
    { at: 15.2, stick: { pitch: 0, roll: 0 }, caption: 'Corner' },
    { at: 16.0, stick: { pitch: 0.3 }, caption: 'Close the loop' },
    { at: 18.6, stick: { pitch: 0 }, caption: 'Triangle complete' },
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Fly the three pylons in order and close the loop',
    hint: 'Each leg is a different pitch/roll mix',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Left' },
    { code: 'ArrowRight', label: '→', hint: 'Right' },
  ],

  tips: [
    'Pause at each corner and pick the next mix before you move.',
    'The two return legs are mirrors of each other — same amounts, opposite roll.',
  ],
  commonMistakes: [
    'Flying the legs as L-shapes instead of straight angled runs.',
    'Overshooting a corner because the mix was set too strong.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - ALT));

    const i = visitInOrder(mem, 'wp', p.position, ROUTE, REACH);
    if (i >= ROUTE.length) return { done: true, progress: 1, hint: 'Triangle complete' };

    const [tx, tz] = ROUTE[i];
    const d = horizontalDist(p.position, tx, tz);
    const legProgress = Math.max(0, Math.min(1, 1 - (d - REACH) / (R * 2)));
    const last = i === ROUTE.length - 1;
    return {
      done: false,
      progress: (i + legProgress) / ROUTE.length,
      hint: last ? 'Close the loop — back to the green pylon' : `Leg ${i + 1} of 3`,
    };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const altDev = mem.altDev ?? 0;
    if (altDev <= 0.8 && timeSec <= 50 && smoothness >= 0.3) return 3;
    if (altDev <= 1.6 && timeSec <= 85) return 2;
    return 1;
  },

  practiceTimeout: 70,
};

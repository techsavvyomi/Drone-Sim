import { horizontalDist, visitInOrder, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';
import { Pylon } from './props';

// Step 9 — Square. The first closed route, and the first that has to be flown
// as a sequence rather than a there-and-back. Each side is a single axis, so a
// square is really "pitch, roll, pitch, roll" taken cleanly in turn.
const ALT = 1.6;
const S = 3.5;
const CORNERS = [
  [S, -S],
  [S, S],
  [-S, S],
  [-S, -S],
] as const;
/** Back to the first corner to close the loop. */
const ROUTE = [...CORNERS, CORNERS[0]] as const;
const REACH = 1.1;

export const squareLesson: Lesson = {
  id: 'square',
  order: 8,
  title: 'Square',
  subtitle: 'Four sides, four corners',

  explain: {
    title: 'Flying a Square',
    body: [
      'A square is four straight sides joined by four square corners.',
      'Each side needs only one stick — the skill is stopping cleanly before the next.',
      'Fly the pylons in order and close the loop back at the first one.',
      'Keep the same height all the way round.',
    ],
  },

  Scene: () => (
    <>
      {CORNERS.map(([x, z], i) => (
        <Pylon key={i} position={[x, 0, z]} color={i === 0 ? '#34d399' : '#38bdf8'} />
      ))}
    </>
  ),

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.0, stick: { roll: 0.34 }, key: 'ArrowRight', caption: 'Side 1 — roll right' },
    { at: 5.4, stick: { roll: 0 }, caption: 'Stop square at the corner' },
    { at: 6.2, stick: { pitch: -0.34 }, key: 'ArrowDown', caption: 'Side 2 — pitch back' },
    { at: 9.4, stick: { pitch: 0 }, caption: 'Corner' },
    { at: 10.2, stick: { roll: -0.34 }, key: 'ArrowLeft', caption: 'Side 3 — roll left' },
    { at: 13.4, stick: { roll: 0 }, caption: 'Corner' },
    { at: 14.2, stick: { pitch: 0.34 }, key: 'ArrowUp', caption: 'Side 4 — pitch forward' },
    { at: 17.4, stick: { pitch: 0 }, caption: 'Loop closed — one clean square' },
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Fly the four corners in order and close the loop',
    hint: 'One stick per side — stop square at each corner',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Backward' },
    { code: 'ArrowLeft', label: '←', hint: 'Left' },
    { code: 'ArrowRight', label: '→', hint: 'Right' },
  ],

  tips: [
    'Come to a stop at each corner before starting the next side.',
    'Sides are single-axis — if you need both sticks, you have drifted.',
  ],
  commonMistakes: [
    'Rounding the corners into a circle.',
    'Sinking a little on every side until the square is a spiral.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - ALT));

    const i = visitInOrder(mem, 'wp', p.position, ROUTE, REACH);
    if (i >= ROUTE.length) return { done: true, progress: 1, hint: 'Square complete' };

    const [tx, tz] = ROUTE[i];
    const d = horizontalDist(p.position, tx, tz);
    const legProgress = Math.max(0, Math.min(1, 1 - (d - REACH) / (S * 2)));
    const last = i === ROUTE.length - 1;
    return {
      done: false,
      progress: (i + legProgress) / ROUTE.length,
      hint: last ? 'Close the loop — back to the green pylon' : `Corner ${i + 1} of 4`,
    };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const altDev = mem.altDev ?? 0;
    if (altDev <= 0.8 && timeSec <= 55 && smoothness >= 0.3) return 3;
    if (altDev <= 1.6 && timeSec <= 90) return 2;
    return 1;
  },

  practiceTimeout: 70,
};

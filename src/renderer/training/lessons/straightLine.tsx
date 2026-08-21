import { horizontalDist, lineDeviation, visitInOrder, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';
import { Pylon } from './props';

// Step 7 — Straight Line. Pitch already taught "reach the checkpoint". This one
// is about HOW you get there: the score is driven by sideways drift off the
// line, not by arriving.
const ALT = 1.6;
const FAR_Z = -6;
const REACH = 1.0;
const ROUTE = [
  [0, FAR_Z],
  [0, 0],
] as const;

export const straightLineLesson: Lesson = {
  id: 'straight-line',
  order: 6,
  title: 'Straight Line',
  subtitle: 'Out and back on one axis',

  explain: {
    title: 'Flying a Straight Line',
    body: [
      'Reaching a marker is easy. Reaching it in a straight line is the skill.',
      'Fly out to the far pylon and back, staying on the line between them.',
      'Hold your heading — if the nose wanders, the path curves with it.',
      'You are scored on how far you drift sideways, not on how fast you get there.',
    ],
  },

  Scene: () => (
    <>
      <Pylon position={[0, 0, FAR_Z]} color="#38bdf8" />
      <Pylon position={[0, 0, 0]} color="#34d399" />
    </>
  ),

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.2, stick: { pitch: 0.34 }, key: 'ArrowUp', caption: 'Pitch forward — pure forward, no roll' },
    { at: 7.0, stick: { pitch: 0 }, caption: 'Level off at the far pylon' },
    { at: 8.2, stick: { pitch: -0.34 }, key: 'ArrowDown', caption: 'Straight back down the same line' },
    { at: 12.0, stick: { pitch: 0 }, caption: 'Home — one clean line each way' },
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Fly out to the far pylon and back, on the line',
    hint: 'Pure pitch — keep the nose and the path straight',
  },

  keys: [
    { code: 'ArrowUp', label: '↑', hint: 'Forward' },
    { code: 'ArrowDown', label: '↓', hint: 'Backward' },
    { code: 'KeyA', label: 'A', hint: 'Yaw left' },
    { code: 'KeyD', label: 'D', hint: 'Yaw right' },
  ],

  tips: [
    'Use small roll corrections to stay on the line — do not fight it with big inputs.',
    'Keep the heading fixed; correcting with yaw mid-run bends the path.',
  ],
  commonMistakes: [
    'Drifting sideways and only noticing at the end.',
    'Yawing instead of rolling to correct.',
  ],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - ALT));

    // Sideways drift off the run, sampled while actually travelling.
    const drift = lineDeviation(p.position, 0, 0, 0, FAR_Z);
    if (p.groundSpeed > 0.3) mem.maxDrift = Math.max(mem.maxDrift ?? 0, drift);

    const i = visitInOrder(mem, 'wp', p.position, ROUTE, REACH);
    if (i >= ROUTE.length) return { done: true, progress: 1, hint: 'Home — line held' };

    const [tx, tz] = ROUTE[i];
    const d = horizontalDist(p.position, tx, tz);
    const legProgress = Math.max(0, Math.min(1, 1 - (d - REACH) / 6));
    let hint: string;
    if (drift > 1.2) hint = 'Off the line — ease back onto it with roll';
    else hint = i === 0 ? 'Out to the far pylon' : 'Straight back home';
    return { done: false, progress: (i + legProgress) / ROUTE.length, hint };
  },

  score: ({ timeSec, collisions, mem }) => {
    if (collisions > 0) return 1;
    const drift = mem.maxDrift ?? 99;
    const altDev = mem.altDev ?? 0;
    if (drift <= 0.6 && altDev <= 0.7 && timeSec <= 30) return 3;
    if (drift <= 1.3 && altDev <= 1.4) return 2;
    return 1;
  },

  practiceTimeout: 45,
};

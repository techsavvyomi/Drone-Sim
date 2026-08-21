import { holdFor, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';
import { HoverBox } from './props';

// Lesson (Module 8) — Hovering. Hold a stable position inside a floating box for
// 10 seconds using small corrections on every axis.
const BOX_Y = 1.5;
const BOX = 1.5;
const HALF = BOX / 2;
const HOLD_SEC = 10;

export const hoverLesson: Lesson = {
  id: 'hover',
  order: 8,
  title: 'Hovering',
  subtitle: 'Hold a rock-steady hover',

  explain: {
    title: 'Hovering',
    body: [
      'A stable hover is the hardest basic skill — the drone always drifts.',
      'Make small, constant corrections on throttle, pitch and roll to stay put.',
      'Your goal: keep the drone inside the box for 10 seconds.',
    ],
  },

  Scene: () => <HoverBox position={[0, BOX_Y, 0]} size={BOX} />,

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off into the box' },
    { at: 3.4, stick: { pitch: 0.06 }, caption: 'Tiny corrections keep it centred' },
    { at: 4.6, stick: { roll: 0.06 }, caption: 'Nudge, don’t shove' },
    { at: 5.8, stick: { pitch: 0, roll: 0 }, caption: 'Settled — holding position' },
    { at: 7.4, caption: 'A steady hover inside the box' },
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    // Takeoff no longer arms on the pilot's behalf, so a lesson that drops the
    // student straight into the air has to arm the aircraft itself first.
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Hold your hover inside the box for 10 seconds',
    hint: 'Small corrections — keep it centred',
  },

  keys: [
    { code: 'KeyW', label: 'W', hint: 'Up' },
    { code: 'KeyS', label: 'S', hint: 'Down' },
    { code: 'ArrowUp', label: '↑', hint: 'Fwd' },
    { code: 'ArrowDown', label: '↓', hint: 'Back' },
  ],

  tips: ['Anticipate drift and correct early.', 'Relax — small inputs beat big ones.'],
  commonMistakes: ['Over-correcting and chasing the drift.', 'Fixating on one axis and drifting on another.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };

    const dx = Math.abs(p.position[0]);
    const dz = Math.abs(p.position[2]);
    const dy = Math.abs(p.altitude - BOX_Y);
    const inBox = dx < HALF && dz < HALF && dy < HALF;

    if (inBox) {
      mem.devSum = (mem.devSum ?? 0) + Math.hypot(dx, dz, dy) * p.dt;
      mem.devT = (mem.devT ?? 0) + p.dt;
    }

    const held = holdFor(mem, 'hold', inBox, p.dt, HOLD_SEC);
    return {
      done: held >= 1,
      progress: held,
      hint: inBox
        ? `Steady — hold ${Math.max(0, HOLD_SEC - held * HOLD_SEC).toFixed(0)}s`
        : 'Bring the drone back into the box',
    };
  },

  score: ({ collisions, mem }) => {
    if (collisions > 0) return 1;
    const avgDev = mem.devT ? mem.devSum / mem.devT : HALF;
    if (avgDev <= 0.35) return 3;
    if (avgDev <= 0.6) return 2;
    return 1;
  },

  practiceTimeout: 40,
};

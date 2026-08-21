import { horizontalDist, type Lesson } from './types';
import { useFlightStore } from '../../state/flightStore';
import { Pylon } from './props';

// Lesson (Module 7) — Roll. Move sideways by banking left/right. Fly out to the
// right marker, then across to the left marker.
const MARK_X = 4;
const REACH = 1.3;
const HOVER_ALT = 1.5;

export const rollLesson: Lesson = {
  id: 'roll',
  order: 7,
  title: 'Roll Control',
  subtitle: 'Slide left and right',

  explain: {
    title: 'Roll',
    body: [
      'Roll banks the drone to move it sideways, without changing which way it faces.',
      'It’s the sideways partner to pitch — together they let you fly anywhere.',
      'Your goal: fly across to the right marker, then over to the left marker.',
    ],
  },

  Scene: () => (
    <>
      <Pylon position={[MARK_X, 0, 0]} color="#a855f7" />
      <Pylon position={[-MARK_X, 0, 0]} color="#a855f7" />
    </>
  ),

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    { at: 3.2, stick: { roll: 0.4 }, key: 'ArrowRight', caption: 'Roll right — slide to the marker' },
    { at: 5.4, stick: { roll: 0 }, caption: 'Level off at the right marker' },
    { at: 6.2, stick: { roll: -0.45 }, key: 'ArrowLeft', caption: 'Roll left — cross to the other marker' },
    { at: 9.0, stick: { roll: 0 }, caption: 'Both markers cleared' },
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    // Takeoff no longer arms on the pilot's behalf, so a lesson that drops the
    // student straight into the air has to arm the aircraft itself first.
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Fly through the right marker, then the left',
    hint: 'Roll right to slide toward the marker',
  },

  keys: [
    { code: 'ArrowLeft', label: '←', hint: 'Left' },
    { code: 'ArrowRight', label: '→', hint: 'Right' },
  ],

  tips: ['Hold your altitude while sliding sideways.', 'Small bank angles keep it controllable.'],
  commonMistakes: ['Banking too hard and overshooting.', 'Dropping altitude during the slide.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - HOVER_ALT));

    if ((mem.stage ?? 0) === 0) {
      const d = horizontalDist(p.position, MARK_X, 0);
      if (d < REACH) mem.stage = 1;
      return { done: false, progress: 0.5 * Math.min(1, 1 - (d - REACH) / 6), hint: 'Roll right to the marker' };
    }

    const d = horizontalDist(p.position, -MARK_X, 0);
    const reached = d < REACH;
    return {
      done: reached,
      progress: 0.5 + 0.5 * Math.min(1, 1 - (d - REACH) / 8),
      hint: reached ? 'Both markers cleared' : 'Roll left to the far marker',
    };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const altDev = mem.altDev ?? 0;
    if (altDev <= 0.6 && timeSec <= 24 && smoothness >= 0.35) return 3;
    if (altDev <= 1.2 && timeSec <= 42) return 2;
    return 1;
  },
};

import { clamp01, flyRoute, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { home, marker, routeLegs } from './arena';
import { useFlightStore } from '../../state/flightStore';

// Module 3 — Roll Control. Pure sideways movement, flown between the white
// markers ringing the helipad. They are level with the pad, symmetrical either
// side of the "H" and close in, so the drill stays about the roll stick rather
// than about covering ground. Marker 8 is straight out to the left, marker 0
// straight out to the right.
const ROUTE = [
  marker(8, 'Left marker'),
  home('Centre'),
  marker(0, 'Right marker'),
  home('Centre'),
] as const;

export const rollLesson: Lesson = {
  id: 'roll',
  order: 3,
  title: 'Roll Control',
  subtitle: 'Slide sideways without turning',

  explain: {
    title: 'Roll Control',
    body: [
      'Roll banks the drone to move it sideways, without changing which way it faces.',
      'It’s the sideways partner to pitch — together they let you fly anywhere.',
      'Your goal: slide out to the left marker, back to the centre, then out to the right and back.',
      'Watch the nose: it should still point straight ahead the whole time.',
    ],
  },

  route: ROUTE,

  demo: [
    { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
    { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
    ...planDemo(
      routeLegs(ROUTE, [
        {
          caption: 'Roll left — slide out to the left marker',
          arrive: 'Roll BACK to stop on it — levelling off only coasts',
        },
        { caption: 'Roll right — back to the centre', arrive: 'Ease off to stop over the "H"' },
        { caption: 'Roll right — out to the right marker', arrive: 'Roll back to stop on it' },
        { caption: 'Roll left — home to the centre', arrive: 'Both markers cleared' },
      ]),
    ),
  ],

  setup: () => {
    const flight = useFlightStore.getState();
    if (!flight.armed) flight.toggleArm();
    flight.requestTakeoffLand();
  },

  practice: {
    prompt: 'Left marker, centre, right marker, centre',
    hint: 'Roll left to the marker on your left',
  },

  keys: [
    { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
    { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
  ],

  tips: ['Hold your altitude while sliding sideways.', 'Small bank angles keep it controllable.'],
  commonMistakes: ['Banking too hard and overshooting.', 'Letting the nose swing round — that is yaw, not roll.'],

  validate: (p, mem) => {
    if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
    mem.wander = Math.max(mem.wander ?? 0, Math.abs(p.position[2]));

    const r = flyRoute(mem, p.position, ROUTE, { spread: 8 });
    if (r.complete) return { done: true, progress: 1, hint: 'Both markers cleared' };
    const hints = [
      'Roll left to the marker on your left',
      'Roll right, back to the centre',
      'Roll right to the far marker',
      'Roll left, home to the centre',
    ];
    return { done: false, progress: clamp01(r.progress), hint: hints[r.next] };
  },

  score: ({ timeSec, collisions, smoothness, mem }) => {
    if (collisions > 0) return 1;
    const wander = mem.wander ?? 0;
    if (wander <= 2 && timeSec <= 30 && smoothness >= 0.3) return 3;
    if (wander <= 4 && timeSec <= 50) return 2;
    return 1;
  },

  practiceTimeout: 45,
};

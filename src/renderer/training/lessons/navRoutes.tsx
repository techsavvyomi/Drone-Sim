import { clamp01, flyRoute, type Checkpoint, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { gate, home, routeLegs } from './arena';
import { useFlightStore } from '../../state/flightStore';

// Modules 11-13 — Navigation. Three routes of growing length flown through the
// arena's own racing gates, built from one shared factory because only the
// route and the wording differ.
//
// A, B, C and D are always the SAME four gates, whichever module you are in:
// the two red rings first, then the two green rectangles. Learning the field
// once and then being asked for longer routes across it is the whole point —
// and the route guide puts the letter on the gate, so "fly to B" is something
// the pilot can see rather than something they have to remember.
//
// These are also the first lessons that can FAIL on technique rather than on
// crashing: taking a later gate before the one you are on ends the attempt. A
// route you are allowed to shortcut is not a route.

/** The lettered gates, in course order. Same letter, same gate, every module. */
const COURSE = [
  { letter: 'A', gate: 'red-left' },
  { letter: 'B', gate: 'red-right' },
  { letter: 'C', gate: 'green-left' },
  { letter: 'D', gate: 'green-right' },
] as const;

function navLesson(cfg: {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  /** How many of the lettered gates this route uses. */
  gates: number;
  /** Come back to the "H" at the end (the full circuit). */
  returnHome?: boolean;
  intro: string[];
  timeout: number;
  threeStarSec: number;
}): Lesson {
  const route: readonly Checkpoint[] = [
    ...COURSE.slice(0, cfg.gates).map((c) => gate(c.gate, c.letter, { ease: 1.3, through: true })),
    ...(cfg.returnHome ? [home('H')] : []),
  ];
  const labels = route.map((c) => c.label).join(' → ');

  return {
    id: cfg.id,
    order: cfg.order,
    title: cfg.title,
    subtitle: cfg.subtitle,

    explain: {
      title: `Navigation: ${labels}`,
      body: cfg.intro,
    },

    route,

    // Flown from the route itself, so the demonstration takes the same pads in
    // the same order the attempt is graded on — it cannot drift out of step
    // with the lesson the way a hand-timed stick script did.
    demo: [
      { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
      { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
      // A route is continuous flying, not a stop-start drill, so it is flown a
      // little brisker and with a shorter pause at each gate than the shape
      // circuits — without that the full A-D circuit runs past a minute.
      ...planDemo(
        routeLegs(
          route,
          route.map((c, i) => ({
            caption: `Line up on ${c.label}`,
            arrive:
              i === route.length - 1 ? 'Route complete' : `Through ${c.label} — on to the next`,
          })),
          0.48,
          { face: true },
        ),
        { gap: 0.45 },
      ),
    ],

    setup: () => {
      const flight = useFlightStore.getState();
      if (!flight.armed) flight.toggleArm();
      flight.requestTakeoffLand();
    },

    practice: {
      prompt: `Fly the route ${labels}, in order`,
      hint: `Head for ${route[0].label} first`,
    },

    keys: [
      { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
      { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
      { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
      { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
      { code: 'KeyA', label: 'A', hint: 'Yaw Left' },
      { code: 'KeyD', label: 'D', hint: 'Yaw Right' },
    ],

    tips: [
      'Look ahead to the next gate before you reach the current one.',
      'The gates stand a few metres up — climb early, not at the last moment.',
    ],
    commonMistakes: [
      'Taking the gates in the wrong order — that ends the attempt.',
      'Passing beside a gate instead of through its opening.',
    ],

    validate: (p, mem) => {
      if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
      mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - route[0].at[1]));

      const r = flyRoute(mem, p.position, route, { strict: true });
      if (r.outOfOrder) {
        return {
          done: false,
          failed: true,
          hint: `Wrong one — the route is ${labels}. Start again.`,
        };
      }
      if (r.complete) return { done: true, progress: 1, hint: 'Route complete' };
      return { done: false, progress: clamp01(r.progress), hint: `Next: ${route[r.next].label}` };
    },

    score: ({ timeSec, collisions, smoothness, mem }) => {
      if (collisions > 0) return 1;
      const altDev = mem.altDev ?? 0;
      if (altDev <= 1.2 && timeSec <= cfg.threeStarSec && smoothness >= 0.3) return 3;
      if (altDev <= 2.2 && timeSec <= cfg.threeStarSec * 1.8) return 2;
      return 1;
    },

    practiceTimeout: cfg.timeout,
  };
}

export const navABLesson = navLesson({
  id: 'nav-ab',
  order: 11,
  title: 'Route A → B',
  subtitle: 'Two gates, your first set route',
  gates: 2,
  intro: [
    'Navigation is flying a route someone else set, not wherever the drone drifts.',
    'The two red rings on the field are your A and B — the guide marks each one as you go.',
    'Fly through A, then across to B.',
    'Take them out of order and the attempt ends, so look before you move.',
  ],
  timeout: 60,
  threeStarSec: 42,
});

export const navABCLesson = navLesson({
  id: 'nav-abc',
  order: 12,
  title: 'Route A → B → C',
  subtitle: 'Three gates, taken in order',
  gates: 3,
  intro: [
    'Three gates now: the two red rings you know, then the green rectangle beyond them.',
    'Fly A, then B, then C. The gate you want next is marked and called out as you go.',
    'Reach each one closely enough to register it — passing nearby does not count.',
    'Cutting to a later gate ends the attempt.',
  ],
  timeout: 65,
  threeStarSec: 55,
});

export const navABCDLesson = navLesson({
  id: 'nav-abcd',
  order: 13,
  title: 'Route A → B → C → D',
  subtitle: 'Four gates, the full circuit',
  gates: 4,
  returnHome: true,
  intro: [
    'All four gates, in order, and then home — the full circuit.',
    'A, B, C, D, and finally back over the "H" you started from.',
    'D is the highest gate on the field, and the run home from it is the longest leg.',
    'Order is checked at every step, so no shortcuts.',
  ],
  timeout: 75,
  threeStarSec: 75,
});

import { clamp01, cueBetween, flyRoute, type Checkpoint, type Lesson } from './types';
import { planDemo } from './demoFlight';
import { HOVER, gate, home, routeLegs } from './arena';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';

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
  /** Where the route starts from: the hover over the "H". */
  const start: readonly [number, number, number] = [
    ACADEMY_PAD.center[0],
    HOVER,
    ACADEMY_PAD.center[1],
  ];

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

    // Opens at a hover, like every lesson after Module 2 that is not itself
    // about getting off the ground.
    startAirborne: true,

    // Flown from the route itself, so the demonstration takes the same pads in
    // the same order the attempt is graded on — it cannot drift out of step
    // with the lesson the way a hand-timed stick script did.
    demo: [
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

    practice: {
      prompt: `Fly the route ${labels}, in order`,
      hint: `Fly to ${route[0].label}`,
    },

    // The throttle belongs on this row. These gates stand between 2.4 m and 5 m
    // up, and the highest one cannot be reached from the opening hover at all —
    // a pilot shown only the arrows would fly at it forever. Every other control
    // the route needs is here too, because navigation is the module where they
    // are finally used together.
    keys: [
      { code: 'ArrowUp', label: '↑', hint: 'Pitch Forward' },
      { code: 'ArrowDown', label: '↓', hint: 'Pitch Backward' },
      { code: 'ArrowLeft', label: '←', hint: 'Roll Left' },
      { code: 'ArrowRight', label: '→', hint: 'Roll Right' },
      { code: 'KeyW', label: 'W', hint: 'Throttle Up' },
      { code: 'KeyS', label: 'S', hint: 'Throttle Down' },
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
      if (p.crashed) return { done: false, failed: true, hint: 'Crashed. Try again', cue: [] };
      mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - route[0].at[1]));

      const r = flyRoute(mem, p.position, route, { strict: true });
      if (r.outOfOrder) {
        return {
          done: false,
          failed: true,
          hint: `Wrong one. The route is ${labels}. Start again`,
          cue: [],
        };
      }
      if (r.complete) return { done: true, progress: 1, hint: 'Route complete', cue: [] };
      const from = r.next === 0 ? start : route[r.next - 1].at;
      return {
        done: false,
        progress: clamp01(r.progress),
        hint: `Fly to ${route[r.next].label}`,
        cue: cueBetween(from, route[r.next].at),
      };
    },

    stars: [
      {
        stars: 3,
        text: `Whole route in ${cfg.threeStarSec} seconds, height held within 1.2 m`,
        test: ({ timeSec, collisions, smoothness, mem }) =>
          collisions === 0 &&
          (mem.altDev ?? 0) <= 1.2 &&
          timeSec <= cfg.threeStarSec &&
          smoothness >= 0.3,
      },
      {
        stars: 2,
        text: `Whole route in ${Math.round(cfg.threeStarSec * 1.8)} seconds, height within 2.2 m`,
        test: ({ timeSec, collisions, mem }) =>
          collisions === 0 && (mem.altDev ?? 0) <= 2.2 && timeSec <= cfg.threeStarSec * 1.8,
      },
    ],

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
    'A set route this time: fly through gate A, then across to gate B.',
    'The path is drawn on the field and the gate you want next is marked.',
    'Take them out of order and the attempt ends.',
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
    'Three gates now: A, then B, then the green one beyond them, C.',
    'Fly through each opening. Passing beside a gate does not count.',
    'Skipping ahead to a later gate ends the attempt.',
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
    'The full circuit: A, B, C, D, and then back over the "H" you started from.',
    'D is the highest gate on the field and the run home from it is the longest leg.',
    'Order is checked at every step, so no shortcuts.',
  ],
  timeout: 75,
  threeStarSec: 75,
});

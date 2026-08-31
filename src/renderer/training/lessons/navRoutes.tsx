import { cueBetween, type Checkpoint, type Lesson } from './types';
import { flyMission, type MissionLeg } from './mission';
import { planDemo } from './demoFlight';
import { HOVER, gate, home, routeLegs } from './arena';
import { PREFLIGHT_STAGES, PREFLIGHT_STEPS } from './preflight';
import { ACADEMY_PAD } from '../../plugins/environments/droneAcademy';

// Modules 12-14 — Navigation. Three routes of growing length flown through the
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
//
// The LAST of them is flown as a whole flight, from the pad and back onto it —
// arm, take off, then yaw at each gate, climb to it and go through, and land on
// the "H" at the end. It is the closing module of the course, so it is the one
// place every control the syllabus taught is asked for in a single go. The two
// shorter routes stay hover drills: they are about the ORDER of the gates, and
// opening each of them with a take-off would be Module 1's lesson three times
// over.

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
  /** Fly it from the ground: arm and take off at the start, land at the end. */
  wholeFlight?: boolean;
  intro: string[];
  timeout: number;
  threeStarSec: number;
}): Lesson {
  const route: readonly Checkpoint[] = [
    ...COURSE.slice(0, cfg.gates).map((c) =>
      gate(c.gate, c.letter, { ease: 1.3, through: true, tag: c.letter }),
    ),
    ...(cfg.returnHome ? [home('H')] : []),
  ];
  const labels = route.map((c) => c.label).join(' → ');
  /** Where the route starts from: the hover over the "H". */
  const start: readonly [number, number, number] = [
    ACADEMY_PAD.center[0],
    HOVER,
    ACADEMY_PAD.center[1],
  ];

  /** One instruction and one control per leg, for the whole-flight validator. */
  const legs: MissionLeg[] = route.map((c, i) => ({
    hint: `Fly to ${c.label}`,
    cue: cueBetween(i === 0 ? start : route[i - 1].at, c.at),
  }));

  // A route is continuous flying, not a stop-start drill, so it is flown a
  // little brisker and with a shorter pause at each gate than the shape
  // circuits — without that the full A-D circuit runs past a minute.
  //
  // `face: true` is what turns it into flying rather than crabbing: the drone
  // points at each gate before it sets off, which is where the yaw beats in the
  // demonstration come from, and the climbs to the gates come out of the legs'
  // own heights. So the whole of "yaw left, throttle up, pitch forward, through
  // A" is solved from the route rather than written down.
  const ARM_AT = 1.2;
  const TAKEOFF_AT = 4.0;
  const routeDemo = planDemo(
    routeLegs(
      route,
      route.map((c, i) => ({
        caption: `Line up on ${c.label}`,
        arrive: i === route.length - 1 ? 'Route complete' : `Through ${c.label} — on to the next`,
      })),
      0.48,
      { face: true },
    ),
    { gap: 0.45, startAt: TAKEOFF_AT + 1.6 },
  );
  const LANDS_AT = (routeDemo[routeDemo.length - 1]?.at ?? 0) + 1.4;

  const flightDemo = [
    { at: 0.0, caption: 'On the pad, motors off' },
    {
      at: ARM_AT,
      stage: 0,
      cmd: 'arm' as const,
      key: 'Enter',
      caption: 'ENTER — armed and live',
    },
    {
      at: TAKEOFF_AT,
      stage: 1,
      cmd: 'takeoffLand' as const,
      key: 'Space',
      caption: 'SPACE — it climbs to a hover on its own',
    },
    // The route legs sit two steps into the row: Arm, Take off, then the gates.
    ...routeDemo.map((step) => ({
      ...step,
      stage: step.stage === undefined ? undefined : step.stage + PREFLIGHT_STEPS,
    })),
    ...(cfg.wholeFlight
      ? [
          {
            at: LANDS_AT,
            stage: PREFLIGHT_STEPS + route.length,
            // Waits for the aircraft to actually be over the "H". The route is a
            // ninety-second open-loop flight through four gates and five turns,
            // and the error adds up: fired on the clock, the landing put the drone
            // down beside gate D, which is the one place the lesson has just
            // finished telling the pilot NOT to leave it.
            waitNear: { x: ACADEMY_PAD.center[0], z: ACADEMY_PAD.center[1], reach: 3 },
            cmd: 'takeoffLand' as const,
            key: 'Space',
            caption: 'Back over the "H". SPACE puts it down',
          },
          { at: LANDS_AT + 3.0, cmd: 'disarm' as const, key: 'Enter', caption: 'Motors off' },
        ]
      : []),
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

    // Every module is flown from the pad now. The full circuit also comes back
    // down onto it; the two shorter routes end when the last gate is taken.

    // The row lists what the PILOT does, in order — the gates are the middle of
    // it, not the whole of it (#35).
    stages: [
      ...PREFLIGHT_STAGES,
      ...route.map((c) => ({ label: c.label })),
      ...(cfg.wholeFlight ? [{ label: 'Land', cap: 'SPACE' }] : []),
    ],

    // Flown from the route itself, so the demonstration takes the same pads in
    // the same order the attempt is graded on — it cannot drift out of step
    // with the lesson the way a hand-timed stick script did.
    demo: flightDemo,

    practice: {
      prompt: cfg.wholeFlight
        ? `Arm, take off, fly ${labels} in order, then land on the "H"`
        : `Arm, take off, then fly the route ${labels}, in order`,
      hint: 'Press ENTER to arm',
    },

    // The throttle belongs on this row. These gates stand between 2.4 m and 5 m
    // up, and the highest one cannot be reached from the opening hover at all —
    // a pilot shown only the arrows would fly at it forever. Every other control
    // the route needs is here too, because navigation is the module where they
    // are finally used together.
    keys: [
      // A module that lands says so on the cap; the shorter routes end in the
      // air, and naming a step the lesson never asks for is how a pilot ends up
      // looking for it.
      { code: 'Enter', label: 'ENTER', hint: 'Arm' },
      { code: 'Space', label: 'SPACE', hint: cfg.wholeFlight ? 'Take Off / Land' : 'Take Off' },
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
      'Look at the next gate before you reach this one.',
      'The gates are a few metres up. Climb early.',
      ...(cfg.wholeFlight ? ['Point at the gate first, then fly to it.'] : []),
    ],
    commonMistakes: [
      'Taking the gates in the wrong order.',
      'Going past the side of a gate instead of through it.',
      ...(cfg.wholeFlight ? ['Forgetting to land on the "H".'] : []),
    ],

    validate: (p, mem) => {
      // Height is only a technique score once the drone is up. Every module
      // starts on the deck now, and grading the take-off against the first
      // gate's altitude would spend the star before the flight began.
      if (mem.airborne) {
        mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - route[0].at[1]));
      }

      // The full circuit is a FLIGHT that also LANDS: arm, take off, the route,
      // down on the "H". `flyMission` walks all of it, preflight included.
      if (cfg.wholeFlight) {
        return flyMission(p, mem, route, legs, {
          strict: true,
          wrongHint: `Wrong one. The route is ${labels}. Start again`,
        });
      }

      // The shorter routes are the same flight minus the landing: `spot: null`
      // finishes them the moment the last gate is taken.
      return flyMission(p, mem, route, legs, {
        spot: null,
        strict: true,
        wrongHint: `Wrong one. The route is ${labels}. Start again`,
      });
    },

    stars: [
      {
        stars: 3,
        text: `Route in ${cfg.threeStarSec}s, height within 1.2 m, nothing touched`,
        test: ({ touches, timeSec, collisions, smoothness, mem }) =>
          collisions === 0 &&
          touches === 0 &&
          (mem.altDev ?? 0) <= 1.2 &&
          timeSec <= cfg.threeStarSec &&
          smoothness >= 0.3,
      },
      {
        stars: 2,
        text: `Route in ${Math.round(cfg.threeStarSec * 1.8)}s, height within 2.2 m`,
        test: ({ timeSec, collisions, mem }) =>
          collisions === 0 && (mem.altDev ?? 0) <= 2.2 && timeSec <= cfg.threeStarSec * 1.8,
      },
    ],

    practiceTimeout: cfg.timeout,
  };
}

export const navABLesson = navLesson({
  id: 'nav-ab',
  order: 12,
  title: 'Your First Route',
  subtitle: 'Two gates, your first set route',
  gates: 2,
  intro: [
    'A fixed route: through gate A, then over to gate B.',
    'Take them out of order and you start again.',
  ],
  timeout: 70,
  threeStarSec: 50,
});

export const navABCLesson = navLesson({
  id: 'nav-abc',
  order: 13,
  title: 'Three Gates in Order',
  subtitle: 'Three gates, taken in order',
  gates: 3,
  intro: [
    'Three gates now: A, then B, then C, the green one.',
    'Fly through each gate. Skip one and you start again.',
  ],
  timeout: 75,
  threeStarSec: 63,
});

// The last module of the course, and the only one that asks for everything at
// once: ENTER, SPACE, the yaw keys to point at each gate, the throttle to climb
// to it and the pitch stick to go through — then home and down.
export const navABCDLesson = navLesson({
  id: 'nav-abcd',
  order: 14,
  title: 'The Whole Flight',
  subtitle: 'The full circuit, pad to pad',
  gates: 4,
  returnHome: true,
  wholeFlight: true,
  intro: [
    'The whole course in one flight: arm, take off, A, B, C, D, home, land.',
    'Turn to face each gate before you fly to it. Climb early, D is the highest.',
  ],
  // Longer than the others: this one pays for a take-off and a landing as well
  // as the route.
  timeout: 90,
  threeStarSec: 95,
});

import { followRoute, horizontalDist, type Lesson, type LessonMemory, type Probe } from './types';
import { useFlightStore } from '../../state/flightStore';
import { Checkpoint } from './props';

// Steps 12-14 — Navigation. Three waypoint routes of growing length, built from
// one shared factory because only the route and the wording differ.
//
// These are the first lessons that can FAIL on technique rather than on crashing:
// taking a later gate before the one you are on ends the attempt. That is the
// whole point — a route you are allowed to shortcut is not a route.
const ALT = 1.6;
const REACH = 1.2;
/** Gate colours, in visiting order, so "the blue one" is unambiguous mid-flight. */
const COLOURS = ['#38bdf8', '#a855f7', '#f5a524', '#34d399'];
const NAMES = ['A', 'B', 'C', 'D'];

type Point = readonly [number, number];

function navLesson(cfg: {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  route: readonly Point[];
  intro: string[];
  demoSticks: { at: number; stick: Record<string, number>; caption: string }[];
  timeout: number;
  threeStarSec: number;
}): Lesson {
  const { route } = cfg;
  const labels = route.map((_, i) => NAMES[i]).join(' → ');

  return {
    id: cfg.id,
    order: cfg.order,
    title: cfg.title,
    subtitle: cfg.subtitle,

    explain: {
      title: `Navigation: ${labels}`,
      body: cfg.intro,
    },

    Scene: () => (
      <>
        {route.map(([x, z], i) => (
          <Checkpoint key={i} position={[x, ALT, z]} color={COLOURS[i]} />
        ))}
      </>
    ),

    demo: [
      { at: 0.0, cmd: 'arm', key: 'Enter', caption: 'Arm — motors spool up to idle' },
      { at: 0.0, cmd: 'takeoffLand', key: 'Space', caption: 'Take off to a hover' },
      ...cfg.demoSticks.map((d) => ({ at: d.at, stick: d.stick, caption: d.caption })),
    ],

    setup: () => {
      const flight = useFlightStore.getState();
      if (!flight.armed) flight.toggleArm();
      flight.requestTakeoffLand();
    },

    practice: {
      prompt: `Fly the route ${labels}, in order`,
      hint: `Head for gate ${NAMES[0]} first`,
    },

    keys: [
      { code: 'ArrowUp', label: '↑', hint: 'Forward' },
      { code: 'ArrowDown', label: '↓', hint: 'Backward' },
      { code: 'ArrowLeft', label: '←', hint: 'Left' },
      { code: 'ArrowRight', label: '→', hint: 'Right' },
      { code: 'KeyA', label: 'A', hint: 'Yaw left' },
      { code: 'KeyD', label: 'D', hint: 'Yaw right' },
    ],

    tips: [
      'Look ahead to the next gate before you reach the current one.',
      'Slow down as you arrive — overshooting a gate wastes more time than easing in.',
    ],
    commonMistakes: [
      'Taking the gates in the wrong order — that ends the attempt.',
      'Flying past a gate without passing close enough to register it.',
    ],

    validate: (p: Probe, mem: LessonMemory) => {
      if (p.crashed) return { done: false, failed: true, hint: 'Crashed — try again' };
      mem.altDev = Math.max(mem.altDev ?? 0, Math.abs(p.altitude - ALT));

      const r = followRoute(mem, 'wp', p.position, route, REACH);
      if (r.outOfOrder) {
        return {
          done: false,
          failed: true,
          hint: `Wrong gate — the route is ${labels}. Start again.`,
        };
      }
      if (r.complete) return { done: true, progress: 1, hint: 'Route complete' };

      const [tx, tz] = route[r.next];
      const d = horizontalDist(p.position, tx, tz);
      const leg = Math.max(0, Math.min(1, 1 - (d - REACH) / 10));
      return {
        done: false,
        progress: (r.next + leg) / route.length,
        hint: `Gate ${NAMES[r.next]} next`,
      };
    },

    score: ({ timeSec, collisions, smoothness, mem }) => {
      if (collisions > 0) return 1;
      const altDev = mem.altDev ?? 0;
      if (altDev <= 0.9 && timeSec <= cfg.threeStarSec && smoothness >= 0.3) return 3;
      if (altDev <= 1.8 && timeSec <= cfg.threeStarSec * 1.8) return 2;
      return 1;
    },

    practiceTimeout: cfg.timeout,
  };
}

export const navABLesson = navLesson({
  id: 'nav-ab',
  order: 11,
  title: 'Route A → B',
  subtitle: 'Point to point',
  route: [
    [0, -5],
    [5, 3],
  ],
  intro: [
    'Navigation is flying a route someone else set, not wherever the drone drifts.',
    'Two gates: fly through A, then through B.',
    'Reach each one closely enough to register it — passing nearby does not count.',
    'Take them out of order and the attempt ends, so look before you move.',
  ],
  demoSticks: [
    { at: 3.0, stick: { pitch: 0.34 }, caption: 'Straight out to gate A' },
    { at: 6.4, stick: { pitch: 0, roll: 0 }, caption: 'Through A — now line up for B' },
    { at: 7.4, stick: { pitch: -0.22, roll: 0.32 }, caption: 'Across to gate B' },
    { at: 11.2, stick: { pitch: 0, roll: 0 }, caption: 'Through B — route complete' },
  ],
  timeout: 50,
  threeStarSec: 26,
});

export const navABCLesson = navLesson({
  id: 'nav-abc',
  order: 12,
  title: 'Route A → B → C',
  subtitle: 'Three waypoints',
  route: [
    [-5, -4],
    [5, -4],
    [0, 5],
  ],
  intro: [
    'Three gates now, and they are not in a straight line.',
    'Fly A, then B, then C — each turn sets up the next leg.',
    'The gate you want next is called out on screen as you go.',
    'Cutting to a later gate ends the attempt.',
  ],
  demoSticks: [
    { at: 3.0, stick: { pitch: 0.26, roll: -0.26 }, caption: 'Out to gate A' },
    { at: 6.6, stick: { pitch: 0, roll: 0 }, caption: 'Through A' },
    { at: 7.4, stick: { roll: 0.34 }, caption: 'Straight across to B' },
    { at: 11.4, stick: { roll: 0 }, caption: 'Through B' },
    { at: 12.2, stick: { pitch: -0.3, roll: -0.2 }, caption: 'Back and left to C' },
    { at: 16.4, stick: { pitch: 0, roll: 0 }, caption: 'Through C — route complete' },
  ],
  timeout: 65,
  threeStarSec: 38,
});

export const navABCDLesson = navLesson({
  id: 'nav-abcd',
  order: 13,
  title: 'Route A → B → C → D',
  subtitle: 'Extended navigation',
  route: [
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ],
  intro: [
    'Four gates around the field — the full circuit.',
    'Fly A, B, C, D in order, holding your height the whole way.',
    'This is the square you already know, flown as a navigation task: the gates',
    'have to be hit properly, and the order is checked.',
  ],
  demoSticks: [
    { at: 3.0, stick: { pitch: 0.26, roll: -0.26 }, caption: 'Out to gate A' },
    { at: 6.8, stick: { pitch: 0, roll: 0 }, caption: 'Through A' },
    { at: 7.6, stick: { roll: 0.34 }, caption: 'Across to B' },
    { at: 11.6, stick: { roll: 0 }, caption: 'Through B' },
    { at: 12.4, stick: { pitch: -0.34 }, caption: 'Back to C' },
    { at: 16.4, stick: { pitch: 0 }, caption: 'Through C' },
    { at: 17.2, stick: { roll: -0.34 }, caption: 'Across to D' },
    { at: 21.2, stick: { roll: 0 }, caption: 'Through D — circuit complete' },
  ],
  timeout: 85,
  threeStarSec: 52,
});

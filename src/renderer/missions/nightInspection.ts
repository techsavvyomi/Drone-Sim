import { CABINS, CABIN_SIZE, COL_W, levelY, STOREY, SLAB_T } from '../scene/environment/siteLayout';
import type { Mission, MissionInspectionPoint, MissionZone } from './types';

// ----------------------------------------------------------------------------
// Mission 8 — Night Shift Inspection (the Construction Site, after dark).
//
// Three sections of the frame to inspect, in order, at night, with no route.
// Each is a five second hold: in the hover volume, steady, and with the drone's
// spotlight ON the marked structure. The light is not decoration — the lamp is
// aimed ahead of the nose and below it, so an inspection is flown facing the
// thing, a few metres off it and a little above, which is how a real one is.
// Too close to the structure and the hold stops; drift off and it restarts.
//
// No route line and no rings. What the pilot has to navigate by is the site
// itself: the floodlights, the amber marker on each zone, the spotlight, and the
// radar dot in the corner.
//
// The three zones climb the building:
//
//   1. East face, Level 2 — a column seen from outside the frame.
//   2. Inside Level 3 — the floor at the lift-core doorway. The drone has to fly
//      into the storey from the open east side and hold with a slab 1.5 m over
//      its rotors.
//   3. The unfinished roof — a column head standing bare where the roof slab
//      was never poured.
//
// WHY EACH HOVER SITS WHERE IT DOES. The lamp leans 60° off straight down (see
// `LIGHT_TILT_DEG`), so on a level hover its axis runs 30° below the horizon.
// Every hover is placed so the target lies close to that line from it — about
// 4 m out and 2 m up — which puts the target in the middle of the cone for a
// pilot who is simply facing it. The test file checks the angle for all three.
//
// Clearances are measured against `siteLayout.ts`: the frame's columns, slabs,
// core and infill. The upright precast columns leaning on the east face stand
// on the ground at x ≈ 19 m, well under Zone 1's Level 2 line of sight.
// ----------------------------------------------------------------------------

/** The site office pad: on the hardstanding west of the welfare cabins, five
 *  metres off their face, facing the building. */
const OFFICE_CABIN = CABINS[0];
const OFFICE_PAD: readonly [number, number] = [
  OFFICE_CABIN[0] - CABIN_SIZE[0] / 2 - 5,
  (CABINS[0][1] + CABINS[1][1]) / 2,
];

/** Half a column, for the structure boxes. */
const HC = COL_W / 2;
/** Clear height of a storey, slab top to the soffit above. */
const CLEAR = STOREY - SLAB_T;

/** A hover zone, built the same way for all three. */
function hover(
  at: readonly [number, number],
  groundY: number,
  band: { min: number; max: number },
  storey?: MissionZone['storey'],
): MissionZone {
  return {
    kind: 'drop',
    at,
    label: 'Inspection zone',
    groundY,
    radius: 1.5,
    band,
    // A hover, not a set-down: stopped, not merely slow.
    maxGroundSpeed: 0.6,
    maxVerticalSpeed: 0.5,
    hold: 5,
    storey,
  };
}

const POINTS: readonly MissionInspectionPoint[] = [
  {
    id: 'z1',
    name: 'Zone 1',
    label: 'East face, Level 2',
    // Hover 4.25 m out from the east face, 10.6 m up.
    zone: hover([22.5, -6], 0, { min: 9.6, max: 11.6 }),
    // The column at the east grid line, z -6, a metre up Level 2.
    target: [18 + HC, levelY(2) + 1, -6],
    // The column and the face either side of it on that storey.
    structure: { min: [18 - HC, levelY(2), -12], max: [18 + HC, levelY(2) + CLEAR, 0] },
  },
  {
    id: 'z2',
    name: 'Zone 2',
    label: 'Lift core doorway, Level 3',
    // Inside the storey, in the bay east of the core: 3.35 m from the nearest
    // column, 1.8 m over the slab and 1.55 m under the soffit at the band's
    // middle.
    zone: hover(
      [4.5, -3],
      levelY(3),
      { min: 1.2, max: 2.4 },
      {
        level: 3,
        height: STOREY,
        clear: CLEAR,
      },
    ),
    // The slab at the doorway's threshold, just out from the core's east wall.
    target: [0.6, levelY(3) + 0.05, -3],
    // The core's east wall on that storey.
    structure: { min: [-0.15, levelY(3), -6], max: [0.15, levelY(3) + CLEAR, 0] },
  },
  {
    id: 'z3',
    name: 'Zone 3',
    label: 'Unfinished roof, column head',
    // Over the open half of the roof, looking down onto a bare column head.
    // Judged from Level 6's slab, which is what is under the drone there.
    zone: hover([12, -2], levelY(6), { min: 4.6, max: 6.4 }),
    // The top of the Level 6 column at (12, -6), with nothing poured on it.
    target: [12, levelY(6) + CLEAR, -6 + HC],
    structure: {
      min: [12 - HC, levelY(6), -6 - HC],
      max: [12 + HC, levelY(6) + CLEAR, -6 + HC],
    },
  },
];

const PAR = 240;

export const nightInspection: Mission = {
  id: 'night-shift-inspection',
  order: 8,
  name: 'Night Shift Inspection',
  subtitle: 'Inspect the frame after dark, by your own light',
  kind: 'inspection',
  envId: 'construction-site',
  icon: '🔦',
  compactBrief: true,
  blurb:
    'Take off from the site office at night, inspect three marked sections of the frame by spotlight, then land back at the office.',
  story:
    'The site has shut down for the night. Before the crew is back in the morning, the site manager needs three sections of the unfinished structure checked for damage. There is no route. Use your light.',
  flow: [
    { label: 'Find', note: 'Look for the amber marker', art: 'nightsite' },
    // Three beats: the climb up the building is the order the zones are
    // inspected in, and it says so here rather than on a card of its own.
    { label: 'Inspect', note: 'Light on it, 5 s, zones 1 to 3', art: 'inspect' },
    { label: 'Land', note: 'Back at the site office', art: 'land' },
  ],
  objectives: [
    'Take off from the site office and find Inspection Zone 1 on the east face.',
    'At each zone, hold still for 5 seconds with your spotlight on the marked structure.',
    'Inspect Zones 1, 2 and 3 in order, working up the building.',
    'Return to the site office and land safely.',
  ],
  rules: [
    'No route is marked. Find each zone by its amber marker, the site lights and your spotlight.',
    'Move away during the hold and the inspection restarts from zero.',
    'Keep 1.6 m clear of the structure you are inspecting. Closer stops the hold.',
  ],
  mapNote: 'Night · floodlights only',
  hour: 'night',
  // The roof zone hovers up to 28 m over the site, and the Guru's own limit
  // is 30 soft-limited from 28. This only ever raises it.
  ceiling: 34,
  timeLimitSec: 420,
  parTimeSec: PAR,
  groundY: 0,
  medals: { bronze: 4, silver: 4, gold: 4 },
  routeAltitude: 10,
  route: [],
  homeVia: [],
  spawn: { position: [OFFICE_PAD[0], 0.25, OFFICE_PAD[1]], heading: 90 },
  inspection: {
    points: POINTS,
    holdSec: 5,
    // The lamp's own cone, the same the tiger survey flies with.
    coneDeg: 26,
    lightRange: 14,
    minClearance: 1.6,
  },
  resultRows: [
    'Zone 1 inspected',
    'Zone 2 inspected',
    'Zone 3 inspected',
    'Returned to base',
    'Safe landing',
  ],
  crashLine:
    'The aircraft is wrecked. At night the frame is closer than it looks: come in slowly, and keep the light ahead of you.',
  timeoutLine:
    'The shift ran out before the inspection did. Go straight from one amber marker to the next, and work up the building.',

  zones: {
    // Unused by the runtime — an inspection collects nothing — but the type
    // wants three zones, and the office is the honest answer for all of them.
    pickup: {
      kind: 'pickup',
      at: OFFICE_PAD,
      label: 'Site office',
      radius: 1.5,
      band: { min: 0, max: 3 },
      maxGroundSpeed: 12,
      maxVerticalSpeed: 12,
      hold: 0,
    },
    drop: POINTS[0].zone,
    base: {
      kind: 'base',
      at: OFFICE_PAD,
      label: 'Site office',
      radius: 1.5,
      band: { min: 0, max: 3 },
      maxGroundSpeed: 12,
      maxVerticalSpeed: 12,
      hold: 0,
    },
  },

  radio: {
    start: {
      id: 'start',
      text: 'Site is shut down for the night. Take off from the office and find Inspection Zone 1 on the east face, Level 2. Look for the amber marker.',
    },
    'delivered-z1': {
      id: 'delivered-z1',
      text: 'Zone 1 logged. Zone 2 is inside Level 3, at the lift core doorway. Fly in from the east side.',
    },
    'delivered-z2': {
      id: 'delivered-z2',
      text: 'Zone 2 logged. The last one is up on the roof, where the columns stand bare.',
    },
    delivered: {
      id: 'delivered',
      text: 'All assigned sections have been inspected. Return to the site office and land safely.',
    },
    landing: { id: 'landing', text: 'Office pad is below you. Bring it down gently.' },
    complete: {
      id: 'complete',
      text: 'Inspection report filed. The crew can start on time in the morning.',
    },
  },

  ranks: [
    {
      stars: 3,
      text: `All three zones and home, no collisions, inside ${PAR / 60}:00`,
      test: (r) => r.delivered && r.landed && r.collisions === 0 && r.timeSec <= PAR,
    },
    {
      stars: 2,
      text: 'All three zones and home, one collision at most',
      test: (r) => r.delivered && r.landed && r.collisions <= 1,
    },
    {
      stars: 1,
      text: 'Inspect all three zones and land at the site office',
      test: (r) => r.delivered && r.landed,
    },
  ],
};

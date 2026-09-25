import { constructionSite } from '../plugins/environments/constructionSite';
import { levelY, SLAB_T, STOREY } from '../scene/environment/siteLayout';
import { SITE_STORE_PAD_AT } from './siteStore';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// Mission 7 — Construction Material Delivery (the Construction Site).
//
// Collect a cement bag from the site's material store, carry it INTO the frame
// and set it down on an unfinished upper floor, come home and land. The other
// deliveries put their load on a street or a roof, both open to the sky; this one goes onto a
// floor with a slab over it, which is the whole of what is new — the pilot has
// to arrive at the right HEIGHT as well as the right place, and then hold a
// hover with concrete a metre and a half above the rotors.
//
// Positions are measured against the environment's own layout
// (`siteLayout.ts`), not chosen by eye:
//
//   - The drop is the middle of the bay x 6..12, z 6..12 on Level 4: 4.2 m from
//     each of its four columns, with 3.35 m of clear height over the slab.
//   - Level 4 has infill only on its west face (see `INFILL`), so the south face
//     the pilot arrives from is open frame. Levels 0-3 have walls on that face.
//   - Nothing from the scanned debris lies within 4 m of the pickup, the drop or
//     the pad — measured by re-running the env's seeded layout.
//
// `tests/mission-construction-site.test.ts` holds all three to account.
// ----------------------------------------------------------------------------

/** The floor the material goes to. */
const DROP_LEVEL = 4;

/** The launch area: the map's own spawn pad. Read, not copied. */
const LAUNCH: readonly [number, number] = [
  constructionSite.spawn.position[0],
  constructionSite.spawn.position[2],
];

const PAR = 180;

export const materialDelivery: Mission = {
  id: 'construction-material-delivery',
  order: 7,
  name: 'Construction Material Delivery',
  subtitle: 'Lift material onto an unfinished upper floor',
  kind: 'delivery',
  envId: 'construction-site',
  icon: '🏗️',
  cargo: 'cement',
  compactBrief: true,
  blurb:
    'Collect a cement bag from the site material store, fly it into the frame and set it down on Level 4, then land back at the launch area.',
  story:
    'The crew on Level 4 needs cement now, and there is no way up for it: the frame is unclad, the hoist is out and the stairs are full of formwork. A bag is waiting at the site material store. You are the lift.',
  flow: [
    { label: 'Collect', note: 'The bag at the material store', art: 'cement' },
    // Three beats, not four: the delivery hold is the end of the climb, and a
    // fourth card for it made the briefing taller for no new information.
    { label: 'Climb', note: 'Up to Level 4, set the bag down', art: 'frame' },
    { label: 'Come home', note: 'Land back at the launch pad', art: 'land' },
  ],
  objectives: [
    'Fly to the site material store and collect the cement bag from its pad.',
    'Climb to Level 4 and fly in through the open side of the frame.',
    'Hold steady over the yellow mark until the cement bag is released.',
    'Return to the launch area and land on the pad.',
  ],
  rules: [
    'The delivery counts on Level 4 only. Any other floor under the mark is the wrong floor.',
    'There is a slab above you as well as below. Touching either counts as a collision.',
  ],
  mapNote: 'Seven-storey open frame, tower crane',
  timeLimitSec: 300,
  parTimeSec: PAR,
  groundY: 0,
  medals: { bronze: 2, silver: 2, gold: 2 },
  routeAltitude: levelY(DROP_LEVEL) + 1,
  route: [],
  // Straight lines on an open site: the store to the south face, then out and
  // down to the pad. Nothing stands between any of them.
  homeVia: [[9, 20]],
  resultRows: [
    'Package collected',
    'Correct floor reached',
    'Package delivered',
    'Returned to base',
    'Safe landing',
  ],
  wording: {
    attached: 'PACKAGE ATTACHED ✓',
    reached: 'DELIVERY ZONE REACHED',
    delivered: 'PACKAGE DELIVERED ✓',
    onBoard: 'Attached',
  },
  crashLine:
    'The aircraft is wrecked and the cement bag went down with it. A column is solid from slab to slab: come into the floor slowly, through the middle of a bay.',
  timeoutLine:
    'The crew is still waiting. Climb to Level 4 on the way over rather than after, and fly straight in through the open side.',

  zones: {
    // The pad in front of the site material store — see `siteStore.ts`. The
    // same collection test the city deliveries settled on: come down beside
    // the bag, stop, hold.
    pickup: {
      kind: 'pickup',
      at: SITE_STORE_PAD_AT,
      label: 'Site material store',
      radius: 1,
      band: { min: 0, max: 2 },
      maxGroundSpeed: 1.1,
      maxVerticalSpeed: 1,
      hold: 0.8,
    },
    // Level 4, inside the frame. The band is judged from THIS slab, and the
    // storey is what makes arriving on Level 2 under the mark the wrong floor
    // rather than the delivery zone.
    drop: {
      kind: 'drop',
      at: [9, 9],
      label: 'Level 4 delivery bay',
      groundY: levelY(DROP_LEVEL),
      radius: 1.6,
      // Up to 2 m over the slab — the top of that is still 1.35 m under the
      // soffit above, a rotor's width and more of headroom.
      band: { min: 0.3, max: 2 },
      maxGroundSpeed: 0.9,
      maxVerticalSpeed: 0.8,
      hold: 1,
      storey: { level: DROP_LEVEL, height: STOREY, clear: STOREY - SLAB_T },
    },
    base: {
      kind: 'base',
      at: LAUNCH,
      label: 'Launch pad',
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
      text: 'The crew needs cement on Level 4. The bag is waiting on the pad at the site material store. Get over it, come down and hold steady.',
    },
    pickup: {
      id: 'pickup',
      text: 'Cement bag on board. It goes to Level 4, the yellow mark inside the frame. Mind the slab over your head.',
    },
    delivered: { id: 'delivered', text: 'Material delivery confirmed.' },
    home: { id: 'home', text: 'Return to the launch area.' },
    landing: { id: 'landing', text: 'Launch pad is below you. Bring it down gently.' },
    complete: {
      id: 'complete',
      text: 'Delivery complete. The construction team can continue their work.',
    },
  },

  ranks: [
    {
      stars: 3,
      text: `Delivered and home, no collisions, inside ${PAR / 60}:00`,
      test: (r) => r.delivered && r.landed && r.collisions === 0 && r.timeSec <= PAR,
    },
    {
      stars: 2,
      text: 'Delivered and home, one collision at most',
      test: (r) => r.delivered && r.landed && r.collisions <= 1,
    },
    {
      stars: 1,
      text: 'Deliver the cement bag and land back at the launch area',
      test: (r) => r.delivered && r.landed,
    },
  ],
};

import { supermarket } from '../plugins/environments/supermarket';
import { YARD_BOXES, supermarketYard } from './supermarketYard';
import { withYardRuns } from './yard';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// Mission 9 — Truck Loading (the Supermarket).
//
// Five stock cartons, one at a time, from the stock pallet INSIDE THE STORE (by
// the self-checkouts, in from the right entrance) out through the door and
// INTO the truck in the car park: its trailer is open along the car-park side,
// and the boxes go onto a pallet on its floor. Then land back at the launch pad.
//
// From the user's brief: boxes stacked one on another in the open yard, picked
// up from there and loaded into the truck; five boxes. It was three numbered
// trucks with a pallet beside each and a picture saying which — the user asked
// for the boxes IN the truck, and all in the one truck. Mission 10 is the same
// yard flown the other way.
//
// It is a MULTI-POINT DELIVERY — the loop Mission 3 flies — with a yard on top:
// one pickup, five runs, one destination. The id is the old Supermarket
// Delivery's, kept because progress, the catalog and the backend all hold the
// mission under it.
// ----------------------------------------------------------------------------

/** The launch area: the map's own spawn pad. Read, not copied. */
const LAUNCH: readonly [number, number] = [
  supermarket.spawn.position[0],
  supermarket.spawn.position[2],
];

/** One point per box and one for the landing: every finished run has them all. */
const POINTS = YARD_BOXES + 1;
const PAR = 420;

const YARD = supermarketYard('load');

const base: Mission = {
  id: 'supermarket-delivery',
  order: 9,
  name: 'Truck Loading',
  subtitle: 'Five boxes out of the store and into the truck',
  kind: 'delivery',
  envId: 'supermarket',
  icon: '🚚',
  cargo: 'parcel',
  compactBrief: true,
  blurb:
    'Collect five stock cartons one at a time from the pallet inside the store, fly each out through the right entrance and into the truck in the car park, then land back at the launch pad.',
  story:
    'The evening run is loading. Five cartons are stacked on a pallet inside the store, by the self-checkouts, and the truck is waiting in the car park with its side open. Every box comes out through the right entrance and goes in through that side, onto the pallet on the trailer floor.',
  flow: [
    { label: 'Pick', note: 'Top carton off the stack inside the store', art: 'collect' },
    { label: 'Load', note: 'In through the side, onto the pallet, five times', art: 'deliver' },
    { label: 'Land', note: 'Back at the launch pad', art: 'land' },
  ],
  objectives: [
    'Fly in through the right entrance to the stock pallet by the self-checkouts, and collect the top carton.',
    'Fly back out, over to the truck in the car park, and go in through its open side.',
    'Hold steady over the pallet on the trailer floor to set the box down.',
    'Load all five boxes, then land back at the launch pad.',
  ],
  rules: [
    'The doorway is 1.5 m wide and 2.4 m tall, and a checkout stands in the line to the pallet: go through at about 2 m.',
    'Inside the trailer the roof is 2.8 m over the floor. Go in level and slow, and keep low.',
    'The trucks stand 4.5 m tall. Cross the yard above them or round them.',
  ],
  mapNote: 'The store floor, the car park and the open-sided truck',
  // About 350 m of flying, ten doorways and ten holds over pallets, five of
  // them inside the trailer, plus the landing. Twelve minutes is comfortable,
  // seven is brisk: judgement, not measured.
  timeLimitSec: 720,
  parTimeSec: PAR,
  groundY: 0,
  medals: { bronze: POINTS, silver: POINTS, gold: POINTS },
  routeAltitude: 5,
  route: [],
  // Ten descents onto pallets — see `multiPointDelivery.throttleScale`.
  throttleScale: 1.6,
  homeVia: [],
  yard: YARD,
  resultRows: ['All 5 boxes loaded in the truck', 'Returned to base', 'Safe landing'],
  crashLine:
    'The aircraft is wrecked, and the carton with it. Go into the trailer level and slow, and come down onto the pallets gently.',
  timeoutLine:
    'The truck left before it was loaded. Fly straight from the right entrance to the open side of the truck, and back.',

  zones: {
    // The store's pallet, and the pallet inside the truck — the same objects
    // `withYardRuns` puts on every run.
    pickup: YARD.warehouse,
    drop: YARD.truck.bay,
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

  // The lines that count the boxes are written by `withYardRuns`.
  radio: {
    near: {
      id: 'near',
      text: 'The truck is open along its side. Line up with the opening, go in level, and keep under the roof.',
    },
    approach: { id: 'approach', text: 'Centre over the pallet inside and hold it steady.' },
    home: {
      id: 'home',
      text: 'All five boxes are loaded. Return to the launch pad and land.',
    },
    landing: { id: 'landing', text: 'Launch pad is below you. Bring it down gently.' },
    complete: { id: 'complete', text: 'Truck loaded, all five boxes inside. Good work.' },
  },

  ranks: [
    {
      stars: 3,
      text: `All 5 loaded and home, no collisions, inside ${PAR / 60}:00`,
      test: (r) => r.delivered && r.landed && r.collisions === 0 && r.timeSec <= PAR,
    },
    {
      stars: 2,
      text: 'All 5 loaded and home, one collision at most',
      test: (r) => r.delivered && r.landed && r.collisions <= 1,
    },
    {
      stars: 1,
      text: 'Load all five boxes and land at the launch pad',
      test: (r) => r.delivered && r.landed,
    },
  ],
};

export const supermarketDelivery: Mission = withYardRuns(base);

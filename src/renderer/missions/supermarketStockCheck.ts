import { supermarket } from '../plugins/environments/supermarket';
import { YARD_BOXES, supermarketYard } from './supermarketYard';
import { withYardRuns } from './yard';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// Mission 10 — Truck Unloading (the Supermarket).
//
// Mission 9 flown the other way. Five stock cartons have come in on the truck
// in the car park, stacked on a pallet inside its open-sided trailer. Fly in,
// collect each one and carry it into the store through the right entrance, to
// the stock pallet by the self-checkouts, then land.
//
// From the user's brief: "mission 10 unloads the boxes from the truck into our
// warehouse", and, later, "truck ke andar se hi pick karna" — from inside the
// truck. Five boxes, the same as Mission 9.
//
// A multi-point delivery whose PICKUP is not the mission's hub — each box
// comes off the pallet in the truck (`MissionDelivery.pickup`) — and whose
// drop is the one stock pallet in the store. The id is the old Stock Check's, kept
// because progress, the catalog and the backend all hold the mission under it.
// ----------------------------------------------------------------------------

/** The launch area: the map's own spawn pad. Read, not copied. */
const LAUNCH: readonly [number, number] = [
  supermarket.spawn.position[0],
  supermarket.spawn.position[2],
];

const POINTS = YARD_BOXES + 1;
const PAR = 420;

const YARD = supermarketYard('unload');

const base: Mission = {
  id: 'supermarket-stock-check',
  order: 10,
  name: 'Truck Unloading',
  subtitle: 'Five boxes out of the truck and into the store',
  kind: 'delivery',
  envId: 'supermarket',
  icon: '📦',
  cargo: 'parcel',
  compactBrief: true,
  blurb:
    'Fly into the open-sided truck, collect five stock cartons one at a time from the pallet inside, carry each into the store through the right entrance and set it down on the stock pallet, then land back at the launch pad.',
  story:
    'The morning truck is in, parked in the car park with its side open and five cartons of stock stacked on the pallet inside. The store needs them on its stock pallet by the self-checkouts, one at a time, in through the right entrance.',
  flow: [
    { label: 'Collect', note: 'From the pallet inside the truck', art: 'collect' },
    { label: 'Unload', note: 'Into the store, onto the pallet, five times', art: 'deliver' },
    { label: 'Land', note: 'Back at the launch pad', art: 'land' },
  ],
  objectives: [
    'Fly to the truck in the car park and go in through its open side.',
    'Hover over the pallet on the trailer floor and collect the top box.',
    'Carry it in through the right entrance to the stock pallet by the self-checkouts, and hold steady to set it down.',
    'Unload all five boxes, then land back at the launch pad.',
  ],
  rules: [
    'The doorway is 1.5 m wide and 2.4 m tall, and a checkout stands in the line to the pallet: go through at about 2 m.',
    'Inside the trailer the roof is 2.8 m over the floor. Go in level and slow, and keep low.',
    'The trucks stand 4.5 m tall. Cross the yard above them or round them.',
  ],
  mapNote: 'The store floor, the car park and the open-sided truck',
  timeLimitSec: 720,
  parTimeSec: PAR,
  groundY: 0,
  medals: { bronze: POINTS, silver: POINTS, gold: POINTS },
  routeAltitude: 5,
  route: [],
  throttleScale: 1.6,
  homeVia: [],
  yard: YARD,
  resultRows: ['All 5 boxes unloaded into the store', 'Returned to base', 'Safe landing'],
  crashLine:
    'The aircraft is wrecked, and the carton with it. Go into the trailer level and slow, and come down onto the pallets gently.',
  timeoutLine:
    'The truck is still full. Fly straight from the open side of the truck to the right entrance, and back.',

  zones: {
    // The pallet inside the truck, and the store's pallet — the same objects
    // `withYardRuns` puts on every run.
    pickup: YARD.truck.bay,
    drop: YARD.warehouse,
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
    near: {
      id: 'near',
      text: 'The stock pallet is past the checkouts, in front of the stacked stock. Slow down on the way in.',
    },
    approach: { id: 'approach', text: 'Centre over the stock pallet and hold it steady.' },
    home: {
      id: 'home',
      text: 'All five boxes are in the store. Fly back out and return to the launch pad.',
    },
    landing: { id: 'landing', text: 'Launch pad is below you. Bring it down gently.' },
    complete: { id: 'complete', text: 'Truck unloaded and the stock is in. Good work.' },
  },

  ranks: [
    {
      stars: 3,
      text: `All 5 unloaded and home, no collisions, inside ${PAR / 60}:00`,
      test: (r) => r.delivered && r.landed && r.collisions === 0 && r.timeSec <= PAR,
    },
    {
      stars: 2,
      text: 'All 5 unloaded and home, one collision at most',
      test: (r) => r.delivered && r.landed && r.collisions <= 1,
    },
    {
      stars: 1,
      text: 'Unload all five boxes and land at the launch pad',
      test: (r) => r.delivered && r.landed,
    },
  ],
};

export const supermarketStockCheck: Mission = withYardRuns(base);

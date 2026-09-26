import {
  PALLET_H,
  STORE_TRUSS_LOW,
  TRUCK_1,
  TRUCK_1_HOLD,
  TRUCK_1_LOAD_AT,
  WAREHOUSE_AT,
} from './supermarketSites';
import type { MissionYard, MissionZone } from './types';

// ----------------------------------------------------------------------------
// The Supermarket's loading yard, as Missions 9 and 10 fly it.
//
// One yard, two directions: Mission 9 carries boxes from the stock pallet
// INSIDE THE STORE, out through the right entrance and INTO Truck 1; Mission
// 10 carries them back. What changes between the two is which end of each trip
// is the collection, so each pallet is built here once in either role.
// Positions are measured — see `supermarketSites.ts`.
// ----------------------------------------------------------------------------

/** How many boxes each mission moves. */
export const YARD_BOXES = 5;

/**
 * A pallet's mark, as a collection or as a put-down.
 *
 * Both are measured from the PALLET's top, not the ground under it, because
 * that is where a box stands and where a set-down box has to come to rest. The
 * ring is lowered by the pallet's height so it is painted on the floor round
 * the pallet — the tarmac, or the trailer's floor — rather than hanging in the
 * air at pallet height.
 *
 * The collection is Multi-Point Delivery's: a loose hover over the stack,
 * centred and slowed, latched in under a second — the pilot does it five times.
 * The put-down asks for the aircraft to stay half a metre over the pallet,
 * clear of the boxes already on it, and to hold still for a second.
 *
 * `floor` is what the pallet stands on, and `ceiling` caps the band: inside the
 * trailer the roof is 2.9 m over the pallet, and a band that let the aircraft
 * climb into it would be asking for a collision.
 */
function pallet(
  kind: 'pickup' | 'drop',
  at: readonly [number, number],
  label: string,
  floor = 0,
  ceiling = Infinity,
): MissionZone {
  const deck = floor + PALLET_H;
  const top = (max: number) => Math.min(max, ceiling - deck);
  const base = { kind, at, label, groundY: deck, ringLift: 0.03 - PALLET_H };
  return kind === 'pickup'
    ? {
        ...base,
        radius: 1,
        band: { min: 0, max: top(2) },
        maxGroundSpeed: 1.1,
        maxVerticalSpeed: 1,
        hold: 0.8,
      }
    : {
        ...base,
        radius: 1.2,
        band: { min: 0.5, max: top(2.2) },
        maxGroundSpeed: 0.9,
        maxVerticalSpeed: 0.8,
        hold: 1,
      };
}

/**
 * The drone's clearance under the trailer roof, metres: the top of the band
 * stays this far below it. The airframe is a hand high and its propellers stir
 * the air a little higher.
 */
const HEADROOM = 0.8;

/**
 * The yard, with the warehouse and the truck in the roles `mode` gives them.
 *
 * The truck is Truck 1, the one in the car park: its trailer is open along the
 * car-park side, so its pallet stands INSIDE, on the trailer floor, and the
 * drone flies in through the side to reach it.
 */
export function supermarketYard(mode: 'load' | 'unload'): MissionYard {
  return {
    mode,
    boxes: YARD_BOXES,
    truck: {
      body: TRUCK_1,
      hold: TRUCK_1_HOLD,
      bay: pallet(
        mode === 'load' ? 'drop' : 'pickup',
        TRUCK_1_LOAD_AT,
        'Truck',
        TRUCK_1_HOLD.min[1],
        TRUCK_1_HOLD.max[1] - HEADROOM,
      ),
    },
    // On the store floor, under a 6 m roof with trusses lower: capped as the
    // truck's is, by the lowest truss rather than the roof.
    warehouse: pallet(
      mode === 'load' ? 'pickup' : 'drop',
      WAREHOUSE_AT,
      'Store stock pallet',
      0,
      STORE_TRUSS_LOW - HEADROOM,
    ),
  };
}

/**
 * The rest of the truck's load, on both missions: blocks of stacked cartons
 * filling the trailer either side of the pallet the pilot works at.
 *
 * The user's asks: on Mission 10 "pura truck bhar do, lekin pura unloading
 * nahi karna" — the truck arrives full, and the job is still the five boxes on
 * the pallet — and then the same on Mission 9: the truck is already part
 * loaded, with the pallet's space left for the five boxes the pilot brings.
 * So the cargo is scenery, solid, and stops `BAY_HALF` short of the pallet on
 * each side, the full depth of the trailer, so the way in from the open side
 * is as wide as the bay. The same on both missions, so the truck looks the
 * same whichever way the boxes go. Stacked to `CARGO_HIGH`,
 * which leaves the roof a metre clear over it.
 */
type V3 = [number, number, number];

export function truckCargo(yard: MissionYard): { min: V3; max: V3 }[] {
  const { hold, bay } = yard.truck;
  const floor = hold.min[1];
  const top = Math.min(floor + CARGO_HIGH, hold.max[1] - 1);
  const z0 = hold.min[2] + CARGO_INSET;
  const z1 = hold.max[2] - CARGO_INSET;
  const gap = BAY_HALF;
  return [
    { min: [hold.min[0] + CARGO_INSET, floor, z0], max: [bay.at[0] - gap, top, z1] },
    { min: [bay.at[0] + gap, floor, z0], max: [hold.max[0] - CARGO_INSET, top, z1] },
  ];
}

/** How far the cargo stands off the pallet's centre, each side, metres: the
 *  larger of the two rings (1.2 m, the put-down's) and 0.8 m clear of it. */
const BAY_HALF = 2;
/** How high the cargo is stacked over the trailer floor, metres: six cartons. */
const CARGO_HIGH = 1.8;
/** The gap between the cargo and the trailer's walls and open edge, metres. */
const CARGO_INSET = 0.15;

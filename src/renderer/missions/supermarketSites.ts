// ----------------------------------------------------------------------------
// The Supermarket's measured places: the store's doorways, and the loading
// yard Missions 9 and 10 are flown in.
//
// Plain data, free of three.js, so the missions and the tests read the same
// numbers — the pattern `siteStore.ts` set for the Construction Site.
//
// Every number is measured out of supermarket.opt.glb at SupermarketEnv's 0.1
// scale (ray casts against the same triangles the physics trimesh is built
// from), not placed by eye. `tests/mission-supermarket.test.ts` re-measures
// all of them.
//
//   - The store's front wall runs along z ≈ -3.4, with two entrances. Each is a
//     pair of glass doors standing part-open: the clear gap is 1.5 m wide and
//     2.4 m tall, with a fixed glass panel above it up to the 3.21 m frame. The
//     Guru spans 0.58 m.
//   - Inside, the roof is at 6.0 m, with trusses and beams hanging as low as
//     4.1 m in places. Every hover band here stays under 2.5 m.
//   - The shelving is 3.11 m tall with ~1.15 m aisles, a raised divider and
//     price signs on top — nothing a drone should be asked to land on or fly
//     down. The floor in front of the aisles is where the open space is, and
//     even there packs of cans stand about: the two marks inside are the two
//     spots with the most room.
//   - The yard east of the store has three box trailers in the same livery:
//     one in the car park with its cab facing west and its rear doors free, and
//     two backed onto the warehouse dock with their rear doors against it. All
//     three stand 4.47 m to the roof, on a floor 1.41 m up.
//   - Truck 1's trailer has NO wall on its car-park side — not in the model, not
//     in the physics. From the car park it is an open container, and that is
//     how the missions load it: in through the side, onto its floor.
// ----------------------------------------------------------------------------

/** Where the store's front wall stands, world z. */
export const STORE_FRONT_Z = -3.4;

/** The roof inside the store, metres. Trusses hang below it in places. */
export const STORE_CEILING = 6.0;
/** The lowest a truss hangs, metres: what an indoor hover band is capped by. */
export const STORE_TRUSS_LOW = 4.1;

/** The clear gap through each entrance's part-open doors, world x. */
export const LEFT_ENTRANCE_X: readonly [number, number] = [-51.75, -50.25];
export const RIGHT_ENTRANCE_X: readonly [number, number] = [-9.75, -8.25];
/** How tall that gap is, metres — the glass panel above it is solid. */
export const ENTRANCE_H = 2.4;

// ---- The loading yard, for Missions 9 and 10 --------------------------------
//
// Measured the same way, off the colliders: only the trucks and the kerbs stand
// on the tarmac out here, and the kerbs are 0.33 m tall.

/** The pallet every box stands on, at the warehouse and in the truck: its top,
 *  metres. A zone over one declares this as its deck. */
export const PALLET_H = 0.14;

/** Truck 1, in the car park: cab west, rear doors east at x = 1.31, free to
 *  the tarmac. Trailer roof 4.47 m, cab 4.51 m. */
export const TRUCK_1 = {
  min: [-18.4, 0, 9.8] as [number, number, number],
  max: [1.31, 4.51, 14.0] as [number, number, number],
};

/**
 * Truck 1's cargo space: the inside of the trailer, world metres.
 *
 * Measured by ray from inside it: the floor at 1.41 m from the front wall (x
 * -12.61) to the rear doors (a closed face at x 1.31, hardware on it lower
 * down), the far wall at z 10.2, and the roof at 4.47 — one face, its underside
 * is its top. The
 * car-park side, z 13.6, is open along the whole length, with no lip at the
 * floor; only at the front corner does the wall's frame come down to 4.25 and
 * up to 1.64. A few floor struts stand 5 cm proud; none under the pallet.
 */
export const TRUCK_1_HOLD = {
  min: [-12.61, 1.41, 10.2] as [number, number, number],
  max: [1.31, 4.47, 13.6] as [number, number, number],
};

/**
 * Truck 1's loading pallet: on the trailer floor, halfway along and across.
 * 1.7 m from the far wall, the roof 2.9 m over the pallet, and the open side
 * 1.7 m away — a drone at hover height meets nothing between the car park and
 * here.
 */
export const TRUCK_1_LOAD_AT: readonly [number, number] = [-5.5, 11.9];

/**
 * The store's stock pallet: INSIDE W MART, on the floor by the self-checkouts,
 * in from the right entrance. The user asked for the warehouse end of the job
 * inside the store rather than on the yard's tarmac, and this is the roomiest
 * spot on the store floor: 3.2 m clear at the floor and at hover height, the
 * roof 6 m over it (the nearest truss 4.6 m, 4 m away), the right entrance
 * 16 m away on a line that is clear from 1.6 m up — a checkout 0.96 m tall
 * crosses it lower down.
 */
export const WAREHOUSE_AT: readonly [number, number] = [-22.25, -13.25];

/**
 * The stacked stock behind the stock pallet, as a box, world metres: two
 * pallets side by side along the aisle end, cartons two high, between the
 * pallet and the display behind it. LoadingYard draws it and makes it solid.
 * Small, because the floor is: the six-pallet pile the yard had would stand in
 * the checkouts.
 */
export const STOCK_PILE = {
  min: [-24.28, 0, -15.5] as [number, number, number],
  max: [-21.72, 0.74, -14.5] as [number, number, number],
};

// ----------------------------------------------------------------------------
// The shops the delivery missions collect from, and the drone pickup deck each
// one has out front.
//
//   - Lotus Kitchen, a restaurant: Logistics Drones (mission 4) collects its
//     food box here.
//   - Lake City Pharmacy: Precision Delivery (mission 1) collects its medical
//     package here, and Multi-Point Delivery (mission 3) its three.
//
// Plain data, free of three.js, so the missions, the scene and the tests all
// read the same numbers without pulling in a renderer.
//
// Both spots were swept out of the generated colliders, not placed by eye: a
// building face continuous for the whole 8 m shopfront, nothing else standing in
// the frontage up to 12 m, the deck's column clear to 25 m, and every corner on
// the sidewalk plate (top face y = 0.12).
// ----------------------------------------------------------------------------

export interface StorefrontSite {
  /** World x, z of the centre of the shopfront, on the building face. */
  wall: readonly [number, number];
  /** Unit direction out of the shop, world x, z. */
  out: readonly [number, number];
}

/** The sidewalk's top face, metres. Both shops stand on it. */
export const STOREFRONT_BASE = 0.12;

/** How far the pickup deck's centre stands out from the wall, metres. Clear of
 *  the awning by more than a rotor's reach, so a drone centred on the ring can
 *  never touch it. */
export const PICKUP_DECK_OUT = 3.6;

/** Side of the square deck, metres. The 1 m pickup ring sits inside it with
 *  0.3 m of deck to spare all round. */
export const PICKUP_DECK_SIZE = 2.6;

/** Height of the deck above the sidewalk, metres. */
export const PICKUP_DECK_HEIGHT = 0.9;

/** The deck's top face, world metres — a pickup zone's ground. */
export const PICKUP_DECK_TOP = STOREFRONT_BASE + PICKUP_DECK_HEIGHT;

/** Yaw of a storefront group, so its local +z points out of the shop. */
export function storefrontYaw(site: StorefrontSite): number {
  return Math.atan2(site.out[0], site.out[1]);
}

/** World x, z of a shop's deck centre, where the cargo sits. */
export function deckAtOf(site: StorefrontSite): readonly [number, number] {
  return [site.wall[0] + site.out[0] * PICKUP_DECK_OUT, site.wall[1] + site.out[1] * PICKUP_DECK_OUT];
}

/**
 * Lotus Kitchen, on the west face of the block at x = -16.
 *
 * The face is continuous from z = 44 to 69 and 39.7 m tall; nothing else stands
 * in x -21.3..-16, z 45.5..54.5 up to 12 m. 29.5 m from the base pad, 30 m from
 * the spawn.
 */
export const LOTUS_KITCHEN: StorefrontSite = { wall: [-16, 50], out: [-1, 0] };

/**
 * Lake City Pharmacy, on the south face of the block at z = 43.06.
 *
 * The face is continuous across x -15.5..-5.5 and 39.5 m tall. The one thing in
 * the frontage is a street lamp at x -13, z 37.6, about 3.1 m from the deck's
 * centre — past the 1.7 m a rotor can reach from a drone inside the ring. 26.8 m
 * from the helipad the drone launches from and lands on.
 */
export const LAKE_CITY_PHARMACY: StorefrontSite = { wall: [-10.5, 43.06], out: [0, -1] };

/** Where Logistics Drones' food box sits. */
export const PICKUP_DECK_AT = deckAtOf(LOTUS_KITCHEN);

/** Where Multi-Point Delivery's three packages wait. */
export const PHARMACY_DECK_AT = deckAtOf(LAKE_CITY_PHARMACY);

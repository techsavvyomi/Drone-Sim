// ----------------------------------------------------------------------------
// The Construction Site's material store: where Mission 7 collects its cement
// bag.
//
// Plain data, free of three.js, so the mission, the scene and the tests read
// the same numbers — the pattern `pickupStorefront.ts` set for the city shops.
//
// A standalone store rather than a `Storefront`: those are shopfronts fixed to
// a city block's face, and on the site there is no building at the pickup to
// fix one to. This is a container store on the hardstanding, west of the frame,
// facing the launch pad so the pilot sees its front on the way over.
//
// Placed against the site's measured layout: clear of the frame (x < -18), 2 m
// clear of the beam stack at x -34, and nothing from the seeded debris inside
// its footprint or on the pad.
// ----------------------------------------------------------------------------

/** Centre of the store's footprint, world x, z. */
export const SITE_STORE_AT: readonly [number, number] = [-29, 16.6];

/** The store's box: width along its front, height, depth. Metres. */
export const SITE_STORE_SIZE: readonly [number, number, number] = [6, 2.8, 2.8];

/** How far in front of the store's face the pickup pad's centre is, metres. */
export const SITE_STORE_PAD_OUT = 4;

/** The store faces +z, toward the launch pad. */
export const SITE_STORE_FRONT_Z = SITE_STORE_AT[1] + SITE_STORE_SIZE[2] / 2;

/** Where the cement bag waits: on the pad in front of the store. */
export const SITE_STORE_PAD_AT: readonly [number, number] = [
  SITE_STORE_AT[0],
  SITE_STORE_FRONT_Z + SITE_STORE_PAD_OUT,
];

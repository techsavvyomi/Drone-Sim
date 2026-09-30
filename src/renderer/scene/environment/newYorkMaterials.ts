// Which of the New York model's materials get which treatment, by name. Pure,
// so a test can hold the patterns to the model's real material list.

/** The city's tree canopies (`FoliageTrees.001`, `.002`). Not /tree/: that matches "Street". */
export const FOLIAGE = /foliage|leaf|leaves/i;

/**
 * Road paint: the lane lines (`CityGen_lanes_secondary_color`) and the crossings
 * and kerb markings (`Street_Assets.001`) — flat, a millimetre or so over the
 * surface they are painted on. Not `Street_Assets` itself: that is the 3D street
 * furniture (poles, benches), which stands clear of the ground.
 */
export const ROAD_MARKINGS = /lanes|Street_Assets\.001/i;

/** Polygon offset for road paint, toward the camera. The stain decals use −1 / −1
 *  and are drawn after the opaque pass with no depth write; the paint writes
 *  depth, so it takes a few units more to win cleanly at a grazing angle from
 *  height. Chosen by judgement, then checked over the city at 22 m. */
export const ROAD_MARKING_OFFSET = { factor: -2, units: -4 } as const;

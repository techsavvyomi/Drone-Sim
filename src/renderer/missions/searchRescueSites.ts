// ----------------------------------------------------------------------------
// The four places the casualty can be.
//
// One is chosen at random per attempt and the other three are ordinary city.
// The pilot is not told which — what they are given is a RED ZONE drawn on the
// map around whichever one is live (see `searchZone.ts`), and the search is the
// flight inside that circle.
//
// This file used to carry the clue text as well: four written sentences per
// site about tower heights, street shapes and compass sectors. They are gone.
// A paragraph describing a place is a reading test the pilot has to solve while
// flying; a circle on a map says the same thing in the language a map already
// speaks, and says it as a search AREA rather than as a riddle with one answer.
//
// Positions and clearances were measured against the generated colliders, not
// chosen by eye — see docs/mission-search-rescue.md §3 for the sweep and for why
// these four and not the four highest-scoring ones.
//
// This module is deliberately free of every mission type. It is plain data, so
// it can be read by the mission, by the map and by a test without any of them
// pulling in the runtime.
// ----------------------------------------------------------------------------

export interface SearchSite {
  id: 'a' | 'b' | 'c' | 'd';
  /** Where the casualty is, world metres. */
  at: readonly [number, number];
  /**
   * The roof the pilot SEES, metres. Where the casualty lies, where the mark is
   * drawn, and what every band here is measured from.
   *
   * Read off the GLB rather than off the colliders, and the difference is the
   * whole reason this field exists. The colliders rasterise a building to the
   * tallest thing in each cell, so a roof with a parapet is solid up to the
   * PARAPET — see `deck`. A mark drawn at that height floats a metre or two over
   * the slab, which is exactly what it looked like in flight: a rescue ring
   * hanging in the air above the roof it was supposed to be on.
   */
  roof: number;
  /**
   * The collider deck, metres: the height the aircraft would rest at, which is
   * the parapet rather than the slab.
   *
   * Nothing is drawn at this height. It is here so `check-search-sites.mjs` can
   * assert the thing that actually matters — that the hover band, measured from
   * the visible roof, still starts above the parapet, or the pilot would be
   * asked to hold a position inside the building.
   */
  deck: number;
  /**
   * Height of the TALLEST building within 30 m, metres, measured off the
   * colliders.
   *
   * The tallest rather than the nearest, because that is what a pilot at
   * fifteen metres actually reads: they see a skyline over a street, not a
   * survey of which block is closest.
   *
   * Nothing on the HUD quotes it any more — it is what makes a site a PLACE
   * rather than a coordinate, and it is guarded by
   * `scripts/check-search-sites.mjs`, which re-measures it and fails if a
   * collider regeneration has left a site standing beside nothing.
   */
  landmarkHeight: number;
  /** Metres of clear air all round the hover column, from just above `deck` to
   *  the top of the hover band. The rescue zone's radius has to live inside
   *  this. */
  clearance: number;
}

/**
 * The four sites. Every one of them is a ROOFTOP, and every one is FAR.
 *
 * The food box is collected at Lotus Kitchen, [-19.6, 50], and the nearest of
 * these is 110 m from it: 162, 127, 126 and 110 m. The four they replaced sat at
 * 67, 67, 101 and 117 m, and a pilot flying out of the restaurant was finding the
 * nearest two almost as soon as they were airborne.
 *
 * No pair is within 50 m of another. What has to stay true is that one red zone
 * can never hold two sites, and the zone is 44 m across — a circle centred at
 * most 12.1 m from its own site reaches 34.1 m, which leaves 15.9 m of daylight
 * before the nearest other.
 *
 * Distance cost the mission a higher ceiling. Under 60 m this city has eight
 * reachable flat roofs and they are all one eastern cluster — there is no set of
 * four 50 m apart that is also far from the restaurant. At 80 m there are thirty,
 * across the south and east edges of the city, so the mission raises its ceiling
 * to 80 for its own length (`Mission.ceiling`). The aircraft itself is unchanged.
 *
 * All four were swept out of the GLB and the colliders together, never chosen by
 * eye: the VISIBLE roof flat to within 0.6 m at 16 bearings out to 4.5 m — wider
 * than the rescue ring, so no part of the mark hangs off the edge — the hover band
 * starting above the parapet and ending 3 m under the ceiling, at least 5 m of
 * clear column above the parapet, inside the room the red zone needs on the map,
 * and the set of four whose NEAREST is furthest from the pickup.
 */
export const SEARCH_SITES: readonly SearchSite[] = [
  {
    id: 'a',
    at: [93, -66],
    roof: 63.55,
    deck: 65.84,
    landmarkHeight: 67.3,
    clearance: 8.06,
  },
  {
    id: 'b',
    at: [12, -73],
    roof: 66.12,
    deck: 67.84,
    landmarkHeight: 93.8,
    clearance: 16,
  },
  {
    id: 'c',
    at: [93, -6],
    roof: 48.11,
    deck: 49.84,
    landmarkHeight: 60.5,
    clearance: 7.62,
  },
  {
    id: 'd',
    at: [90, 57],
    roof: 48.12,
    deck: 50.72,
    landmarkHeight: 58.1,
    clearance: 5,
  },
] as const;

/** One site at random. The runtime calls this once per attempt. */
export function pickSearchSite(rand: () => number = Math.random): SearchSite {
  return SEARCH_SITES[Math.floor(rand() * SEARCH_SITES.length)] ?? SEARCH_SITES[0];
}

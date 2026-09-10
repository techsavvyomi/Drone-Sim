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
 * The four sites. Every one of them is a ROOFTOP.
 *
 * Each is at least 45 m from the base pad at [0, 29] — the pad stays on the
 * street, so every attempt starts with a climb — and no pair is within 50 m of
 * another.
 *
 * FIFTY, where the street sites needed seventy. The old rule was "one hover can
 * never see two of them", which a rooftop makes meaningless: from 45 m up the
 * pilot can see most of the city. What has to stay true is that one red zone can
 * never hold two sites, and the zone is 44 m across — a circle centred at most
 * 12.1 m from its own site reaches 34.1 m, which leaves 15.9 m of daylight
 * before the nearest other. Only the live site carries a beacon in any case, so
 * the other three are indistinguishable from the rest of the skyline.
 *
 * Rooftops cost the mission its own ceiling. The Guru's `maxAltitude` is 30 m
 * and this city's roofs start at 45, so on the stock airframe there is exactly
 * ONE reachable roof in the whole city. Four only exist above 60 m, which is why
 * the mission raises the ceiling for its own length (`Mission.ceiling`) and why
 * that is a mission field rather than a change to the aircraft.
 *
 * All four were swept out of the GLB and the colliders together, never chosen by
 * eye: the VISIBLE roof flat to within 0.6 m out to 4.5 m — wider than the
 * rescue ring, so no part of the mark hangs off the edge — clear air through the
 * hover band above, 45 m from base, and the set of four with the widest smallest
 * separation the city allows.
 */
export const SEARCH_SITES: readonly SearchSite[] = [
  {
    id: 'a',
    at: [-44, -12],
    roof: 45.11,
    deck: 45.68,
    landmarkHeight: 72.5,
    clearance: 5.83,
  },
  {
    id: 'b',
    at: [61, -12],
    roof: 45.62,
    deck: 47.34,
    landmarkHeight: 60.5,
    clearance: 10.05,
  },
  {
    id: 'c',
    at: [97, 48],
    roof: 48.12,
    deck: 48.88,
    landmarkHeight: 57.7,
    clearance: 6,
  },
  /* The low one, and the only site that would still be reachable if the mission
   * ever gave the ceiling back. */
  {
    id: 'd',
    at: [47, 48],
    roof: 33.16,
    deck: 34.56,
    landmarkHeight: 58.3,
    clearance: 10.82,
  },
] as const;

/** One site at random. The runtime calls this once per attempt. */
export function pickSearchSite(rand: () => number = Math.random): SearchSite {
  return SEARCH_SITES[Math.floor(rand() * SEARCH_SITES.length)] ?? SEARCH_SITES[0];
}

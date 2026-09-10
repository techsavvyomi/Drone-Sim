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
  /** Where the casualty is, world metres, on the street. */
  at: readonly [number, number];
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
  /** Metres of clear air all round the hover column, 1 m to 22 m. The rescue
   *  zone's radius has to live inside this. */
  clearance: number;
}

/**
 * The four sites, spread one to a quarter of the map.
 *
 * No pair is within 70 m of another, so one hover can never see two of them,
 * and each is at least 45 m from the base pad at [0, 29]. All four are at
 * STREET level: the Guru tops out at 30 m, this city's reachable roof decks are
 * the same three in the same north-west corner, and separated search locations
 * cannot be made out of them. §3 of the mission doc records that as a
 * constraint of the aircraft rather than a design choice.
 *
 * The west site moved out from [-61, 32] when the south one was added: at the
 * old position the two were 60 m apart, close enough down an open street for
 * one hover to take in both, which would have made two red zones one search.
 */
export const SEARCH_SITES: readonly SearchSite[] = [
  {
    id: 'a',
    at: [-31, -86],
    landmarkHeight: 99.5,
    clearance: 6.83,
  },
  {
    id: 'b',
    at: [29, -30],
    landmarkHeight: 84.9,
    clearance: 8.49,
  },
  {
    id: 'c',
    at: [-84, 32],
    landmarkHeight: 93.8,
    clearance: 5.7,
  },
  {
    id: 'd',
    at: [-32, 85],
    landmarkHeight: 91.1,
    clearance: 7.38,
  },
] as const;

/** One site at random. The runtime calls this once per attempt. */
export function pickSearchSite(rand: () => number = Math.random): SearchSite {
  return SEARCH_SITES[Math.floor(rand() * SEARCH_SITES.length)] ?? SEARCH_SITES[0];
}

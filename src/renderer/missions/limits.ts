// ----------------------------------------------------------------------------
// Every mission's clock, in one table.
//
// The time limit is the whole attempt — run past it and the mission fails. The
// par is the time the three-star rung asks for. Each mission file reads its two
// numbers from here rather than writing them itself, so the list row, the
// briefing, the rubric, the HUD clock and the result card all come off one
// figure, and changing a limit is one edit (Phase 5, "one data file").
//
// Seconds. Keyed by mission id.
// ----------------------------------------------------------------------------

export interface MissionLimit {
  /** Seconds before the attempt times out. */
  limitSec: number;
  /** Seconds the three-star rung has to be finished inside. */
  parSec: number;
}

export const LIMITS = {
  'precision-delivery': { limitSec: 480, parSec: 300 },
  'forest-fire': { limitSec: 420, parSec: 270 },
  'multi-point-delivery': { limitSec: 660, parSec: 420 },
  'search-rescue': { limitSec: 480, parSec: 240 },
  'tiger-tracker': { limitSec: 180, parSec: 150 },
  'night-tracking': { limitSec: 180, parSec: 150 },
  'construction-material-delivery': { limitSec: 300, parSec: 180 },
  'night-shift-inspection': { limitSec: 420, parSec: 240 },
  'supermarket-delivery': { limitSec: 720, parSec: 420 },
  'supermarket-stock-check': { limitSec: 720, parSec: 420 },
} as const satisfies Record<string, MissionLimit>;

export type MissionLimitId = keyof typeof LIMITS;

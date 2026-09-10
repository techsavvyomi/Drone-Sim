import { NYC_PLAN_BOUNDS } from '../scene/environment/NewYorkPlan';

// ----------------------------------------------------------------------------
// The red zone — where the search happens.
//
// This replaces four written clues, and the reason is worth writing down. The
// clues were prose: a pilot had to read three sentences about towers, canyons
// and compass points, hold them in their head, and translate them into a part
// of a city they were simultaneously trying to fly through. That is a reading
// comprehension test wearing a flight simulator, and the part of it that was
// actually doing the work — "the north of the map" — was one line out of four.
//
// A circle on the map says that one line instantly, in the only language a map
// speaks, and says it more honestly: it is a SEARCH AREA, not a description
// that happens to be satisfiable in one place. The pilot flies to the circle
// and then searches inside it, which is what a real search looks like and what
// the mission was always trying to be.
//
// The casualty is never at the centre. A circle centred on the answer is a
// marker with a wide border — the pilot would fly to the middle of it and be
// done, having searched nothing.
// ----------------------------------------------------------------------------

/** A red zone: where it is and how big, world metres. */
export interface SearchZone {
  at: readonly [number, number];
  radius: number;
}

/**
 * How far the zone's centre may sit from the casualty, as a fraction of the
 * radius.
 *
 * Far enough that the middle of the circle is not the answer, and short enough
 * that the casualty is never near the rim — a casualty at 0.95 of the radius is
 * one the pilot finds by flying the boundary, which is the one search pattern
 * that beats searching properly. At 0.55 the whole of the circle is worth
 * flying and none of it is more worth flying than the rest.
 */
const OFFSET_FRACTION = 0.55;

/**
 * A red zone around a site, placed so the casualty is somewhere inside it but
 * never in the middle.
 *
 * `rand` is injected so the placement is testable — the whole point of the zone
 * is a property about where the casualty falls inside it, and a property you
 * cannot sample is one you cannot check.
 */
export function zoneFor(
  at: readonly [number, number],
  radius: number,
  rand: () => number = Math.random,
): SearchZone {
  // Uniform over the DISC, not over (angle, distance) — the naive version piles
  // centres up near the casualty, which quietly undoes the offset for half the
  // attempts.
  const angle = rand() * Math.PI * 2;
  const reach = Math.sqrt(rand()) * radius * OFFSET_FRACTION;
  const cx = at[0] + Math.cos(angle) * reach;
  const cz = at[1] + Math.sin(angle) * reach;
  /*
   * Two clamps, and the order matters.
   *
   * The first keeps the circle over the city, allowing it to overhang the
   * building footprint by the offset — a zone hanging out over empty ground
   * invites the pilot to search nothing. Two of the four sites sit a few metres
   * outside the building bounds, on the streets that ring the city, so some
   * overhang is not avoidable, and pretending otherwise is what would push a
   * circle off its own casualty.
   *
   * The second is the guarantee: whatever the first did, the centre ends up
   * within the offset of the site. A pilot who searches the circle completely
   * must find somebody, and that is not a property to leave to the arithmetic
   * of the first clamp working out.
   */
  const b = NYC_PLAN_BOUNDS;
  const keep = radius - radius * OFFSET_FRACTION;
  const onMap: [number, number] = [
    clamp(cx, b.minX + keep, b.maxX - keep),
    clamp(cz, b.minZ + keep, b.maxZ - keep),
  ];
  const span = radius * OFFSET_FRACTION;
  return {
    at: [clamp(onMap[0], at[0] - span, at[0] + span), clamp(onMap[1], at[1] - span, at[1] + span)],
    radius,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  // A radius wider than the map would invert the bounds; the midpoint is the
  // only honest answer then, and it is better than a NaN on the HUD.
  if (lo > hi) return (lo + hi) / 2;
  return Math.min(Math.max(v, lo), hi);
}

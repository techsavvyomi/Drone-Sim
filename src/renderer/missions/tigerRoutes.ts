// ----------------------------------------------------------------------------
// Where the tiger walks, on Mission 5 — Nightfall Predator Tracking.
//
// Two routes, one drawn per attempt. That is the whole of what makes this
// mission unmemorisable: a pilot who flew it once and learned "the tiger is in
// the gorge" finds the ridge road the next time, and the two lie on opposite
// sides of the clearing, so the wrong guess costs a crossing rather than a
// glance.
//
// EVERY NUMBER HERE IS MEASURED, not drawn by eye. The forest has no single
// ground height — the clearing is at zero and the terrain falls sixty metres
// away from it — and a trunk is solid all the way to its own treetop
// (docs/forest-map.md §2), so a node placed off the render is routinely inside
// a tree the pilot can fly into and the tiger cannot stand in. The ground
// heights and the clearances below came off the GLB and the generated trunk
// boxes:
//
//     node scripts/check-tiger-routes.mjs
//
// Re-run it after regenerating the trunk colliders, not only after editing this
// file: a route that was clear against the old boxes is not automatically clear
// against the new ones.
// ----------------------------------------------------------------------------

/** One node of a patrol: where the tiger stands, and the ground it stands on. */
export interface TigerNode {
  /** World metres, after ForestEnv's clearing offset. */
  at: readonly [number, number];
  /** Measured terrain height at `at`. The tiger is drawn standing on this, and
   *  the drone's height over the target is measured from it. */
  ground: number;
}

export interface TigerRoute {
  /** Short id, for the run-specific radio keys and the tests. */
  id: string;
  /** What Mission Control calls the place, once the pilot has found it. Never
   *  said before: naming the gorge in the briefing would name the answer. */
  label: string;
  /** The patrol, walked nose to tail and then back again. Not a loop — a tiger
   *  that walked a circle would pass the same point on the same heading every
   *  time, which is a carousel, not an animal. */
  path: readonly TigerNode[];
}

/**
 * THE GORGE — the ravine the dirt road drops into, south-west of the clearing.
 *
 * Ground falls from −26.6 to −30.5 m across the patrol, so the tiger is walking
 * a floor twenty-seven metres BELOW the pad the drone launched from. A pilot who
 * searches at launch height sees the canopy and nothing else; finding this one
 * means descending into the cut, which is the flying the mission is for.
 *
 * Measured clearance around the walk is 10.1 to 15.2 m at every node from two
 * metres off the deck up to twelve, so the Guru can hold a lit hover anywhere
 * along it. The two nodes that continue the ravine east — (18, −66) and
 * (24, −72) — were dropped at 5.8 and 6.2 m: flyable, but not with a light cone
 * to place as well.
 */
const GORGE: TigerRoute = {
  id: 'gorge',
  label: 'the gorge',
  path: [
    { at: [-18, -80], ground: -30.47 },
    { at: [-12, -74], ground: -28.73 },
    { at: [-6, -68], ground: -27.79 },
    { at: [0, -64], ground: -27.2 },
    { at: [6, -62], ground: -26.91 },
    { at: [12, -62], ground: -26.63 },
  ],
};

/**
 * THE RIDGE ROAD — the unpaved road running east out of the clearing, along the
 * shoulder before it turns south.
 *
 * The open one. Ground only drops from −0.5 to −6.6 m across the whole patrol,
 * the road surface is bare, and the trees stand off it — so a tiger on this
 * route is genuinely visible from above, and the mission is then about holding
 * the light on something that keeps walking rather than about finding it at all.
 *
 * Clearance is 8.8 m at the western end and never below 6.1, with ONE pinch at
 * (72, −14), where the nearest trunk is 4.7 m. It is kept as a node rather than
 * smoothed away so the check script measures it every time: it is the tightest
 * place on either route and the first thing a collider regeneration would move.
 */
const RIDGE_ROAD: TigerRoute = {
  id: 'ridge-road',
  label: 'the ridge road',
  path: [
    { at: [48, -10], ground: -0.47 },
    { at: [54, -12], ground: -0.98 },
    { at: [60, -10], ground: -1.69 },
    { at: [66, -12], ground: -2.59 },
    { at: [72, -14], ground: -3.74 },
    { at: [78, -14], ground: -4.67 },
    { at: [84, -16], ground: -5.52 },
    { at: [84, -22], ground: -6.63 },
  ],
};

/**
 * The two, in no meaningful order — the attempt draws one at random.
 *
 * They are deliberately a matched pair rather than a hard one and an easy one:
 * both sit 60 to 70 m from the pad, on opposite bearings, and either can be
 * reached and searched inside the time limit. A pilot who guesses wrong has lost
 * a crossing, not the attempt.
 */
export const TIGER_ROUTES: readonly TigerRoute[] = [GORGE, RIDGE_ROAD];

/** Total walked length of a route, metres. What the patrol's loop time is
 *  worked out from, rather than a duration typed beside a path that can change
 *  under it. */
export function routeLength(route: TigerRoute): number {
  let sum = 0;
  for (let i = 1; i < route.path.length; i++) {
    const a = route.path[i - 1].at;
    const b = route.path[i].at;
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

/**
 * THE AMBLE: the two rhythms that turn a constant march into a walk.
 *
 * An animal crossing its own territory does not hold a speed. It walks, slows
 * to almost nothing over something worth smelling, and picks the pace back up —
 * and a tiger that covered its patrol at exactly 0.9 m/s for four hundred and
 * eighty seconds read, in the air, as a model being slid along a rail.
 *
 * Two sine terms rather than one, on periods that are not multiples of each
 * other, so the pattern does not repeat inside an attempt and the pilot cannot
 * learn it. Their amplitudes sum to 0.87, which is the one hard rule here: the
 * pace multiplier stays positive, so the animal never walks backwards.
 *
 * The mean is exactly 1 over a whole number of periods, which is what keeps the
 * mission's arithmetic intact — `speed` is still the speed, the patrol still
 * takes the eighty to a hundred seconds the briefing promises, and nothing that
 * measured the route has to be measured again.
 */
const AMBLE = [
  { period: 23, amp: 0.55, phase: 0 },
  { period: 8.5, amp: 0.32, phase: 1.1 },
] as const;

/**
 * How fast the animal is walking at `t`, as a multiple of its nominal speed.
 *
 * 0.13 at the bottom — a stop in all but name — and 1.87 at the top. Exported
 * because the gait is driven off it: the legs, the head and the tail all read
 * this one number, which is what stops a walk cycle running at a pace the
 * animal is not actually travelling at.
 */
export function amblePace(t: number): number {
  let pace = 1;
  for (const w of AMBLE) pace += w.amp * Math.sin((Math.PI * 2 * t) / w.period + w.phase);
  return pace;
}

/**
 * How far along the patrol the animal has walked by `t`, metres.
 *
 * The integral of `amblePace` in closed form, not a step-by-step accumulation —
 * so it is the same number on a machine holding 60 fps and one holding 20, and
 * the same number after a pause. An animal whose position depended on how many
 * frames had been drawn would be somewhere else on every pilot's screen.
 */
export function ambleDistance(t: number, speed: number): number {
  let along = t;
  for (const w of AMBLE) {
    const k = (Math.PI * 2) / w.period;
    along -= (w.amp / k) * (Math.cos(k * t + w.phase) - Math.cos(w.phase));
  }
  return along * speed;
}

/**
 * Where the tiger is, `t` seconds into the patrol, at `speed` m/s.
 *
 * The constant-speed form, and what the route measurements are expressed in.
 * The runtime walks the animal with `ambleDistance` instead — see `Tiger` —
 * but every guarantee the routes make (this length, this clearance, this many
 * seconds for a there-and-back) is a guarantee about distance along the path,
 * and this is the function that states it.
 */
export function tigerAt(
  route: TigerRoute,
  t: number,
  speed: number,
  out: { x: number; y: number; z: number; heading: number },
): void {
  tigerAtDistance(route, t * speed, out);
}

/**
 * Where the tiger is `along` metres into the patrol.
 *
 * Walks the path nose to tail, turns round, and walks back — so the animal is
 * never teleported to the start, and the pilot who loses it at one end knows
 * which way it went. Allocation-free by contract: it writes into `out` rather
 * than returning a tuple, because it is called from the frame loop.
 */
export function tigerAtDistance(
  route: TigerRoute,
  along: number,
  out: { x: number; y: number; z: number; heading: number },
): void {
  const len = routeLength(route);
  if (len <= 0) {
    const n = route.path[0];
    out.x = n.at[0];
    out.y = n.ground;
    out.z = n.at[1];
    out.heading = 0;
    return;
  }
  // One full there-and-back is two lengths. Fold the second half back on
  // itself rather than taking a modulo of one length, which would snap the
  // tiger from the far end to the near one every lap.
  const lap = along % (len * 2);
  const walked = lap <= len ? lap : len * 2 - lap;
  const forward = lap <= len;

  let travelled = 0;
  for (let i = 1; i < route.path.length; i++) {
    const a = route.path[i - 1];
    const b = route.path[i];
    const dx = b.at[0] - a.at[0];
    const dz = b.at[1] - a.at[1];
    const seg = Math.hypot(dx, dz);
    if (travelled + seg >= walked || i === route.path.length - 1) {
      const f = seg <= 0 ? 0 : Math.min(1, Math.max(0, (walked - travelled) / seg));
      out.x = a.at[0] + dx * f;
      out.z = a.at[1] + dz * f;
      out.y = a.ground + (b.ground - a.ground) * f;
      // Three.js yaw: 0 looks down −Z, and the tiger faces the way it walks.
      out.heading = Math.atan2(forward ? dx : -dx, forward ? -dz : dz);
      return;
    }
    travelled += seg;
  }
}

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

/*
 * THE FOUR FOREST PATROLS.
 *
 * All four are IN THE TREES, off the roads. The first two routes (a gorge and a
 * ridge road) were drawn on open ground because the check demanded a 4.5 m clear
 * column straight above every node, for a drone hovering over the animal — and
 * in this forest a trunk is solid to its own treetop, so the only such columns
 * were the roads. Flown and reported: "on every restart the tiger is on the
 * road". With the beam 60° ahead of the nose and the hold counting only within
 * 9 m, the drone no longer hovers over the tiger, so the rule is now that a
 * hover is REACHABLE within the lock range — and the patrols moved into the
 * woods.
 *
 * Found by searching the map, not drawn by eye: every node is off the road
 * (nearest road 9 m on the east patrol, beyond 20 m on the others), has five
 * or more trunks within 8 m, level footing, room for the animal between the
 * trunks along every stretch, and a clear hover for the drone within 9 m. The
 * numbers are re-checked by `scripts/check-tiger-routes.mjs` (TC-506).
 *
 * Four rather than two, drawn at random per attempt, on four different bearings
 * from the pad — a restart puts the animal somewhere else in the forest.
 */

/** South-west of the pad, in the trees above the gorge. */
const SOUTH_WEST_WOODS: TigerRoute = {
  id: 'south-west-woods',
  label: 'the south-west woods',
  path: [
    { at: [-80, -30], ground: -19.19 },
    { at: [-75, -35], ground: -18.07 },
    { at: [-70, -40], ground: -17.26 },
    { at: [-65, -45], ground: -17.31 },
    { at: [-60, -50], ground: -17.31 },
    { at: [-55, -55], ground: -18.14 },
    { at: [-50, -60], ground: -19.22 },
    { at: [-45, -60], ground: -20.41 },
    { at: [-40, -55], ground: -20.84 },
  ],
};

/** East of the pad, in the dense stand south of the ridge road. */
const EAST_WOODS: TigerRoute = {
  id: 'east-woods',
  label: 'the east woods',
  path: [
    { at: [75, -25], ground: -5.98 },
    { at: [70, -30], ground: -5.25 },
    { at: [65, -30], ground: -4.49 },
    { at: [60, -35], ground: -4.95 },
    { at: [55, -40], ground: -5.63 },
    { at: [50, -45], ground: -6.89 },
    { at: [45, -45], ground: -6.79 },
    { at: [40, -45], ground: -6.72 },
    { at: [35, -45], ground: -6.81 },
  ],
};

/** West of the pad, climbing the slope through the trees. */
const WEST_SLOPE: TigerRoute = {
  id: 'west-slope',
  label: 'the west slope',
  path: [
    { at: [-90, 10], ground: -18.79 },
    { at: [-85, 5], ground: -16.85 },
    { at: [-80, 0], ground: -14.91 },
    { at: [-75, -5], ground: -13.14 },
    { at: [-70, -5], ground: -11.52 },
    { at: [-65, 0], ground: -9.49 },
    { at: [-60, 5], ground: -7.99 },
    { at: [-55, 10], ground: -6.89 },
    { at: [-50, 15], ground: -6.37 },
  ],
};

/** North-east of the pad, deep in the woods. */
const NORTH_EAST_WOODS: TigerRoute = {
  id: 'north-east-woods',
  label: 'the north-east woods',
  path: [
    { at: [75, 55], ground: -15.37 },
    { at: [70, 50], ground: -14.53 },
    { at: [65, 50], ground: -14.88 },
    { at: [60, 45], ground: -13.89 },
    { at: [55, 40], ground: -13.44 },
    { at: [50, 40], ground: -14.0 },
    { at: [45, 40], ground: -13.58 },
    { at: [40, 40], ground: -11.97 },
    { at: [35, 35], ground: -10.92 },
  ],
};

/**
 * The four, drawn at random per attempt. The first two are on opposite sides of
 * the pad (TC-503 holds them over 60 m apart).
 */
export const TIGER_ROUTES: readonly TigerRoute[] = [
  SOUTH_WEST_WOODS,
  EAST_WOODS,
  WEST_SLOPE,
  NORTH_EAST_WOODS,
];

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
      // Three.js yaw: 0 looks down −Z, and yaw θ turns −Z to (−sin θ, −cos θ).
      // To face a walk of (x, z) that is θ = atan2(−x, −z). It was
      // atan2(x, −z) — right along Z, and exactly BACKWARDS along X, sideways
      // on a diagonal: flown as "its legs walk forward and it goes backward".
      const wx = forward ? dx : -dx;
      const wz = forward ? dz : -dz;
      out.heading = Math.atan2(-wx, -wz);
      return;
    }
    travelled += seg;
  }
}

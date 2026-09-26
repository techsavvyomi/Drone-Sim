// ----------------------------------------------------------------------------
// The Supermarket's physics, derived from its own geometry.
//
// Plain arrays in, plain arrays out — no three.js — so SupermarketEnv runs it on
// the loaded model and `tests/mission-supermarket.test.ts` runs the SAME code on
// the GLB and checks the result against the missions' doors and marks.
//
// WHY NOT ONE TRIMESH. It was one: all 96k triangles, queried by the drone's 14
// colliders on every one of 250 steps a second. Most of those triangles are
// small things packed exactly where a mission flies — products on the shelves,
// packs of cans, trolleys, the checkouts — and flying among them made the sim
// visibly lag and the drone catch and stutter (the floor's own triangle seams
// did the same on every touchdown). The same lesson as the Forest's trunks and
// New York's hand-placed boxes; see docs/extending.md, "Physics for a new map".
//
// WHAT IT DOES. The export is split into its connected parts (2,251 of them),
// and each part goes one of three ways:
//
//   - FLAT GROUND  → dropped. One cuboid under the whole map replaces it, so a
//                    touchdown meets a single flat face, not triangle seams.
//   - A SOLID PART → one box, turned about Y to fit (a minimum-area rectangle
//                    over its footprint), because a shelf unit or a checkout at
//                    30° is still a box, just not an axis-aligned one.
//   - ANYTHING ELSE → kept as exact triangles: the building shells, and every
//                    part with a hole in it. A door frame's box would seal the
//                    doorway; a railing's would be a wall.
//
// "Solid" is measured, not named: a part is a box when its surfaces fill most of
// the box around it, or when it is too small for a drone to fly through anyway.
// ----------------------------------------------------------------------------

/** One mesh's triangles, in WORLD metres. */
export interface ColliderSource {
  positions: ArrayLike<number>;
  index: ArrayLike<number>;
}

/** A cuboid turned `yaw` radians about +Y. */
export interface ColliderBox {
  pos: [number, number, number];
  half: [number, number, number];
  yaw: number;
}

export interface SupermarketColliderSet {
  boxes: ColliderBox[];
  /** Triangle soup, world metres, three vertices per triangle. */
  shell: Float32Array;
  /** Triangles of flat ground that the ground cuboid stands in for. */
  groundTris: number;
}

/** A part this flat, at ground level, is ground. */
const GROUND_TOP = 0.06;
const GROUND_THICK = 0.05;
/** Wider than this and a part is a building shell, never a box. */
const SHELL_SPAN = 6;
/** A box face is never thinner than this — a sign is a plane. */
const MIN_HALF = 0.01;
/** Smaller than this in every direction and there is no flying through it. */
const TOO_SMALL = 0.6;
/** Surface area over its box's surface area, above which a part is solid. */
const SOLID_FILL = 0.45;
/** Vertices this close are one vertex, for finding which triangles connect. */
const WELD = 1000; // 1 mm

export function buildSupermarketColliders(sources: readonly ColliderSource[]): SupermarketColliderSet {
  const boxes: ColliderBox[] = [];
  const shell: number[] = [];
  let groundTris = 0;

  for (const { positions: P, index: I } of sources) {
    const nVerts = P.length / 3;
    const nTris = I.length / 3;

    // Weld by position: exports split vertices along UV seams, and a seam must
    // not cut one part in two.
    const byKey = new Map<string, number>();
    const rep = new Int32Array(nVerts);
    for (let i = 0; i < nVerts; i++) {
      const k = `${Math.round(P[i * 3] * WELD)},${Math.round(P[i * 3 + 1] * WELD)},${Math.round(P[i * 3 + 2] * WELD)}`;
      let r = byKey.get(k);
      if (r === undefined) byKey.set(k, (r = i));
      rep[i] = r;
    }

    // Union-find over the welded vertices.
    const parent = new Int32Array(nVerts);
    for (let i = 0; i < nVerts; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    for (let t = 0; t < nTris; t++) {
      const a = find(rep[I[t * 3]]);
      const b = find(rep[I[t * 3 + 1]]);
      const c = find(rep[I[t * 3 + 2]]);
      parent[b] = a;
      parent[find(c)] = a;
    }
    const parts = new Map<number, number[]>();
    for (let t = 0; t < nTris; t++) {
      const r = find(rep[I[t * 3]]);
      let list = parts.get(r);
      if (!list) parts.set(r, (list = []));
      list.push(t);
    }

    for (const tris of parts.values()) {
      let yMin = Infinity;
      let yMax = -Infinity;
      let area = 0;
      const xz: number[] = [];
      for (const t of tris) {
        const a = I[t * 3] * 3;
        const b = I[t * 3 + 1] * 3;
        const c = I[t * 3 + 2] * 3;
        for (const v of [a, b, c]) {
          yMin = Math.min(yMin, P[v + 1]);
          yMax = Math.max(yMax, P[v + 1]);
          xz.push(P[v], P[v + 2]);
        }
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      }

      if (yMax <= GROUND_TOP && yMax - yMin < GROUND_THICK) {
        groundTris += tris.length;
        continue;
      }

      const rect = minAreaRect(xz);
      const hw = Math.max(rect.w / 2, MIN_HALF);
      const hd = Math.max(rect.d / 2, MIN_HALF);
      const hh = Math.max((yMax - yMin) / 2, MIN_HALF);
      const boxArea = 8 * (hw * hd + hw * hh + hd * hh);
      const small = Math.max(hw, hd, hh) * 2 < TOO_SMALL;
      const solid = area / boxArea >= SOLID_FILL;

      if (Math.max(rect.w, rect.d) <= SHELL_SPAN && (small || solid)) {
        boxes.push({ pos: [rect.cx, (yMin + yMax) / 2, rect.cz], half: [hw, hh, hd], yaw: rect.yaw });
        continue;
      }
      for (const t of tris) {
        for (let k = 0; k < 3; k++) {
          const v = I[t * 3 + k] * 3;
          shell.push(P[v], P[v + 1], P[v + 2]);
        }
      }
    }
  }

  return { boxes, shell: new Float32Array(shell), groundTris };
}

/**
 * The smallest rectangle around a set of (x, z) points, by rotating calipers
 * over their convex hull. `yaw` turns the box's local +X onto its `w` side,
 * matching a three.js / Rapier rotation of `yaw` about +Y.
 */
export function minAreaRect(xz: readonly number[]): {
  cx: number;
  cz: number;
  w: number;
  d: number;
  yaw: number;
} {
  const hull = convexHull(xz);
  if (hull.length < 3) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < xz.length; i += 2) {
      x0 = Math.min(x0, xz[i]); x1 = Math.max(x1, xz[i]);
      z0 = Math.min(z0, xz[i + 1]); z1 = Math.max(z1, xz[i + 1]);
    }
    return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, yaw: 0 };
  }
  let best = { area: Infinity, cx: 0, cz: 0, w: 0, d: 0, yaw: 0 };
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i];
    const [bx, bz] = hull[(i + 1) % hull.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-9) continue;
    // The edge's direction is the box's local X; local Z is perpendicular.
    const ex = (bx - ax) / len, ez = (bz - az) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [px, pz] of hull) {
      const u = px * ex + pz * ez;
      const v = -px * ez + pz * ex;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const a = (u1 - u0) * (v1 - v0);
    if (a < best.area) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      best = {
        area: a,
        cx: um * ex - vm * ez,
        cz: um * ez + vm * ex,
        w: u1 - u0,
        d: v1 - v0,
        // Rotating (1,0,0) by yaw about +Y gives (cos, 0, -sin); match (ex, ez).
        yaw: Math.atan2(-ez, ex),
      };
    }
  }
  return best;
}

/** Andrew's monotone chain. */
function convexHull(xz: readonly number[]): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < xz.length; i += 2) pts.push([xz[i], xz[i + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

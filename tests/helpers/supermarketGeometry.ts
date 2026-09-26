import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { supermarket } from '../../src/renderer/plugins/environments/supermarket';
import {
  buildSupermarketColliders,
  type ColliderSource,
  type SupermarketColliderSet,
} from '../../src/renderer/scene/environment/supermarketColliders';

// The Supermarket as the physics sees it, for tests that hold a position or a
// flight path to the map.
//
// It runs the same collider builder SupermarketEnv runs over
// supermarket.opt.glb, and flattens what that produces — the shell triangles,
// every box as its 12, and the ground's top face — into one triangle list a ray
// can be cast against. Loading takes a few seconds, so a test file loads it once
// in `beforeAll`.

const MODEL = 'src/assets/models/supermarket.opt.glb';
/** SupermarketEnv's MODEL_SCALE. */
const SCALE = 0.1;
/** The materials SupermarketEnv gives no collider. */
const NON_SOLID = /^(Start|crosswalk|bost)$/;

export type V3 = [number, number, number];

export interface SupermarketGeometry {
  /** What the collider builder produced, for tests about the builder itself. */
  set: SupermarketColliderSet;
  /** Distance along `d` (unit) to the first solid triangle, or `max`. */
  ray(o: V3, d: V3, max?: number): number;
  /** Nearest solid thing, flat, from a point — swept at three heights. */
  clearance(at: readonly [number, number], y0?: number): number;
  /** Height of the first solid surface under (x, z), looking down from `from`. */
  heightAt(x: number, z: number, from?: number): number;
  /** Height of the first solid surface over (x, z), looking up from `from`. */
  ceilingAt(x: number, z: number, from?: number): number;
}

export async function loadSupermarket(): Promise<SupermarketGeometry> {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
  const doc = await io.read(MODEL);
  const sources: ColliderSource[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (NON_SOLID.test(prim.getMaterial()?.getName() ?? '')) continue;
      const pos = prim.getAttribute('POSITION')!;
      const out = new Float32Array(pos.getCount() * 3);
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        out[i * 3] = (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) * SCALE;
        out[i * 3 + 1] = (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) * SCALE;
        out[i * 3 + 2] = (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) * SCALE;
      }
      sources.push({ positions: out, index: prim.getIndices()!.getArray()! });
    }
  }
  const set = buildSupermarketColliders(sources);

  // What the physics sees, as triangles: the shell as-is, each box as its 12,
  // and the ground cuboid's top face over the whole play area.
  const tris: [V3, V3, V3][] = [];
  for (let i = 0; i < set.shell.length; i += 9) {
    const s = set.shell;
    tris.push([
      [s[i], s[i + 1], s[i + 2]],
      [s[i + 3], s[i + 4], s[i + 5]],
      [s[i + 6], s[i + 7], s[i + 8]],
    ]);
  }
  for (const b of set.boxes) {
    const c = Math.cos(b.yaw);
    const sn = Math.sin(b.yaw);
    // Local (x, y, z) → world, rotated `yaw` about +Y like the Rapier cuboid.
    const w = (x: number, y: number, z: number): V3 => [
      b.pos[0] + x * c + z * sn,
      b.pos[1] + y,
      b.pos[2] - x * sn + z * c,
    ];
    const [hx, hy, hz] = b.half;
    const k = [
      w(-hx, -hy, -hz),
      w(hx, -hy, -hz),
      w(hx, hy, -hz),
      w(-hx, hy, -hz),
      w(-hx, -hy, hz),
      w(hx, -hy, hz),
      w(hx, hy, hz),
      w(-hx, hy, hz),
    ];
    for (const [a, bb, cc, d] of [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [3, 2, 6, 7],
      [0, 3, 7, 4],
      [1, 2, 6, 5],
    ]) {
      tris.push([k[a], k[bb], k[cc]], [k[a], k[cc], k[d]]);
    }
  }
  const { min, max } = supermarket.bounds;
  const g = (x: number, z: number): V3 => [x, 0, z];
  tris.push(
    [g(min[0], min[2]), g(max[0], min[2]), g(max[0], max[2])],
    [g(min[0], min[2]), g(max[0], max[2]), g(min[0], max[2])],
  );
  const boxes = new Float32Array(tris.length * 6);
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      boxes[i * 6 + k] = Math.min(t[0][k], t[1][k], t[2][k]);
      boxes[i * 6 + 3 + k] = Math.max(t[0][k], t[1][k], t[2][k]);
    }
  });

  function ray(o: V3, d: V3, max = 100): number {
    let best = max;
    // Only the triangles whose box meets the segment's box can be hit.
    const lo = [0, 1, 2].map((k) => Math.min(o[k], o[k] + d[k] * max));
    const hi = [0, 1, 2].map((k) => Math.max(o[k], o[k] + d[k] * max));
    for (let i = 0; i < tris.length; i++) {
      const j = i * 6;
      if (
        boxes[j + 3] < lo[0] ||
        boxes[j] > hi[0] ||
        boxes[j + 4] < lo[1] ||
        boxes[j + 1] > hi[1] ||
        boxes[j + 5] < lo[2] ||
        boxes[j + 2] > hi[2]
      ) {
        continue;
      }
      const [a, b, c] = tris[i];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const p = [
        d[1] * e2[2] - d[2] * e2[1],
        d[2] * e2[0] - d[0] * e2[2],
        d[0] * e2[1] - d[1] * e2[0],
      ];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det;
      const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
      const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
      if (u < 0 || u > 1) continue;
      const q = [
        s[1] * e1[2] - s[2] * e1[1],
        s[2] * e1[0] - s[0] * e1[2],
        s[0] * e1[1] - s[1] * e1[0],
      ];
      const w = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
      if (w < 0 || u + w > 1) continue;
      const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
      if (t > 1e-4 && t < best) best = t;
    }
    return best;
  }

  function clearance([x, z]: readonly [number, number], y0 = 0): number {
    let near = Infinity;
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI) / 12;
      for (const h of [0.5, 1.2, 2]) {
        near = Math.min(near, ray([x, y0 + h, z], [Math.cos(a), 0, Math.sin(a)], 20));
      }
    }
    return near;
  }

  return {
    set,
    ray,
    clearance,
    heightAt: (x, z, from = 20) => from - ray([x, from, z], [0, -1, 0], 40),
    ceilingAt: (x, z, from = 0.5) => from + ray([x, from, z], [0, 1, 0], 40),
  };
}

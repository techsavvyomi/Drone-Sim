// Derives the Supermarket's top-down plan for the mission map from its GLB.
//
// The mission map draws the ground the pilot is flying over, north up, scrolling
// with the aircraft — New York from `generate-nyc-plan.mjs`, the Forest from
// `generate-forest-plan.mjs`. This is the third, and it is two plans, because
// the Supermarket's missions fly INDOORS:
//
//   - The OUTSIDE plan, 0.5 m cells over the whole map: what the pilot sees
//     from above. The ground by kind — asphalt, paving, grass, road paint — and
//     everything standing on it (the store and warehouse roofs, the trucks, the
//     lamp posts) as a height, which the map shades the way it shades New
//     York's roofs.
//   - The FLOOR PLAN, 0.25 m cells over the inside of the store: the store with
//     the roof taken off, cut through the band a drone flies in. Walls,
//     shelves, checkouts, stock — and the gaps in the front wall that are the
//     doors. The map swaps to it when the drone goes in through one. The
//     warehouse is sealed, and keeps its roof.
//
// WHY THE GROUND IS READ FROM THE TEXTURE. New York's ground comes from its
// material names (road, sidewalk, grass). This model is a Re-Volt level: the
// whole car park, the paving, the grass bank and the walls are one atlas
// material, so the only thing that says "grass" is that the texel is green. Each
// cell's top texel is classified into one of four kinds and drawn in the map's
// own palette — it is not a photograph (that was tried for New York and
// rejected: at this size a picture is noise). The thresholds were measured off
// the atlas: asphalt is neutral grey (red − blue ≈ 4), the paving is beige
// (≈ 19), the grass bank's green leads red and blue by ≈ 11, and the road paint
// is the only thing brighter than ~170.
//
// WHY THE FLOOR PLAN IS READ FROM THE COLLIDERS. It is there to say what the
// drone can fly between, and that is the physics, not the picture: the same
// `buildSupermarketColliders` SupermarketEnv runs, its boxes and shell
// triangles, cut through the flight band. A shelf the pilot can see through but
// not fly through is drawn solid; a hanging sign above the band is not drawn.
// Anything enclosed that the drone cannot reach from the car park — the inside
// of a shelf unit, a back room — is filled in, because on a plan an outline
// with nothing in it reads as floor.
//
// Both are grids, run-length encoded, painted once at runtime into a canvas and
// blitted — the Forest's form, because at 0.25 m the floor plan is sixty
// thousand cells, and the map scrolls sixty times a second.
//
// Usage:
//   node scripts/generate-supermarket-plan.mjs
//
// Reads:  src/assets/models/supermarket.opt.glb
//         src/renderer/scene/environment/supermarketColliders.ts
// Writes: src/renderer/scene/environment/SupermarketPlan.ts

import { writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { buildSupermarketColliders } from '../src/renderer/scene/environment/supermarketColliders.ts';

const MODEL = 'src/assets/models/supermarket.opt.glb';
const OUT = 'src/renderer/scene/environment/SupermarketPlan.ts';

/** SupermarketEnv's MODEL_SCALE. */
const SCALE = 0.1;
/** The materials SupermarketEnv gives no collider. */
const NON_SOLID = /^(Start|crosswalk|bost)$/;
/** The store and warehouse roof's own material — the dark slab at 6 m. */
const ROOF_MATERIAL = 'roadtest.003';
/** A roof triangle is one this high. The material also lines the walls. */
const ROOF_MIN_Y = 5;

// --- The outside plan -------------------------------------------------------

/** The supermarket spec's bounds, rounded out to whole cells. */
const X0 = -89.5;
const Z0 = -53.5;
const X1 = 74.5;
const Z1 = 56;
const CELL = 0.5;
/** Samples per cell, per side. A lamp post is thinner than a cell. */
const SUB = 2;
const W = Math.round((X1 - X0) / CELL);
const H = Math.round((Z1 - Z0) / CELL);

/** Cell values. Above STRUCT, a structure `(v - STRUCT) / 10` metres tall. */
const KIND = { void: 0, asphalt: 1, paving: 2, grass: 3, paint: 4 };
const STRUCT = 5;
/** Flatter than this over the ground is ground: the collider builder's own
 *  GROUND_TOP. */
const GROUND_TOP = 0.06;

// --- The floor plan ---------------------------------------------------------

const F_CELL = 0.25;
/**
 * The band the floor plan is cut through, metres. Anything solid in it is
 * drawn.
 *
 * The top is under the DOOR HEADS. Each entrance's lintel is a beam from 2.36
 * to 2.60 m across the whole doorway; the first cut went to 2.5 m — the
 * missions' highest indoor hover band — and drew every door shut, with the
 * store sealed off from the car park. 2 m is what a drone flies through a door
 * at. The bottom keeps a floor mat or a painted line off the plan while a pack
 * of cans, which a drone setting a parcel down would clip, stays on it.
 */
const BAND_LO = 0.25;
const BAND_HI = 2;
/**
 * The heights the reach is walked at, and how thick each slice is.
 *
 * "Can the drone get here from the car park" is a 3D question. Walked in 2D,
 * the old racing line's kerbs — 0.3 to 0.6 m tall, snaking across the store
 * floor — sealed half the store into pockets, and those pockets were filled in
 * as solid. A drone flies over a kerb, so the reach is walked at four heights,
 * climbing or descending wherever the cell is open at both.
 */
const LEVELS = [0.5, 1, 1.5, 2];
const LEVEL_HALF = 0.2;
/** Heights on the floor plan are capped at the roof. */
const CEILING = 6;
/** Where the flood fill starts: the spawn pad, in the open car park. */
const SEED = [-30, 20];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
console.log(`Reading ${MODEL} ...`);
const doc = await io.read(MODEL);

/** Every primitive in world metres, with its UVs and its decoded base texture. */
const prims = [];
const textures = new Map();
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    const pos = prim.getAttribute('POSITION');
    const uv = prim.getAttribute('TEXCOORD_0');
    const P = new Float32Array(pos.getCount() * 3);
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      P[i * 3] = (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) * SCALE;
      P[i * 3 + 1] = (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) * SCALE;
      P[i * 3 + 2] = (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) * SCALE;
    }
    const U = uv ? new Float32Array(uv.getCount() * 2) : null;
    if (uv) {
      const a = [0, 0];
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, a);
        U[i * 2] = a[0];
        U[i * 2 + 1] = a[1];
      }
    }
    const tex = mat?.getBaseColorTexture();
    if (tex && !textures.has(tex)) {
      const { data, info } = await sharp(Buffer.from(tex.getImage()))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      textures.set(tex, { data, w: info.width, h: info.height });
    }
    prims.push({
      name: mat?.getName() ?? '',
      P,
      U,
      I: prim.getIndices().getArray(),
      tex: tex ? textures.get(tex) : null,
      factor: mat?.getBaseColorFactor() ?? [1, 1, 1, 1],
    });
  }
}

// --- Outside: the top surface, seen from straight above -----------------------

const SW = W * SUB;
const SH = H * SUB;
const SC = CELL / SUB;
const topY = new Float32Array(SW * SH).fill(-Infinity);
const topRGB = new Uint8Array(SW * SH * 3);
/** Samples under the store and warehouse roofs. */
const roofed = new Uint8Array(SW * SH);

for (const p of prims) {
  const { P, U, I, tex, factor } = p;
  const isRoof = p.name === ROOF_MATERIAL;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3;
    const b = I[t + 1] * 3;
    const c = I[t + 2] * 3;
    const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    // A vertical triangle has no top: the triangles around it do.
    if (Math.abs(d) < 1e-9) continue;
    const roof = isRoof && Math.min(P[a + 1], P[b + 1], P[c + 1]) >= ROOF_MIN_Y;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - X0) / SC - 0.5));
    const i1 = Math.min(SW - 1, Math.floor((Math.max(ax, bx, cx) - X0) / SC - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - Z0) / SC - 0.5));
    const j1 = Math.min(SH - 1, Math.floor((Math.max(az, bz, cz) - Z0) / SC - 0.5));
    for (let j = j0; j <= j1; j++) {
      const z = Z0 + (j + 0.5) * SC;
      for (let i = i0; i <= i1; i++) {
        const x = X0 + (i + 0.5) * SC;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const s = j * SW + i;
        if (roof) roofed[s] = 1;
        const y = l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1];
        if (y <= topY[s]) continue;
        topY[s] = y;
        let rgb = [factor[0] * 255, factor[1] * 255, factor[2] * 255];
        if (tex && U) {
          let u = l1 * U[I[t] * 2] + l2 * U[I[t + 1] * 2] + l3 * U[I[t + 2] * 2];
          let v = l1 * U[I[t] * 2 + 1] + l2 * U[I[t + 1] * 2 + 1] + l3 * U[I[t + 2] * 2 + 1];
          u -= Math.floor(u);
          v -= Math.floor(v);
          const px = Math.min(tex.w - 1, Math.floor(u * tex.w));
          const py = Math.min(tex.h - 1, Math.floor(v * tex.h));
          const o = (py * tex.w + px) * 4;
          rgb = [tex.data[o] * factor[0], tex.data[o + 1] * factor[1], tex.data[o + 2] * factor[2]];
        }
        topRGB[s * 3] = rgb[0];
        topRGB[s * 3 + 1] = rgb[1];
        topRGB[s * 3 + 2] = rgb[2];
      }
    }
  }
}

/** A ground texel's kind. See the header for where the numbers come from. */
function groundKind(r, g, b) {
  if (g - Math.max(r, b) >= 5) return KIND.grass;
  if ((r + g + b) / 3 >= 170) return KIND.paint;
  if (r - b >= 11) return KIND.paving;
  return KIND.asphalt;
}

const outside = new Uint8Array(W * H);
/** Each cell's top, metres — for telling a speck on the grass bank from a
 *  thing standing on it. */
const cellTop = new Float32Array(W * H);
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    let top = -Infinity;
    let topAt = -1;
    const votes = [0, 0, 0, 0, 0];
    for (let sj = 0; sj < SUB; sj++) {
      for (let si = 0; si < SUB; si++) {
        const s = (j * SUB + sj) * SW + i * SUB + si;
        if (topY[s] === -Infinity) continue;
        if (topY[s] > top) {
          top = topY[s];
          topAt = s;
        }
        votes[groundKind(topRGB[s * 3], topRGB[s * 3 + 1], topRGB[s * 3 + 2])]++;
      }
    }
    let v = KIND.void;
    cellTop[j * W + i] = top;
    if (topAt >= 0) {
      const own = groundKind(topRGB[topAt * 3], topRGB[topAt * 3 + 1], topRGB[topAt * 3 + 2]);
      if (own === KIND.grass) {
        // The grass bank is terrain, not a structure, however high it rises.
        v = KIND.grass;
      } else if (top > GROUND_TOP) {
        // Standing on the ground: a height.
        v = STRUCT + Math.min(250, Math.round(top * 10));
      } else {
        // Ground: the kind most of the cell is, paint winning any tie — a
        // stripe is thinner than a cell, and it is the one thing on the ground
        // worth finding.
        v = KIND.asphalt;
        let best = -1;
        for (const k of [KIND.paint, KIND.paving, KIND.asphalt]) {
          if (votes[k] > best) {
            best = votes[k];
            v = k;
          }
        }
      }
    }
    outside[j * W + i] = v;
  }
}

// The ground kinds are read off a texture, and a texture has specks in it: a
// green fleck in the asphalt, a pale one in the grass. A cell whose neighbours
// are nearly all one other kind is a speck of that kind, not a patch. The test
// leaves the car park's grass islands alone — two cells wide, each of their
// cells has a whole row of its own kind beside it. Paint is left out of it
// both ways: a zebra stripe is one cell wide, all speck by this test, and the
// crossings in front of the doors are the landmark on this ground.
const GROUND_KINDS = new Set([KIND.asphalt, KIND.paving, KIND.grass]);
// First the bank: up there a pale fleck in the grass texture is not green, so
// it came out as something 2.4 m tall. A cell level with the grass all round it
// is the grass; a lamp post on the bank would stand well clear of it.
{
  const src = outside.slice();
  for (let j = 1; j < H - 1; j++) {
    for (let i = 1; i < W - 1; i++) {
      if (src[j * W + i] < STRUCT) continue;
      let level = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const n = (j + dj) * W + i + di;
          if ((di || dj) && src[n] === KIND.grass && Math.abs(cellTop[n] - cellTop[j * W + i]) < 0.3) level++;
        }
      }
      if (level >= 6) outside[j * W + i] = KIND.grass;
    }
  }
}
for (let pass = 0; pass < 2; pass++) {
  const src = outside.slice();
  for (let j = 1; j < H - 1; j++) {
    for (let i = 1; i < W - 1; i++) {
      const v = src[j * W + i];
      if (!GROUND_KINDS.has(v)) continue;
      const n = [0, 0, 0, 0, 0];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const u = src[(j + dj) * W + i + di];
          if ((di || dj) && GROUND_KINDS.has(u)) n[u]++;
        }
      }
      for (const k of GROUND_KINDS) if (k !== v && n[k] >= 6) outside[j * W + i] = k;
    }
  }
}

// --- Under the roof -----------------------------------------------------------

/** The roof's footprint on the outside grid, closed over the seams between its
 *  panels, which a sample can fall into. */
const roofCell = new Uint8Array(W * H);
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    let n = 0;
    for (let sj = 0; sj < SUB; sj++) {
      for (let si = 0; si < SUB; si++) n += roofed[(j * SUB + sj) * SW + i * SUB + si];
    }
    roofCell[j * W + i] = n > 0 ? 1 : 0;
  }
}
for (let pass = 0; pass < 2; pass++) {
  const src = roofCell.slice();
  for (let j = 1; j < H - 1; j++) {
    for (let i = 1; i < W - 1; i++) {
      if (src[j * W + i]) continue;
      const h = src[j * W + i - 1] && src[j * W + i + 1];
      const v = src[(j - 1) * W + i] && src[(j + 1) * W + i];
      if (h || v) roofCell[j * W + i] = 1;
    }
  }
}

// --- The floor plan: the colliders, cut through the flight band -----------------

// The whole map at floor-plan resolution, so the reach can walk in from the car
// park through the doors. Only the inside of the store is written out.
const FW = W * 2;
const FH = H * 2;
/** 0 open, else the top of what stands in the band, decimetres (at least 1). */
const cut = new Uint8Array(FW * FH);
/** Bit L set where something solid stands at LEVELS[L]. */
const blocked = new Uint8Array(FW * FH);
const ALL_LEVELS = (1 << LEVELS.length) - 1;

/** Which levels a solid spanning y0..y1 blocks. */
function levelBits(y0, y1) {
  let bits = 0;
  LEVELS.forEach((l, n) => {
    if (y1 >= l - LEVEL_HALF && y0 <= l + LEVEL_HALF) bits |= 1 << n;
  });
  return bits;
}
const mark = (i, j, top, bits) => {
  if (i < 0 || j < 0 || i >= FW || j >= FH) return;
  const k = j * FW + i;
  const v = Math.max(1, Math.min(CEILING * 10, Math.round(top * 10)));
  if (v > cut[k]) cut[k] = v;
  blocked[k] |= bits;
};

const sources = prims
  .filter((p) => !NON_SOLID.test(p.name))
  .map((p) => ({ positions: p.P, index: p.I }));
const set = buildSupermarketColliders(sources);
console.log(`Colliders: ${set.boxes.length} boxes, ${set.shell.length / 9} shell triangles`);

// Boxes: every cell the turned footprint overlaps, by separating axes — a glass
// door is 5 cm thick and must not fall between two cell centres.
const H2 = F_CELL / 2;
for (const bx of set.boxes) {
  const [cx, cy, cz] = bx.pos;
  const [hw, hh, hd] = bx.half;
  if (cy + hh < BAND_LO || cy - hh > BAND_HI) continue;
  const bits = levelBits(cy - hh, cy + hh);
  const c = Math.cos(bx.yaw);
  const s = Math.sin(bx.yaw);
  // Local +X is (c, -s) on the ground, local +Z is (s, c).
  const ux = c, uz = -s, vx = s, vz = c;
  const ex = Math.abs(ux) * hw + Math.abs(vx) * hd;
  const ez = Math.abs(uz) * hw + Math.abs(vz) * hd;
  const i0 = Math.floor((cx - ex - X0) / F_CELL);
  const i1 = Math.floor((cx + ex - X0) / F_CELL);
  const j0 = Math.floor((cz - ez - Z0) / F_CELL);
  const j1 = Math.floor((cz + ez - Z0) / F_CELL);
  const ru = H2 * (Math.abs(ux) + Math.abs(uz));
  const rv = H2 * (Math.abs(vx) + Math.abs(vz));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = X0 + (i + 0.5) * F_CELL - cx;
      const dz = Z0 + (j + 0.5) * F_CELL - cz;
      if (Math.abs(dx) >= ex + H2 - 1e-6 || Math.abs(dz) >= ez + H2 - 1e-6) continue;
      if (Math.abs(dx * ux + dz * uz) >= hw + ru - 1e-6) continue;
      if (Math.abs(dx * vx + dz * vz) >= hd + rv - 1e-6) continue;
      mark(i, j, cy + hh, bits);
    }
  }
}

/** Clips a polygon to y >= limit (sign 1) or y <= limit (sign -1). */
function clipY(poly, limit, sign) {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % poly.length];
    const pin = sign * (p[1] - limit) >= 0;
    const qin = sign * (q[1] - limit) >= 0;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (limit - p[1]) / (q[1] - p[1]);
      out.push([p[0] + t * (q[0] - p[0]), limit, p[2] + t * (q[2] - p[2])]);
    }
  }
  return out;
}
const clipBand = (tri, lo, hi) => {
  const poly = clipY(tri, lo, 1);
  return poly.length ? clipY(poly, hi, -1) : poly;
};

/** Every cell a polygon's footprint touches: its outline walked (a wall seen
 *  from above is a line) and its inside filled. */
function footprint(poly, visit) {
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % poly.length];
    const n = Math.ceil(Math.hypot(q[0] - p[0], q[2] - p[2]) / (F_CELL / 4)) + 1;
    for (let s = 0; s <= n; s++) {
      const x = p[0] + ((q[0] - p[0]) * s) / n;
      const z = p[2] + ((q[2] - p[2]) * s) / n;
      visit(Math.floor((x - X0) / F_CELL), Math.floor((z - Z0) / F_CELL));
    }
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
  }
  for (let j = Math.floor((z0 - Z0) / F_CELL); j <= Math.floor((z1 - Z0) / F_CELL); j++) {
    for (let i = Math.floor((x0 - X0) / F_CELL); i <= Math.floor((x1 - X0) / F_CELL); i++) {
      const x = X0 + (i + 0.5) * F_CELL;
      const z = Z0 + (j + 0.5) * F_CELL;
      // Even-odd over the polygon's footprint.
      let inside = false;
      for (let k = 0, l = poly.length - 1; k < poly.length; l = k++) {
        const [ax, , az] = poly[k];
        const [bx, , bz] = poly[l];
        if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
      }
      if (inside) visit(i, j);
    }
  }
}

// Shell triangles: what is drawn is the part inside the band; what blocks a
// level is the part inside that level's slice.
const S = set.shell;
for (let t = 0; t < S.length; t += 9) {
  const tri = [
    [S[t], S[t + 1], S[t + 2]],
    [S[t + 3], S[t + 4], S[t + 5]],
    [S[t + 6], S[t + 7], S[t + 8]],
  ];
  const top = Math.max(tri[0][1], tri[1][1], tri[2][1]);
  const inBand = clipBand(tri, BAND_LO, BAND_HI);
  if (inBand.length < 2) continue;
  footprint(inBand, (i, j) => mark(i, j, top, 0));
  LEVELS.forEach((l, n) => {
    const slice = clipBand(tri, l - LEVEL_HALF, l + LEVEL_HALF);
    if (slice.length >= 2) footprint(slice, (i, j) => mark(i, j, top, 1 << n));
  });
}

// What the drone can reach from the car park: a flood over (cell, level),
// sideways where the level is open in both cells, up or down where the cell is
// open at both levels.
const reached = new Uint8Array(FW * FH);
{
  const L = LEVELS.length;
  const seen = new Uint8Array(FW * FH);
  const si = Math.floor((SEED[0] - X0) / F_CELL);
  const sj = Math.floor((SEED[1] - Z0) / F_CELL);
  if (blocked[sj * FW + si] === ALL_LEVELS) throw new Error('The reach seed is not open.');
  const stack = [];
  const visit = (k, n) => {
    const bit = 1 << n;
    if (seen[k] & bit || blocked[k] & bit) return;
    seen[k] |= bit;
    stack.push(k * L + n);
  };
  for (let n = 0; n < L; n++) visit(sj * FW + si, n);
  while (stack.length) {
    const e = stack.pop();
    const n = e % L;
    const k = (e - n) / L;
    const i = k % FW;
    const j = (k - i) / FW;
    if (i > 0) visit(k - 1, n);
    if (i < FW - 1) visit(k + 1, n);
    if (j > 0) visit(k - FW, n);
    if (j < FH - 1) visit(k + FW, n);
    if (n > 0) visit(k, n - 1);
    if (n < L - 1) visit(k, n + 1);
  }
  for (let k = 0; k < FW * FH; k++) reached[k] = seen[k] ? 1 : 0;
}

/**
 * Flood-labels a grid's cells where `member(k)` holds, 4-connected. Returns a
 * label per cell (0 for none) and how many labels there are.
 */
function components(w, h, member) {
  const label = new Int32Array(w * h);
  let count = 0;
  for (let k0 = 0; k0 < w * h; k0++) {
    if (label[k0] || !member(k0)) continue;
    label[k0] = ++count;
    const stack = [k0];
    while (stack.length) {
      const k = stack.pop();
      const i = k % w;
      for (const n of [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, k - w, k + w]) {
        if (n < 0 || n >= w * h || label[n] || !member(n)) continue;
        label[n] = count;
        stack.push(n);
      }
    }
  }
  return { label, count };
}

// Only a building the drone can get into loses its roof. The warehouse is
// sealed — its dock doors are shut — so a plan of its inside would be a plan of
// somewhere the pilot cannot go, and it stays a roof.
{
  const { label, count } = components(W, H, (k) => roofCell[k] === 1);
  // Inside means well under the roof, not under its eaves: the flood walks the
  // overhang outside every wall. Two cells in from the roof's edge is a metre,
  // and the front wall stands 0.4 m in.
  const deep = (i, j) => {
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H || !roofCell[nj * W + ni]) return false;
      }
    }
    return true;
  };
  const entered = new Uint8Array(count + 1);
  for (let k = 0; k < FW * FH; k++) {
    if (!reached[k]) continue;
    const i = k % FW;
    const j = (k - i) / FW;
    const l = label[(j >> 1) * W + (i >> 1)];
    if (l && !entered[l] && deep(i >> 1, j >> 1)) entered[l] = 1;
  }
  let sealed = 0;
  for (let k = 0; k < W * H; k++) {
    if (label[k] && !entered[label[k]]) {
      roofCell[k] = 0;
      sealed++;
    }
  }
  console.log(`Roofs: ${count} buildings, ${sealed} roof cells over sealed ones kept as roof`);
}

// What the floor plan covers: the INSIDE of the store, which is not the same
// as its roof. The 6 m roof stops 1.5 to 2 m behind the glass front — the
// entrances are portals standing forward of it — so a plan cut to the roof left
// the front wall and both doors off it, and the map changed over two metres
// after the drone was through the door.
//
// So the inside is found the way a person would say it: shut the doors, and the
// inside is what you cannot walk to from the car park. Every wall — anything
// that blocks a drone at both 1 and 1.5 m — is grown by DOOR_SHUT, which closes
// any gap narrower than twice that; the car park is flooded in what is left and
// grown back by the same amount, which returns it to the walls everywhere except
// through a doorway. What the drone can reach that the car park then does not
// cover is inside, if it lies under a roof the drone can get beneath.
const DOOR_SHUT = 4; // cells: 1 m, so gaps up to 2 m close — the doors are 1.5
const WALL_BITS = (1 << 1) | (1 << 2);
const inside = new Uint8Array(FW * FH);
{
  /** Cells from the nearest cell where `from(k)` holds, through cells where
   *  `through(k)` holds, out to `max`; 255 beyond it. */
  const spread = (from, through, max) => {
    const dist = new Uint8Array(FW * FH).fill(255);
    let front = [];
    for (let k = 0; k < FW * FH; k++) {
      if (from(k)) {
        dist[k] = 0;
        front.push(k);
      }
    }
    for (let d = 1; d <= max && front.length; d++) {
      const next = [];
      for (const k of front) {
        const i = k % FW;
        for (const n of [i > 0 ? k - 1 : -1, i < FW - 1 ? k + 1 : -1, k - FW, k + FW]) {
          if (n < 0 || n >= FW * FH || dist[n] !== 255 || !through(n)) continue;
          dist[n] = d;
          next.push(n);
        }
      }
      front = next;
    }
    return dist;
  };
  const wall = (k) => (blocked[k] & WALL_BITS) === WALL_BITS;
  const nearWall = spread(wall, () => true, DOOR_SHUT);
  // The car park with the doors shut.
  const shut = new Uint8Array(FW * FH);
  {
    const si = Math.floor((SEED[0] - X0) / F_CELL);
    const sj = Math.floor((SEED[1] - Z0) / F_CELL);
    const stack = [sj * FW + si];
    shut[stack[0]] = 1;
    while (stack.length) {
      const k = stack.pop();
      const i = k % FW;
      for (const n of [i > 0 ? k - 1 : -1, i < FW - 1 ? k + 1 : -1, k - FW, k + FW]) {
        if (n < 0 || n >= FW * FH || shut[n] || nearWall[n] <= DOOR_SHUT) continue;
        shut[n] = 1;
        stack.push(n);
      }
    }
  }
  const out = spread((k) => shut[k] === 1, (k) => !wall(k), DOOR_SHUT);
  // Reached, and not the car park: inside something. Kept only where it is
  // under a roof the drone got beneath — a gap between two parked trucks closes
  // too, and it is not a building.
  const { label, count } = components(FW, FH, (k) => reached[k] === 1 && out[k] === 255);
  const keep = new Uint8Array(count + 1);
  for (let k = 0; k < FW * FH; k++) {
    const i = k % FW;
    const j = (k - i) / FW;
    if (label[k] && roofCell[(j >> 1) * W + (i >> 1)]) keep[label[k]] = 1;
  }
  for (let k = 0; k < FW * FH; k++) if (keep[label[k]] && label[k]) inside[k] = 1;
  // Its walls: every solid cell touching it, and a metre into the solid beyond
  // that, for a wall thicker than a cell.
  const walls = spread((k) => inside[k] === 1, (k) => cut[k] > 0 && out[k] === 255, 4);
  for (let k = 0; k < FW * FH; k++) if (walls[k] !== 255) inside[k] = 1;
  // The roof over it — a shelf unit wider than two metres is still inside.
  for (let k = 0; k < FW * FH; k++) {
    const i = k % FW;
    const j = (k - i) / FW;
    if (roofCell[(j >> 1) * W + (i >> 1)] && out[k] === 255) inside[k] = 1;
  }
  // The doorways. Growing the car park back to the walls grows it through the
  // doors too, as far as the wall's own thickness, so the gap itself came out
  // as outside — and drawn under the floor plan, the entrance portal's top
  // closed it on the map. An open cell with the inside on both sides of it,
  // across or along, within DOOR_SHUT twice over, is the doorway.
  {
    const src = inside.slice();
    const span = DOOR_SHUT * 2;
    const both = (k, step, limit) => {
      let a = false;
      let b = false;
      for (let d = 1; d <= span && !(a && b); d++) {
        if (!a && limit(-d) && src[k - step * d]) a = true;
        if (!b && limit(d) && src[k + step * d]) b = true;
      }
      return a && b;
    };
    for (let k = 0; k < FW * FH; k++) {
      if (src[k] || !reached[k] || cut[k]) continue;
      const i = k % FW;
      const j = (k - i) / FW;
      const across = both(k, 1, (d) => i + d >= 0 && i + d < FW);
      const along = both(k, FW, (d) => j + d >= 0 && j + d < FH);
      if (across || along) inside[k] = 1;
    }
  }
  // And anything it closes round.
  const { label: holes, count: nHoles } = components(FW, FH, (k) => !inside[k]);
  const edge = new Uint8Array(nHoles + 1);
  for (let i = 0; i < FW; i++) {
    edge[holes[i]] = 1;
    edge[holes[(FH - 1) * FW + i]] = 1;
  }
  for (let j = 0; j < FH; j++) {
    edge[holes[j * FW]] = 1;
    edge[holes[j * FW + FW - 1]] = 1;
  }
  for (let k = 0; k < FW * FH; k++) if (holes[k] && !edge[holes[k]]) inside[k] = 1;
}

// The floor plan's frame: the inside, rounded out to whole cells.
let fi0 = FW, fi1 = -1, fj0 = FH, fj1 = -1;
for (let j = 0; j < FH; j++) {
  for (let i = 0; i < FW; i++) {
    if (!inside[j * FW + i]) continue;
    fi0 = Math.min(fi0, i); fi1 = Math.max(fi1, i);
    fj0 = Math.min(fj0, j); fj1 = Math.max(fj1, j);
  }
}
const PW = fi1 - fi0 + 1;
const PH = fj1 - fj0 + 1;

/** Floor-plan cell values: 0 not inside, 1 open floor, above that an obstacle
 *  `(v - 2) / 10` metres tall. */
const floor = new Uint8Array(PW * PH);
const POCKET = 0xff;
let enclosed = 0;
for (let j = 0; j < PH; j++) {
  for (let i = 0; i < PW; i++) {
    const k = (fj0 + j) * FW + fi0 + i;
    if (!inside[k]) continue;
    if (cut[k]) floor[j * PW + i] = 2 + cut[k];
    else if (reached[k]) floor[j * PW + i] = 1;
    else {
      floor[j * PW + i] = POCKET;
      enclosed++;
    }
  }
}
// A pocket — the hollow of a shelf unit, a room with no way in — is filled in
// flat, at the tallest thing around it: the shelf's own height, not a patchwork.
{
  const { label, count } = components(PW, PH, (k) => floor[k] === POCKET);
  const fill = new Uint8Array(count + 1);
  for (let k = 0; k < PW * PH; k++) {
    const l = label[k];
    if (!l) continue;
    const i = k % PW;
    for (const n of [i > 0 ? k - 1 : -1, i < PW - 1 ? k + 1 : -1, k - PW, k + PW]) {
      if (n < 0 || n >= PW * PH) continue;
      const v = floor[n];
      if (v >= 2 && v !== POCKET) fill[l] = Math.max(fill[l], v);
    }
  }
  for (let k = 0; k < PW * PH; k++) {
    if (label[k]) floor[k] = fill[label[k]] || 2 + CEILING * 10;
  }
}

// --- Write it -----------------------------------------------------------------

/** Run-length: [value, count] byte pairs, runs of at most 255. */
function rle(bytes) {
  const out = [];
  for (let k = 0; k < bytes.length; ) {
    const v = bytes[k];
    let n = 1;
    while (k + n < bytes.length && bytes[k + n] === v && n < 255) n++;
    out.push(v, n);
    k += n;
  }
  return Buffer.from(out).toString('base64');
}
const wrap = (s) => s.match(/.{1,96}/g).map((l) => `    '${l}'`).join(' +\n');

let tallest = 0;
for (const v of outside) if (v >= STRUCT) tallest = Math.max(tallest, (v - STRUCT) / 10);
const counts = [0, 0, 0, 0, 0, 0];
for (const v of outside) counts[Math.min(v, STRUCT)]++;
const open = floor.filter((v) => v === 1).length;

const outsideData = rle(outside);
const floorData = rle(floor);

const ts = `// GENERATED FILE — do not edit by hand.
// Regenerate with:  node scripts/generate-supermarket-plan.mjs
//
// The Supermarket seen from above, for the mission map. Two grids, each
// run-length encoded as [value, count] byte pairs, base64. See the generator
// for how each cell is found.
//
// OUTSIDE — ${W} x ${H} cells of ${CELL} m over the whole map. 0 no ground,
// 1 asphalt, 2 paving, 3 grass, 4 road paint; ${STRUCT} and up, something
// standing (v - ${STRUCT}) / 10 m tall. ${counts[1]} asphalt, ${counts[2]} paving,
// ${counts[3]} grass, ${counts[4]} paint, ${counts[5]} standing, ${counts[0]} without ground.
//
// FLOOR — ${PW} x ${PH} cells of ${F_CELL} m over the inside of the store: the
// colliders cut between ${BAND_LO} and ${BAND_HI} m. 0 not inside, 1 open floor,
// 2 and up an obstacle (v - 2) / 10 m tall. ${open} open, ${enclosed} enclosed
// and filled in.

export const SUPERMARKET_PLAN = {
  outside: {
    x0: ${X0},
    z0: ${Z0},
    cell: ${CELL},
    w: ${W},
    h: ${H},
    /** Values from here up are standing structures. */
    struct: ${STRUCT},
    /** The tallest thing on the plan, metres — the top of the shading ramp. */
    tallest: ${tallest},
    data:
${wrap(outsideData)},
  },
  floor: {
    x0: ${X0 + fi0 * F_CELL},
    z0: ${Z0 + fj0 * F_CELL},
    cell: ${F_CELL},
    w: ${PW},
    h: ${PH},
    /** The roof's underside: inside and below it, the drone is indoors. */
    ceiling: ${CEILING},
    data:
${wrap(floorData)},
  },
} as const;
`;

writeFileSync(OUT, ts);
console.log(
  `Wrote ${OUT}: outside ${W}x${H} (${outsideData.length} b64), ` +
    `floor ${PW}x${PH} (${floorData.length} b64), ${open} open, ${enclosed} enclosed, ` +
    `tallest ${tallest} m`,
);

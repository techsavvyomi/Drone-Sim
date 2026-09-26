import { FOREST_PLAN } from '../scene/environment/ForestPlan';
import { SUPERMARKET_PLAN } from '../scene/environment/SupermarketPlan';
import {
  CABINS,
  CABIN_SIZE,
  COL_W,
  CORE,
  HALF_X,
  HALF_Z,
  SKIPS,
  SKIP_SIZE,
  XS,
  ZS,
} from '../scene/environment/siteLayout';
import { SITE_STORE_AT, SITE_STORE_SIZE } from '../missions/siteStore';
import type { Mission } from '../missions/types';

// ----------------------------------------------------------------------------
// The ground the mission map draws, for the maps that are not New York.
//
// New York's plan is its roofs and streets, drawn straight from
// `NewYorkPlan.ts` inside `MissionCityMap`. These are the other three, each read
// from the same data the map itself is built from, so the plan cannot drift
// from the world:
//
//   - The FOREST from `ForestPlan.ts`, a grid generated off the GLB: ground
//     kind, height and canopy per 2 m cell. It is painted ONCE into a small
//     canvas and blitted, scaled, every frame — a forest is fourteen thousand
//     cells, and drawing them one by one sixty times a second is the kind of
//     cost this machine does not have.
//   - The CONSTRUCTION SITE from `siteLayout.ts`: the frame, its columns and
//     core, the cabins, the skips, the crane — rectangles, drawn each frame the
//     way New York's roofs are. There are a few dozen of them.
//   - The SUPERMARKET from `SupermarketPlan.ts`, two grids generated off the
//     GLB and its colliders: the outside seen from above, and the floor plan
//     inside the store. Painted once, like the forest's, with the edges between
//     heights stroked each frame the way New York's are.
//
// All draw in world metres through the caller's `sx`/`sz`, north up, and none
// knows anything about the mission's marks — those are the map's job.
// ----------------------------------------------------------------------------

/** World x/z to map pixels, and pixels per metre. */
export interface PlanView {
  sx: (x: number) => number;
  sz: (z: number) => number;
  k: number;
}

// --- The forest ---------------------------------------------------------------

/** Ground colours by kind: none, grass, dirt, road, rock. Muted — the ground is
 *  context, and the aircraft and the marks are what the eye has to find. */
const FOREST_KIND: readonly (readonly [number, number, number])[] = [
  [7, 9, 13],
  [58, 84, 50],
  [96, 80, 56],
  [176, 146, 98],
  [118, 118, 114],
];
/** What canopy is blended toward, and how much: the crowns read as darker,
 *  cooler green over the clearings and the road. */
const CANOPY = [18, 44, 26];
const CANOPY_MIX = 0.6;

let forestCanvas: HTMLCanvasElement | null = null;

/** The forest, painted once at one pixel per cell. */
function forestImage(): HTMLCanvasElement | null {
  if (forestCanvas) return forestCanvas;
  if (typeof document === 'undefined') return null;
  const { w, h, yFloor, canopyBit, data } = FOREST_PLAN;
  const raw = atob(data);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const kind = raw.charCodeAt(i * 2);
    const y = raw.charCodeAt(i * 2 + 1) / 2 + yFloor;
    const base = FOREST_KIND[kind & 7] ?? FOREST_KIND[0];
    // Lower is darker: the gorge reads as a cut, the clearing as the high
    // ground it is. Clamped so the valley floor is still ground, not a hole.
    const shade = (kind & 7) === 0 ? 1 : Math.max(0.4, Math.min(1.1, 1 + y / 55));
    const canopy = (kind & canopyBit) !== 0;
    for (let c = 0; c < 3; c++) {
      let v = base[c] * shade;
      if (canopy) v = v * (1 - CANOPY_MIX) + CANOPY[c] * CANOPY_MIX;
      img.data[i * 4 + c] = v;
    }
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  forestCanvas = canvas;
  return canvas;
}

export function drawForestPlan(ctx: CanvasRenderingContext2D, v: PlanView): void {
  const img = forestImage();
  if (!img) return;
  const { x0, z0, cell, w, h } = FOREST_PLAN;
  // Smoothed: at a couple of pixels a cell, nearest-neighbour turns the road
  // into a staircase.
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, v.sx(x0), v.sz(z0), w * cell * v.k, h * cell * v.k);
}

// --- The construction site ----------------------------------------------------

const SITE_GROUND = '#2a2d31';
const SITE_RAFT = '#3a342e';
const SITE_SLAB = '#5f646b';
/** The half of the roof that was poured, lighter: it is the top of the
 *  building, and the rest is open down to Level 6. */
const SITE_ROOF = '#7b8088';
const SITE_CORE = '#1d1f23';
const SITE_COLUMN = '#aab0b8';
const SITE_CABIN = '#7d8894';
const SITE_SKIP = '#7a3d22';
const SITE_STORE = '#2f7aa0';
const SITE_CRANE = '#c79b34';

/** The crane: its mast, and the jib's line from the slewing ring. Read off
 *  `buildCrane` — the mast at (-42, 26), the jib from 1.5 to 35.5 m along a top
 *  slewed to -0.6 rad, the counter-jib back to -12. */
const CRANE_AT: readonly [number, number] = [-42, 26];
const CRANE_YAW = -0.6;

export function drawSitePlan(ctx: CanvasRenderingContext2D, v: PlanView, mission: Mission): void {
  const { sx, sz, k } = v;
  const rect = (x: number, z: number, w: number, d: number, colour: string) => {
    ctx.fillStyle = colour;
    ctx.fillRect(sx(x), sz(z), w * k, d * k);
  };

  // The hardstanding, and the next pour's raft in the corner.
  ctx.fillStyle = SITE_GROUND;
  ctx.fillRect(sx(-60), sz(-60), 120 * k, 120 * k);
  rect(-46, -41, 20, 14, SITE_RAFT);

  // The frame: the slab under everything, the poured half of the roof over it,
  // the lift core, and the column grid on top — the one thing that says "a
  // building you fly through" rather than "a block".
  rect(-HALF_X, -HALF_Z, HALF_X * 2, HALF_Z * 2, SITE_SLAB);
  rect(-HALF_X, 0, HALF_X * 2, HALF_Z, SITE_ROOF);
  rect(CORE.x0, CORE.z0, CORE.x1 - CORE.x0, CORE.z1 - CORE.z0, SITE_CORE);
  const c = Math.max(1.2, COL_W * k);
  ctx.fillStyle = SITE_COLUMN;
  for (const x of XS) for (const z of ZS) ctx.fillRect(sx(x) - c / 2, sz(z) - c / 2, c, c);

  // The office cabins and the skips.
  for (const [x, z] of CABINS) {
    rect(x - CABIN_SIZE[0] / 2, z - CABIN_SIZE[2] / 2, CABIN_SIZE[0], CABIN_SIZE[2], SITE_CABIN);
  }
  ctx.fillStyle = SITE_SKIP;
  for (const [x, z, yaw] of SKIPS) {
    ctx.save();
    ctx.translate(sx(x), sz(z));
    // The world turns +x toward -z for a positive yaw; on a north-up plan
    // with +z down the screen that is an anticlockwise turn.
    ctx.rotate(-yaw);
    ctx.fillRect(
      (-SKIP_SIZE[0] / 2) * k,
      (-SKIP_SIZE[2] / 2) * k,
      SKIP_SIZE[0] * k,
      SKIP_SIZE[2] * k,
    );
    ctx.restore();
  }

  // The material store, on the mission that has it.
  if (mission.cargo === 'cement') {
    const [w, , d] = SITE_STORE_SIZE;
    rect(SITE_STORE_AT[0] - w / 2, SITE_STORE_AT[1] - d / 2, w, d, SITE_STORE);
  }

  // The crane: a landmark from anywhere on site.
  const jx = Math.cos(CRANE_YAW);
  const jz = -Math.sin(CRANE_YAW);
  ctx.strokeStyle = SITE_CRANE;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(1, 1.2 * k);
  ctx.beginPath();
  ctx.moveTo(sx(CRANE_AT[0] - jx * 12), sz(CRANE_AT[1] - jz * 12));
  ctx.lineTo(sx(CRANE_AT[0] + jx * 35.5), sz(CRANE_AT[1] + jz * 35.5));
  ctx.stroke();
  ctx.globalAlpha = 1;
  rect(CRANE_AT[0] - 1.3, CRANE_AT[1] - 1.3, 2.6, 2.6, SITE_CRANE);
}

// --- The Supermarket ----------------------------------------------------------
//
// Two plans, because its missions fly indoors. OUTSIDE is New York's plan of
// this map: the ground by kind, and everything standing on it shaded by height,
// the store and the warehouse as roofs. The FLOOR PLAN is the store with the
// roof off, cut through the band a drone flies in — walls, shelves, checkouts
// and the gaps in the front wall that are the doors. The map lays it over the
// roofs while the drone is inside (`supermarketIndoorAt`), and the two
// cross-fade as it goes in or out. The warehouse is sealed and keeps its roof.

const SM = SUPERMARKET_PLAN;

/** The ground kinds, in New York's colours so the two maps read alike: its
 *  road, its sidewalk, its grass, and its lane paint laid over the road. */
const SM_GROUND: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], // no ground: left transparent, the map's own void shows
  [27, 31, 38],
  [58, 63, 72],
  [63, 92, 52],
  [111, 98, 61],
];
/** The store floor: a shade lighter than the car park's asphalt, so the pilot
 *  can tell inside from out on a plan that has lost its roof. */
const SM_FLOOR = [38, 43, 52];
/** New York's roof ramp, dark to light with height. */
const SM_LOW = [70, 78, 90];
const SM_HIGH = [196, 205, 216];
/** The line where one height steps to another — New York's. */
const SM_EDGE = 'rgba(6, 10, 17, 0.75)';
/**
 * The smallest step outside that is an edge, metres. The store roof undulates
 * by a quarter of a metre and must stay one roof; a truck's trailer stands
 * 1.5 m over its cab.
 */
const SM_STEP = 0.75;
/** And inside, where a checkout beside a shelf is the step to show. */
const SM_FLOOR_STEP = 1;

/** A run-length grid back to one byte a cell. */
export function decodePlanGrid(data: string, cells: number): Uint8Array {
  const raw = atob(data);
  const out = new Uint8Array(cells);
  let k = 0;
  for (let i = 0; i < raw.length; i += 2) {
    const v = raw.charCodeAt(i);
    const n = raw.charCodeAt(i + 1);
    out.fill(v, k, k + n);
    k += n;
  }
  return out;
}

let smGrids: { outside: Uint8Array; floor: Uint8Array } | null = null;
function supermarketGrids() {
  smGrids ??= {
    outside: decodePlanGrid(SM.outside.data, SM.outside.w * SM.outside.h),
    floor: decodePlanGrid(SM.floor.data, SM.floor.w * SM.floor.h),
  };
  return smGrids;
}

/** Height of an outside cell, metres; the ground and the grass bank are 0. */
const outsideHeight = (v: number) => (v >= SM.outside.struct ? (v - SM.outside.struct) / 10 : 0);
/** Height of a floor-plan cell, metres; open floor is 0. */
const floorHeight = (v: number) => (v >= 2 ? (v - 2) / 10 : 0);

const ramp = (f: number, c: number) => Math.round(SM_LOW[c] + (SM_HIGH[c] - SM_LOW[c]) * f);

/**
 * The two plans as RGBA, one pixel per cell. Pure — no canvas — so the tests
 * paint exactly what the map does.
 */
export function supermarketPixels(): { outside: Uint8ClampedArray; floor: Uint8ClampedArray } {
  const { outside, floor } = supermarketGrids();
  const out = new Uint8ClampedArray(outside.length * 4);
  for (let k = 0; k < outside.length; k++) {
    const v = outside[k];
    if (v === 0) continue;
    // Square root, as New York's: most of what stands here is under 5 m.
    const f = Math.sqrt(Math.min(1, outsideHeight(v) / SM.outside.tallest));
    for (let c = 0; c < 3; c++) out[k * 4 + c] = v >= SM.outside.struct ? ramp(f, c) : SM_GROUND[v][c];
    out[k * 4 + 3] = 255;
  }
  const fl = new Uint8ClampedArray(floor.length * 4);
  for (let k = 0; k < floor.length; k++) {
    const v = floor[k];
    if (v === 0) continue;
    const h = floorHeight(v);
    for (let c = 0; c < 3; c++) {
      // Under a metre, faded toward the floor: the old racing line's kerbs
      // snake across the whole store at half a metre, and at full strength
      // they drown the shelves, which are what a pilot flies between. Over a
      // metre, the ramp — linear against the ceiling, so shelves and walls
      // part company.
      fl[k * 4 + c] =
        v === 1
          ? SM_FLOOR[c]
          : h < 1
            ? Math.round(SM_FLOOR[c] + (SM_LOW[c] - SM_FLOOR[c]) * h)
            : ramp(Math.min(1, (h - 1) / (SM.floor.ceiling - 1)), c);
    }
    fl[k * 4 + 3] = 255;
  }
  return { outside: out, floor: fl };
}

/**
 * Every boundary between two cells whose heights differ by at least `step`,
 * merged into straight runs: x1, z1, x2, z2 in world metres. Only where both
 * cells' values are `skipBelow` or more.
 */
export function planEdges(
  grid: Uint8Array,
  g: { x0: number; z0: number; cell: number; w: number; h: number },
  height: (v: number) => number,
  step: number,
  skipBelow: number,
): Float32Array {
  const out: number[] = [];
  const { x0, z0, cell, w, h } = g;
  const differs = (a: number, b: number) =>
    a >= skipBelow && b >= skipBelow && Math.abs(height(a) - height(b)) >= step;
  // Between rows j-1 and j, run along i.
  for (let j = 1; j < h; j++) {
    let start = -1;
    for (let i = 0; i <= w; i++) {
      const on = i < w && differs(grid[(j - 1) * w + i], grid[j * w + i]);
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        out.push(x0 + start * cell, z0 + j * cell, x0 + i * cell, z0 + j * cell);
        start = -1;
      }
    }
  }
  // Between columns i-1 and i, run along j.
  for (let i = 1; i < w; i++) {
    let start = -1;
    for (let j = 0; j <= h; j++) {
      const on = j < h && differs(grid[j * w + i - 1], grid[j * w + i]);
      if (on && start < 0) start = j;
      if (!on && start >= 0) {
        out.push(x0 + i * cell, z0 + start * cell, x0 + i * cell, z0 + j * cell);
        start = -1;
      }
    }
  }
  return new Float32Array(out);
}

let smLayers: {
  outside: HTMLCanvasElement;
  floor: HTMLCanvasElement;
  outsideEdges: Float32Array;
  floorEdges: Float32Array;
} | null = null;

function supermarketLayers() {
  if (smLayers) return smLayers;
  if (typeof document === 'undefined') return null;
  const px = supermarketPixels();
  const paint = (w: number, h: number, data: Uint8ClampedArray) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(w, h);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
    return canvas;
  };
  const outside = paint(SM.outside.w, SM.outside.h, px.outside);
  const floor = paint(SM.floor.w, SM.floor.h, px.floor);
  if (!outside || !floor) return null;
  const grids = supermarketGrids();
  smLayers = {
    outside,
    floor,
    // Outside, the ground's kinds are colours, not heights: every cell counts,
    // void included, and a truck on asphalt steps from 0.
    outsideEdges: planEdges(grids.outside, SM.outside, outsideHeight, SM_STEP, 0),
    // Under the roof, only where two obstacles meet: an edge on open floor is
    // dark on dark, and there are thousands of them.
    floorEdges: planEdges(grids.floor, SM.floor, floorHeight, SM_FLOOR_STEP, 2),
  };
  return smLayers;
}

/**
 * Whether a point is indoors: inside the store's walls — from the doorway in —
 * and under its roof. What the map switches to the floor plan on.
 */
export function supermarketIndoorAt(x: number, y: number, z: number): boolean {
  if (y >= SM.floor.ceiling) return false;
  const i = Math.floor((x - SM.floor.x0) / SM.floor.cell);
  const j = Math.floor((z - SM.floor.z0) / SM.floor.cell);
  if (i < 0 || j < 0 || i >= SM.floor.w || j >= SM.floor.h) return false;
  return supermarketGrids().floor[j * SM.floor.w + i] !== 0;
}

function strokeEdges(ctx: CanvasRenderingContext2D, v: PlanView, edges: Float32Array, size: number) {
  ctx.strokeStyle = SM_EDGE;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let i = 0; i < edges.length; i += 4) {
    const x1 = v.sx(edges[i]);
    const y1 = v.sz(edges[i + 1]);
    const x2 = v.sx(edges[i + 2]);
    const y2 = v.sz(edges[i + 3]);
    if (Math.max(x1, x2) < 0 || Math.max(y1, y2) < 0) continue;
    if (Math.min(x1, x2) > size || Math.min(y1, y2) > size) continue;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
}

/**
 * The Supermarket. `indoor` runs 0 to 1: 0 is the roofs, 1 the floor plan, and
 * between them the floor plan is laid over the roofs at that opacity.
 */
export function drawSupermarketPlan(
  ctx: CanvasRenderingContext2D,
  v: PlanView,
  indoor: number,
  size: number,
): void {
  const layers = supermarketLayers();
  if (!layers) return;
  const blit = (img: HTMLCanvasElement, g: { x0: number; z0: number; cell: number; w: number; h: number }) =>
    ctx.drawImage(img, v.sx(g.x0), v.sz(g.z0), g.w * g.cell * v.k, g.h * g.cell * v.k);
  // Smoothed, as the forest, and at the better filter: these are drawn SMALLER
  // than they are — outside, a half-metre cell is under a pixel — and a plain
  // bilinear shrink makes the grass islands shimmer as the map scrolls.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  blit(layers.outside, SM.outside);
  strokeEdges(ctx, v, layers.outsideEdges, size);
  if (indoor <= 0) return;
  ctx.globalAlpha = Math.min(1, indoor);
  blit(layers.floor, SM.floor);
  strokeEdges(ctx, v, layers.floorEdges, size);
  ctx.globalAlpha = 1;
}

import { FOREST_PLAN } from '../scene/environment/ForestPlan';
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
// `NewYorkPlan.ts` inside `MissionCityMap`. These are the other two, each read
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
//
// Both draw in world metres through the caller's `sx`/`sz`, north up, and
// neither knows anything about the mission's marks — those are the map's job.
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

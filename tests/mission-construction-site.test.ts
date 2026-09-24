import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../src/renderer/missions';
import { materialDelivery } from '../src/renderer/missions/materialDelivery';
import { nightInspection } from '../src/renderer/missions/nightInspection';
import { nightTracking } from '../src/renderer/missions/nightTracking';
import { LIGHT_TILT_DEG } from '../src/renderer/missions/DroneSpotlight';
import {
  boxDistance,
  deliveryCount,
  dropZoneOf,
  inspectionLit,
  maxPointsOf,
  rankFor,
  storeyAt,
  toMissionSpec,
  zoneGroundY,
} from '../src/renderer/missions/types';
import type { MissionResult, MissionZone } from '../src/renderer/missions/types';
import { objectiveFor, runContextOf, useMissionStore } from '../src/renderer/state/missionStore';
import { constructionSite } from '../src/renderer/plugins/environments/constructionSite';
import { forest } from '../src/renderer/plugins/environments/forest';
import { FOREST_PLAN } from '../src/renderer/scene/environment/ForestPlan';
import {
  SITE_STORE_AT,
  SITE_STORE_FRONT_Z,
  SITE_STORE_PAD_AT,
  SITE_STORE_SIZE,
} from '../src/renderer/missions/siteStore';
import {
  CABINS,
  CABIN_SIZE,
  COL_W,
  CORE,
  HALF_X,
  HALF_Z,
  INFILL,
  LEVELS,
  SKIPS,
  SKIP_SIZE,
  SLAB_T,
  STOREY,
  XS,
  ZS,
  levelY,
} from '../src/renderer/scene/environment/siteLayout';

// Missions 7 and 8 — the Construction Site.
//
// Nothing here flies the drone. What is tested is what a pilot cannot check by
// flying it once, and on this map that is mostly GEOMETRY: a delivery mark on
// a floor whose side is walled in, or an inspection hover whose target sits
// outside the lamp's cone, looks exactly like bad flying from the cockpit.
// Every position is held against the environment's own layout — the same
// seeded infill the map builds — rather than against a copy of it.

type V3 = [number, number, number];
type Box = { min: V3; max: V3 };

/** Every solid of the frame as an axis-aligned box: columns, slabs, the core,
 *  the infill. Slabs are taken as full plates (the core void ignored) — that
 *  only ever makes a clearance check stricter. */
function frameSolids(): Box[] {
  const out: Box[] = [];
  const h = COL_W / 2;
  for (let k = 0; k < LEVELS; k++) {
    for (const x of XS) {
      for (const z of ZS) {
        out.push({ min: [x - h, levelY(k), z - h], max: [x + h, levelY(k + 1) - SLAB_T, z + h] });
      }
    }
  }
  for (let k = 1; k <= LEVELS; k++) {
    // The roof was only poured over z 0..12.
    const z0 = k === LEVELS ? 0 : -HALF_Z;
    out.push({ min: [-HALF_X, levelY(k) - SLAB_T, z0], max: [HALF_X, levelY(k), HALF_Z] });
  }
  const top = levelY(LEVELS);
  out.push({ min: [CORE.x0, 0, CORE.z0 - 0.13], max: [CORE.x1, top, CORE.z0 + 0.13] });
  out.push({ min: [CORE.x0, 0, CORE.z1 - 0.13], max: [CORE.x1, top, CORE.z1 + 0.13] });
  out.push({ min: [CORE.x0 - 0.13, 0, CORE.z0], max: [CORE.x0 + 0.13, top, CORE.z1] });
  for (const w of INFILL) {
    const alongX = w.rot === 0;
    out.push({
      min: [alongX ? w.x - w.w / 2 : w.x - 0.1, w.y - w.h / 2, alongX ? w.z - 0.1 : w.z - w.w / 2],
      max: [alongX ? w.x + w.w / 2 : w.x + 0.1, w.y + w.h / 2, alongX ? w.z + 0.1 : w.z + w.w / 2],
    });
  }
  return out;
}

const SOLIDS = frameSolids();
const at = (x: number, y: number, z: number) => ({ x, y, z });

/** The nearest frame solid to a point, metres. */
function clearanceAt(x: number, y: number, z: number): number {
  let best = Infinity;
  for (const b of SOLIDS) best = Math.min(best, boxDistance(at(x, y, z), b));
  return best;
}

/** Whether the straight line between two points passes through a frame solid,
 *  ignoring the last `endSkip` metres — the target itself sits ON a solid. */
function lineBlocked(a: V3, b: V3, endSkip = 0.35): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const steps = Math.ceil(len / 0.05);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (len * (1 - t) < endSkip) break;
    const p = at(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
    if (SOLIDS.some((s) => boxDistance(p, s) === 0)) return true;
  }
  return false;
}

/** The middle of a zone's hover band, world y. */
const hoverY = (m: typeof nightInspection, z: MissionZone) =>
  zoneGroundY(m, z) + (z.band.min + z.band.max) / 2;

const result = (over: Partial<MissionResult> = {}): MissionResult => ({
  points: 0,
  maxPoints: 0,
  timeSec: 100,
  collisions: 0,
  delivered: true,
  landed: true,
  ...over,
});

describe('Missions 7 and 8 on the list', () => {
  it('come after Mission 6, in order, on the Construction Site', () => {
    const ids = MISSIONS.map((m) => m.id);
    expect(ids.indexOf(materialDelivery.id)).toBe(ids.indexOf(nightTracking.id) + 1);
    expect(ids.indexOf(nightInspection.id)).toBe(ids.indexOf(materialDelivery.id) + 1);
    expect(materialDelivery.order).toBe(7);
    expect(nightInspection.order).toBe(8);
    expect(materialDelivery.envId).toBe(constructionSite.id);
    expect(nightInspection.envId).toBe(constructionSite.id);
    expect(new Set(MISSIONS.map((m) => m.order)).size).toBe(MISSIONS.length);
  });

  it('register as a delivery and a search', () => {
    expect(toMissionSpec(materialDelivery).type).toBe('delivery');
    expect(toMissionSpec(nightInspection).type).toBe('search');
  });
});

describe('Mission 7 — Construction Material Delivery', () => {
  const m = materialDelivery;
  const drop = m.zones.drop;

  it('puts the package on Level 4, with a storey over it', () => {
    expect(zoneGroundY(m, drop)).toBeCloseTo(levelY(4));
    expect(drop.storey?.level).toBe(4);
    expect(drop.storey?.clear).toBeCloseTo(STOREY - SLAB_T);
    // The top of the band leaves more than a metre under the soffit above.
    expect((drop.storey?.clear ?? 0) - drop.band.max).toBeGreaterThan(1);
  });

  it('draws the mark in the middle of a bay, clear of every column', () => {
    for (const x of XS) {
      for (const z of ZS) {
        expect(Math.hypot(drop.at[0] - x, drop.at[1] - z)).toBeGreaterThan(drop.radius + 2);
      }
    }
    // Inside the frame, not on its edge.
    expect(Math.abs(drop.at[0])).toBeLessThan(HALF_X);
    expect(Math.abs(drop.at[1])).toBeLessThan(HALF_Z);
  });

  it('leaves the Level 4 south face open, so the bay can be flown into', () => {
    const level4 = INFILL.filter((w) => w.y > levelY(4) && w.y < levelY(5));
    // Nothing on the south face (z = +12) of Level 4 at all.
    expect(level4.filter((w) => w.rot === 0 && w.z === HALF_Z)).toEqual([]);
    // And the straight run in from outside the face to the mark is clear.
    const y = zoneGroundY(m, drop) + 1.2;
    expect(lineBlocked([drop.at[0], y, HALF_Z + 6], [drop.at[0], y, drop.at[1]], 0)).toBe(false);
  });

  it('carries a cement bag, collected from the site material store', () => {
    expect(m.cargo).toBe('cement');
    expect(m.zones.pickup.at).toEqual(SITE_STORE_PAD_AT);
    // The pad is in front of the store, clear of its face and of the pallet
    // by the door (which reaches about 2.3 m out).
    expect(SITE_STORE_PAD_AT[1] - SITE_STORE_FRONT_Z - m.zones.pickup.radius).toBeGreaterThan(2.5);
    // The store stands clear of the frame, the skips and the beam stack at x -34.
    const [sx, sz] = SITE_STORE_AT;
    const [w, , d] = SITE_STORE_SIZE;
    expect(sx + w / 2).toBeLessThan(-HALF_X - 3);
    expect(sx - w / 2 - -34).toBeGreaterThan(1.5);
    for (const [kx, kz] of SKIPS) {
      expect(Math.hypot(sx - kx, sz - kz)).toBeGreaterThan(w / 2 + SKIP_SIZE[0] / 2);
    }
    expect(d).toBeGreaterThan(0);
  });

  it('says the right floor: Level 2 is not Level 4', () => {
    const h = drop.storey?.height ?? STOREY;
    expect(storeyAt(levelY(4) + 1, 0, h)).toBe(4);
    expect(storeyAt(levelY(2) + 1, 0, h)).toBe(2);
    expect(storeyAt(0.3, 0, h)).toBe(0);
    // Resting on the Level 4 slab is on Level 4, not on Level 3.
    expect(storeyAt(levelY(4) - 0.05, 0, h)).toBe(4);
  });

  it('collects and lands outside the frame, off every skip and cabin', () => {
    for (const z of [m.zones.pickup, m.zones.base]) {
      expect(Math.abs(z.at[0]) > HALF_X + 3 || Math.abs(z.at[1]) > HALF_Z + 3).toBe(true);
      for (const [sx, sz] of SKIPS) {
        expect(Math.hypot(z.at[0] - sx, z.at[1] - sz)).toBeGreaterThan(SKIP_SIZE[0] / 2 + 2);
      }
      for (const [cx, cz] of CABINS) {
        expect(Math.hypot(z.at[0] - cx, z.at[1] - cz)).toBeGreaterThan(CABIN_SIZE[0] / 2 + 2);
      }
    }
    // Home is the map's own launch pad.
    expect(m.zones.base.at).toEqual([
      constructionSite.spawn.position[0],
      constructionSite.spawn.position[2],
    ]);
  });

  it('scores the delivery and the landing, and says so in the brief’s words', () => {
    expect(maxPointsOf(m)).toBe(2);
    expect(m.resultRows).toEqual([
      'Package collected',
      'Correct floor reached',
      'Package delivered',
      'Returned to base',
      'Safe landing',
    ]);
    expect(m.wording?.attached).toBe('PACKAGE ATTACHED ✓');
    expect(m.wording?.delivered).toBe('PACKAGE DELIVERED ✓');
    expect(m.radio.delivered.text).toBe('Material delivery confirmed.');
    expect(m.radio.home.text).toBe('Return to the launch area.');
    expect(rankFor(m.ranks, result({ timeSec: 120 }))).toBe(3);
    expect(rankFor(m.ranks, result({ collisions: 1 }))).toBe(2);
    expect(rankFor(m.ranks, result({ collisions: 4 }))).toBe(1);
  });
});

describe('Mission 8 — Night Shift Inspection', () => {
  const m = nightInspection;
  const insp = m.inspection!;
  const tilt = (LIGHT_TILT_DEG * Math.PI) / 180;

  it('is flown at night, from the site office, with three zones and a landing', () => {
    expect(m.hour).toBe('night');
    expect(insp.points.map((p) => p.name)).toEqual(['Zone 1', 'Zone 2', 'Zone 3']);
    expect(insp.holdSec).toBe(5);
    expect(deliveryCount(m)).toBe(3);
    expect(maxPointsOf(m)).toBe(4);
    // Launches from, and lands at, the same pad.
    expect(m.spawn).toBeDefined();
    expect(m.zones.base.at).toEqual([m.spawn!.position[0], m.spawn!.position[2]]);
    // No route: no rings anywhere.
    expect(m.route).toEqual([]);
  });

  it('puts the office pad beside the cabins, not in them', () => {
    const [px, pz] = m.zones.base.at;
    for (const [cx, cz] of CABINS) {
      const dx = Math.abs(px - cx) - CABIN_SIZE[0] / 2;
      const dz = Math.abs(pz - cz) - CABIN_SIZE[2] / 2;
      expect(Math.max(dx, dz)).toBeGreaterThan(3);
    }
    expect(Math.abs(px) > HALF_X + 6).toBe(true);
  });

  it('points the runtime at each zone in turn', () => {
    insp.points.forEach((p, i) => {
      expect(dropZoneOf(m, i)).toBe(p.zone);
      expect(runContextOf(m, i)).toEqual({ name: p.name, to: p.label, index: i, total: 3 });
    });
    // Clamped past the end rather than running off it.
    expect(dropZoneOf(m, 9)).toBe(insp.points[2].zone);
  });

  for (const p of nightInspection.inspection!.points) {
    describe(p.name, () => {
      const z = p.zone;
      const y = hoverY(m, z);
      const hover: V3 = [z.at[0], y, z.at[1]];

      it('sits the target inside the beam for a pilot facing it', () => {
        // The lamp at the hover, aimed along the heading to the target and
        // leaned down by the lamp's own tilt — exactly what `DroneSpotlight`
        // does on a level hover.
        const dx = p.target[0] - hover[0];
        const dz = p.target[2] - hover[2];
        const flat = Math.hypot(dx, dz);
        const axis = at(
          (dx / flat) * Math.sin(tilt),
          -Math.cos(tilt),
          (dz / flat) * Math.sin(tilt),
        );
        const to = at(dx, p.target[1] - y, dz);
        expect(inspectionLit(insp, to, axis)).toBe(true);
        // And with margin: not on the cone's edge, where a breath of pitch
        // loses it.
        const below = (Math.atan2(y - p.target[1], flat) * 180) / Math.PI;
        expect(Math.abs(below - (90 - LIGHT_TILT_DEG))).toBeLessThan(insp.coneDeg / 2);
        // Facing AWAY, it is not lit.
        const away = at(-axis.x, axis.y, -axis.z);
        expect(inspectionLit(insp, to, away)).toBe(false);
      });

      it('has a clear line of sight from the hover to the target', () => {
        expect(lineBlocked(hover, p.target)).toBe(false);
      });

      it('keeps the whole hover volume clear of the structure and the frame', () => {
        // Clear of the inspected structure by the rule, from anywhere in the
        // hover circle.
        expect(boxDistance(at(...hover), p.structure)).toBeGreaterThan(
          insp.minClearance + z.radius,
        );
        // And of everything else, top and bottom of the band, with room for
        // the airframe's own half-span.
        for (const hy of [zoneGroundY(m, z) + z.band.min, zoneGroundY(m, z) + z.band.max]) {
          expect(clearanceAt(hover[0], hy, hover[2])).toBeGreaterThan(0.5);
        }
      });

      it('fits under the ceiling, and inside its storey where it has one', () => {
        expect(zoneGroundY(m, z) + z.band.max).toBeLessThan((m.ceiling ?? 30) - 2);
        if (z.storey) {
          expect(z.band.max).toBeLessThan(z.storey.clear - 0.6);
          expect(zoneGroundY(m, z)).toBeCloseTo(levelY(z.storey.level));
        }
      });

      it('is within the light’s reach', () => {
        const d = Math.hypot(p.target[0] - hover[0], p.target[1] - y, p.target[2] - hover[2]);
        expect(d).toBeLessThan(insp.lightRange - 2);
      });
    });
  }

  it('opens on the way to Zone 1, carrying nothing', () => {
    useMissionStore.getState().start(m);
    const s = useMissionStore.getState();
    expect(s.leg).toBe('carrying');
    expect(s.runIndex).toBe(0);
    expect(s.maxPoints).toBe(4);
    useMissionStore.getState().exit();
  });

  it('talks about zones, not packages', () => {
    const run = runContextOf(m, 1);
    expect(objectiveFor('carrying', 'inspection', run)).toContain('Zone 2');
    expect(objectiveFor('toDrop', 'inspection', run)).toMatch(/spotlight/i);
    expect(objectiveFor('delivered', 'inspection', run)).toMatch(/site office/i);
    expect(m.resultRows).toEqual([
      'Zone 1 inspected',
      'Zone 2 inspected',
      'Zone 3 inspected',
      'Returned to base',
      'Safe landing',
    ]);
  });
});

describe('the shared geometry helpers', () => {
  it('boxDistance is zero inside and Euclidean outside', () => {
    const b: Box = { min: [0, 0, 0], max: [1, 1, 1] };
    expect(boxDistance(at(0.5, 0.5, 0.5), b)).toBe(0);
    expect(boxDistance(at(2, 0.5, 0.5), b)).toBeCloseTo(1);
    expect(boxDistance(at(4, 5, 0.5), b)).toBeCloseTo(5);
  });

  it('inspectionLit needs the target in front, inside the cone and in reach', () => {
    const insp = nightInspection.inspection!;
    const fwd = at(0, 0, -1);
    expect(inspectionLit(insp, at(0, 0, -5), fwd)).toBe(true);
    expect(inspectionLit(insp, at(0, 0, 5), fwd)).toBe(false);
    expect(inspectionLit(insp, at(5, 0, -5), fwd)).toBe(false);
    expect(inspectionLit(insp, at(0, 0, -(insp.lightRange + 1)), fwd)).toBe(false);
  });
});

describe('the forest plan the mission map draws', () => {
  // Generated off the GLB by scripts/generate-forest-plan.mjs. Decoded here the
  // way `planLayers.ts` decodes it, so a regeneration that breaks the format —
  // or produces a plan with no road or no canopy on it — fails here instead of
  // drawing a blank disc in the corner of three missions.
  const bytes = Buffer.from(FOREST_PLAN.data, 'base64');
  const cellAt = (x: number, z: number) => {
    const ix = Math.floor((x - FOREST_PLAN.x0) / FOREST_PLAN.cell);
    const iz = Math.floor((z - FOREST_PLAN.z0) / FOREST_PLAN.cell);
    const i = (iz * FOREST_PLAN.w + ix) * 2;
    return { kind: bytes[i] & 7, y: bytes[i + 1] / 2 + FOREST_PLAN.yFloor };
  };

  it('has two bytes for every cell, and covers the whole play area', () => {
    expect(bytes.length).toBe(FOREST_PLAN.w * FOREST_PLAN.h * 2);
    expect(FOREST_PLAN.x0).toBeLessThanOrEqual(forest.bounds.min[0]);
    expect(FOREST_PLAN.z0).toBeLessThanOrEqual(forest.bounds.min[2]);
    expect(FOREST_PLAN.x0 + FOREST_PLAN.w * FOREST_PLAN.cell).toBeGreaterThanOrEqual(
      forest.bounds.max[0],
    );
    expect(FOREST_PLAN.z0 + FOREST_PLAN.h * FOREST_PLAN.cell).toBeGreaterThanOrEqual(
      forest.bounds.max[2],
    );
  });

  it('finds ground at the clearing the missions launch from, at its height', () => {
    const c = cellAt(forest.spawn.position[0], forest.spawn.position[2]);
    expect(c.kind).not.toBe(0);
    expect(Math.abs(c.y)).toBeLessThan(1.5);
  });

  it('has road, rock and canopy on it — a forest, not a green disc', () => {
    let road = 0;
    let rock = 0;
    let canopy = 0;
    for (let i = 0; i < bytes.length; i += 2) {
      if ((bytes[i] & 7) === 3) road++;
      if ((bytes[i] & 7) === 4) rock++;
      if (bytes[i] & FOREST_PLAN.canopyBit) canopy++;
    }
    const cells = FOREST_PLAN.w * FOREST_PLAN.h;
    expect(road / cells).toBeGreaterThan(0.02);
    expect(rock / cells).toBeGreaterThan(0.01);
    expect(canopy / cells).toBeGreaterThan(0.2);
  });
});

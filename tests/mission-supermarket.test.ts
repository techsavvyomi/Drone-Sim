import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MISSIONS } from '../src/renderer/missions';
import { supermarketDelivery } from '../src/renderer/missions/supermarketDelivery';
import { supermarketStockCheck } from '../src/renderer/missions/supermarketStockCheck';
import {
  allZonesOf,
  dropZoneOf,
  maxPointsOf,
  pickupZoneOf,
  toMissionSpec,
} from '../src/renderer/missions/types';
import { slotOffset, withYardRuns, yardSlots } from '../src/renderer/missions/yard';
import { YARD_BOXES, truckCargo } from '../src/renderer/missions/supermarketYard';
import { supermarket } from '../src/renderer/plugins/environments/supermarket';
import { MISSION_IDS } from '../src/renderer/services/catalog';
import {
  minAreaRect,
  type SupermarketColliderSet,
} from '../src/renderer/scene/environment/supermarketColliders';
import {
  ENTRANCE_H,
  LEFT_ENTRANCE_X,
  PALLET_H,
  RIGHT_ENTRANCE_X,
  STOCK_PILE,
  STORE_FRONT_Z,
  STORE_TRUSS_LOW,
  TRUCK_1_HOLD,
  TRUCK_1_LOAD_AT,
  WAREHOUSE_AT,
} from '../src/renderer/missions/supermarketSites';
import { objectiveFor, runContextOf, useMissionStore } from '../src/renderer/state/missionStore';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { DEFAULT_SETTINGS } from '../src/shared/types';
import { loadSupermarket, type SupermarketGeometry, type V3 } from './helpers/supermarketGeometry';

// Missions 9 and 10 on the Supermarket: Truck Loading and Truck Unloading.
//
// Two halves. The yard as DATA — the runs between the warehouse pallet and the
// pallet inside the truck, and where each box stands — tested without the map.
// Then every place the missions use, held to the map's PHYSICS: the tests run
// the same collider builder SupermarketEnv runs over supermarket.opt.glb and
// ray-cast against what it produces. A pallet that is not on the trailer
// floor, a trailer side that is not open, or a stock pile dropped onto a kerb,
// all fail.

const LOAD = supermarketDelivery;
const UNLOAD = supermarketStockCheck;
const BOTH = [LOAD, UNLOAD] as const;

describe('Missions 9 and 10: wiring', () => {
  it('are registered, in order, on the Supermarket, as a load and an unload', () => {
    const ids = MISSIONS.map((m) => m.id);
    expect(ids.indexOf('supermarket-delivery')).toBe(8);
    expect(ids.indexOf('supermarket-stock-check')).toBe(9);
    for (const m of BOTH) {
      expect(m.envId).toBe(supermarket.id);
      expect(m.cargo).toBe('parcel');
      expect(m.kind).toBe('delivery');
      expect(toMissionSpec(m).type).toBe('delivery');
      expect(m.deliveries).toHaveLength(YARD_BOXES);
    }
    expect(LOAD.name).toBe('Truck Loading');
    expect(UNLOAD.name).toBe('Truck Unloading');
    expect(LOAD.yard?.mode).toBe('load');
    expect(UNLOAD.yard?.mode).toBe('unload');
  });

  it('score out of the same number the catalog and the medals say: five boxes and the landing', () => {
    for (const m of BOTH) {
      expect(maxPointsOf(m)).toBe(6);
      expect(m.medals.gold).toBe(6);
    }
    expect(MISSION_IDS['supermarket-delivery']).toBe('MISSION-009');
    expect(MISSION_IDS['supermarket-stock-check']).toBe('MISSION-010');
  });

  it('launch from the map spawn, and every zone is inside the play area', () => {
    const { min, max } = supermarket.bounds;
    for (const m of BOTH) {
      expect(m.zones.base.at).toEqual([
        supermarket.spawn.position[0],
        supermarket.spawn.position[2],
      ]);
      for (const z of allZonesOf(m)) {
        expect(z.at[0]).toBeGreaterThan(min[0]);
        expect(z.at[0]).toBeLessThan(max[0]);
        expect(z.at[1]).toBeGreaterThan(min[2]);
        expect(z.at[1]).toBeLessThan(max[2]);
      }
    }
  });

  it("load every box from the store's pallet into the one truck", () => {
    const yard = LOAD.yard!;
    LOAD.deliveries!.forEach((_, i) => {
      expect(pickupZoneOf(LOAD, i)).toBe(yard.warehouse);
      expect(dropZoneOf(LOAD, i)).toBe(yard.truck.bay);
    });
    expect(yard.warehouse.kind).toBe('pickup');
    expect(yard.truck.bay.kind).toBe('drop');
  });

  it("unload every box from inside the truck onto the store's pallet", () => {
    const yard = UNLOAD.yard!;
    UNLOAD.deliveries!.forEach((_, i) => {
      expect(pickupZoneOf(UNLOAD, i)).toBe(yard.truck.bay);
      expect(dropZoneOf(UNLOAD, i)).toBe(yard.warehouse);
    });
    expect(yard.warehouse.kind).toBe('drop');
    expect(yard.truck.bay.kind).toBe('pickup');
  });

  it('open on the first box: zones.pickup and zones.drop are its own marks', () => {
    for (const m of BOTH) {
      expect(m.zones.pickup).toBe(pickupZoneOf(m, 0));
      expect(m.zones.drop).toBe(dropZoneOf(m, 0));
    }
  });

  it("the truck's pallet is on the trailer floor, inside the hold", () => {
    for (const m of BOTH) {
      const { bay, hold } = m.yard!.truck;
      expect(bay.at).toEqual(TRUCK_1_LOAD_AT);
      expect(bay.groundY).toBeCloseTo(hold.min[1] + PALLET_H, 6);
      // The pallet and its ring lie inside the hold's footprint.
      expect(bay.at[0] - bay.radius).toBeGreaterThan(hold.min[0]);
      expect(bay.at[0] + bay.radius).toBeLessThan(hold.max[0]);
      expect(bay.at[1] - bay.radius).toBeGreaterThan(hold.min[2]);
      expect(bay.at[1] + bay.radius).toBeLessThan(hold.max[2]);
      // And the hover band stops well under the trailer roof.
      expect(bay.groundY! + bay.band.max).toBeLessThanOrEqual(hold.max[1] - 0.8 + 1e-6);
      expect(bay.band.max).toBeGreaterThan(1.2);
    }
  });

  it('judge every pallet from its top, with the ring on the floor round it', () => {
    for (const m of BOTH) {
      const yard = m.yard!;
      expect(yard.warehouse.groundY).toBe(PALLET_H);
      for (const z of [yard.warehouse, yard.truck.bay]) {
        // The ring sits 3 cm over whatever the pallet stands on.
        expect(z.groundY! + z.ringLift!).toBeCloseTo(z.groundY! - PALLET_H + 0.03, 6);
        // The pallet fits inside its ring.
        expect(z.radius).toBeGreaterThan(Math.hypot(0.6, 0.5));
        expect(z.band.max).toBeLessThanOrEqual(3);
      }
    }
  });

  it('put a box down from half a metre up, clear of the boxes already on the pallet', () => {
    // Two layers of the largest cargo (0.24 m) stand 0.48 m on the pallet.
    expect(LOAD.yard!.truck.bay.band.min).toBeGreaterThanOrEqual(0.48);
    expect(UNLOAD.yard!.warehouse.band.min).toBeGreaterThanOrEqual(0.48);
  });
});

describe('the yard runs', () => {
  it('write the runs, the first marks and the counting lines', () => {
    for (const m of BOTH) {
      const runs = m.deliveries!;
      expect(runs.map((d) => d.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
      // Every run's lines are there, and the back line is never written for the last box.
      for (let i = 1; i <= 5; i++) {
        expect(m.radio[`pickup-b${i}`]).toBeDefined();
        expect(m.radio[`delivered-b${i}`]).toBeDefined();
      }
      expect(m.radio['back-b4']).toBeDefined();
      expect(m.radio['back-b5']).toBeUndefined();
      expect(m.radio['delivered-b5'].text).not.toContain('to go');
      expect(m.radio['delivered-b4'].text).toContain('One to go');
      // The story is one truck, loaded through its side: no truck is numbered.
      for (const line of Object.values(m.radio)) expect(line.text).not.toMatch(/Truck \d/);
      expect(m.radio.start.text).toMatch(/truck/i);
    }
    expect(LOAD.radio['pickup-b1'].text).toMatch(/side/);
    expect(LOAD.radio.start.text).toMatch(/right entrance/);
    expect(UNLOAD.radio.start.text).toMatch(/inside/);
    expect(UNLOAD.radio['pickup-b1'].text).toMatch(/right entrance/);
    // The lines that do not count boxes are the mission file's own, untouched.
    expect(withYardRuns(LOAD).radio.home).toBe(LOAD.radio.home);
  });

  it('stack the boxes so the one flown first is on top, and never two in one place', () => {
    for (const m of BOTH) {
      const { from, to } = yardSlots(m);
      expect(new Set(from).size).toBe(5);
      expect(new Set(to).size).toBe(5);
      // The first box to go is the highest one in the stack it waits in.
      for (let i = 0; i < 5; i++) {
        for (let j = i + 1; j < 5; j++) {
          expect(slotOffset(from[i])[1]).toBeGreaterThanOrEqual(slotOffset(from[j])[1]);
          expect(from[i]).toBeGreaterThan(from[j]);
        }
      }
    }
  });

  it('keep every stacked box on its pallet', () => {
    // Slots are in box sizes; at the largest cargo (0.24 m) the outer edge of a
    // corner box must stay on a 1.2 x 1.0 pallet.
    for (let s = 0; s < 5; s++) {
      const [x, , z] = slotOffset(s);
      expect(Math.abs(x) * 0.24 + 0.12).toBeLessThanOrEqual(0.6);
      expect(Math.abs(z) * 0.24 + 0.12).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("the truck's own load", () => {
  it('stands in the truck on both missions, and the job is still the five boxes', () => {
    for (const m of BOTH) {
      expect(truckCargo(m.yard!).length).toBeGreaterThan(0);
      expect(m.deliveries).toHaveLength(YARD_BOXES);
    }
    // The same load either way: the bay is the pallet's, whichever way the boxes go.
    expect(truckCargo(LOAD.yard!)).toEqual(truckCargo(UNLOAD.yard!));
  });

  it('fills the trailer, inside its walls, and leaves the bay to the pallet clear', () => {
    const { hold, bay } = UNLOAD.yard!.truck;
    const cargo = truckCargo(UNLOAD.yard!);
    let length = 0;
    for (const b of cargo) {
      for (let k = 0; k < 3; k++) {
        expect(b.min[k]).toBeGreaterThanOrEqual(hold.min[k]);
        expect(b.max[k]).toBeLessThanOrEqual(hold.max[k]);
        expect(b.max[k]).toBeGreaterThan(b.min[k]);
      }
      // A metre of roof over it.
      expect(hold.max[1] - b.max[1]).toBeGreaterThanOrEqual(1);
      // Nowhere near the pallet's ring: a clear bay, the trailer's full depth.
      const off = Math.max(b.min[0] - bay.at[0], bay.at[0] - b.max[0]);
      expect(off).toBeGreaterThanOrEqual(bay.radius + 0.5);
      length += b.max[0] - b.min[0];
    }
    // Most of the trailer's length is load.
    expect(length / (hold.max[0] - hold.min[0])).toBeGreaterThan(0.6);
  });
});

describe('Missions 9 and 10: the store', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
    useMissionStore.getState().exit();
  });

  it('flies the mission as written: nothing is drawn when the attempt arms', () => {
    for (const base of BOTH) {
      useMissionStore.getState().start(base);
      expect(useMissionStore.getState().mission).toBe(base);
      useMissionStore.getState().beginFlight();
      expect(useMissionStore.getState().mission).toBe(base);
      useMissionStore.getState().restart();
      expect(useMissionStore.getState().mission).toBe(base);
      expect(useMissionStore.getState().runIndex).toBe(0);
    }
  });

  it('tells the pilot the box and the truck in the objective line', () => {
    expect(objectiveFor('toPickup', 'delivery', runContextOf(LOAD, 0))).toBe(
      'Fly into the store and collect Box 1 from the stock pallet.',
    );
    expect(objectiveFor('toPickup', 'delivery', runContextOf(LOAD, 1))).toBe(
      'Back into the store for Box 2.',
    );
    expect(objectiveFor('carrying', 'delivery', runContextOf(LOAD, 2))).toBe(
      'Fly Box 3 into the truck.',
    );
    expect(objectiveFor('toDrop', 'delivery', runContextOf(LOAD, 2))).toBe(
      'Hold steady over the pallet inside the truck.',
    );
    expect(objectiveFor('toPickup', 'delivery', runContextOf(UNLOAD, 0))).toBe(
      'Fly into the truck and collect Box 1.',
    );
    expect(objectiveFor('toPickup', 'delivery', runContextOf(UNLOAD, 1))).toBe(
      'Back into the truck for Box 2.',
    );
    expect(objectiveFor('carrying', 'delivery', runContextOf(UNLOAD, 1))).toBe(
      'Take Box 2 into the store, to the stock pallet.',
    );
  });
});

let geo: SupermarketGeometry;
let set: SupermarketColliderSet;

beforeAll(async () => {
  geo = await loadSupermarket();
  set = geo.set;
}, 60_000);

const ray = (o: V3, d: V3, max?: number) => geo.ray(o, d, max);
const clearance = (at: readonly [number, number], y0?: number) => geo.clearance(at, y0);
const heightAt = (x: number, z: number, from?: number) => geo.heightAt(x, z, from);

describe('the Supermarket colliders', () => {
  it('fit a turned rectangle exactly', () => {
    // A 4 x 1 rectangle centred on (2, -3), turned 30° about +Y.
    const yaw = Math.PI / 6;
    const pts: number[] = [];
    for (const [x, z] of [
      [-2, -0.5],
      [2, -0.5],
      [2, 0.5],
      [-2, 0.5],
    ]) {
      pts.push(
        2 + x * Math.cos(yaw) + z * Math.sin(yaw),
        -3 - x * Math.sin(yaw) + z * Math.cos(yaw),
      );
    }
    const r = minAreaRect(pts);
    expect(r.cx).toBeCloseTo(2, 6);
    expect(r.cz).toBeCloseTo(-3, 6);
    expect(Math.max(r.w, r.d)).toBeCloseTo(4, 6);
    expect(Math.min(r.w, r.d)).toBeCloseTo(1, 6);
    expect(r.w * r.d).toBeCloseTo(4, 6);
  });

  it('turn most of the store into boxes, and the ground into one face', () => {
    // It was one 96k-triangle trimesh. The shell that is left is the building
    // shells and the parts with holes in them.
    expect(set.boxes.length).toBeGreaterThan(1000);
    expect(set.shell.length / 9).toBeLessThan(40_000);
    expect(set.groundTris).toBeGreaterThan(5000);
  });
});

describe('the Supermarket: against the model', () => {
  it('both entrances have a clear gap at drone height, and a solid frame either side', () => {
    for (const [lo, hi] of [LEFT_ENTRANCE_X, RIGHT_ENTRANCE_X]) {
      const mid = (lo + hi) / 2;
      // Through the middle of the gap, from the car park into the store.
      for (const h of [0.8, 1.5, ENTRANCE_H - 0.2]) {
        expect(ray([mid, h, STORE_FRONT_Z + 5], [0, 0, -1], 20)).toBeGreaterThan(9);
      }
      // A quarter metre outside the gap either side is the doors or the wall.
      for (const x of [lo - 0.25, hi + 0.25]) {
        expect(ray([x, 1.5, STORE_FRONT_Z + 5], [0, 0, -1], 20)).toBeLessThan(6);
      }
      // And the glass panel over the gap is solid, just above the stated height.
      expect(ray([mid, ENTRANCE_H + 0.2, STORE_FRONT_Z + 5], [0, 0, -1], 20)).toBeLessThan(6);
    }
  });

  it('the spawn is clear car park', () => {
    const at: [number, number] = [supermarket.spawn.position[0], supermarket.spawn.position[2]];
    expect(heightAt(...at)).toBeCloseTo(0, 2);
    // The nearest thing is a parking sign 6 m away, at (-35.9, 21.9).
    expect(clearance(at)).toBeGreaterThan(5.5);
  });

  it("the truck's hold is as measured: floor, roof, far wall, and the open side", () => {
    const { min, max } = TRUCK_1_HOLD;
    const [px, pz] = TRUCK_1_LOAD_AT;
    // Floor and roof underside, over the pallet and a metre either way along
    // the trailer.
    for (const x of [px - 1, px, px + 1]) {
      expect(3 - ray([x, 3, pz], [0, -1, 0], 10)).toBeCloseTo(min[1], 1);
      expect(3 + ray([x, 3, pz], [0, 1, 0], 10)).toBeCloseTo(max[1], 1);
    }
    // The far wall, from the pallet.
    expect(pz - ray([px, 2.5, pz], [0, 0, -1], 10)).toBeCloseTo(min[2], 1);
    // The ends: the front wall and the inside of the rear doors.
    expect(px - ray([px, 2.5, pz], [-1, 0, 0], 20)).toBeCloseTo(min[0], 1);
    expect(px + ray([px, 2.5, pz], [1, 0, 0], 20)).toBeCloseTo(max[0], 1);
    // The open side: from the car park, a drone at any hover height over the
    // pallet flies straight in and meets nothing before the far wall — across
    // the whole width of the pallet's ring, and at the floor there is no lip.
    for (const x of [px - 1.2, px - 0.6, px, px + 0.6, px + 1.2]) {
      for (const y of [min[1] + 0.2, 2.1, 2.7, 3.4]) {
        const hit = 20 - ray([x, y, 20], [0, 0, -1], 30);
        expect(hit, `from the car park at x ${x}, y ${y}`).toBeLessThan(min[2] + 0.1);
      }
    }
    // Over the open edge the roof is still there: the drone goes in UNDER it.
    expect(heightAt(px, max[2] - 0.2)).toBeCloseTo(4.47, 1);
    // And beyond the edge is open tarmac to come down onto or climb from.
    expect(heightAt(px, max[2] + 1)).toBeLessThan(0.05);
    expect(clearance([px, max[2] + 2])).toBeGreaterThan(1.5);
  });

  it("nothing stands between the pallet in the truck and the roof over it", () => {
    const { bay } = LOAD.yard!.truck;
    const [px, pz] = bay.at;
    for (const [dx, dz] of [
      [0, 0],
      [-0.6, -0.5],
      [0.6, -0.5],
      [-0.6, 0.5],
      [0.6, 0.5],
    ]) {
      const up = ray([px + dx, bay.groundY! + 0.05, pz + dz], [0, 1, 0], 10);
      expect(bay.groundY! + 0.05 + up).toBeCloseTo(TRUCK_1_HOLD.max[1], 1);
    }
    // Sideways from the pallet, the first solid thing is the far wall.
    for (const y of [bay.groundY! + 0.3, bay.groundY! + bay.band.max]) {
      let near = Infinity;
      for (let i = 0; i < 24; i++) {
        const a = (i * Math.PI) / 12;
        near = Math.min(near, ray([px, y, pz], [Math.cos(a), 0, Math.sin(a)], 20));
      }
      expect(near).toBeGreaterThan(1.6);
    }
  });

  it("the store's stock pallet is on clear floor by the self-checkouts, under the roof", () => {
    const at = WAREHOUSE_AT;
    // Measured from under the roof: from above, the store is its roof.
    expect(heightAt(at[0], at[1], 3)).toBeCloseTo(0, 2);
    // Three metres of floor round it at hover heights, and the roof well up.
    expect(clearance(at)).toBeGreaterThan(3);
    expect(geo.ceilingAt(at[0], at[1])).toBeGreaterThan(STORE_TRUSS_LOW);
    // The band is capped under the trusses.
    const z = LOAD.yard!.warehouse;
    expect(z.groundY! + z.band.max).toBeLessThanOrEqual(STORE_TRUSS_LOW - 0.8 + 1e-6);
  });

  it('the stock pile behind it stands on the floor, clear of the fixtures and the pallet', () => {
    const { min, max } = STOCK_PILE;
    for (let x = min[0] - 0.3; x <= max[0] + 0.3; x += 0.25) {
      for (let z = min[2] - 0.2; z <= max[2] + 0.2; z += 0.25) {
        expect(heightAt(x, z, 3), `at ${x}, ${z}`).toBeLessThan(0.05);
      }
    }
    // Behind the pallet's ring, not on it.
    expect(WAREHOUSE_AT[1] - LOAD.yard!.warehouse.radius - max[2]).toBeGreaterThan(0.2);
  });

  it('the way in from the right entrance to the pallet is clear at flying height', () => {
    const mid = (RIGHT_ENTRANCE_X[0] + RIGHT_ENTRANCE_X[1]) / 2;
    const a: [number, number] = [mid, STORE_FRONT_Z - 0.3];
    const b = WAREHOUSE_AT;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d: V3 = [(b[0] - a[0]) / len, 0, (b[1] - a[1]) / len];
    // Straight along the line, at the heights the rule asks for.
    for (const y of [1.6, 2.0, ENTRANCE_H - 0.1]) {
      expect(ray([a[0], y, a[1]], d, len + 1), `at ${y} m`).toBeGreaterThan(len - 1.2);
    }
    // And the pilot is told why: lower down a checkout is in the way.
    expect(ray([a[0], 1.0, a[1]], d, len + 1)).toBeLessThan(len);
    for (const m of BOTH) expect((m.rules ?? []).join(' ')).toMatch(/checkout/);
  });

  it('door to truck can be flown straight across at cruise height', () => {
    // From outside the right entrance to over the tarmac outside the truck's
    // open side, at 6 m: the trucks are the tallest things and stand 4.51 m.
    const mid = (RIGHT_ENTRANCE_X[0] + RIGHT_ENTRANCE_X[1]) / 2;
    const a: [number, number] = [mid, STORE_FRONT_Z + 2];
    const b: [number, number] = [TRUCK_1_LOAD_AT[0], TRUCK_1_HOLD.max[2] + 1.5];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s <= len; s += 0.5) {
      const x = a[0] + ((b[0] - a[0]) * s) / len;
      const z = a[1] + ((b[1] - a[1]) * s) / len;
      expect(heightAt(x, z, 30)).toBeLessThan(5);
    }
  });

  it('the launch pad has a clear line to the truck and to the right entrance at cruise height', () => {
    const a: [number, number] = [supermarket.spawn.position[0], supermarket.spawn.position[2]];
    const mid = (RIGHT_ENTRANCE_X[0] + RIGHT_ENTRANCE_X[1]) / 2;
    for (const b of [TRUCK_1_LOAD_AT, [mid, STORE_FRONT_Z + 2] as const]) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= len; s += 0.5) {
        const x = a[0] + ((b[0] - a[0]) * s) / len;
        const zz = a[1] + ((b[1] - a[1]) * s) / len;
        expect(heightAt(x, zz, 30)).toBeLessThan(5);
      }
    }
  });
});

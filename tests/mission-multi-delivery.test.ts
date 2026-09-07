import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { multiPointDelivery } from '../src/renderer/missions/multiPointDelivery';
import { precisionDelivery } from '../src/renderer/missions/precisionDelivery';
import { forestFire } from '../src/renderer/missions/forestFire';
import { MISSIONS } from '../src/renderer/missions';
import {
  allZonesOf,
  deliveryCount,
  deliveryOf,
  dropZoneOf,
  flatDist,
  maxPointsOf,
  rankFor,
  requiredCheckpoints,
  toMissionSpec,
  zoneGroundY,
} from '../src/renderer/missions/types';
import type { MissionResult, MissionZone } from '../src/renderer/missions/types';
import {
  activeZone,
  isMissionUnlocked,
  legOf,
  objectiveFor,
  runContextOf,
  useMissionStore,
} from '../src/renderer/state/missionStore';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { DEFAULT_SETTINGS } from '../src/shared/types';

// Multi-Point Delivery: the run order, the scoring, and the two rooftops.
//
// Nothing here flies the drone — the runtime needs a canvas and a physics world.
// What is tested is everything that decides whether a flight counted, plus the
// one thing this mission added to the model: an index that walks a list of
// packages and cannot be talked into skipping one.

const M = multiPointDelivery;

/** The Guru's ceiling, and the height the controller starts fading the climb
 *  rate at. Every mission is flown on the Guru — see `MissionViewport`. */
const CEILING = 30;
const CEILING_FADE = CEILING - 2;

function result(over: Partial<MissionResult> = {}): MissionResult {
  return {
    points: maxPointsOf(M),
    maxPoints: maxPointsOf(M),
    timeSec: 300,
    collisions: 0,
    delivered: true,
    landed: true,
    ...over,
  };
}

describe('the shape of the mission', () => {
  it('TC-245 is three packages, in a fixed order, with no rings', () => {
    expect(deliveryCount(M)).toBe(3);
    expect(M.deliveries?.map((d) => d.id)).toEqual(['a', 'b', 'c']);
    // No route at all. The difficulty is the workflow, so there is nothing to
    // gate the release on — and a mission whose `requiredCheckpoints` grew would
    // silently start refusing to hand a package over.
    expect(M.route).toHaveLength(0);
    expect(requiredCheckpoints(M)).toHaveLength(0);
  });

  it('TC-245 scores one point per delivery plus the landing', () => {
    expect(maxPointsOf(M)).toBe(4);
    expect(M.medals.gold).toBe(maxPointsOf(M));
    // The mission does NOT end at the drop: the aircraft has to come home.
    expect(M.endsAtDrop).toBeUndefined();
  });

  it('TC-245 leaves the single-drop missions scoring exactly as they were', () => {
    // `maxPointsOf` was rewritten around the delivery count. A mission with no
    // list has a count of one, and both existing missions have to be untouched
    // by that — this is the regression the rewrite could have caused.
    expect(deliveryCount(precisionDelivery)).toBe(1);
    expect(maxPointsOf(precisionDelivery)).toBe(precisionDelivery.route.length + 2);
    expect(deliveryCount(forestFire)).toBe(1);
    expect(maxPointsOf(forestFire)).toBe(forestFire.route.length + 1);
  });

  it('TC-245 is the third mission, and it is a delivery to the registry', () => {
    expect(M.order).toBe(3);
    expect(MISSIONS[2].id).toBe(M.id);
    expect(toMissionSpec(M).type).toBe('delivery');
    expect(toMissionSpec(M).medalThresholds).toEqual(M.medals);
  });

  it('TC-245 is locked until Forest Fire is done', () => {
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
    expect(isMissionUnlocked(MISSIONS, M.id)).toBe(false);
    useSettingsStore.setState((s) => ({
      settings: {
        ...s.settings,
        missions: {
          missions: {
            'forest-fire': { completed: true, stars: 1, bestPoints: 6, bestTimeSec: 100 },
          },
        },
      },
    }));
    expect(isMissionUnlocked(MISSIONS, M.id)).toBe(true);
  });
});

describe('the hub and the three destinations', () => {
  it('TC-246 puts the pickup and the pad on one mark', () => {
    // The brief's logistics centre is where the packages are AND where the drone
    // lands. Two marks on one pad would put two rings on the same square metre.
    expect(M.zones.pickup.at).toEqual(M.zones.base.at);
    // ...and they are still two different tests: the pickup is a tight box you
    // descend onto, the pad is a circle you land in.
    expect(M.zones.pickup.radius).toBeLessThan(M.zones.base.radius);
    expect(M.zones.pickup.band.max).toBeLessThan(M.zones.base.band.max);
  });

  it('TC-246 keeps the hub clear of the spawn point', () => {
    // The hub is somewhere the pilot GOES. It sat three metres from New York's
    // spawn to begin with, which opened the mission with the drone armed in the
    // middle of three parcels, standing on the mark, with the radar's P under
    // its own aircraft — the first objective already met and nothing to fly to.
    // The spawn belongs to the environment and the mission cannot move it, so
    // this is the mission's side of the bargain.
    expect(flatDist({ x: 0, z: 26 }, M.zones.pickup.at)).toBeGreaterThan(12);
    // ...and still inside the mission area, so the first leg is a hop rather
    // than a crossing.
    expect(flatDist({ x: 0, z: 26 }, M.zones.pickup.at)).toBeLessThan(45);
  });

  it('TC-246 makes the first entry the mission-level drop zone', () => {
    // The same object, not a copy. Anything still reading `zones.drop` without
    // asking which run is live has to get the opening destination rather than a
    // duplicate that can drift from it.
    expect(M.zones.drop).toBe(M.deliveries?.[0].zone);
    expect(dropZoneOf(M, 0)).toBe(M.zones.drop);
  });

  it('TC-246 declares a deck on EVERY destination, not only the roofs', () => {
    // The bug this pins: only the roofs declared one, on the reasoning that a
    // street mark sits on the map's own ground. Bay A does not — it stands on a
    // sidewalk plate 0.12 m up, which is exactly half the height of the package
    // — so the first box delivered there was placed at y = 0 and buried to its
    // waist in the pavement, with the release band 12 cm low over a kerb.
    //
    // A mark declares the surface it is ON, measured off the colliders. The
    // route check (TC-250) is what measures it; this is what stops the field
    // being quietly dropped again.
    const decks = M.deliveries!.map((d) => d.zone.groundY);
    for (const deck of decks) expect(deck).toBeTypeOf('number');
    expect(decks[0]).toBeGreaterThan(0);
    expect(decks[1]).toBeGreaterThan(20);
    expect(decks[2]).toBeGreaterThan(20);
    // The deck a zone declares is what the height band is measured from, so a
    // rooftop that forgot it would put the hover inside the building.
    for (const d of M.deliveries!) {
      expect(zoneGroundY(M, d.zone)).toBe(d.zone.groundY ?? M.groundY);
    }
  });

  it('TC-246 keeps every rooftop hold under the aircraft ceiling', () => {
    // The one way this mission could ship impossible. A band whose top is above
    // the Guru's ceiling is a delivery the pilot can hold a perfect hover under
    // and never trigger, with nothing on screen able to say why.
    for (const d of M.deliveries!) {
      const top = zoneGroundY(M, d.zone) + d.zone.band.max;
      expect(top).toBeLessThanOrEqual(CEILING_FADE);
    }
  });

  it('TC-246 ramps the destinations: street, roof, tighter roof', () => {
    const [a, b, c] = M.deliveries!.map((d) => d.zone);
    // A is on the street and nearest; both roofs are further out than it.
    const range = (zone: MissionZone) =>
      flatDist({ x: M.zones.pickup.at[0], z: M.zones.pickup.at[1] }, zone.at);
    // Range ramps all the way: street bay, then the near roof, then the far one.
    // It only does so because the hub moved off the spawn — from the old pad the
    // two roofs sat within two metres of the same range.
    expect(range(a)).toBeLessThan(range(b));
    expect(range(b)).toBeLessThan(range(c));
    // ...and so does the approach: C is higher and smaller than B, so the last
    // delivery is the hardest as well as the furthest.
    expect(zoneGroundY(M, c)).toBeGreaterThan(zoneGroundY(M, b));
    expect(c.radius).toBeLessThan(b.radius);
    expect(c.band.max).toBeLessThan(b.band.max);
  });

  it('TC-246 lists every mark, including the ones `zones` has no room for', () => {
    // `zones` is a record of three kinds. This mission has five marks, and the
    // package that has to settle onto a roof reads them through here.
    expect(allZonesOf(M)).toHaveLength(5);
    expect(allZonesOf(M)).toContain(M.deliveries![2].zone);
    expect(allZonesOf(precisionDelivery)).toHaveLength(3);
  });

  it('TC-246 keeps the mission area big enough to contain every mark', () => {
    for (const zone of allZonesOf(M)) {
      expect(flatDist({ x: M.zones.base.at[0], z: M.zones.base.at[1] }, zone.at)).toBeLessThan(
        M.strayRadius!,
      );
    }
  });
});

describe('the run index', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
    useMissionStore.getState().exit();
    useMissionStore.getState().start(M);
    useMissionStore.getState().beginFlight();
  });

  it('TC-247 opens on package A, with nothing delivered', () => {
    const s = useMissionStore.getState();
    expect(s.runIndex).toBe(0);
    expect(s.deliveredCount).toBe(0);
    expect(s.payload).toBe('waiting');
    expect(deliveryOf(M, s.runIndex)?.name).toBe('Package A');
  });

  it('TC-247 answers only for the live package, never for the others', () => {
    // This IS the brief's "cannot deliver B to C". The mark being tested is a
    // function of the index, so while the index says A there is nothing
    // anywhere testing C's roof.
    expect(dropZoneOf(M, 0).label).toBe('Bay A');
    expect(dropZoneOf(M, 1).label).toBe('Rooftop B');
    expect(dropZoneOf(M, 2).label).toBe('Rooftop C');
  });

  it('TC-247 advances one at a time and scores one point each', () => {
    const store = useMissionStore;
    store.getState().takeDelivery('DELIVERY A');
    store.getState().advanceRun();
    expect(store.getState().runIndex).toBe(1);
    expect(store.getState().deliveredCount).toBe(1);
    expect(store.getState().points).toBe(1);

    store.getState().takeDelivery('DELIVERY B');
    store.getState().advanceRun();
    store.getState().takeDelivery('DELIVERY C');
    expect(store.getState().runIndex).toBe(2);
    expect(store.getState().deliveredCount).toBe(3);
    expect(store.getState().points).toBe(3);
    // The fourth point is the landing, and it is not a delivery.
    store.getState().takeZone('base', 'SAFE LANDING');
    expect(store.getState().points).toBe(maxPointsOf(M));
  });

  it('TC-247 clamps rather than running off the end of the list', () => {
    // The index is advanced on the frame the LAST package lands, and the flight
    // home is flown with it one past the end. The answer for the rest of that
    // flight should be the mark it was just put on, not a crash.
    expect(dropZoneOf(M, 9)).toBe(M.deliveries![2].zone);
    expect(deliveryOf(M, 9)?.id).toBe('c');
    expect(deliveryOf(M, -3)?.id).toBe('a');
  });

  it('TC-247 re-arms the pickup for the next package', () => {
    const store = useMissionStore;
    // The pickup is visited once per package. `zonesTaken` remembers one flag
    // per KIND, so without clearing it the second collection is dead on arrival.
    store.getState().takeZone('pickup', 'PICKUP', false);
    expect(store.getState().zonesTaken.pickup).toBe(true);
    expect(store.getState().points).toBe(0);
    store.getState().rearmPickup();
    expect(store.getState().zonesTaken.pickup).toBeUndefined();
  });

  it('TC-247 puts every package back on the pad on a restart', () => {
    const store = useMissionStore;
    store.getState().takeDelivery('DELIVERY A');
    store.getState().advanceRun();
    store.getState().setPayload('attached');
    store.getState().restart();
    const s = store.getState();
    expect(s.runIndex).toBe(0);
    expect(s.deliveredCount).toBe(0);
    expect(s.points).toBe(0);
    expect(s.payload).toBe('waiting');
    expect(s.leg).toBe('toPickup');
  });
});

describe('what the pilot is told', () => {
  it('TC-248 names the package on the way out and on the way back', () => {
    const first = runContextOf(M, 0)!;
    const second = runContextOf(M, 1)!;
    // The FIRST visit to the hub is a collection; the second is a return. Same
    // leg, and it must not read as if nothing has happened since.
    expect(objectiveFor('toPickup', 'delivery', first)).toContain('Collect Package A');
    expect(objectiveFor('toPickup', 'delivery', second)).toContain('Return');
    expect(objectiveFor('toPickup', 'delivery', second)).toContain('Package B');
    expect(objectiveFor('carrying', 'delivery', second)).toContain('Rooftop B');
    expect(objectiveFor('toDrop', 'delivery', runContextOf(M, 2)!)).toContain('Rooftop C');
  });

  it('TC-248 leaves the single-delivery wording exactly as it was', () => {
    expect(runContextOf(precisionDelivery, 0)).toBeNull();
    expect(objectiveFor('toPickup')).toBe('Fly to the pickup location.');
    expect(objectiveFor('toPickup', 'suppression')).toBe('Collect the firefighting payload.');
    expect(objectiveFor('carrying', 'delivery')).toBe(
      'Deliver the payload to the marked location.',
    );
    expect(objectiveFor('delivered')).toBe('Return to base.');
  });

  it('TC-248 has a Mission Control line for every beat of every run', () => {
    for (const d of M.deliveries!) {
      expect(M.radio[`pickup-${d.id}`]).toBeDefined();
      expect(M.radio[`delivered-${d.id}`]).toBeDefined();
    }
    // The two returns to the hub, and nothing after the last one — package C is
    // followed by the flight home, not by another collection.
    expect(M.radio['back-a']).toBeDefined();
    expect(M.radio['back-b']).toBeDefined();
    expect(M.radio['back-c']).toBeUndefined();
    for (const key of ['start', 'home', 'landing', 'complete']) {
      expect(M.radio[key]).toBeDefined();
    }
    // Every line's store key is unique, or one of them silently swallows
    // another: `playRadio` refuses a key it has already played.
    const ids = Object.values(M.radio).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('TC-248 sends the pilot to the live destination on every leg', () => {
    // The pickup and the pad are the same mark here, so the leg-to-zone map is
    // the thing that decides which of the two tests is running.
    expect(activeZone('toPickup')).toBe('pickup');
    expect(activeZone('carrying')).toBe('drop');
    expect(activeZone('toDrop')).toBe('drop');
    expect(activeZone('delivered')).toBe('base');
    expect(activeZone('landing')).toBe('base');
    // With no route there is never a ring to be sent to instead of the mark.
    expect(legOf('carrying')).toBe('toDrop');
    expect(M.route.filter((c) => c.leg === 'toDrop')).toHaveLength(0);
  });

  it('TC-248 briefs the job in four beats and four objectives', () => {
    expect(M.flow).toHaveLength(4);
    expect(M.objectives).toHaveLength(4);
    // Each objective names something the pilot will actually see on screen.
    const text = M.objectives.join(' ');
    for (const d of M.deliveries!) {
      expect(text).toContain(d.name);
      expect(text).toContain(d.zone.label);
    }
  });
});

describe('the rating', () => {
  it('TC-249 needs all three delivered and the drone home for a star at all', () => {
    expect(rankFor(M.ranks, result({ delivered: false }))).toBe(1);
    expect(rankFor(M.ranks, result({ landed: false }))).toBe(1);
    expect(rankFor(M.ranks, result())).toBe(3);
  });

  it('TC-249 takes the top star off for a crash or a slow flight', () => {
    expect(rankFor(M.ranks, result({ collisions: 1 }))).toBe(2);
    expect(rankFor(M.ranks, result({ timeSec: M.parTimeSec + 1 }))).toBe(2);
    expect(rankFor(M.ranks, result({ collisions: 2 }))).toBe(1);
  });

  it('TC-249 quotes the same numbers the rungs test', () => {
    expect(M.ranks[0].text).toContain('7:00');
    expect(M.parTimeSec).toBe(420);
    expect(M.timeLimitSec).toBeGreaterThan(M.parTimeSec);
  });
});

describe('the coordinates', () => {
  it('TC-250 clears every mark and every corridor in New York City', () => {
    // The numbers in this mission are positions in a city, and nothing about
    // reading them says whether a drone can get there. The script measures them
    // against the generated colliders and exits non-zero if anything is tight —
    // including whether each rooftop's declared deck is the deck that is
    // actually there.
    const out = execFileSync('node', ['scripts/check-multi-delivery-route.mjs'], {
      encoding: 'utf8',
    });
    expect(out).toContain('All clear.');
    expect(out).not.toContain('TIGHT');
  }, 60_000);
});

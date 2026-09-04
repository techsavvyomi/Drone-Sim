import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { forestFire } from '../src/renderer/missions/forestFire';
import { precisionDelivery } from '../src/renderer/missions/precisionDelivery';
import { MISSIONS } from '../src/renderer/missions';
import {
  flatDist,
  maxPointsOf,
  nextCheckpointOf,
  rankFor,
  requiredCheckpoints,
  toMissionSpec,
  zoneGroundY,
} from '../src/renderer/missions/types';
import type { MissionResult } from '../src/renderer/missions/types';
import { objectiveFor, useMissionStore } from '../src/renderer/state/missionStore';
import { getDrone, getEnvironment } from '../src/renderer/plugins/registry';
import { loadBuiltinPlugins } from '../src/renderer/plugins';

// Forest Fire Emergency: what makes it a DIFFERENT mission from the delivery,
// and what has to stay the same.
//
// The two share a runtime, so most of the state machine is already covered by
// mission-delivery.test.ts and is not re-tested here. What is tested here is
// every place the second mission bends the first one's assumptions — optional
// rings, a suppression hold that survives being interrupted, and a zone whose
// ground is twelve metres below the mission's own.

const M = forestFire;

loadBuiltinPlugins();

function result(over: Partial<MissionResult> = {}): MissionResult {
  return {
    points: maxPointsOf(M),
    maxPoints: maxPointsOf(M),
    timeSec: 200,
    collisions: 0,
    delivered: true,
    landed: true,
    ...over,
  };
}

describe('the mission as content', () => {
  it('TC-237 is the second mission, on the forest, and is registered as a rescue', () => {
    expect(M.order).toBe(2);
    expect(M.envId).toBe('forest');
    expect(M.kind).toBe('suppression');
    // The registry is the app's content index. A mission only reachable through
    // its own module is a mission the rest of the engine cannot be told about.
    expect(toMissionSpec(M).type).toBe('rescue');
    expect(toMissionSpec(precisionDelivery).type).toBe('delivery');
  });

  it('TC-237 sits in the list behind Precision Delivery', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual(['precision-delivery', 'forest-fire']);
    expect(MISSIONS.map((m) => m.order)).toEqual([1, 2]);
  });

  it('TC-237 scores one point per ring, plus the fire and the landing', () => {
    expect(M.route).toHaveLength(5);
    expect(maxPointsOf(M)).toBe(7);
    // Three stars needs every one of them, so the gold threshold and the points
    // available cannot drift apart.
    expect(M.medals.gold).toBe(maxPointsOf(M));
  });

  it('TC-237 carries a Mission Control line for every beat the runtime plays', () => {
    // `spraying` and `half` are this mission's own: the delivery has no line for
    // either, because it has nothing that takes ten seconds.
    for (const key of [
      'start',
      'pickup',
      'far',
      'near',
      'approach',
      'spraying',
      'half',
      'delivered',
      'home',
      'landing',
      'complete',
    ]) {
      expect(M.radio[key]?.text ?? '').not.toBe('');
    }
  });
});

describe('the rings, which gate nothing', () => {
  it('TC-238 makes every ring optional, so the forest is never a corridor', () => {
    // The whole difference from the city. A required ring is a corridor whatever
    // it is called, and this mission's brief is that the pilot picks their own
    // way through the trees.
    expect(M.route.every((c) => c.required === false)).toBe(true);
    expect(requiredCheckpoints(M)).toHaveLength(0);
    // Which means the tank opens over the fire whether or not a single ring was
    // taken — the thing the delivery's gate exists to prevent.
    expect(requiredCheckpoints(M).length).toBe(0);
  });

  it('TC-238 still lights the next ring, or nothing would guide the crossing', () => {
    const atBase = { x: M.zones.base.at[0], z: M.zones.base.at[1] };
    expect(nextCheckpointOf(M, 'toDrop', {}, atBase)?.label).toBe('F1');
    expect(nextCheckpointOf(M, 'toDrop', { [M.route[0].id]: true }, atBase)?.label).toBe('F2');
  });

  it('TC-238 drops an optional ring the drone has flown past', () => {
    // A pilot who takes their own line through the trees must not be sent back
    // to a ring behind them for the rest of the mission. "Past" is measured
    // against the fire: a ring further from the fire than the drone is, is
    // behind it.
    const fire = M.zones.drop.at;
    const f1 = { x: M.route[0].at[0], z: M.route[0].at[2] };

    // Three quarters of the way there, F1 is long behind and the guidance has
    // moved on to the last ring.
    const wellOut = { x: 80, z: -30 };
    expect(flatDist(wellOut, fire)).toBeLessThan(flatDist(f1, fire));
    expect(nextCheckpointOf(M, 'toDrop', {}, wellOut)?.label).toBe('F5');

    // On the fire's doorstep every ring is behind, and the caller falls back to
    // the mark itself.
    const arriving = { x: 70, z: -52 };
    expect(nextCheckpointOf(M, 'toDrop', {}, arriving)).toBeNull();
  });

  it('TC-238 keeps a REQUIRED ring lit however far past it the drone is', () => {
    // The other mission's rings have to be taken, so pointing at one behind the
    // drone is the correct answer rather than a bug.
    const past = { x: precisionDelivery.zones.drop.at[0], z: precisionDelivery.zones.drop.at[1] };
    expect(nextCheckpointOf(precisionDelivery, 'toDrop', {}, past)?.label).toBe('B1');
  });
});

describe('the fire', () => {
  it('TC-239 takes a ten second hold, not a touch', () => {
    expect(M.fire?.suppressSec).toBe(10);
    // And the zone's own `hold` is not a second number saying the same thing.
    expect(M.zones.drop.hold).toBe(0);
  });

  it('TC-239 lets the drone drift further than the mark before it counts as leaving', () => {
    // Losing the hold is a pause and a warning. A break radius at the mark's own
    // edge would throw a pilot correcting a hover back onto the navigation leg.
    expect(M.fire!.breakRadius).toBeGreaterThan(M.zones.drop.radius);
    expect(M.fire!.breakRadius).toBeGreaterThan(M.fire!.burnRadius);
  });

  it('TC-239 puts the hover zone inside the burning ground', () => {
    expect(M.zones.drop.radius).toBeLessThan(M.fire!.burnRadius);
  });

  it('TC-239 holds the drone above the flames rather than in them', () => {
    expect(M.zones.drop.band.min).toBeGreaterThanOrEqual(5);
    expect(M.zones.drop.band.max - M.zones.drop.band.min).toBeGreaterThanOrEqual(4);
  });
});

describe('the ground under each mark', () => {
  it('TC-240 judges the fire against its own deck, not the clearing', () => {
    // The forest map ships with NO `groundY` in its spec: it has no single
    // ground height. The clearing is at zero and the fire burns 12.5 m below it.
    expect(zoneGroundY(M, M.zones.drop)).toBe(-12.5);
    expect(zoneGroundY(M, M.zones.pickup)).toBe(0);
    expect(zoneGroundY(M, M.zones.base)).toBe(0);
    // Which is the point of the field existing at all: the two decks differ by
    // more than the whole hover band is deep.
    const drop = zoneGroundY(M, M.zones.drop);
    const base = zoneGroundY(M, M.zones.base);
    expect(Math.abs(base - drop)).toBeGreaterThan(M.zones.drop.band.max);
  });

  it('TC-240 leaves a flat map alone', () => {
    for (const kind of ['pickup', 'drop', 'base'] as const) {
      expect(zoneGroundY(precisionDelivery, precisionDelivery.zones[kind])).toBe(
        precisionDelivery.groundY,
      );
    }
  });
});

describe('the objective line', () => {
  it('TC-237 says fire, not delivery, on the legs that differ', () => {
    expect(objectiveFor('toPickup', 'suppression')).toMatch(/firefighting payload/i);
    expect(objectiveFor('carrying', 'suppression')).toMatch(/suppress the fire/i);
    expect(objectiveFor('toDrop', 'suppression')).toMatch(/hold your position/i);
    // And the legs that do not differ are word for word the delivery's: coming
    // home and landing are the same job whatever was carried.
    for (const leg of ['delivered', 'returning', 'landing', 'complete'] as const) {
      expect(objectiveFor(leg, 'suppression')).toBe(objectiveFor(leg, 'delivery'));
    }
  });
});

describe('the fire state in the store', () => {
  beforeEach(() => {
    useMissionStore.getState().exit();
  });

  it('TC-239 opens every attempt on a fire burning at full', () => {
    useMissionStore.getState().start(M);
    expect(useMissionStore.getState().fireIntensity).toBe(1);
    expect(useMissionStore.getState().suppressing).toBe(false);
  });

  it('TC-239 puts a half-suppressed fire back to full on a restart', () => {
    const store = useMissionStore.getState();
    store.start(M);
    store.beginFlight();
    store.setFire({ fireIntensity: 0.4, suppressing: true });
    expect(useMissionStore.getState().fireIntensity).toBe(0.4);

    useMissionStore.getState().restart();
    expect(useMissionStore.getState().fireIntensity).toBe(1);
    expect(useMissionStore.getState().suppressing).toBe(false);
  });
});

describe('the rating', () => {
  it('TC-237 needs the fire out AND the drone home for a single star', () => {
    expect(rankFor(M.ranks, result({ delivered: false }))).toBe(1);
    expect(rankFor(M.ranks, result())).toBe(3);
    expect(rankFor(M.ranks, result({ collisions: 1 }))).toBe(2);
    expect(rankFor(M.ranks, result({ timeSec: M.timeLimitSec - 1 }))).toBe(2);
    expect(rankFor(M.ranks, result({ points: 2 }))).toBe(1);
  });

  it('TC-237 leaves time to climb over the canopy and come back', () => {
    expect(M.parTimeSec).toBeLessThan(M.timeLimitSec);
    expect(M.timeLimitSec).toBeGreaterThanOrEqual(360);
  });
});

describe('the coordinates', () => {
  it('TC-240 keeps every ring, mark and corridor clear of the trees', () => {
    // The script is the authority, not this test: it reads the GLB's terrain and
    // the generated trunk boxes and checks the mission's own numbers against
    // them. Running it here is what stops a coordinate being edited without it.
    const out = execFileSync('node', ['scripts/check-forest-route.mjs'], { encoding: 'utf8' });
    expect(out).toContain('OK —');
  }, 120_000);

  it('TC-240 keeps every ring under the aircraft the mission is flown on', () => {
    // The Guru's soft ceiling is 30 m, enforced in the flight controller. An
    // over-canopy route would be clear air and completely unflyable, and this is
    // the test that stops one being drawn: a ring the mission's own aircraft
    // cannot climb to is a point nobody can score.
    const ceiling = getDrone('pluto-guru')?.maxAltitude ?? 0;
    expect(ceiling).toBeGreaterThan(0);
    for (const c of M.route) expect(c.at[1]).toBeLessThan(ceiling);
    expect(M.routeAltitude).toBeLessThan(ceiling);
  });

  it('TC-240 puts the fire a real crossing away from the base', () => {
    const out = flatDist({ x: M.zones.base.at[0], z: M.zones.base.at[1] }, M.zones.drop.at);
    expect(out).toBeGreaterThan(80);
    // And the tank where the pilot can get to it without crossing anything.
    const toTank = flatDist({ x: M.zones.base.at[0], z: M.zones.base.at[1] }, M.zones.pickup.at);
    expect(toTank).toBeLessThan(35);
  });
});

// The briefing card is shared by every mission, so what it needs is checked
// across MISSIONS rather than against this one. A mission added without a story
// or with three objectives instead of four does not fail to compile — it renders
// a card with a hole in it, which is the kind of thing nobody sees until a pilot
// does.
describe('what the briefing card needs from a mission', () => {
  for (const m of MISSIONS) {
    it(`TC-241 ${m.id} carries a story, four beats and four objectives`, () => {
      expect(m.story.length).toBeGreaterThan(60);
      expect(m.flow).toHaveLength(4);
      expect(m.objectives).toHaveLength(m.flow.length);
      expect(m.difficulty).not.toBe('');
      expect(m.mapNote).not.toBe('');
      // Every beat names a scene the card knows how to draw. A key it does not
      // know renders an empty box.
      const drawable = ['collect', 'city', 'forest', 'deliver', 'suppress', 'land'];
      for (const step of m.flow) expect(drawable).toContain(step.art);
      // And every objective is a sentence rather than a label.
      for (const line of m.objectives) expect(line).toMatch(/\.$/);
    });

    it(`TC-241 ${m.id} is flown on a registered map`, () => {
      // The card names the map from its own spec, so an unregistered envId puts
      // a raw id under the hero image.
      expect(getEnvironment(m.envId)?.name).toBeTruthy();
    });
  }
});

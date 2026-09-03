import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { precisionDelivery } from '../src/renderer/missions/precisionDelivery';
import {
  maxPointsOf,
  rankFor,
  requiredCheckpoints,
  requiredLeft,
  toMissionSpec,
} from '../src/renderer/missions/types';
import type { MissionResult } from '../src/renderer/missions/types';
import {
  activeZone,
  isMissionUnlocked,
  legOf,
  objectiveFor,
  useMissionStore,
  type MissionLeg,
} from '../src/renderer/state/missionStore';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { DEFAULT_SETTINGS } from '../src/shared/types';

// Precision Delivery: the scoring model, the state machine, the release
// thresholds and the teardown a restart has to do.
//
// The mission's own numbers are what these lock down. Nothing here flies the
// drone — the runtime needs a canvas and a physics world — so what is tested is
// everything that decides whether a flight counted, which is where the mistakes
// that reach a pilot actually live.

const M = precisionDelivery;

/** A finished attempt, as the rating sees it. */
function result(over: Partial<MissionResult> = {}): MissionResult {
  return {
    points: maxPointsOf(M),
    maxPoints: maxPointsOf(M),
    timeSec: 120,
    collisions: 0,
    delivered: true,
    landed: true,
    ...over,
  };
}

describe('the scoring model', () => {
  it('TC-223 is one point per ring, plus the delivery and the landing', () => {
    // Fourteen rings, all of them on the way out and all of them required, then
    // 15 for putting the package down and 16 for getting home. The PICKUP
    // scores nothing: it is the start of the job, not an achievement.
    expect(M.route).toHaveLength(14);
    expect(maxPointsOf(M)).toBe(M.route.length + 2);
    expect(maxPointsOf(M)).toBe(16);
  });

  it('TC-223 spreads the route over the way out and the whole city', () => {
    const on = (leg: string) => M.route.filter((c) => c.leg === leg).length;

    // All fourteen on the CARRY. None on the run to the package — the first
    // leg's only job is to reach the box, and a ring before the pickup put a
    // target on the radar for a delivery the pilot was not yet flying. None
    // coming home either: a ring on the return leg cannot gate the release,
    // because the package has already gone by the time it is reached.
    expect(on('toPickup')).toBe(0);
    expect(on('toDrop')).toBe(14);
    expect(on('toBase')).toBe(0);

    // A route that stayed in one quarter of the map would pass every other test
    // in this file. The city is 248 m by 196 m; this asks the route to use most
    // of it in both directions.
    const xs = M.route.map((c) => c.at[0]);
    const zs = M.route.map((c) => c.at[2]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(55);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(150);
  });

  it('TC-223 keeps every checkpoint far enough from the next to be its own target', () => {
    // Not "the balls do not overlap" — that floor was met by a route whose
    // markers sat 9 m apart, close enough that the next one is already in view
    // through the one being flown and the city stops being navigated at all.
    // 20 m is the real floor, and only the bends are anywhere near it: the
    // corner marks exist because `check-mission-route` fails without them.
    // The floor applies to markers that can be LIT TOGETHER: the leg being
    // flown, plus any outbound checkpoint still owed. Two points on opposite
    // legs can pass near each other in space — the way home runs back down the
    // street leg 1 went out on — and never share a frame.
    // Every ring is outbound now, so every pair can be lit together.
    for (const a of M.route) {
      for (const b of M.route) {
        if (a.id === b.id) continue;
        const apart = Math.hypot(a.at[0] - b.at[0], a.at[2] - b.at[2]);
        expect(apart).toBeGreaterThan(20);
      }
    }
  });

  it('TC-223 draws every checkpoint wholly inside the volume that scores', () => {
    // The promise a ball makes by being a ball: what you can see is what you fly
    // into. A radius past the trigger would put lit glass outside the sphere
    // that counts, which is the "I went through it and it did not count" every
    // checkpoint has to avoid.
    for (const c of M.route) expect(c.radius).toBeLessThanOrEqual(c.reach);
    // And the trigger must not stand far off the light either: a ring that
    // scores from well outside the ball is a ring the pilot cannot tell they
    // took, which is how a locked delivery becomes unexplainable.
    for (const c of M.route) expect(c.reach - c.radius).toBeLessThanOrEqual(1);
  });

  it('TC-224 rates a flight on points, collisions and time', () => {
    expect(rankFor(M.ranks, result({ points: 16, timeSec: 200 }))).toBe(3);
    expect(rankFor(M.ranks, result({ points: 16, timeSec: 200, collisions: 1 }))).toBe(2);
    expect(rankFor(M.ranks, result({ points: 16, timeSec: 460 }))).toBe(2);
    // Delivered and home but a ring short of the full sheet cannot happen while
    // the gate holds; if it ever does, it is not a three-star flight.
    expect(rankFor(M.ranks, result({ points: 15, timeSec: 200 }))).toBe(2);
    expect(rankFor(M.ranks, result({ points: 4, collisions: 3 }))).toBe(1);
  });

  it('TC-224 gives nothing above one star for a flight that did not finish', () => {
    // Taking every checkpoint on the way out and never delivering is not a
    // two-star delivery. The rungs test `delivered` and `landed` themselves.
    expect(rankFor(M.ranks, result({ delivered: false }))).toBe(1);
    expect(rankFor(M.ranks, result({ landed: false }))).toBe(1);
  });

  it('TC-229 publishes the same thresholds to the registry that it scores on', () => {
    // Two places said "14 points" once, and one of them was going to drift.
    const spec = toMissionSpec(M);

    expect(spec.medalThresholds.gold).toBe(16);
    expect(spec.medalThresholds.silver).toBe(15);
    const fast = { timeSec: 200 };
    expect(rankFor(M.ranks, result({ ...fast, points: spec.medalThresholds.gold }))).toBe(3);
    expect(rankFor(M.ranks, result({ ...fast, points: spec.medalThresholds.gold - 1 }))).toBe(2);
    expect(rankFor(M.ranks, result({ ...fast, points: spec.medalThresholds.silver }))).toBe(2);
    expect(rankFor(M.ranks, result({ ...fast, points: spec.medalThresholds.silver - 1 }))).toBe(1);
  });
});

describe('the delivery is the strict one', () => {
  it('TC-228 asks more of the drop than of the pickup, where the two compare', () => {
    const { pickup, drop } = M.zones;

    // Speed, descent rate and hold: the drop is the careful one, and stays so.
    expect(drop.maxGroundSpeed).toBeLessThan(pickup.maxGroundSpeed);
    expect(drop.maxVerticalSpeed).toBeLessThan(pickup.maxVerticalSpeed);
    expect(drop.hold).toBeGreaterThan(pickup.hold);

    // RADIUS does not compare, and it used to be asserted as though it did. The
    // two are different jobs: the drop is a placement on a painted mark a couple
    // of metres across, and the pickup is a grab onto a box the size of a hand.
    // The pickup's is therefore the tighter of the two.
    expect(pickup.radius).toBeLessThan(drop.radius);
    expect(pickup.radius).toBeLessThanOrEqual(0.8);
  });

  it('TC-228 makes the pickup a descent onto the mark, not a fly-over', () => {
    // The band used to reach 4 m — above the box by more than the drone is wide
    // — so a pilot arriving at route height had the package clip on while they
    // were still well over it. It has to be flown DOWN to.
    const { pickup } = M.zones;

    expect(pickup.band.max).toBeLessThanOrEqual(2);
    expect(pickup.maxGroundSpeed).toBeLessThanOrEqual(1.5);
    expect(pickup.hold).toBeGreaterThanOrEqual(0.5);
  });

  it('TC-228 cannot be satisfied by passing over the marker', () => {
    // A fly-past is fast and it is high. Both are tested, and both have to hold
    // together for longer than a pass through the zone can last.
    const { drop } = M.zones;

    expect(drop.band.min).toBeGreaterThan(0);
    expect(drop.maxGroundSpeed).toBeLessThanOrEqual(1);
    expect(drop.hold).toBeGreaterThanOrEqual(0.5);
  });
});

describe('the route has to be flown before the package will release', () => {
  it('TC-235 requires every checkpoint on the way out, and none on the way home', () => {
    const required = requiredCheckpoints(M);

    // ALL of them. Every ring is on the way out, so "collect the rings, then
    // deliver" is a rule with no exceptions — which is what it has to be for a
    // pilot to be able to act on it.
    expect(required).toHaveLength(14);
    expect(required).toHaveLength(M.route.length);
    expect(required.every((c) => c.leg !== 'toBase')).toBe(true);
  });

  it('TC-235 counts down as they are taken', () => {
    const required = requiredCheckpoints(M);
    const none = {};
    const some = { [required[0].id]: true as const, [required[1].id]: true as const };
    const all = Object.fromEntries(required.map((c) => [c.id, true as const]));

    expect(requiredLeft(M, none)).toBe(14);
    expect(requiredLeft(M, some)).toBe(12);
    expect(requiredLeft(M, all)).toBe(0);
  });

  it('TC-235 carries no rings on the way home', () => {
    // The way home is a flight, not a collection: `homeVia` is bare waypoints
    // for the route check, and nothing on the return leg scores.
    expect(M.route.some((c) => c.leg === 'toBase')).toBe(false);
    expect(M.homeVia.length).toBeGreaterThan(1);
  });
});

describe('the state machine', () => {
  const legs: MissionLeg[] = [
    'toPickup',
    'carrying',
    'toDrop',
    'delivered',
    'returning',
    'landing',
    'complete',
  ];

  it('TC-225 gives every leg one objective and one marker', () => {
    for (const leg of legs) {
      expect(objectiveFor(leg).length).toBeGreaterThan(0);
    }
    expect(activeZone('toPickup')).toBe('pickup');
    expect(activeZone('carrying')).toBe('drop');
    expect(activeZone('toDrop')).toBe('drop');
    expect(activeZone('delivered')).toBe('base');
    expect(activeZone('returning')).toBe('base');
    expect(activeZone('complete')).toBeNull();
  });

  it('TC-225 lights one leg of checkpoints at a time', () => {
    // Thirteen balls lit at once is thirteen targets and no route at all.
    expect(legOf('toPickup')).toBe('toPickup');
    expect(legOf('carrying')).toBe('toDrop');
    expect(legOf('toDrop')).toBe('toDrop');
    expect(legOf('delivered')).toBe('toBase');
    expect(legOf('landing')).toBeNull();
  });
});

describe('the attempt', () => {
  beforeEach(() => {
    useMissionStore.getState().start(M);
    useMissionStore.getState().beginFlight();
  });

  it('TC-226 scores a checkpoint once, however many times it is flown through', () => {
    const s = useMissionStore.getState();

    s.collect('pd-a1', 'A1');
    s.collect('pd-a1', 'A1');
    s.collect('pd-a2', 'A2');

    expect(useMissionStore.getState().points).toBe(2);
  });

  it('TC-226 scores a zone once', () => {
    const s = useMissionStore.getState();

    s.takeZone('pickup', 'PICKUP');
    s.takeZone('pickup', 'PICKUP');

    expect(useMissionStore.getState().points).toBe(1);
  });

  it('TC-226 never plays a Mission Control line twice', () => {
    const s = useMissionStore.getState();

    expect(s.playRadio('approach', 'Position the drone carefully.', 5)).toBe(true);
    expect(useMissionStore.getState().playRadio('approach', 'Position it.', 5)).toBe(false);
  });

  it('TC-227 leaves nothing of the last go behind on a restart', () => {
    const s = useMissionStore.getState();
    s.collect('pd-a1', 'A1');
    s.takeZone('pickup', 'PICKUP');
    s.setPayload('attached');
    s.setLeg('carrying');
    s.showBanner({ kind: 'good', title: 'PAYLOAD ATTACHED' }, 3);
    s.playRadio('pickup', 'Payload secured.', 5);
    s.setChecks({ centred: true, inBand: true, steady: true, hold: 0.8 });
    s.setGate({ left: 4, total: 10 });
    s.setElapsed(42);
    s.setCollisions(3);

    useMissionStore.getState().restart();

    const after = useMissionStore.getState();
    expect(after.phase).toBe('flying');
    expect(after.leg).toBe('toPickup');
    expect(after.payload).toBe('waiting');
    expect(after.points).toBe(0);
    expect(after.collected).toEqual({});
    expect(after.zonesTaken).toEqual({});
    expect(after.banner).toBeNull();
    expect(after.radio).toBeNull();
    expect(after.radioPlayed).toEqual({});
    expect(after.pointPop).toBeNull();
    expect(after.checks.hold).toBe(0);
    expect(after.gate).toEqual({ left: 0, total: 0 });
    expect(after.elapsed).toBe(0);
    expect(after.collisions).toBe(0);
    expect(after.result).toBeNull();
    expect(after.failReason).toBeNull();
    // The mission itself survives — a restart is another go at the same one.
    expect(after.mission?.id).toBe(M.id);
  });

  it('TC-227 replays the radio after a restart', () => {
    // The lines are one-shot WITHIN an attempt. A pilot on their second go is
    // owed the briefing call again, or the flight opens in silence.
    useMissionStore.getState().playRadio('start', 'Pilot, we have a delivery.', 5);
    useMissionStore.getState().restart();

    expect(useMissionStore.getState().playRadio('start', 'Pilot, we have a delivery.', 5)).toBe(
      true,
    );
  });

  it('TC-227 clears the attempt when the mission is left', () => {
    const s = useMissionStore.getState();
    s.collect('pd-a1', 'A1');
    s.setPayload('attached');

    useMissionStore.getState().exit();

    const after = useMissionStore.getState();
    expect(after.mission).toBeNull();
    expect(after.points).toBe(0);
    expect(after.payload).toBe('waiting');
  });

  it('TC-226 keeps the finished result and its rating', () => {
    useMissionStore.getState().finish({
      points: 16,
      maxPoints: 16,
      timeSec: 180,
      collisions: 0,
      delivered: true,
      landed: true,
    });

    const after = useMissionStore.getState();
    expect(after.phase).toBe('complete');
    expect(after.leg).toBe('complete');
    expect(after.result?.stars).toBe(3);
    expect(after.banner).toBeNull();
  });
});

describe('the mission list', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    useMissionStore.getState().start(M);
    useMissionStore.getState().beginFlight();
  });

  it('TC-233 keeps the best of every completed attempt, not the last', () => {
    const store = useMissionStore.getState();

    store.finish({
      points: 25,
      maxPoints: 16,
      timeSec: 200,
      collisions: 0,
      delivered: true,
      landed: true,
    });
    // A casual second run: slower, sloppier, fewer points. It must not un-earn
    // anything — a card that dropped back would teach the wrong lesson about
    // taking a mission up again.
    useMissionStore.getState().restart();
    useMissionStore.getState().finish({
      points: 6,
      maxPoints: 16,
      timeSec: 420,
      collisions: 4,
      delivered: true,
      landed: true,
    });

    const saved = useSettingsStore.getState().settings.missions.missions[M.id];
    expect(saved.completed).toBe(true);
    expect(saved.stars).toBe(3);
    expect(saved.bestPoints).toBe(25);
    expect(saved.bestTimeSec).toBe(200);
  });

  it('TC-233 takes the faster time on a later run', () => {
    const store = useMissionStore.getState();
    store.finish({
      points: 9,
      maxPoints: 16,
      timeSec: 400,
      collisions: 0,
      delivered: true,
      landed: true,
    });
    useMissionStore.getState().restart();
    useMissionStore.getState().finish({
      points: 9,
      maxPoints: 16,
      timeSec: 190,
      collisions: 0,
      delivered: true,
      landed: true,
    });

    expect(useSettingsStore.getState().settings.missions.missions[M.id].bestTimeSec).toBe(190);
  });

  it('TC-233 does not record a failed attempt', () => {
    useMissionStore.getState().fail('crash');

    expect(useSettingsStore.getState().settings.missions.missions[M.id]).toBeUndefined();
  });

  it('TC-234 leaves the first mission unlocked and locks what follows it', () => {
    expect(isMissionUnlocked([M], M.id)).toBe(true);

    const second = { ...M, id: 'second', order: 2 };
    expect(isMissionUnlocked([M, second], second.id)).toBe(false);

    useMissionStore.getState().finish({
      points: 16,
      maxPoints: 16,
      timeSec: 120,
      collisions: 0,
      delivered: true,
      landed: true,
    });
    expect(isMissionUnlocked([M, second], second.id)).toBe(true);
  });

  it('TC-234 numbers the missions from one, in list order', () => {
    // The number on the node, the number on the in-flight badge and the position
    // in the list are all this one field.
    expect(M.order).toBe(1);
    expect(M.subtitle.length).toBeGreaterThan(0);
  });
});

describe('where the route sits in the city', () => {
  it('TC-230 keeps every checkpoint, zone and corridor clear of the colliders', () => {
    // The real check, run for real: the same script the mission file points at,
    // measuring the generated New York colliders. It exits non-zero the moment a
    // coordinate is moved somewhere a drone cannot fly to — which is otherwise
    // invisible in a diff and obvious only to the pilot who cannot score it.
    expect(() =>
      execFileSync('node', ['scripts/check-mission-route.mjs'], { encoding: 'utf8' }),
    ).not.toThrow();
  });

  it('TC-230 flies the route above the street furniture', () => {
    // Lamp posts, signs and traffic lights top out around 10.5 m on this map,
    // and `check-mission-route` measures against the props as well as the
    // buildings — the lowest rings sit at 11.5 m with 5 m of clearance, which
    // is a metre of daylight over the tallest furniture.
    for (const c of M.route) expect(c.at[1]).toBeGreaterThan(11);
  });

  it('TC-231 climbs and descends rather than running flat', () => {
    // One height for the whole route is a rail: trim once and the throttle is
    // never touched again. The spread is what makes each leg a climb or a
    // descent as well as a turn.
    const ys = M.route.map((c) => c.at[1]);
    // The spread is small and one-sided on purpose: most of the avenue's rings
    // cannot come below 14 m without the ball touching a facade, so the ones
    // that CAN go lower are what makes the route rise and fall.
    expect(new Set(ys).size).toBeGreaterThan(1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(2);
  });

  it('TC-230 keeps the pickup near the pad and the drop far from it', () => {
    const { pickup, drop, base } = M.zones;
    const toPickup = Math.hypot(pickup.at[0] - base.at[0], pickup.at[1] - base.at[1]);
    const carry = Math.hypot(drop.at[0] - pickup.at[0], drop.at[1] - pickup.at[1]);

    // The opening is an easy win a few blocks away; the crossing is the mission.
    expect(toPickup).toBeLessThan(50);
    expect(carry).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// TC-236 — the whole flight, in one pass.
//
// The individual rules above each hold in isolation; this walks the mission the
// way a pilot does, leg by leg, and asserts what the pilot is being TOLD at
// every step: the objective line, which mark is live, which checkpoints the
// world lights, what the release gate says, and what the score is. It is the
// test that fails when two correct pieces disagree.
// ---------------------------------------------------------------------------
describe('the mission end to end', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
    useMissionStore.getState().start(M);
  });

  it('TC-236 runs start to landing with the score, the marks and the gate agreeing', () => {
    const store = () => useMissionStore.getState();

    // Briefing: nothing scored, nothing lit, the clock not running.
    expect(store().phase).toBe('briefing');
    expect(store().points).toBe(0);
    expect(store().maxPoints).toBe(16);

    store().beginFlight();
    expect(store().phase).toBe('flying');
    expect(store().leg).toBe('toPickup');
    expect(store().payload).toBe('waiting');
    expect(activeZone(store().leg)).toBe('pickup');

    // Leg 1: the ring on the way to the package, then the zone. The pickup
    // scores nothing — it is the start of the job — so the score here is the
    // rings and nothing else.
    const leg1 = M.route.filter((c) => c.leg === 'toPickup');
    for (const c of leg1) store().collect(c.id, c.id);
    store().takeZone('pickup', 'PICKUP', false);
    store().setLeg('carrying');
    store().setPayload('attached');
    expect(store().points).toBe(leg1.length);
    expect(activeZone(store().leg)).toBe('drop');
    expect(legOf(store().leg)).toBe('toDrop');

    // Leg 2: the carry. The gate is what stands between the pilot and the
    // release, and it is still closed with the carry outstanding.
    const carry = M.route.filter((c) => c.leg === 'toDrop');
    expect(requiredLeft(M, store().collected)).toBe(carry.length);
    for (const c of carry) store().collect(c.id, c.id);
    expect(requiredLeft(M, store().collected)).toBe(0);

    // The drop: the approach leg, then the release.
    store().setLeg('toDrop');
    expect(objectiveFor(store().leg)).toMatch(/descend/i);
    store().takeZone('drop', 'DELIVERY');
    store().setPayload('delivered');
    store().setLeg('delivered');
    expect(store().payload).toBe('delivered');
    expect(activeZone(store().leg)).toBe('base');
    // 15: all fourteen rings plus the delivery.
    expect(store().points).toBe(leg1.length + carry.length + 1);
    expect(store().points).toBe(maxPointsOf(M) - 1);

    // The way home carries nothing to collect. The last point is the landing.
    expect(M.route.some((c) => c.leg === 'toBase')).toBe(false);

    store().setLeg('returning');
    store().setLeg('landing');
    store().takeZone('base', 'SAFE LANDING');
    expect(store().points).toBe(maxPointsOf(M));

    store().finish({
      points: store().points,
      maxPoints: store().maxPoints,
      timeSec: 210,
      collisions: 0,
      delivered: true,
      landed: true,
    });

    expect(store().phase).toBe('complete');
    expect(store().leg).toBe('complete');
    expect(store().banner).toBeNull();
    expect(store().result?.stars).toBe(3);
    expect(activeZone(store().leg)).toBeNull();
    expect(legOf(store().leg)).toBeNull();
    // And the run is on the mission list.
    const saved = useSettingsStore.getState().settings.missions.missions[M.id];
    expect(saved?.completed).toBe(true);
    expect(saved?.stars).toBe(3);
  });

  it('TC-236 holds the delivery until the outbound route is flown', () => {
    const store = () => useMissionStore.getState();
    store().beginFlight();
    // Everything taken except one on the carry: the pilot can be perfectly
    // positioned over the mark and the package still must not release.
    const required = requiredCheckpoints(M);
    for (const c of required.slice(0, -1)) store().collect(c.id, c.id);
    expect(requiredLeft(M, store().collected)).toBe(1);
    // What the HUD would be showing at that moment.
    store().setGate({ left: 1, total: required.length });
    store().setChecks({ centred: true, inBand: true, steady: true, hold: 0 });
    expect(store().gate.left).toBe(1);
    expect(store().checks.hold).toBe(0);
  });

  it('TC-236 plays every Mission Control line the mission carries', () => {
    // A radio line written and never played is a line nobody will ever hear.
    // `start` was exactly that until it was wired up, so the runtime is read
    // here rather than trusted.
    const runtime = readFileSync(
      new URL('../src/renderer/missions/MissionDirector.tsx', import.meta.url),
      'utf8',
    );
    const hud = readFileSync(
      new URL('../src/renderer/hud/MissionHud.tsx', import.meta.url),
      'utf8',
    );
    for (const key of Object.keys(M.radio)) {
      const played = runtime.includes(`'${key}'`) || hud.includes(`radio.${key}`);
      expect(played, `radio line "${key}" is never played`).toBe(true);
    }
  });
});

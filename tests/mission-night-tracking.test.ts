import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { nightTracking } from '../src/renderer/missions/nightTracking';
import { MISSIONS } from '../src/renderer/missions';
import { TIGER_ROUTES, routeLength, tigerAt } from '../src/renderer/missions/tigerRoutes';
import { forest } from '../src/renderer/plugins/environments/forest';
import { TIME_PRESETS } from '../src/renderer/state/worldStore';
import { maxPointsOf, rankFor, tigerRouteOf, toMissionSpec } from '../src/renderer/missions/types';
import type { MissionResult } from '../src/renderer/missions/types';
import {
  activeZone,
  guidanceHidden,
  legOf,
  objectiveFor,
  useMissionStore,
} from '../src/renderer/state/missionStore';
import { useSettingsStore } from '../src/renderer/state/settingsStore';
import { DEFAULT_SETTINGS } from '../src/shared/types';

// Mission 5 — Nightfall Predator Tracking.
//
// Nothing here flies the drone: the runtime needs a canvas and a physics world.
// What is tested is the half of the mission a pilot cannot check by flying it
// once, and on this mission that is most of it.
//
// Three things in particular, and each is a rule that fails SILENTLY when it
// breaks:
//
//   1. THE NO-GUIDANCE RULE, which Mission 4 established and this one extends —
//      it stays on through the lock as well as through the search, because the
//      target moves. A removal is exactly the thing a later change to a shared
//      component undoes with nothing failing.
//   2. THE GEOMETRY. The safe distance, the cone and the tracking ceiling have
//      to leave a band the pilot can actually fly in. Get them wrong and the
//      mission is unwinnable in a way that looks like bad flying.
//   3. THE WALK. `tigerAt` is the only piece of this mission with real
//      arithmetic in it, and every frame of the runtime is judged against what
//      it returns.

const M = nightTracking;

/** The Guru's own ceiling. Every mission is flown on the Guru — see
 *  `MissionViewport`. */
const GURU_CEILING = 30;

describe('the shape of the mission', () => {
  it('TC-500 is the fifth mission and unlocks behind the fourth', () => {
    expect(M.order).toBe(5);
    expect(MISSIONS[MISSIONS.length - 1].id).toBe(M.id);
    expect(MISSIONS.map((m) => m.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('TC-500 registers as a search in the plugin index, not a rescue', () => {
    // A wildlife survey is a search flown to the end. Calling it a rescue would
    // tell anything reading the registry there is someone in trouble out there.
    expect(toMissionSpec(M).type).toBe('search');
  });

  it('TC-500 scores the sighting and nothing else', () => {
    expect(M.route).toHaveLength(0);
    expect(M.homeVia).toHaveLength(0);
    // The survey ENDS at the sighting: no flight home, no landing, no second
    // point. A rubric asking for two on a mission that can only ever pay one is
    // a gold medal nobody can win, so the two numbers are pinned together here.
    expect(M.endsAtDrop).toBe(true);
    expect(maxPointsOf(M)).toBe(1);
    expect(M.medals.gold).toBe(1);
  });

  it('TC-500 never asks the pilot to come home', () => {
    // Every string on the card, not just the objectives: the flow notes and the
    // rules are read as often and are the easiest place for a landing to
    // survive a change of ending.
    const card = [
      M.blurb,
      M.story,
      ...M.objectives,
      ...(M.rules ?? []),
      ...M.flow.map((f) => `${f.label} ${f.note}`),
      ...M.ranks.map((r) => r.text),
    ].join(' ');
    // Instructions, not the word: the rules card says "no landing to score",
    // which is the mission telling the pilot the leg is gone rather than asking
    // them to fly it.
    expect(card).not.toMatch(
      /land (on|back|the drone)|fly back|come home|return to the (ranger|station)/i,
    );
  });

  it('TC-500 is flown at dusk — darker than evening, lighter than night', () => {
    // Its own preset rather than either neighbour, because both failed. `night`
    // is a black screen with a torch in it and a search you cannot see to fly is
    // not a search; `evening` leaves enough skylight to fly the whole mission
    // with the light switched off, which makes the instrument decoration.
    //
    // Pinned as an ORDERING rather than as a value: the exact ambient will be
    // tuned by flying it, and a test that froze the number would have to be
    // edited every time — while the thing that must not break is that it stays
    // between the two.
    expect(M.hour).toBe('dusk');
    const dusk = TIME_PRESETS.dusk;
    expect(dusk.ambient).toBeGreaterThan(TIME_PRESETS.night.ambient);
    expect(dusk.ambient).toBeLessThan(TIME_PRESETS.evening.ambient);
    // `night: false` is where most of the recovered visibility comes from — it
    // keeps the outdoor hemisphere fill at 0.7 rather than dropping it to 0.25.
    expect(dusk.night).toBe(false);
    // ...and `stars` is what buys back the sky it would otherwise have brought.
    expect(dusk.stars).toBe(true);
  });

  it('TC-500 does not raise the airframe ceiling', () => {
    // Mission 4 had to: its casualties are on roofs above the Guru's limit.
    // Nothing here is above the pilot — the gorge floor is thirty metres BELOW
    // the pad — so raising it would only buy searching the forest from above it.
    expect(M.ceiling).toBeUndefined();
  });

  it('TC-500 carries its clues and its rules as their own lists', () => {
    // The briefing draws four cards and two of them are these. A mission that
    // declared neither would render a card with two holes in it.
    expect(M.clues?.length).toBeGreaterThanOrEqual(3);
    expect(M.rules?.length).toBeGreaterThanOrEqual(3);
    for (const line of [...(M.clues ?? []), ...(M.rules ?? [])]) {
      expect(line).toMatch(/\.$/);
    }
  });

  it('TC-500 lands back where it launched', () => {
    // Read from the environment rather than copied, so moving the spawn moves
    // the landing with it.
    expect(M.zones.base.at).toEqual([forest.spawn.position[0], forest.spawn.position[2]]);
  });
});

describe('TC-501 nothing on screen may point at the tiger', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
    useMissionStore.getState().exit();
  });

  it('declares the no-guidance flag', () => {
    expect(M.hideGuidanceUntilFound).toBe(true);
  });

  it('hides the guidance through the search AND through the lock', () => {
    // This is the difference from Mission 4, and it is the whole reason the flag
    // is read with the leg. There the casualty is confirmed and a ring is drawn
    // round them, because they stay where they are. Here `located` is not set
    // until the observation is COMPLETE: a ring drawn round where the animal was
    // standing a second ago is worse guidance than none.
    expect(guidanceHidden(M, false, 'searching')).toBe(true);
    expect(guidanceHidden(M, false, 'confirming')).toBe(true);
    // And it comes back for the flight home, which is ordinary flying.
    expect(guidanceHidden(M, true, 'delivered')).toBe(false);
    expect(guidanceHidden(M, true, 'returning')).toBe(false);
  });

  it('lights no mark and no checkpoint while the search is on', () => {
    expect(activeZone('searching')).toBeNull();
    expect(legOf('searching')).toBeNull();
    expect(legOf('confirming')).toBeNull();
  });

  it('opens on the search rather than on a pickup', () => {
    // The mission carries nothing. A `toPickup` leg would open the attempt by
    // sending the pilot to a zone the mission does not use — and `toPickup` is
    // the one leg the no-guidance flag does NOT cover.
    useMissionStore.getState().start(M);
    expect(useMissionStore.getState().leg).toBe('searching');
    useMissionStore.getState().beginFlight();
    expect(useMissionStore.getState().leg).toBe('searching');
  });

  it('draws one of the two patrols and never the same one twice running', () => {
    // The mission has to be LOADED first: `restart` re-rolls whatever is in the
    // store, and with no mission there is nothing to draw from.
    useMissionStore.getState().start(M);
    const seen: number[] = [useMissionStore.getState().routeIndex];
    for (let i = 0; i < 12; i++) {
      useMissionStore.getState().restart();
      seen.push(useMissionStore.getState().routeIndex);
    }
    for (const i of seen) expect(i).toBeGreaterThanOrEqual(0);
    for (const i of seen) expect(i).toBeLessThan(TIGER_ROUTES.length);
    // With two routes the draw is an alternation, which is what "never the one
    // just flown" means here. The alternative — plain random over two — hands
    // the pilot the patrol they have just finished searching half the time.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it('says what the pilot is doing without saying where it is', () => {
    const lines = [
      objectiveFor('searching', 'tracking'),
      objectiveFor('confirming', 'tracking'),
      objectiveFor('delivered', 'tracking'),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/gorge|ridge|road|north|south|east|west/i);
    }
    expect(objectiveFor('searching', 'tracking')).toMatch(/spotlight/i);
  });
});

describe('TC-502 the tracking geometry leaves a band the pilot can fly', () => {
  const t = M.tracking!;

  it('is declared at all', () => {
    expect(t).toBeDefined();
    expect(t.routes.length).toBeGreaterThanOrEqual(2);
  });

  it('makes a light pool wide enough to hold the animal at the safe distance', () => {
    // Straight above the tiger at the minimum safe distance, the cone has to
    // make a pool the animal fits in. If it does not, the only way to complete
    // the lock is to break the rule that ends the attempt — an unwinnable
    // mission that reads as bad flying.
    const pool = Math.tan((t.coneDeg * Math.PI) / 180) * t.minSafeDistance;
    expect(pool).toBeGreaterThan(1);
  });

  it('keeps the tracking ceiling inside what the aircraft can do', () => {
    // A ceiling above the airframe's own is a rule that can never bite, which
    // is the same as not having one: the pilot would be told to come down from
    // a height they cannot reach.
    expect(t.maxTrackAgl).toBeLessThanOrEqual(GURU_CEILING);
    // And the light has to still reach the ground from the top of that band,
    // or the ceiling is being enforced twice with two different numbers.
    expect(t.lightRange).toBeGreaterThan(t.maxTrackAgl);
  });

  it('leaves room between the safe distance and the tracking ceiling', () => {
    // The flyable band. Too thin and the mission is a tightrope rather than a
    // survey.
    expect(t.maxTrackAgl - t.minSafeDistance).toBeGreaterThanOrEqual(15);
  });

  it('gives the pilot a hold they can finish and a walk they can follow', () => {
    expect(t.lockSeconds).toBeGreaterThanOrEqual(3);
    expect(t.lockSeconds).toBeLessThanOrEqual(8);
    // The animal must not outrun a mission drone flying a soft stick.
    expect(t.speed).toBeLessThan(2);
    // And the grace before a close pass ends the attempt has to be long enough
    // to climb away from.
    expect(t.disturbGraceSec).toBeGreaterThanOrEqual(2);
  });
});

describe('TC-507 the lit band and the safe distance cannot contradict each other', () => {
  const t = M.tracking!;
  const pool = (agl: number) => Math.tan((t.coneDeg * Math.PI) / 180) * agl;

  // The bug this describes cost an attempt at 34 seconds, on the first flight of
  // the mission, having done nothing wrong.
  //
  // The ridge-road patrol walks along the dirt road out of the clearing. A pilot
  // searching at a sensible 5 or 6 metres flew over it in the dark, entered the
  // nine metre sphere without ever seeing the animal, and lost the attempt. The
  // geometry made it unavoidable rather than unlucky: straight above the target
  // `range` IS the altitude, so every altitude below the safe distance is a
  // failure waiting for the pilot to fly over the one spot they cannot see.
  it('puts every altitude that can be too close below the whole lit band', () => {
    // Directly overhead — the worst case, and the one a search flies through.
    for (let agl = 1; agl <= t.maxTrackAgl; agl += 0.5) {
      const rangeOverhead = agl;
      const insideSafe = rangeOverhead < t.minSafeDistance;
      // The light must refuse from inside the safe distance. If it did not, the
      // lock would start filling on the same frame the attempt started dying.
      if (insideSafe) expect(agl).toBeLessThan(t.minSafeDistance);
    }
    // And the band that IS flyable has to be real: at the bottom of it the pool
    // still has to be wide enough to hold an animal.
    expect(pool(t.minSafeDistance)).toBeGreaterThan(1);
    expect(t.maxTrackAgl).toBeGreaterThan(t.minSafeDistance);
  });

  it('leaves a working search altitude that is never too close', () => {
    // Anywhere from the safe distance up to the ceiling, flown directly over the
    // animal, is legal — that is the band the briefing tells the pilot to use.
    for (let agl = t.minSafeDistance; agl <= t.maxTrackAgl; agl += 0.5) {
      expect(agl).toBeGreaterThanOrEqual(t.minSafeDistance);
      expect(pool(agl)).toBeGreaterThan(1);
    }
  });

  it('tells the pilot the band in the rules, in metres', () => {
    const rules = (M.rules ?? []).join(' ');
    expect(rules).toContain(`${t.minSafeDistance} m`);
    expect(rules).toContain(`${t.maxTrackAgl} m`);
  });
});

describe('TC-503 the patrols', () => {
  it('are long enough to be searched and short enough to be re-found', () => {
    for (const route of TIGER_ROUTES) {
      const len = routeLength(route);
      expect(len).toBeGreaterThan(25);
      // A there-and-back at the mission's speed, in seconds. Long enough that a
      // pilot in the right area has to look; short enough that one who has lost
      // it will have it walk back to them inside the time limit.
      const lap = (len * 2) / M.tracking!.speed;
      expect(lap).toBeLessThan(M.parTimeSec);
    }
  });

  it('are far apart, so guessing wrong costs a crossing', () => {
    const [a, b] = TIGER_ROUTES;
    const mid = (r: (typeof TIGER_ROUTES)[number]) => r.path[Math.floor(r.path.length / 2)].at;
    const [ax, az] = mid(a);
    const [bx, bz] = mid(b);
    expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThan(60);
  });

  it('are both inside the map and inside the mission area', () => {
    const [bx, bz] = M.zones.base.at;
    for (const route of TIGER_ROUTES) {
      for (const n of route.path) {
        expect(n.at[0]).toBeGreaterThan(forest.bounds.min[0]);
        expect(n.at[0]).toBeLessThan(forest.bounds.max[0]);
        expect(n.at[1]).toBeGreaterThan(forest.bounds.min[2]);
        expect(n.at[1]).toBeLessThan(forest.bounds.max[2]);
        // Inside the stray radius, with margin. A patrol node outside it would
        // recall a pilot who is flying the mission correctly.
        expect(Math.hypot(n.at[0] - bx, n.at[1] - bz)).toBeLessThan(M.strayRadius! - 20);
      }
    }
  });

  it('carry their own measured ground, because this map has none', () => {
    // The forest deliberately ships without `EnvironmentSpec.groundY`. A node
    // without its own height would put the tiger — and the AGL the whole cone
    // is measured from — at the clearing.
    expect(forest.groundY).toBeUndefined();
    for (const route of TIGER_ROUTES) {
      for (const n of route.path) expect(Number.isFinite(n.ground)).toBe(true);
    }
  });
});

describe('TC-504 the walk', () => {
  const scratch = { x: 0, y: 0, z: 0, heading: 0 };
  const route = TIGER_ROUTES[0];

  it('starts at the head of the path', () => {
    tigerAt(route, 0, 1, scratch);
    expect(scratch.x).toBeCloseTo(route.path[0].at[0], 5);
    expect(scratch.z).toBeCloseTo(route.path[0].at[1], 5);
    expect(scratch.y).toBeCloseTo(route.path[0].ground, 5);
  });

  it('turns round at the far end instead of teleporting back', () => {
    const len = routeLength(route);
    // At exactly one length the animal is at the tail.
    tigerAt(route, len, 1, scratch);
    const tail = route.path[route.path.length - 1];
    expect(Math.hypot(scratch.x - tail.at[0], scratch.z - tail.at[1])).toBeLessThan(0.6);
    // A step past it, and it has started back — not jumped to the head.
    tigerAt(route, len + 1, 1, scratch);
    expect(Math.hypot(scratch.x - tail.at[0], scratch.z - tail.at[1])).toBeLessThan(1.6);
    // And a full there-and-back returns it to the head.
    tigerAt(route, len * 2, 1, scratch);
    expect(
      Math.hypot(scratch.x - route.path[0].at[0], scratch.z - route.path[0].at[1]),
    ).toBeLessThan(0.6);
  });

  it('never leaves the path it was given', () => {
    // Sampled densely across two full laps: the animal has to stay on the
    // polyline, because that is the line the routes were measured for clearance
    // along. A curve or a shortcut would put it somewhere nothing was checked.
    const len = routeLength(route);
    for (let t = 0; t < len * 4; t += 0.37) {
      tigerAt(route, t, 1, scratch);
      let nearest = Infinity;
      for (let i = 1; i < route.path.length; i++) {
        const a = route.path[i - 1].at;
        const b = route.path[i].at;
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const l2 = dx * dx + dz * dz;
        const f =
          l2 === 0
            ? 0
            : Math.max(0, Math.min(1, ((scratch.x - a[0]) * dx + (scratch.z - a[1]) * dz) / l2));
        nearest = Math.min(
          nearest,
          Math.hypot(scratch.x - (a[0] + dx * f), scratch.z - (a[1] + dz * f)),
        );
      }
      expect(nearest).toBeLessThan(0.05);
    }
  });

  it('walks at the speed it is given', () => {
    // Over a second, at 1 m/s, it covers about a metre. Approximate because a
    // corner shortens the straight-line step — which is the point of checking
    // it against the path length rather than against the endpoints.
    tigerAt(route, 10, 1, scratch);
    const a = { x: scratch.x, z: scratch.z };
    tigerAt(route, 11, 1, scratch);
    expect(Math.hypot(scratch.x - a.x, scratch.z - a.z)).toBeGreaterThan(0.8);
    expect(Math.hypot(scratch.x - a.x, scratch.z - a.z)).toBeLessThanOrEqual(1.01);
  });

  it('answers with whichever route the attempt drew', () => {
    expect(tigerRouteOf(M, 0)).toBe(TIGER_ROUTES[0]);
    expect(tigerRouteOf(M, 1)).toBe(TIGER_ROUTES[1]);
    // Clamped rather than allowed to run off the end.
    expect(tigerRouteOf(M, 99)).toBe(TIGER_ROUTES[TIGER_ROUTES.length - 1]);
    // And null on a mission that is not a tracking one, so nothing else in the
    // app can be handed a patrol.
    expect(tigerRouteOf(MISSIONS[0], 0)).toBeNull();
  });
});

describe('TC-505 the rating', () => {
  /** What the Director actually reports for a completed survey: one point of
   *  one, and `landed: false` — the flight ends in the air over the animal. */
  const base: MissionResult = {
    points: 1,
    maxPoints: 1,
    timeSec: 200,
    collisions: 0,
    delivered: true,
    landed: false,
  };

  it('pays three stars for a clean, quick survey', () => {
    expect(rankFor(M.ranks, base)).toBe(3);
  });

  it('drops to two for a collision and to one for a slow survey', () => {
    expect(rankFor(M.ranks, { ...base, collisions: 1 })).toBe(2);
    expect(rankFor(M.ranks, { ...base, timeSec: 400 })).toBe(2);
  });

  it('does not test `landed`, because there is no landing', () => {
    // The result carries `landed: false` honestly on a mission that ends at the
    // sighting. A rung that read it would fail every successful attempt.
    expect(rankFor(M.ranks, { ...base, landed: false })).toBe(3);
  });

  it('never pays for flying closer', () => {
    // There is no "how close did you get" rung and there must not be: the
    // mission's rule is to stay back, and paying for a nearer pass would be the
    // app asking for the one thing the brief forbids.
    for (const rank of M.ranks) {
      expect(rank.text).not.toMatch(/close|near/i);
    }
  });
});

describe('TC-506 the routes still fit the map they were measured against', () => {
  it('passes the terrain and clearance check', () => {
    // The same contract `check-forest-route.mjs` has with Mission 2. Run here
    // rather than only by hand, because the thing that invalidates it is
    // regenerating the trunk colliders — which nobody does while thinking about
    // this mission.
    const out = execFileSync('node', ['scripts/check-tiger-routes.mjs'], {
      encoding: 'utf8',
    });
    expect(out).toContain('Every node stands on its own ground with room above it.');
  }, 120_000);
});

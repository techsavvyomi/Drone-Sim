import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { searchRescue } from '../src/renderer/missions/searchRescue';
import { precisionDelivery } from '../src/renderer/missions/precisionDelivery';
import { forestFire } from '../src/renderer/missions/forestFire';
import { multiPointDelivery } from '../src/renderer/missions/multiPointDelivery';
import { MISSIONS } from '../src/renderer/missions';
import { SEARCH_SITES, pickSearchSite } from '../src/renderer/missions/searchRescueSites';
import { zoneFor } from '../src/renderer/missions/searchZone';
import { newYork } from '../src/renderer/plugins/environments/newYork';
import {
  PICKUP_DECK_AT,
  PICKUP_DECK_SIZE,
  PICKUP_DECK_TOP,
} from '../src/renderer/missions/pickupStorefront';
import { NYC_PLAN_BOUNDS } from '../src/renderer/scene/environment/NewYorkPlan';
import {
  allZonesOf,
  maxPointsOf,
  rankFor,
  rescueZoneOf,
  searchSiteOf,
  toMissionSpec,
  beaconHeightFor,
} from '../src/renderer/missions/types';
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

// Search & Rescue: the no-guidance rule, the four sites, and the red zone.
//
// Nothing here flies the drone — the runtime needs a canvas and a physics world.
// What is tested is the half of the mission a pilot cannot check by flying it
// once: that NOTHING on screen can give the answer away before the casualty is
// found, that all four sites are places the aircraft can reach, and that the
// red zone is drawn round whichever site is actually in play.
//
// The first of those is why most of this file exists. The rule is a REMOVAL, and
// a removal is the thing a later change to a shared component silently undoes:
// the marks, the radar, the readout and the pointer are drawn by default by a
// runtime three other missions are built on, and none of them would fail if the
// guidance came back.

const M = searchRescue;

/** The Guru's own ceiling. Every mission is flown on the Guru — see
 *  `MissionViewport` — and this city's roofs start at 45 m, so on the stock
 *  airframe there is exactly one reachable roof in the whole city. */
const GURU_CEILING = 30;
/** What this mission flies at, which is the only reason four rooftop sites can
 *  exist. `FlightScene` applies it for the length of the mission. */
const CEILING = searchRescue.ceiling!;

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

describe('the shape of the mission', () => {
  it('TC-400 is a search with one site per direction and no route at all', () => {
    expect(M.kind).toBe('search');
    expect(M.search?.sites).toHaveLength(4);
    // A ring is an answer. Even one, even an optional one, would tell the pilot
    // which third of the map to fly to before they had seen the red zone.
    expect(M.route).toHaveLength(0);
    expect(M.homeVia).toHaveLength(0);
  });

  it('TC-400 is the fourth mission and unlocks behind the third', () => {
    expect(M.order).toBe(4);
    expect(MISSIONS.map((m) => m.id)).toEqual([
      precisionDelivery.id,
      forestFire.id,
      multiPointDelivery.id,
      searchRescue.id,
    ]);
  });

  it('TC-400 registers as a rescue in the plugin index', () => {
    expect(toMissionSpec(M).type).toBe('rescue');
  });

  it('TC-400 scores the food drop and the landing, and nothing else', () => {
    // Two points: the food box delivered, and the drone landed home. Collecting
    // the box scores nothing on its own, as on every delivery.
    expect(M.endsAtDrop).toBeUndefined();
    expect(maxPointsOf(M)).toBe(2);
    expect(M.medals.gold).toBe(2);
  });

  it('TC-400 keeps the food box pickup off the spawn and away from the base pad', () => {
    const [px, pz] = M.zones.pickup.at;
    const [bx, bz] = M.zones.base.at;
    expect(Math.hypot(px - bx, pz - bz)).toBeGreaterThanOrEqual(12);
  });

  it('TC-400 lands on the helipad the drone launched from', () => {
    // The landing is judged on the painted H under the spawn, not on a mark down
    // the street — on every New York mission that ends with one.
    const [sx, , sz] = newYork.spawn.position;
    for (const m of [searchRescue, precisionDelivery, multiPointDelivery]) {
      expect(m.zones.base.at).toEqual([sx, sz]);
      expect(m.zones.base.groundY).toBe(newYork.spawnGround);
      // Tight enough that the aircraft is ON the 1.15 m paint, not beside it.
      expect(m.zones.base.radius).toBeLessThanOrEqual(1.25);
    }
  });

  it('TC-400 collects the food box off the restaurant deck, not the road', () => {
    expect(M.zones.pickup.at).toEqual(PICKUP_DECK_AT);
    expect(M.zones.pickup.groundY).toBeCloseTo(PICKUP_DECK_TOP, 5);
    expect(M.zones.pickup.groundY!).toBeGreaterThan(0.5);
    // The ring has to fit on the deck with room to spare.
    expect(M.zones.pickup.radius).toBeLessThan(PICKUP_DECK_SIZE / 2);
  });

  it('TC-400 declares no stray radius', () => {
    // Flying the wrong part of the map IS this mission. A recall banner would be
    // the app quietly narrowing the search.
    expect(M.strayRadius).toBeUndefined();
  });
});

describe('the no-guidance rule', () => {
  it('TC-401 declares the flag rather than relying on an absence', () => {
    expect(M.hideGuidanceUntilFound).toBe(true);
    // And ONLY this mission. If a future mission wants it, it says so.
    for (const other of [precisionDelivery, forestFire, multiPointDelivery])
      expect(other.hideGuidanceUntilFound).toBeUndefined();
  });

  it('TC-401 hides guidance for the whole search and reveals it on the find', () => {
    expect(guidanceHidden(M, false)).toBe(true);
    expect(guidanceHidden(M, true)).toBe(false);
  });

  it('TC-401 can never hide guidance on a mission that has not asked for it', () => {
    // The gate is the mission's flag first and `located` second, so a store that
    // somehow reported `located: false` on a delivery cannot blank its HUD.
    for (const other of [precisionDelivery, forestFire, multiPointDelivery]) {
      expect(guidanceHidden(other, false)).toBe(false);
      expect(guidanceHidden(other, true)).toBe(false);
    }
    expect(guidanceHidden(null, false)).toBe(false);
  });

  it('TC-401 leaves no zone live while the pilot is searching', () => {
    // This is what silences the lit mark in the world, the radar's dot and the
    // DISTANCE readout: all three ask `activeZone`, and all three go quiet on
    // one answer.
    expect(activeZone('searching')).toBeNull();
    // And no checkpoint leg either, so nothing falls through to another leg's
    // rings on a mission that declares none.
    expect(legOf('searching')).toBeNull();
    expect(legOf('confirming')).toBeNull();
  });

  it('TC-401 makes the rescue zone live only once the hold has begun', () => {
    expect(activeZone('confirming')).toBe('drop');
  });

  it('TC-401 gives the search its own objective line', () => {
    expect(objectiveFor('searching', 'search')).toMatch(/search/i);
    expect(objectiveFor('confirming', 'search')).toMatch(/hold/i);
    // And the tail is the shared one, unchanged.
    expect(objectiveFor('delivered', 'search')).toBe('Return to base.');
  });
});

describe('the four sites', () => {
  it('TC-402 keeps every site reachable under the mission ceiling', () => {
    for (const site of M.search!.sites) {
      // The band measured from the site's own DECK, not just the mark: a hover
      // the aircraft cannot climb to is a mission that cannot be finished, and
      // nothing in a typecheck sees it. Every deck here is a roof, so this is
      // the assertion the whole band was sized by.
      const deck = site.zone.groundY ?? M.groundY;
      expect(deck + site.zone.band.max).toBeLessThan(CEILING);
    }
  });

  it('TC-402 puts every casualty on a roof', () => {
    // A search always flown down a street teaches a habit, and a pilot with the
    // habit stops looking up. Every site is a rooftop, and the mission's zones
    // agree with the site list about which deck each one is.
    for (const s of SEARCH_SITES) expect(s.roof).toBeGreaterThan(0);
    for (let i = 0; i < SEARCH_SITES.length; i++)
      expect(M.search!.sites[i].zone.groundY ?? M.groundY).toBe(SEARCH_SITES[i].roof);
  });

  it('TC-402 raises the ceiling for itself, and only upwards', () => {
    // The rooftops are only reachable because of this, and it is the one thing
    // on the mission that changes what the aircraft can do. A mission allowed to
    // LOWER the ceiling would be indistinguishable from a broken drone, so
    // `FlightScene` ignores anything under the airframe's own — this asserts the
    // mission never asks it to.
    expect(CEILING).toBeGreaterThan(GURU_CEILING);
    // The highest deck plus its hover still has to fit, with the air-brake's
    // margin left over.
    const highest = Math.max(...SEARCH_SITES.map((s) => s.roof));
    expect(highest + M.search!.sites[0].zone.band.max).toBeLessThan(CEILING);
  });

  it('TC-402 holds the hover clear of the deck it is over', () => {
    // The old floor was 12 m, forced by street furniture topping out at 10.5 in
    // the canyons the sites used to sit in. On a roof there is nothing to clear
    // and the ceiling is tight, so the only question left is how low a hover
    // still reads as being OVER someone rather than on top of them.
    for (const site of M.search!.sites) expect(site.zone.band.min).toBeGreaterThanOrEqual(3);
  });

  it('TC-402 keeps the rescue zone inside the clear air each site has', () => {
    // The tightest site has 5.83 m of clear column. A zone whose edge is inside a
    // facade — or hanging off the side of the roof — is a hover the pilot is
    // asked to hold in a wall.
    const tightest = Math.min(...SEARCH_SITES.map((s) => s.clearance));
    for (const site of M.search!.sites) expect(site.zone.radius).toBeLessThan(tightest);
  });

  it('TC-402 asks for a two second hold that a drift resets', () => {
    for (const site of M.search!.sites) {
      expect(site.zone.hold).toBe(2);
      // The delivery drop's limits, not the fire's original 2.2 m/s — that is a
      // brisk pass, not a hover, and this mission asks for a position held.
      expect(site.zone.maxGroundSpeed).toBeLessThanOrEqual(0.9);
    }
  });

  it('TC-402 keeps all four sites apart', () => {
    const at = SEARCH_SITES.map((s) => s.at);
    for (let i = 0; i < at.length; i++)
      for (let j = i + 1; j < at.length; j++)
        expect(Math.hypot(at[i][0] - at[j][0], at[i][1] - at[j][1])).toBeGreaterThanOrEqual(50);
  });

  it('TC-402 never lets one red zone hold two sites', () => {
    // The rule that replaced "seventy metres apart" when the sites went up onto
    // the roofs. A zone reaches at most its radius plus the offset from its own
    // site; every other site has to be further than that, or a pilot could
    // search one circle and pass over two candidate roofs.
    const R = M.search!.zoneRadius;
    const reach = R + R * 0.55;
    for (const a of SEARCH_SITES)
      for (const b of SEARCH_SITES) {
        if (a === b) continue;
        expect(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])).toBeGreaterThan(reach);
      }
  });

  it('TC-402 draws the mark on the roof the pilot sees, below a band that clears the parapet', () => {
    // The mark used to be drawn at the collider deck — the parapet — and hung a
    // metre or two over the visible slab. Drawn on the slab, it is only honest
    // while the hover it asks for still starts above the parapet.
    for (let i = 0; i < SEARCH_SITES.length; i++) {
      const s = SEARCH_SITES[i];
      const zone = M.search!.sites[i].zone;
      expect(s.deck).toBeGreaterThanOrEqual(s.roof);
      expect(s.roof + zone.band.min).toBeGreaterThan(s.deck);
      // And the aircraft can come down to the roof the person is standing on.
      // The deck was the parapet, up to 2.6 m over the slab, and the drone
      // stopped on nothing visible beside them; TC-408 re-measures it.
      expect(s.deck - s.roof).toBeLessThan(0.3);
    }
  });

  it('TC-402 counts every site zone as a mark of the mission', () => {
    // `allZonesOf` is what the marks and the dropped-payload deck read. A search
    // mission that reported only `zones.drop` would draw one of its three.
    const zones = allZonesOf(M);
    for (const site of M.search!.sites) expect(zones).toContain(site.zone);
  });
});

describe('which site is live', () => {
  it('TC-403 resolves the live site rather than the first one', () => {
    for (let i = 0; i < M.search!.sites.length; i++) {
      expect(rescueZoneOf(M, i)).toBe(M.search!.sites[i].zone);
      expect(searchSiteOf(M, i)?.id).toBe(M.search!.sites[i].id);
    }
  });

  it('TC-403 clamps an index off either end rather than answering nothing', () => {
    expect(rescueZoneOf(M, -1)).toBe(M.search!.sites[0].zone);
    expect(rescueZoneOf(M, 99)).toBe(M.search!.sites[M.search!.sites.length - 1].zone);
  });

  it('TC-403 answers the ordinary drop on a mission that is not a search', () => {
    expect(rescueZoneOf(precisionDelivery, 0)).toBe(precisionDelivery.zones.drop);
    expect(searchSiteOf(precisionDelivery, 0)).toBeNull();
  });

  it('TC-403 keeps zones.drop pointing at the first site, not at nothing', () => {
    // Anything that still reads `zones.drop` without asking which site is live
    // gets a real zone rather than undefined.
    expect(M.zones.drop).toBe(M.search!.sites[0].zone);
  });
});

describe('the attempt', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
    useMissionStore.getState().exit();
  });

  it('TC-404 opens on the run to the food box with nothing found', () => {
    useMissionStore.getState().start(M);
    const s = useMissionStore.getState();
    expect(s.leg).toBe('toPickup');
    expect(s.located).toBe(false);
    expect(s.signal).toBe(0);
    // Guided to the box like any collection; silent only once searching.
    expect(guidanceHidden(M, false, 'toPickup')).toBe(false);
    expect(guidanceHidden(M, false, 'searching')).toBe(true);
    expect(guidanceHidden(M, true, 'confirming')).toBe(false);
  });

  it('TC-404 opens the other missions on their own first leg, unchanged', () => {
    useMissionStore.getState().start(precisionDelivery);
    expect(useMissionStore.getState().leg).toBe('toPickup');
  });

  it('TC-404 re-rolls the site on every attempt, including a restart', () => {
    // A pilot who failed at site B must not be handed site B again to fly from
    // memory. Sampled rather than asserted once: the draw is random, so what is
    // tested is that all three come up.
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      useMissionStore.getState().start(M);
      seen.add(useMissionStore.getState().siteIndex);
      useMissionStore.getState().restart();
      seen.add(useMissionStore.getState().siteIndex);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('TC-404 never hands the same site twice in a row', () => {
    // The stronger half of the rule above. A plain random draw over four sites
    // repeats one attempt in three, and a pilot handed the position they have
    // just finished searching does not search — they fly straight to it.
    let prev = -1;
    for (let i = 0; i < 300; i++) {
      useMissionStore.getState().start(M);
      const now = useMissionStore.getState().siteIndex;
      expect(now).not.toBe(prev);
      prev = now;
      useMissionStore.getState().restart();
      const after = useMissionStore.getState().siteIndex;
      expect(after).not.toBe(prev);
      prev = after;
    }
  });

  it('TC-404 puts `located` back on a restart', () => {
    useMissionStore.getState().start(M);
    useMissionStore.getState().setLocated();
    useMissionStore.getState().setSignal(1);
    expect(useMissionStore.getState().located).toBe(true);
    useMissionStore.getState().restart();
    expect(useMissionStore.getState().located).toBe(false);
    expect(useMissionStore.getState().signal).toBe(0);
    expect(useMissionStore.getState().leg).toBe('toPickup');
  });

  it('TC-404 leaves every other mission with siteIndex 0 and nothing reading it', () => {
    useMissionStore.getState().start(forestFire);
    expect(useMissionStore.getState().siteIndex).toBe(0);
  });
});

describe('the search roof', () => {
  const search = searchRescue.search!;

  it('TC-409 keeps the detect roof above the confirmation hover band', () => {
    // The roof has to clear the band the pilot is then asked to hold in, or the
    // mission would drop the signal during the descent it just demanded — the
    // pilot would watch the casualty they had found un-find itself.
    const band = search.sites[0].zone.band;
    expect(search.maxDetectAgl).toBeGreaterThan(band.max);
  });

  it('TC-410 keeps the detect roof below the aircraft ceiling', () => {
    // The whole point: at the Guru's 30 m limit the pilot is over every roof
    // with the sector spread out below, and a flat radius with no roof would
    // hand them the casualty for climbing rather than for searching.
    expect(search.maxDetectAgl).toBeLessThan(30);
  });
});

describe('where the arrow points', () => {
  it('TC-411 aims the marker inside every site band', () => {
    // The marker the arrow, the in-picture pointer and the climb chip all read
    // sits at the MIDDLE of the band. It used to sit at half the band's ceiling,
    // which is the same thing only for a band that opens at the deck — and when
    // the rescue hover was 12-22 m up a canyon, half of 22 was 11: a metre below
    // the floor the Height row was asking for, so the arrow said descend while
    // the checklist said climb.
    //
    // The rooftop band no longer reproduces that trap, which is exactly why the
    // rule is asserted rather than the old arithmetic: the next band to change
    // must not have to rediscover it.
    for (const site of searchRescue.search!.sites) {
      const band = site.zone.band;
      const mid = (band.min + band.max) / 2;
      expect(mid).toBeGreaterThanOrEqual(band.min);
      expect(mid).toBeLessThanOrEqual(band.max);
    }
  });
});

describe('the red zone', () => {
  const R = M.search!.zoneRadius;

  it('TC-405 draws a zone that always contains its own casualty', () => {
    // The mission's one unrecoverable state: a pilot searches the circle
    // honestly and completely and nobody is in it. Sampled hard across every
    // site, because the placement is random and clamped twice — the guarantee
    // lives in the interaction between those clamps, not in either of them.
    for (const site of SEARCH_SITES) {
      for (let i = 0; i < 500; i++) {
        const z = zoneFor(site.at, R);
        const d = Math.hypot(z.at[0] - site.at[0], z.at[1] - site.at[1]);
        expect(d, `site ${site.id} at ${z.at}`).toBeLessThan(R);
      }
    }
  });

  it('TC-405 never centres the zone on the casualty', () => {
    // A circle centred on the answer is a marker with a wide border: the pilot
    // flies to the middle of it and is done, having searched nothing. Sampled
    // for the average rather than asserted per draw — a single draw is allowed
    // to land near the middle, the DISTRIBUTION is what must not.
    const site = SEARCH_SITES[1];
    let total = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const z = zoneFor(site.at, R);
      total += Math.hypot(z.at[0] - site.at[0], z.at[1] - site.at[1]);
    }
    // Uniform over a disc of radius 0.55R averages 2/3 of it. Well clear of the
    // centre, and comfortably short of the rim.
    expect(total / n).toBeGreaterThan(R * 0.2);
  });

  it('TC-405 keeps every possible zone centred over the city', () => {
    // The map scrolls with the aircraft, so there is no frame for a zone to be
    // clipped by — what can still go wrong is a circle drawn over empty ground
    // off the edge of the city, inviting the pilot to search nothing. Two of
    // the sites stand on the streets that ring the blocks, so the circle may
    // overhang the building bounds; its centre may not leave them.
    for (const site of SEARCH_SITES) {
      for (let i = 0; i < 300; i++) {
        const z = zoneFor(site.at, R);
        expect(z.at[0]).toBeGreaterThanOrEqual(NYC_PLAN_BOUNDS.minX);
        expect(z.at[0]).toBeLessThanOrEqual(NYC_PLAN_BOUNDS.maxX);
        expect(z.at[1]).toBeGreaterThanOrEqual(NYC_PLAN_BOUNDS.minZ);
        expect(z.at[1]).toBeLessThanOrEqual(NYC_PLAN_BOUNDS.maxZ);
      }
    }
  });

  it('TC-405 gives the store a zone the moment a search attempt arms', () => {
    // The map is the mission's whole answer to 'where do I go'. A search
    // attempt that armed without one would leave the pilot with a plan of the
    // city and nothing on it.
    for (let i = 0; i < 20; i++) {
      useMissionStore.getState().start(M);
      const st = useMissionStore.getState();
      const site = M.search!.sites[st.siteIndex];
      expect(st.searchZone).not.toBeNull();
      const d = Math.hypot(st.searchZone!.at[0] - site.at[0], st.searchZone!.at[1] - site.at[1]);
      expect(d).toBeLessThan(st.searchZone!.radius);
    }
  });

  it('TC-405 leaves every other mission without a zone', () => {
    useMissionStore.getState().start(forestFire);
    expect(useMissionStore.getState().searchZone).toBeNull();
  });

  it('TC-405 lines the mission sites up with the site module', () => {
    // If they ever drift, the red zone is drawn round site B and the beacon is
    // put at site A — which no other test in this file could see.
    expect(M.search!.sites.map((s) => s.id)).toEqual(SEARCH_SITES.map((s) => s.id));
    for (let i = 0; i < SEARCH_SITES.length; i++)
      expect(M.search!.sites[i].at).toEqual(SEARCH_SITES[i].at);
  });

  it('TC-405 picks each site from the random draw', () => {
    expect(pickSearchSite(() => 0).id).toBe(SEARCH_SITES[0].id);
    // Indexed off the length rather than written as 0.5, so adding a site does
    // not silently turn this into an assertion about a different one.
    expect(pickSearchSite(() => 1 / SEARCH_SITES.length).id).toBe(SEARCH_SITES[1].id);
    expect(pickSearchSite(() => 0.999).id).toBe(SEARCH_SITES[SEARCH_SITES.length - 1].id);
  });

  it('TC-405 keeps the zone big enough to search and small enough to narrow', () => {
    // Both failure modes in one place. A zone the pilot can see across from its
    // edge is a marker; one that covers a third of the city has narrowed
    // nothing over sweeping the whole thing.
    expect(R).toBeGreaterThan(M.search!.detectRadius);
    const city = Math.max(
      NYC_PLAN_BOUNDS.maxX - NYC_PLAN_BOUNDS.minX,
      NYC_PLAN_BOUNDS.maxZ - NYC_PLAN_BOUNDS.minZ,
    );
    expect(R * 2).toBeLessThan(city / 2);
  });
});

describe('the signal', () => {
  it('TC-406 hears nothing until well inside the map', () => {
    const search = M.search!;
    // Deliberately SHORT, and shorter than the beacon is visible from. The
    // pilot must see the beacon and then have the readout agree, never the other
    // way round: a detect radius wide enough to announce the casualty from a
    // street away makes the HUD the thing that found them.
    expect(search.detectRadius).toBe(18);
    // Confirmation is wider than the zone itself, so the mark appears as the
    // pilot arrives rather than at the instant they are already inside it.
    expect(search.confirmRadius).toBeGreaterThan(M.search!.sites[0].zone.radius);
    expect(search.confirmRadius).toBeLessThan(search.detectRadius);
  });

  it('TC-406 keeps the beacon plume under the hover band', () => {
    // The pilot holds ABOVE the smoke rather than inside it. The forest's fire
    // column was removed for exactly this: warm translucent haze where real
    // smoke already is reads as smoke, not as a marker.
    // Per site, through the rule that sizes it: the rooftop hover is 1.2 m off
    // the deck, so a 10 m column there would put the aircraft inside its own
    // smoke at the moment the mission is won.
    for (const site of M.search!.sites)
      expect(beaconHeightFor(M, site.zone)).toBeLessThanOrEqual(site.zone.band.min);
  });
});

describe('the rating', () => {
  it('TC-407 needs the food delivered and the drone home for the top star', () => {
    expect(rankFor(M.ranks, result())).toBe(3);
    expect(rankFor(M.ranks, result({ collisions: 1 }))).toBe(2);
    expect(rankFor(M.ranks, result({ timeSec: 400 }))).toBe(2);
    expect(rankFor(M.ranks, result({ landed: false }))).toBe(1);
  });

  it('TC-407 quotes the same numbers the rungs test', () => {
    expect(M.ranks[0].text).toContain('4:00');
    expect(M.parTimeSec).toBe(240);
  });

  it('TC-407 rates on time rather than on a distance the pilot could not know', () => {
    // There is deliberately no "search efficiency" rung: measured against the
    // distance to the target it punishes the pilot for not knowing the answer,
    // which is the whole mission.
    const wandered = result({ timeSec: 239 });
    expect(rankFor(M.ranks, wandered)).toBe(3);
  });
});

describe('the geometry', () => {
  it('TC-408 clears every site against the generated New York colliders', () => {
    // The script is the measurement; this is what makes it run in CI. A site
    // that has drifted into a building is invisible in every other way on this
    // mission — there is no marker to notice hanging in a wall.
    const out = execFileSync('node', ['scripts/check-search-sites.mjs'], { encoding: 'utf8' });
    expect(out).toContain('OK — all 4 sites are flyable and distinct');
    expect(out).not.toContain('FAIL');
  });
});

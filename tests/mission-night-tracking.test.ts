import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { nightTracking } from '../src/renderer/missions/nightTracking';
import { MISSIONS } from '../src/renderer/missions';
import {
  TIGER_ROUTES,
  ambleDistance,
  amblePace,
  routeLength,
  tigerAt,
  tigerAtDistance,
} from '../src/renderer/missions/tigerRoutes';
import { forest } from '../src/renderer/plugins/environments/forest';
import {
  IRIS_ALT,
  LIGHT_INTENSITY,
  LIGHT_MAX_TILT_DEG,
  LIGHT_TILT_DEG,
  beamTilt,
  irisScale,
  lampExposure,
  lampHold,
  lampRamp,
} from '../src/renderer/missions/DroneSpotlight';
import { TIME_PRESETS } from '../src/renderer/state/worldStore';
import {
  maxPointsOf,
  rankFor,
  tigerRouteOf,
  toMissionSpec,
  trackingLit,
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
  // keep-off sphere without ever seeing the animal, and lost the attempt. The
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

describe('TC-507c the hold counts the moment the light is on the animal', () => {
  const t = M.tracking!;
  /** The steepest lean the lamp ever draws — the hardest case for reach. */
  const TILT = (LIGHT_MAX_TILT_DEG * Math.PI) / 180;
  /** The beam at full forward lean, toward a nose facing −Z. */
  const axis = { x: 0, y: -Math.cos(TILT), z: -Math.sin(TILT) };
  /** A point `d` metres along the beam from the lamp, nudged by `off` radians
   *  within the vertical plane — positive lifts it toward the horizon. */
  const along = (d: number, off = 0) => {
    const a = TILT + off;
    return { x: 0, y: -Math.cos(a) * d, z: -Math.sin(a) * d };
  };

  // Asked for in as many words: whatever height I am at, the moment my
  // flashlight is on the tiger it should start completing.

  it('counts along the beam at every range from the keep-off to its reach', () => {
    for (let d = t.minSafeDistance + 0.01; d <= t.lightRange; d += 0.5) {
      expect(trackingLit(t, along(d), axis)).toBe(true);
    }
  });

  it('reaches flat ground from the aircraft ceiling, even at full lean', () => {
    // It used to reach the gorge's lowest node (-30.47) from the ceiling. With
    // the lamp tipped up like a headlight (60°, 70° at full lean) the beam is
    // 1/cos(tilt) longer than the height, so over the deep gorge the pilot has
    // to come down to reach it — chosen by the maintainer. Over the pad's own
    // level it still reaches from the top of the envelope.
    expect(trackingLit(t, along(GURU_CEILING / Math.cos(TILT)), axis)).toBe(true);
  });

  it('judges the patch the beam is on, not the ground behind the aircraft', () => {
    // Leaning forward, the ground behind the tail is well outside the cone.
    // Scoring it would count an animal the pilot is not lighting.
    const behindTail = { x: 0, y: -12, z: 6 };
    expect(trackingLit(t, behindTail, axis)).toBe(false);
  });

  it('holds the whole cone and nothing outside it', () => {
    const half = (t.coneDeg * Math.PI) / 180;
    expect(trackingLit(t, along(15, half * 0.9), axis)).toBe(true);
    expect(trackingLit(t, along(15, -half * 0.9), axis)).toBe(true);
    expect(trackingLit(t, along(15, half * 1.3), axis)).toBe(false);
    expect(trackingLit(t, along(15, -half * 1.3), axis)).toBe(false);
  });

  it('still refuses from on top of the animal, and only from there', () => {
    // The one exclusion that is not about the light: without it the lock would
    // fill on the same frames the disturb grace was ending the attempt.
    expect(trackingLit(t, along(t.minSafeDistance - 0.5), axis)).toBe(false);
    expect(trackingLit(t, along(t.minSafeDistance + 0.5), axis)).toBe(true);
  });

  it('never counts an animal behind the lamp', () => {
    const behind = { x: 0, y: Math.cos(TILT) * 10, z: Math.sin(TILT) * 10 };
    expect(trackingLit(t, behind, axis)).toBe(false);
  });
});

describe('TC-507d the beam leans slightly forward, and further in forward flight', () => {
  const deg = (r: number) => (r * 180) / Math.PI;

  it('points a little ahead of the nose at a level hover', () => {
    expect(deg(beamTilt(0))).toBeCloseTo(LIGHT_TILT_DEG);
    expect(LIGHT_TILT_DEG).toBeGreaterThan(0);
    // Tipped up like a phone torch, but still pointing DOWN at the ground.
    expect(LIGHT_TILT_DEG).toBeLessThan(90);
    expect(LIGHT_MAX_TILT_DEG).toBeLessThan(90);
  });

  it('leans further ahead as the airframe pitches nose-down', () => {
    const tenDeg = (10 * Math.PI) / 180;
    expect(beamTilt(tenDeg)).toBeGreaterThan(beamTilt(0));
    expect(beamTilt(-tenDeg)).toBeLessThan(beamTilt(0));
  });

  it('never leans past its limit or tips back behind straight down', () => {
    expect(deg(beamTilt(Math.PI / 2))).toBeCloseTo(LIGHT_MAX_TILT_DEG);
    expect(beamTilt(-Math.PI / 2)).toBe(0);
  });
});

describe('TC-507b the keep-off distance is not a working height', () => {
  const t = M.tracking!;

  // It was nine metres, and nine turned the survey into a hover at one specific
  // altitude: straight above the animal the distance IS the altitude, so "never
  // inside nine" reads as "hold it at nine" — at the widest, dimmest end of the
  // pool, one careless metre from losing the attempt. The mission's constraint
  // is supposed to be the CONE, which the pilot trades height against on their
  // own terms.

  it('leaves most of the flyable envelope as a free choice of height', () => {
    // Anything much more than a fifth of the ceiling stops being a keep-off and
    // starts being an instruction about where to fly.
    expect(t.minSafeDistance).toBeLessThan(t.maxTrackAgl / 5);
  });

  it('is close enough to be about the animal rather than about the flying', () => {
    // Roughly two body lengths of a 1.9 m animal: where a real aircraft's noise
    // and downwash are actually on it. Below one body length it would be a rule
    // nothing could break; far above it, a flight ceiling in disguise.
    expect(t.minSafeDistance).toBeGreaterThan(2);
  });

  it('is legal to fly the lock from, all the way down to it', () => {
    // If the pool at the floor could not hold the animal, the bottom of the
    // band would be unwinnable and the pilot would be pushed back up to a
    // single workable height — which is the thing being removed.
    const pool = Math.tan((t.coneDeg * Math.PI) / 180) * t.minSafeDistance;
    expect(pool).toBeGreaterThan(1.9 / 2);
  });
});

describe('TC-508 the searchlight is off until the drone leaves the ground', () => {
  // Flown, and reported: the lamp burned on the pad from the first frame. An
  // inverse-square light a few centimetres off the deck overexposes everything
  // under it, and bloom smears that across the whole airframe — the drone
  // stopped being a drone and became a bulb sitting in a white hole. It is also
  // simply not what a survey aircraft does: the light is for the search, and
  // the search starts when you leave the ground.

  it('is dark on the pad, however the motors are set', () => {
    expect(lampRamp(0, true)).toBe(0);
    expect(lampRamp(0, false)).toBe(0);
    // Still dark through the first few centimetres of a lift-off.
    expect(lampRamp(0.25, true)).toBe(0);
  });

  it('is dark whenever the motors are not live', () => {
    // Disarmed at altitude — a wreck falling, or a pilot who cut the motors —
    // has no reason to be lighting the forest.
    for (const h of [0, 1, 2, 10]) expect(lampRamp(h, false)).toBe(0);
  });

  it('comes up across the climb rather than switching on', () => {
    const climb = [0.3, 0.6, 0.9, 1.2, 1.5, 1.8].map((h) => lampRamp(h, true));
    for (let i = 1; i < climb.length; i++) expect(climb[i]).toBeGreaterThan(climb[i - 1]);
    expect(climb[0]).toBe(0);
    expect(climb[climb.length - 1]).toBe(1);
  });

  it('is at full power by the time the probe saturates', () => {
    // The four-corner support probe reaches 2 m and reports 2.0 for anything
    // beyond, so the ramp has to be finished by then or it would never finish
    // at all.
    expect(lampRamp(2, true)).toBe(1);
    expect(lampRamp(30, true)).toBe(1);
  });
});

describe('TC-502c the searchlight is not put out by the wood it is searching', () => {
  // The take-off gate reads the support probe, and the probe reports the
  // nearest solid thing under each rotor — which on this map includes 2,913
  // trunk colliders whose tops sit between 2 and 30 m, i.e. inside the whole
  // flight envelope. Read live, the gate took every treetop for the pad and
  // faded the searchlight out in mid-air. It is a ratchet now.

  it('closes on the pad, with the motors dead, and in a wreck', () => {
    // `held` is what is carried in; none of these three may carry anything out.
    expect(lampHold(1, 1, false, false)).toBe(0);
    expect(lampHold(1, 1, true, true)).toBe(0);
    expect(lampHold(0, 0, true, true)).toBe(0);
  });

  it('opens across the climb exactly as the ramp does', () => {
    let held = 0;
    for (const h of [0.3, 0.9, 1.5, 1.8]) {
      held = lampHold(lampRamp(h, true), held, true, false);
      expect(held).toBeCloseTo(lampRamp(h, true), 6);
    }
    expect(held).toBe(1);
  });

  it('cannot be closed by something the aircraft flies OVER', () => {
    // At altitude, with the gate open, the probe drops to a treetop a metre
    // below and then saturates again as the tree passes.
    let held = 1;
    for (const probe of [1.2, 0.4, 0.05, 0.4, 2]) {
      held = lampHold(lampRamp(probe, true), held, true, false);
      expect(held).toBe(1);
    }
  });

  it('is closed by LANDING on that same treetop', () => {
    // A foot resting on it is a different fact from passing over it, and it is
    // the one the ratchet reopens on.
    expect(lampHold(0, 1, true, true)).toBe(0);
  });
});

describe('TC-502b the searchlight does not blow out underneath itself', () => {
  // The pool is `INTENSITY / agl^2`, which is the right physics and the wrong
  // exposure: low down it runs far past the bloom threshold, the whole pool
  // clips to flat white, and its soft edge clips with it — flown as "the light
  // circle has hard edges and looks flat white" at 1.4 m. Below the design
  // height the falloff is compressed instead. Uses the lamp's REAL intensity:
  // this test once pinned 360 while the lamp had been turned up to 1500, and
  // the blowout came back with nothing failing.
  const pool = (h: number) => (LIGHT_INTENSITY / (h * h)) * lampExposure(h);

  it('leaves the altitude trade above the design height untouched', () => {
    for (const h of [IRIS_ALT, IRIS_ALT + 2, 30, 45]) expect(irisScale(h)).toBe(1);
  });

  it('keeps the pool off the top of the exposure range all the way down', () => {
    // 4.5, from 3.5: the lamp was flown as too dim at 900 and raised 1.5x.
    expect(pool(9)).toBeLessThan(4.5);
    expect(pool(4)).toBeLessThan(6);
    expect(pool(2)).toBeLessThan(9);
    expect(pool(1.4)).toBeLessThan(11);
    expect(pool(1)).toBeLessThan(13);
  });

  it('holds the brightness that was signed off, and never goes dark low down', () => {
    // This used to require the pool to brighten every metre down. The look the
    // maintainer approved does not: it was flown with the lamp a metre above
    // the drone, which evens the pool out and dims it slightly below ~6 m, and
    // they asked for exactly that look to be kept (see LOOK_OFFSET). What still
    // matters is that low down the pool is neither blown out (above) nor lost.
    for (const h of [1, 1.4, 2, 4, 6, 9, 12]) expect(pool(h)).toBeGreaterThan(1.5);
    expect(pool(6)).toBeGreaterThan(pool(IRIS_ALT));
  });

  it('never dims a reading it does not have', () => {
    // Of the two ways to be wrong, a pool that is too hot can be seen and
    // turned down; one that is turned off cannot be seen at all.
    for (const h of [0, -1]) expect(irisScale(h)).toBe(1);
  });
});
describe('TC-502e the safe distance may only judge a pilot who can see the animal', () => {
  const track = M.tracking!;

  // The rule failed the attempt with "you had the tiger" a minute after the
  // tiger had walked off into the trees. It was armed by a latched flag that
  // one frame of beam could set and nothing could clear — on the one mission
  // that draws no marker for its target and whose target moves.

  it('cannot be armed by a single frame of light', () => {
    // Two frames at 30 fps is 67 ms; a sixteenth of a second of beam across an
    // animal the pilot never saw must not arm anything.
    expect(track.sightArmSec).toBeGreaterThan(4 / 30);
  });

  it('arms well inside the hold it precedes', () => {
    // "You have seen it", not "you have observed it" — and the pilot has to be
    // able to reach the safe distance question while the sighting is still
    // live, or the rule would only ever fire on a lock already lost.
    expect(track.sightArmSec).toBeLessThan(track.lockSeconds / 4);
  });

  it('leaves room to climb away once it has armed', () => {
    // Arming is not failing: the grace period is what the pilot acts inside,
    // and it must be the longer of the two by a clear margin.
    expect(track.disturbGraceSec).toBeGreaterThan(track.sightArmSec * 3);
  });
});

describe('TC-505 the tiger ambles rather than marching', () => {
  const speed = M.tracking!.speed;

  // A constant 0.9 m/s down a polyline reads, in the air, as a model being slid
  // along a rail. The pace varies instead — but three things have to survive
  // that, and each of them is load-bearing for the mission rather than for the
  // look.

  it('never walks backwards', () => {
    // The pace multiplies the speed, so a negative one would run the animal
    // back down its own patrol and hand the pilot a target that reverses.
    for (let t = 0; t < 600; t += 0.05) expect(amblePace(t)).toBeGreaterThan(0);
  });

  it('comes close to a stop and picks up again', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 600; t += 0.05) {
      const p = amblePace(t);
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
    // Slow enough to read as stopping over something, brisk enough that it is
    // plainly the same animal moving off again.
    expect(lo).toBeLessThan(0.2);
    expect(hi).toBeGreaterThan(1.7);
  });

  it('keeps the mission arithmetic: the mean pace is still the mission speed', () => {
    // Every promise the briefing makes — the eighty to a hundred second
    // there-and-back, "it will walk back towards you" — is a promise about
    // distance covered. The amble redistributes it; it must not change it.
    for (const window of [120, 300, 480]) {
      const mean = ambleDistance(window, speed) / window;
      expect(mean).toBeGreaterThan(speed * 0.97);
      expect(mean).toBeLessThan(speed * 1.03);
    }
  });

  it('is monotonic, so the walk never rewinds', () => {
    let last = -1;
    for (let t = 0; t < 300; t += 0.1) {
      const d = ambleDistance(t, speed);
      expect(d).toBeGreaterThan(last);
      last = d;
    }
  });

  it('starts the patrol at the head of the path, as the constant walk does', () => {
    expect(ambleDistance(0, speed)).toBeCloseTo(0, 9);
    const scratch = { x: 0, y: 0, z: 0, heading: 0 };
    const route = TIGER_ROUTES[0];
    tigerAtDistance(route, 0, scratch);
    expect(scratch.x).toBeCloseTo(route.path[0].at[0], 5);
    expect(scratch.z).toBeCloseTo(route.path[0].at[1], 5);
  });

  it('walks the same path the routes were measured along', () => {
    // The amble changes WHEN the animal is somewhere, never WHERE it can be:
    // the clearances in check-tiger-routes.mjs are measured along the polyline,
    // and a pace that wandered off it would put the tiger inside a trunk.
    const scratch = { x: 0, y: 0, z: 0, heading: 0 };
    for (const route of TIGER_ROUTES) {
      for (let t = 0; t < 600; t += 0.9) {
        tigerAtDistance(route, ambleDistance(t, speed), scratch);
        let nearest = Infinity;
        for (let i = 1; i < route.path.length; i++) {
          const a = route.path[i - 1].at;
          const b = route.path[i].at;
          const vx = b[0] - a[0];
          const vz = b[1] - a[1];
          const len2 = vx * vx + vz * vz;
          const f = Math.min(
            1,
            Math.max(0, ((scratch.x - a[0]) * vx + (scratch.z - a[1]) * vz) / len2),
          );
          nearest = Math.min(
            nearest,
            Math.hypot(scratch.x - (a[0] + vx * f), scratch.z - (a[1] + vz * f)),
          );
        }
        expect(nearest).toBeLessThan(0.05);
      }
    }
  });
});

describe('TC-504 the aircraft starts ON the pad', () => {
  // Reported as a bang on every launch and every reset: the drone was spawned
  // 0.35 m up and fell onto its own helipad at 2.5 m/s. A spawn height is a
  // RESTING height, not a clearance.

  /** How far the drone's lowest colliders — its four feet — sit below the body
   *  origin, metres. `Drone.tsx` builds them at y -0.012 with a half-height of
   *  0.012; the airframe therefore rests this far above what it stands on. */
  const FOOT_DROP = 0.024;
  /** The spawn apron in `ForestEnv` holds a floor at exactly 0 under the pad
   *  until the 15 MB terrain streams in, and the road there is measured at
   *  -0.013..+0.015 — so the higher of the two, and the resting surface, is 0. */
  const PAD_SURFACE = 0;

  it('spawns at the height it comes to rest at, not above it', () => {
    const y = forest.spawn.position[1];
    const rest = PAD_SURFACE + FOOT_DROP;
    // Never below rest, or the feet start inside the deck and are pushed out.
    expect(y).toBeGreaterThanOrEqual(rest);
    // And never far enough above it to be a fall: 2 cm of settle is 0.6 m/s,
    // which is a touch. The old 0.35 arrived at 2.5.
    expect(y - rest).toBeLessThan(0.02);
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

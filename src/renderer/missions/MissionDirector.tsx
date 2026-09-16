import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { targetMark } from './targetScreen';
import {
  useMissionStore,
  activeZone,
  guidanceHidden,
  legOf,
  type MissionLeg,
} from '../state/missionStore';
import { dronePose } from '../sim/drone/pose';
import {
  deliveryCount,
  deliveryOf,
  dropZoneOf,
  flatDist,
  requiredCheckpoints,
  requiredLeft,
  nextTargetOf,
  rescueZoneOf,
  trackingLit,
  zoneGroundY,
  type Mission,
  type MissionZone,
} from './types';
import { tigerPose, resetTigerPose } from './tigerPose';
import { beamPose } from './beamPose';
import { playCollect, playDrop, playFail, playLatch, playSuccess, playWhoosh } from '../audio/sfx';
import { resetForMission } from './reset';
import { resetStick } from '../input/controls';

// ----------------------------------------------------------------------------
// The mission runtime.
//
// Headless — it renders nothing — but it lives inside the mission <Canvas>, so
// its useFrame ticks in lock-step with the sim, which is what lets a zone test
// read the same transform the pilot is flying.
//
// It is NOT the Flight School Director. That one runs Explain -> Demonstrate ->
// Practice -> Reward and owns a scripted autopilot; a mission has no demo, no
// retry loop and no lesson rubric. What the two share is the checkpoint, and
// that is shared for real: both draw `CheckpointSphere` and score off its
// trigger.
//
// Route checkpoints are NOT scored here. They are scored where they are drawn
// (`MissionMarkers`), because the ball's own trigger volume is the promise the
// marker makes by being a ball — one answer to "did that count", not two.
// ----------------------------------------------------------------------------

/** How long a banner stays up, seconds. Long enough to read at speed, short
 *  enough that two in a row do not stack. */
const BANNER_SEC = 2.6;
/** How long a Mission Control line stays up, seconds. */
const RADIO_SEC = 5.5;

/** Scratch for the tracking light test. The Director runs every frame, and
 *  nothing in a frame loop allocates. */
const _toAnimal = { x: 0, y: 0, z: 0 };
const _beamAxis = { x: 0, y: -1, z: 0 };

/** Distances the destination is called out at, metres. Three calls across a
 *  90 m crossing, and nothing between them — guidance, not a killstreak. */
/** How long a pilot may stay outside `mission.strayRadius` before the attempt
 *  ends. Long enough to turn round and come back from the edge under power, and
 *  the banner is re-shown while it runs, so the failure is never a surprise. */
const STRAY_GRACE_SEC = 15;

const CALL_FAR = 150;
const CALL_NEAR = 75;
const CALL_APPROACH = 40;

/**
 * How much further out than the arrival circle the pilot has to drift before the
 * mission decides they have LEFT.
 *
 * Entering and leaving on the same circle means a drone sitting on the boundary
 * changes leg every frame, which flickers the objective line and re-arms every
 * banner behind it. The delivery has the same gap between its two numbers for
 * the same reason.
 */
const LEAVE_HYSTERESIS = 1.35;

/** How close to base counts as "over the pad", metres. Wider than the landing
 *  zone itself: this only decides when the pilot is TOLD to land. */
const BASE_CALL_R = 9;

/** A touchdown has to be still for this long before it is a landing, seconds. */
const LAND_SETTLE = 1;
/** Ground speed and climb rate under which the drone counts as settled, m/s. */
const STILL = 0.6;
/** Seconds the SAFE LANDING card holds before the result screen takes over. */
const LAND_DWELL = 1.6;

/** Publish HUD numbers at 10 Hz, not per frame — a distance that changes sixty
 *  times a second is unreadable, and this is a machine with frames to spare for
 *  nothing. */
const PUBLISH_HZ = 10;

/**
 * The tracking mission's live numbers, written by the leg and read by the
 * publish block a few lines later.
 *
 * Module scope, like every other scratch object in the frame path: nothing may
 * allocate inside a 250 Hz step, and there is exactly one Director alive at a
 * time — the mission view mounts one and tears it down with the mission.
 */
const trackOut = { lock: 0, lit: false, tooClose: false };

interface ZoneProbe {
  /** Horizontal distance from the mark, metres. */
  flat: number;
  centred: boolean;
  inBand: boolean;
  steady: boolean;
  /** All three, which is what the hold timer runs on. */
  ok: boolean;
  /** Height over THIS zone's deck, metres. Read by the fire, which cares how far
   *  DOWN the drone has gone as well as whether it is in the band. */
  agl: number;
}

function probeZone(mission: Mission, zone: MissionZone): ZoneProbe {
  const sim = useSimStore.getState();
  const p = dronePose.position;
  const flat = flatDist(p, zone.at);
  // Against THIS zone's deck, not the mission's. On the forest the fire burns
  // twelve and a half metres below the clearing the pilot launched from, and a
  // band measured off the clearing is a hover under the terrain.
  const agl = p.y - zoneGroundY(mission, zone);
  const centred = flat <= zone.radius;
  const inBand = agl >= zone.band.min && agl <= zone.band.max;
  const steady =
    sim.groundSpeed <= zone.maxGroundSpeed && Math.abs(sim.verticalSpeed) <= zone.maxVerticalSpeed;
  return { flat, centred, inBand, steady, ok: centred && inBand && steady, agl };
}

export function MissionDirector() {
  const phase = useMissionStore((s) => s.phase);

  /** Seconds of the attempt. The single clock everything transient hangs off. */
  const clock = useRef(0);
  /** Hold timers for the pickup and drop tests. */
  const pickupHold = useRef(0);
  const dropHold = useRef(0);
  /** How long the drone has been down and still, seconds. */
  const landHold = useRef(0);
  /** Seconds of suppression served, on a fire mission. Unlike `dropHold` this
   *  does NOT reset when the pilot drifts off: the fire stays as far out as it
   *  has been put out, which is what makes an interruption a pause rather than
   *  a punishment. */
  const suppressed = useRef(0);
  /** Whether the tank was spraying last frame, so INTERRUPTED is announced on
   *  the edge rather than every frame the drone is off the mark. */
  const spraying = useRef(false);
  /**
   * How long the aircraft has been continuously within the fire zone's limits.
   *
   * The speed test is an INSTANT: a drone oscillating around a hover dips under
   * the limits for a frame at every turning point, so a pilot still fighting the
   * aircraft got the tank switching on and off underneath them. What the mission
   * asks for is a position HELD, and holding is something you can only measure
   * over time.
   */
  const steadyFor = useRef(0);
  /** Whether the pilot has been told, this attempt, that they are searching from
   *  above the roofline. Once: a banner that re-fired on every climb would be
   *  nagging a pilot who has understood it and is transiting. */
  const warnedHigh = useRef(false);
  /** Counts down the SAFE LANDING card before the result screen. */
  const landDwell = useRef(0);
  /** `flightStore.touches` when the attempt began — it is a running total. */
  const touchBase = useRef(0);
  /** The sim's reset counter as this Director last left it, so R is detected. */
  const lastResetToken = useRef(0);
  /** Throttles the HUD publish. */
  const publishAt = useRef(0);
  /** A Mission Control line waiting on the mission clock — see the delivery. */
  const queued = useRef<{ key: string; at: number } | null>(null);
  /** Last delivery checklist published, so the HUD is not re-rendered sixty
   *  times a second with the same three booleans. */
  const lastChecks = useRef('');
  /** Last ring target published, so an unchanged one is not written every tick. */

  /** Whether the pilot has already been told the route is not finished.
   *
   *  Once per attempt, like every other banner: a drone held over the mark with
   *  checkpoints outstanding would otherwise be shouted at every frame. */
  const announcedGate = useRef(false);

  /** Whether the delivery zone has already been announced this attempt.
   *
   *  The approach ring can be crossed several times — a pilot who overshoots and
   *  comes back, or who hovers on the boundary while lining up, does it twice in
   *  a few seconds — and the leg flips each time. The banner is a piece of
   *  guidance, not a scoreboard, so it is said once and the leg is free to move
   *  as often as the flying requires. */
  const announcedDrop = useRef(false);

  /** Seconds of unbroken hover served over the rescue zone, on a search mission.
   *
   *  Unlike the fire's `suppressed` this DOES reset when the pilot drifts off,
   *  and the difference is the hold's length. Ten seconds that reset on every
   *  correction is a hold nobody finishes; five is short enough that a reset is
   *  a retry rather than a punishment, and the brief asks for the interruption
   *  explicitly — holding a position accurately is the skill being tested. */
  const rescueHold = useRef(0);
  /** Whether the hold was filling last frame, so INTERRUPTED is said on the edge
   *  rather than on every frame the drone is off the mark. */
  const holding = useRef(false);

  /** Seconds spent outside the mission area, and the clock time the last recall
   *  banner was shown at. Both reset the moment the drone is back inside. */
  const strayFor = useRef(0);
  const straySaidAt = useRef(-99);

  // ---- The tracking mission's own timers ---------------------------------
  //
  // They are refs rather than store fields because they move every frame and
  // the HUD reads them at ten hertz like everything else — see the publish
  // block. A lock that wrote to zustand sixty times a second would re-render
  // the whole overlay on every frame of a five second hold.

  /** Seconds of light held on the animal, 0 to `lockSeconds`. */
  const lockFor = useRef(0);
  /** Whether the animal was lit last frame, so LOST is said on the edge. */
  const wasLit = useRef(false);
  /** Seconds the animal has been out of the light since the lock began. What
   *  decides when the mission gives up on the hold and sends the pilot back to
   *  searching, rather than leaving a half-full ring on screen for ever. */
  const unlitFor = useRef(0);
  /** Seconds spent inside the animal's safe distance, and when the last
   *  warning was shown. Both reset the moment the drone backs off. */
  const disturbFor = useRef(0);
  const disturbSaidAt = useRef(-99);
  /** Seconds of light held on the tiger in the sighting that is still running.
   *
   *  What arms the safe-distance rule, and it is a duration rather than a flag
   *  for a reason — see `MissionTracking.sightArmSec`. It is deliberately not
   *  `store.located`, which on this mission is not set until the whole
   *  observation is finished: the rule has to be live for the five seconds in
   *  between, which is exactly when the pilot is closest to the animal. It is
   *  zeroed when the mission gives up on the hold and goes back to searching,
   *  because at that moment the pilot no longer knows where the animal is. */
  const sightedFor = useRef(0);
  /** Last tracking numbers published, so an unchanged set is not written. */
  const lastTrack = useRef('');

  /** Everything the attempt accumulates, in one place. A new timer added to the
   *  runtime has to be cleared here, and the compiler will not remind you — so
   *  they all live together rather than beside the code that uses them. */
  function armAttempt(): void {
    clock.current = 0;
    pickupHold.current = 0;
    dropHold.current = 0;
    landHold.current = 0;
    landDwell.current = 0;
    suppressed.current = 0;
    spraying.current = false;
    rescueHold.current = 0;
    holding.current = false;
    steadyFor.current = 0;
    warnedHigh.current = false;
    publishAt.current = 0;
    queued.current = null;
    lastChecks.current = '';
    announcedDrop.current = false;
    announcedGate.current = false;
    lockFor.current = 0;
    wasLit.current = false;
    unlitFor.current = 0;
    disturbFor.current = 0;
    disturbSaidAt.current = -99;
    sightedFor.current = 0;
    lastTrack.current = '';
    // The animal's own walk clock is NOT reset — it has been out there since
    // before the drone armed, and putting it back to the head of the path on
    // every retry is the one thing that would make the patrol memorisable. What
    // is reset is where the runtime believes it is, so the first frame of a new
    // attempt never judges a lock against last attempt's position.
    resetTigerPose();
    touchBase.current = useFlightStore.getState().touches;
    lastResetToken.current = useSimStore.getState().resetToken;
  }

  // The mission owns two pieces of flight behaviour while it is open and hands
  // both back on the way out, exactly as Flight School does.
  //
  // 1. ALTITUDE HOLD is pinned. The delivery is judged on a height band and a
  //    settle test, and in Acro a centred stick is a falling drone — the mission
  //    would be asking for a hover the mode does not offer.
  // 2. An auto-landing shuts the motors down, which is the default in free
  //    flight and is what "land safely" should mean here too.
  useEffect(() => {
    const flight = useFlightStore.getState();
    const previousMode = flight.mode;
    flight.setMode('altitude-hold');
    flight.setAutoDisarmOnLand(true);
    return () => {
      useFlightStore.getState().setMode(previousMode);
    };
    // Mount-only: the mission is torn down and rebuilt when it changes.
  }, []);

  // Launching puts the aircraft back on the pad and the attempt back to zero.
  //
  // Keyed on the phase rather than on mount, because the briefing card does not
  // freeze the controls: a pilot who armed and lifted off while reading it would
  // otherwise start the clock from wherever they had got to. It also clears
  // whatever Flight School left on the sim — a spawn lift, a lesson's take-off
  // height — which is what stops a mission opening in mid-air.
  useEffect(() => {
    if (phase !== 'flying') return;
    resetForMission();
    armAttempt();
    // The opening call. Written since the mission was, and never played: the
    // pilot launched into silence and the first leg was the only one Mission
    // Control had nothing to say about.
    const m = useMissionStore.getState().mission;
    if (m) say(m, 'start');
    // `armAttempt` reads the sim's reset token, so it has to run after the reset
    // above has already bumped it.
  }, [phase]);

  // The in-picture pointer has nothing to point at once the flight is over, and
  // the singleton it reads outlives this component. Cleared on the way out so a
  // result card is not sitting behind a chevron aimed at the last drop.
  useEffect(() => {
    return () => {
      targetMark.active = false;
    };
  }, []);

  useFrame((_, rawDt) => {
    const store = useMissionStore.getState();
    const mission = store.mission;
    if (!mission || store.phase !== 'flying') {
      targetMark.active = false;
      return;
    }

    // A frame lost to a shader compile or a window drag must not push a whole
    // hold through in one step — every timer below is fed from this.
    const dt = Math.min(rawDt, 0.1);

    // R puts the drone back on the pad, so it has to put the ATTEMPT back to the
    // start too: the package back on its mark, the markers re-lit, the points
    // back to zero and the clock back to zero. Without this the aircraft
    // respawns into a mission that still believes it is carrying something.
    const token = useSimStore.getState().resetToken;
    if (token !== lastResetToken.current) {
      armAttempt();
      store.restart();
      // A restart is a fresh attempt, so it gets the opening call again — the
      // phase has not changed, so the effect above will not fire for it.
      say(mission, 'start');
      return;
    }

    clock.current += dt;
    const flight = useFlightStore.getState();
    const collisions = Math.max(0, flight.touches - touchBase.current);

    // ---- Failures ---------------------------------------------------------
    // A crash ends the mission. Touching a building does NOT: it is counted, it
    // costs the rating, and the flight carries on — which is what the brief asks
    // for and what `flightStore` already distinguishes.
    if (flight.crashed) {
      playFail();
      store.setCollisions(collisions);
      store.fail('crash');
      return;
    }
    // Outside the mission area: a recall, a countdown, and only then a failure.
    // Measured flat from the base, so an altitude the pilot cannot reach anyway
    // never counts as straying, and skipped entirely by a mission that declares
    // no bound.
    if (mission.strayRadius !== undefined) {
      const b = mission.zones.base.at;
      const p = dronePose.position;
      const out = Math.hypot(p.x - b[0], p.z - b[1]) > mission.strayRadius;
      if (!out) {
        strayFor.current = 0;
        straySaidAt.current = -99;
      } else {
        strayFor.current += dt;
        // Re-said rather than said once: the pilot is flying away from the
        // banner that told them, and the seconds left are the whole message.
        if (clock.current - straySaidAt.current >= 4) {
          straySaidAt.current = clock.current;
          store.showBanner(
            {
              kind: 'warn',
              title: 'RETURN TO MISSION AREA',
              sub: `Turn back within ${Math.max(1, Math.ceil(STRAY_GRACE_SEC - strayFor.current))} s`,
            },
            BANNER_SEC,
          );
          playFail();
        }
        if (strayFor.current >= STRAY_GRACE_SEC) {
          playFail();
          store.setCollisions(collisions);
          store.fail('strayed');
          return;
        }
      }
    }
    if (clock.current >= mission.timeLimitSec) {
      playFail();
      store.setCollisions(collisions);
      store.fail('timeout');
      return;
    }

    // ---- The state machine ------------------------------------------------
    let leg: MissionLeg = store.leg;

    // WHICH PACKAGE, and therefore which mark.
    //
    // Read once a frame and used everywhere below instead of `mission.zones.drop`.
    // A single-drop mission answers with its one zone and `run` is null, so every
    // branch reads exactly as it did; a multi-point mission answers with the
    // destination for the run the pilot is on, and cannot be talked into testing
    // any other — which is the whole of the brief's "no skipping".
    const run = deliveryOf(mission, store.runIndex);
    const runs = deliveryCount(mission);
    // The mark in the middle of the mission: whichever package this run is for,
    // or — on a search — whichever site this attempt drew. Both are an index
    // into a list held by the store, and reading `zones.drop` instead would send
    // the arrow at the first entry for the whole flight.
    const dropZone = mission.search
      ? rescueZoneOf(mission, store.siteIndex)
      : dropZoneOf(mission, store.runIndex);

    if (mission.tracking && (leg === 'searching' || leg === 'confirming')) {
      // ---- The tracking mission --------------------------------------------
      //
      // The only leg in the app judged against something that MOVES. There is
      // no zone: `probeZone` measures a drone against a mark, and by the time a
      // mark could be drawn round this target it would be standing somewhere
      // else. What replaces it is the light — the same cone `DroneSpotlight`
      // draws, tested against the same numbers, so what the pilot sees lit and
      // what the runtime calls lit are one thing.
      const track = mission.tracking;
      const p = dronePose.position;

      // Height above the ANIMAL's own deck, not the clearing. On this map the
      // gorge floor is twenty-seven metres below the pad: a cone measured from
      // the mission's `groundY` would be a pool computed for air the tiger is
      // nowhere near.
      const agl = p.y - tigerPose.y;
      const dx = p.x - tigerPose.x;
      const dz = p.z - tigerPose.z;
      const flat = Math.hypot(dx, dz);
      const range = Math.hypot(flat, agl);

      // TOO CLOSE, and it is a 3-D distance: the whole mission is flown over
      // the target, so a flat test would be passed by a drone hovering a metre
      // above its back.
      const inside = tigerPose.present && range < track.minSafeDistance;
      // LIT: the light is on the animal, and that is the whole test — no
      // height band, at five metres or at thirty. Judged against the beam the
      // lamp actually DREW, aimed ahead of the nose, not one rebuilt here from
      // the airframe — see `beamPose` and `trackingLit`.
      _toAnimal.x = tigerPose.x - beamPose.x;
      _toAnimal.y = tigerPose.y - beamPose.y;
      _toAnimal.z = tigerPose.z - beamPose.z;
      _beamAxis.x = beamPose.dx;
      _beamAxis.y = beamPose.dy;
      _beamAxis.z = beamPose.dz;
      const lit = tigerPose.present && beamPose.present && trackingLit(track, _toAnimal, _beamAxis);
      if (lit) sightedFor.current += dt;

      /*
       * AND THE DISTANCE RULE ONLY BITES WHILE THE PILOT CAN SEE THE ANIMAL.
       *
       * This was the first thing flying the mission found, and it was fatal: the
       * ridge-road patrol walks along the dirt road the pilot naturally follows
       * out of the clearing, at night, with nothing on screen saying it is
       * there. A pilot searching at a sensible 5 or 6 metres flew over it,
       * entered the keep-off sphere without ever seeing it, and lost the
       * attempt at thirty-four seconds having done nothing wrong.
       *
       * You cannot be judged on your distance to something the mission has not
       * told you about. Before a sighting a close pass is a MISTAKE TO BE TOLD
       * ABOUT — see the banner below, which says to climb — and the light
       * refusing to count is what makes flying low pointless rather than fatal.
       *
       * ARMING IT ON A LATCHED FLAG WAS STILL WRONG, and it is what failed the
       * attempt in the report this replaces. Two ways:
       *
       *   1. One frame of light set it. The beam crossing a tiger for a
       *      sixteenth of a second, behind the aircraft, off screen, armed a
       *      rule the pilot never knew had been armed.
       *   2. It never came back off. This target WALKS — a 36 to 44 m patrol —
       *      and the mission deliberately shows no marker for it. A minute
       *      after losing it the pilot has no more idea where it is than before
       *      they ever saw it, and "you had the tiger" is not true any more.
       *
       * So it arms on a sighting the pilot was given time to notice, and it
       * disarms again when the mission itself gives up on the hold and goes
       * back to searching — the same moment, and the same reasoning, as the
       * TARGET LOST banner. While it is armed the pilot is being told where the
       * animal is every frame, by the ring filling on their own HUD.
       */
      const armed = sightedFor.current >= track.sightArmSec;
      const close = inside && armed;

      // The close pass a pilot could not have known about. Said, not punished,
      // and worded as the fix rather than as the offence.
      if (inside && !armed && clock.current - disturbSaidAt.current > 3.5) {
        disturbSaidAt.current = clock.current;
        store.showBanner(
          {
            kind: 'warn',
            title: 'TOO CLOSE TO OBSERVE',
            sub: `Give it ${track.minSafeDistance} m of room — the beam does not count from this close`,
          },
          BANNER_SEC,
        );
      }

      if (close) {
        disturbFor.current += dt;
        // Re-shown while the grace runs, so the failure is never a surprise —
        // the same contract straying has.
        if (clock.current - disturbSaidAt.current > 2.4) {
          disturbSaidAt.current = clock.current;
          store.showBanner(
            {
              kind: 'warn',
              title: 'TOO CLOSE — BACK OFF',
              sub: `You are disturbing the animal. Climb away within ${Math.max(
                1,
                Math.ceil(track.disturbGraceSec - disturbFor.current),
              )} s`,
            },
            BANNER_SEC,
          );
          playFail();
        }
        if (disturbFor.current >= track.disturbGraceSec) {
          playFail();
          store.setCollisions(collisions);
          store.fail('disturbed');
          return;
        }
      } else {
        disturbFor.current = 0;
      }

      // TOO HIGH TO SEE ANYTHING — and it is ADVICE now, not a rule. Nothing
      // refuses to count up here; the pool simply arrives at the forest floor
      // barely above the ambient and spread over fifteen metres, so the pilot
      // is searching by a light that is no longer showing them anything. Said
      // once — a banner that re-fired on every climb would nag a pilot who has
      // understood it and is transiting.
      if (tigerPose.present && agl > track.maxTrackAgl && !warnedHigh.current) {
        warnedHigh.current = true;
        store.showBanner(
          {
            kind: 'warn',
            title: 'THE POOL IS TOO THIN UP HERE',
            sub: 'Come down into the trees — from this height the beam shows you nothing',
          },
          BANNER_SEC,
        );
      }

      if (leg === 'searching') {
        if (lit) {
          // FOUND — but NOT `located`. That flag restores every mark in the
          // app, and there is no honest mark to restore here: the target walks.
          // It is set at the end of the observation instead, where it turns the
          // guidance back on for the flight home. See `guidanceHidden`.
          leg = 'confirming';
          store.setLeg(leg);
          lockFor.current = 0;
          unlitFor.current = 0;
          playSuccess();
          store.showBanner(
            {
              kind: 'good',
              title: 'TIGER SIGHTED',
              sub: `Hold the light on it for ${track.lockSeconds} seconds`,
            },
            BANNER_SEC,
          );
          say(mission, 'located');
        }
      } else {
        // ---- The lock ------------------------------------------------------
        //
        // It DRAINS rather than resetting. A reset is right for a hover over a
        // person who is not going anywhere — drift off the mark and you have
        // stopped doing the task. Here the target is walking out of the pool on
        // its own, and a bar that went to zero the instant a trunk passed
        // between them would make the mission a lottery rather than a skill.
        // Draining at twice the fill rate still means a pilot who loses it for
        // half the hold finishes with nothing, so it costs — it just costs
        // proportionally.
        if (lit) {
          const before = lockFor.current;
          lockFor.current = Math.min(track.lockSeconds, lockFor.current + dt);
          unlitFor.current = 0;
          // ONE TICK PER SECOND SERVED, and the ring is what carries the rest.
          //
          // The brief asked whether the lock should be a progress bar or an
          // audio cue; it is both, and this is the cheap half. A pilot holding
          // a light on a walking animal at night is looking at the ANIMAL, not
          // at the top of the HUD — the tick is what tells them it is still
          // counting without asking them to look away. On the whole number, so
          // five seconds is five ticks rather than a rattle.
          if (Math.floor(lockFor.current) > Math.floor(before)) playCollect();
        } else {
          lockFor.current = Math.max(0, lockFor.current - dt * 2);
          unlitFor.current += dt;
        }

        // LOST, on the edge only. Said once per loss rather than once per frame.
        if (wasLit.current && !lit) {
          store.showBanner(
            { kind: 'warn', title: 'TARGET LOST', sub: 'Find it again — it is still moving' },
            BANNER_SEC,
          );
        }

        // Give up on the hold and go back to searching once the bar is empty
        // AND the animal has genuinely gone. Both conditions: a bar at zero
        // with the tiger back in the pool is a pilot who has recovered, and
        // throwing them back to 'searching' would take the ring off screen at
        // the moment it was about to start filling again.
        if (lockFor.current <= 0 && unlitFor.current >= 3) {
          leg = 'searching';
          store.setLeg(leg);
          unlitFor.current = 0;
          // And the safe-distance rule goes with it. The animal is somewhere in
          // the trees walking a patrol the pilot cannot see and the mission
          // will not draw, so from here they are searching for it exactly as
          // they were at the start — and may not be failed for finding it with
          // the airframe instead of the light.
          sightedFor.current = 0;
        }

        if (lockFor.current >= track.lockSeconds) {
          // OBSERVED, and on this mission that is the END of it.
          // `located` goes true, and it still has to: it is the one gate on
          // every piece of target guidance in the app, and leaving it false
          // through the completion card would keep the whole HUD suppressed
          // while the result is being read. The LEG is set once, below, to
          // whichever of the two endings this mission has — setting 'delivered'
          // first and 'complete' a line later would publish a leg the mission
          // never flies and re-render the overlay for it.
          store.setLocated();
          store.takeZone('drop', 'OBSERVATION COMPLETE');
          lockFor.current = 0;
          unlitFor.current = 0;
          playSuccess();
          say(mission, 'delivered');

          if (mission.endsAtDrop) {
            // Straight to `complete`, exactly as the fire and the rescue do.
            // `legOf` and `activeZone` both read `complete` as nothing live, so
            // the station's ring never lights for a flight home that is not
            // asked for.
            //
            // The drone is NOT disarmed. It is hovering over a ravine sixty
            // metres from the pad with the score already banked, and cutting
            // the motors here would drop it out of the sky in front of the
            // pilot for the whole dwell — and onto the animal the mission has
            // just finished telling them not to disturb.
            leg = 'complete';
            store.setLeg(leg);
            landDwell.current = LAND_DWELL;
            store.showBanner(
              {
                kind: 'good',
                title: 'OBSERVATION COMPLETE',
                sub: 'Sighting logged — the survey is done',
              },
              BANNER_SEC,
            );
          } else {
            leg = 'delivered';
            store.setLeg(leg);
            store.showBanner(
              {
                kind: 'good',
                title: 'OBSERVATION COMPLETE',
                sub: 'Sighting logged — return to the ranger station and land',
              },
              BANNER_SEC,
            );
            queued.current = { key: 'home', at: clock.current + 1.2 };
          }
        }
      }

      wasLit.current = lit;
      // Refs, not the store: the publish block writes them at the HUD's rate
      // along with everything else.
      trackOut.lock = lockFor.current / track.lockSeconds;
      trackOut.lit = lit;
      trackOut.tooClose = close;
    } else if (leg === 'searching' && mission.search) {
      // ---- The search ------------------------------------------------------
      //
      // The only leg in the app with no destination. Nothing is lit, nothing is
      // pointed at, and the one thing the pilot is given is how STRONG the
      // signal is — never which way it lies. `activeZone('searching')` answers
      // null, which is what silences the mark, the radar dot and the readout;
      // this branch is what fills the silence with something useful.
      const search = mission.search;
      const site = search.sites[Math.min(store.siteIndex, search.sites.length - 1)];
      const flat = flatDist(dronePose.position, site.at);

      // Zero outside the detect radius, and zero MEANS "not drawn" — see the
      // store's note. A signal cell sitting at 0% across the whole map is a
      // detector that works at any range: a pilot flies a grid, watches for it
      // to leave zero, and has triangulated the casualty without ever looking
      // out of the window.
      //
      // Inside it, a continuous ramp rather than steps, for the same reason.
      // A stepped readout is a compass — fly a heading, wait for the jump, turn
      // — and what this mission is teaching is to fly towards the thing you can
      // see.
      // TOO HIGH TO SEARCH.
      //
      // Both radii are flat, so without this a pilot who simply climbs to the
      // aircraft's ceiling is above every roof with the sector spread out below
      // and picks the casualty up the moment they pass overhead — no streets
      // flown, no zone searched. The roof turns "search the zone" back into
      // something done among the buildings: over it the detector is silent and
      // nothing can be confirmed, at any horizontal distance.
      const agl = dronePose.position.y - zoneGroundY(mission, site.zone);
      const searchable = agl <= search.maxDetectAgl;

      // The roof is only a fair rule if the pilot is told it exists. Silence
      // above it is indistinguishable from a search in the wrong street, and
      // the one thing they would never guess is that the fix is to descend.
      if (!searchable && !warnedHigh.current) {
        warnedHigh.current = true;
        store.showBanner(
          {
            kind: 'warn',
            title: 'TOO HIGH TO SEARCH',
            sub: 'Come down below the rooftops — you cannot pick the signal up from here',
          },
          BANNER_SEC,
        );
      }

      const span = Math.max(1e-3, search.detectRadius - search.confirmRadius);
      const signal =
        !searchable || flat >= search.detectRadius
          ? 0
          : Math.min(1, (search.detectRadius - flat) / span);
      if (signal > 0) {
        // Said once, on the first detection. From here the number carries it.
        if (say(mission, 'detected')) {
          store.showBanner(
            {
              kind: 'warn',
              title: 'WEAK EMERGENCY SIGNAL DETECTED',
              sub: 'You are within range. Slow down and search visually',
            },
            BANNER_SEC,
          );
          playWhoosh();
        }
      }

      if (searchable && flat <= search.confirmRadius) {
        // FOUND. This is the only place `located` is ever set, and setting it is
        // what restores every piece of guidance in the app — the mark appears,
        // the dot comes back, the readout starts answering. It cannot be
        // reached from anywhere but here.
        leg = 'confirming';
        store.setLeg(leg);
        store.setLocated();
        store.setSignal(1);
        rescueHold.current = 0;
        holding.current = false;
        lastChecks.current = '';
        playSuccess();
        store.showBanner(
          {
            kind: 'good',
            title: 'CASUALTY LOCATED',
            sub: 'Hover steady over them to drop the food box',
          },
          BANNER_SEC,
        );
        say(mission, 'located');
      }
    } else if (leg === 'confirming' && mission.search) {
      // ---- The confirmation hover -------------------------------------------
      //
      // From here the mission is a placement task the pilot already knows how to
      // fly, and it is judged by the same `probeZone` the other three use. What
      // is different is only the reset: drift out and the bar goes back to zero.
      const zone = rescueZoneOf(mission, store.siteIndex);
      const z = probeZone(mission, zone);

      // The same dwell the fire uses, and for the same reason: the speed test is
      // an INSTANT, and a drone oscillating around a hover dips under any limit
      // for a frame at every turning point. 'Steady' has to mean held.
      steadyFor.current = z.steady ? steadyFor.current + dt : 0;
      const settled = steadyFor.current >= STEADY_ARM_SEC;
      const on = z.centred && z.inBand && settled;
      rescueHold.current = on ? rescueHold.current + dt : 0;

      // INTERRUPTED, on the edge only — a banner per frame would be the screen.
      // Only once the hold had actually started: a pilot still flying into the
      // zone has not been interrupted, they have not begun.
      if (holding.current && !on && rescueHold.current === 0) {
        store.showBanner(
          {
            kind: 'warn',
            title: 'RESCUE CONFIRMATION INTERRUPTED',
            sub: 'Get back over the zone and hold it steady',
          },
          BANNER_SEC,
        );
        playFail();
      }
      holding.current = on;

      const hold = Math.round(Math.min(1, rescueHold.current / zone.hold) * 20) / 20;
      const key = `${z.centred}${z.inBand}${settled}${hold}`;
      if (key !== lastChecks.current) {
        lastChecks.current = key;
        store.setChecks({ centred: z.centred, inBand: z.inBand, steady: settled, hold });
      }

      if (rescueHold.current >= zone.hold) {
        leg = 'delivered';
        store.setLeg(leg);
        store.takeZone('drop', 'FOOD BOX DELIVERED');
        // The box comes off here and falls onto the roof beside them.
        store.setPayload('delivered');
        rescueHold.current = 0;
        holding.current = false;
        steadyFor.current = 0;
        lastChecks.current = '';
        store.setChecks({ centred: false, inBand: false, steady: false, hold: 0 });
        playDrop();
        playSuccess();
        store.showBanner(
          {
            kind: 'good',
            title: 'FOOD BOX DELIVERED',
            sub: 'Supplies are with them — return to base and land',
          },
          BANNER_SEC,
        );
        say(mission, 'delivered');
        if (mission.endsAtDrop) {
          // Finding them and holding over them IS the job — straight to
          // `complete`, exactly as the fire does, so the base ring and the
          // pointer never light for a flight home that is not asked for.
          leg = 'complete';
          store.setLeg(leg);
          landDwell.current = LAND_DWELL;
        } else {
          queued.current = { key: 'home', at: clock.current + 1.2 };
        }
      }
    } else if (leg === 'toPickup') {
      const z = probeZone(mission, mission.zones.pickup);
      pickupHold.current = z.ok ? pickupHold.current + dt : 0;
      // Collecting the package asks for the same hover the drop does — centred,
      // in the band, steady — so the pilot is shown the same three conditions
      // here rather than being left to guess why the latch will not close.
      // Quantised and key-guarded exactly as the drop's are, for the same
      // reason: the bar moves in 5% steps, not once a frame.
      // The card is for a pilot who has ARRIVED. The collection leg begins at
      // take-off, so it only goes up inside the same approach ring the drop
      // uses — otherwise it hangs there from the pad, ticking Height and Steady
      // for a drone that has not left it.
      const nearPickup = z.flat <= mission.zones.pickup.radius * 3;
      if (nearPickup !== useMissionStore.getState().atPickup) store.setAtPickup(nearPickup);
      if (!nearPickup) {
        if (lastChecks.current !== '') {
          lastChecks.current = '';
          store.setChecks({ centred: false, inBand: false, steady: false, hold: 0 });
        }
      } else {
        const hold =
          Math.round(Math.min(1, pickupHold.current / mission.zones.pickup.hold) * 20) / 20;
        const key = `${z.centred}${z.inBand}${z.steady}${hold}`;
        if (key !== lastChecks.current) {
          lastChecks.current = key;
          store.setChecks({ centred: z.centred, inBand: z.inBand, steady: z.steady, hold });
        }
      }
      if (pickupHold.current >= mission.zones.pickup.hold) {
        // A search carries its box into the SEARCH, not to a marked drop.
        leg = mission.search ? 'searching' : 'carrying';
        store.setLeg(leg);
        store.setPayload('attached');
        store.takeZone('pickup', 'PICKUP', false);
        store.setAtPickup(false);
        lastChecks.current = '';
        store.setChecks({ centred: false, inBand: false, steady: false, hold: 0 });
        playLatch();
        // What was attached is not the same object on the two missions, and the
        // banner is the only place the pilot is told what they now carry. A
        // suppression pilot who reads 'Package secured' has been handed the
        // delivery's words for a tank they are about to empty in the air.
        store.showBanner(
          mission.search
            ? {
                kind: 'good',
                title: 'FOOD BOX ATTACHED',
                sub: 'Find the person on the rooftop inside the red zone',
              }
            : mission.fire
              ? {
                  kind: 'good',
                  title: 'FIREFIGHTING PAYLOAD ATTACHED',
                  sub: 'Suppression tank secured under the airframe',
                }
              : run
                ? {
                    // Named, because on this mission the pilot is carrying one of
                    // three and the banner is the only place they are told WHICH.
                    kind: 'good',
                    title: `${run.name.toUpperCase()} ATTACHED`,
                    sub: `${run.cargo} — bound for ${run.zone.label}`,
                  }
                : {
                    kind: 'good',
                    title: 'PAYLOAD ATTACHED',
                    sub: 'Package secured under the airframe',
                  },
          BANNER_SEC,
        );
        say(mission, 'pickup', run?.id);
      }
    } else if (leg === 'carrying') {
      const z = probeZone(mission, dropZone);
      // Awareness, then approach, then the careful line — each once, and only
      // once, so a pilot circling the block is not told the same thing four
      // times. `playRadio` is the thing that guarantees it.
      if (z.flat <= CALL_APPROACH) say(mission, 'approach', run?.id);
      else if (z.flat <= CALL_NEAR) say(mission, 'near', run?.id);
      else if (z.flat <= CALL_FAR) say(mission, 'far', run?.id);

      // Entering the zone is a change of JOB, not a score: from navigating the
      // city to positioning over a mark. That is why it gets its own leg.
      if (z.flat <= enterRadius(mission, dropZone)) {
        leg = 'toDrop';
        store.setLeg(leg);
        if (!announcedDrop.current) {
          announcedDrop.current = true;
          store.showBanner(
            mission.fire
              ? {
                  kind: 'info',
                  title: 'FIRE ZONE REACHED',
                  sub: 'Get over the affected area and hold your position',
                }
              : {
                  kind: 'info',
                  title: run ? `${run.zone.label.toUpperCase()} REACHED` : 'DELIVERY ZONE REACHED',
                  // A rooftop delivery is a HOVER, not a landing. The band
                  // starts a third of a metre over the slab and the aircraft is
                  // meant to stay there: touching a roof is touching a building,
                  // which the sim counts as a collision and the rating takes
                  // off. The wording has to say hold, not land.
                  sub:
                    run && run.zone.groundY !== undefined
                      ? 'Come in over the deck, centre on the mark and hold it just above the slab'
                      : 'Slow down, centre over the mark, then descend',
                },
            BANNER_SEC,
          );
          playWhoosh();
        }
      }
    } else if (leg === 'toDrop' && mission.fire) {
      // ---- Suppression -----------------------------------------------------
      //
      // The same hover the delivery asks for, held for ten seconds instead of
      // one, with the progress kept across an interruption rather than reset by
      // it. Everything else about the leg — the leg it falls back to, the
      // banner, the release — is the delivery's, because it IS the delivery:
      // something is being put down on a mark.
      const zone = mission.zones.drop;
      const fire = mission.fire;
      const z = probeZone(mission, zone);

      // Drifting well clear puts the pilot back on the navigation leg. The
      // boundary is the fire's own, and it is wider than the hover zone: an
      // aircraft nudged two metres off the mark is repositioning, not leaving.
      if (z.flat > fire.breakRadius * LEAVE_HYSTERESIS) {
        lastChecks.current = '';
        spraying.current = false;
        steadyFor.current = 0;
        store.setLeg('carrying');
        store.setChecks({ centred: false, inBand: false, steady: false, hold: 0 });
        // The tank has to be shut off HERE and not left to the publish below:
        // the next frame is on the navigation leg, which never touches the fire
        // state, so a plume left on would follow the drone across the forest.
        store.setFire({
          fireIntensity: 1 - suppressed.current / fire.suppressSec,
          suppressing: false,
        });
      } else if (mission.fire.loseLoadAgl !== undefined && z.agl < mission.fire.loseLoadAgl) {
        // INTO the fire. The band is five metres up and this is three, so the
        // pilot has already flown down through the hold and out the bottom of
        // it. The tank goes: `Payload` drops whatever it is carrying the moment
        // the attempt fails, so there is nothing to script here beyond ending it
        // — and there is no second tank, which is why this ends the attempt
        // rather than leaving an unwinnable one running.
        spraying.current = false;
        store.setFire({
          fireIntensity: 1 - suppressed.current / fire.suppressSec,
          suppressing: false,
        });
        playFail();
        store.setCollisions(collisions);
        store.fail('payload');
        return;
      } else {
        // Steady for long enough to mean it, and the CHECKLIST agrees.
        //
        // The dwell is folded into the tick rather than sitting behind it: three
        // green ticks over a bar that refuses to fill is the worst thing this
        // HUD can show, so 'Steady' lights at the same instant the tank does.
        steadyFor.current = z.steady ? steadyFor.current + dt : 0;
        const settled = steadyFor.current >= STEADY_ARM_SEC;
        const on = z.centred && z.inBand && settled;
        suppressed.current = on
          ? Math.min(fire.suppressSec, suppressed.current + dt)
          : suppressed.current;
        const done = suppressed.current / fire.suppressSec;

        // INTERRUPTED, on the edge only. A pilot fighting a hover crosses this
        // boundary repeatedly, and a banner per frame would be the whole screen.
        if (spraying.current && !on && done > 0 && done < 1) {
          store.showBanner(
            {
              kind: 'warn',
              title: 'SUPPRESSION INTERRUPTED',
              sub: 'Get back over the fire and hold it steady',
            },
            BANNER_SEC,
          );
          playFail();
        }
        if (!spraying.current && on) say(mission, 'spraying');
        spraying.current = on && done < 1;

        // Half way is worth saying out loud: it is the one point in a ten second
        // hover where the pilot learns the holding is working.
        if (done >= 0.5) say(mission, 'half');

        const hold = Math.round(Math.min(1, done) * 20) / 20;
        const key = `${z.centred}${z.inBand}${settled}${hold}${on}`;
        if (key !== lastChecks.current) {
          lastChecks.current = key;
          store.setChecks({ centred: z.centred, inBand: z.inBand, steady: settled, hold });
          store.setFire({ fireIntensity: 1 - hold, suppressing: on && hold < 1 });
        }

        if (done >= 1) {
          leg = 'delivered';
          store.setLeg(leg);
          store.setPayload('delivered');
          store.takeZone('drop', 'FIRE CONTAINED');
          lastChecks.current = '';
          spraying.current = false;
          steadyFor.current = 0;
          store.setChecks({ centred: false, inBand: false, steady: false, hold: 0 });
          store.setFire({ fireIntensity: 0, suppressing: false });
          playDrop();
          playSuccess();
          store.showBanner(
            { kind: 'good', title: 'FIRE CONTAINED', sub: 'The affected area is under control' },
            BANNER_SEC,
          );
          say(mission, 'delivered');
          if (mission.endsAtDrop) {
            // The job ended here. Straight to `complete` rather than through
            // the return legs: `legOf` and `activeZone` both read `complete` as
            // nothing live, so the base ring does not light for the second and a
            // half the card is up and then get taken away unfinished.
            //
            // The drone is NOT disarmed. It is hovering ninety-five metres from
            // the pad with the score already banked, and cutting the motors here
            // would drop it out of the sky in front of the pilot for the whole
            // dwell — on the pad that is a landed aircraft settling, over a
            // hollow it is a crash the mission caused after saying "complete".
            leg = 'complete';
            store.setLeg(leg);
            landDwell.current = LAND_DWELL;
          } else {
            queued.current = { key: 'home', at: clock.current + 1.2 };
          }
        }
      }
    } else if (leg === 'toDrop') {
      const zone = dropZone;
      const z = probeZone(mission, zone);
      // Drifting back out of the approach ring is not a failure — it puts the
      // pilot back on the navigation leg without re-announcing anything.
      if (z.flat > zone.radius * 4.5) {
        dropHold.current = 0;
        lastChecks.current = '';
        // Leaving the zone re-arms the gate warning. It used to be announced
        // once per attempt, so a pilot who came over the mark early, was told,
        // went off to take a ring and came back short by one more got nothing
        // the second time: they held a perfect hover over a locked mark with no
        // idea why the package would not go.
        announcedGate.current = false;
        store.setLeg('carrying');
        store.setChecks({ centred: false, inBand: false, steady: false, hold: 0 });
      } else {
        // THE GATE. The package does not come off until the route out has been
        // flown: every checkpoint on the run to the pickup and on the carry.
        // Checked before the hold rather than after it, so a pilot who is
        // perfectly positioned sees the hold bar refuse to fill and is told why,
        // instead of watching a correct delivery quietly do nothing.
        const left = requiredLeft(mission, useMissionStore.getState().collected);
        if (left > 0 && !announcedGate.current) {
          announcedGate.current = true;
          store.showBanner(
            {
              kind: 'warn',
              title: 'COLLECT THE PINK RINGS FIRST',
              sub: `${left} still to take before the package will release`,
            },
            BANNER_SEC,
          );
          playFail();
        }
        dropHold.current = z.ok && left === 0 ? dropHold.current + dt : 0;
        // Quantised before it is published: the hold bar is 5% wide a step, and
        // a float that changes every frame would re-render the checklist sixty
        // times a second to move it by nothing.
        const hold = Math.round(Math.min(1, dropHold.current / zone.hold) * 20) / 20;
        const key = `${z.centred}${z.inBand}${z.steady}${hold}`;
        if (key !== lastChecks.current) {
          lastChecks.current = key;
          store.setChecks({ centred: z.centred, inBand: z.inBand, steady: z.steady, hold });
        }
        if (left === 0 && dropHold.current >= zone.hold) {
          lastChecks.current = '';
          dropHold.current = 0;
          store.setChecks({ centred: false, inBand: false, steady: false, hold: 0 });
          playDrop();
          playSuccess();

          if (run) {
            // A MULTI-POINT DELIVERY. The package is scored on its own rather
            // than through `takeZone`, which can only remember one drop, and the
            // run index moves on — that index is the only thing standing between
            // the pilot and package C, so it is advanced here and nowhere else.
            store.takeDelivery(`DELIVERY ${run.id.toUpperCase()}`);
            store.showBanner(
              {
                kind: 'good',
                title: `${run.name.toUpperCase()} DELIVERED`,
                sub: `${store.runIndex + 1} of ${runs} on the mark`,
              },
              BANNER_SEC,
            );
            say(mission, 'delivered', run.id);

            const last = store.runIndex + 1 >= runs;
            if (!last) {
              // BACK TO THE HUB, not on to the next mark. The brief is explicit
              // that the next package does not appear at the destination the
              // last one went to — the pilot has to fly home for it, and that
              // return is half of what the mission is teaching.
              store.advanceRun();
              store.rearmPickup();
              store.setPayload('waiting');
              pickupHold.current = 0;
              // Both banners are per-DESTINATION, not per attempt: the next one
              // is a different mark and has to announce itself again.
              announcedDrop.current = false;
              announcedGate.current = false;
              leg = 'toPickup';
              store.setLeg(leg);
              queued.current = { key: `back-${run.id}`, at: clock.current + 1.2 };
              return;
            }
            // The last one. The package stays delivered and the flight home is
            // the ordinary one below.
          } else {
            store.takeZone('drop', 'DELIVERY');
            store.showBanner(
              { kind: 'good', title: 'PAYLOAD DELIVERED', sub: 'Package is on the mark' },
              BANNER_SEC,
            );
            say(mission, 'delivered');
          }

          leg = 'delivered';
          store.setLeg(leg);
          store.setPayload('delivered');
          // Queued behind the delivery line rather than fired with it: two
          // radio calls in the same frame means the pilot reads neither.
          //
          // On the MISSION's clock, not a setTimeout. A real timer outlives the
          // attempt that set it, so a pilot who pressed R in the second between
          // the two lines would be told to return to base on a fresh flight that
          // has not picked anything up yet.
          queued.current = { key: 'home', at: clock.current + 1.2 };
        }
      }
    } else if (leg === 'delivered') {
      const flat = flatDist(dronePose.position, mission.zones.base.at);
      if (flat <= BASE_CALL_R) {
        leg = 'returning';
        store.setLeg(leg);
        store.showBanner(
          { kind: 'info', title: 'LANDING ZONE REACHED', sub: 'Land the drone safely' },
          BANNER_SEC,
        );
        say(mission, 'landing');
        playWhoosh();
      }
    } else if (leg === 'returning') {
      const zone = mission.zones.base;
      const sim = useSimStore.getState();
      const flat = flatDist(dronePose.position, zone.at);
      // An actual landing, not a low pass: on the deck, inside the pad, and
      // stopped — held long enough that a bounce does not read as a touchdown.
      const down =
        flight.onGround &&
        flat <= zone.radius &&
        sim.groundSpeed <= STILL &&
        Math.abs(sim.verticalSpeed) <= STILL;
      landHold.current = down ? landHold.current + dt : 0;
      if (landHold.current >= LAND_SETTLE) {
        leg = 'landing';
        store.setLeg(leg);
        store.takeZone('base', 'SAFE LANDING');
        // The attempt is over the moment the wheels settle. The motors go off
        // here rather than at `finish()`, because the result card is a couple of
        // seconds behind the touchdown and the pilot could throttle up and fly
        // away inside that window — the run scored, the drone airborne, and a
        // result card about to cover a flight still in progress.
        useFlightStore.getState().disarm();
        resetStick();
        store.showBanner(
          {
            kind: 'good',
            title: 'SAFE LANDING',
            // A survey delivered nothing. The line is the last thing the pilot
            // reads before the result card, and 'Package delivered' on a
            // wildlife flight is the runtime describing a different mission.
            sub: mission.tracking ? 'Sighting logged, drone home' : 'Package delivered, drone home',
          },
          LAND_DWELL,
        );
        landDwell.current = LAND_DWELL;
      }
    } else if (leg === 'landing' || leg === 'complete') {
      // The card is allowed its moment before the result screen covers the view.
      landDwell.current -= dt;
      if (landDwell.current <= 0) {
        const s = useMissionStore.getState();
        // The sign-off is NOT played here. A radio line only renders while the
        // flight is on, and this frame is the one that ends it — the line would
        // be set into a store nothing is reading. The result card carries it
        // instead, which is where the pilot is actually looking.
        store.finish({
          points: s.points,
          maxPoints: s.maxPoints,
          timeSec: clock.current,
          collisions,
          delivered: true,
          // Honest rather than convenient: a mission that ends at the drop was
          // never landed, and a result that claimed otherwise would put a tick
          // against "Safe landing" on a card for a flight still in the air.
          landed: !mission.endsAtDrop,
        });
        return;
      }
    }

    // ---- Anything queued for later on this clock --------------------------
    if (queued.current && clock.current >= queued.current.at) {
      say(mission, queued.current.key);
      queued.current = null;
    }

    // ---- Retire what has timed out ----------------------------------------
    const live = useMissionStore.getState();
    if (live.banner && clock.current >= live.banner.until) store.clearBanner();
    if (live.radio && clock.current >= live.radio.until) store.clearRadio();

    // ---- Publish ----------------------------------------------------------
    publishAt.current -= dt;
    if (publishAt.current <= 0) {
      publishAt.current = 1 / PUBLISH_HZ;
      const sim = useSimStore.getState();
      const p0 = dronePose.position;

      // ---- The search publishes something else entirely ---------------------
      //
      // Not a quieter version of the same numbers — a DIFFERENT number. Distance
      // and bearing to the casualty are exactly the answer the mission exists to
      // withhold, so they are never computed here, let alone published and
      // hidden by the HUD: a value in the store is a value one careless render
      // puts on screen.
      //
      // `targetMark.active` goes false with them, which is what empties the
      // in-picture pointer. It reads a module singleton the Canvas writes every
      // frame and knows nothing about missions, so this is the only place that
      // can silence it.
      if (guidanceHidden(mission, store.located, leg)) {
        // The TRACKING mission publishes the lock, and nothing else. No
        // distance, no bearing, no signal strength — a distance to a walking
        // animal is a tracker, and this mission's rule is that the pilot finds
        // it by looking. What they get back is how much of the hold they have
        // served, which is a fact about their own flying rather than about
        // where the target is.
        if (mission.tracking) {
          targetMark.active = false;
          const lock = Math.round(trackOut.lock * 20) / 20;
          const key = `${lock}${trackOut.lit}${trackOut.tooClose}`;
          if (key !== lastTrack.current) {
            lastTrack.current = key;
            store.setTrack({ lock, lit: trackOut.lit, tooClose: trackOut.tooClose });
          }
          store.setFlightData({
            distance: 0,
            altitude: p0.y - mission.groundY,
            climb: 0,
            bearing: 0,
          });
          store.setElapsed(Math.round(clock.current * 10) / 10);
          store.setCollisions(collisions);
          return;
        }
        const search = mission.search;
        const site = search?.sites[Math.min(store.siteIndex, search.sites.length - 1)];
        const flat = site ? flatDist(p0, site.at) : Infinity;
        const span = search ? Math.max(1e-3, search.detectRadius - search.confirmRadius) : 1;
        targetMark.active = false;
        store.setSignal(
          !search || flat >= search.detectRadius
            ? 0
            : Math.min(1, (search.detectRadius - flat) / span),
        );
        store.setFlightData({
          distance: 0,
          altitude: p0.y - mission.groundY,
          climb: 0,
          bearing: 0,
        });
        store.setElapsed(Math.round(clock.current * 10) / 10);
        store.setCollisions(collisions);
        return;
      }
      // The ring's arrow, the DISTANCE readout and the radar dot are all this
      // one point — see `nextTargetOf`. They used to be worked out separately
      // and could disagree: the dial sent the pilot at a checkpoint while the
      // arrow on the ring still pointed at the mark behind it.
      const p = dronePose.position;
      const taken = useMissionStore.getState().collected;
      const cp = nextTargetOf(mission, legOf(leg), taken);
      const target: readonly [number, number, number] = cp ?? markerFor(mission, leg, dropZone);
      const dx = target[0] - p.x;
      const dz = target[2] - p.z;
      const dy = target[1] - p.y;
      // Bearing relative to the nose: 0 straight ahead, positive to the right.
      // The map's heading is -yaw (see the compass), so the target's world
      // bearing plus yaw is where it sits across the pilot's own view.
      const bearing = wrapPi(Math.atan2(dx, -dz) + sim.yaw);
      // The same point the arrow and the radar use, handed to the in-picture
      // pointer. It is published here rather than recomputed there so all four
      // instruments can never disagree about where the pilot is being sent.
      /*
       * THE POINTER GOES OUT THE MOMENT THE CASUALTY IS FOUND.
       *
       * Everything else on this leg is judged by the checklist — over the
       * casualty, height, steady — and the pointer answers a question that has
       * already been answered: the pilot is there, that is why the checklist is
       * on screen. Worse than redundant, it disagreed. The marker sits in the
       * middle of the 12-22 m band, so a pilot holding a perfectly good hover
       * at 12 m had three green ticks and a yellow arrow telling them to climb
       * four metres. One of the two had to go, and it is not the thing that
       * decides whether the mission is passed.
       *
       * The flat DISTANCE readout stays: drifting out of the zone restarts the
       * hold, so how far off centre the aircraft is remains worth knowing. What
       * goes with the pointer is the CLIMB chip, for the same reason — the band
       * is on the checklist now, in metres.
       */
      const confirming = leg === 'confirming';
      targetMark.at.set(target[0], target[1], target[2]);
      targetMark.active = !confirming;
      store.setFlightData({
        distance: confirming ? Math.hypot(dx, dz) : Math.hypot(dx, dy, dz),
        altitude: p.y - mission.groundY,
        // `dy` was already here, spent on the 3-D distance and discarded. It is
        // the only thing on the HUD that can say the target is on a ROOF.
        climb: confirming ? 0 : dy,
        bearing,
      });
      store.setElapsed(Math.round(clock.current * 10) / 10);
      store.setCollisions(collisions);
      const required = requiredCheckpoints(mission);
      const left = required.filter((c) => !taken[c.id]);
      store.setGate({ left: left.length, total: required.length });
    }
  });

  return null;
}

/**
 * How close counts as ARRIVING at the middle mark, in metres.
 *
 * Three zone radii for a delivery: the drop is 1.8 m across and the pilot needs
 * to be told they are over the block before they are inside a two metre circle.
 * A fire is a much bigger object and its hover zone sits INSIDE the burning
 * ground, so the call is made at the edge of the fire itself — which is where a
 * pilot would say they had reached it.
 */
function enterRadius(mission: Mission, drop: MissionZone): number {
  return mission.fire ? mission.fire.breakRadius : drop.radius * 3;
}

/**
 * Play a Mission Control line, once per attempt.
 *
 * On a multi-point delivery the same beat happens three times — collected,
 * nearly there, delivered — and the pilot should not hear the same sentence on
 * all three. A key suffixed with the package's id wins over the plain one when
 * the mission has written it, so `pickup-b` is said on the second run and
 * `pickup` on any mission that has not bothered.
 *
 * `playRadio` still keys on the LINE's own id, which is what keeps "once per
 * attempt" true across the three runs: `delivered-a` and `delivered-b` are
 * different lines and both get said, while a mission reusing one plain key gets
 * it once, as before.
 */
function say(mission: Mission, key: string, runId?: string): boolean {
  const line = (runId ? mission.radio[`${key}-${runId}`] : undefined) ?? mission.radio[key];
  if (!line) return false;
  // The answer is passed on rather than dropped: `playRadio` already knows
  // whether this is the FIRST time a line has been played, and the search needs
  // exactly that — the detection banner goes up with the call that announces it
  // and never again, without a second ref tracking the same fact.
  return useMissionStore.getState().playRadio(line.id, line.text, RADIO_SEC);
}

/** Where the active marker is, in world space — what DISTANCE and the direction
 *  arrow are both measured to. */
function markerFor(mission: Mission, leg: MissionLeg, drop: MissionZone): [number, number, number] {
  const kind = activeZone(leg);
  if (!kind) {
    return [
      mission.zones.base.at[0],
      zoneGroundY(mission, mission.zones.base),
      mission.zones.base.at[1],
    ];
  }
  // The DROP is whichever destination this run is for — `mission.zones.drop` is
  // only ever the first one, so reading it here would point the arrow and the
  // DISTANCE readout at package A's mark for the whole flight.
  const zone = kind === 'drop' ? drop : mission.zones[kind];
  // The MIDDLE OF THE BAND, not half its ceiling.
  //
  // Half the ceiling is the same thing for every zone that opens at the ground,
  // which is all of them until a zone is held ABOVE something. The rescue hover
  // is 12 to 22 m up a street canyon, and half of 22 is 11 — a metre BELOW the
  // floor of the band the checklist is asking for. So the arrow told the pilot
  // to descend at the exact moment they needed to climb, and it did it while
  // the Height row sat unticked saying otherwise.
  const mid = (zone.band.min + zone.band.max) / 2;
  return [zone.at[0], zoneGroundY(mission, zone) + mid, zone.at[1]];
}

/**
 * How long the aircraft has to stay inside the fire zone's speed limits before
 * the tank opens, seconds.
 *
 * Long enough that a drone crossing its own hover cannot buy it at a turning
 * point, short enough that a pilot who HAS settled is not left waiting and
 * wondering what else the mission wants. It is deliberately far shorter than the
 * ten second hold it gates: this is "you have stopped", not "you have held".
 */
const STEADY_ARM_SEC = 0.5;

/** Wrap an angle to -pi..pi. */
function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

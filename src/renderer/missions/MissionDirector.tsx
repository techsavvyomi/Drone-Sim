import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { useMissionStore, activeZone, legOf, type MissionLeg } from '../state/missionStore';
import { dronePose } from '../sim/drone/pose';
import {
  flatDist,
  requiredCheckpoints,
  requiredLeft,
  nextTargetOf,
  type Mission,
  type MissionZone,
} from './types';
import { playDrop, playFail, playLatch, playSuccess, playWhoosh } from '../audio/sfx';
import { resetForMission } from './reset';

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

/** Distances the destination is called out at, metres. Three calls across a
 *  90 m crossing, and nothing between them — guidance, not a killstreak. */
const CALL_FAR = 150;
const CALL_NEAR = 75;
const CALL_APPROACH = 40;

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

interface ZoneProbe {
  /** Horizontal distance from the mark, metres. */
  flat: number;
  centred: boolean;
  inBand: boolean;
  steady: boolean;
  /** All three, which is what the hold timer runs on. */
  ok: boolean;
}

function probeZone(zone: MissionZone, groundY: number): ZoneProbe {
  const sim = useSimStore.getState();
  const p = dronePose.position;
  const flat = flatDist(p, zone.at);
  const agl = p.y - groundY;
  const centred = flat <= zone.radius;
  const inBand = agl >= zone.band.min && agl <= zone.band.max;
  const steady =
    sim.groundSpeed <= zone.maxGroundSpeed && Math.abs(sim.verticalSpeed) <= zone.maxVerticalSpeed;
  return { flat, centred, inBand, steady, ok: centred && inBand && steady };
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

  /** Everything the attempt accumulates, in one place. A new timer added to the
   *  runtime has to be cleared here, and the compiler will not remind you — so
   *  they all live together rather than beside the code that uses them. */
  function armAttempt(): void {
    clock.current = 0;
    pickupHold.current = 0;
    dropHold.current = 0;
    landHold.current = 0;
    landDwell.current = 0;
    publishAt.current = 0;
    queued.current = null;
    lastChecks.current = '';
    announcedDrop.current = false;
    announcedGate.current = false;
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

  useFrame((_, rawDt) => {
    const store = useMissionStore.getState();
    const mission = store.mission;
    if (!mission || store.phase !== 'flying') return;

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
    if (clock.current >= mission.timeLimitSec) {
      playFail();
      store.setCollisions(collisions);
      store.fail('timeout');
      return;
    }

    // ---- The state machine ------------------------------------------------
    let leg: MissionLeg = store.leg;

    if (leg === 'toPickup') {
      const z = probeZone(mission.zones.pickup, mission.groundY);
      pickupHold.current = z.ok ? pickupHold.current + dt : 0;
      if (pickupHold.current >= mission.zones.pickup.hold) {
        leg = 'carrying';
        store.setLeg(leg);
        store.setPayload('attached');
        store.takeZone('pickup', 'PICKUP', false);
        playLatch();
        store.showBanner(
          { kind: 'good', title: 'PAYLOAD ATTACHED', sub: 'Package secured under the airframe' },
          BANNER_SEC,
        );
        say(mission, 'pickup');
      }
    } else if (leg === 'carrying') {
      const z = probeZone(mission.zones.drop, mission.groundY);
      // Awareness, then approach, then the careful line — each once, and only
      // once, so a pilot circling the block is not told the same thing four
      // times. `playRadio` is the thing that guarantees it.
      if (z.flat <= CALL_APPROACH) say(mission, 'approach');
      else if (z.flat <= CALL_NEAR) say(mission, 'near');
      else if (z.flat <= CALL_FAR) say(mission, 'far');

      // Entering the zone is a change of JOB, not a score: from navigating the
      // city to positioning over a mark. That is why it gets its own leg.
      if (z.flat <= mission.zones.drop.radius * 3) {
        leg = 'toDrop';
        store.setLeg(leg);
        if (!announcedDrop.current) {
          announcedDrop.current = true;
          store.showBanner(
            {
              kind: 'info',
              title: 'DELIVERY ZONE REACHED',
              sub: 'Slow down, centre over the mark, then descend',
            },
            BANNER_SEC,
          );
          playWhoosh();
        }
      }
    } else if (leg === 'toDrop') {
      const zone = mission.zones.drop;
      const z = probeZone(zone, mission.groundY);
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
          leg = 'delivered';
          store.setLeg(leg);
          store.setPayload('delivered');
          store.takeZone('drop', 'DELIVERY');
          lastChecks.current = '';
          store.setChecks({ centred: false, inBand: false, steady: false, hold: 0 });
          playDrop();
          playSuccess();
          store.showBanner(
            { kind: 'good', title: 'PAYLOAD DELIVERED', sub: 'Package is on the mark' },
            BANNER_SEC,
          );
          say(mission, 'delivered');
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
        store.showBanner(
          { kind: 'good', title: 'SAFE LANDING', sub: 'Package delivered, drone home' },
          LAND_DWELL,
        );
        landDwell.current = LAND_DWELL;
      }
    } else if (leg === 'landing') {
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
          landed: true,
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
      // The ring's arrow, the DISTANCE readout and the radar dot are all this
      // one point — see `nextTargetOf`. They used to be worked out separately
      // and could disagree: the dial sent the pilot at a checkpoint while the
      // arrow on the ring still pointed at the mark behind it.
      const p = dronePose.position;
      const taken = useMissionStore.getState().collected;
      const cp = nextTargetOf(mission, legOf(leg), taken);
      const target: readonly [number, number, number] = cp ?? markerFor(mission, leg);
      const dx = target[0] - p.x;
      const dz = target[2] - p.z;
      const dy = target[1] - p.y;
      // Bearing relative to the nose: 0 straight ahead, positive to the right.
      // The map's heading is -yaw (see the compass), so the target's world
      // bearing plus yaw is where it sits across the pilot's own view.
      const bearing = wrapPi(Math.atan2(dx, -dz) + sim.yaw);
      store.setFlightData({
        distance: Math.hypot(dx, dy, dz),
        altitude: p.y - mission.groundY,
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

/** Play a Mission Control line, once per attempt. */
function say(mission: Mission, key: string): void {
  const line = mission.radio[key];
  if (!line) return;
  useMissionStore.getState().playRadio(line.id, line.text, RADIO_SEC);
}

/** Where the active marker is, in world space — what DISTANCE and the direction
 *  arrow are both measured to. */
function markerFor(mission: Mission, leg: MissionLeg): [number, number, number] {
  const kind = activeZone(leg);
  if (!kind) return [mission.zones.base.at[0], mission.groundY, mission.zones.base.at[1]];
  const zone = mission.zones[kind];
  return [zone.at[0], mission.groundY + zone.band.max * 0.5, zone.at[1]];
}

/** Wrap an angle to -pi..pi. */
function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier';
import * as THREE from 'three';
import type { ContactState, DroneSpec, FlightMode, SupportInfo, Vec3 } from '@shared/types';
import {
  FlightController,
  SPRING_THROTTLE,
  THROTTLE_CENTER,
  type ControlOutput,
} from '../control/flightController';
import {
  Battery,
  BATTERY_CRITICAL_V,
  BATTERY_CUTOFF_V,
  BATTERY_WARNING_V,
} from '../dynamics/battery';
import { ambientDrift, groundEffect, windForce } from '../dynamics/environment';
import { GRAVITY, SIM_DT } from '../constants';
import { clamp, DEG2RAD } from '../mathx';
import {
  activeInputSource,
  isScripted,
  isThrottleCommanded,
  isThrottleDown,
  stick,
  updateStick,
  resetStick,
} from '../../input/controls';
import { useSimStore } from '../../state/simStore';
import { useFlightStore, type AutoState } from '../../state/flightStore';
import { usePhysicsStore } from '../../state/physicsStore';
import { DroneModel } from './DroneModel';
import { Propellers } from './Propellers';
import { addShake } from '../effects';
import { dronePose } from './pose';
import { propHubs, resetPropSpin } from './propHubs';

// Module-scope scratch (single active drone) to avoid per-step allocations.
const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _euler = new THREE.Euler();
/** Above this the drone is flying, so whatever it hits is an obstacle and not
 *  the floor it is taking off from or landing on. */
const TOUCH_ALT = 0.4;
const _up = new THREE.Vector3();
const _rotor = new THREE.Vector3();
const _drag = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _aeroTq = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
/** Scratch for the ambient drift vector. */
const _driftVec: Vec3 = [0, 0, 0];
const _gyroVec: Vec3 = [0, 0, 0];
const _accelVec: Vec3 = [0, 1, 0];
const _cornerDists: [number, number, number, number] = [0, 0, 0, 0];
const _supported: [boolean, boolean, boolean, boolean] = [false, false, false, false];

/**
 * How far BELOW the play area's floor counts as having fallen out of the world.
 *
 * This used to be an absolute −8 m, which silently assumed every map's floor was
 * y = 0. On the Forest the terrain descends to −77 m, so simply following the
 * ground downhill took the drone past −8 and teleported it back to spawn — with
 * no warning and nothing on screen to explain it.
 *
 * Measuring from `bounds.min[1]` keeps the original behaviour on every map whose
 * floor is zero (arena, academy, classrooms) and makes it correct on the ones
 * that go deeper.
 */
const LOST_BELOW_FLOOR = 8;

/**
 * Horizontal deceleration applied to a crashed airframe, m/s².
 * High enough that even a 20 m/s impact stops within a couple of metres, which
 * is what a broken quad hitting concrete actually does.
 */
const CRASH_DECEL = 45;
/**
 * Peak tumble rate a wreck is given on impact (rad/s) — a roll the eye can
 * follow, not a spin — and how fast that tumble bleeds off (rad/s per second).
 */
const CRASH_TUMBLE_RATE = 3.5;
const CRASH_SPIN_DECEL = 6;

/** Height of the centre of pressure (rotor plane) above the CoG, metres. */
const CP_HEIGHT = 0.022;

/**
 * Battery thresholds are evaluated on the RESTING (open-circuit) voltage, not
 * the loaded reading. A pack sags under throttle and recovers on release, so
 * judging on the loaded value would force a landing during any hard climb while
 * the pack still holds plenty of charge. The loaded voltage is still what the
 * HUD displays — that's the number a real pilot sees dip.
 */

/** Impact speeds (m/s): below MINOR nothing, above MAJOR is a floor slam crash. */
const MINOR_IMPACT = 1.8;
const MAJOR_IMPACT = 4.5;
/**
 * Sink rate (m/s) at which arriving on the floor is a crash rather than a
 * landing.
 *
 * MINOR_IMPACT alone could never catch a dropped throttle. It grades the TOTAL
 * speed, and in Altitude Hold — the mode Flight School flies in — the descent is
 * capped at `maxClimbRate`, 1.8 m/s. Cutting the throttle to the stop therefore
 * arrives at the floor a hair UNDER the 1.8 threshold, and ground effect takes
 * the rest: the drone slammed down out of a hover and the lesson carried on as
 * if nothing had happened. Module 3 is the one it hurt most — the whole drill is
 * the throttle, and its own listed mistake is "pushing the throttle all the way
 * down and landing", which cost the pilot nothing.
 *
 * 1.5 m/s is well clear of a landing. A pilot easing down puts it on at 0.3-0.6
 * and the auto-land is gentler still; only a stick held at or near the bottom
 * gets here, which is exactly the input this is meant to punish.
 */
const HARD_SINK = 1.5;
/** Walls / furniture — only crash on a clear fast hit. Slow/medium bumps must not flip. */
const WALL_CRASH_SPEED = 3.2;
/**
 * Hitting a building, pole or tree while airborne becomes a crash from here up.
 * Below it the contact is a bump: the drone is knocked about and shaken, and the
 * pilot keeps the aircraft.
 */
const OBSTACLE_CRASH_SPEED = 2.2;
/** After a non-crash bump, keep roll/pitch locked so contact torque cannot tumble Pluto. */
const WALL_BUMP_HOLD = 0.85;
/** Remember peak speed this long so a tunneled hit still counts as a fast crash. */
const PEAK_SPEED_HOLD = 0.25;

/**
 * Attitude / lateral-G crash detection, ported from the Magis V2 firmware's
 * failsafe:
 *
 *   ABS(roll) > 700 || ABS(pitch) > 700 decidegrees        -> 70 degrees
 *   ABS(accSmooth[0]) > 12000 || ABS(accSmooth[1]) > 12000 -> ~3 g lateral
 *
 * and only while an ANGLE mode is active — Magis explicitly excludes acro
 * flips, since inverted attitude is intentional there.
 */
const CRASH_TILT_RAD = (70 * Math.PI) / 180;
const CRASH_LATERAL_G = 3;
/** Low-pass on lateral G, standing in for the firmware's accSmooth. */
const ACC_SMOOTH_HZ = 12;
/** Both conditions must persist this long — resting contact spikes are noise. */
const CRASH_HOLD = 0.12;

const GROUND_ALT = 0.4;
const MAX_ANGVEL = 40;

/**
 * Throttle movement that hands an auto sequence back to the pilot.
 *
 * Measured as a change from where the stick sat when the sequence started, not
 * as distance from centre. A gamepad throttle springs to the middle, but a real
 * radio's stays wherever it was left — usually at the bottom — so an absolute
 * test would read "the pilot is on the throttle" on the very first frame and
 * cancel every takeoff before it left the ground.
 */
const AUTO_OVERRIDE_DELTA = 0.12;

interface DroneProps {
  spec: DroneSpec;
  spawn: { position: Vec3; heading: number };
  /** Outdoor environments get gentle ambient air movement. */
  outdoor?: boolean;
  /** Play-area limits; the drone is softly contained inside them. */
  bounds: { min: Vec3; max: Vec3 };
  /**
   * Height of the map's flat ground plane, if it has one. Undefined on terrain
   * maps, where there is no single ground height and the under-floor rescue
   * must not run. See EnvironmentSpec.groundY.
   */
  groundY?: number;
}

function autoThrust(
  auto: AutoState,
  altitude: number,
  verticalSpeed: number,
  mass: number,
  hoverThrust: number,
  takeoffAlt: number,
): number {
  // Landing descent is deliberately gentle (~0.4 m/s), per spec.
  const climbRate = auto === 'takeoff' ? clamp(0.9 * (takeoffAlt - altitude), -0.8, 1.2) : -0.4;
  return hoverThrust + mass * 4.0 * (climbRate - verticalSpeed);
}

/**
 * Picks which propeller breaks on impact: whichever hub is lowest in world
 * space, i.e. the corner that actually struck.
 */
function pickBrokenProps(): number[] {
  if (!propHubs.ready) return [0];
  let lowest = 0;
  let lowestY = Infinity;
  const v = new THREE.Vector3();
  propHubs.positions.forEach((hub, i) => {
    v.copy(hub).applyQuaternion(dronePose.quaternion).add(dronePose.position);
    if (v.y < lowestY) {
      lowestY = v.y;
      lowest = i;
    }
  });
  return [lowest];
}

export function Drone({ spec, spawn, bounds, outdoor = false, groundY }: DroneProps) {
  const { world, rapier } = useRapier();
  const body = useRef<RapierRigidBody>(null);
  const liveSupportInfo = useRef<SupportInfo>(useSimStore.getState().support);
  const lastContactState = useRef<ContactState>('AIRBORNE');
  const rayRef = useRef<any>(null);
  /** The rendered (interpolated) transform — smoother than the raw physics pose. */
  const visual = useRef<THREE.Group>(null);
  const controller = useMemo(() => new FlightController(spec), [spec]);
  const battery = useMemo(() => new Battery(spec.battery), [spec]);

  const inertia = useRef<Vec3>([1, 1, 1]);
  const lastOutput = useRef<ControlOutput | null>(null);
  /** Actual (lagged) motor thrusts in N — motors cannot change speed instantly. */
  const motorThrust = useRef<[number, number, number, number]>([0, 0, 0, 0]);
  const motorNorm = useRef<[number, number, number, number]>([0, 0, 0, 0]);
  const batteryState = useRef({ voltage: 0, current: 0, soc: 1, thrustScale: 1 });
  const stepCount = useRef(0);
  const simTime = useRef(0);
  const flightTime = useRef(0);
  const fpsAccum = useRef({ frames: 0, elapsed: 0 });
  const prevMode = useRef<FlightMode | null>(null);
  // Throttle position when the running auto sequence took over, so a deliberate
  // stick move can be told apart from where the stick simply happens to rest.
  const autoEntryThrottle = useRef<number | null>(null);
  const prevAuto = useRef<AutoState>('manual');
  /** Armed state at the previous physics step — see the arm transition below. */
  const prevArmed = useRef(false);
  const prevSource = useRef(activeInputSource());
  /** Speed at the last physics step — used to grade collision severity. */
  const impactSpeed = useRef(0);
  /** Peak speed in a short window — tunneling can zero linvel before onCollisionEnter. */
  const peakSpeed = useRef(0);
  const peakSpeedUntil = useRef(0);
  /** Peak DESCENT rate over the same window, for grading an arrival on the floor. */
  const peakSink = useRef(0);
  const peakSinkUntil = useRef(0);
  /** Seconds the pack has been continuously below LOW_VOLTAGE. */
  const lowVoltageFor = useRef(0);
  /** Previous horizontal velocity, for deriving lateral G. */
  const prevVel = useRef({ x: 0, z: 0 });
  const smoothLateralG = useRef(0);
  const crashHold = useRef(0);
  /** Sim-time until which a soft wall bump keeps roll/pitch locked level (no flip). */
  const wallBumpUntil = useRef(0);

  const hoverThrust = useMemo(() => spec.mass * GRAVITY, [spec]);
  const armPerAxis = useMemo(() => spec.armLength / Math.SQRT2, [spec]);
  const propRadius = useMemo(() => spec.armLength * 0.45, [spec]);
  // Effective drag area (Cd * frontal area) for wind loading.
  // Frontal area x Cd. The armLength^2 fallback is a stand-in for a boxy
  // trainer; an airframe that knows its own number says so (DroneSpec.dragArea).
  const dragArea = useMemo(() => spec.dragArea ?? spec.armLength * spec.armLength * 1.8, [spec]);

  // Rotor attachment points in body frame, matching the mixer's FR/FL/BR/BL order.
  const rotorPoints = useMemo<Vec3[]>(
    () => [
      [armPerAxis, 0, -armPerAxis],
      [-armPerAxis, 0, -armPerAxis],
      [armPerAxis, 0, armPerAxis],
      [-armPerAxis, 0, armPerAxis],
    ],
    [armPerAxis],
  );

  const resetToken = useSimStore((s) => s.resetToken);
  const rechargeToken = useFlightStore((s) => s.rechargeToken);

  useEffect(() => {
    const rb = body.current;
    if (!rb) return;
    const [x, y, z] = spawn.position;
    // A lesson can ask to START in the air (Flight School's landing drill). The
    // drone is PLACED at the hover rather than flown up to it: armed, off the
    // ground, and with the altitude controller already holding that height, so
    // the first thing the pilot sees is the situation the lesson is about.
    const lift = useSimStore.getState().spawnLift;
    _q.setFromAxisAngle(UP_AXIS, spawn.heading * DEG2RAD);
    rb.setTranslation({ x, y: y + lift, z }, true);
    rb.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    controller.reset();
    battery.reset();
    flightTime.current = 0;
    lowVoltageFor.current = 0;
    smoothLateralG.current = 0;
    crashHold.current = 0;
    wallBumpUntil.current = 0;
    peakSpeed.current = 0;
    peakSpeedUntil.current = 0;
    peakSink.current = 0;
    peakSinkUntil.current = 0;
    prevVel.current = { x: 0, z: 0 };
    useFlightStore.getState().setOnGround(lift <= 0);
    useFlightStore.getState().clearCrash();
    useFlightStore.getState().recharge();
    // And stop the rotors DEAD, not on the damped spool-down.
    //
    // A reset teleports the body back to the pad. The propellers were never
    // told: disarming only sets their target to zero, and `DroneModel` damps
    // `rpm` toward it, so the machine that arrived on the pad stood there with
    // the previous flight's props still winding down for a second or two. It is
    // the same lie the drone-swap effect below fixes, from the same cause — the
    // aircraft under those rotors is not the one that was flying a frame ago.
    //
    // Safe to do here even though Flight School arms out of `lesson.setup()` in
    // this same tick: this zeroes the DRAWN speed, not the motor demand, so a
    // lesson that arms immediately simply spools up from a standstill, which is
    // what a drone freshly placed on the pad does.
    resetPropSpin();
    if (lift > 0) {
      controller.captureAltitude(y + lift);
      const flight = useFlightStore.getState();
      if (!flight.armed) flight.toggleArm();
    }
  }, [resetToken, spawn, controller, battery]);

  // Swapping the aircraft OR the arena mid-flight must not hand the pilot a
  // machine that is already armed and still carrying the old stick position — it
  // would climb away the instant it spawned. The reset effect above does put the
  // body back on the pad for both (`controller`/`battery` are memoised on `spec`
  // and `spawn` comes from the environment), but it deliberately leaves the
  // flight store alone, so the safe state has to be set here.
  //
  // Both deps are stable references — drone and environment specs are the same
  // objects out of the plugin registry — so this fires on a real switch only,
  // and never on an incidental re-render.
  //
  // It must NOT also fire on `resetToken`: Flight School calls `requestReset()`
  // and then arms from `lesson.setup()` in the same tick, so a disarm running
  // off that token would land after the arm and silently kill every lesson.
  // Training is safe from the deps used here — it never changes the drone, and
  // it pins its environment to a literal `envIdOverride="drone-academy"`, so
  // neither value moves for the life of a lesson.
  const loadoutSettled = useRef(false);
  useEffect(() => {
    if (!loadoutSettled.current) {
      loadoutSettled.current = true;
      return;
    }
    useFlightStore.getState().disarm();
    resetStick();
    // The rotors belong to the machine that just left. Disarming alone only sets
    // their target to zero and the spool-down is damped, so without this the new
    // airframe arrives with its predecessor's propellers still turning on it.
    resetPropSpin();
  }, [spec, spawn]);

  // Recharging refills the pack without moving the drone.
  useEffect(() => {
    battery.reset();
    lowVoltageFor.current = 0;
  }, [rechargeToken, battery]);

  // Control + forces run once per fixed physics step.
  useBeforePhysicsStep(() => {
    const rb = body.current;
    if (!rb) return;

    stepCount.current += 1;
    simTime.current += SIM_DT;
    if (stepCount.current % 25 === 0) {
      useSimStore.getState().setClock(stepCount.current, simTime.current);
    }

    const { armed, mode, auto, crashed } = useFlightStore.getState();
    const physics = usePhysicsStore.getState();

    const pos = rb.translation();
    const lin = rb.linvel();
    const speedNow = Math.hypot(lin.x, lin.y, lin.z);
    impactSpeed.current = speedNow;
    // Peak speed over the LAST `PEAK_SPEED_HOLD` seconds — the approach speed a
    // collision should be graded by, because Rapier often zeroes the velocity in
    // the solver step before `onCollisionEnter` runs.
    //
    // The hold window has to start when the peak was actually set. Refreshing it
    // on every step that merely exceeds a walking pace turned this into a latch:
    // decelerating from cruise to a careful approach never dropped below the
    // refresh speed, so the old cruise peak survived all the way to contact and
    // a feather-light touch was graded as a high-speed impact.
    if (speedNow >= peakSpeed.current) {
      peakSpeed.current = speedNow;
      peakSpeedUntil.current = simTime.current + PEAK_SPEED_HOLD;
    } else if (simTime.current > peakSpeedUntil.current) {
      peakSpeed.current = speedNow;
    }
    // Sink rate gets its own peak-hold for the same reason, and separately:
    // a drone dropping straight down is slow by `speedNow` and still arriving
    // hard, so the floor has to be graded on the vertical component alone.
    const sinkNow = Math.max(0, -lin.y);
    if (sinkNow >= peakSink.current) {
      peakSink.current = sinkNow;
      peakSinkUntil.current = simTime.current + PEAK_SPEED_HOLD;
    } else if (simTime.current > peakSinkUntil.current) {
      peakSink.current = sinkNow;
    }

    // A demonstration has no pilot in the loop. The Director writes stick
    // positions solved offline from tilt, gravity and damping
    // (`lessons/demoFlight.ts`) and never looks at where the aircraft actually
    // got to, so any force the plan does not model is an error that integrates
    // for the whole length of a leg. Ambient drift is 0.16 m/s^2 of wander:
    // by the first gate of a navigation route that is two to three metres of
    // cross-track, and the ring is 2.8 m across — so the demonstration flew
    // PAST the gate it was showing the pilot how to fly through, by a different
    // amount every viewing, because the drift is a function of a sim clock that
    // keeps running between them.
    //
    // The pilot's own attempt keeps both forces. Correcting for moving air is
    // the skill; a demonstration of a manoeuvre is not the place to teach it.
    const scripted = isScripted();

    // ---- Wind acts whether or not the drone is armed ----
    if (physics.wind.speed > 0 && !scripted) {
      const f = windForce(physics.wind, [lin.x, lin.y, lin.z], simTime.current, dragArea);
      rb.applyImpulse({ x: f[0] * SIM_DT, y: f[1] * SIM_DT, z: f[2] * SIM_DT }, true);
    }

    // A crashed drone keeps its physics (so it tumbles and settles) but the
    // motors are dead and the controls are locked until reset.
    // ---- Ambient outdoor air movement ----
    // Applied while airborne only: on the ground the drone is planted, and a
    // drifting force there just fights the contact solver.
    if (
      outdoor &&
      physics.ambientDriftEnabled &&
      armed &&
      !scripted &&
      !useFlightStore.getState().onGround
    ) {
      const d = ambientDrift(simTime.current, _driftVec);
      const m = rb.mass();
      rb.applyImpulse({ x: d[0] * m * SIM_DT, y: d[1] * m * SIM_DT, z: d[2] * m * SIM_DT }, true);
    }

    // ---- 4-Corner Physical Surface Support & Center of Mass Stability Calculation ----
    const rot = rb.rotation();
    const av = rb.angvel();
    _q.set(rot.x, rot.y, rot.z, rot.w);

    if (!rayRef.current) {
      rayRef.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    }
    const r = rayRef.current;

    let supportedCount = 0;
    let minCornerDist = Infinity;
    let maxCornerDist = 0;
    const maxRay = 2.0;

    // Contact threshold: foot is resting within 3.5 cm of a solid horizontal surface
    const CONTACT_DIST_THRESHOLD = 0.035;

    for (let i = 0; i < 4; i++) {
      _rotor.set(...(rotorPoints[i] as [number, number, number])).applyQuaternion(_q);
      r.origin.x = pos.x + _rotor.x;
      r.origin.y = pos.y + _rotor.y - 0.008; // landing foot bottom level
      r.origin.z = pos.z + _rotor.z;
      const hit = world.castRay(r, maxRay, true, undefined, undefined, undefined, rb);
      // Rapier renamed this from `toi` in 0.14; reading the old name returned
      // undefined, so every corner graded as unsupported and `isStable` was
      // permanently false.
      const d = hit ? hit.timeOfImpact : maxRay;
      _cornerDists[i] = d;
      if (d < minCornerDist) minCornerDist = d;
      if (d > maxCornerDist) maxCornerDist = d;
      const isSupp = d <= CONTACT_DIST_THRESHOLD;
      _supported[i] = isSupp;
      if (isSupp) supportedCount++;
    }

    // Support Polygon / Center-of-Mass (CoM) Stability Determination:
    // CoM is at (0, 0) in the horizontal body plane.
    // 4 feet supported -> CoM strictly inside rectangle -> STABLE
    // 3 feet supported -> CoM inside triangle -> STABLE
    // 2 feet supported (e.g. 2 front on table, 2 rear off) -> CoM is 5.6 cm outside support line -> UNSTABLE
    // <= 1 foot supported -> UNSTABLE
    const isStable = supportedCount >= 3;

    // Contact State Classification
    const isThrottleActive = stick.throttle >= 0.35;
    let contactState: ContactState;
    if (crashed) {
      contactState = 'CRASHED';
    } else if (supportedCount === 0) {
      if (
        lin.y < -0.4 &&
        (lastContactState.current === 'UNSTABLE' ||
          lastContactState.current === 'PARTIALLY_SUPPORTED')
      ) {
        contactState = 'FALLING';
      } else {
        contactState = 'AIRBORNE';
      }
    } else if (isThrottleActive) {
      contactState = 'FLYING_NEAR_SURFACE';
    } else if (isStable) {
      contactState = 'SUPPORTED';
    } else {
      contactState = 'PARTIALLY_SUPPORTED';
    }
    lastContactState.current = contactState;

    const info = liveSupportInfo.current;
    info.supported[0] = _supported[0];
    info.supported[1] = _supported[1];
    info.supported[2] = _supported[2];
    info.supported[3] = _supported[3];
    info.distances[0] = _cornerDists[0];
    info.distances[1] = _cornerDists[1];
    info.distances[2] = _cornerDists[2];
    info.distances[3] = _cornerDists[3];
    info.supportedCount = supportedCount;
    info.isStable = isStable;
    info.contactState = contactState;

    // ---- Arming hands the controller a clean slate ----
    // `targetAltitude` is the one piece of controller state that outlives a
    // disarm, and Altitude Hold flies straight back to it. Cut the motors in the
    // air — chop the throttle, hit disarm before it has settled — and the drone
    // drops; re-arm, and the stick has sprung back to centre, which reads as
    // "hold height" against a target still set to where the motors were cut. The
    // aircraft climbed back up to it having been commanded nothing, which is
    // #15a in the air. A real flight controller has no memory of the last flight
    // either: arming holds where the aircraft IS.
    //
    // Arming on the pad also arms the throttle interlock: S before W, every
    // flight. Arming in the AIR must not — a recovery, and Flight School's
    // landing drill, both start armed and off the ground, and dead motors there
    // is a drop, not a safety.
    if (armed && !prevArmed.current) {
      controller.captureAltitude(pos.y);
      controller.resetIntegrators();
      if (useFlightStore.getState().onGround) controller.lockThrottle();
    }
    prevArmed.current = armed;

    // Neither a demonstration nor an auto sequence has a pilot to press S, and
    // both fly the aircraft themselves — hand them live motors.
    if (scripted || auto !== 'manual') controller.unlockThrottle();

    if (!armed || crashed) {
      lastOutput.current = null;
      motorThrust.current = [0, 0, 0, 0];
      motorNorm.current = [0, 0, 0, 0];

      if (crashed) {
        // A wrecked airframe drops where it was hit; it does not sail on across
        // the map. Zeroing velocity once at the moment of impact is not enough —
        // the solver pushes the drone back out of whatever it penetrated over the
        // following steps, and that recovery is itself a large impulse. Bleeding
        // horizontal speed every step while crashed is what turns that into a
        // tumble instead of a launch. Vertical motion is left alone so it still
        // falls under gravity.
        const cv = rb.linvel();
        const horiz = Math.hypot(cv.x, cv.z);
        if (horiz > 0.05) {
          const damped = Math.max(0, horiz - CRASH_DECEL * SIM_DT);
          const k = damped / horiz;
          rb.setLinvel({ x: cv.x * k, y: cv.y, z: cv.z * k }, true);
        }
        // Bleed the tumble as well. Horizontal speed was already being killed
        // here, but the spin was left to the body's own angular damping, which
        // is tuned for flight and takes seconds — so the wreck went on turning
        // and kept catching the ground on its rotor pads, hopping and skittering
        // long after it should have come to rest.
        const av = rb.angvel();
        const spin = Math.hypot(av.x, av.y, av.z);
        if (spin > 0.05) {
          const k = Math.max(0, spin - CRASH_SPIN_DECEL * SIM_DT) / spin;
          rb.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true);
        }
      }
      return;
    }

    flightTime.current += SIM_DT;

    const pin = rb.principalInertia();
    inertia.current = [pin.x, pin.y, pin.z];

    // ---- Battery: sag reduces the thrust each motor can make ----
    const prevFraction = lastOutput.current?.throttleFraction ?? 0;
    // Fraction of maximum thrust that corresponds to a hover, so the battery can
    // scale its drain against it (idle 0.3x, hover 1.0x, full throttle 1.7x).
    const hoverFraction = clamp(hoverThrust / controller.maxThrust, 0.05, 1);
    const batt = physics.batteryEnabled
      ? battery.update(prevFraction, hoverFraction, SIM_DT)
      : {
          voltage: battery.fullVoltage,
          restingVoltage: battery.fullVoltage,
          current: 0,
          soc: 1,
          drawnMah: 0,
          thrustScale: 1,
        };
    batteryState.current = {
      voltage: batt.voltage,
      current: batt.current,
      soc: batt.soc,
      thrustScale: batt.thrustScale,
    };
    const maxPerMotor = spec.motors[0].maxThrustN * batt.thrustScale;

    // ---- Low-battery forced landing ----
    if (physics.batteryEnabled) {
      const flightNow = useFlightStore.getState();
      const rested = batt.restingVoltage;

      flightNow.setBatteryWarning(rested <= BATTERY_WARNING_V);

      if (rested <= BATTERY_CUTOFF_V) {
        // 3.2 V / 0% — motors cut regardless of altitude.
        flightNow.lockBattery();
      } else if (rested <= BATTERY_CRITICAL_V) {
        // 3.3 V / 5% — uncancellable auto-landing.
        flightNow.triggerLowBattery();
      }
    }

    const ge = physics.groundEffectEnabled ? groundEffect(pos.y, propRadius) : 1;

    // While sitting on the ground (or at idle throttle) the airframe can't
    // respond, so holding integral there would charge it up and cause a lurch
    // at liftoff. Real flight controllers gate the I-term the same way.
    const idle = lastOutput.current ? lastOutput.current.throttleFraction < 0.12 : true;
    if (useFlightStore.getState().onGround || idle) {
      controller.resetIntegrators();
    }

    let thrustOverride: number | undefined;
    if (auto !== 'manual') {
      thrustOverride = autoThrust(
        auto,
        pos.y,
        lin.y,
        rb.mass(),
        hoverThrust,
        useSimStore.getState().takeoffAlt,
      );
    }

    const out = controller.update(
      stick,
      mode,
      {
        rotation: [rot.x, rot.y, rot.z, rot.w],
        angvelWorld: [av.x, av.y, av.z],
        velocityWorld: [lin.x, lin.y, lin.z],
        position: [pos.x, pos.y, pos.z],
        inertia: inertia.current,
        mass: rb.mass(),
        maxPerMotor,
        groundEffect: ge,
        onGround: useFlightStore.getState().onGround,
        contactState,
        isStable,
      },
      SIM_DT,
      thrustOverride,
      isThrottleDown(),
    );
    lastOutput.current = out;

    // ---- Apply each motor's thrust at its rotor position ----
    // Roll and pitch torque emerge from the geometry, so a saturated motor
    // genuinely costs attitude authority.
    _q.set(rot.x, rot.y, rot.z, rot.w);
    _up.set(0, 1, 0).applyQuaternion(_q);

    // Motor spin-up lag (first-order, from the spec's responseTime). Real rotors
    // have rotational inertia, so commanded thrust is reached over ~30 ms rather
    // than instantly — this is what makes the motor differential visible.
    const tau = Math.max(spec.motors[0].responseTime, 1e-4);
    const alpha = 1 - Math.exp(-SIM_DT / tau);
    const m = motorThrust.current;
    for (let i = 0; i < 4; i++) {
      m[i] += (out.motorThrusts[i] - m[i]) * alpha;
      motorNorm.current[i] = clamp(m[i] / Math.max(maxPerMotor, 1e-6), 0, 1);
    }

    for (let i = 0; i < 4; i++) {
      const f = m[i];
      if (f <= 0) continue;
      const j = f * SIM_DT;
      _rotor.set(...(rotorPoints[i] as [number, number, number])).applyQuaternion(_q);
      rb.applyImpulseAtPoint(
        { x: _up.x * j, y: _up.y * j, z: _up.z * j },
        { x: pos.x + _rotor.x, y: pos.y + _rotor.y, z: pos.z + _rotor.z },
        true,
      );
    }

    // Yaw comes from motor reaction torque, recomputed from the lagged thrusts.
    const kQ = controller.yawCoefficient;
    const yawTorque = kQ * (m[0] - m[1] - m[2] + m[3]);
    const ty = yawTorque * SIM_DT;
    rb.applyTorqueImpulse({ x: _up.x * ty, y: _up.y * ty, z: _up.z * ty }, true);

    // Aerodynamic pitching moment: drag acts at the rotor plane, ABOVE the CoG,
    // so forward flight generates a nose-up moment the controller must trim out.
    // That trim is why the front motors sit lower than the rear in steady cruise
    // — without it the motors equalise as soon as the tilt angle settles.
    // (Linear drag itself is handled by the body's linearDamping; this adds only
    // the moment, so translational feel is unchanged.)
    const speed = Math.hypot(lin.x, lin.y, lin.z);
    if (speed > 0.05) {
      const k = 0.55 * rb.mass(); // matches the rigid body's linear damping
      _drag.set(-lin.x, -lin.y, -lin.z).multiplyScalar(k);
      _cp.copy(_up).multiplyScalar(CP_HEIGHT);
      _aeroTq.crossVectors(_cp, _drag).multiplyScalar(SIM_DT);
      rb.applyTorqueImpulse({ x: _aeroTq.x, y: _aeroTq.y, z: _aeroTq.z }, true);
    }

    // ---- Soft arena containment ----
    // Outdoor: wide progressive aerodynamic air-brake at the true outer perimeter (±2000m).
    // Zero hard collision impulses, zero fatal crash triggers.
    // Indoor: hard wall/floor colliders own contact.
    const containK = outdoor ? 0.8 * rb.mass() : 3.2 * rb.mass();
    const dampK = outdoor ? 2.4 * rb.mass() : 1.4 * rb.mass();
    // How far out the outdoor brake starts working. It only opposes outward
    // MOTION (see below), so this is a drag zone, not a no-fly buffer — the drone
    // still reaches the very edge. Kept modest so a normal cruise near the
    // perimeter does not feel like flying through treacle.
    const marginX = outdoor ? 12 : 0.2;
    const marginY = outdoor ? 15 : 0.2;
    const marginZ = outdoor ? 12 : 0.2;

    const axes: [number, number, number][] = [
      [pos.x, bounds.min[0], bounds.max[0]],
      [pos.y, bounds.min[1], bounds.max[1]],
      [pos.z, bounds.min[2], bounds.max[2]],
    ];
    const margins = [marginX, marginY, marginZ];
    const vel = [lin.x, lin.y, lin.z];
    const push = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const [p, lo, hi] = axes[i];
      const m = margins[i];
      const overLow = lo + m - p;
      const overHigh = p - (hi - m);

      if (outdoor) {
        if (i === 1) {
          // Vertical axis (Y): push back up when the drone sinks below the map's
          // ground plane. Only maps that HAVE one take part — on a terrain map
          // there is no single ground height, and assuming one puts an invisible
          // floor across the whole world at that height.
          if (groundY !== undefined && p < groundY + 0.01) {
            push[i] =
              containK * (groundY + 0.01 - p) * 16.0 - (vel[i] < 0 ? dampK * 2.5 * vel[i] : 0);
          } else if (overHigh > 0) {
            // Soft ceiling air-brake when approaching max altitude
            const ratio = clamp(overHigh / m, 0, 1);
            push[i] = -containK * ratio * 8.0 - (vel[i] > 0 ? dampK * vel[i] : 0);
          }
        } else {
          // Horizontal axes (X, Z): brake OUTWARD MOTION near the perimeter, and
          // nothing else.
          //
          // This used to add a positional spring (`containK * ratio * 8`) that
          // pushed inward on distance alone, whether or not the drone was moving.
          // A Pluto has about 4 m/s^2 of horizontal authority at its 22 deg tilt
          // limit, while that spring reached 6.4 — so the drone stalled out where
          // the two balanced, metres short of the boundary, with open road still
          // visible ahead. It read as a wall in the middle of the city.
          //
          // Damping only means a hover near the edge is left completely alone and
          // the pilot can fly right up to the last of the road. Speed into the
          // limit is still bled off, and the hard positional clamp below is the
          // actual boundary.
          const outward = overLow > 0 ? -1 : overHigh > 0 ? 1 : 0;
          if (outward !== 0 && Math.sign(vel[i]) === outward) {
            const over = overLow > 0 ? overLow : overHigh;
            const ratio = clamp(over / m, 0, 1);
            push[i] = -dampK * vel[i] * (0.5 + 2.5 * ratio);
          }
        }
        continue;
      }

      // Indoor: Y underground rescue only when past the floor.
      // Soft ceiling margin was fighting Alt Hold and "gluing" Pluto to the roof —
      // only push when already past hi, and bleed climb near the ceiling instead.
      if (i === 1) {
        if (overLow > 0 && p < lo) {
          push[i] = containK * overLow - (vel[i] < 0 ? dampK * vel[i] : 0);
        } else if (p > hi) {
          push[i] = -containK * (p - hi) - (vel[i] > 0 ? dampK * vel[i] : 0);
        }
      } else if (p < lo || p > hi) {
        // Past the shell — push back hard. Also snap below if deeply tunneled.
        if (p < lo) {
          push[i] = containK * 2.2 * (lo - p) - (vel[i] < 0 ? dampK * 1.5 * vel[i] : 0);
        } else {
          push[i] = -containK * 2.2 * (p - hi) - (vel[i] > 0 ? dampK * 1.5 * vel[i] : 0);
        }
      }
    }
    // Soft stop in the last ~10 cm so you can get close to the roof without
    // clipping through. Not the old 28 cm invisible wall.
    if (!outdoor && pos.y > bounds.max[1] - 0.1) {
      const lv = rb.linvel();
      if (pos.y > bounds.max[1] - 0.04) {
        rb.setLinvel({ x: lv.x * 0.9, y: Math.min(lv.y, -0.45), z: lv.z * 0.9 }, true);
      } else if (lv.y > 0) {
        rb.setLinvel({ x: lv.x, y: lv.y * 0.45, z: lv.z }, true);
      }
    }
    if (push[0] || push[1] || push[2]) {
      rb.applyImpulse({ x: push[0] * SIM_DT, y: push[1] * SIM_DT, z: push[2] * SIM_DT }, true);
    }
    // Hard surface rescue if a high-speed dive punched through the ground plane.
    // Gated on the map declaring one: on a terrain map this teleport fires every
    // step the drone is below the clearing, which is most of the map.
    if (outdoor) {
      if (groundY !== undefined && pos.y < groundY - 0.005) {
        const lv = rb.linvel();
        rb.setTranslation({ x: pos.x, y: groundY + 0.012, z: pos.z }, true);
        rb.setLinvel({ x: lv.x * 0.7, y: Math.max(lv.y, 0), z: lv.z * 0.7 }, true);
      }

      // Hard stop at visual road / sidewalk edge — impossible to cross into white void
      let cx = pos.x;
      let cz = pos.z;
      const lv = rb.linvel();
      let vx = lv.x;
      let vz = lv.z;
      let clamped = false;

      if (cx < bounds.min[0] + 0.1) {
        cx = bounds.min[0] + 0.1;
        if (vx < 0) vx = 0;
        clamped = true;
      } else if (cx > bounds.max[0] - 0.1) {
        cx = bounds.max[0] - 0.1;
        if (vx > 0) vx = 0;
        clamped = true;
      }

      if (cz < bounds.min[2] + 0.1) {
        cz = bounds.min[2] + 0.1;
        if (vz < 0) vz = 0;
        clamped = true;
      } else if (cz > bounds.max[2] - 0.1) {
        cz = bounds.max[2] - 0.1;
        if (vz > 0) vz = 0;
        clamped = true;
      }

      if (clamped) {
        // Last-resort containment, and nothing more. The map edge is an
        // invisible limit, not an object: it stops the drone and hands control
        // straight back. It used to CRASH the aircraft above 2.5 m/s, so an
        // unseeable boundary could end a flight — that is what made it read as a
        // phantom wall. Real obstacles (buildings, poles, trees) all have
        // colliders of their own and still crash normally.
        rb.setTranslation({ x: cx, y: pos.y, z: cz }, true);
        rb.setLinvel({ x: vx, y: lv.y, z: vz }, true);
      }
    }
    // Hard rescue if pitch-into-wall CCD still tunneled past the shell.
    if (!outdoor) {
      const pad = 0.02;
      let x = pos.x;
      let y = pos.y;
      let z = pos.z;
      const lv = rb.linvel();
      let vx = lv.x;
      let vy = lv.y;
      let vz = lv.z;
      let clamped = false;
      let ceilingOnly = false;
      if (x < bounds.min[0] + pad) {
        x = bounds.min[0] + pad;
        if (vx < 0) vx = 0;
        clamped = true;
      } else if (x > bounds.max[0] - pad) {
        x = bounds.max[0] - pad;
        if (vx > 0) vx = 0;
        clamped = true;
      }
      if (z < bounds.min[2] + pad) {
        z = bounds.min[2] + pad;
        if (vz < 0) vz = 0;
        clamped = true;
      } else if (z > bounds.max[2] - pad) {
        z = bounds.max[2] - pad;
        if (vz > 0) vz = 0;
        clamped = true;
      }
      // Roof: keep a small gap so the visual mesh is not entered.
      if (y > bounds.max[1] - 0.03) {
        y = bounds.max[1] - 0.07;
        vy = Math.min(vy, -0.55);
        clamped = true;
        ceilingOnly = true;
      }
      if (clamped) {
        const hitSpeed = Math.max(impactSpeed.current, peakSpeed.current);
        rb.setTranslation({ x, y, z }, true);
        rb.setLinvel({ x: vx, y: vy, z: vz }, true);
        rb.setAngvel({ x: 0, y: rb.angvel().y * 0.2, z: 0 }, true);
        // Fast wall tunnel → crash. Soft roof touch → peel only (unless slam).
        // Skip during auto-takeoff so a bound scrape can't abort the climb.
        const crashThresh = ceilingOnly ? MAJOR_IMPACT : WALL_CRASH_SPEED;
        if (
          hitSpeed >= crashThresh &&
          useFlightStore.getState().auto !== 'takeoff' &&
          !useFlightStore.getState().crashed
        ) {
          useFlightStore.getState().crash(hitSpeed, pickBrokenProps());
          addShake(1);
          peakSpeed.current = 0;
          return;
        }
        wallBumpUntil.current = simTime.current + WALL_BUMP_HOLD;
      }
    }

    // ---- Attitude / lateral-G crash detection (Magis failsafe) ----
    // Skipped in Acro, where exceeding 70 degrees is a deliberate manoeuvre,
    // and skipped on the ground, where resting contact produces velocity spikes
    // that look like huge lateral G.
    const rawLateralG =
      Math.hypot(lin.x - prevVel.current.x, lin.z - prevVel.current.z) / (SIM_DT * GRAVITY);
    // Magis reads accSmooth, not the raw accelerometer — at 250 Hz an unfiltered
    // delta of 0.12 m/s already reads as 3 g, so a single contact tick would
    // trip it. Low-pass to match.
    const a = 1 - Math.exp(-SIM_DT * 2 * Math.PI * ACC_SMOOTH_HZ);
    smoothLateralG.current += (rawLateralG - smoothLateralG.current) * a;
    prevVel.current.x = lin.x;
    prevVel.current.z = lin.z;

    const flightNow = useFlightStore.getState();
    const isNearGround = pos.y < 0.25 || flightNow.onGround;
    // Suppress lateral G / tilt crash triggers near outer boundaries in outdoor maps
    const isNearOutdoorBound =
      outdoor &&
      (pos.x < bounds.min[0] + 12 ||
        pos.x > bounds.max[0] - 12 ||
        pos.z < bounds.min[2] + 12 ||
        pos.z > bounds.max[2] - 12 ||
        pos.y > bounds.max[1] - 15);
    if (mode !== 'acro' && !flightNow.crashed && !isNearGround && !isNearOutdoorBound) {
      _q.set(rot.x, rot.y, rot.z, rot.w);
      _euler.setFromQuaternion(_q, 'YXZ');
      const overTilt = Math.abs(_euler.z) > CRASH_TILT_RAD || Math.abs(_euler.x) > CRASH_TILT_RAD;
      const overG = smoothLateralG.current > CRASH_LATERAL_G;

      if (overTilt || overG) crashHold.current += SIM_DT;
      else crashHold.current = 0;

      if (crashHold.current >= CRASH_HOLD) {
        flightNow.crash(impactSpeed.current, pickBrokenProps());
        addShake(0.8);
      }
    } else {
      crashHold.current = 0;
    }

    // ---- Anti-tumble hold after a survivable bump ----
    // Brushing a building must not roll the aircraft onto its back. Roll and
    // pitch rates are bled off hard for a moment after contact; yaw is left
    // alone, because being spun around by a glancing hit is realistic and
    // recoverable, while tumbling is neither.
    if (simTime.current < wallBumpUntil.current) {
      const bav = rb.angvel();
      const k = Math.exp(-SIM_DT * 14);
      rb.setAngvel({ x: bav.x * k, y: bav.y, z: bav.z * k }, true);
    }

    const w2 = av.x * av.x + av.y * av.y + av.z * av.z;
    if (w2 > MAX_ANGVEL * MAX_ANGVEL) {
      const s = MAX_ANGVEL / Math.sqrt(w2);
      rb.setAngvel({ x: av.x * s, y: av.y * s, z: av.z * s }, true);
    }
  });

  // Input easing, telemetry and auto-sequences run at render rate.
  useFrame((_state, delta) => {
    updateStick(delta);

    const rb = body.current;
    if (!rb) return;

    const flight = useFlightStore.getState();

    // Throttle means different things either side of this boundary, so hand it
    // over sensibly when the mode changes.
    if (flight.mode !== prevMode.current) {
      // Keyed on where the stick RESTS, not on what it commands: Acro's throttle
      // is direct but its stick is spring-centred too, so a switch into it wants
      // the same handover Alt Hold gets.
      const nowManaged = SPRING_THROTTLE.includes(flight.mode);
      const wasManaged = prevMode.current ? SPRING_THROTTLE.includes(prevMode.current) : false;
      if (nowManaged && !wasManaged) {
        // Entering: centre the spring-loaded stick so it holds rather than dives.
        stick.throttle = THROTTLE_CENTER;
      } else if (!nowManaged && wasManaged) {
        // Leaving: hand back a hover-equivalent throttle position, otherwise the
        // drone would fall out of the sky the instant the stick becomes direct.
        stick.throttle = clamp(hoverThrust / controller.maxThrust, 0, 1);
      }
      prevMode.current = flight.mode;
    }

    const pos = rb.translation();
    const lin = rb.linvel();
    const av = rb.angvel();
    const rot = rb.rotation();
    _q.set(rot.x, rot.y, rot.z, rot.w);
    _euler.setFromQuaternion(_q, 'YXZ');

    // Publish the INTERPOLATED transform for the camera. Reading the rigid
    // body directly returns the last physics step's pose, which is stepped at
    // 250 Hz and disagrees with the interpolated mesh every frame — that
    // mismatch is what reads as camera jitter.
    if (visual.current) {
      visual.current.getWorldPosition(dronePose.position);
      visual.current.getWorldQuaternion(dronePose.quaternion);
    } else {
      dronePose.position.set(pos.x, pos.y, pos.z);
      dronePose.quaternion.copy(_q);
    }
    dronePose.present = true;

    const altitude = pos.y;
    const verticalSpeed = lin.y;
    const groundSpeed = Math.hypot(lin.x, lin.z);
    const out = lastOutput.current;
    const b = batteryState.current;

    // Body-frame angular rates for the gyro trace.
    _qInv.copy(_q).invert();
    _up.set(av.x, av.y, av.z).applyQuaternion(_qInv);
    _gyroVec[0] = _up.x;
    _gyroVec[1] = _up.y;
    _gyroVec[2] = _up.z;

    // Specific force along body-up, in g — what a real IMU reports.
    const totalThrust = out
      ? out.motorThrusts[0] + out.motorThrusts[1] + out.motorThrusts[2] + out.motorThrusts[3]
      : 0;
    const accelG = totalThrust / Math.max(rb.mass() * GRAVITY, 1e-6);
    _accelVec[1] = accelG;

    useSimStore.getState().setTelemetry({
      position: [pos.x, pos.y, pos.z],
      altitude,
      roll: _euler.z,
      pitch: _euler.x,
      yaw: _euler.y,
      groundSpeed,
      verticalSpeed,
      throttle: out ? out.throttleFraction : 0,
      // Actual spun-up motor state, not the instantaneous command.
      motors: out ? ([...motorNorm.current] as [number, number, number, number]) : [0, 0, 0, 0],
      sticks: {
        roll: stick.roll,
        pitch: stick.pitch,
        yaw: stick.yaw,
        throttle: stick.throttle,
      },
      batteryVoltage: b.voltage,
      batteryCurrent: b.current,
      batterySoc: b.soc,
      flightTime: flightTime.current,
      saturated: out ? out.saturated : false,
      gyro: _gyroVec,
      accel: _accelVec,
      support: liveSupportInfo.current,
    });

    // Fell off the world — recover rather than accelerating downward forever.
    if (altitude < bounds.min[1] - LOST_BELOW_FLOOR) {
      useSimStore.getState().requestReset();
      useFlightStore.getState().disarm();
      return;
    }

    // Realistic on-surface detection: must be level and nearly stationary.
    //
    // Height is measured to whatever is actually UNDERNEATH the aircraft — the
    // corner rays cast above — and never to world zero. `altitude` is `pos.y`,
    // so grading contact by it meant a drone standing on anything raised (a
    // rooftop, the classroom table, a landing pad) was never "on the ground".
    // Arming there flipped `onGround` false, Altitude Hold stopped taking its
    // stopped-on-the-pad branch and instead held the height it was already at —
    // which is hover thrust. The motors spooled up the moment the pilot armed,
    // and the aircraft ground against its own contacts and pitched away across
    // the roof. It only ever happened somewhere raised, which is what made it
    // look intermittent.
    const supportDist = liveSupportInfo.current.distances;
    const agl = Math.min(supportDist[0], supportDist[1], supportDist[2], supportDist[3]);
    const isLevel = Math.abs(_euler.x) < 0.38 && Math.abs(_euler.z) < 0.38;
    const isStationary =
      Math.abs(verticalSpeed) < 0.22 && groundSpeed < 0.3 && Math.hypot(av.x, av.y, av.z) < 0.8;
    const onGround =
      liveSupportInfo.current.isStable &&
      isLevel &&
      isStationary &&
      (agl < GROUND_ALT || (!flight.armed && isStationary));
    if (onGround !== flight.onGround) flight.setOnGround(onGround);

    // Re-baseline on a new auto sequence, and whenever the active input device
    // changes: switching from keyboard to gamepad mid-sequence swaps in that
    // device's resting throttle, which is a jump the pilot did not command.
    const source = activeInputSource();
    if (flight.auto !== prevAuto.current || source !== prevSource.current) {
      autoEntryThrottle.current = flight.auto === 'manual' ? null : stick.throttle;
      prevAuto.current = flight.auto;
      prevSource.current = source;
    }

    // Touching the throttle takes the aircraft back. Auto-takeoff overrides
    // thrust outright, so without this the stick does nothing for the ~2s the
    // climb takes and the pilot is left holding a dead control. The critical
    // battery landing is the one sequence that stays uncancellable.
    const pilotOverride =
      flight.auto !== 'manual' &&
      !flight.lowBattery &&
      autoEntryThrottle.current !== null &&
      // Both halves matter: the stick has to be under active command *and*
      // have moved. Position alone would catch the keyboard's spring-return
      // drift in Alt Hold, and command alone would fire the instant a gamepad
      // is touched at all.
      isThrottleCommanded() &&
      Math.abs(stick.throttle - autoEntryThrottle.current) > AUTO_OVERRIDE_DELTA;

    if (
      flight.auto === 'takeoff' &&
      (pilotOverride ||
        (altitude >= useSimStore.getState().takeoffAlt - 0.05 && Math.abs(verticalSpeed) < 0.3))
    ) {
      // Auto-takeoff bypasses the altitude controller, so its previous target
      // is still the launch height. Capture the reached hover altitude before
      // handing back; otherwise the first pitch input makes Alt Hold descend
      // to the floor.
      controller.captureAltitude(altitude);
      // Only synthesise a throttle position when the sequence finished on its
      // own. On an override the stick already holds what the pilot is asking
      // for, and overwriting it would throw that input away.
      if (!pilotOverride) {
        stick.throttle = SPRING_THROTTLE.includes(flight.mode)
          ? THROTTLE_CENTER
          : clamp(hoverThrust / controller.maxThrust, 0, 1);
      }
      flight.setAuto('manual');
    } else if (flight.auto === 'land' && pilotOverride) {
      // Same handover, aborting the descent instead of the climb.
      controller.captureAltitude(altitude);
      flight.setAuto('manual');
    } else if (flight.auto === 'land' && onGround) {
      stick.throttle = 0;
      if (flight.lowBattery) {
        // Flat pack: down and locked out until reset or recharge.
        flight.lockBattery();
      } else if (flight.autoDisarmOnLand) {
        flight.disarm();
      } else {
        // Flight School owns the shutdown: the drone sits armed on the pad and
        // waits for the pilot to press it, because that is the second half of
        // the lesson. The sequence still ends here either way.
        flight.setAuto('manual');
      }
    }

    const f = fpsAccum.current;
    f.frames += 1;
    f.elapsed += delta;
    if (f.elapsed >= 0.5) {
      useSimStore.getState().setFps(Math.round(f.frames / f.elapsed));
      f.frames = 0;
      f.elapsed = 0;
    }
  });

  useEffect(() => resetStick, []);

  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={spawn.position}
      // Low linear drag for smooth gliding momentum; high angular damping for jitter-free rotational stability
      linearDamping={0.3}
      angularDamping={0.85}
      canSleep={false}
      // Without CCD a fast drone steps straight through thin colliders (walls,
      // hangar sides) between physics ticks and ends up inside the geometry.
      ccd
      onCollisionEnter={() => {
        const v = Math.max(impactSpeed.current, peakSpeed.current);
        const flight = useFlightStore.getState();
        if (flight.crashed) return;
        const rb = body.current;
        const posY = rb ? rb.translation().y : 0;
        const rot = rb ? rb.rotation() : { x: 0, y: 0, z: 0, w: 1 };
        _q.set(rot.x, rot.y, rot.z, rot.w);
        _euler.setFromQuaternion(_q, 'YXZ');
        const isTilted = Math.abs(_euler.x) > 0.45 || Math.abs(_euler.z) > 0.45; // > 25 degrees

        // Crash conditions:
        // 1. Any obstacle/building/pole impact while airborne (posY > 0.15m and v >= 0.8 m/s)
        // 2. High speed floor slam (v >= 1.8 m/s)
        // 3. Tilted contact / flip (> 25 deg) with velocity >= 0.8 m/s
        // 4. Dropped onto the floor at HARD_SINK or more, under the pilot's own hand
        // Graded by impact speed, the way a real airframe fails. Touching a wall
        // at walking pace scuffs a prop guard; it does not write the aircraft
        // off. The old 0.8 m/s obstacle threshold destroyed the drone on contact
        // barely faster than a hover drift, which is what made every building
        // feel lethal.
        const isAirborne = posY > 0.15;
        const isObstacleHit = isAirborne && v >= OBSTACLE_CRASH_SPEED;
        // 4. Dropped onto the floor. Graded on sink rate, not total speed, and
        //    only while the pilot has the controls — an auto take-off or the
        //    low-battery auto-land brings it down on its own terms.
        //
        //    The height gate is TOUCH_ALT, not `isAirborne`. 0.15 m is the
        //    obstacle line, and the academy helipad stands 0.12 m proud of the
        //    ground: touching down on it puts the body at ~0.15 and the test
        //    landed on a coin toss. TOUCH_ALT already means exactly what is
        //    wanted here — "low enough that what it hit is the floor it was
        //    landing on" — and keeps a dive that clips a wall mid-air out of it,
        //    which a bare sink-rate test would call a crash.
        const sinkNow = rb ? -rb.linvel().y : 0;
        const isHardLanding =
          posY <= TOUCH_ALT &&
          flight.auto === 'manual' &&
          Math.max(sinkNow, peakSink.current) >= HARD_SINK;
        const isImpactCrash =
          isObstacleHit ||
          v >= MINOR_IMPACT ||
          isHardLanding ||
          (v >= OBSTACLE_CRASH_SPEED && isTilted);

        // Anything hit while properly off the ground is a TOUCH, whether or not
        // it was hard enough to be a crash. Flight School scores a clean flight
        // on this, and a gate upright brushed at walking pace has to count —
        // it survives the airframe, but it is not a clean pass through the gate.
        // The height is well clear of a landing: the body sits about 0.1 m up
        // with the gear on the deck, so nothing below it is an obstacle.
        if (posY > TOUCH_ALT) flight.registerTouch();

        if (isImpactCrash && flight.auto !== 'takeoff' && flight.armed) {
          // `crash()` already clears `armed`.
          flight.crash(v, pickBrokenProps());
          addShake(Math.min(1, Math.max(0.4, v / MAJOR_IMPACT)));
          peakSpeed.current = 0;
          motorThrust.current = [0, 0, 0, 0];
          motorNorm.current = [0, 0, 0, 0];

          // Zero-bounce crash response: absorb horizontal velocity completely, cut thrust, and drop under gravity
          if (rb) {
            rb.setLinvel({ x: 0, y: Math.min(rb.linvel().y, -0.4), z: 0 }, true);
            // Tumble, not a bullet spin. `applyTorqueImpulse` takes an ANGULAR
            // IMPULSE, so the rate it produces is impulse / inertia — and these
            // airframes carry a principal inertia around 1e-4 kg m^2. The old
            // fixed 0.05-0.3 N m s therefore span the wreck up at hundreds of
            // rad/s, which is exactly what read as the drone being flung away
            // instead of dropping. Scale by the body's real inertia so the same
            // impact looks the same on a 50 g nano and a 1.5 kg trainer.
            const pin = rb.principalInertia();
            const tumble = THREE.MathUtils.clamp(v * 0.4, 0.8, CRASH_TUMBLE_RATE);
            rb.applyTorqueImpulse(
              {
                x: (Math.random() * 2 - 1) * tumble * pin.x,
                y: (Math.random() * 2 - 1) * tumble * pin.y * 0.5,
                z: (Math.random() * 2 - 1) * tumble * pin.z,
              },
              true,
            );
          }
          return;
        }

        if (rb) {
          const nearCeiling = posY > bounds.max[1] - 0.16;
          const takingOff = flight.auto === 'takeoff';
          const lv = rb.linvel();
          if (nearCeiling) {
            // Peel off the roof — never zero vertical speed on the lid.
            rb.setLinvel({ x: lv.x * 0.5, y: Math.min(lv.y, -0.9), z: lv.z * 0.5 }, true);
          } else if (takingOff) {
            // Keep climb alive — a desk glance must not cancel auto-takeoff.
            rb.setLinvel({ x: lv.x * 0.4, y: Math.max(lv.y, 0.45), z: lv.z * 0.4 }, true);
          } else {
            // Survivable contact: absorb it. A quad easing into a wall is stopped
            // by it, not thrown off it — most of the approach speed goes into the
            // structure. Without this the solver returns the full contact impulse
            // and a gentle touch reads as a high-speed hit.
            rb.setLinvel({ x: lv.x * 0.25, y: lv.y, z: lv.z * 0.25 }, true);
          }
          // Arm the anti-tumble hold. This flag already existed and was already
          // set on indoor wall rescues, but nothing ever read it, so the contact
          // torque that rolls a drone over on touching a wall was never damped.
          wallBumpUntil.current = simTime.current + WALL_BUMP_HOLD;
        }
        if (v >= MINOR_IMPACT) {
          addShake(Math.min(0.35, (v - MINOR_IMPACT) / (MAJOR_IMPACT - MINOR_IMPACT)));
        }
      }}
    >
      {/* Central fuselage body collider (elevated above ground) */}
      <CuboidCollider
        args={[spec.armLength * 0.18, 0.008, spec.armLength * 0.18]}
        position={[0, 0.006, 0]}
        mass={spec.mass * 0.25}
        friction={0.8}
        restitution={0}
      />
      {/* Top canopy & camera stack collider (prevents underside tabletop penetration) */}
      <CuboidCollider
        args={[spec.armLength * 0.14, 0.008, spec.armLength * 0.22]}
        position={[0, 0.015, -spec.armLength * 0.12]}
        mass={spec.mass * 0.05}
        friction={0.8}
        restitution={0}
      />

      {/* 4 discrete corner landing foot colliders */}
      {/* Front-Right Foot */}
      <CuboidCollider
        args={[spec.armLength * 0.1, 0.012, spec.armLength * 0.1]}
        position={[armPerAxis, -0.012, -armPerAxis]}
        mass={spec.mass * 0.08}
        friction={0.8}
        restitution={0}
      />
      {/* Front-Left Foot */}
      <CuboidCollider
        args={[spec.armLength * 0.1, 0.012, spec.armLength * 0.1]}
        position={[-armPerAxis, -0.012, -armPerAxis]}
        mass={spec.mass * 0.08}
        friction={0.8}
        restitution={0}
      />
      {/* Back-Right Foot */}
      <CuboidCollider
        args={[spec.armLength * 0.1, 0.012, spec.armLength * 0.1]}
        position={[armPerAxis, -0.012, armPerAxis]}
        mass={spec.mass * 0.08}
        friction={0.8}
        restitution={0}
      />
      {/* Back-Left Foot */}
      <CuboidCollider
        args={[spec.armLength * 0.1, 0.012, spec.armLength * 0.1]}
        position={[-armPerAxis, -0.012, armPerAxis]}
        mass={spec.mass * 0.08}
        friction={0.8}
        restitution={0}
      />

      {/* 4 structural propeller & motor outer envelope colliders */}
      {/* Front-Right Prop Envelope */}
      <CuboidCollider
        args={[spec.armLength * 0.45, 0.014, spec.armLength * 0.45]}
        position={[armPerAxis, 0.008, -armPerAxis]}
        mass={spec.mass * 0.07}
        friction={0.6}
        restitution={0}
      />
      {/* Front-Left Prop Envelope */}
      <CuboidCollider
        args={[spec.armLength * 0.45, 0.014, spec.armLength * 0.45]}
        position={[-armPerAxis, 0.008, -armPerAxis]}
        mass={spec.mass * 0.07}
        friction={0.6}
        restitution={0}
      />
      {/* Back-Right Prop Envelope */}
      <CuboidCollider
        args={[spec.armLength * 0.45, 0.014, spec.armLength * 0.45]}
        position={[armPerAxis, 0.008, armPerAxis]}
        mass={spec.mass * 0.07}
        friction={0.6}
        restitution={0}
      />
      {/* Back-Left Prop Envelope */}
      <CuboidCollider
        args={[spec.armLength * 0.45, 0.014, spec.armLength * 0.45]}
        position={[-armPerAxis, 0.008, armPerAxis]}
        mass={spec.mass * 0.07}
        friction={0.6}
        restitution={0}
      />

      {/* 4 diagonal frame arm bridge colliders (prevents thin furniture legs from passing through arm gaps) */}
      {/* Front-Right Arm */}
      <CuboidCollider
        args={[spec.armLength * 0.2, 0.006, spec.armLength * 0.2]}
        position={[armPerAxis * 0.5, 0.004, -armPerAxis * 0.5]}
        mass={spec.mass * 0.025}
        friction={0.3}
        restitution={0.02}
      />
      {/* Front-Left Arm */}
      <CuboidCollider
        args={[spec.armLength * 0.2, 0.006, spec.armLength * 0.2]}
        position={[-armPerAxis * 0.5, 0.004, -armPerAxis * 0.5]}
        mass={spec.mass * 0.025}
        friction={0.3}
        restitution={0.02}
      />
      {/* Back-Right Arm */}
      <CuboidCollider
        args={[spec.armLength * 0.2, 0.006, spec.armLength * 0.2]}
        position={[armPerAxis * 0.5, 0.004, armPerAxis * 0.5]}
        mass={spec.mass * 0.025}
        friction={0.3}
        restitution={0.02}
      />
      {/* Back-Left Arm */}
      <CuboidCollider
        args={[spec.armLength * 0.2, 0.006, spec.armLength * 0.2]}
        position={[-armPerAxis * 0.5, 0.004, armPerAxis * 0.5]}
        mass={spec.mass * 0.025}
        friction={0.3}
        restitution={0.02}
      />

      <group ref={visual}>
        <DroneModel spec={spec} />
        <Propellers spec={spec} />
      </group>
    </RigidBody>
  );
}

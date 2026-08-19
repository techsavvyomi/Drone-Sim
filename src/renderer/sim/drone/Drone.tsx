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
import { ALT_MANAGED, FlightController, type ControlOutput } from '../control/flightController';
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
  isThrottleCommanded,
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
import { propHubs } from './propHubs';

// Module-scope scratch (single active drone) to avoid per-step allocations.
const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _up = new THREE.Vector3();
const _rotor = new THREE.Vector3();
const _upright = new THREE.Quaternion();
const _fwdV = new THREE.Vector3();
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

/** How far inside the arena edge the containment force starts, metres. */
const BOUND_MARGIN = 2;
/** Fall below this and the drone is considered lost — reset rather than drift. */
const LOST_ALTITUDE = -8;

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
/** Walls / furniture — only crash on a clear fast hit. Slow/medium bumps must not flip. */
const WALL_CRASH_SPEED = 3.2;
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
const TAKEOFF_ALT = 1.8;
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
}

function autoThrust(
  auto: AutoState,
  altitude: number,
  verticalSpeed: number,
  mass: number,
  hoverThrust: number,
): number {
  // Landing descent is deliberately gentle (~0.4 m/s), per spec.
  const climbRate =
    auto === 'takeoff' ? clamp(0.9 * (TAKEOFF_ALT - altitude), -0.8, 1.2) : -0.4;
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

export function Drone({ spec, spawn, bounds, outdoor = false }: DroneProps) {
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
  const prevSource = useRef(activeInputSource());
  /** Speed at the last physics step — used to grade collision severity. */
  const impactSpeed = useRef(0);
  /** Peak speed in a short window — tunneling can zero linvel before onCollisionEnter. */
  const peakSpeed = useRef(0);
  const peakSpeedUntil = useRef(0);
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
  const dragArea = useMemo(() => spec.armLength * spec.armLength * 1.8, [spec]);

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
    _q.setFromAxisAngle(UP_AXIS, spawn.heading * DEG2RAD);
    rb.setTranslation({ x, y, z }, true);
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
    prevVel.current = { x: 0, z: 0 };
    useFlightStore.getState().setOnGround(true);
    useFlightStore.getState().clearCrash();
    useFlightStore.getState().recharge();
  }, [resetToken, spawn, controller, battery]);

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
    if (speedNow >= peakSpeed.current || simTime.current > peakSpeedUntil.current) {
      peakSpeed.current = speedNow;
    }
    if (speedNow > 0.5) {
      peakSpeedUntil.current = simTime.current + PEAK_SPEED_HOLD;
    }

    // ---- Wind acts whether or not the drone is armed ----
    if (physics.wind.speed > 0) {
      const f = windForce(
        physics.wind,
        [lin.x, lin.y, lin.z],
        simTime.current,
        dragArea,
      );
      rb.applyImpulse(
        { x: f[0] * SIM_DT, y: f[1] * SIM_DT, z: f[2] * SIM_DT },
        true,
      );
    }

    // A crashed drone keeps its physics (so it tumbles and settles) but the
    // motors are dead and the controls are locked until reset.
    // ---- Ambient outdoor air movement ----
    // Applied while airborne only: on the ground the drone is planted, and a
    // drifting force there just fights the contact solver.
    if (outdoor && physics.ambientDriftEnabled && armed && !useFlightStore.getState().onGround) {
      const d = ambientDrift(simTime.current, _driftVec);
      const m = rb.mass();
      rb.applyImpulse(
        { x: d[0] * m * SIM_DT, y: d[1] * m * SIM_DT, z: d[2] * m * SIM_DT },
        true,
      );
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
      const d = hit ? hit.toi : maxRay;
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
        (lastContactState.current === 'UNSTABLE' || lastContactState.current === 'PARTIALLY_SUPPORTED')
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

    if (!armed || crashed) {
      lastOutput.current = null;
      motorThrust.current = [0, 0, 0, 0];
      motorNorm.current = [0, 0, 0, 0];
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
      thrustOverride = autoThrust(auto, pos.y, lin.y, rb.mass(), hoverThrust);
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
    const marginX = outdoor ? 8 : 0.2;
    const marginY = outdoor ? 15 : 0.2;
    const marginZ = outdoor ? 8 : 0.2;

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
          // Vertical axis (Y): Hard surface rescue whenever breached below ground level (p < 0.01m)
          if (p < 0.01) {
            push[i] = containK * (0.01 - p) * 16.0 - (vel[i] < 0 ? dampK * 2.5 * vel[i] : 0);
          } else if (overHigh > 0) {
            // Soft ceiling air-brake when approaching max altitude
            const ratio = clamp(overHigh / m, 0, 1);
            push[i] = -containK * ratio * 8.0 - (vel[i] > 0 ? dampK * vel[i] : 0);
          }
        } else {
          // Horizontal axes (X, Z): progressive air-brake near outer map perimeter
          if (overLow > 0) {
            const ratio = clamp(overLow / m, 0, 1);
            push[i] = containK * ratio * 8.0 - (vel[i] < 0 ? dampK * vel[i] : 0);
          } else if (overHigh > 0) {
            const ratio = clamp(overHigh / m, 0, 1);
            push[i] = -containK * ratio * 8.0 - (vel[i] > 0 ? dampK * vel[i] : 0);
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
      rb.applyImpulse(
        { x: push[0] * SIM_DT, y: push[1] * SIM_DT, z: push[2] * SIM_DT },
        true,
      );
    }
    // Hard surface rescue if high-speed vertical crash breached past the ground floor
    if (outdoor) {
      if (pos.y < -0.005) {
        const lv = rb.linvel();
        rb.setTranslation({ x: pos.x, y: 0.012, z: pos.z }, true);
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
        const hitSpeed = Math.max(impactSpeed.current, peakSpeed.current);
        rb.setTranslation({ x: cx, y: pos.y, z: cz }, true);
        rb.setLinvel({ x: vx, y: lv.y, z: vz }, true);

        // High-speed collision with outer invisible wall (hitSpeed >= 2.5 m/s) triggers fatal crash
        if (
          hitSpeed >= 2.5 &&
          useFlightStore.getState().auto !== 'takeoff' &&
          !useFlightStore.getState().crashed &&
          useFlightStore.getState().armed
        ) {
          useFlightStore.getState().crash(hitSpeed, pickBrokenProps());
          useFlightStore.getState().setArmed(false);
          addShake(Math.min(1, Math.max(0.5, hitSpeed / MAJOR_IMPACT)));
          peakSpeed.current = 0;
          motorThrust.current = [0, 0, 0, 0];
          motorNorm.current = [0, 0, 0, 0];
          rb.setLinvel({ x: 0, y: Math.min(lv.y, -0.4), z: 0 }, true);
          const torqueMag = THREE.MathUtils.clamp(hitSpeed * 0.05, 0.05, 0.3);
          rb.applyTorqueImpulse(
            {
              x: (Math.random() - 0.5) * torqueMag,
              y: (Math.random() - 0.5) * torqueMag * 0.5,
              z: (Math.random() - 0.5) * torqueMag,
            },
            true,
          );
        }
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
      Math.hypot(lin.x - prevVel.current.x, lin.z - prevVel.current.z) /
      (SIM_DT * GRAVITY);
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
    const isNearOutdoorBound = outdoor && (
      pos.x < bounds.min[0] + 12 || pos.x > bounds.max[0] - 12 ||
      pos.z < bounds.min[2] + 12 || pos.z > bounds.max[2] - 12 ||
      pos.y > bounds.max[1] - 15
    );
    if (mode !== 'acro' && !flightNow.crashed && !isNearGround && !isNearOutdoorBound) {
      _q.set(rot.x, rot.y, rot.z, rot.w);
      _euler.setFromQuaternion(_q, 'YXZ');
      const overTilt =
        Math.abs(_euler.z) > CRASH_TILT_RAD || Math.abs(_euler.x) > CRASH_TILT_RAD;
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
      const nowManaged = ALT_MANAGED.includes(flight.mode);
      const wasManaged = prevMode.current ? ALT_MANAGED.includes(prevMode.current) : false;
      if (nowManaged && !wasManaged) {
        // Entering: centre the spring-loaded stick so it holds rather than dives.
        stick.throttle = 0.5;
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
      motors: out
        ? ([...motorNorm.current] as [number, number, number, number])
        : [0, 0, 0, 0],
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
    if (altitude < LOST_ALTITUDE) {
      useSimStore.getState().requestReset();
      useFlightStore.getState().disarm();
      return;
    }

    // Realistic on-surface detection: must be level and nearly stationary
    const isLevel = Math.abs(_euler.x) < 0.38 && Math.abs(_euler.z) < 0.38;
    const isStationary =
      Math.abs(verticalSpeed) < 0.22 &&
      groundSpeed < 0.3 &&
      Math.hypot(av.x, av.y, av.z) < 0.8;
    const onGround =
      liveSupportInfo.current.isStable &&
      isLevel &&
      isStationary &&
      (altitude < GROUND_ALT || (!flight.armed && isStationary));
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
      (pilotOverride || (altitude >= TAKEOFF_ALT - 0.05 && Math.abs(verticalSpeed) < 0.3))
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
        stick.throttle = ALT_MANAGED.includes(flight.mode)
          ? 0.5
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
      } else {
        flight.disarm();
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

  const droneRadius = armPerAxis + propRadius * 0.7;
  const halfHeight = 0.02;

  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={spawn.position}
      // Low linear drag for smooth gliding momentum; high angular damping for jitter-free rotational stability
      linearDamping={0.30}
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
        const isAirborne = posY > 0.15;
        const isObstacleHit = isAirborne && v >= 0.8;
        const isImpactCrash = isObstacleHit || v >= MINOR_IMPACT || (v >= 0.8 && isTilted);

        if (isImpactCrash && flight.auto !== 'takeoff' && flight.armed) {
          flight.crash(v, pickBrokenProps());
          flight.setArmed(false);
          addShake(Math.min(1, Math.max(0.4, v / MAJOR_IMPACT)));
          peakSpeed.current = 0;
          motorThrust.current = [0, 0, 0, 0];
          motorNorm.current = [0, 0, 0, 0];

          // Zero-bounce crash response: absorb horizontal velocity completely, cut thrust, and drop under gravity
          if (rb) {
            rb.setLinvel({ x: 0, y: Math.min(rb.linvel().y, -0.4), z: 0 }, true);
            const torqueMag = THREE.MathUtils.clamp(v * 0.05, 0.05, 0.3);
            rb.applyTorqueImpulse(
              {
                x: (Math.random() - 0.5) * torqueMag,
                y: (Math.random() - 0.5) * torqueMag * 0.5,
                z: (Math.random() - 0.5) * torqueMag,
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
          }
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
        args={[spec.armLength * 0.10, 0.012, spec.armLength * 0.10]}
        position={[armPerAxis, -0.012, -armPerAxis]}
        mass={spec.mass * 0.08}
        friction={0.8}
        restitution={0}
      />
      {/* Front-Left Foot */}
      <CuboidCollider
        args={[spec.armLength * 0.10, 0.012, spec.armLength * 0.10]}
        position={[-armPerAxis, -0.012, -armPerAxis]}
        mass={spec.mass * 0.08}
        friction={0.8}
        restitution={0}
      />
      {/* Back-Right Foot */}
      <CuboidCollider
        args={[spec.armLength * 0.10, 0.012, spec.armLength * 0.10]}
        position={[armPerAxis, -0.012, armPerAxis]}
        mass={spec.mass * 0.08}
        friction={0.8}
        restitution={0}
      />
      {/* Back-Left Foot */}
      <CuboidCollider
        args={[spec.armLength * 0.10, 0.012, spec.armLength * 0.10]}
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
        args={[spec.armLength * 0.20, 0.006, spec.armLength * 0.20]}
        position={[armPerAxis * 0.5, 0.004, -armPerAxis * 0.5]}
        mass={spec.mass * 0.025}
        friction={0.3}
        restitution={0.02}
      />
      {/* Front-Left Arm */}
      <CuboidCollider
        args={[spec.armLength * 0.20, 0.006, spec.armLength * 0.20]}
        position={[-armPerAxis * 0.5, 0.004, -armPerAxis * 0.5]}
        mass={spec.mass * 0.025}
        friction={0.3}
        restitution={0.02}
      />
      {/* Back-Right Arm */}
      <CuboidCollider
        args={[spec.armLength * 0.20, 0.006, spec.armLength * 0.20]}
        position={[armPerAxis * 0.5, 0.004, armPerAxis * 0.5]}
        mass={spec.mass * 0.025}
        friction={0.3}
        restitution={0.02}
      />
      {/* Back-Left Arm */}
      <CuboidCollider
        args={[spec.armLength * 0.20, 0.006, spec.armLength * 0.20]}
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

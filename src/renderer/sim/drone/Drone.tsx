import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CuboidCollider,
  RigidBody,
  useBeforePhysicsStep,
  type RapierRigidBody,
} from '@react-three/rapier';
import * as THREE from 'three';
import type { DroneSpec, FlightMode, Vec3 } from '@shared/types';
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
import { stick, updateStick, resetStick } from '../../input/controls';
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

/** Impact speeds (m/s): below MINOR nothing, above MAJOR is a crash. */
const MINOR_IMPACT = 1.8;
const MAJOR_IMPACT = 4.5;

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

const GROUND_ALT = 0.06;
const TAKEOFF_ALT = 1.5;
const MAX_ANGVEL = 40;

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
  const body = useRef<RapierRigidBody>(null);
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
  /** Speed at the last physics step — used to grade collision severity. */
  const impactSpeed = useRef(0);
  /** Seconds the pack has been continuously below LOW_VOLTAGE. */
  const lowVoltageFor = useRef(0);
  /** Previous horizontal velocity, for deriving lateral G. */
  const prevVel = useRef({ x: 0, z: 0 });
  const smoothLateralG = useRef(0);
  const crashHold = useRef(0);

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
    impactSpeed.current = Math.hypot(lin.x, lin.y, lin.z);

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

    if (!armed || crashed) {
      lastOutput.current = null;
      motorThrust.current = [0, 0, 0, 0];
      motorNorm.current = [0, 0, 0, 0];
      return;
    }

    flightTime.current += SIM_DT;

    const pin = rb.principalInertia();
    inertia.current = [pin.x, pin.y, pin.z];

    const rot = rb.rotation();
    const av = rb.angvel();

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
    // EnvironmentSpec.bounds previously described the play area without
    // anything enforcing it, so leaving the arena meant flying off into empty
    // space (and, past the floor plane, falling forever). A spring-damper near
    // each edge eases the drone back in instead of letting it escape or
    // slamming into the wall collider at speed.
    const containK = 3.2 * rb.mass();
    const dampK = 1.4 * rb.mass();
    const axes: [number, number, number][] = [
      [pos.x, bounds.min[0], bounds.max[0]],
      [pos.y, bounds.min[1], bounds.max[1]],
      [pos.z, bounds.min[2], bounds.max[2]],
    ];
    const vel = [lin.x, lin.y, lin.z];
    const push = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const [p, lo, hi] = axes[i];
      const overLow = lo + BOUND_MARGIN - p;
      const overHigh = p - (hi - BOUND_MARGIN);
      if (overLow > 0) {
        push[i] = containK * overLow - (vel[i] < 0 ? dampK * vel[i] : 0);
      } else if (overHigh > 0) {
        push[i] = -containK * overHigh - (vel[i] > 0 ? dampK * vel[i] : 0);
      }
    }
    if (push[0] || push[1] || push[2]) {
      rb.applyImpulse(
        { x: push[0] * SIM_DT, y: push[1] * SIM_DT, z: push[2] * SIM_DT },
        true,
      );
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
    if (mode !== 'acro' && !flightNow.crashed && !flightNow.onGround) {
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
    _up.set(av.x, av.y, av.z).applyQuaternion(_q.clone().invert());
    const gyro: Vec3 = [_up.x, _up.y, _up.z];

    // Specific force along body-up, in g — what a real IMU reports.
    const totalThrust = out ? out.motorThrusts.reduce((s, f) => s + f, 0) : 0;
    const accelG = totalThrust / Math.max(rb.mass() * GRAVITY, 1e-6);

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
      gyro,
      accel: [0, accelG, 0],
    });

    // Fell off the world — recover rather than accelerating downward forever.
    if (altitude < LOST_ALTITUDE) {
      useSimStore.getState().requestReset();
      useFlightStore.getState().disarm();
      return;
    }

    const onGround = altitude < GROUND_ALT && Math.abs(verticalSpeed) < 0.25;
    if (onGround !== flight.onGround) flight.setOnGround(onGround);

    // Auto-right a crashed drone once disarmed and settled.
    if (!flight.armed && onGround) {
      _fwdV.set(0, 0, -1).applyQuaternion(_q);
      const h = Math.hypot(_fwdV.x, _fwdV.z) > 1e-3 ? Math.atan2(-_fwdV.x, -_fwdV.z) : 0;
      _upright.setFromAxisAngle(UP_AXIS, h);
      if (_q.angleTo(_upright) > 0.02) {
        _q.slerp(_upright, Math.min(1, delta * 6));
        rb.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
        rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    if (flight.auto === 'takeoff' && altitude >= TAKEOFF_ALT - 0.05 && Math.abs(verticalSpeed) < 0.3) {
      stick.throttle = ALT_MANAGED.includes(flight.mode)
        ? 0.5
        : clamp(hoverThrust / controller.maxThrust, 0, 1);
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

  const half: [number, number, number] = [
    armPerAxis + propRadius,
    0.024,
    armPerAxis + propRadius,
  ];

  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={spawn.position}
      // A 50 g quad with large props bleeds speed quickly; too little drag and
      // it glides on after you centre the sticks, which feels like overshoot.
      linearDamping={0.55}
      angularDamping={2.4}
      canSleep={false}
      // Without CCD a fast drone steps straight through thin colliders (walls,
      // hangar sides) between physics ticks and ends up inside the geometry.
      ccd
      onCollisionEnter={() => {
        const v = impactSpeed.current;
        const flight = useFlightStore.getState();
        if (flight.crashed) return;
        if (v >= MAJOR_IMPACT) {
          // Major impact: motors cut, controls locked until R.
          flight.crash(v, pickBrokenProps());
          addShake(1);
        } else if (v >= MINOR_IMPACT) {
          // Minor knock: bounce and shake, keep flying.
          addShake(Math.min(0.6, (v - MINOR_IMPACT) / (MAJOR_IMPACT - MINOR_IMPACT)));
        }
      }}
    >
      <CuboidCollider args={half} mass={spec.mass} restitution={0.08} friction={0.25} />
      <group ref={visual}>
        <DroneModel spec={spec} />
        <Propellers spec={spec} />
      </group>
    </RigidBody>
  );
}

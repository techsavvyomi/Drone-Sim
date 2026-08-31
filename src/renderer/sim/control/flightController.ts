import * as THREE from 'three';
import type { ContactState, DroneSpec, FlightMode, StickInput, Vec3 } from '@shared/types';
import { clamp, DEG2RAD } from '../mathx';
import { GRAVITY } from '../constants';
import { PidController } from './pid';
import { mixQuad, type MixResult } from './mixer';

// Flight controller for the three modes the simulator actually models:
//
//   Stabilize     — sticks command a bank/pitch ANGLE, auto-levels on release.
//   Altitude Hold — same attitude control, but the throttle stick is spring
//                   centred and commands climb rate; centre holds height.
//   Acro          — sticks command angular RATE directly, no auto-level.
//
// Position-based modes (Position Hold, Guided, RTH) are deliberately absent:
// there is no GPS model here, so offering them would imply a capability the
// simulator doesn't have.

export interface ControlState {
  /** Body orientation quaternion [x,y,z,w]. */
  rotation: [number, number, number, number];
  /** Angular velocity in WORLD frame (rad/s). */
  angvelWorld: Vec3;
  /** Linear velocity in WORLD frame (m/s). */
  velocityWorld: Vec3;
  /** World position (m). */
  position: Vec3;
  /** Principal moments of inertia (body frame) from Rapier. */
  inertia: Vec3;
  /** Total mass (kg). */
  mass: number;
  /** Per-motor thrust ceiling right now (N), after battery fade. */
  maxPerMotor: number;
  /** Extra thrust multiplier from ground effect (>= 1). */
  groundEffect: number;
  /** Resting on the ground — arming must idle, not hold altitude. */
  onGround: boolean;
  /** Physical contact & support stability state */
  contactState?: ContactState;
  isStable?: boolean;
}

export interface ControlOutput {
  /** Per-motor thrust in Newtons (FR, FL, BR, BL). */
  motorThrusts: [number, number, number, number];
  /** Per-motor normalized output 0..1 for telemetry. */
  motors: [number, number, number, number];
  /** Net yaw reaction torque (N·m) about body up. */
  yawTorque: number;
  /** Attitude for the HUD (radians). */
  attitude: { roll: number; pitch: number; yaw: number };
  /** True when motors clipped (attitude authority degraded). */
  saturated: boolean;
  /** Total commanded thrust as a fraction of maximum (0..1), for the HUD. */
  throttleFraction: number;
}

export interface ControllerConfig {
  maxTiltDeg: number;
  maxYawRate: number; // rad/s
  maxRateSetpoint: number; // rad/s
  maxAngAccel: number; // rad/s^2
  angleP: number; // tilt error (rad) -> rate setpoint
  maxClimbRate: number; // m/s
  altP: number; // altitude error -> climb rate
  climbP: number; // climb rate error -> vertical accel
}

export const BEGINNER_CONFIG: ControllerConfig = {
  // Trainer tilt: enough lean to translate indoors, not so much that full stick
  // looks like the whoop is diving. Keyboard expo still softens small inputs.
  maxTiltDeg: 22,
  maxYawRate: 2.6,
  maxRateSetpoint: 7,
  maxAngAccel: 90,
  angleP: 8,
  maxClimbRate: 1.8,
  altP: 1.3,
  climbP: 3.2,
};

/**
 * Modes whose thrust is managed by the altitude controller rather than being a
 * direct throttle position. In these the throttle stick is SPRING-CENTRED:
 * centre holds altitude, above climbs, below descends.
 */
export const ALT_MANAGED: FlightMode[] = ['altitude-hold'];

/**
 * The envelope this airframe actually flies in: the shared trainer config with
 * the drone's own `handling` overrides laid over it.
 *
 * Exported because the flight controller is not the only thing that has to
 * agree on these numbers — Flight School's demonstrations are planned against
 * the trainer envelope and rescaled into this one at playback.
 */
export function configFor(
  spec: DroneSpec,
  base: ControllerConfig = BEGINNER_CONFIG,
): ControllerConfig {
  const over = spec.handling;
  if (!over) return base;
  return {
    ...base,
    ...(over.maxTiltDeg !== undefined && { maxTiltDeg: over.maxTiltDeg }),
    ...(over.maxYawRate !== undefined && { maxYawRate: over.maxYawRate }),
    ...(over.maxRateSetpoint !== undefined && { maxRateSetpoint: over.maxRateSetpoint }),
    ...(over.maxClimbRate !== undefined && { maxClimbRate: over.maxClimbRate }),
  };
}

const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _qDes = new THREE.Quaternion();
const _eDes = new THREE.Euler();
const _euler = new THREE.Euler();
const _omega = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _bodyUp = new THREE.Vector3();
const _desiredUp = new THREE.Vector3();
const _axis = new THREE.Vector3();

const STICK_DEADBAND = 0.06;

/**
 * Below this much commanded collective (N) the motors are treated as STOPPED.
 * Not a tuning knob — see the cut in `update()`.
 */
const THRUST_CUTOFF = 1e-4;

export class FlightController {
  private rollRate: PidController;
  private pitchRate: PidController;
  private yawRate: PidController;

  private heading = 0;
  /** Altitude held when the throttle stick is centred (Altitude Hold). */
  private targetAltitude = 0;
  private lastMode: FlightMode | null = null;
  /** Yaw reaction coefficient (N·m per N). */
  private readonly kQ: number;
  private readonly armPerAxis: number;

  private readonly config: ControllerConfig;

  constructor(
    private spec: DroneSpec,
    base: ControllerConfig = BEGINNER_CONFIG,
  ) {
    // The airframe gets the last word on its own limits: a race quad banks
    // further and climbs faster than the trainer envelope allows.
    const config = configFor(spec, base);
    this.config = config;
    // Term limits mirror the Magis V2 firmware's pidLuxFloat, which bounds the
    // I contribution to 250 and the D contribution to 300 of a +/-1000 output
    // range — i.e. 25% and 30% of full authority.
    const limitsFor = (gains: { i: number }) => ({
      iLimit: (0.25 * config.maxAngAccel) / Math.max(gains.i, 0.1),
      iTermLimit: 0.25 * config.maxAngAccel,
      dTermLimit: 0.3 * config.maxAngAccel,
      outLimit: config.maxAngAccel,
      dCutHz: 40, // Magis' dterm_cut_hz equivalent
    });
    this.rollRate = new PidController(
      spec.pidDefaults.rate.roll,
      limitsFor(spec.pidDefaults.rate.roll),
    );
    this.pitchRate = new PidController(
      spec.pidDefaults.rate.pitch,
      limitsFor(spec.pidDefaults.rate.pitch),
    );
    this.yawRate = new PidController(
      spec.pidDefaults.rate.yaw,
      limitsFor(spec.pidDefaults.rate.yaw),
    );
    this.armPerAxis = spec.armLength / Math.SQRT2;
    // Reaction torque scales with rotor size.
    this.kQ = Math.max(spec.armLength * 0.15, 0.005);
  }

  reset(): void {
    this.rollRate.reset();
    this.pitchRate.reset();
    this.yawRate.reset();
    this.heading = 0;
    this.lastMode = null;
  }

  /**
   * Zero the rate integrators. Real flight controllers do this while disarmed
   * or at idle throttle, so the drone doesn't lurch on takeoff from integral
   * charged up while the ground was holding it level.
   */
  resetIntegrators(): void {
    this.rollRate.resetIntegral();
    this.pitchRate.resetIntegral();
    this.yawRate.resetIntegral();
  }

  /** Capture the current altitude before handing an automatic climb to Alt Hold. */
  captureAltitude(altitude: number): void {
    this.targetAltitude = altitude;
  }

  get maxThrust(): number {
    return this.spec.motors.reduce((s, m) => s + m.maxThrustN, 0);
  }

  /** Yaw reaction coefficient (N·m of yaw torque per N of thrust). */
  get yawCoefficient(): number {
    return this.kQ;
  }

  update(
    input: StickInput,
    mode: FlightMode,
    state: ControlState,
    dt: number,
    thrustOverride?: number,
  ): ControlOutput {
    _q.set(state.rotation[0], state.rotation[1], state.rotation[2], state.rotation[3]);
    _qInv.copy(_q).invert();
    _euler.setFromQuaternion(_q, 'YXZ'); // HUD only — singular past 90°

    _omega.set(state.angvelWorld[0], state.angvelWorld[1], state.angvelWorld[2]);
    _omega.applyQuaternion(_qInv);
    const pitchRate = _omega.x;
    const yawRateMeasured = _omega.y;
    const rollRate = _omega.z;

    // Track heading from the body forward vector projected onto the ground.
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    if (Math.hypot(_fwd.x, _fwd.z) > 1e-3) {
      this.heading = Math.atan2(-_fwd.x, -_fwd.z);
    }

    _bodyUp.set(0, 1, 0).applyQuaternion(_q);
    const tiltCos = clamp(_bodyUp.y, 0.35, 1); // for thrust compensation

    // Capture the hold altitude whenever the mode changes.
    if (mode !== this.lastMode) {
      this.targetAltitude = state.position[1];
      this.lastMode = mode;
    }

    const maxRate = this.config.maxRateSetpoint;
    const maxTilt = this.config.maxTiltDeg * DEG2RAD;
    let rollRateSp: number;
    let pitchRateSp: number;

    if (mode === 'acro') {
      // Rate mode: sticks command angular rate directly, no auto-level.
      rollRateSp = -input.roll * maxRate;
      pitchRateSp = -input.pitch * maxRate;
    } else {
      // Stabilize / Altitude Hold: quaternion tilt error, valid at ANY attitude
      // (including upside-down), so the drone always self-rights.
      const desiredRoll = -input.roll * maxTilt;
      const desiredPitch = -input.pitch * maxTilt;

      _eDes.set(desiredPitch, this.heading, desiredRoll, 'YXZ');
      _qDes.setFromEuler(_eDes);
      _desiredUp.set(0, 1, 0).applyQuaternion(_qDes);

      _axis.crossVectors(_bodyUp, _desiredUp);
      const sinA = _axis.length();
      const cosA = clamp(_bodyUp.dot(_desiredUp), -1, 1);
      const angle = Math.atan2(sinA, cosA);

      if (sinA > 1e-6) {
        _axis.multiplyScalar(angle / sinA);
      } else if (cosA < 0) {
        _right.set(1, 0, 0).applyQuaternion(_q);
        _axis.copy(_right).multiplyScalar(Math.PI);
      } else {
        _axis.set(0, 0, 0);
      }
      _axis.applyQuaternion(_qInv);

      rollRateSp = clamp(this.config.angleP * _axis.z, -maxRate, maxRate);
      pitchRateSp = clamp(this.config.angleP * _axis.x, -maxRate, maxRate);
    }

    // Sign is negated so the left yaw key rotates the drone clockwise (viewed
    // from above) and the right key anticlockwise, per the requested feel.
    const yawRateSp = -input.yaw * this.config.maxYawRate;

    const aRoll = this.rollRate.update(rollRateSp - rollRate, dt, rollRate);
    const aPitch = this.pitchRate.update(pitchRateSp - pitchRate, dt, pitchRate);
    const aYaw = this.yawRate.update(yawRateSp - yawRateMeasured, dt, yawRateMeasured);

    // Inertia-normalized torques (body frame).
    const tauX = state.inertia[0] * aPitch;
    const tauY = state.inertia[1] * aYaw;
    const tauZ = state.inertia[2] * aRoll;

    // ---- Collective thrust ----
    const tMaxNow = state.maxPerMotor * 4;
    let thrust: number;

    if (thrustOverride !== undefined) {
      thrust = thrustOverride;
    } else if (ALT_MANAGED.includes(mode)) {
      thrust = this.altitudeThrust(input, state, tiltCos);
    } else {
      thrust = clamp(input.throttle, 0, 1) * this.maxThrust;
    }
    thrust = clamp(thrust * state.groundEffect, 0, tMaxNow);
    // Altitude ceiling applies in every mode, including manual throttle.
    thrust = this.applyCeiling(thrust, state, tiltCos);

    // ---- Unstable Edge Support Gating ----
    // When resting or landing on an edge with low throttle and insufficient support (CoM outside support):
    // Suppress PID attitude leveling torque and collective thrust so motors do NOT artificially levitate overhangs!
    const isUnstableEdge =
      (state.contactState === 'PARTIALLY_SUPPORTED' || state.contactState === 'UNSTABLE') &&
      input.throttle < 0.35;

    let torqueScale: number;
    if (isUnstableEdge) {
      torqueScale = 0.0;
      thrust = 0.0;
    } else if (state.contactState === 'FLYING_NEAR_SURFACE' || state.contactState === 'AIRBORNE') {
      torqueScale = 1.0; // 100% full authority during active flight / pilot throttle
    } else {
      const throttleRatio = clamp(thrust / Math.max(state.mass * GRAVITY, 1e-4), 0, 1);
      torqueScale = input.throttle <= 0.08 ? 0.05 : Math.max(0.1, throttleRatio);
    }

    // ---- Zero collective means the motors are OFF, not merely quiet ----
    //
    // The mixer hands every motor `thrust/4 ± torque`, so with a collective of
    // zero the negative half is clamped away and the positive half survives:
    // the aircraft makes real, asymmetric thrust out of an attitude correction
    // it was never given any lift to spend. Armed on the pad in Altitude Hold
    // that is exactly what happened — the throttle stick sits centred, so
    // `altitudeThrust()` correctly returns 0, but `input.throttle` of 0.5 is
    // above the idle test below and left the torque channel open at 0.1. The
    // drone slowly pitched forward and crept off the pad with its props
    // running, having been commanded nothing at all.
    //
    // A real quad behaves the same way: no throttle is no airflow and no
    // authority. Cutting here rather than inside the mixer keeps the reported
    // motor outputs honest, which is what the props and the audio are drawn
    // and pitched from.
    if (thrust <= THRUST_CUTOFF) {
      return {
        motorThrusts: [0, 0, 0, 0],
        motors: [0, 0, 0, 0],
        yawTorque: 0,
        attitude: { roll: _euler.z, pitch: _euler.x, yaw: _euler.y },
        saturated: false,
        throttleFraction: 0,
      };
    }

    // ---- Mix to motors (saturation is physically real from here on) ----
    const mix: MixResult = mixQuad(
      thrust,
      tauX * torqueScale,
      tauZ * torqueScale,
      tauY * torqueScale,
      this.armPerAxis,
      this.kQ,
      state.maxPerMotor,
    );

    const perMotorMax = Math.max(state.maxPerMotor, 1e-6);
    const motors = mix.thrusts.map((f) => clamp(f / perMotorMax, 0, 1)) as [
      number,
      number,
      number,
      number,
    ];

    return {
      motorThrusts: mix.thrusts,
      motors,
      yawTorque: mix.yawTorque,
      attitude: { roll: _euler.z, pitch: _euler.x, yaw: _euler.y },
      saturated: mix.saturated,
      throttleFraction: clamp(thrust / Math.max(tMaxNow, 1e-6), 0, 1),
    };
  }

  /**
   * Soft altitude ceiling. Within the margin below the drone's maxAltitude the
   * permitted climb rate fades to zero, so the drone eases into the limit
   * rather than hitting an invisible wall. Descent is never limited.
   */
  private applyCeiling(thrust: number, state: ControlState, tiltCos: number): number {
    const ceiling = this.spec.maxAltitude;
    if (!ceiling || ceiling <= 0) return thrust;

    const margin = 2;
    const alt = state.position[1];
    if (alt < ceiling - margin) return thrust;

    const t = clamp((alt - (ceiling - margin)) / margin, 0, 1);
    const allowedClimb = this.config.maxClimbRate * (1 - t);
    const vz = state.velocityWorld[1];

    const hover = (state.mass * GRAVITY) / tiltCos;
    const limit = hover + state.mass * 3.0 * (allowedClimb - vz);
    return Math.min(thrust, Math.max(limit, 0));
  }

  /** Thrust from the altitude controller (Altitude Hold). */
  private altitudeThrust(input: StickInput, state: ControlState, tiltCos: number): number {
    const alt = state.position[1];
    const vz = state.velocityWorld[1];

    // Throttle stick pulled all the way down (<= 0.08): user wants to cut throttle / land immediately.
    if (input.throttle <= 0.08) {
      return 0;
    }

    // Throttle stick above/below centre commands climb rate; centred = hold.
    const stick = clamp(input.throttle, 0, 1) - 0.5;
    const stickActive = Math.abs(stick) > STICK_DEADBAND;

    // Armed and resting on the ground with no climb commanded: motors stay
    // STOPPED. Arming makes the aircraft live, it does not spin the props —
    // nothing turns until the pilot actually commands a climb.
    if (state.onGround && !(stickActive && stick > 0)) {
      this.targetAltitude = alt;
      return 0;
    }

    let climbSp: number;
    if (stickActive) {
      climbSp = stick * 2 * this.config.maxClimbRate;
      this.targetAltitude = alt; // follow the stick, resume holding on release
    } else {
      climbSp = clamp(
        this.config.altP * (this.targetAltitude - alt),
        -this.config.maxClimbRate,
        this.config.maxClimbRate,
      );
    }

    // When descending with stick pulled down (e.g. stick < -0.15), smoothly taper thrust toward 0
    const descentTaper = stick < -0.15 ? clamp((input.throttle - 0.08) / 0.27, 0, 1) : 1;
    const accel = clamp(this.config.climbP * (climbSp - vz), -9.8, 8);
    const rawThrust = (state.mass * Math.max(0, GRAVITY + accel)) / tiltCos;
    return rawThrust * descentTaper;
  }
}

import * as THREE from 'three';
import type {
  AcroRates,
  ContactState,
  DroneSpec,
  FlightMode,
  StickInput,
  Vec3,
} from '@shared/types';
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
  /**
   * The aerodynamic moment acting on the body this step, BODY frame, N·m
   * (x pitch, y yaw, z roll). Acro feeds it forward — see `update()`.
   */
  aeroTorque?: Vec3;
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
 * direct throttle position. Here the throttle stick commands a CLIMB RATE:
 * centre holds altitude, above climbs, below descends. Where the stick rests is
 * a separate question — see `SPRING_THROTTLE`.
 */
export const ALT_MANAGED: FlightMode[] = ['altitude-hold'];

/**
 * Modes whose throttle stick RESTS at centre — release it and it springs back.
 *
 * A superset of `ALT_MANAGED`, and deliberately a separate list, because the two
 * answer different questions: `ALT_MANAGED` is what the stick *commands* (a
 * climb rate the altitude controller flies), this is only where the stick
 * *sits*. Acro's thrust stays direct — centre is plain mid-throttle, which is a
 * hover on both Pluto airframes — but the stick self-centres, which is what a
 * gamepad's left stick already does in every mode. Without acro in this list the
 * keyboard and a pad disagreed about the same mode.
 */
export const SPRING_THROTTLE: FlightMode[] = [...ALT_MANAGED, 'acro'];

/**
 * Where a spring-centred throttle stick rests. Shared, because the input layer,
 * the mode handover and the collective all have to agree on it — and because it
 * is not an arbitrary number: it is the stick position at which a direct throttle
 * makes exactly hover thrust on the Pluto airframes.
 */
export const THROTTLE_CENTER = 0.5;

/**
 * MagisV2's factory control-rate profile (`resetControlRateConfig`): what a
 * Pluto flies Acro on out of the box. Full stick is ~137 deg/s.
 */
export const MAGIS_ACRO_RATES: AcroRates = { kind: 'magis', rcRate8: 90, rcExpo8: 65, rate: 0 };

/** Betaflight 4.3+ defaults (`controlrate_profile.c`): Actual, 70 / 670 deg/s, no expo. */
export const BETAFLIGHT_ACRO_RATES: AcroRates = {
  kind: 'actual',
  centerDps: 70,
  maxDps: 670,
  expo: 0,
};

/**
 * Acro rotation rate for a stick position (-1..1), in deg/s — the firmware's
 * own arithmetic, not a fit.
 *
 * Magis (`mw.cpp` + `rc_curves.cpp` + `pid.cpp` `pidRewrite`, the Pluto's
 * default controller): the stick's 0..500 deflection is read off a 7-point
 * table `(2500 + rcExpo8·(i²−25))·i·rcRate8/2500` with linear interpolation,
 * giving rcCommand; the rate setpoint is `(rate+20)·rcCommand >> 4`, compared
 * against `gyroADC/4` from an ICM20948 at ±2000 dps (16.4 LSB per deg/s), so
 * one deg/s is 4.1 setpoint units.
 *
 * Betaflight Actual (`rc.c` `applyActualRates`):
 * `x·centre + max(0, max−centre)·|x|·(x⁵·expo + x·(1−expo))`.
 */
export function acroRateDps(stick: number, rates: AcroRates): number {
  const x = clamp(stick, -1, 1);
  const ax = Math.abs(x);
  if (rates.kind === 'actual') {
    const expof = ax * (x ** 5 * rates.expo + x * (1 - rates.expo));
    return x * rates.centerDps + Math.max(0, rates.maxDps - rates.centerDps) * expof;
  }
  const lookup = (i: number) => ((2500 + rates.rcExpo8 * (i * i - 25)) * i * rates.rcRate8) / 2500;
  const tmp = ax * 500;
  const i = Math.min(Math.floor(tmp / 100), 4);
  const rcCommand = lookup(i) + ((tmp - i * 100) * (lookup(i + 1) - lookup(i))) / 100;
  const dps = ((rates.rate + 20) * rcCommand) / 16 / 4.1;
  return Math.sign(x) * dps;
}

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

// Controller response tuning, chosen for a firmer collective around hover.
// Continuous and monotonic: idle, centre and full travel stay exactly 0/.5/1.
// This changes thrust demand, never holds height in Acro or Stabilize.
// The gain is the extra slope at centre: 0.6 gives 1.6x there and 0.4x at the
// ends; it must stay below 1 or the curve flattens out at idle and full.
const CONTROLLER_THROTTLE_GAIN = 0.6;
function controllerThrottle(t: number): number {
  const x = clamp(t, 0, 1) * 2 - 1;
  return (x * (1 + CONTROLLER_THROTTLE_GAIN * (1 - Math.abs(x))) + 1) / 2;
}

/**
 * Thrust Acro can call on, as a multiple of the airframe's rated full thrust.
 * Acro is flown for punch: at the rated ~2:1 the Pluto climbed and checked a
 * descent too gently for it. 1.5 makes ~3:1 and puts hover near 33% collective.
 * Acro only. Applied here to the collective AND to the motors' ceiling, so the
 * mixer saturates where the collective does; callers pass the rated ceiling.
 */
export const ACRO_THRUST_BOOST = 1.5;

/**
 * Acro's controller collective. Acro has no climb loop behind the stick, so it
 * gets the sharper response: x * (1 + k(1 - |x|)^2) is (1 + k)x slope at centre
 * and back to 1x at idle and full, so neither end goes dead. The slope is
 * lowest two thirds of the way out, at 1 - k/3, so it is monotonic for k < 3;
 * at 2 the centre is 3x and the slope never falls below 0.33x anywhere.
 */
const ACRO_CONTROLLER_THROTTLE_GAIN = 2;
function acroControllerThrottle(t: number): number {
  const x = clamp(t, 0, 1) * 2 - 1;
  const r = 1 - Math.abs(x);
  return (x * (1 + ACRO_CONTROLLER_THROTTLE_GAIN * r * r) + 1) / 2;
}

/**
 * Below this much commanded collective (N) the motors are treated as STOPPED.
 * Not a tuning knob — see the cut in `update()`.
 */
const THRUST_CUTOFF = 1e-4;

/**
 * ESC idle, as a fraction of full collective, held while the pilot commands the
 * throttle down.
 *
 * Five per cent is a tenth of a hover on the Pluto airframes: enough that the
 * props are visibly turning and the motors are audible, far too little to slow
 * a descent into a hover. Chopping the throttle must still be how you come down.
 */
const IDLE_COLLECTIVE = 0.05;

/**
 * The fastest the bottom of the stick may sink, in m/s.
 *
 * The descent was capped at the plain `maxClimbRate` — 2.6 m/s on the Guru —
 * which is a safe rate and a slow one: a pilot holding the throttle down from
 * height is asking to get down, and the aircraft can do better than that
 * without being in any danger.
 *
 * The ceiling on "better" is the floor. `Drone.tsx` writes the airframe off on
 * arrival at FLOOR_CRASH, and the rule there is that a descent the MODE is
 * managing must never be able to destroy the aircraft — so the two numbers move
 * together. The cap is twice the climb rate held under 5, and the crash line
 * sits a metre a second above it: a stick held all the way down is a fast,
 * deliberate arrival, and it is still a landing.
 */
function maxDescentRate(maxClimbRate: number): number {
  return Math.min(maxClimbRate * 2, 5);
}

/**
 * How hard Altitude Hold may slow a climb it was handed on ENTRY, in m/s^2.
 *
 * Entering Alt Hold used to capture the altitude of that instant and demand
 * `climbP × (0 − vz)` at once. Climbing at 3 m/s that is −9.6 m/s^2, clamped at
 * −9.8: about 2% of the aircraft's weight in thrust, motors at ~0.04. Now the
 * climb-rate setpoint starts at the climb the aircraft has and comes down at
 * this rate, and the hold height is where that brings it to rest. 2.5 is the
 * user's starting value (2026-10-05), to be tuned by feel.
 *
 * Only a climb is eased. A descent handed over is not the motor-drop case, and
 * easing it would let a fast descent near the ground arrive harder than the
 * existing powered stop does.
 */
const ALT_ENTRY_DECEL = 2.5;

export class FlightController {
  private rollRate: PidController;
  private pitchRate: PidController;
  private yawRate: PidController;

  private heading = 0;
  /** Altitude held when the throttle stick is centred (Altitude Hold). */
  private targetAltitude = 0;
  /** Eased climb-rate setpoint after an entry into Alt Hold, or null. See ALT_ENTRY_DECEL. */
  private entryClimbSp: number | null = null;
  /**
   * Arming interlock: the motors answer nothing until the pilot has commanded
   * the throttle down once. See `lockThrottle()`.
   */
  private throttleInterlock = false;
  private lastMode: FlightMode | null = null;
  /** Yaw reaction coefficient (N·m per N). */
  private readonly kQ: number;
  private readonly armPerAxis: number;

  private readonly config: ControllerConfig;
  private readonly acroRates: AcroRates;
  /** Body-rate setpoints from the last `update()`, rad/s. Read-only outside. */
  readonly rateSp = { roll: 0, pitch: 0, yaw: 0 };
  private previousRates = { roll: 0, pitch: 0, yaw: 0 };
  private rateDerivativePrimed = false;

  constructor(
    private spec: DroneSpec,
    base: ControllerConfig = BEGINNER_CONFIG,
  ) {
    // The airframe gets the last word on its own limits: a race quad banks
    // further and climbs faster than the trainer envelope allows.
    const config = configFor(spec, base);
    this.config = config;
    this.acroRates = spec.handling?.acroRates ?? MAGIS_ACRO_RATES;
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
    this.throttleInterlock = false;
    this.entryClimbSp = null;
    this.rateDerivativePrimed = false;
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

  /**
   * Capture the altitude to hold, as an Alt Hold ENTRY: after an automatic climb,
   * on arming in the air, on a reset. `vz` is the vertical speed at that moment —
   * a climb still in progress is eased out (ALT_ENTRY_DECEL), not chopped.
   */
  captureAltitude(altitude: number, vz = 0): void {
    this.beginAltEntry(altitude, vz);
  }

  private beginAltEntry(altitude: number, vz: number): void {
    if (vz > 0) {
      // Where the eased setpoint reaches zero, plus the distance covered while the
      // climb loop lags it (vz / climbP): without the lag term it overshot that
      // point by ~0.8 m from 3 m/s and then sank back to it.
      this.targetAltitude = altitude + (vz * vz) / (2 * ALT_ENTRY_DECEL) + vz / this.config.climbP;
      this.entryClimbSp = vz;
    } else {
      this.targetAltitude = altitude;
      this.entryClimbSp = null;
    }
  }

  /**
   * Arm the throttle interlock: hold the motors at nothing until the pilot has
   * commanded the throttle DOWN once.
   *
   * A real transmitter's throttle stick is physically at the bottom when you
   * arm, so the pilot always starts a flight from idle and walks the stick up.
   * A keyboard has no stick to be at the bottom — and in Altitude Hold it rests
   * at the spring centre, which is "hold height" — so arming and tapping W flew
   * the drone off the pad with no throttle-low step at all. Worse after a
   * second arm: the pilot had already been at idle before disarming, and the
   * aircraft answered W as though that still counted.
   *
   * It does not. Every arm starts a new flight, and every flight starts at
   * idle: S first, then W. Cleared by `throttleDown` in `update()`, or by
   * `unlockThrottle()` for the sequences that fly the aircraft themselves.
   */
  lockThrottle(): void {
    this.throttleInterlock = true;
  }

  /**
   * Clear the interlock without a throttle-down command — for an auto sequence
   * or a scripted demonstration, neither of which has a pilot to press S, and
   * both of which would otherwise be handed dead motors.
   */
  unlockThrottle(): void {
    this.throttleInterlock = false;
  }

  /** Whether the interlock is still holding the motors (for the HUD). */
  get throttleLocked(): boolean {
    return this.throttleInterlock;
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
    /**
     * Pilot is holding the throttle at idle (S, or a radio stick at the bottom).
     * Motors idle rather than stopping — see `IDLE_COLLECTIVE`. Pilot INTENT,
     * which is why it arrives as an argument and not as a field of `state`.
     */
    throttleDown = false,
    /**
     * The throttle stick of the device flying RESTS at centre (a spring), so a
     * grounded centre stick is not a command. Device-dependent in Acro — a
     * gamepad springs, the keyboard does not — hence an argument; the default
     * is the mode's answer, for callers with no device (tests, demos).
     */
    throttleSprung: boolean = SPRING_THROTTLE.includes(mode),
    /**
     * Multiplier on Acro's roll/pitch rate (deg/s), for the device flying —
     * `handling.keyboardAcroScale` on the keyboard, 1 otherwise. Applied to the
     * rate, not the stick, so the curve's shape is untouched.
     */
    acroRateScale = 1,
    controllerIdle = false,
    /**
     * Flying on a radio. Its props idle from the moment it arms in every mode,
     * Acro included; a gamepad's Acro keeps them stopped on a low stick.
     */
    radio = false,
  ): ControlOutput {
    const idleSpin = controllerIdle && (mode !== 'acro' || radio);
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
      this.rateDerivativePrimed = false;
      if (ALT_MANAGED.includes(mode)) this.beginAltEntry(state.position[1], state.velocityWorld[1]);
      else {
        this.targetAltitude = state.position[1];
        this.entryClimbSp = null;
      }
      this.lastMode = mode;
    }

    const maxRate = this.config.maxRateSetpoint;
    const maxTilt = this.config.maxTiltDeg * DEG2RAD;
    let rollRateSp: number;
    let pitchRateSp: number;

    if (mode === 'acro') {
      // Rate mode: sticks command angular rate directly, no auto-level — on the
      // airframe's own firmware curve (`acroRateDps`), not `maxRateSetpoint`,
      // which is the angle loop's ceiling and made full stick 400 deg/s on a
      // Pluto whose firmware turns 137.
      rollRateSp = -acroRateDps(input.roll, this.acroRates) * acroRateScale * DEG2RAD;
      pitchRateSp = -acroRateDps(input.pitch, this.acroRates) * acroRateScale * DEG2RAD;
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
    this.rateSp.roll = rollRateSp;
    this.rateSp.pitch = pitchRateSp;
    this.rateSp.yaw = yawRateSp;

    // Ground contact can prevent a requested rate. Do not carry that stored
    // correction into Acro takeoff, where there is no angle loop to undo it.
    if (mode === 'acro' && state.onGround) this.resetIntegrators();

    // Acro D responds to changes in gyro rate, not the rate itself. Feeding
    // angular velocity here applied a permanent brake during a steady turn.
    // Prime on entry/reset so the first gyro sample cannot produce a spike.
    const derivativeDt = dt > 0 ? dt : 0;
    const differentiate = mode === 'acro';
    const ready = this.rateDerivativePrimed && derivativeDt > 0;
    const rollD = differentiate
      ? ready
        ? (rollRate - this.previousRates.roll) / derivativeDt
        : 0
      : rollRate;
    const pitchD = differentiate
      ? ready
        ? (pitchRate - this.previousRates.pitch) / derivativeDt
        : 0
      : pitchRate;
    const yawD = differentiate
      ? ready
        ? (yawRateMeasured - this.previousRates.yaw) / derivativeDt
        : 0
      : yawRateMeasured;
    this.previousRates.roll = rollRate;
    this.previousRates.pitch = pitchRate;
    this.previousRates.yaw = yawRateMeasured;
    this.rateDerivativePrimed = true;

    const aRoll = this.rollRate.update(rollRateSp - rollRate, dt, rollD);
    const aPitch = this.pitchRate.update(pitchRateSp - pitchRate, dt, pitchD);
    const aYaw = this.yawRate.update(yawRateSp - yawRateMeasured, dt, yawD);

    // Inertia-normalized torques (body frame).
    let tauX = state.inertia[0] * aPitch;
    let tauY = state.inertia[1] * aYaw;
    let tauZ = state.inertia[2] * aRoll;

    // Acro: cancel the aerodynamic moment by feed-forward. Nothing else holds
    // the attitude in rate mode, and the rate loop alone cannot. Its I-term only
    // builds by letting the body turn D/Ki (6/8 rad, ~43°) first, which flew as a
    // slow self-level: released at ~20° nose-down, the Pluto levelled out in 6 s.
    // A real flight controller gets the same result from far higher gains. The
    // moment still acts and the motors still carry it (front low in cruise),
    // but the attitude stays where the pilot left it. Subtracted as a torque,
    // not an acceleration, so it cancels whatever the inertia figures are.
    // Acro only: Stabilize and Alt Hold have the angle loop and are unchanged.
    if (mode === 'acro' && state.aeroTorque) {
      tauX -= state.aeroTorque[0];
      tauY -= state.aeroTorque[1];
      tauZ -= state.aeroTorque[2];
    }

    // ---- Collective thrust ----
    // Per-motor ceiling this mode may use: the rated one, raised in Acro.
    const motorCeil = state.maxPerMotor * (mode === 'acro' ? ACRO_THRUST_BOOST : 1);
    const tMaxNow = motorCeil * 4;
    let thrust: number;

    if (thrustOverride !== undefined) {
      thrust = thrustOverride;
    } else if (ALT_MANAGED.includes(mode)) {
      thrust = this.altitudeThrust(input, state, tiltCos, dt, controllerIdle);
    } else {
      let t = !controllerIdle
        ? clamp(input.throttle, 0, 1)
        : mode === 'acro'
          ? acroControllerThrottle(input.throttle)
          : controllerThrottle(input.throttle);
      // A spring-centred direct stick RESTS at centre, and on the pad that is
      // not a command — it is only where the spring left it. Alt Hold already
      // refuses to lift on a centred stick while grounded (#15c); acro has to do
      // the same, or letting go of S would float the aircraft off the pad having
      // been asked for nothing (#15a, #16). Above centre it IS a command, and
      // centre is also exactly where a direct throttle makes hover thrust — so
      // the drone leaves the ground at the moment the stick says it should.
      if (state.onGround && throttleSprung && t <= THROTTLE_CENTER) t = 0;
      thrust = t * this.maxThrust * (mode === 'acro' ? ACRO_THRUST_BOOST : 1);
    }

    // ---- Arming interlock ----
    // Nothing turns until the pilot has asked for idle once since arming. The
    // throttle-down command is the release, exactly as a radio's stick sitting
    // at the bottom is on a real aircraft — so a radio pilot clears it by
    // holding the stick where it already rests, and never notices it at all.
    if (this.throttleInterlock) {
      if (throttleDown) this.throttleInterlock = false;
      else thrust = 0;
    }

    // ---- ESC idle ----
    // A real quad's rotors do not stop when the throttle is chopped; the ESCs
    // hold them at an idle spin. That is what makes a descent a descent instead
    // of a dead drop, and it is what the pilot sees on the props and hears in
    // the motors while coming down.
    //
    // Gated on the pilot COMMANDING idle, never on the throttle merely sitting
    // there. The keyboard's stick rests at zero in the direct modes, so a
    // position test would spin the props the instant the aircraft armed (#15a),
    // and in Altitude Hold the stick rests at centre while `altitudeThrust()`
    // correctly returns nothing on the pad — the #15b creep, handed a floor.
    // Not in Acro on a gamepad: there it only gets the firmer collective curve,
    // and a centred-to-low stick on the pad still means stopped motors.
    if (throttleDown || (idleSpin && !this.throttleInterlock))
      thrust = Math.max(thrust, IDLE_COLLECTIVE * this.maxThrust);

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

    // Idle on the pad spins all four motors equally, without trying to tilt
    // the aircraft before the pilot supplies enough collective to lift.
    if (
      idleSpin &&
      state.onGround &&
      thrust <= IDLE_COLLECTIVE * this.maxThrust * state.groundEffect + THRUST_CUTOFF
    )
      torqueScale = 0;

    // ---- Mix to motors (saturation is physically real from here on) ----
    const mix: MixResult = mixQuad(
      thrust,
      tauX * torqueScale,
      tauZ * torqueScale,
      tauY * torqueScale,
      this.armPerAxis,
      this.kQ,
      motorCeil,
    );

    const perMotorMax = Math.max(motorCeil, 1e-6);
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
  private altitudeThrust(
    input: StickInput,
    state: ControlState,
    tiltCos: number,
    dt: number,
    controllerInput = false,
  ): number {
    const alt = state.position[1];
    const vz = state.velocityWorld[1];

    /*
     * A THROTTLE HELD ALL THE WAY DOWN IS A DESCENT, NOT A MOTOR CUT.
     *
     * It used to return 0 — the motors stopped dead and the aircraft fell. From
     * a hover that is barely noticed; from thirty metres up it is a free fall
     * that arrives at the ground well past FLOOR_CRASH and writes the drone off,
     * and the pilot did nothing worse than ask to come down.
     *
     * No flight controller does this. In an altitude mode the bottom of the
     * stick is the fastest descent the mode will fly, and the motors keep
     * running to hold that rate; cutting them is what a DISARM is for. Below,
     * the stick already commands a rate capped at `maxClimbRate` — 2.6 m/s on
     * the Guru, and every airframe's cap is under the crash threshold — so
     * simply letting the bottom of the stick fall through to it is both the
     * real behaviour and a descent that cannot destroy the aircraft.
     *
     * On the ground it still means stopped: the `onGround` test below sees a
     * stick that is not commanding a climb and returns 0.
     */
    // Throttle stick above/below centre commands climb rate; centred = hold.
    const stick =
      (controllerInput ? controllerThrottle(input.throttle) : clamp(input.throttle, 0, 1)) - 0.5;
    const stickActive = Math.abs(stick) > STICK_DEADBAND;

    // Armed and resting on the ground with no climb commanded: motors stay
    // STOPPED. Arming makes the aircraft live, it does not spin the props —
    // nothing turns until the pilot actually commands a climb.
    if (state.onGround && !(stickActive && stick > 0)) {
      this.targetAltitude = alt;
      this.entryClimbSp = null;
      return 0;
    }

    let climbSp: number;
    if (stickActive) {
      // Controller full travel asks for twice the usual climb rate. Keep the
      // existing descent cap so extra response does not command a hard landing.
      // Keyboard rates and the centred-stick height hold retain their settings.
      climbSp = Math.max(
        stick * 2 * this.config.maxClimbRate * (controllerInput ? 2 : 1),
        -maxDescentRate(this.config.maxClimbRate),
      );
      // Follow the stick, resume holding on release — unless an entry ease is
      // running and the stick asks for LESS climb than it. That is either the
      // pilot asking to slow down, which the ease already limits, or the stick
      // the previous mode left behind: the throttle handover runs at render rate,
      // after the first physics steps in the new mode, so for 2–4 steps Alt Hold
      // saw Stabilize's raised stick, cancelled the ease and reset the hold to
      // that instant's altitude — and chopped the motors anyway.
      if (this.entryClimbSp === null || climbSp >= this.entryClimbSp) {
        this.targetAltitude = alt;
        this.entryClimbSp = null;
      }
    } else {
      climbSp = clamp(
        this.config.altP * (this.targetAltitude - alt),
        -this.config.maxClimbRate,
        this.config.maxClimbRate,
      );
    }

    // Entry ease: the setpoint comes down from the inherited climb at
    // ALT_ENTRY_DECEL until it meets what the stick or the hold loop asks for,
    // then hands over.
    if (this.entryClimbSp !== null) {
      const eased = this.entryClimbSp - ALT_ENTRY_DECEL * dt;
      if (eased <= climbSp) this.entryClimbSp = null;
      else climbSp = this.entryClimbSp = eased;
    }

    /*
     * The descent used to be TAPERED as well as rate-limited: the deeper the
     * stick, the more of the computed thrust was thrown away, reaching zero at
     * the bottom. That is the same motor cut by a gentler route — the rate
     * limiter above would ask for lift and the taper would refuse to provide
     * it — so the aircraft accelerated downward through the cap it was supposed
     * to be held at.
     *
     * The rate limit is the whole control now. What comes out is whatever
     * thrust holds the commanded rate, which at the bottom of the stick is a
     * brisk, powered descent with the props still turning, and on the ground is
     * nothing at all.
     */
    const accel = clamp(this.config.climbP * (climbSp - vz), -9.8, 8);
    return (state.mass * Math.max(0, GRAVITY + accel)) / tiltCos;
  }
}

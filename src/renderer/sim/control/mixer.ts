import { clamp } from '../mathx';

// X-quad motor mixer.
//
// Motor layout (body frame, +Y up, -Z forward), all at radius `a` per axis:
//   0 FR (+a, -a)   1 FL (-a, -a)   2 BR (+a, +a)   3 BL (-a, +a)
//
// A motor at (rx, 0, rz) producing thrust f along body-up generates
//   torque = r x F = (-rz*f, 0, rx*f)
// so:
//   tauX (pitch) = a * ( fFR + fFL - fBR - fBL )
//   tauZ (roll)  = a * ( fFR - fFL + fBR - fBL )
//   thrust       =       fFR + fFL + fBR + fBL
// Yaw comes from motor reaction torque, not thrust geometry:
//   tauY (yaw)   = kQ * ( fFR - fFL - fBR + fBL )   [CW: FR,BL — CCW: FL,BR]

export const MOTOR_SIGNS = {
  // [pitch, roll, yaw] contribution sign per motor, in FR, FL, BR, BL order.
  pitch: [1, 1, -1, -1],
  roll: [1, -1, 1, -1],
  // +1 = a CW propeller (viewed from above), whose reaction torque yaws the
  // airframe CCW. Hence FR and BL positive, FL and BR negative.
  yaw: [1, -1, -1, 1],
} as const;

/**
 * Which way each propeller turns on screen, as the sign of a Three.js rotation
 * about body +Y, in FR, FL, BR, BL order.
 *
 * A CW propeller turns NEGATIVE about +Y: the coordinate system is
 * right-handed, so a positive Y rotation carries +X toward -Z — which reads as
 * counter-clockwise when viewed from above.
 *
 * Derived from MOTOR_SIGNS.yaw rather than written out again, because it was
 * written out again — in three separate renderers — and all three ended up
 * spinning the blades opposite to the reaction torque they were meant to be
 * producing. The airframe is FL/RR counter-clockwise, FR/RL clockwise.
 */
export const PROP_SPIN_Y: readonly [number, number, number, number] = [
  -MOTOR_SIGNS.yaw[0],
  -MOTOR_SIGNS.yaw[1],
  -MOTOR_SIGNS.yaw[2],
  -MOTOR_SIGNS.yaw[3],
];

export interface MixResult {
  /** Per-motor thrust in Newtons (FR, FL, BR, BL), clamped to what motors can do. */
  thrusts: [number, number, number, number];
  /** Net yaw reaction torque actually produced (N·m). */
  yawTorque: number;
  /** True when any motor clipped — attitude authority is degraded. */
  saturated: boolean;
}

/**
 * Invert the mix: desired collective thrust + body torques -> per-motor thrust.
 * @param thrust desired total thrust (N)
 * @param tauX desired pitch torque about body X (N·m)
 * @param tauZ desired roll torque about body Z (N·m)
 * @param tauY desired yaw torque about body Y (N·m)
 * @param armPerAxis motor offset per axis (m)
 * @param kQ yaw reaction coefficient (N·m per N of thrust)
 * @param maxPerMotor current per-motor thrust ceiling (N), after battery fade
 */
export function mixQuad(
  thrust: number,
  tauX: number,
  tauZ: number,
  tauY: number,
  armPerAxis: number,
  kQ: number,
  maxPerMotor: number,
): MixResult {
  const a = Math.max(armPerAxis, 1e-4);
  const q = Math.max(kQ, 1e-4);

  const base = thrust / 4;
  const p = tauX / (4 * a);
  const r = tauZ / (4 * a);
  const y = tauY / (4 * q);

  const raw: [number, number, number, number] = [
    base + p + r + y, // FR
    base + p - r - y, // FL
    base - p + r - y, // BR
    base - p - r + y, // BL
  ];

  // Magis' mixTable: when any motor exceeds the ceiling, reduce ALL motors by
  // the overshoot so the relative differential — and therefore the commanded
  // attitude — is preserved. Clamping each motor independently would instead
  // distort the attitude command exactly when authority matters most.
  const peak = Math.max(raw[0], raw[1], raw[2], raw[3]);
  const overshoot = peak > maxPerMotor ? peak - maxPerMotor : 0;

  let saturated = overshoot > 0;
  const thrusts = raw.map((f) => {
    const reduced = f - overshoot;
    if (reduced < 0) saturated = true;
    return clamp(reduced, 0, maxPerMotor);
  }) as [number, number, number, number];

  // Yaw torque actually delivered by the clamped motors.
  const yawTorque =
    q * (thrusts[0] - thrusts[1] - thrusts[2] + thrusts[3]);

  return { thrusts, yawTorque, saturated };
}

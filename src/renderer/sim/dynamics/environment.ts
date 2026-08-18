import type { Vec3 } from '@shared/types';
import { clamp, DEG2RAD } from '../mathx';

// Environmental forces: wind and ground effect.

export interface WindSettings {
  /** Sustained wind speed (m/s). */
  speed: number;
  /** Direction the wind blows TOWARD, in degrees (0 = toward -Z / north). */
  directionDeg: number;
  /** Gust strength as a fraction of base speed (0..1). */
  gustiness: number;
}

export const CALM_WIND: WindSettings = { speed: 0, directionDeg: 0, gustiness: 0 };

// Cheap smooth pseudo-noise: summed sines, deterministic in simulated time so
// replays reproduce exactly (no Math.random anywhere in the sim).
function gustNoise(t: number, seed: number): number {
  return (
    0.6 * Math.sin(t * 0.7 + seed) +
    0.3 * Math.sin(t * 1.9 + seed * 2.3) +
    0.1 * Math.sin(t * 4.1 + seed * 5.7)
  );
}

/**
 * Wind force on the airframe.
 * Force is proportional to the square of airspeed relative to the drone, so a
 * hovering drone gets pushed and a drone flying into wind feels extra drag.
 * @param dragArea effective area * drag coefficient (m^2)
 */
export function windForce(
  wind: WindSettings,
  velocity: Vec3,
  time: number,
  dragArea: number,
): Vec3 {
  if (wind.speed <= 0) return [0, 0, 0];

  const gust = 1 + wind.gustiness * gustNoise(time, 1.7);
  const speed = Math.max(wind.speed * gust, 0);
  const dir = wind.directionDeg * DEG2RAD;

  // Wind vector in the XZ plane, plus a little vertical churn.
  const wx = Math.sin(dir) * speed;
  const wz = -Math.cos(dir) * speed;
  const wy = 0.12 * speed * wind.gustiness * gustNoise(time, 4.2);

  // Air velocity relative to the drone.
  const rx = wx - velocity[0];
  const ry = wy - velocity[1];
  const rz = wz - velocity[2];

  const mag = Math.hypot(rx, ry, rz);
  if (mag < 1e-5) return [0, 0, 0];

  // 0.5 * rho * Cd*A * v^2, rho ~ 1.225 kg/m^3
  const k = 0.5 * 1.225 * dragArea * mag;
  return [rx * k, ry * k, rz * k];
}

/**
 * Ambient air movement outdoors.
 *
 * Even in "calm" conditions outdoor air is never still — a real hovering drone
 * wanders slightly and needs constant small corrections. Returns a slowly
 * varying acceleration (m/s^2) that the caller scales by mass; deliberately
 * low-frequency so it reads as drift rather than vibration, and built from
 * sines rather than Math.random so replays stay reproducible.
 */
export function ambientDrift(time: number, out: Vec3, strength = 0.16): Vec3 {
  const x =
    Math.sin(time * 0.23 + 1.7) * 0.6 +
    Math.sin(time * 0.61 + 4.2) * 0.3 +
    Math.sin(time * 1.13) * 0.1;
  const z =
    Math.sin(time * 0.19 + 3.1) * 0.6 +
    Math.sin(time * 0.53 + 0.8) * 0.3 +
    Math.sin(time * 0.97 + 2.4) * 0.1;
  // Vertical component is weaker — thermals are gentler than lateral gusts.
  const y = Math.sin(time * 0.31 + 2.2) * 0.25 + Math.sin(time * 0.73) * 0.1;

  out[0] = x * strength;
  out[1] = y * strength * 0.5;
  out[2] = z * strength;
  return out;
}

/**
 * Ground effect: rotor efficiency rises close to the ground because the
 * downwash cannot fully develop. Returns an aerodynamic air-cushion thrust multiplier >= 1.
 * Provides authentic floaty ground cushion during touchdown and liftoff.
 */
export function groundEffect(altitude: number, rotorRadius: number): number {
  const r = Math.max(rotorRadius, 1e-3);
  const z = Math.max(altitude, 0);
  const ratio = z / (2 * r);
  if (ratio > 1.8) return 1;
  // Smooth aerodynamic air-cushion force close to the ground (up to 1.25x hover thrust boost)
  const boost = 0.25 * Math.exp(-2.0 * ratio);
  return clamp(1 + boost, 1, 1.25);
}

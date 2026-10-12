import type { FlightMode } from '@shared/types';

// Acro + FPV forgiveness (2026-10-09): what the drone does instead of crashing.

/**
 * Acro flown through the FPV camera is the free-practice mode: nothing it hits
 * writes it off. A hit bounces it back, and lying flipped rights it on the spot.
 */
export function forgivingFlight(mode: FlightMode, camera: string): boolean {
  return mode === 'acro' && camera === 'fpv';
}

/** Share of the approach speed a forgiving bounce sends back off a surface. */
const BOUNCE_RESTITUTION = 0.6;
/** A forgiving bounce always leaves the surface at least this fast, m/s. */
const BOUNCE_MIN_SPEED = 1;

type V3 = { x: number; y: number; z: number };

/**
 * Velocity after bouncing off a surface: the part along the normal reversed and
 * scaled by `BOUNCE_RESTITUTION`, the part along the surface kept, and at least
 * `BOUNCE_MIN_SPEED` away from it. The normal's sign does not matter — it is
 * turned to face against the approach. With no usable normal the velocity is
 * simply reversed.
 */
export function bounceVelocity(v: V3, normal: V3 | null | undefined): V3 {
  const len = normal ? Math.hypot(normal.x, normal.y, normal.z) : 0;
  if (!normal || len < 1e-6) {
    const speed = Math.hypot(v.x, v.y, v.z);
    const k = speed > 1e-6 ? Math.max(BOUNCE_RESTITUTION, BOUNCE_MIN_SPEED / speed) : 0;
    return { x: -v.x * k, y: -v.y * k, z: -v.z * k };
  }
  let n = { x: normal.x / len, y: normal.y / len, z: normal.z / len };
  let d = v.x * n.x + v.y * n.y + v.z * n.z;
  if (d > 0) {
    n = { x: -n.x, y: -n.y, z: -n.z };
    d = -d;
  }
  const out = {
    x: v.x - (1 + BOUNCE_RESTITUTION) * d * n.x,
    y: v.y - (1 + BOUNCE_RESTITUTION) * d * n.y,
    z: v.z - (1 + BOUNCE_RESTITUTION) * d * n.z,
  };
  const away = out.x * n.x + out.y * n.y + out.z * n.z;
  if (away < BOUNCE_MIN_SPEED) {
    const add = BOUNCE_MIN_SPEED - away;
    out.x += add * n.x;
    out.y += add * n.y;
    out.z += add * n.z;
  }
  return out;
}

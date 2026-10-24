import type { FlightMode } from '@shared/types';

// Acro + FPV forgiveness (2026-10-09): what the drone does instead of crashing.

/**
 * Acro flown through the FPV camera is the free-practice mode: nothing it hits
 * writes it off. A hit bounces it back, and lying flipped rights it on the spot.
 */
export function forgivingFlight(mode: FlightMode, camera: string): boolean {
  return mode === 'acro' && camera === 'fpv';
}

/**
 * Marks a rigid body as a soft obstacle: the inflatable race gates and rings.
 * Put it on the body's `userData`. A brush or a bump against one does not write
 * the aircraft off, in any mode — the drone bounces off the vinyl the way it
 * does in Acro + FPV (user, 2026-10-24: "thoda sa bhi touch hota crashed ho
 * jata hai"). Flown into it fast, it still crashes: see `SOFT_CRASH_SPEED`.
 */
export const SOFT_OBSTACLE = { soft: true } as const;

/**
 * Impact speed from which a soft obstacle crashes the drone after all, m/s.
 *
 * Every hit used to bounce, and the user found that wrong too ("kaafi speed se
 * hota tabhi bhi crashed nahi hota"). 5 is by judgement: well over the 2.2 m/s
 * that crashes on a building, under the Pluto's 8 m/s top speed — so a pilot
 * clipping a gate while lining up keeps the aircraft, and one who flies into it
 * at speed does not.
 */
export const SOFT_CRASH_SPEED = 5;

/** Whether a body's `userData` marks it as a soft obstacle. */
export function isSoftObstacle(userData: unknown): boolean {
  return (userData as { soft?: unknown } | undefined)?.soft === true;
}

/** Whether a hit on this body at this speed bounces instead of crashing. */
export function softBounce(userData: unknown, speed: number): boolean {
  return isSoftObstacle(userData) && speed < SOFT_CRASH_SPEED;
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

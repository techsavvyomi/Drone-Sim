// Small numeric helpers shared across the sim.

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Frame-rate-independent exponential smoothing toward a target. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/**
 * Critically damped spring toward a target (Game Programming Gems 4, the one
 * behind Unity's SmoothDamp). Unlike `damp`, the velocity is carried from frame
 * to frame, so a move eases in as well as out and a target that jumps never
 * jolts the value — it only changes where the value is heading. `smoothTime` is
 * roughly the time to get there, s. Mutates `s`; allocation-free.
 */
export function spring(
  s: { value: number; vel: number },
  target: number,
  smoothTime: number,
  dt: number,
): number {
  const omega = 2 / Math.max(smoothTime, 1e-4);
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = s.value - target;
  const temp = (s.vel + omega * change) * dt;
  s.vel = (s.vel - omega * temp) * e;
  s.value = target + (change + temp) * e;
  // Never overshoot: past the target, stop there.
  if (change > 0 === s.value < target) {
    s.value = target;
    s.vel = 0;
  }
  return s.value;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

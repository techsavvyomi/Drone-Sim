// Transient presentation effects shared without React state, so triggering one
// never causes a re-render mid-flight.

export const cameraShake = {
  /** 0..1, decays over time. */
  intensity: 0,
};

/** Add a shake impulse — hard landings, collisions, crashes. */
export function addShake(amount: number): void {
  cameraShake.intensity = Math.min(1, cameraShake.intensity + amount);
}

export function decayShake(dt: number): number {
  cameraShake.intensity = Math.max(0, cameraShake.intensity - dt * 1.9);
  return cameraShake.intensity;
}

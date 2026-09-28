// Transient presentation effects shared without React state, so triggering one
// never causes a re-render mid-flight.

export const cameraShake = {
  /** 0..1, decays over time. */
  intensity: 0,
};

/**
 * Add a shake impulse — hard landings, collisions, crashes.
 *
 * The stronger of the two wins; they are not summed. One arrival on the floor
 * fires `onCollisionEnter` once per touching collider, and adding each of those
 * stacked a dozen small bumps into a crash-strength shake.
 */
export function addShake(amount: number): void {
  cameraShake.intensity = Math.min(1, Math.max(cameraShake.intensity, amount));
}

/** Drop any shake still running — a reset puts a fresh aircraft on the pad. */
export function clearShake(): void {
  cameraShake.intensity = 0;
}

export function decayShake(dt: number): number {
  cameraShake.intensity = Math.max(0, cameraShake.intensity - dt * 1.9);
  return cameraShake.intensity;
}

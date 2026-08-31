import type { Probe } from '../../src/renderer/training/lessons/types';

/**
 * A synthetic frame of flight, for driving a lesson validator without an engine.
 *
 * Defaults describe a drone sitting disarmed on the helipad, which is where
 * every module now begins (invariants #40). Override only the fields the case
 * under test is about.
 */
export function probe(over: Partial<Probe> = {}): Probe {
  return {
    armed: false,
    onGround: true,
    crashed: false,
    status: 'disarmed',
    altitude: 0,
    position: [0, 0, 0],
    yaw: 0,
    verticalSpeed: 0,
    groundSpeed: 0,
    roll: 0,
    pitch: 0,
    // The spring centre: an untouched throttle in an altitude-managed mode.
    throttle: 0.5,
    dt: 1 / 60,
    elapsed: 0,
    ...over,
  };
}

/** A drone armed and holding a steady hover at `altitude`. */
export function hovering(altitude: number, over: Partial<Probe> = {}): Probe {
  return probe({
    armed: true,
    onGround: false,
    status: 'flying',
    altitude,
    position: [0, altitude, 0],
    ...over,
  });
}

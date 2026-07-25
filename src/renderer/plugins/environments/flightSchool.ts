import type { EnvironmentSpec } from '@shared/types';

// Dedicated indoor training ground for Pluto Flight School. Deliberately clean
// and uncluttered — a flat floor, soft boundary walls and a single landing pad
// at spawn — so lessons can spawn their own props (target cubes, gates, markers)
// without visual noise. Procedural for now; a .glb can be dropped in via `model`
// later without touching engine code.
export const flightSchool: EnvironmentSpec = {
  id: 'flight-school',
  name: 'Flight School',
  kind: 'indoor',
  spawn: { position: [0, 0.2, 0], heading: 0 },
  bounds: { min: [-12, 0, -12], max: [12, 8, 12] },
};

/**
 * The landing pad at spawn, shared by the scene component (which draws it) and
 * the Landing lesson (which scores touchdown accuracy against it). Centre is on
 * the ground plane in world XZ.
 */
export const FLIGHT_SCHOOL_PAD = {
  center: [0, 0] as [number, number],
  /** Outer ring radius, metres. */
  radius: 0.9,
} as const;

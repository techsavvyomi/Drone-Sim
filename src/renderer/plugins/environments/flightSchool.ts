import type { EnvironmentSpec } from '@shared/types';

// Dedicated indoor training ground for Pluto Flight School. Deliberately clean
// and uncluttered — a flat floor, soft boundary walls and a helipad at spawn
// (painted by the Fly view, as on every map) — so lessons can spawn their own
// props (target cubes, gates, markers) without visual noise. Procedural for now; a .glb can be dropped in via `model`
// later without touching engine code.
export const flightSchool: EnvironmentSpec = {
  id: 'flight-school',
  name: 'Flight School',
  kind: 'indoor',
  spawn: { position: [0, 0.2, 0], heading: 0 },
  bounds: { min: [-12, 0, -12], max: [12, 8, 12] },
};


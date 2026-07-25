import type { EnvironmentSpec } from '@shared/types';

// Enclosed indoor arena — the Phase 1 learning environment. Procedural for now
// (ground + bounded walls drawn in the scene); a .glb visual can be dropped in
// later via the `model` field without touching engine code.
export const droneArena: EnvironmentSpec = {
  id: 'drone-arena',
  name: 'Drone Arena',
  kind: 'indoor',
  spawn: { position: [0, 0.2, 0], heading: 0 },
  bounds: { min: [-15, 0, -15], max: [15, 10, 15] },
};

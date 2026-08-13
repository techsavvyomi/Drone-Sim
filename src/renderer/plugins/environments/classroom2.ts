import type { EnvironmentSpec } from '@shared/types';
import classroom2ModelUrl from '../../../assets/models/classroom2.glb?url';

// Indoor Classroom 2 map (Desktop classroom2.glb).
// Authored in metres already (~8.3×3.5×10.4 m) but offset far from origin;
// Classroom2Env recenters it. Spawn sits in the clear centre aisle.
export const classroom2: EnvironmentSpec = {
  id: 'classroom-2',
  name: 'Classroom',
  kind: 'indoor',
  model: classroom2ModelUrl,
  // Clear aisle near the blackboard end — room centre is under desk rows.
  spawn: { position: [0, 0.35, -3.2], heading: 0 },
  // Visual ceiling underside ≈ 3.0 m. Stop a few centimetres short so the drone
  // can approach the roof without clipping through the mesh.
  bounds: { min: [-4.15, 0, -5.15], max: [4.15, 2.97, 5.15] },
};

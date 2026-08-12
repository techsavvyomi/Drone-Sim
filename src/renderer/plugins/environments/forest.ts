import type { EnvironmentSpec } from '@shared/types';
import forestModelUrl from '../../../assets/models/forest.opt.glb?url';

// Outdoor forest map (Background Tree Atlas scene).
//
// The export is a ~550 m landscape whose playable floor is NOT its lowest
// point: the road, fence, logs and cobblestone all sit around y = 173, while
// everything from y = 96 to 150 is the cliff and valley the clearing looks out
// over. ForestEnv shifts that clearing to the origin — see the offsets there.
//
// Bounds are deliberately tight around the flat dirt-road clearing (40 x 27 m).
// The scene continues well past it, but the ground falls away into the valley,
// and the sim's ground handling assumes a floor at y = 0.
export const forest: EnvironmentSpec = {
  id: 'forest',
  name: 'Forest',
  kind: 'outdoor',
  model: forestModelUrl,
  // On the bare dirt road, which is the flattest ground in the scene
  // (0.5 m of undulation across its whole 40 m length).
  spawn: { position: [0, 0.35, 0], heading: 0 },
  // Canopy tops out ~34 m above the clearing, so a 40 m ceiling allows flying
  // out above the trees.
  bounds: { min: [-45, 0, -45], max: [45, 40, 45] },
};

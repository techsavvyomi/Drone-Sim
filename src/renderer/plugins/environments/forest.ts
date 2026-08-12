import type { EnvironmentSpec } from '@shared/types';
import forestModelUrl from '../../../assets/models/forest.opt.glb?url';

// Outdoor forest map (Background Tree Atlas scene).
//
// The export is a ~550 m landscape whose playable floor is NOT its lowest
// point: the road, fence, logs and cobblestone all sit around y = 173, while
// everything from y = 96 to 150 is the cliff and valley the clearing looks out
// over. ForestEnv shifts that clearing to the origin — see the offsets there.
//
export const forest: EnvironmentSpec = {
  id: 'forest',
  name: 'Forest',
  kind: 'outdoor',
  model: forestModelUrl,
  // On the bare dirt road, which is the flattest ground in the scene
  // (0.5 m of undulation across its whole 40 m length).
  spawn: { position: [0, 0.35, 0], heading: 0 },
  /**
   * Play area. Roughly three times the original ±45 m box, which was felt as an
   * invisible wall a short hop from spawn while forest was still visible ahead.
   *
   * The floor is far below zero because the ground is the real terrain, which
   * falls away from the clearing towards the valley: a floor at 0 would shove
   * the drone back up out of every dip. It sits below ForestEnv's catch floor
   * so that resting on the catch floor never engages the containment spring.
   *
   * Altitude is measured from the clearing, so flying out over the valley reads
   * negative — which is what a real drone reports relative to its take-off
   * point.
   */
  bounds: { min: [-80, -60, -80], max: [80, 45, 80] },
};

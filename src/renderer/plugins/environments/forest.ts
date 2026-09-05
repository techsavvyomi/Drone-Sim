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
   * Fog pushed past the whole map.
   *
   * The time presets fog from 50-100 m out, which is tuned for the city, where
   * haze between the blocks IS the depth cue and the far towers are meant to go
   * soft. A forest is not that: the trees the pilot has to weave between start
   * at 10 m and the tree line runs to 200, so the same fog laid grey over the
   * whole crossing and washed the trunks together into one flat wall — exactly
   * the thing the mission asks the pilot to read. The mission also runs at dusk,
   * where the fog colour is at its lightest against the darkest scene.
   *
   * 320 m clears the playable box in every direction, so nothing the pilot flies
   * near is fogged at all, while the far valley and the ridge lines behind it
   * still soften instead of ending in a hard edge against the sky.
   */
  fog: { near: 320, far: 1400 },
  /**
   * Play area, measured against the model rather than guessed.
   *
   * The tree trunks — the forest you can actually see — span X -200..170 and
   * Z -220..80 after ForestEnv's recentring. The previous ±80 box therefore put
   * the boundary well INSIDE the visible tree line: you hit an invisible wall
   * with forest still stretching ahead in every direction.
   *
   * These bounds roughly double the play area in each axis while staying inside
   * the region where the terrain still reads as forest floor rather than the
   * distant valley skirt. They are asymmetric in Z because the clearing sits at
   * the northern edge of the woods, not in the middle of them.
   *
   * Containment hard-clamps at `bounds ± 0.1`, so these are the intended limit
   * plus that margin.
   *
   * The floor is far below zero because the ground is the real terrain, which
   * falls away from the clearing towards the valley. Within these bounds the
   * terrain reaches −62.5 m (measured), so four heights have to stay ordered or
   * the drone meets an invisible floor somewhere:
   *
   *   terrain low point    −62.5   what you can see
   *   bounds floor         −70     below the terrain, so containment never lifts
   *                                the drone out of a dip
   *   catch floor          −76     ForestEnv, below the bounds floor
   *   "fell out of world"  −78     bounds floor − 8, so the catch floor gets
   *                                there first and a deep valley never resets
   *
   * Note there is deliberately NO `groundY` here: this map has no single ground
   * height, so the flat-plane under-floor rescue must not run.
   *
   * Altitude is measured from the clearing, so flying out over the valley reads
   * negative — which is what a real drone reports relative to its take-off
   * point.
   */
  bounds: { min: [-130.1, -70, -150.1], max: [130.1, 60, 65.1] },
};

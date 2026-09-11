import type { EnvironmentSpec } from '@shared/types';
import newYorkModelUrl from '../../../assets/models/new_york_city.opt.glb?url';

// Outdoor New York City map (Manhattan high-rise urban landscape).
//
// Measured off the GLB in world space (CITY_OFFSET applied), not estimated:
//   Ground surface (road + sidewalk + curb + grass):
//     X = [-123.79 .. +123.84]   Z = [-98.06 .. +98.05]
//   Tallest structure: Y = 112.2 m
//
// The containment in Drone.tsx hard-clamps at `bounds ± 0.1`, so these numbers
// are the measured ground edge PLUS that 0.1 — which lands the drone exactly on
// the last of the road rather than short of it. The previous values stopped it
// ~0.3 m inside the edge, which was visible as a gap you could not fly over.
export const newYork: EnvironmentSpec = {
  id: 'new-york',
  name: 'New York City',
  kind: 'outdoor',
  model: newYorkModelUrl,
  // On the SIDEWALK beside a building, not in the middle of the road. It was at
  // [0, 26] on the road until 2026-09-11, where the mission helipad painted under
  // it sat in a traffic lane.
  //
  // Swept out of the generated colliders: the pad's whole 1.3 m rim is on one
  // sidewalk plate (top 0.12 m), the tower's south face is 1.56 m behind it, the
  // nearest pole is 5.9 m away, and nothing overhangs it. Heading 270 faces +X
  // along the sidewalk: that line is clear to 15 m at low height, where facing
  // -X runs into a 4.5 m wing, facing -Z faces the wall, and facing +Z puts the
  // chase camera inside the tower.
  spawn: { position: [1.5, 0.144, 15.5], heading: 270 },
  spawnGround: 0.12,
  bounds: { min: [-123.89, -10, -98.16], max: [123.94, 125, 98.15] },
  // The whole map sits on one flat road plane, so the under-floor rescue applies.
  groundY: 0,
  fog: { near: 400, far: 2000 },
};

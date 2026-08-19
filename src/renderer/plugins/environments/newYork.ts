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
  spawn: { position: [0, 0.024, 30], heading: 0 },
  bounds: { min: [-123.89, -10, -98.16], max: [123.94, 125, 98.15] },
  fog: { near: 400, far: 2000 },
};

import type { EnvironmentSpec } from '@shared/types';
import newYorkModelUrl from '../../../assets/models/new_york_city.opt.glb?url';

// Outdoor New York City map (Manhattan high-rise urban landscape).
//
// Model physical outer edge (with CITY_OFFSET applied):
//   Road/ground plane:  X = [-123.8 .. +123.8 m], Z = [-98.1 .. +98.1 m]
//   Tallest skyscraper: Y = 112.2 m
//
// Airspace bounds strictly clamped to the outer road & sidewalk edge:
// Drone cannot enter the empty white void outside the city perimeter.
export const newYork: EnvironmentSpec = {
  id: 'new-york',
  name: 'New York City',
  kind: 'outdoor',
  model: newYorkModelUrl,
  spawn: { position: [0, 0.024, 30], heading: 0 },
  bounds: { min: [-123.5, -10, -97.8], max: [123.5, 125, 97.8] },
  fog: { near: 400, far: 2000 },
};

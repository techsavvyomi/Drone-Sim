import type { EnvironmentSpec } from '@shared/types';
import newYorkModelUrl from '../../../assets/models/new_york_city.opt.glb?url';

// Outdoor New York City map (Manhattan high-rise urban landscape).
//
// The model is a full 248 x 196 m city scene with skyscrapers reaching up to
// 112 m. Center offset places the drone in the central intersection.
export const newYork: EnvironmentSpec = {
  id: 'new-york',
  name: 'New York City',
  kind: 'outdoor',
  model: newYorkModelUrl,
  spawn: { position: [0, 0.024, 30], heading: 0 },
  bounds: { min: [-123.84, -5, -98.11], max: [123.84, 160, 98.11] },
  fog: { near: 250, far: 1200 },
};

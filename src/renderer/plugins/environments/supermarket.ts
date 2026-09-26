import type { EnvironmentSpec } from '@shared/types';
import supermarketModelUrl from '../../../assets/models/supermarket.opt.glb?url';

// Outdoor Supermarket map (Re-Volt 3 "Supermarket" level): a car park and the
// store it serves, which you can fly into through the shopfront.
//
// SupermarketEnv scales the export by 0.1 and leaves it where it was authored,
// so every number here is the raw coordinate ÷ 10. Measured, after that scale:
//   Ground (car park + verges):  X = [-89.2 .. 74.4]   Z = [-53.1 .. 55.8]
//   Store roof: X -64 .. 28, Z -44 .. -3, underside 6.0 m. Shelves stand ~3.5 m.
//   Tallest thing: the shopfront sign, 8.3 m.
export const supermarket: EnvironmentSpec = {
  id: 'supermarket',
  name: 'Supermarket',
  kind: 'outdoor',
  model: supermarketModelUrl,
  // In the car park, facing the shopfront (heading 0 faces -Z).
  //
  // Swept out of supermarket.opt.glb: the nearest thing standing is a parking
  // sign 6 m to the west, and the line ahead toward the store is clear for 13 m.
  // The ground here is the CONCRETE plane at exactly y = 0, so 0.03 is the
  // drone's 24 mm resting height plus a settle — see forest.ts.
  spawn: { position: [-30, 0.03, 20], heading: 0 },
  // Ground edge plus containment's 0.1 m clamp margin.
  bounds: { min: [-89.3, -1, -53.2], max: [74.5, 30, 55.9] },
  // The car park and the store floor are one flat plane at 0.
  groundY: 0,
};

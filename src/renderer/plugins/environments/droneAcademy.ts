import type { EnvironmentSpec } from '@shared/types';

// Outdoor drone training academy: helipad, practice arena (gates, slalom,
// precision pads, hover boxes, waypoint towers) and facility scenery.
// The play area is far larger than the indoor arena, so the soft containment
// in the drone entity reads these bounds rather than hard-coded numbers.
export const droneAcademy: EnvironmentSpec = {
  id: 'drone-academy',
  name: 'Drone Academy',
  kind: 'outdoor',
  // Spawn on the painted "H" at the centre of the helipad.
  spawn: { position: [0, 0.2, 0], heading: 0 },
  bounds: { min: [-60, 0, -60], max: [60, 30, 60] },
};

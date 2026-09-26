// The simulator's own keys, mapped to the catalog ids the backend knows.
//
// Plugins, missions and lessons are keyed by readable slugs (`pluto-guru`,
// `forest-fire`); analytics uses stable catalog ids (`DRONE-002`,
// `MISSION-002`) so a rename or a reorder in the game never splits one drone's
// history into two. The backend seeds the same list from
// backend/apps-script/Catalog.js, and tests/backend-catalog.test.ts fails when
// the two disagree or when something in the game has no id here.
//
// Adding a drone, mission or lesson: give it the next id here AND in
// Catalog.js, then run `setupDatabase` in Apps Script.

export const DRONE_IDS: Readonly<Record<string, string>> = {
  pluto: 'DRONE-001',
  'pluto-guru': 'DRONE-002',
  'racing-drone': 'DRONE-003',
};

export const MISSION_IDS: Readonly<Record<string, string>> = {
  'precision-delivery': 'MISSION-001',
  'forest-fire': 'MISSION-002',
  'multi-point-delivery': 'MISSION-003',
  'search-rescue': 'MISSION-004',
  'tiger-tracker': 'MISSION-005',
  'night-tracking': 'MISSION-006',
  'construction-material-delivery': 'MISSION-007',
  'night-shift-inspection': 'MISSION-008',
  'supermarket-delivery': 'MISSION-009',
  'supermarket-stock-check': 'MISSION-010',
};

export const TRAINING_IDS: Readonly<Record<string, string>> = {
  'arm-takeoff': 'TRAINING-001',
  'land-disarm': 'TRAINING-002',
  throttle: 'TRAINING-003',
  yaw: 'TRAINING-004',
  pitch: 'TRAINING-005',
  roll: 'TRAINING-006',
  'straight-line': 'TRAINING-007',
  diagonal: 'TRAINING-008',
  square: 'TRAINING-009',
  'square-yaw': 'TRAINING-010',
  triangle: 'TRAINING-011',
  circle: 'TRAINING-012',
  'nav-ab': 'TRAINING-013',
  'nav-abc': 'TRAINING-014',
  'nav-abcd': 'TRAINING-015',
};

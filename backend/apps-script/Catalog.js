// The catalog `setupDatabase` seeds into Drones, Missions and TrainingModules.
//
// The simulator maps its own keys (`pluto`, `forest-fire`) to these ids in
// src/renderer/services/catalog.ts, and tests/backend-catalog.test.ts fails if
// the two lists drift apart. Add a drone, mission or module in both places, then
// run `setupDatabase` again: it adds new rows and never overwrites edits made in
// the sheet.
//
// Mission `maxScore` is the most points one attempt can score in the simulator.
// The server clamps a reported score to it.

const CATALOG = {
  drones: [
    { id: 'DRONE-001', name: 'Pluto', model: 'Pluto nano quad (50 g)', simKey: 'pluto' },
    { id: 'DRONE-002', name: 'Pluto Guru', model: 'Guru quad (1.5 kg)', simKey: 'pluto-guru' },
    { id: 'DRONE-003', name: 'Racing Drone', model: '5 inch racing quad (720 g)', simKey: 'racing-drone' },
  ],
  missions: [
    { id: 'MISSION-001', name: 'Precision Delivery', simKey: 'precision-delivery', maxScore: 15, order: 1 },
    { id: 'MISSION-002', name: 'Forest Fire Emergency', simKey: 'forest-fire', maxScore: 6, order: 2 },
    { id: 'MISSION-003', name: 'Multi-Point Delivery', simKey: 'multi-point-delivery', maxScore: 4, order: 3 },
    { id: 'MISSION-004', name: 'Logistics Drones', simKey: 'search-rescue', maxScore: 2, order: 4 },
    { id: 'MISSION-005', name: 'Animal Rescue', simKey: 'tiger-tracker', maxScore: 1, order: 5 },
    { id: 'MISSION-006', name: 'Search and Rescue', simKey: 'night-tracking', maxScore: 1, order: 6 },
    { id: 'MISSION-007', name: 'Construction Material Delivery', simKey: 'construction-material-delivery', maxScore: 2, order: 7 },
    { id: 'MISSION-008', name: 'Night Shift Inspection', simKey: 'night-shift-inspection', maxScore: 4, order: 8 },
    { id: 'MISSION-009', name: 'Truck Loading', simKey: 'supermarket-delivery', maxScore: 6, order: 9 },
    { id: 'MISSION-010', name: 'Truck Unloading', simKey: 'supermarket-stock-check', maxScore: 6, order: 10 },
  ],
  training: [
    { id: 'TRAINING-001', name: 'Arm & Take Off', simKey: 'arm-takeoff', order: 1 },
    { id: 'TRAINING-002', name: 'Land & Disarm', simKey: 'land-disarm', order: 2 },
    { id: 'TRAINING-003', name: 'Throttle Up & Down', simKey: 'throttle', order: 3 },
    { id: 'TRAINING-004', name: 'Yaw Control', simKey: 'yaw', order: 4 },
    { id: 'TRAINING-005', name: 'Pitch Control', simKey: 'pitch', order: 5 },
    { id: 'TRAINING-006', name: 'Roll Control', simKey: 'roll', order: 6 },
    { id: 'TRAINING-007', name: 'Straight Flight', simKey: 'straight-line', order: 7 },
    { id: 'TRAINING-008', name: 'Diagonal Run', simKey: 'diagonal', order: 8 },
    { id: 'TRAINING-009', name: 'Square Circuit', simKey: 'square', order: 9 },
    { id: 'TRAINING-010', name: 'Square Circuit using Yaw', simKey: 'square-yaw', order: 10 },
    { id: 'TRAINING-011', name: 'Triangle Circuit', simKey: 'triangle', order: 11 },
    { id: 'TRAINING-012', name: 'Full Circle', simKey: 'circle', order: 12 },
    { id: 'TRAINING-013', name: 'Your First Route', simKey: 'nav-ab', order: 13 },
    { id: 'TRAINING-014', name: 'Three Gates in Order', simKey: 'nav-abc', order: 14 },
    { id: 'TRAINING-015', name: 'The Whole Flight', simKey: 'nav-abcd', order: 15 },
  ],
};

/** Training scores are percentages. */
const TRAINING_MAX_SCORE = 100;

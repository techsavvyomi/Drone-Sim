import type { FlightType, SessionResult } from './contract';

// The backend's points, levels and catalog names, for the app's offline profile.
//
// The server is the authority: it computes points from the Settings sheet and
// clamps scores to the Missions sheet. A flight flown offline still has to show
// its XP straight away, so the app works them out the same way with the
// defaults below, and takes the server's numbers as soon as it is back online.
// tests/local-scoring.test.ts runs both against the same flights and fails when
// this copy and `backend/apps-script` drift apart.

/** Default rows of the Settings sheet (backend/apps-script/Schema.js). */
export const POINTS = {
  LEVEL_POINTS: 500,
  MISSION_COMPLETE_POINTS: 50,
  MISSION_SCORE_POINTS: 10,
  TRAINING_COMPLETE_POINTS: 30,
  STAR_POINTS: 25,
  REPEAT_COMPLETION_PERCENT: 25,
  FREE_FLIGHT_POINTS_PER_MINUTE: 2,
  FREE_FLIGHT_POINTS_CAP: 30,
} as const;

/** Training scores are percentages. */
export const TRAINING_MAX_SCORE = 100;

/** `levelFor_` in Api.js. */
export function levelFor(points: number): { level: number; current: number; next: number } {
  const step = Math.max(1, POINTS.LEVEL_POINTS);
  return { level: 1 + Math.floor(points / step), current: points % step, next: step };
}

/** `pointsFor_` in Api.js. */
export function pointsFor(f: {
  flightType: FlightType;
  result: SessionResult;
  score: number;
  stars: number;
  flightTime: number;
  isRepeat: boolean;
}): number {
  if (f.flightType === 'FREE_FLIGHT') {
    return Math.min(
      POINTS.FREE_FLIGHT_POINTS_CAP,
      Math.floor(f.flightTime / 60) * POINTS.FREE_FLIGHT_POINTS_PER_MINUTE,
    );
  }
  if (f.result !== 'SUCCESS') return 0;
  let points = f.stars * POINTS.STAR_POINTS;
  if (f.flightType === 'MISSION') {
    points += POINTS.MISSION_COMPLETE_POINTS + f.score * POINTS.MISSION_SCORE_POINTS;
  } else {
    points += POINTS.TRAINING_COMPLETE_POINTS;
  }
  if (f.isRepeat) points = (points * POINTS.REPEAT_COMPLETION_PERCENT) / 100;
  return Math.round(points);
}

/** backend/apps-script/Catalog.js, by id. */
export const CATALOG = {
  drones: [
    { id: 'DRONE-001', name: 'Pluto' },
    { id: 'DRONE-002', name: 'Pluto Guru' },
    { id: 'DRONE-003', name: 'Racing Drone' },
  ],
  missions: [
    { id: 'MISSION-001', name: 'Precision Delivery', maxScore: 15, order: 1 },
    { id: 'MISSION-002', name: 'Forest Fire Emergency', maxScore: 6, order: 2 },
    { id: 'MISSION-003', name: 'Multi-Point Delivery', maxScore: 4, order: 3 },
    { id: 'MISSION-004', name: 'Logistics Drones', maxScore: 2, order: 4 },
    { id: 'MISSION-005', name: 'Animal Rescue', maxScore: 1, order: 5 },
    { id: 'MISSION-006', name: 'Search and Rescue', maxScore: 1, order: 6 },
    { id: 'MISSION-007', name: 'Construction Material Delivery', maxScore: 2, order: 7 },
    { id: 'MISSION-008', name: 'Night Shift Inspection', maxScore: 4, order: 8 },
    { id: 'MISSION-009', name: 'Truck Loading', maxScore: 6, order: 9 },
    { id: 'MISSION-010', name: 'Truck Unloading', maxScore: 6, order: 10 },
  ],
  training: [
    { id: 'TRAINING-001', name: 'Arm & Take Off', order: 1 },
    { id: 'TRAINING-002', name: 'Land & Disarm', order: 2 },
    { id: 'TRAINING-003', name: 'Throttle Up & Down', order: 3 },
    { id: 'TRAINING-004', name: 'Yaw Control', order: 4 },
    { id: 'TRAINING-005', name: 'Pitch Control', order: 5 },
    { id: 'TRAINING-006', name: 'Roll Control', order: 6 },
    { id: 'TRAINING-007', name: 'Straight Flight', order: 7 },
    { id: 'TRAINING-008', name: 'Diagonal Run', order: 8 },
    { id: 'TRAINING-009', name: 'Square Circuit', order: 9 },
    { id: 'TRAINING-010', name: 'Square Circuit using Yaw', order: 10 },
    { id: 'TRAINING-011', name: 'Triangle Circuit', order: 11 },
    { id: 'TRAINING-012', name: 'Full Circle', order: 12 },
    { id: 'TRAINING-013', name: 'Your First Route', order: 13 },
    { id: 'TRAINING-014', name: 'Three Gates in Order', order: 14 },
    { id: 'TRAINING-015', name: 'The Whole Flight', order: 15 },
  ],
} as const;

/** The most score one attempt can earn, as `endSession_` clamps it. 0 = unscored. */
export function maxScoreOf(flightType: FlightType, missionId: string | undefined): number {
  if (flightType === 'MISSION')
    return CATALOG.missions.find((m) => m.id === missionId)?.maxScore ?? 0;
  if (flightType === 'TRAINING') return TRAINING_MAX_SCORE;
  return 0;
}

export function nameOf(list: 'drones' | 'missions' | 'training', id: string | undefined): string {
  if (!id) return '';
  return (
    (CATALOG[list] as readonly { id: string; name: string }[]).find((x) => x.id === id)?.name ?? ''
  );
}

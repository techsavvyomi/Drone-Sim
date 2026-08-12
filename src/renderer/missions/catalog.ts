/** Catalog entry for the Missions journey path (UI). Playable runtime is Phase 4. */
export interface MissionInfo {
  id: string;
  order: number;
  /** Short name on the card, e.g. "First Flight". */
  title: string;
  /** One-line tease under the title. */
  subtitle: string;
  objective: string;
  skill: string;
}

// Missions 1–9 only for now (Beginner + first Intermediate). Same unlock-path
// pattern as Flight School modules.
export const MISSIONS: MissionInfo[] = [
  {
    id: 'mission-1',
    order: 1,
    title: 'First Flight',
    subtitle: 'Arm, takeoff, hover & land',
    objective:
      'Arm the drone, take off to 1 metre, hover for 5 seconds, and land safely.',
    skill: 'Arming, takeoff and basic control',
  },
  {
    id: 'mission-2',
    order: 2,
    title: 'Stable Hover',
    subtitle: 'Hold the marked zone',
    objective: 'Maintain a stable hover inside the marked zone for 10 seconds.',
    skill: 'Hover stability and control',
  },
  {
    id: 'mission-3',
    order: 3,
    title: 'Smooth Climb',
    subtitle: 'Climb to 2 metres',
    objective: 'Climb smoothly from ground level to 2 metres without overshooting.',
    skill: 'Throttle and altitude control',
  },
  {
    id: 'mission-4',
    order: 4,
    title: 'Safe Landing',
    subtitle: 'Land in the zone',
    objective: 'Take off, fly to the landing zone and land safely inside the marked area.',
    skill: 'Descent and landing control',
  },
  {
    id: 'mission-5',
    order: 5,
    title: 'Precision Landing',
    subtitle: 'Hit the pad centre',
    objective: 'Land as close to the centre of the landing pad as possible.',
    skill: 'Landing accuracy',
  },
  {
    id: 'mission-6',
    order: 6,
    title: 'Flight Circuit',
    subtitle: 'Out, turn, return, land',
    objective: 'Take off, fly forward, turn around a checkpoint, return and land.',
    skill: 'Basic flight coordination',
  },
  {
    id: 'mission-7',
    order: 7,
    title: '360° Yaw',
    subtitle: 'Rotate on the spot',
    objective: 'Complete a full 360° rotation while keeping the drone in the same area.',
    skill: 'Yaw control',
  },
  {
    id: 'mission-8',
    order: 8,
    title: 'Square Route',
    subtitle: 'Four checkpoints',
    objective: 'Fly around four checkpoints and complete a clean square route.',
    skill: 'Pitch, roll and navigation',
  },
  {
    id: 'mission-9',
    order: 9,
    title: 'Figure Eight',
    subtitle: 'Continuous figure-8',
    objective: 'Fly around two markers in a continuous figure-eight pattern.',
    skill: 'Turning and spatial control',
  },
];

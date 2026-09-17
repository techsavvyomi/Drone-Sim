import type { Mission } from './types';
import { nightTracking } from './nightTracking';

// ----------------------------------------------------------------------------
// Mission 5 — Animal Rescue.
//
// Mission 6 (Search and Rescue) with one thing added: the corner radar shows
// where the tiger is, as a red dot that walks with it and rides the rim in its
// direction when it is out of range. Everything else — the forest, the four
// patrols, the light, the lock, the keep-off distance, the clock — is spread
// from `nightTracking` rather than copied, so the two cannot drift apart.
//
// Only the words that would be false here are replaced: Mission 6's briefing
// promises that nothing on screen points at the tiger.
// ----------------------------------------------------------------------------

const track = nightTracking.tracking!;

export const tigerTracker: Mission = {
  ...nightTracking,
  id: 'tiger-tracker',
  order: 5,
  name: 'Animal Rescue',
  subtitle: 'A tiger in the dark, and a red dot on your map',
  rules: [
    'The map in the top-right corner shows the tiger as a red dot. If the dot sits on the edge of the map, the tiger is further away in that direction.',
    ...nightTracking.rules!.slice(1),
  ],
  objectives: [
    'Fly out from the ranger station towards the red dot on your map.',
    'Find the tiger with your spotlight where the map shows it.',
    ...nightTracking.objectives.slice(2),
  ],
  mapNote: 'The forest at night. The tiger is the red dot on your map',
  tracking: { ...track, showOnMap: true },
};

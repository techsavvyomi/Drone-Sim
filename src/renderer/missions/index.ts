import { precisionDelivery } from './precisionDelivery';
import { forestFire } from './forestFire';
import type { Mission } from './types';

// The mission list.
//
// It lives here rather than in whichever mission file happened to be written
// first: `MISSIONS` used to be exported from `precisionDelivery.ts`, which meant
// the plugin registry, the mission screen and the HUD all imported one mission's
// module to find out about all of them, and adding a second mission meant
// editing the first one's file.
//
// Adding a mission is now: write its module, import it here, put it in the
// array. The order it appears in is not the order it is walked in — `order` is,
// and the sort below is what makes the two agree.

export const MISSIONS: readonly Mission[] = [precisionDelivery, forestFire].sort(
  (a, b) => a.order - b.order,
);

export function getMission(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export { precisionDelivery, forestFire };

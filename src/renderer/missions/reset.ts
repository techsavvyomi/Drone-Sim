import { useSimStore, DEFAULT_TAKEOFF_ALT } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { resetStick } from '../input/controls';

/**
 * Put the aircraft back on the pad for a fresh attempt.
 *
 * Exactly what the R key does — reset the body, disarm, clear the crash, centre
 * the sticks — written once so the button on the result card and the key on the
 * keyboard cannot drift apart. Clearing the CRASH is the part that matters: the
 * flag is sticky, and a restart that left it set had the Director fail the new
 * attempt on its very first frame.
 *
 * It does not touch the mission itself. `MissionDirector` watches the sim's
 * reset token and tears the attempt down when it moves, so there is one teardown
 * path whichever way the restart was asked for.
 */
export function resetForMission(): void {
  const sim = useSimStore.getState();
  // Both of these are global and sticky, and Flight School sets them for its own
  // lessons. A mission entered straight after Module 2 would otherwise spawn in
  // the air, at a lesson's hover height.
  sim.setSpawnLift(0);
  sim.setTakeoffAlt(DEFAULT_TAKEOFF_ALT);
  sim.requestReset();

  const flight = useFlightStore.getState();
  flight.disarm();
  flight.clearCrash();
  if (flight.paused) flight.togglePause();
  resetStick();
}

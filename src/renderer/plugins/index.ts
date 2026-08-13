import { listDrones, registerDrone, registerEnvironment } from './registry';
import { plutoDrone } from './drones/pluto';
import { guruDrone } from './drones/guru';
import { racingDrone } from './drones/racer';
import { droneArena } from './environments/droneArena';
import { droneAcademy } from './environments/droneAcademy';
import { flightSchool } from './environments/flightSchool';
import { classroom2 } from './environments/classroom2';
import { forest } from './environments/forest';
import { preloadDroneModel } from '../sim/drone/DroneModel';

// Registers all built-in content once at app startup. Adding a new drone/map is
// a one-line register call here plus a spec file — no engine changes.
export function loadBuiltinPlugins(): void {
  registerDrone(plutoDrone);
  registerDrone(guruDrone);
  registerDrone(racingDrone);
  registerEnvironment(droneArena);
  registerEnvironment(droneAcademy);
  registerEnvironment(flightSchool);
  registerEnvironment(classroom2);
  registerEnvironment(forest);

  // Warm the model cache immediately so nothing shows a stand-in airframe while
  // its .glb streams in. Every registered drone is warmed, not just the PlutoX:
  // the menu hero is hardcoded to the PlutoX (see Home.tsx), but the Fly and
  // Training views use the pilot's selection, and settings hydrate too late for
  // startup to know which that is.
  listDrones().forEach(preloadDroneModel);
}

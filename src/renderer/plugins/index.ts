import { listDrones, registerDrone, registerEnvironment } from './registry';
import { plutoDrone } from './drones/pluto';
import { guruDrone } from './drones/guru';
import { droneArena } from './environments/droneArena';
import { droneAcademy } from './environments/droneAcademy';
import { flightSchool } from './environments/flightSchool';
import { classroom2 } from './environments/classroom2';
import { preloadDroneModel } from '../sim/drone/DroneModel';

// Registers all built-in content once at app startup. Adding a new drone/map is
// a one-line register call here plus a spec file — no engine changes.
export function loadBuiltinPlugins(): void {
  registerDrone(plutoDrone);
  registerDrone(guruDrone);
  registerEnvironment(droneArena);
  registerEnvironment(droneAcademy);
  registerEnvironment(flightSchool);
  registerEnvironment(classroom2);

  // Warm the model cache immediately so the menu's hero shot never shows a
  // stand-in airframe while the .glb streams in. Every registered drone is
  // warmed, not just the PlutoX: the hero shot renders whichever drone is
  // selected, and settings hydrate too late to know which that is.
  listDrones().forEach(preloadDroneModel);
}

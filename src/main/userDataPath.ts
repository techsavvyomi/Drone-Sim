import { app } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Where each user's settings, sign-in and queued telemetry live.
//
// Electron names that folder after the app, and the app used to be called
// "Drone Flight Simulator". Renamed to PlutoSim, a plain upgrade would start in
// a new, empty folder: the pilot signed out, their settings and Flight School
// progress gone, and any flight data still waiting to upload stranded. So an
// installation that already has the old folder keeps using it; a fresh install
// gets the new name.

const LEGACY_NAMES = ['Drone Flight Simulator'];

/** Must run before anything reads a path from `app` (crash reporter included). */
export function keepExistingUserData(): void {
  const appData = app.getPath('appData');
  const current = app.getPath('userData');
  if (existsSync(current)) return;
  for (const name of LEGACY_NAMES) {
    const legacy = path.join(appData, name);
    if (existsSync(legacy)) {
      app.setPath('userData', legacy);
      return;
    }
  }
}

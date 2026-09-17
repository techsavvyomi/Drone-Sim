import { audioContext, masterBus, noiseBuffer } from '../audio/engine';
import {
  asphaltNormal,
  asphaltTexture,
  cloudTexture,
  concreteNormal,
  concreteTexture,
  grassNormal,
  grassTexture,
  highResStreetPBR,
  microStreetNormal,
} from '../scene/environment/textures';
import { runPreparationTasks } from './resourceTracker';

// The work a map does the first time it opens, done once in the loading screen.
//
// Measured opening New York (CPU profile, first vs second open in one session):
// starting the Web Audio engine cost ~420 ms and generating the procedural
// surface textures ~190 ms on the first open, and nothing on the second, because
// both are cached for the life of the app. Doing them here makes every map open
// like a second open.
//
// What is NOT here, because it cannot be carried over: shaders are recompiled
// for every new 3D view (the second open paid for them again), and textures are
// uploaded to each view's own GPU context. Those stay with the map.
//
// Weights are rough shares of the progress bar, on the same scale as model bytes.

const MB = 1048576;

export function startPreparingResources(): Promise<void> {
  return runPreparationTasks([
    {
      name: 'audio',
      label: 'sound engine',
      weightBytes: 4 * MB,
      run: () => {
        // Created suspended until the first click; it resumes itself then.
        audioContext();
        masterBus();
        noiseBuffer();
      },
    },
    {
      name: 'surfaces',
      label: 'surface textures',
      weightBytes: 3 * MB,
      run: () => {
        concreteTexture();
        asphaltTexture();
        grassTexture();
        concreteNormal();
        asphaltNormal();
        grassNormal();
        cloudTexture();
      },
    },
    {
      name: 'streets',
      label: 'city streets',
      weightBytes: 4 * MB,
      run: () => {
        highResStreetPBR();
        microStreetNormal();
      },
    },
  ]);
}

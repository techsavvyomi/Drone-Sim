import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { FlightScene } from '../scene/FlightScene';
import { SceneBoundary } from '../scene/Viewport';
import { useControls } from '../input/useControls';
import { Director } from './Director';
import { RouteGuide } from './RouteGuide';
import { TrainingHud } from '../hud/TrainingHud';

// The Flight School flight view: the same 3D flight scene as free-flight but
// pinned to the Drone Academy, with the headless Director and the route guide
// layered in, and a lesson-specific HUD overlay.
//
// Lessons fly the arena that is already standing here — the racing gates, the
// painted landing pads, the white markers ringing the helipad. Nothing is built
// for a lesson: `RouteGuide` only highlights whichever of those the active
// lesson is sending the pilot to.
export function TrainingViewport() {
  // Keyboard/gamepad listeners for the Practice phase (the Director suppresses
  // them during demos via the scripted-input flag).
  useControls();

  return (
    <div className="viewport">
      <SceneBoundary>
        <Canvas
          shadows={{ type: THREE.PCFShadowMap }}
          gl={{
            antialias: true,
            outputColorSpace: THREE.SRGBColorSpace,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
          camera={{ position: [8, 5, 9], fov: 60, near: 0.15, far: 700 }}
        >
          <FlightScene envIdOverride="drone-academy" />
          <RouteGuide />
          <Director />
        </Canvas>
      </SceneBoundary>
      <TrainingHud />
    </div>
  );
}

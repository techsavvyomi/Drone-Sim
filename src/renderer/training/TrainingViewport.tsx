import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { FlightScene } from '../scene/FlightScene';
import { SceneBoundary } from '../scene/Viewport';
import { useControls } from '../input/useControls';
import { useTrainingStore } from '../state/trainingStore';
import { getLesson } from './lessons';
import { Director } from './Director';
import { TrainingHud } from '../hud/TrainingHud';

// The Flight School flight view: the same 3D flight scene as free-flight but
// pinned to the Flight School environment, with the active lesson's props and
// the headless Director layered in, and a lesson-specific HUD overlay.
export function TrainingViewport() {
  // Keyboard/gamepad listeners for the Practice phase (the Director suppresses
  // them during demos via the scripted-input flag).
  useControls();

  const activeLessonId = useTrainingStore((s) => s.activeLessonId);
  const lesson = activeLessonId ? getLesson(activeLessonId) : undefined;
  const LessonScene = lesson?.Scene;

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
          <FlightScene envIdOverride="flight-school" />
          {LessonScene && <LessonScene />}
          <Director />
        </Canvas>
      </SceneBoundary>
      <TrainingHud />
    </div>
  );
}

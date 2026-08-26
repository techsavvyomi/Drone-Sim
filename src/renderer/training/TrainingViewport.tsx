import { useCallback, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { FlightScene } from '../scene/FlightScene';
import { SceneBoundary } from '../scene/Viewport';
import { qualityFor } from '../scene/quality';
import { SceneReady, SceneVeil } from '../scene/SceneReady';
import { useSettingsStore } from '../state/settingsStore';
import { useControls } from '../input/useControls';
import { useFlightStore } from '../state/flightStore';
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

  // The same preset the Fly view honours. This canvas used to hard-code shadows
  // and MSAA on, so dropping to Low did nothing here — on the machines that need
  // Low, the lesson view was the heaviest screen in the app.
  const graphics = useSettingsStore((s) => s.settings.graphics);
  const q = qualityFor(graphics);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  // Flight School owns two pieces of flight behaviour for as long as it is open,
  // and hands both back on the way out.
  //
  // 1. ALTITUDE HOLD is pinned. Every lesson is written around "centre the stick
  //    and it holds height" — a lesson that opens at a hover assumes it, and the
  //    throttle drill is meaningless without it. The mode is global and sticky,
  //    so a pilot who left the Fly screen in Acro used to arrive here to a drone
  //    that dropped out of its own opening hover.
  // 2. An auto-landing must NOT shut the motors down. Module 2 asks the pilot to
  //    land AND disarm, and a drone that disarms itself answers the second half
  //    of its own question.
  useEffect(() => {
    const flight = useFlightStore.getState();
    const previousMode = flight.mode;
    flight.setMode('altitude-hold');
    flight.setAutoDisarmOnLand(false);
    return () => {
      useFlightStore.getState().setMode(previousMode);
      useFlightStore.getState().setAutoDisarmOnLand(true);
    };
  }, []);

  return (
    <div className="viewport">
      <SceneBoundary>
        <Canvas
          shadows={q.shadows ? { type: THREE.PCFShadowMap } : false}
          dpr={q.dpr}
          gl={{
            antialias: q.msaa,
            powerPreference: 'high-performance',
            outputColorSpace: THREE.SRGBColorSpace,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
          camera={{ position: [8, 5, 9], fov: 60, near: 0.15, far: 700 }}
        >
          <FlightScene envIdOverride="drone-academy" />
          <RouteGuide />
          <Director />
          <SceneReady onReady={onReady} />
        </Canvas>
      </SceneBoundary>
      <TrainingHud />
      {!ready && <SceneVeil label="Getting the arena ready" />}
    </div>
  );
}

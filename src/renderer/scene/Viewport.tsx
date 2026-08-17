import { Component, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { FlightScene } from './FlightScene';
import { FlightHud } from '../hud/FlightHud';
import { useControls } from '../input/useControls';

/**
 * Catches errors thrown inside the 3D scene.
 *
 * Anything that throws under <Canvas> tears down the whole WebGL tree, which
 * presents as a completely black viewport with no clue as to why. That has
 * bitten us repeatedly with drei helpers that quietly fetch assets from a CDN
 * (HDRI environments, the Draco decoder, cloud sprites) — all blocked by the
 * app's CSP. Surfacing the message beats staring at a black screen.
 */
export class SceneBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[scene] failed to render:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="scene-error">
          <h3>Scene failed to load</h3>
          <p>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// The center 3D viewport: one R3F canvas with the flight scene, the HUD as a DOM
// overlay, and keyboard controls mounted for the view's lifetime.
export function Viewport() {
  useControls();

  return (
    <div className="viewport">
      <SceneBoundary>
        <Canvas
          // Filmic tone mapping. Linear tone mapping is the other
          // big reason procedural scenes look flat: highlights clip instead of
          // rolling off, so bright surfaces read as paint rather than light.
          shadows={{ type: THREE.PCFShadowMap }}
          gl={{
            antialias: true,
            outputColorSpace: THREE.SRGBColorSpace,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
          // near/far ratio drives depth precision: 0.08/700 maintains great depth resolution
          // without near-clipping small whoop airframes.
          camera={{ position: [8, 5, 9], fov: 60, near: 0.08, far: 700 }}
        >
          <FlightScene />
        </Canvas>
      </SceneBoundary>
      <FlightHud />
    </div>
  );
}

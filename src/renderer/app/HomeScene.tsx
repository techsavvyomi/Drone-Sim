import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { DroneModel } from '../sim/drone/DroneModel';

// Slowly rotating hero drone behind the main menu. No physics — purely a
// showcase, so it costs one extra canvas and nothing else.

function Spinner({ spec }: { spec: DroneSpec }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_s, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.34;
  });
  return (
    <group ref={ref} rotation={[0.32, 0, 0]}>
      <DroneModel spec={spec} />
    </group>
  );
}

export function HomeScene({ spec }: { spec: DroneSpec }) {
  return (
    <div className="home-scene">
      <Canvas camera={{ position: [0, 0.12, 0.46], fov: 42, near: 0.01, far: 10 }}>
        <ambientLight intensity={1.6} />
        <hemisphereLight intensity={1.2} color="#cfe3ff" groundColor="#1b2432" />
        <directionalLight position={[2, 3, 2]} intensity={2.4} />
        <directionalLight position={[-2, 1, -1]} intensity={1.1} color="#4ea1ff" />
        <Suspense fallback={null}>
          <Float speed={1.6} rotationIntensity={0.25} floatIntensity={0.5}>
            <Spinner spec={spec} />
          </Float>
        </Suspense>
      </Canvas>
    </div>
  );
}

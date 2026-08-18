import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { dronePose } from '../sim/drone/pose';

// A ring on the floor directly beneath the drone plus a vertical tether line.
// Makes a small drone easy to locate and gives an instant read on altitude.
export function GroundMarker() {
  const ring = useRef<THREE.Mesh>(null);
  const line = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!dronePose.present) return;
    const { x, y, z } = dronePose.position;
    const airborne = y > 0.06;

    if (ring.current) {
      ring.current.visible = airborne;
      ring.current.position.set(x, 0.015, z);
      // Ring grows slightly with altitude so it stays readable from above.
      const s = 1 + Math.min(y, 8) * 0.12;
      ring.current.scale.setScalar(s);
    }
    if (line.current) {
      line.current.visible = airborne;
      const h = Math.max(y, 0.001);
      line.current.position.set(x, h / 2, z);
      line.current.scale.set(1, h, 1);
    }
  });

  return (
    <group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.22, 0.28, 32]} />
        <meshBasicMaterial color="#4ea1ff" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {/* Unit-height cylinder scaled to the drone's altitude */}
      <mesh ref={line}>
        <cylinderGeometry args={[0.006, 0.006, 1, 6]} />
        <meshBasicMaterial color="#4ea1ff" transparent opacity={0.22} depthWrite={false} />
      </mesh>
    </group>
  );
}

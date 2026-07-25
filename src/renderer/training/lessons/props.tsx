import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vec3 } from '@shared/types';

// Reusable, visual-only 3D props for the stick-skill lessons. None have physics
// colliders — they are targets to fly to/through, scored by the validators.

/** An upright glowing ring to fly toward (Pitch checkpoint). */
export function Checkpoint({
  position,
  color = '#38bdf8',
  radius = 0.7,
}: {
  position: Vec3;
  color?: string;
  radius?: number;
}) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    const k = 1 + 0.06 * Math.sin(s.clock.elapsedTime * 2.5);
    if (ring.current) ring.current.scale.set(k, k, 1);
  });
  return (
    <group position={position}>
      <mesh ref={ring}>
        <torusGeometry args={[radius, 0.06, 12, 40]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
      </mesh>
      {/* Ground shadow ring beneath, so its position on the floor reads clearly. */}
      <mesh position={[0, -position[1] + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.8, radius, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.25} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** A tall translucent pylon marking a point to fly past (Roll markers). */
export function Pylon({ position, color = '#a855f7' }: { position: Vec3; color?: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 1.8, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.24, 0.34, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** A wireframe cube volume to hold position inside (Hover box). */
export function HoverBox({
  position,
  size = 1.5,
  color = '#37e08a',
}: {
  position: Vec3;
  size?: number;
  color?: string;
}) {
  const edges = useRef<THREE.LineSegments>(null);
  useFrame((s) => {
    const m = edges.current?.material as THREE.LineBasicMaterial | undefined;
    if (m) m.opacity = 0.5 + 0.3 * (0.5 + 0.5 * Math.sin(s.clock.elapsedTime * 2));
  });
  return (
    <group position={position}>
      <lineSegments ref={edges}>
        <edgesGeometry args={[new THREE.BoxGeometry(size, size, size)]} />
        <lineBasicMaterial color={color} transparent opacity={0.7} />
      </lineSegments>
      <mesh>
        <boxGeometry args={[size, size, size]} />
        <meshBasicMaterial color={color} transparent opacity={0.06} depthWrite={false} />
      </mesh>
    </group>
  );
}

import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import newYorkModelUrl from '../../../assets/models/new_york_city.opt.glb?url';

// New York City urban environment. Draco-compressed GLB with realistic Manhattan
// skyscrapers, roadways, sidewalks, and rooftops.

/**
 * Centering offset: raw model center is at [-61.68, 0, 30.56].
 * Shifting by [+61.68, 0, -30.56] places the central avenue and intersection
 * right at (0, 0, 0) with ground level on y = 0.
 */
const CITY_OFFSET: [number, number, number] = [61.68, 0, -30.56];
const MODEL_SCALE = 1;

/**
 * Top face of the catch floor — a safety boundary below the city streets.
 */
const CATCH_TOP = -8;
const CATCH_HALF = 2;

/**
 * Half-width of a flat apron over the spawn avenue, top face on y = 0.
 * Ensures the drone can sit firmly on solid ground immediately while the
 * 3D city scene finishes streaming in.
 */
const APRON_HALF = 25;

function NewYorkModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);

  const model = useMemo(() => {
    const root = scene.clone(true);
    root.position.set(...CITY_OFFSET);
    root.scale.setScalar(MODEL_SCALE);

    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;

        if (m.material) {
          const mat = m.material as THREE.MeshStandardMaterial;
          mat.roughness = Math.min(Math.max(mat.roughness ?? 0.6, 0.3), 0.9);
          mat.envMapIntensity = 0.8;
          mat.needsUpdate = true;
        }
      }
    });

    return root;
  }, [scene]);

  return (
    <RigidBody type="fixed" colliders="trimesh">
      <primitive object={model} />
    </RigidBody>
  );
}

useGLTF.preload(newYorkModelUrl);

export function NewYorkEnv({ env }: { env: EnvironmentSpec }) {
  const url = env.model ?? newYorkModelUrl;

  return (
    <group name="new-york-environment">
      {/* City lighting setup */}
      <directionalLight
        position={[60, 140, 40]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-camera-near={10}
        shadow-camera-far={350}
        shadow-camera-left={-120}
        shadow-camera-right={120}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
      />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#dce8f5', '#606870', 0.6]} />

      {/* Immediate spawn ground pad (solid instantly while GLB streams in) */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[APRON_HALF, 0.25, APRON_HALF]} position={[0, -0.25, 0]} />
        <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[APRON_HALF * 2, APRON_HALF * 2]} />
          <meshStandardMaterial color="#2b2d30" roughness={0.9} />
        </mesh>
      </RigidBody>

      {/* Main ground plane collider spanning the full city area */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[150, 0.5, 120]} position={[0, -0.5, 0]} />
      </RigidBody>

      {/* Safety catch floor */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[160, CATCH_HALF, 130]} position={[0, CATCH_TOP - CATCH_HALF, 0]} />
      </RigidBody>

      {/* 3D City Model with Physical Building Colliders */}
      <Suspense fallback={null}>
        <NewYorkModel url={url} />
      </Suspense>
    </group>
  );
}

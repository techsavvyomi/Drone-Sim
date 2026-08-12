import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import forestModelUrl from '../../../assets/models/forest.opt.glb?url';

// Forest scene. Draco-compressed like the classroom; the decoder path is set
// globally at startup (see main.tsx) so nothing needs passing here.

/**
 * Where the scene's playable floor sits in the raw export.
 *
 * The model's lowest geometry is at y = 96, but that is the valley floor far
 * below. The clearing you actually fly in — the bare dirt road, with the fence,
 * logs and cobblestone around it — sits at y ~= 173.15, and is centred at
 * x = 2.3, z = 53.7. Shifting by the negative of that puts the clearing at the
 * origin with its ground on y = 0, which is where the sim expects to find it.
 */
const CLEARING_CENTRE: [number, number, number] = [2.3, 173.15, 53.7];

/**
 * Scene scale, in metres per authored unit.
 *
 * Taken at face value the export is already metric: the clearing measures
 * ~40 x 27 and the canopy stands ~34 above it, which reads as a believable
 * forest track. It does look coarse at drone height, but that is texel density
 * — a ground texture stretched over 40 m, viewed from 30 cm up — rather than
 * proportion. Lower this if the scene should feel tighter; everything else,
 * including the recentring below, follows from it.
 */
const MODEL_SCALE = 1;

// The offset is applied after the scale (Three composes T * R * S), so it has
// to be expressed in scaled metres, not authored units.
const MODEL_OFFSET: [number, number, number] = [
  -CLEARING_CENTRE[0] * MODEL_SCALE,
  -CLEARING_CENTRE[1] * MODEL_SCALE,
  -CLEARING_CENTRE[2] * MODEL_SCALE,
];

/**
 * Half-thickness of the ground slab. The forest floor is a visual mesh with
 * ~0.5 m of undulation across the clearing, so physics uses a flat slab at
 * y = 0 rather than the terrain itself: the sim's landing and altitude logic
 * (GROUND_ALT, the bounds floor) all assume ground is y = 0, and a trimesh
 * terrain would put the drone metres below "zero altitude" out by the valley.
 */
const GROUND_HALF = 0.5;

function ForestModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);

  const model = useMemo(() => {
    const root = scene.clone(true);
    root.position.set(...MODEL_OFFSET);
    root.scale.setScalar(MODEL_SCALE);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Foliage is the whole scene here, so shadow-casting every leaf card is
      // not worth it; the ground still receives the sun.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (!mat) continue;
        // Tree and grass cards are alpha-cut planes. Without double-siding they
        // vanish when viewed from behind, which in a forest is most of the time.
        mat.side = THREE.DoubleSide;
        if (mat.map) mat.alphaTest = Math.max(mat.alphaTest, 0.35);
      }
    });
    return root;
  }, [scene]);

  return <primitive object={model} />;
}

export function ForestEnv({ env }: { env: EnvironmentSpec }) {
  const { min, max } = env.bounds;
  const spanX = max[0] - min[0];
  const spanZ = max[2] - min[2];

  return (
    <group>
      {/* Flat ground slab, top face on y = 0. Declared as an explicit collider
          rather than an invisible mesh with colliders="cuboid": the automatic
          path derives shapes by walking the object tree, and a mesh with
          visible={false} yields no collider at all — the drone falls straight
          through. Nothing here needs to be drawn; the forest floor mesh is the
          visual, this is only something to land on. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[spanX, GROUND_HALF, spanZ]} position={[0, -GROUND_HALF, 0]} />
      </RigidBody>

      <Suspense fallback={null}>
        <ForestModel url={forestModelUrl} />
      </Suspense>
    </group>
  );
}

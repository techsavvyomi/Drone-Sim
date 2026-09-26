import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody, TrimeshCollider } from '@react-three/rapier';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import supermarketModelUrl from '../../../assets/models/supermarket.opt.glb?url';
import { buildSupermarketColliders, type ColliderSource } from './supermarketColliders';

// Supermarket scene. Draco-compressed; the decoder path is set globally at
// startup (see main.tsx). Built by scripts/prepare-supermarket-model.mjs, which
// already dropped the export's sky sphere and invisible collision hulls.

/**
 * Metres per authored unit.
 *
 * The export is in Re-Volt's units: the store's roof sits 60 up and the
 * shopfront glass is 28 tall. At 0.1 that is a 6 m ceiling and 2.8 m windows,
 * with shelves around 3.1 m — a real supermarket. The model stays where it was
 * authored (no recentring), so the spec's numbers are raw coordinates ÷ 10.
 */
const MODEL_SCALE = 0.1;

/**
 * Materials that get no collider.
 *
 * `Start` is the racing grid painted on the car park and `crosswalk` a road
 * marking — both flat decals on the ground plane, which is solid anyway.
 * `bost` is the store's alpha-blended signage and product art; it is laid on
 * the shelves, which are solid in their own right, and colliding the cards
 * would hang invisible panels in the aisles. Glass stays solid: a window you
 * can see is one you should hit.
 */
const NON_SOLID = /^(Start|crosswalk|bost)$/;

/**
 * Every material but the glass is drawn as a Lambert surface, not PBR.
 *
 * Measured, 2026-09-26, rendering this map alone at the app's Retina size on
 * the M3 it lagged on: the store interior cost 13.1 ms a frame with the
 * export's MeshStandard materials and 7.7 ms as Lambert (the car park 4.8 ->
 * 3.8). Inside the store the camera looks through shelf after shelf of the one
 * joined mesh, and the full PBR lighting — image-based light, roughness and
 * metalness maps — ran for every layer of that overdraw. 13 ms of a 16.7 ms
 * frame before the drone, the HUD or the post effects was the lag, and the
 * physics catching up on each late frame was the stutter.
 *
 * Nothing is lost that this model was using: it is a Re-Volt level with its
 * lighting baked into an emissive atlas, and its one metallic material turned
 * walls into dark chrome until it was capped. The glass keeps its own material,
 * because it is the only thing here meant to reflect.
 */
function prepareMaterial(mat: THREE.Material): THREE.Material {
  const std = mat as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return mat;
  if (std.name === 'glass') return mat;
  const lambert = new THREE.MeshLambertMaterial({
    name: std.name,
    map: std.map,
    color: std.color,
    emissive: std.emissive,
    emissiveMap: std.emissiveMap,
    emissiveIntensity: std.emissiveIntensity,
    aoMap: std.aoMap,
    side: std.side,
    // The decals and signs are cut-outs; sorting them as transparent flickers
    // against each other across the aisles.
    alphaTest: std.transparent ? 0.5 : std.alphaTest,
    transparent: false,
    depthWrite: true,
  });
  std.dispose();
  return lambert;
}

/** The store roof's own material — the untextured dark slab at 6 m. */
const ROOF_MATERIAL = 'roadtest.003';

/**
 * The ground: one cuboid, top face at y = 0, under the whole map.
 *
 * It stands in for every flat ground triangle (the car park, the pavements, the
 * store and warehouse floors — all at 0 to the millimetre). One face instead of
 * six thousand triangles is what stops a touchdown catching on their seams, and
 * it is mounted outside the Suspense, so the spawn is solid before the model
 * has streamed in.
 */
const GROUND_HALF = 0.5;

/** A mesh's solid triangles in world metres, for the collider builder. */
function sourceOf(mesh: THREE.Mesh): ColliderSource {
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  const index = mesh.geometry.index
    ? mesh.geometry.index.array
    : Uint32Array.from({ length: pos.count }, (_, i) => i);
  return { positions: out, index };
}

function SupermarketModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);

  const model = useMemo(() => {
    const root = scene.clone(true);
    root.scale.setScalar(MODEL_SCALE);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      // Only the roof casts: it is what keeps the sun off the store floor, and
      // it is 2k triangles where the whole atlas mesh is 90k — a second pass
      // over that is what the integrated-GPU target cannot afford.
      mesh.castShadow = !Array.isArray(mat) && mat?.name === ROOF_MATERIAL;
      mesh.receiveShadow = true;
      if (Array.isArray(mat)) mesh.material = mat.map((m) => prepareMaterial(m.clone()));
      else if (mat) mesh.material = prepareMaterial(mat.clone());
    });
    root.updateMatrixWorld(true);
    return root;
  }, [scene]);

  // Boxes for the solid parts, exact triangles for the rest — see
  // supermarketColliders.ts. The root sits at the origin, so each mesh's world
  // matrix already carries the scale.
  const colliders = useMemo(() => {
    const sources: ColliderSource[] = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (NON_SOLID.test(mat?.name ?? '')) return;
      sources.push(sourceOf(mesh));
    });
    const set = buildSupermarketColliders(sources);
    const shellIndex = Uint32Array.from({ length: set.shell.length / 3 }, (_, i) => i);
    if (import.meta.env.DEV) {
      console.info(
        `[supermarket] colliders: ${set.boxes.length} boxes, ` +
          `${(set.shell.length / 9).toLocaleString()} shell triangles, ` +
          `${set.groundTris.toLocaleString()} ground triangles replaced by one cuboid`,
      );
    }
    return { ...set, shellIndex };
  }, [model]);

  return (
    <>
      <primitive object={model} />
      <RigidBody type="fixed" colliders={false}>
        {colliders.boxes.map((b, i) => (
          <CuboidCollider
            key={i}
            args={b.half}
            position={b.pos}
            rotation={[0, b.yaw, 0]}
            friction={0.6}
            restitution={0}
          />
        ))}
        <TrimeshCollider
          args={[colliders.shell, colliders.shellIndex]}
          friction={0.6}
          restitution={0}
        />
      </RigidBody>
    </>
  );
}

export function SupermarketEnv({ env }: { env: EnvironmentSpec }) {
  const { min, max } = env.bounds;
  const cx = (max[0] + min[0]) / 2;
  const cz = (max[2] + min[2]) / 2;

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[(max[0] - min[0]) / 2 + 5, GROUND_HALF, (max[2] - min[2]) / 2 + 5]}
          position={[cx, -GROUND_HALF, cz]}
          friction={0.9}
          restitution={0}
        />
      </RigidBody>

      <Suspense fallback={null}>
        <SupermarketModel url={supermarketModelUrl} />
      </Suspense>
    </group>
  );
}

useGLTF.preload(supermarketModelUrl);

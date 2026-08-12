import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import classroom2ModelUrl from '../../../assets/models/classroom2.glb?url';

// classroom2.glb is already in metres, and IS Draco-compressed.
//
// drei defaults its DRACOLoader to gstatic.com, which the app's CSP
// (`connect-src 'self'`) blocks — the decoder never loads, the geometry never
// decompresses, and the room renders as untextured grey. Hence the bundled
// decoder in public/draco/gltf/ and the explicit path below.
//
// The path is deliberately RELATIVE: it resolves against the document base, so
// it works both under the dev server and under file:// in a packaged build,
// where a leading slash would point at the filesystem root.
const DRACO_DECODER_PATH = 'draco/gltf/';
const MODEL_SCALE = 1;
// Raw bbox ≈ [-100.7, -0.2, -10.2] → [-92.4, 3.3, 0.17].
// XZ recentre only. Do NOT lift Y — visual parquet must sit on physics y=0.
const MODEL_OFFSET: [number, number, number] = [96.54, 0, 5.02];

const FLOOR_HALF_H = 0.25;
/** Outer shell thickness — centres sit outside play bounds. */
const WALL_T = 0.45;

const KEEP_METAL = /metal|chrome|iron|galva/i;

type BoxCollider = {
  key: string;
  position: [number, number, number];
  half: [number, number, number];
};

const CEILING_POINTS: [number, number, number][] = [
  [-2.2, 3.05, -2.4],
  [0.0, 3.05, -2.4],
  [2.2, 3.05, -2.4],
  [-2.2, 3.05, 0.0],
  [0.0, 3.05, 0.0],
  [2.2, 3.05, 0.0],
  [-2.2, 3.05, 2.4],
  [0.0, 3.05, 2.4],
  [2.2, 3.05, 2.4],
];

function Classroom2Lights() {
  return (
    <group>
      <ambientLight intensity={0.45} color="#fff6ea" />
      <hemisphereLight args={['#e8f0ff', '#3a3228', 0.35]} />
      <directionalLight
        position={[-6.5, 2.6, 0.2]}
        intensity={1.15}
        color="#dff0ff"
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      {CEILING_POINTS.map((pos, i) => (
        <group key={i} position={pos}>
          <pointLight intensity={0.55} color="#fff8ec" distance={7} decay={2} />
        </group>
      ))}
    </group>
  );
}

function prepareMaterial(mat: THREE.Material): THREE.Material {
  const clone = mat.clone();
  const name = (clone.name || mat.name || '').trim();
  const std = clone as THREE.MeshStandardMaterial;
  const isPbr =
    std.isMeshStandardMaterial ||
    (clone as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial;
  if (!isPbr) return clone;

  if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
  if (std.emissiveMap) std.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  if (/glass|window/i.test(name)) {
    const phys = clone as THREE.MeshPhysicalMaterial;
    phys.transmission = 0;
    phys.transparent = true;
    phys.opacity = Math.min(phys.opacity || 1, 0.35);
    phys.depthWrite = false;
    phys.side = THREE.DoubleSide;
    phys.needsUpdate = true;
    return clone;
  }

  if (!KEEP_METAL.test(name)) {
    std.metalness = Math.min(std.metalness, 0.1);
  }

  std.envMapIntensity = 0.5;
  std.side = THREE.DoubleSide;
  std.needsUpdate = true;
  return clone;
}

/**
 * Per-mesh AABB cuboids. Avoids Rapier hull/trimesh crashes on this heavy GLB.
 */
function buildFurnitureBoxes(
  root: THREE.Object3D,
  spawn: { position: [number, number, number] },
): BoxCollider[] {
  root.updateWorldMatrix(true, true);
  const boxes: BoxCollider[] = [];
  const worldBox = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  const [sx, , sz] = spawn.position;
  const SPAWN_CLEAR_R = 0.55;
  let i = 0;

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    worldBox.setFromObject(mesh);
    if (worldBox.isEmpty()) return;
    worldBox.getSize(size);
    worldBox.getCenter(center);

    if (size.x < 0.008 || size.y < 0.008 || size.z < 0.008) return;
    if (size.x * size.y * size.z < 0.00012) return;

    if (size.y < 0.15 && size.x > 3 && size.z > 3) return;

    const top = center.y + size.y * 0.5;
    const bottom = center.y - size.y * 0.5;
    if (top < 0.12) return;
    if (bottom < -0.05 && size.y < 0.35) return;

    const isWallLike = size.y >= 1.0 && Math.min(size.x, size.z) < 1.2;
    if (size.x > 6 && size.z > 6) return;
    if (!isWallLike && (size.x > 7 || size.z > 7)) return;

    // Ceiling lights / hanging fixtures glue Alt Hold — skip them.
    if (!isWallLike && (center.y > 2.35 || bottom > 2.15)) return;
    if (center.y > 2.2 && size.y < 0.45 && size.x > 1.5 && size.z > 1.5) return;

    const thin = Math.min(size.x, size.y, size.z);
    const longest = Math.max(size.x, size.y, size.z);
    const isThinPanel = thin < 0.05 && longest > 0.25;
    const isFlatTop =
      size.y < 0.08 && size.x > 0.35 && size.z > 0.25 && center.y < 1.6;

    const dx = Math.max(Math.abs(center.x - sx) - size.x * 0.5, 0);
    const dz = Math.max(Math.abs(center.z - sz) - size.z * 0.5, 0);
    if (dx * dx + dz * dz < SPAWN_CLEAR_R * SPAWN_CLEAR_R && bottom < 1.2) return;

    let hx = Math.max(size.x * 0.5, 0.02);
    let hy = Math.max(size.y * 0.5, 0.02);
    let hz = Math.max(size.z * 0.5, 0.02);

    if (isWallLike) {
      const minThick = 0.14;
      if (size.x <= size.z) hx = Math.max(hx, minThick);
      else hz = Math.max(hz, minThick);
    } else if (isThinPanel || isFlatTop) {
      const minThick = isFlatTop ? 0.045 : 0.055;
      if (size.x <= size.y && size.x <= size.z) hx = Math.max(hx, minThick);
      else if (size.y <= size.x && size.y <= size.z) hy = Math.max(hy, minThick);
      else hz = Math.max(hz, minThick);
    }

    boxes.push({
      key: `furn-${i++}-${mesh.name || 'mesh'}`,
      position: [center.x, center.y, center.z],
      half: [hx, hy, hz],
    });
  });

  return boxes;
}

function Classroom2Model({
  url,
  spawnPos,
}: {
  url: string;
  spawnPos: [number, number, number];
}) {
  const { scene } = useGLTF(url, DRACO_DECODER_PATH);

  const { model, furnitureBoxes } = useMemo(() => {
    const root = scene.clone(true);
    root.position.set(...MODEL_OFFSET);
    root.scale.setScalar(MODEL_SCALE);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const mat = mesh.material;
      if (Array.isArray(mat)) mesh.material = mat.map(prepareMaterial);
      else if (mat) mesh.material = prepareMaterial(mat);
    });
    return {
      model: root,
      furnitureBoxes: buildFurnitureBoxes(root, { position: spawnPos }),
    };
  }, [scene, spawnPos[0], spawnPos[1], spawnPos[2]]);

  return (
    <>
      <primitive object={model} />
      <RigidBody type="fixed" colliders={false}>
        {furnitureBoxes.map((b) => (
          <CuboidCollider key={b.key} args={b.half} position={b.position} />
        ))}
      </RigidBody>
    </>
  );
}

export function Classroom2Env({ env }: { env: EnvironmentSpec }) {
  const { min, max } = env.bounds;
  const sizeX = max[0] - min[0];
  const sizeZ = max[2] - min[2];
  const cx = (max[0] + min[0]) / 2;
  const cz = (max[2] + min[2]) / 2;
  const halfX = sizeX / 2;
  const halfZ = sizeZ / 2;
  const wallH = Math.max(max[1], 3.0);
  const spawnPos = env.spawn.position as [number, number, number];

  return (
    <group>
      <Classroom2Lights />

      {env.model && (
        <Suspense fallback={null}>
          <Classroom2Model url={env.model} spawnPos={spawnPos} />
        </Suspense>
      )}

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[halfX + 0.5, FLOOR_HALF_H, halfZ + 0.5]}
          position={[cx, -FLOOR_HALF_H, cz]}
        />
      </RigidBody>

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[halfX + 0.5, 0.18, halfZ + 0.5]}
          position={[cx, max[1] + 0.18, cz]}
          friction={0}
          restitution={0}
        />
      </RigidBody>

      {/* Outer shell — inner faces on play bounds. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[halfX + WALL_T, wallH / 2, WALL_T / 2]}
          position={[cx, wallH / 2, min[2] - WALL_T / 2]}
          friction={0.05}
          restitution={0}
        />
        <CuboidCollider
          args={[halfX + WALL_T, wallH / 2, WALL_T / 2]}
          position={[cx, wallH / 2, max[2] + WALL_T / 2]}
          friction={0.05}
          restitution={0}
        />
        <CuboidCollider
          args={[WALL_T / 2, wallH / 2, halfZ + WALL_T]}
          position={[min[0] - WALL_T / 2, wallH / 2, cz]}
          friction={0.05}
          restitution={0}
        />
        <CuboidCollider
          args={[WALL_T / 2, wallH / 2, halfZ + WALL_T]}
          position={[max[0] + WALL_T / 2, wallH / 2, cz]}
          friction={0.05}
          restitution={0}
        />
      </RigidBody>
    </group>
  );
}

useGLTF.clear(classroom2ModelUrl);
// Same decoder path as the hook above — drei caches per loader configuration,
// so a preload without it warms an entry the component never reads.
useGLTF.preload(classroom2ModelUrl, DRACO_DECODER_PATH);

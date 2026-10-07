import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { GeometryColliders } from './GeometryColliders';
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
const KEEP_METAL = /metal|chrome|iron|galva/i;

function Classroom2Lights() {
  return (
    <group>
      <ambientLight intensity={0.55} color="#fff6ea" />
      <hemisphereLight args={['#e8f0ff', '#3a3228', 0.45]} />
      <directionalLight position={[-6.5, 2.6, 0.2]} intensity={1.05} color="#dff0ff" />
      <pointLight position={[0, 2.9, 0]} intensity={1.1} color="#fff8ec" distance={11} decay={2} />
    </group>
  );
}

function prepareMaterial(mat: THREE.Material): THREE.Material {
  const clone = mat.clone();
  const name = (clone.name || mat.name || '').trim();
  const std = clone as THREE.MeshStandardMaterial;
  const isPbr =
    std.isMeshStandardMaterial || (clone as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial;
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
  std.needsUpdate = true;
  return clone;
}

function Classroom2Model({ url }: { url: string }) {
  const { scene } = useGLTF(url, DRACO_DECODER_PATH);

  const model = useMemo(() => {
    const root = scene.clone(true);
    root.position.set(...MODEL_OFFSET);
    root.scale.setScalar(MODEL_SCALE);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const mat = mesh.material;
      if (Array.isArray(mat)) mesh.material = mat.map(prepareMaterial);
      else if (mat) mesh.material = prepareMaterial(mat);
    });

    root.updateMatrixWorld(true);
    return root;
  }, [scene]);

  return (
    <>
      <primitive object={model} />
      <GeometryColliders root={model} />
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

  return (
    <group>
      <Classroom2Lights />

      {env.model && (
        <Suspense fallback={null}>
          <Classroom2Model url={env.model} />
        </Suspense>
      )}

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[halfX + 0.5, FLOOR_HALF_H, halfZ + 0.5]}
          position={[cx, -FLOOR_HALF_H, cz]}
        />
      </RigidBody>

      {/* Walls, ceiling, glass and furniture use the GLB's surfaces above. */}
    </group>
  );
}

useGLTF.preload(classroom2ModelUrl, DRACO_DECODER_PATH);

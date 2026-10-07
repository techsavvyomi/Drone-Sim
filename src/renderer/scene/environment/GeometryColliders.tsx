import { useMemo } from 'react';
import { CuboidCollider, RigidBody, TrimeshCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { collisionChunks } from './geometryColliderChunks';
import {
  buildSupermarketColliders,
  type ColliderSource,
  type SupermarketColliderSet,
} from './supermarketColliders';

/** Extract exactly the rendered triangles, including material groups and instances. */
export function collisionSources(root: THREE.Object3D, excludeMaterial?: RegExp): ColliderSource[] {
  root.updateWorldMatrix(true, true);
  const sources: ColliderSource[] = [];
  const v = new THREE.Vector3();
  const instance = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  root.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const count = geo.index?.count ?? pos.count;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material)
      ? geo.groups
      : [{ start: 0, count, materialIndex: 0 }];
    const indices: number[] = [];
    for (const group of groups) {
      const mat = materials[group.materialIndex ?? 0];
      if (!mat?.visible || excludeMaterial?.test(mat.name)) continue;
      const start = Math.max(group.start, geo.drawRange.start);
      const end = Math.min(
        count,
        group.start + group.count,
        geo.drawRange.start + geo.drawRange.count,
      );
      for (let i = start; i + 2 < end; i += 3) {
        for (let k = 0; k < 3; k++) indices.push(geo.index ? geo.index.getX(i + k) : i + k);
      }
    }
    if (!indices.length) return;
    const instanced = mesh as THREE.InstancedMesh;
    for (let n = 0; n < (instanced.isInstancedMesh ? instanced.count : 1); n++) {
      if (instanced.isInstancedMesh) {
        instanced.getMatrixAt(n, instance);
        world.multiplyMatrices(mesh.matrixWorld, instance);
      } else world.copy(mesh.matrixWorld);
      const positions = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(world);
        positions.set([v.x, v.y, v.z], i * 3);
      }
      sources.push({ positions, index: Uint32Array.from(indices) });
    }
  });
  return sources;
}

export function GeometryColliderSet({
  set,
  friction = 0.6,
}: {
  set: SupermarketColliderSet;
  friction?: number;
}) {
  const chunks = useMemo(() => collisionChunks(set.shell), [set.shell]);
  return (
    <RigidBody type="fixed" colliders={false}>
      {set.boxes.map((b, i) => (
        <CuboidCollider
          key={`box-${i}`}
          args={b.half}
          position={b.pos}
          rotation={[0, b.yaw, 0]}
          friction={friction}
          restitution={0}
        />
      ))}
      {chunks.map((c, i) => (
        <TrimeshCollider
          key={`mesh-${i}`}
          args={[c.vertices, c.indices]}
          friction={friction}
          restitution={0}
        />
      ))}
    </RigidBody>
  );
}

export function GeometryColliders({
  root,
  excludeMaterial,
}: {
  root: THREE.Object3D;
  excludeMaterial?: RegExp;
}) {
  const set = useMemo(
    () => buildSupermarketColliders(collisionSources(root, excludeMaterial), false),
    [root, excludeMaterial],
  );
  return <GeometryColliderSet set={set} />;
}

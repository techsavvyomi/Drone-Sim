import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// Instanced grass tufts.
//
// A textured plane reads as flat no matter how good the texture is, because it
// has no silhouette against the horizon. A few thousand crossed billboards give
// the ground actual relief for ~2 draw calls.

export function GrassField({
  count = 4200,
  innerRadius = 34,
  outerRadius = 105,
}: {
  count?: number;
  /** Keep clear of the apron/taxiway. */
  innerRadius?: number;
  outerRadius?: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);

  // Deterministic scatter so the field is identical every launch.
  const { geometry, matrices } = useMemo(() => {
    // Two crossed quads make a tuft that reads from any angle.
    const blade = new THREE.PlaneGeometry(0.5, 0.62);
    blade.translate(0, 0.31, 0);
    const second = blade.clone();
    second.rotateY(Math.PI / 2);
    // Merge the two quads by hand into a single buffer.
    const geo = new THREE.BufferGeometry();
    const posA = blade.getAttribute('position').array as Float32Array;
    const posB = second.getAttribute('position').array as Float32Array;
    const idxA = Array.from(blade.getIndex()!.array);
    const idxB = Array.from(second.getIndex()!.array).map((i) => i + posA.length / 3);
    const uvA = blade.getAttribute('uv').array as Float32Array;
    const uvB = second.getAttribute('uv').array as Float32Array;

    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([...posA, ...posB], 3),
    );
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([...uvA, ...uvB], 2));
    geo.setIndex([...idxA, ...idxB]);
    geo.computeVertexNormals();
    blade.dispose();
    second.dispose();

    const rand = (i: number, s: number) => {
      const n = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };

    const list: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < count; i++) {
      const a = rand(i, 1) * Math.PI * 2;
      const r = innerRadius + rand(i, 2) * (outerRadius - innerRadius);
      pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      q.setFromAxisAngle(up, rand(i, 3) * Math.PI);
      const h = 0.7 + rand(i, 4) * 0.9;
      scl.set(0.8 + rand(i, 5) * 0.5, h, 1);
      list.push(m.clone().compose(pos, q, scl));
    }
    return { geometry: geo, matrices: list };
  }, [count, innerRadius, outerRadius]);

  // Push the instance transforms once.
  const set = (im: THREE.InstancedMesh | null) => {
    if (!im) return;
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  };

  return (
    <instancedMesh
      ref={(el) => {
        mesh.current = el;
        set(el);
      }}
      args={[geometry, undefined, count]}
      castShadow={false}
      receiveShadow
      frustumCulled
    >
      <meshStandardMaterial
        color="#4e7038"
        side={THREE.DoubleSide}
        roughness={1}
        alphaTest={0.1}
        envMapIntensity={0.3}
      />
    </instancedMesh>
  );
}

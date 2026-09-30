// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mergeStaticParts } from '../src/renderer/sim/drone/DroneModel';

// The optimised drone models are quantised (KHR_mesh_quantization): every part's
// positions are normalised Int16 in −1..1 and the node's scale (1-68× on the
// Racing Drone) takes them to size. Merging bakes that transform into the
// vertices; written back into the Int16 array the values clamped at ±1, and on
// the Hangar turntable the Racing Drone's frame and legs collapsed while its
// props hung in the air (user, 2026-09-30).

const Q = 32767;

/** A box part the way the optimised models ship one: Int16-normalised positions,
 *  sized by the node's scale, uv in `uvType`. */
function quantisedPart(material: THREE.Material, at: THREE.Vector3, scale: number, uvType: 'int16' | 'float32') {
  const box = new THREE.BoxGeometry(2, 2, 2); // −1..1, exactly the normalised range
  const g = new THREE.BufferGeometry();
  const p = box.getAttribute('position');
  const pos = new Int16Array(p.count * 3);
  for (let i = 0; i < p.count * 3; i++) pos[i] = Math.round((p.array[i] as number) * Q);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3, true));
  const uvSrc = box.getAttribute('uv');
  const uv =
    uvType === 'int16'
      ? new THREE.BufferAttribute(Int16Array.from(uvSrc.array as Float32Array, (v) => Math.round(v * Q)), 2, true)
      : new THREE.BufferAttribute(Float32Array.from(uvSrc.array as Float32Array), 2);
  g.setAttribute('uv', uv);
  g.setIndex(box.getIndex());
  const mesh = new THREE.Mesh(g, material);
  mesh.position.copy(at);
  mesh.scale.setScalar(scale);
  return mesh;
}

function worldBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, true);
}

describe('merging a quantised drone model', () => {
  it.each([
    ['same uv type (all Int16)', 'int16', 'int16'],
    ['mixed uv types (Int16 + Float32)', 'int16', 'float32'],
  ] as const)('%s: the merged part keeps its size and place', (_, uvA, uvB) => {
    const material = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    // A 16 m-scale frame and a smaller leg, like the Racing Drone's 8× / 68× nodes.
    root.add(quantisedPart(material, new THREE.Vector3(0, 0, 0), 8, uvA));
    root.add(quantisedPart(material, new THREE.Vector3(20, -5, 3), 3, uvB));
    const before = worldBox(root);

    mergeStaticParts(root);

    const meshes = root.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
    expect(meshes).toHaveLength(1);
    expect(meshes[0].name).toMatch(/_merged$/);
    const after = worldBox(root);
    for (const k of ['x', 'y', 'z'] as const) {
      expect(after.min[k]).toBeCloseTo(before.min[k], 2);
      expect(after.max[k]).toBeCloseTo(before.max[k], 2);
    }
    // Plain floats now: nothing can clamp.
    const pos = meshes[0].geometry.getAttribute('position');
    expect(pos.array).toBeInstanceOf(Float32Array);
    expect(pos.normalized).toBe(false);
  });

  it('uv values survive the conversion', () => {
    const material = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    root.add(quantisedPart(material, new THREE.Vector3(), 1, 'int16'));
    root.add(quantisedPart(material, new THREE.Vector3(5, 0, 0), 1, 'float32'));
    mergeStaticParts(root);
    const uv = (root.children[0] as THREE.Mesh).geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-4);
      expect(uv.getX(i)).toBeLessThanOrEqual(1 + 1e-4);
    }
  });
});

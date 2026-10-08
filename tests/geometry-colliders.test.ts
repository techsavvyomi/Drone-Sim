import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildSupermarketColliders } from '../src/renderer/scene/environment/supermarketColliders';
import { collisionSources } from '../src/renderer/scene/environment/GeometryColliders';
import { collisionChunks } from '../src/renderer/scene/environment/geometryColliderChunks';

function fitted(geometry: THREE.BufferGeometry, rotation = new THREE.Euler()) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(2, 3, -4);
  mesh.rotation.copy(rotation);
  return buildSupermarketColliders(collisionSources(mesh), false);
}

describe('visible geometry collision', () => {
  it('keeps a small ring hollow instead of filling its bounding box', () => {
    const ring = new THREE.TorusGeometry(0.15, 0.04, 8, 24);
    const result = fitted(ring);
    expect(result.boxes).toHaveLength(0);
    expect(result.shell.length / 9).toBe(ring.index!.count / 3);
  });

  it('does not turn a flat panel into a thicker obstacle', () => {
    const result = fitted(new THREE.PlaneGeometry(2, 2));
    expect(result.boxes).toHaveLength(0);
    for (let i = 2; i < result.shell.length; i += 3) expect(result.shell[i]).toBe(-4);
  });

  it('uses a cuboid only for a complete box and preserves rotated dimensions', () => {
    const result = fitted(new THREE.BoxGeometry(2, 1, 0.4), new THREE.Euler(0, 0.6, 0));
    expect(result.boxes).toHaveLength(1);
    expect(result.shell).toHaveLength(0);
    result.boxes[0].pos.forEach((value, axis) => {
      expect(value).toBeCloseTo([2, 3, -4][axis], 10);
    });
    expect(result.boxes[0].half[1]).toBeCloseTo(0.5, 5);
    expect(result.boxes[0].half[0] * result.boxes[0].half[2]).toBeCloseTo(0.2, 5);
  });

  it('keeps a tilted board on its slope instead of using a world-axis box', () => {
    const result = fitted(new THREE.BoxGeometry(2, 0.05, 1), new THREE.Euler(0.4, 0, 0));
    expect(result.boxes).toHaveLength(0);
    expect(result.shell.length / 9).toBe(12);
  });

  it('does not discard or pad geometry while making spatial batches', () => {
    const result = fitted(new THREE.TorusGeometry(3, 0.2, 8, 24));
    const before: string[] = [],
      after: string[] = [];
    for (let i = 0; i < result.shell.length; i += 9)
      before.push(Array.from(result.shell.slice(i, i + 9)).join(','));
    for (const c of collisionChunks(result.shell, 1)) {
      for (let i = 0; i < c.indices.length; i += 3) {
        const triangle: number[] = [];
        for (let k = 0; k < 3; k++)
          triangle.push(...c.vertices.slice(c.indices[i + k] * 3, c.indices[i + k] * 3 + 3));
        after.push(triangle.join(','));
      }
    }
    expect(after.sort()).toEqual(before.sort());
  });
});

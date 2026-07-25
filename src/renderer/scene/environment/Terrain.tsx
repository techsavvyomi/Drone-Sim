import { useMemo } from 'react';
import * as THREE from 'three';
import { grassNormal, grassTexture } from './textures';

// Rolling terrain beyond the academy.
//
// A dead-flat horizon is one of the strongest "this is CG" signals — real
// ground undulates and the skyline is never a straight line. This is a
// displaced ring that starts OUTSIDE the flight bounds, so the play area stays
// perfectly flat and the drone can never rest on geometry that disagrees with
// the collider (which is what made it look sunk into the ground before).

const INNER = 70; // flight bounds are +/-60, so this never touches the play area
const OUTER = 300;

/** Deterministic value noise — same terrain every launch. */
function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

// Displacement is deliberately never negative. The academy sits on a flat 520m
// ground slab whose surface is y=0, so any terrain that dipped below zero would
// be buried by that slab and show a hard intersection seam where it re-emerged.
// Rising-only ground gives rolling hills that build toward the mountains.
export function terrainHeight(x: number, z: number): number {
  return (
    smoothNoise(x * 0.008, z * 0.008, 3) * 14 +
    smoothNoise(x * 0.021, z * 0.021, 7) * 5 +
    smoothNoise(x * 0.055, z * 0.055, 11) * 1.4
  );
}

export function Terrain() {
  const geometry = useMemo(() => {
    const geo = new THREE.RingGeometry(INNER, OUTER, 96, 34);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      // Ease the displacement in from the inner edge so it meets the flat
      // academy ground seamlessly instead of forming a visible step.
      const blend = Math.min(1, (r - INNER) / 45);
      pos.setY(i, terrainHeight(x, z) * blend * blend);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  const map = useMemo(() => grassTexture(), []);
  const normalMap = useMemo(() => grassNormal(), []);

  return (
    /* Lifted 2cm so the zero-displacement inner edge doesn't z-fight the ground
       slab. Safe to lift here (unlike inside the play area) because this ring
       starts at r=70, well outside the +/-60 flight bounds — nothing ever lands
       on it. */
    <mesh geometry={geometry} position={[0, 0.02, 0]} receiveShadow>
      <meshStandardMaterial
        map={map}
        normalMap={normalMap}
        normalScale={new THREE.Vector2(0.5, 0.5)}
        roughness={1}
        envMapIntensity={0.3}
      />
    </mesh>
  );
}

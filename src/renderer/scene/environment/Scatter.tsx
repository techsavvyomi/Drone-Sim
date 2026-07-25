import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// Ground clutter: rocks and shrubs across the open grass, plus weathering
// patches on the apron.
//
// Two things make a large ground plane read as fake — a perfectly uniform
// surface, and nothing small enough to give the eye a sense of scale. This adds
// both. Everything is instanced (three draw calls total) and placed from a
// deterministic hash so the layout is identical every launch.

/** Deterministic pseudo-random in [0,1) — no Math.random, so scenes reproduce. */
function rnd(i: number, salt: number): number {
  const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Keep clutter off the apron/taxiway so it never sits on painted concrete. */
function onPavement(x: number, z: number): boolean {
  const apron = Math.abs(x) < 34 && Math.abs(z) < 34;
  const taxiway = Math.abs(x) < 8 && z > -54 && z < -6;
  return apron || taxiway;
}

const ROCKS = 260;
const BUSHES = 190;
const STAINS = 26;

export function Scatter() {
  const rocks = useRef<THREE.InstancedMesh>(null);
  const bushes = useRef<THREE.InstancedMesh>(null);
  const stains = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    const place = (
      mesh: THREE.InstancedMesh | null,
      count: number,
      salt: number,
      radiusMin: number,
      radiusMax: number,
      sizeMin: number,
      sizeMax: number,
      flatten: number,
      skipPavement: boolean,
    ) => {
      if (!mesh) return;
      let n = 0;
      // Over-sample so rejected (on-pavement) picks don't thin out the field.
      for (let i = 0; i < count * 3 && n < count; i++) {
        const a = rnd(i, salt) * Math.PI * 2;
        // sqrt keeps density even instead of clustering at the centre.
        const r = radiusMin + Math.sqrt(rnd(i, salt + 1)) * (radiusMax - radiusMin);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (skipPavement && onPavement(x, z)) continue;

        const s = sizeMin + rnd(i, salt + 2) * (sizeMax - sizeMin);
        pos.set(x, s * flatten * 0.35, z);
        e.set(rnd(i, salt + 3) * 0.6, rnd(i, salt + 4) * Math.PI * 2, rnd(i, salt + 5) * 0.6);
        q.setFromEuler(e);
        scl.set(s, s * flatten, s * (0.7 + rnd(i, salt + 6) * 0.6));
        mesh.setMatrixAt(n++, m.compose(pos, q, scl));
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };

    place(rocks.current, ROCKS, 3, 12, 150, 0.14, 0.55, 0.65, true);
    place(bushes.current, BUSHES, 11, 26, 165, 0.5, 1.5, 0.75, true);

    // Weathering blotches on the apron — flat, face-up, no rotation tilt.
    const sm = stains.current;
    if (sm) {
      for (let i = 0; i < STAINS; i++) {
        const x = (rnd(i, 21) - 0.5) * 56;
        const z = (rnd(i, 22) - 0.5) * 56;
        const s = 2.5 + rnd(i, 23) * 6;
        pos.set(x, 0, z);
        q.setFromEuler(e.set(-Math.PI / 2, 0, rnd(i, 24) * Math.PI * 2));
        scl.set(s, s * (0.6 + rnd(i, 25) * 0.7), 1);
        sm.setMatrixAt(i, m.compose(pos, q, scl));
      }
      sm.instanceMatrix.needsUpdate = true;
      sm.computeBoundingSphere();
    }
  }, []);

  // Soft-edged blotch for apron weathering — a radial alpha falloff, so the
  // patches fade out instead of showing a hard disc edge.
  const stainAlpha = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);

  return (
    <group>
      <instancedMesh ref={rocks} args={[undefined, undefined, ROCKS]} castShadow receiveShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#7d7a72" roughness={0.95} flatShading />
      </instancedMesh>

      <instancedMesh ref={bushes} args={[undefined, undefined, BUSHES]} castShadow receiveShadow>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#3f6134" roughness={0.98} flatShading />
      </instancedMesh>

      {/* Sits between the apron (y=0.004) and the taxiway (y=0.008). */}
      <instancedMesh ref={stains} args={[undefined, undefined, STAINS]} position={[0, 0.006, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshStandardMaterial
          color="#14161a"
          alphaMap={stainAlpha}
          transparent
          opacity={0.4}
          depthWrite={false}
          roughness={1}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-3}
        />
      </instancedMesh>
    </group>
  );
}

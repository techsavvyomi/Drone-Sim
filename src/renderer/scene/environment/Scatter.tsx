import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { BallCollider, RigidBody } from '@react-three/rapier';

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

/** How far out a bush still gets a collider, in metres.
 *
 *  The arena's bounds are a 60 m square and the perimeter fence only stands
 *  2.4 m, so the drone can be anywhere inside that square — but the shrubs run
 *  out to 165 m, and a body for one of those is a body nothing can ever touch.
 *  A little past the corner of the box (60 * sqrt(2) = 84.9) so a bush right on
 *  the diagonal is not left hollow. */
const BUSH_REACH = 86;

/** One instance's placement, kept so the colliders can be built from the same
 *  numbers the matrices are. Working it out twice is how a collider ends up
 *  somewhere the thing it stands for is not. */
interface Spot {
  pos: [number, number, number];
  rot: [number, number, number];
  scl: [number, number, number];
}

/**
 * Where a field of clutter lands.
 *
 * Pure and deterministic, so it can be memoised in render and used BOTH to
 * write the instance matrices and to place physics bodies.
 */
function scatterSpots(
  count: number,
  salt: number,
  radiusMin: number,
  radiusMax: number,
  sizeMin: number,
  sizeMax: number,
  flatten: number,
  skipPavement: boolean,
): Spot[] {
  const out: Spot[] = [];
  // Over-sample so rejected (on-pavement) picks don't thin out the field.
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    const a = rnd(i, salt) * Math.PI * 2;
    // sqrt keeps density even instead of clustering at the centre.
    const r = radiusMin + Math.sqrt(rnd(i, salt + 1)) * (radiusMax - radiusMin);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (skipPavement && onPavement(x, z)) continue;

    const s = sizeMin + rnd(i, salt + 2) * (sizeMax - sizeMin);
    out.push({
      pos: [x, s * flatten * 0.35, z],
      rot: [rnd(i, salt + 3) * 0.6, rnd(i, salt + 4) * Math.PI * 2, rnd(i, salt + 5) * 0.6],
      scl: [s, s * flatten, s * (0.7 + rnd(i, salt + 6) * 0.6)],
    });
  }
  return out;
}

export function Scatter() {
  const rocks = useRef<THREE.InstancedMesh>(null);
  const bushes = useRef<THREE.InstancedMesh>(null);
  const stains = useRef<THREE.InstancedMesh>(null);

  const rockSpots = useMemo(() => scatterSpots(ROCKS, 3, 12, 150, 0.14, 0.55, 0.65, true), []);
  const bushSpots = useMemo(() => scatterSpots(BUSHES, 11, 26, 165, 0.5, 1.5, 0.75, true), []);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    const place = (mesh: THREE.InstancedMesh | null, spots: Spot[]) => {
      if (!mesh) return;
      spots.forEach((sp, n) => {
        pos.set(sp.pos[0], sp.pos[1], sp.pos[2]);
        q.setFromEuler(e.set(sp.rot[0], sp.rot[1], sp.rot[2]));
        scl.set(sp.scl[0], sp.scl[1], sp.scl[2]);
        mesh.setMatrixAt(n, m.compose(pos, q, scl));
      });
      mesh.count = spots.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };

    place(rocks.current, rockSpots);
    place(bushes.current, bushSpots);

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
  }, [rockSpots, bushSpots]);

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
      {/* The shrubs are SOLID; the rocks are not.
          A shrub is up to 1.5 m of standing obstacle out on the grass, at
          exactly the height a beginner drifts at, and flying through one is the
          kind of thing that makes a field read as a painted backdrop. A rock is
          ground clutter half a metre high that the eye reads as texture — put
          hard shells on 260 of them across the landing field and an ordinary
          set-down on the grass becomes a coin toss between resting flat and
          being tipped over by something nobody meant as an obstacle.

          One ball each, at 0.7 of the instance's own size. The mesh is an
          icosahedron whose faces sit at 0.79 of its radius, so this stays inside
          the leaf it is drawn as — collider standing PROUD of a visible surface
          is what a pilot feels as an invisible wall, and under-reaching is the
          error worth having. */}
      <RigidBody type="fixed" colliders={false}>
        {bushSpots
          .filter((sp) => Math.hypot(sp.pos[0], sp.pos[2]) <= BUSH_REACH)
          .map((sp, i) => (
            <BallCollider key={i} args={[sp.scl[0] * 0.7]} position={sp.pos} />
          ))}
      </RigidBody>

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

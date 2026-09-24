import { useMemo } from 'react';
import * as THREE from 'three';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { useDisposable } from '../scene/useDisposable';
import { textTexture } from './Storefront';
import { CementBag, BAG_H, BAG_W, BAG_D } from './CementBag';
import { SITE_STORE_AT, SITE_STORE_SIZE } from './siteStore';

// ----------------------------------------------------------------------------
// The site's material store: a shipping-container shop Mission 7 collects its
// cement bag from.
//
// The container, its roller shutter half up with the lit store behind it, a
// sign over the front, and a pallet of cement bags by the door — so the pad in
// front reads as the store's dispatch point rather than a bag left on the
// ground. Built in its own frame: local +z is out of the front, y up from the
// hardstanding. `siteStore.ts` places it.
//
// Primitives and two canvas textures, no lights: the sign and the store's
// interior are emissive, as the city shops are.
//
// Solid, all of it, in one fixed body: a drone that flew through the store it
// is collecting from would say the store is scenery.
// ----------------------------------------------------------------------------

const [W, H, D] = SITE_STORE_SIZE;

/** A real bag's `size`: 0.7 m across, the size a 50 kg sack is. */
const REAL_BAG = 0.54;
/** The pallet the stock stands on: by the door, to the right of the shutter. */
const PALLET = { x: 2.0, z: D / 2 + 0.9, w: 1.25, d: 1.05, h: 0.14 };

export function MaterialStore() {
  const res = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({ color: '#2f6c8a', roughness: 0.7, metalness: 0.35 }),
      trim: new THREE.MeshStandardMaterial({ color: '#1f2326', roughness: 0.6, metalness: 0.4 }),
      shutter: new THREE.MeshStandardMaterial({ color: '#9aa1a8', roughness: 0.5, metalness: 0.6 }),
      inside: new THREE.MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false }),
      pallet: new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 0.9 }),
      signTex: textTexture(['SITE MATERIAL STORE', 'CEMENT · SAND · STEEL · DRONE DISPATCH'], {
        w: 512,
        h: 128,
        bg: '#f2b705',
        fg: '#1f2326',
        size: 58,
      }),
    }),
    [],
  );
  const sign = useMemo(
    () => new THREE.MeshBasicMaterial({ map: res.signTex, toneMapped: false }),
    [res.signTex],
  );
  useDisposable(res, sign);

  /** The stock on the pallet: two bags across, three high, laid flat. */
  const bags = useMemo(() => {
    const out: [number, number, number][] = [];
    const bw = REAL_BAG * BAG_W;
    const bh = REAL_BAG * BAG_H;
    for (let layer = 0; layer < 3; layer++) {
      for (const s of [-1, 1]) {
        out.push([PALLET.x + (s * bw) / 2.05, PALLET.h + bh / 2 + layer * bh, PALLET.z]);
      }
    }
    return out;
  }, []);
  const stackTop = PALLET.h + REAL_BAG * BAG_H * 3;

  return (
    <group position={[SITE_STORE_AT[0], 0, SITE_STORE_AT[1]]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[W / 2, H / 2, D / 2]} position={[0, H / 2, 0]} />
        <CuboidCollider
          args={[
            Math.max(PALLET.w, REAL_BAG * BAG_W * 2) / 2,
            stackTop / 2,
            Math.max(PALLET.d, REAL_BAG * BAG_D) / 2,
          ]}
          position={[PALLET.x, stackTop / 2, PALLET.z]}
        />
      </RigidBody>

      {/* The container. */}
      <mesh material={res.body} position={[0, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} />
      </mesh>
      {/* Corner posts, which is what makes a box read as a container. */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            material={res.trim}
            position={[sx * (W / 2 - 0.06), H / 2, sz * (D / 2 - 0.06)]}
          >
            <boxGeometry args={[0.14, H + 0.02, 0.14]} />
          </mesh>
        )),
      )}

      {/* The door: the lit store behind, the shutter rolled half up over it. */}
      <mesh material={res.inside} position={[-0.6, 1.05, D / 2 + 0.01]}>
        <planeGeometry args={[2.4, 2.1]} />
      </mesh>
      <mesh material={res.shutter} position={[-0.6, 1.62, D / 2 + 0.03]}>
        <boxGeometry args={[2.5, 0.96, 0.05]} />
      </mesh>

      {/* The sign, across the top of the front. */}
      <mesh material={sign} position={[0, H - 0.34, D / 2 + 0.02]}>
        <planeGeometry args={[W * 0.9, 0.5]} />
      </mesh>

      {/* The pallet, and the stock on it. */}
      <mesh material={res.pallet} position={[PALLET.x, PALLET.h / 2, PALLET.z]} castShadow>
        <boxGeometry args={[PALLET.w, PALLET.h, PALLET.d]} />
      </mesh>
      {bags.map((p, i) => (
        <group key={i} position={p}>
          <CementBag size={REAL_BAG} />
        </group>
      ))}
    </group>
  );
}

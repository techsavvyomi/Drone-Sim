import { useMemo } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useDisposable } from '../scene/useDisposable';
import { CABINS, CABIN_SIZE, cabinY } from '../scene/environment/siteLayout';
import { glowTexture } from './glowTexture';

// ----------------------------------------------------------------------------
// The Construction Site after dark: three floodlight masts and a lit office.
//
// The night mission's brief is that the pilot navigates by the drone's own
// light and the site's lights, with no route drawn. At `night` the frame is a
// black shape against a black sky, and without these there is nothing on the
// site to steer by until the spotlight is already on it. Three masts, each
// washing one side of the building, leave the rest in the dark — the light is
// guidance, not daylight.
//
// Real SpotLights, and only three, WITHOUT shadows. Every light adds a cost to
// every lit fragment, and the target GPU has 512 MB; three unshadowed spots and
// the drone's own lamp is the budget, and it is the first thing to cut if the
// night mission is slow. The heads and the office windows are emissive, which
// costs nothing.
//
// Mounted inside <Physics>: the masts are solid. A 9 m pole the pilot flew
// straight through at night would say the site is scenery.
// ----------------------------------------------------------------------------

/** Mast height to the lamp head, metres. */
const MAST_H = 9;
/** Candela-ish, against `decay: 2` — about 1.7 on a face 20 m off, against
 *  night's 0.22 ambient. A judgement call, not a measurement: the first number
 *  to move after a night fly test. */
const FLOOD_INTENSITY = 700;
const FLOOD_ANGLE = 0.6;
const FLOOD_COLOR = '#ffe7c4';

/** Where each mast stands, and the point on the frame it is aimed at. Outside
 *  the frame's footprint, off every mission mark, clear of the stacks and the
 *  raft: measured against `siteLayout.ts`. */
const MASTS: readonly { at: [number, number]; aim: [number, number, number] }[] = [
  // North-east of the frame: the east face, where the inspection starts.
  { at: [30, -22], aim: [18, 7, -4] },
  // South-east: the south face and the open floors behind it.
  { at: [26, 26], aim: [8, 9, 8] },
  // North-west: the far side, so the building has a silhouette from the office.
  { at: [-28, -24], aim: [-10, 10, -8] },
];

/** The office windows, per cabin: on the west face, the side the pad is on. */
const WINDOW = { w: 0.9, h: 0.7 };

function Mast({
  at,
  aim,
  mats,
}: {
  at: [number, number];
  aim: [number, number, number];
  mats: { pole: THREE.Material; head: THREE.Material; glow: THREE.SpriteMaterial };
}) {
  // The spotlight's target has to be in the scene graph to be aimed at, so it
  // is an object of its own, placed at the aim point.
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(...aim);
    return o;
  }, [aim]);
  const yaw = Math.atan2(aim[0] - at[0], aim[2] - at[1]);

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.15, MAST_H / 2, 0.15]} position={[at[0], MAST_H / 2, at[1]]} />
        <CuboidCollider args={[0.7, 0.35, 0.7]} position={[at[0], MAST_H, at[1]]} />
      </RigidBody>
      <mesh material={mats.pole} position={[at[0], MAST_H / 2, at[1]]} castShadow>
        <boxGeometry args={[0.22, MAST_H, 0.22]} />
      </mesh>
      <group position={[at[0], MAST_H, at[1]]} rotation={[0, yaw, 0]}>
        <mesh material={mats.pole}>
          <boxGeometry args={[1.3, 0.55, 0.3]} />
        </mesh>
        {/* The lamp face, turned toward the building. */}
        <mesh material={mats.head} position={[0, 0, 0.16]} rotation={[-0.35, 0, 0]}>
          <planeGeometry args={[1.15, 0.42]} />
        </mesh>
        <sprite material={mats.glow} position={[0, 0, 0.4]} scale={3.2} />
      </group>
      <primitive object={target} />
      <spotLight
        position={[at[0], MAST_H, at[1]]}
        target={target}
        intensity={FLOOD_INTENSITY}
        angle={FLOOD_ANGLE}
        penumbra={0.7}
        decay={2}
        distance={70}
        color={FLOOD_COLOR}
      />
    </group>
  );
}

export function SiteNightLights() {
  const mats = useMemo(
    () => ({
      pole: new THREE.MeshStandardMaterial({ color: '#2d3136', roughness: 0.8, metalness: 0.4 }),
      head: new THREE.MeshBasicMaterial({ color: '#fff3dc', toneMapped: false }),
      glow: new THREE.SpriteMaterial({
        map: glowTexture(),
        color: FLOOD_COLOR,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      window: new THREE.MeshBasicMaterial({ color: '#ffcf85', toneMapped: false }),
    }),
    [],
  );
  useDisposable(mats);

  return (
    <group name="site-night-lights">
      {MASTS.map((m, i) => (
        <Mast key={i} at={m.at} aim={m.aim} mats={mats} />
      ))}
      {/* The office is occupied: two lit windows on each cabin's west face. */}
      {CABINS.map(([x, z, tier], i) =>
        [-0.8, 0.8].map((dz) => (
          <mesh
            key={`${i}${dz}`}
            material={mats.window}
            position={[x - CABIN_SIZE[0] / 2 - 0.02, cabinY(tier) + 0.25, z + dz]}
            rotation={[0, -Math.PI / 2, 0]}
          >
            <planeGeometry args={[WINDOW.w, WINDOW.h]} />
          </mesh>
        )),
      )}
    </group>
  );
}

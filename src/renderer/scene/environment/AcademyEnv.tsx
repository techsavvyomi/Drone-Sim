import { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import type { EnvironmentSpec } from '@shared/types';
import {
  asphaltNormal,
  asphaltTexture,
  concreteNormal,
  concreteTexture,
  grassNormal,
  grassTexture,
} from './textures';
import { GrassField } from './GrassField';
import { Scatter } from './Scatter';
import { Terrain } from './Terrain';
import {
  Bench,
  ChargingStation,
  ControlTower,
  EquipmentBox,
  FenceRun,
  Floodlight,
  Hangar,
  Helipad,
  HoverBox,
  LandingTarget,
  MaintenanceTent,
  Mountains,
  RaceGate,
  TrafficCone,
  Tree,
  WaypointTower,
  Windsock,
} from './props';
import { ACADEMY_GATES, ACADEMY_PADS } from '../../plugins/environments/droneAcademy';

// Outdoor drone academy: a helipad at the centre, a practice arena of gates,
// slalom cones, precision pads, hover boxes and waypoint towers, wrapped in
// facility scenery (hangar, tower, tent, fence) and distant mountains.

const DEG = Math.PI / 180;

/** Slalom cone line — offset alternately for yaw practice. */
const SLALOM = Array.from({ length: 9 }, (_, i) => {
  const z = -14 - i * 3.2;
  const x = 16 + (i % 2 === 0 ? -1.6 : 1.6);
  return [x, 0, z] as [number, number, number];
});

export function AcademyEnv({ env }: { env: EnvironmentSpec }) {
  const concrete = useMemo(() => concreteTexture(), []);
  const asphalt = useMemo(() => asphaltTexture(), []);
  const grass = useMemo(() => grassTexture(), []);
  const concreteN = useMemo(() => concreteNormal(), []);
  const asphaltN = useMemo(() => asphaltNormal(), []);
  const grassN = useMemo(() => grassNormal(), []);

  const { min, max } = env.bounds;
  const spanX = max[0] - min[0];
  const spanZ = max[2] - min[2];

  return (
    <group>
      {/* ---------- Ground: grass base, asphalt apron, painted runway ---------- */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[0, -0.06, 0]} receiveShadow>
          <boxGeometry args={[520, 0.12, 520]} />
          <meshStandardMaterial
            map={grass}
            normalMap={grassN}
            normalScale={new THREE.Vector2(0.6, 0.6)}
            roughness={1}
            envMapIntensity={0.35}
          />
        </mesh>
      </RigidBody>

      {/* Asphalt apron around the pad (visual only — the ground slab collides) */}
      {/* Stacked ground layers sit within a few MILLIMETRES of the collider
          surface (top of the ground box, y=0). polygonOffset is what stops them
          z-fighting; lifting them further would leave the drone resting below
          the surface it visually touches. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <planeGeometry args={[spanX * 0.55, spanZ * 0.55]} />
        <meshStandardMaterial
          map={asphalt}
          normalMap={asphaltN}
          normalScale={new THREE.Vector2(1, 1)}
          roughness={0.88}
          metalness={0.04}
          envMapIntensity={0.5}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

      {/* Concrete taxiway strip with painted centre line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, -30]} receiveShadow>
        <planeGeometry args={[14, 46]} />
        <meshStandardMaterial
          map={concrete}
          normalMap={concreteN}
          normalScale={new THREE.Vector2(0.8, 0.8)}
          roughness={0.9}
          envMapIntensity={0.5}
          polygonOffset
          polygonOffsetFactor={-4}
          polygonOffsetUnits={-4}
        />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, -12 - i * 3.6]}>
          <planeGeometry args={[0.34, 1.9]} />
          <meshStandardMaterial
            color="#e8e4d8"
            roughness={0.8}
            polygonOffset
            polygonOffsetFactor={-6}
            polygonOffsetUnits={-6}
          />
        </mesh>
      ))}

      {/* ---------- Main flight pad ---------- */}
      <Helipad position={[0, 0, 0]} />
      <Windsock position={[10.5, 0, 4]} />
      <EquipmentBox position={[9.2, 0, -3.4]} color="#2f6fb3" />
      <EquipmentBox position={[10.6, 0, -4.6]} color="#3a4650" size={[0.9, 0.55, 0.7]} />
      <ChargingStation position={[-9.5, 0, 3]} />

      {/* ---------- Racing gates ----------
           Positions live in `plugins/environments/droneAcademy.ts` so Flight
           School can send its lessons through the very same gates. */}
      {ACADEMY_GATES.map((g) => (
        <RaceGate
          key={g.id}
          position={g.position as [number, number, number]}
          kind={g.kind}
          color={g.color}
          size={g.size}
          rotation={g.rotation as [number, number, number] | undefined}
        />
      ))}

      {/* ---------- Slalom course ---------- */}
      {SLALOM.map((p, i) => (
        <TrafficCone key={i} position={p} />
      ))}

      {/* ---------- Precision landing pads ---------- */}
      {ACADEMY_PADS.map((p) => (
        <LandingTarget
          key={p.label}
          position={p.position as [number, number, number]}
          label={p.label}
          color={p.color}
        />
      ))}

      {/* ---------- Hover boxes ---------- */}
      <HoverBox position={[-24, 3, -14]} size={2.4} color="#38bdf8" />
      <HoverBox position={[-24, 6, -22]} size={2} color="#a855f7" />
      <HoverBox position={[22, 4.5, 8]} size={2.2} color="#22c55e" />

      {/* ---------- Waypoint towers ---------- */}
      {[
        [26, 0, -6],
        [26, 0, -18],
        [14, 0, 18],
        [-2, 0, 24],
        [-20, 0, 20],
        [-28, 0, 2],
      ].map((p, i) => (
        <WaypointTower
          key={i}
          position={p as [number, number, number]}
          height={3.5 + (i % 3)}
          index={i}
          color={i % 2 ? '#37e08a' : '#ffcf4d'}
        />
      ))}

      {/* ---------- Facility ---------- */}
      <Hangar position={[-34, 0, -14]} rotationY={12 * DEG} />
      <ControlTower position={[32, 0, 16]} />
      <MaintenanceTent position={[-30, 0, 12]} />
      <Bench position={[-6, 0, 11]} rotationY={Math.PI} />
      <Bench position={[6, 0, 11]} rotationY={Math.PI} />

      {/* Floodlights around the practice area */}
      {[
        [-22, 0, -2, 0],
        [22, 0, -2, Math.PI],
        [-12, 0, -40, 0],
        [12, 0, -40, Math.PI],
      ].map(([x, y, z, r], i) => (
        <Floodlight key={i} position={[x, y, z] as [number, number, number]} rotationY={r} />
      ))}

      {/* Perimeter fence */}
      <FenceRun from={[min[0] + 4, min[2] + 4]} to={[max[0] - 4, min[2] + 4]} />
      <FenceRun from={[max[0] - 4, min[2] + 4]} to={[max[0] - 4, max[2] - 4]} />
      <FenceRun from={[max[0] - 4, max[2] - 4]} to={[min[0] + 4, max[2] - 4]} />
      <FenceRun from={[min[0] + 4, max[2] - 4]} to={[min[0] + 4, min[2] + 4]} />

      {/* Tree line just outside the fence */}
      {Array.from({ length: 34 }, (_, i) => {
        const a = (i / 34) * Math.PI * 2;
        const r = 72 + ((i * 17) % 22);
        return (
          <Tree
            key={i}
            position={[Math.cos(a) * r, 0, Math.sin(a) * r]}
            scale={0.85 + ((i * 13) % 7) / 12}
            variant={i}
          />
        );
      })}

      <Terrain />
      <GrassField />
      <Scatter />

      <Mountains />
    </group>
  );
}

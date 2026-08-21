import { CuboidCollider, RigidBody } from '@react-three/rapier';
import type { EnvironmentSpec } from '@shared/types';

// Procedural indoor arena built from the environment spec's bounds: a light
// floor and four low boundary walls. Deliberately uncluttered for Phase 1 —
// obstacles arrive in Phase 3 with the real collision/scoring system.

const WALL_H = 2.5;
const WALL_T = 0.2;

// Visual-only flight gates to aim at while learning.
const GATES: { pos: [number, number, number]; rot: number }[] = [
  { pos: [6, 1.4, -4], rot: 0 },
  { pos: [-6, 1.6, 3], rot: Math.PI / 2 },
  { pos: [0, 2.0, -9], rot: 0 },
];

export function ArenaEnv({ env }: { env: EnvironmentSpec }) {
  const { min, max } = env.bounds;
  const sizeX = max[0] - min[0];
  const sizeZ = max[2] - min[2];
  const cx = (max[0] + min[0]) / 2;
  const cz = (max[2] + min[2]) / 2;
  /** Walls collide up to the ceiling, however low the visible panel is drawn. */
  const wallColliderH = max[1];

  return (
    <group>
      {/* Floor */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[cx, -0.05, cz]} receiveShadow>
          <boxGeometry args={[sizeX, 0.1, sizeZ]} />
          <meshStandardMaterial color="#8d99ab" roughness={0.95} />
        </mesh>
      </RigidBody>

      {/* Boundary walls. The visible mesh stays low and translucent so it never
          hides the drone, but the COLLIDER runs the full height of the ceiling —
          the same "solid all the way up" treatment the forest trunks get.

          They used to be one and the same at WALL_H, which left everything above
          2.5 m unwalled while the ceiling sits at bounds.max[1]. Up there the only
          containment was the positional hard-rescue clamp in `Drone.tsx`, and that
          grades a hit at WALL_CRASH_SPEED (3.2 m/s) instead of the collider path's
          MINOR_IMPACT (1.8) — so a fast angled hit slid along an invisible boundary
          and never registered as a crash. Classroom 2 already sized its walls off
          the ceiling; these two hard-coded 2.5. */}
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[cx, WALL_H / 2, min[2]]} receiveShadow>
          <boxGeometry args={[sizeX, WALL_H, WALL_T]} />
          <meshStandardMaterial color="#b9c6d8" transparent opacity={0.35} />
        </mesh>
        <mesh position={[cx, WALL_H / 2, max[2]]} receiveShadow>
          <boxGeometry args={[sizeX, WALL_H, WALL_T]} />
          <meshStandardMaterial color="#b9c6d8" transparent opacity={0.35} />
        </mesh>
        <mesh position={[min[0], WALL_H / 2, cz]} receiveShadow>
          <boxGeometry args={[WALL_T, WALL_H, sizeZ]} />
          <meshStandardMaterial color="#b9c6d8" transparent opacity={0.35} />
        </mesh>
        <mesh position={[max[0], WALL_H / 2, cz]} receiveShadow>
          <boxGeometry args={[WALL_T, WALL_H, sizeZ]} />
          <meshStandardMaterial color="#b9c6d8" transparent opacity={0.35} />
        </mesh>

        <CuboidCollider
          args={[sizeX / 2, wallColliderH / 2, WALL_T / 2]}
          position={[cx, wallColliderH / 2, min[2]]}
          friction={0.05}
          restitution={0}
        />
        <CuboidCollider
          args={[sizeX / 2, wallColliderH / 2, WALL_T / 2]}
          position={[cx, wallColliderH / 2, max[2]]}
          friction={0.05}
          restitution={0}
        />
        <CuboidCollider
          args={[WALL_T / 2, wallColliderH / 2, sizeZ / 2]}
          position={[min[0], wallColliderH / 2, cz]}
          friction={0.05}
          restitution={0}
        />
        <CuboidCollider
          args={[WALL_T / 2, wallColliderH / 2, sizeZ / 2]}
          position={[max[0], wallColliderH / 2, cz]}
          friction={0.05}
          restitution={0}
        />
      </RigidBody>

      {/* Landing pad at spawn */}
      <mesh position={[env.spawn.position[0], 0.012, env.spawn.position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.6, 32]} />
        <meshStandardMaterial color="#3d4a5e" />
      </mesh>

      {/* Reference gates (visual only for now) */}
      {GATES.map((g, i) => (
        <mesh key={i} position={g.pos} rotation={[0, g.rot, 0]}>
          <torusGeometry args={[0.7, 0.06, 12, 32]} />
          <meshStandardMaterial color="#ff8a3d" emissive="#c2481a" emissiveIntensity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

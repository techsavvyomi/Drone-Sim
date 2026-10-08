import { CuboidCollider, RigidBody } from '@react-three/rapier';
import type { EnvironmentSpec } from '@shared/types';

// Procedural indoor arena built from the environment spec's bounds: a light
// floor and four low boundary walls. Deliberately uncluttered for Phase 1 —
// obstacles arrive in Phase 3 with the real collision/scoring system.

const WALL_H = 2.5;
const WALL_T = 0.2;

// Solid ring frames with open centres for practice.
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
  /** Only the visible wall is solid; the world limit is separate. */
  const wallColliderH = WALL_H;

  return (
    <group>
      {/* Floor */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[cx, -0.05, cz]} receiveShadow>
          <boxGeometry args={[sizeX, 0.1, sizeZ]} />
          <meshStandardMaterial color="#8d99ab" roughness={0.95} />
        </mesh>
      </RigidBody>

      {/* Boundary collision matches the visible wall height. */}
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

      {/* The helipad at spawn is painted by the Fly view — `Helipad` in
          missions/LaunchPad.tsx, the same pad every free flight gets. */}

      {/* Collision uses the same torus mesh, preserving the opening. */}
      {GATES.map((g, i) => (
        <RigidBody
          key={i}
          type="fixed"
          colliders="trimesh"
          position={g.pos}
          rotation={[0, g.rot, 0]}
          restitution={0}
        >
          <mesh>
            <torusGeometry args={[0.7, 0.06, 12, 32]} />
            <meshStandardMaterial color="#ff8a3d" emissive="#c2481a" emissiveIntensity={0.4} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
}

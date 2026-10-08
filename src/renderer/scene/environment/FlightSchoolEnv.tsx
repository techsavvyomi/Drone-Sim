import { CuboidCollider, RigidBody } from '@react-three/rapier';
import type { EnvironmentSpec } from '@shared/types';

// Procedural training ground: a flat floor, four low translucent boundary walls
// and a helipad at spawn (painted by the Fly view). Kept clean so lesson props read clearly on
// top of it. The reference grid comes from FlightScene's indoor Grid.

const WALL_H = 2.5;
const WALL_T = 0.2;

export function FlightSchoolEnv({ env }: { env: EnvironmentSpec }) {
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
          <meshStandardMaterial color="#9aa6b8" roughness={0.95} />
        </mesh>
      </RigidBody>

      {/* Boundary collision matches the visible wall height. */}
      <RigidBody type="fixed" colliders={false}>
        <mesh position={[cx, WALL_H / 2, min[2]]} receiveShadow>
          <boxGeometry args={[sizeX, WALL_H, WALL_T]} />
          <meshStandardMaterial color="#b9c6d8" transparent opacity={0.28} />
        </mesh>
        <mesh position={[cx, WALL_H / 2, max[2]]} receiveShadow>
          <boxGeometry args={[sizeX, WALL_H, WALL_T]} />
          <meshStandardMaterial color="#b9c6d8" transparent opacity={0.28} />
        </mesh>
        <mesh position={[min[0], WALL_H / 2, cz]} receiveShadow>
          <boxGeometry args={[WALL_T, WALL_H, sizeZ]} />
          <meshStandardMaterial color="#b9c6d8" transparent opacity={0.28} />
        </mesh>
        <mesh position={[max[0], WALL_H / 2, cz]} receiveShadow>
          <boxGeometry args={[WALL_T, WALL_H, sizeZ]} />
          <meshStandardMaterial color="#b9c6d8" transparent opacity={0.28} />
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
    </group>
  );
}

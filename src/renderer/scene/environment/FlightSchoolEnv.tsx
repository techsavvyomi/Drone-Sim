import { RigidBody } from '@react-three/rapier';
import type { EnvironmentSpec } from '@shared/types';
import { FLIGHT_SCHOOL_PAD } from '../../plugins/environments/flightSchool';

// Procedural training ground: a flat floor, four low translucent boundary walls
// and a marked landing pad at spawn. Kept clean so lesson props read clearly on
// top of it. The reference grid comes from FlightScene's indoor Grid.

const WALL_H = 2.5;
const WALL_T = 0.2;

export function FlightSchoolEnv({ env }: { env: EnvironmentSpec }) {
  const { min, max } = env.bounds;
  const sizeX = max[0] - min[0];
  const sizeZ = max[2] - min[2];
  const cx = (max[0] + min[0]) / 2;
  const cz = (max[2] + min[2]) / 2;

  const [px, pz] = FLIGHT_SCHOOL_PAD.center;
  const r = FLIGHT_SCHOOL_PAD.radius;

  return (
    <group>
      {/* Floor */}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh position={[cx, -0.05, cz]} receiveShadow>
          <boxGeometry args={[sizeX, 0.1, sizeZ]} />
          <meshStandardMaterial color="#9aa6b8" roughness={0.95} />
        </mesh>
      </RigidBody>

      {/* Boundary walls — low and translucent so they never hide the drone */}
      <RigidBody type="fixed" colliders="cuboid">
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
      </RigidBody>

      {/* Landing pad at spawn: filled disc + bright outer ring + centre cross. */}
      <group position={[px, 0, pz]}>
        <mesh position={[0, 0.011, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[r, 48]} />
          <meshStandardMaterial color="#2c3a4f" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.013, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r * 0.92, r, 48]} />
          <meshStandardMaterial color="#34d399" emissive="#0f9d63" emissiveIntensity={0.5} />
        </mesh>
        <mesh position={[0, 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r * 0.28, r * 0.34, 32]} />
          <meshStandardMaterial color="#34d399" emissive="#0f9d63" emissiveIntensity={0.4} />
        </mesh>
      </group>
    </group>
  );
}

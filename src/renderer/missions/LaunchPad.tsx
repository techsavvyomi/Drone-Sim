import { useMemo } from 'react';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import { getEnvironment } from '../plugins/registry';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// The helipad the drone takes off from: a dark disc with a white ring and a
// white "H", painted on the ground under the mission's spawn point.
//
// The spawn used to be a bare patch of road with the aircraft standing on it,
// which does not say "this is where you launch". A helipad does, and it gives
// the pilot a fixed reference to leave from and look back at.
//
// Paint, not a structure: no collider and nothing proud of the surface. The
// drone spawns a couple of centimetres above the ground, so anything with height
// would put the skids inside it.
//
// Sized under the Guru, which spans 1.44 m at mission scale, and small enough to
// stay on New York's sidewalk plate. It sits on `spawnGround` where the
// environment declares one — New York's spawn is on the sidewalk, 12 cm above
// the road plane — and on the mission's ground otherwise.
//
// Free flight paints the same pad under the map's own spawn (`Helipad`, mounted
// by the Fly view), so every map launches from an H, not only the missions.
// ----------------------------------------------------------------------------

/** Radius of the painted disc, metres. */
const R = 1.15;
/** Height the paint sits above the ground, metres. Enough to clear the road's
 *  own surface, with polygon offset doing the rest. */
const LIFT = 0.012;

export function LaunchPad({ mission }: { mission: Mission }) {
  const env = getEnvironment(mission.envId);
  if (!env) return null;
  // The mission's own launch point where it has one — Mission 8's site office.
  return <Helipad env={env} spawn={mission.spawn} ground={mission.groundY} />;
}

/** The painted helipad under a spawn: the map's own unless `spawn` is given,
 *  on `spawnGround`, else `ground`, else the map's `groundY`, else 0. `scale`
 *  shrinks the whole pad; missions keep 1, since their landing is judged on
 *  `HELIPAD_LAND_RADIUS`, which is sized to this pad. */
export function Helipad({
  env,
  spawn = env.spawn,
  ground,
  scale = 1,
}: {
  env: EnvironmentSpec;
  spawn?: EnvironmentSpec['spawn'];
  ground?: number;
  scale?: number;
}) {
  const paint = useMemo(
    () => ({
      disc: new THREE.MeshStandardMaterial({
        color: '#2b2f33',
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
      mark: new THREE.MeshStandardMaterial({
        color: '#f4f4f0',
        emissive: '#f4f4f0',
        emissiveIntensity: 0.15,
        roughness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor: -8,
        polygonOffsetUnits: -8,
      }),
    }),
    [],
  );

  const [x, , z] = spawn.position;
  const heading = (spawn.heading * Math.PI) / 180;
  const y = env.spawnGround ?? ground ?? env.groundY ?? 0;

  return (
    <group position={[x, y + LIFT, z]} rotation={[0, heading, 0]}>
      <group rotation={[-Math.PI / 2, 0, 0]} scale={[scale, scale, 1]}>
        <mesh material={paint.disc} receiveShadow>
          <circleGeometry args={[R, 40]} />
        </mesh>
        <mesh material={paint.mark} position={[0, 0, 0.001]} receiveShadow>
          <ringGeometry args={[R * 0.84, R * 0.93, 40]} />
        </mesh>
        {/* The H: two uprights and the crossbar, reading along the heading. */}
        {[-1, 1].map((s) => (
          <mesh key={s} material={paint.mark} position={[s * 0.3, 0, 0.001]} receiveShadow>
            <planeGeometry args={[0.15, 0.95]} />
          </mesh>
        ))}
        <mesh material={paint.mark} position={[0, 0, 0.001]} receiveShadow>
          <planeGeometry args={[0.6, 0.15]} />
        </mesh>
      </group>
    </group>
  );
}

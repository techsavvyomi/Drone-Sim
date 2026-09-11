import { useEffect } from 'react';
import { useRapier } from '@react-three/rapier';
import type * as THREE from 'three';

// Lets the chase camera ask the physics world whether a building is in the way.
//
// `CameraRig` is mounted OUTSIDE `<Physics>` on purpose — `DroneAudio` has to run
// its frame after the camera's, and moving the rig inside would change that
// order. So this probe sits inside `<Physics>`, where `useRapier` works, and
// publishes the world to module scope for the rig to cast against.
//
// Only fixed and kinematic colliders count. The drone, its broken props and a
// carried package are dynamic bodies, and a mission zone is a sensor: none of
// them is a wall the camera should hide from.

type RapierCtx = ReturnType<typeof useRapier>;

const probe: {
  world: RapierCtx['world'] | null;
  rapier: RapierCtx['rapier'] | null;
  ray: InstanceType<RapierCtx['rapier']['Ray']> | null;
} = { world: null, rapier: null, ray: null };

export function CameraProbe() {
  const { world, rapier } = useRapier();
  useEffect(() => {
    probe.world = world;
    probe.rapier = rapier;
    probe.ray = null;
    return () => {
      if (probe.world === world) {
        probe.world = null;
        probe.rapier = null;
        probe.ray = null;
      }
    };
  }, [world, rapier]);
  return null;
}

/**
 * Distance from `from` to the first solid, static surface on the straight line
 * to `to`, or `Infinity` when the line is clear (or there is no world yet).
 * Allocation-free: the ray is created once and reused.
 */
export function staticHitDistance(from: THREE.Vector3, to: THREE.Vector3): number {
  const { world, rapier } = probe;
  if (!world || !rapier) return Infinity;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-3) return Infinity;
  if (!probe.ray) probe.ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  const r = probe.ray;
  r.origin.x = from.x;
  r.origin.y = from.y;
  r.origin.z = from.z;
  r.dir.x = dx / len;
  r.dir.y = dy / len;
  r.dir.z = dz / len;
  const hit = world.castRay(
    r,
    len,
    true,
    rapier.QueryFilterFlags.EXCLUDE_DYNAMIC | rapier.QueryFilterFlags.EXCLUDE_SENSORS,
  );
  return hit ? hit.timeOfImpact : Infinity;
}

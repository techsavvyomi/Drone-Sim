import { useMemo } from 'react';
import { CylinderCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { useFlightStore } from '../state/flightStore';
import { dronePose } from '../sim/drone/pose';
import { propHubs } from '../sim/drone/propHubs';

// A propeller that snapped off in a crash, as a loose physics object.
//
// Spawned at the hub it broke from, in the drone's orientation at that instant,
// with an outward-and-up impulse so it tumbles clear and settles on the ground
// rather than vanishing.

export function PropDebris({ spec }: { spec: DroneSpec }) {
  const propR = (spec.propDiameterIn * 25.4) / 2000;
  const crashed = useFlightStore((s) => s.crashed);
  const broken = useFlightStore((s) => s.brokenProps);

  // Freeze the spawn transform at the moment of the crash; recomputing it every
  // frame would drag the debris along with the drone.
  const spawns = useMemo(() => {
    if (!crashed || broken.length === 0 || !propHubs.ready || !propHubs.template) return [];
    const v = new THREE.Vector3();
    return broken.map((motor) => {
      const hub = propHubs.positions[motor] ?? new THREE.Vector3();
      v.copy(hub).applyQuaternion(dronePose.quaternion).add(dronePose.position);
      // Fling it away from the airframe centre, with some lift.
      const outward = new THREE.Vector3(hub.x, 0, hub.z)
        .applyQuaternion(dronePose.quaternion)
        .normalize()
        .multiplyScalar(0.045);
      // Each debris instance needs its own copy — the same Object3D cannot be
      // in the scene graph twice.
      const prop = propHubs.template?.clone(true) ?? null;
      return {
        motor,
        prop,
        position: [v.x, Math.max(v.y, 0.03), v.z] as [number, number, number],
        impulse: { x: outward.x, y: 0.03, z: outward.z },
        spin: { x: outward.z * 0.4, y: 0.02, z: -outward.x * 0.4 },
      };
    });
  }, [crashed, broken]);

  if (spawns.length === 0) return null;

  return (
    <>
      {spawns.flatMap((s) => (s.prop ? [{ ...s, prop: s.prop }] : [])).map((s) => (
        <RigidBody
          key={s.motor}
          colliders={false}
          position={s.position}
          linearDamping={0.4}
          angularDamping={0.35}
          restitution={0.25}
          friction={0.7}
          onContactForce={() => {}}
          ref={(rb) => {
            if (!rb) return;
            rb.applyImpulse(s.impulse, true);
            rb.applyTorqueImpulse(s.spin, true);
          }}
        >
          {/* Explicit collider: the model's geometry is quantized (Int16 via
              KHR_mesh_quantization) and Rapier's convex hull needs Float32, so
              colliders="hull" throws. A thin disc matches a prop anyway. */}
          <CylinderCollider args={[0.0015, propR]} />
          {/* The real PlutoX propeller, cloned from the loaded model. */}
          <primitive object={s.prop} />
        </RigidBody>
      ))}
    </>
  );
}

import { CuboidCollider, RigidBody } from '@react-three/rapier';

/**
 * Physics colliders for the New York City environment.
 *
 * Building block boxes have been intentionally removed — their estimated
 * positions cannot reliably match the Draco-compressed GLB geometry without
 * running a full mesh intersection test, and any mismatch creates invisible
 * barriers in the middle of streets (worse than no collider at all).
 *
 * What remains:
 *   1. Ground plane  — drone can land and taxi anywhere on the street grid.
 *   2. Four outer perimeter walls — prevent escaping into the void beyond
 *      the visible city boundary (X = ±123.84 m, Z = ±98.11 m).
 *
 * Building interiors are visually opaque but physically passable.
 * This is standard practice in drone simulators where free-roam flight
 * matters more than interior collision fidelity.
 */

export function NewYorkColliders() {
  return (
    <RigidBody type="fixed" colliders={false} name="new-york-physics-colliders">
      {/* Ground plane — top face exactly at Y = 0, spans the full street grid */}
      <CuboidCollider args={[130, 0.5, 105]} position={[0, -0.5, 0]} />

      {/*
       * Outer perimeter walls — at the true visual city boundary.
       * Only activate when the drone tries to fly completely off the map.
       * Height 120 m covers any reasonable flight altitude.
       */}
      {/* North wall  */}
      <CuboidCollider args={[130, 60, 0.5]} position={[  0.00, 60, -99.61]} friction={0.02} restitution={0.05} />
      {/* South wall  */}
      <CuboidCollider args={[130, 60, 0.5]} position={[  0.00, 60,  99.61]} friction={0.02} restitution={0.05} />
      {/* West wall   */}
      <CuboidCollider args={[0.5, 60, 105]} position={[-125.34, 60,   0.0]} friction={0.02} restitution={0.05} />
      {/* East wall   */}
      <CuboidCollider args={[0.5, 60, 105]} position={[ 125.34, 60,   0.0]} friction={0.02} restitution={0.05} />
    </RigidBody>
  );
}

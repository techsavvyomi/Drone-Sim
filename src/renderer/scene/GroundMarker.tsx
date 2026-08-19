import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { dronePose } from '../sim/drone/pose';
import { useSimStore } from '../state/simStore';

// A ring on the floor directly beneath the drone plus a vertical tether line.
// Makes a small drone easy to locate and gives an instant read on altitude.

/** Ray length used by the support probe; anything at or past it found nothing. */
const PROBE_MAX = 2.0;
/** How far below the drone to draw the ring when the ground is out of probe range. */
const FALLBACK_DROP = 1.5;

export function GroundMarker() {
  const ring = useRef<THREE.Mesh>(null);
  const line = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!dronePose.present) return;
    const { x, y, z } = dronePose.position;

    // Height above the surface actually under the drone, not above y = 0.
    //
    // This used to pin the ring to y = 0.015 and measure altitude from there,
    // which is only right on a map whose ground is a flat plane at zero. On the
    // Forest the terrain falls to −77 m, so the ring hung in mid-air beside the
    // drone and the tether line had nothing to reach down to.
    //
    // The drone's four-corner support probe already measures this every physics
    // step, so reuse it rather than casting again. It only reaches 2 m; past
    // that we know the ground is "far" but not how far, which is enough — the
    // marker exists to locate the drone, and at that height the ring is a hint
    // rather than a measurement.
    const d = useSimStore.getState().support.distances;
    const nearest = Math.min(d[0], d[1], d[2], d[3]);
    const grounded = nearest < PROBE_MAX;
    const agl = grounded ? nearest : FALLBACK_DROP;
    const surfaceY = y - agl;
    const airborne = agl > 0.06;

    if (ring.current) {
      ring.current.visible = airborne;
      ring.current.position.set(x, surfaceY + 0.015, z);
      // Ring grows slightly with altitude so it stays readable from above.
      const s = 1 + Math.min(agl, 8) * 0.12;
      ring.current.scale.setScalar(s);
    }
    if (line.current) {
      line.current.visible = airborne;
      const h = Math.max(agl, 0.001);
      line.current.position.set(x, surfaceY + h / 2, z);
      line.current.scale.set(1, h, 1);
    }
  });

  return (
    <group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.22, 0.28, 32]} />
        <meshBasicMaterial color="#4ea1ff" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {/* Unit-height cylinder scaled to the drone's height above the surface */}
      <mesh ref={line}>
        <cylinderGeometry args={[0.006, 0.006, 1, 6]} />
        <meshBasicMaterial color="#4ea1ff" transparent opacity={0.22} depthWrite={false} />
      </mesh>
    </group>
  );
}

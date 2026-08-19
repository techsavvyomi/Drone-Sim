import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { dronePose } from '../sim/drone/pose';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { cloudTexture } from './environment/textures';

// Rotor wash: dust stirred up when the drone hovers close to the ground.
//
// Downwash only reaches the surface within roughly a rotor-span of it, so the
// effect fades out with altitude — which also makes it a useful visual cue for
// how close you are during landing.

const COUNT = 14;
const MAX_ALT = 1.2;

export function RotorWash() {
  const tex = useMemo(() => cloudTexture(), []);
  const group = useRef<THREE.Group>(null);
  const mats = useRef<(THREE.SpriteMaterial | null)[]>([]);

  // Deterministic per-puff phase so the ring doesn't pulse in unison.
  const puffs = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        angle: (i / COUNT) * Math.PI * 2,
        speed: 0.5 + ((i * 13) % 7) / 9,
        phase: ((i * 29) % 11) / 11,
      })),
    [],
  );

  useFrame((s) => {
    if (!group.current || !dronePose.present) return;

    // Height above the surface actually beneath the drone, not above y = 0.
    // `altitude` is world Y, which on a terrain map says nothing about how close
    // the ground is — the Forest floor is tens of metres below the clearing, so
    // dust kicked up on a plain reading would either never appear or appear in
    // mid-air. The four-corner support probe already measures this each physics
    // step; past its 2 m reach the drone is too high for wash anyway.
    const sim = useSimStore.getState();
    const { throttle } = sim;
    const d = sim.support.distances;
    const altitude = Math.min(d[0], d[1], d[2], d[3]);
    const status = useFlightStore.getState().status();
    const live = status === 'armed' || status === 'flying';

    // Strength falls off with height and scales with how hard the motors work.
    const proximity = Math.max(0, 1 - altitude / MAX_ALT);
    const strength = live ? proximity * proximity * Math.min(1, throttle * 1.6) : 0;

    group.current.visible = strength > 0.04;
    if (!group.current.visible) return;

    // Sit the dust on the surface below, not on an assumed floor at zero.
    group.current.position.set(
      dronePose.position.x,
      dronePose.position.y - altitude + 0.05,
      dronePose.position.z,
    );

    const t = s.clock.elapsedTime;
    group.current.children.forEach((child, i) => {
      const p = puffs[i];
      // Puffs drift outward and fade as they go, then loop.
      const cycle = (t * p.speed + p.phase) % 1;
      const radius = 0.2 + cycle * 1.1;
      child.position.set(
        Math.cos(p.angle) * radius,
        cycle * 0.14,
        Math.sin(p.angle) * radius,
      );
      const scale = 0.22 + cycle * 0.5;
      child.scale.set(scale, scale, 1);
      const m = mats.current[i];
      if (m) m.opacity = strength * 0.14 * (1 - cycle);
    });
  });

  return (
    <group ref={group} visible={false}>
      {puffs.map((_, i) => (
        <sprite key={i}>
          <spriteMaterial
            ref={(el) => {
              mats.current[i] = el;
            }}
            map={tex}
            color="#c9bda4"
            transparent
            opacity={0}
            depthWrite={false}
            fog
          />
        </sprite>
      ))}
    </group>
  );
}

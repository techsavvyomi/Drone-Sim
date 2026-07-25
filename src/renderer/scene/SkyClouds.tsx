import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cloudTexture } from './environment/textures';

// Drifting cloud billboards built from a locally-generated sprite.
// Deliberately not drei's <Cloud>: that one downloads its texture from a CDN,
// which fails under our CSP and takes the whole Canvas down with it.

interface Puff {
  pos: [number, number, number];
  scale: number;
  speed: number;
  opacity: number;
}

export function SkyClouds({ count = 14, tint = '#ffffff' }: { count?: number; tint?: string }) {
  const tex = useMemo(() => cloudTexture(), []);
  const group = useRef<THREE.Group>(null);

  // Deterministic layout so the sky looks the same every launch.
  const puffs = useMemo<Puff[]>(
    () =>
      Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + (i % 3) * 0.4;
        const r = 130 + ((i * 37) % 90);
        return {
          pos: [Math.cos(a) * r, 55 + ((i * 23) % 34), Math.sin(a) * r],
          scale: 55 + ((i * 29) % 45),
          speed: 0.35 + ((i * 13) % 10) / 22,
          opacity: 0.3 + ((i * 7) % 5) / 16,
        };
      }),
    [count],
  );

  useFrame((_s, dt) => {
    if (!group.current) return;
    for (const child of group.current.children) {
      child.position.x += (child.userData.speed ?? 0.4) * dt;
      // Wrap around so the drift never runs out.
      if (child.position.x > 240) child.position.x = -240;
    }
  });

  return (
    <group ref={group}>
      {puffs.map((p, i) => (
        <sprite
          key={i}
          position={p.pos}
          scale={[p.scale, p.scale * 0.58, 1]}
          userData={{ speed: p.speed }}
        >
          <spriteMaterial
            map={tex}
            color={tint}
            transparent
            opacity={p.opacity}
            depthWrite={false}
            fog={false}
          />
        </sprite>
      ))}
    </group>
  );
}

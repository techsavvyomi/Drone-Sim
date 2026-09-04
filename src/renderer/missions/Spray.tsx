import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import { useMissionStore } from '../state/missionStore';

// ----------------------------------------------------------------------------
// The suppressant, on its way down.
//
// A short cone of falling droplets under the airframe, on only while the tank is
// actually open. That last part is the point of it: the brief never asks the
// pilot to press a button, so the plume IS the feedback that the position is
// good — it starts the instant the hover is right and stops the instant it is
// not, which is faster and more legible than any HUD line saying the same thing.
//
// The same billboard trick as the fire: quads sharing one small canvas texture,
// no particle library, no allocation in the frame loop. It hangs off
// `dronePose` rather than being parented to the drone, for the same reason the
// package is welded to that transform — there is exactly one authority on where
// the aircraft is.
// ----------------------------------------------------------------------------

/** Droplets in the plume. Enough to read as a spray at ten metres, few enough to
 *  cost nothing on an integrated GPU. */
const DROPS = 22;
/** How far a droplet falls before it is recycled, metres, and how long it takes.
 *  The reach is deliberately longer than the hover band's ceiling, so the plume
 *  visibly meets the fire rather than stopping in the air above it. */
const REACH = 16;
const LIFE = 0.75;
/** How wide the cone gets at the bottom, metres. */
const SPREAD = 2.6;

/** Pale water-blue, additive: it brightens the smoke it falls through rather
 *  than painting a blue hole in it. */
const DROP_COLOR = '#bfe9ff';

let dropTex: THREE.CanvasTexture | null = null;
function dropletTexture(): THREE.CanvasTexture {
  if (dropTex) return dropTex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  }
  dropTex = new THREE.CanvasTexture(canvas);
  return dropTex;
}

/** One droplet's own start and direction, fixed for the life of the component so
 *  the plume has a shape rather than a shimmer. */
interface Drop {
  phase: number;
  angle: number;
  spread: number;
  size: number;
}

export function Spray() {
  const suppressing = useMissionStore((s) => s.suppressing);
  const group = useRef<THREE.Group>(null);
  const tex = useMemo(() => dropletTexture(), []);
  /** Fades the plume in and out rather than switching it, so a hover that dips
   *  in and out of the band for a frame does not strobe. */
  const on = useRef(0);

  const drops = useMemo<Drop[]>(() => {
    let s = 20260904;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    return Array.from({ length: DROPS }, (_, i) => ({
      phase: i / DROPS + rnd() * 0.03,
      angle: rnd() * Math.PI * 2,
      spread: 0.35 + rnd() * 0.65,
      size: 0.22 + rnd() * 0.26,
    }));
  }, []);

  useFrame(({ clock, camera }, rawDt) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.1);
    on.current += ((suppressing ? 1 : 0) - on.current) * Math.min(1, dt * 8);
    g.visible = on.current > 0.02 && dronePose.present;
    if (!g.visible) return;

    // Under the airframe, but NOT rotated with it: falling water does not bank.
    g.position.copy(dronePose.position);

    const t = clock.elapsedTime;
    const face = camera.quaternion;
    g.children.forEach((child, i) => {
      const d = drops[i];
      const age = (((t / LIFE + d.phase) % 1) + 1) % 1;
      const mesh = child as THREE.Mesh;
      // Accelerating downward — age squared — which is what makes it read as
      // falling rather than as a static cone drawn under the drone.
      const fall = age * age * REACH;
      const wide = age * SPREAD * d.spread;
      mesh.position.set(Math.cos(d.angle) * wide, -0.25 - fall, Math.sin(d.angle) * wide);
      const s = d.size * (1 + age * 1.6);
      mesh.scale.set(s, s * (1 + age), s);
      mesh.quaternion.copy(face);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = on.current * (1 - age * age) * 0.7;
    });
  });

  return (
    <group ref={group} visible={false}>
      {drops.map((_drop, i) => (
        <mesh key={i}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={tex}
            color={DROP_COLOR}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

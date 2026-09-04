import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useMissionStore } from '../state/missionStore';
import { zoneGroundY, type Mission } from './types';

// ----------------------------------------------------------------------------
// The fire, and what is left of it.
//
// Drawn as BILLBOARDS, not as a particle system and not as a shader. Two dozen
// camera-facing quads sharing one 64 px canvas texture is the whole thing: no
// texture upload beyond that one canvas, no per-frame allocation, no second
// render target. This map is the heaviest in the app on a 512 MB integrated GPU
// — the forest is 341k triangles before anything of the mission is added — so
// the fire had to cost what a decal costs.
//
// Everything reads ONE number: `fireIntensity`, 1 down to 0, published by
// `MissionDirector`. The flames shrink with it, the smoke thins with it, the
// light dims with it, and at zero what is left is a scorched circle on the
// forest floor. There is no separate "contained" state to get out of step —
// contained IS intensity zero.
//
// The whole thing sits at the FIRE's own ground height, which on this map is
// twelve and a half metres below the clearing the pilot took off from. See
// `zoneGroundY`.
// ----------------------------------------------------------------------------

/** The hot core of a flame, and its cooler top. Additive, so these are
 *  intensities rather than colours: what the pilot sees is the sum of the quads
 *  they are looking through, which is what gives a flame its dense middle. */
const FLAME_HOT = '#ffb43a';
const FLAME_EDGE = '#ff4a1a';
/** Smoke is the one thing here that is NOT additive. Smoke hides what is behind
 *  it — that is the whole of what smoke is — and an additive grey would brighten
 *  the canopy behind the column instead of blotting it out. */
const SMOKE = '#4a4239';

/** How many quads in each layer. Small numbers, and they are the budget: every
 *  one of these is a draw the forest is already paying 27 meshes for. */
const FLAMES = 16;
const SMOKES = 10;

/** Seconds a flame takes to rise and loop, and how far it gets. */
const FLAME_LIFE = 1.15;
const FLAME_RISE = 4.2;
/** The same for a smoke puff, which is slower and goes much higher — the column
 *  is what makes the fire findable from the far side of the forest. */
const SMOKE_LIFE = 5.5;
const SMOKE_RISE = 26;

/**
 * One soft round blob, as a canvas texture.
 *
 * Shared by every quad in every fire. It is built once and never disposed: there
 * is one fire in the app and it lives as long as the mission does.
 */
let blobTex: THREE.CanvasTexture | null = null;
function blob(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  blobTex = new THREE.CanvasTexture(canvas);
  return blobTex;
}

/** One quad's own rhythm, so sixteen of them do not pulse as one object. */
interface Puff {
  /** Where in its own life it starts, 0..1. */
  phase: number;
  /** Metres off centre, and which way. */
  radius: number;
  angle: number;
  /** How big it gets, as a multiple of the layer's base size. */
  scale: number;
  /** Sideways drift over its life, metres. */
  drift: number;
}

function puffs(n: number, spread: number, seed: number): Puff[] {
  // Deterministic rather than Math.random: the fire looks the same on every
  // attempt, which is what makes it a place rather than an effect.
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return Array.from({ length: n }, () => ({
    phase: rnd(),
    radius: Math.sqrt(rnd()) * spread,
    angle: rnd() * Math.PI * 2,
    scale: 0.7 + rnd() * 0.7,
    drift: (rnd() - 0.5) * 3,
  }));
}

/**
 * The fire itself: flames, a smoke column, a scorch mark and one flickering
 * light.
 *
 * Rendered whenever the mission has a fire — including at intensity zero, where
 * the scorch stays and everything else has gone. A fire that unmounted on being
 * put out would leave clean forest floor where the pilot had just been working.
 */
export function FireZone({ mission }: { mission: Mission }) {
  const fire = mission.fire;
  const intensity = useMissionStore((s) => s.fireIntensity);
  const phase = useMissionStore((s) => s.phase);

  const flames = useRef<THREE.Group>(null);
  const smoke = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  /** Smoothed intensity. The published number steps in 5% notches at 10 Hz, and
   *  a fire that shrank in visible steps would read as a progress bar. */
  const shown = useRef(1);

  const tex = useMemo(() => blob(), []);
  const flamePuffs = useMemo(() => puffs(FLAMES, (fire?.burnRadius ?? 5) * 0.62, 7), [fire]);
  const smokePuffs = useMemo(() => puffs(SMOKES, (fire?.burnRadius ?? 5) * 0.45, 91), [fire]);

  const groundY = fire ? zoneGroundY(mission, mission.zones.drop) : 0;
  const at = mission.zones.drop.at;

  useFrame(({ clock, camera }, rawDt) => {
    if (!fire) return;
    const dt = Math.min(rawDt, 0.1);
    // Eased towards the published value, and faster going out than coming back:
    // suppression should feel like it is winning the moment the spray lands.
    shown.current += (intensity - shown.current) * Math.min(1, dt * 3);
    const t = clock.elapsedTime;
    const lit = shown.current;

    const face = camera.quaternion;

    if (flames.current) {
      flames.current.visible = lit > 0.02;
      flames.current.children.forEach((child, i) => {
        const p = flamePuffs[i];
        const age = (((t / FLAME_LIFE + p.phase) % 1) + 1) % 1;
        const mesh = child as THREE.Mesh;
        // A flame is widest low down and tapers as it rises and cools.
        const grow = 1 - age * 0.55;
        const s = p.scale * (0.9 + lit * 1.1) * grow;
        mesh.position.set(
          Math.cos(p.angle) * p.radius * (0.35 + lit * 0.65) + p.drift * age * 0.3,
          age * FLAME_RISE * (0.4 + lit * 0.6) + 0.25,
          Math.sin(p.angle) * p.radius * (0.35 + lit * 0.65),
        );
        mesh.scale.set(s, s * 1.5, s);
        mesh.quaternion.copy(face);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        // Bright and hot at the base, fading out as it climbs. Multiplied by the
        // intensity twice over — through the fade and through the size — which
        // is what makes 20% read as a fire nearly out rather than a small one.
        mat.opacity = lit * (1 - age) * (0.55 + 0.25 * Math.sin(t * 9 + i));
      });
    }

    if (smoke.current) {
      // Smoke outlives the flames: a fire just put out still smokes, and the
      // brief asks for it to reduce rather than to vanish. It only stops when
      // the mission is over.
      const smokeLit = Math.max(lit, lit > 0.001 ? 0.18 : 0);
      smoke.current.visible = smokeLit > 0.02;
      smoke.current.children.forEach((child, i) => {
        const p = smokePuffs[i];
        const age = (((t / SMOKE_LIFE + p.phase) % 1) + 1) % 1;
        const mesh = child as THREE.Mesh;
        const s = p.scale * (2.2 + age * 7) * (0.5 + smokeLit * 0.5);
        mesh.position.set(
          Math.cos(p.angle) * p.radius + p.drift * age * 4,
          1.5 + age * SMOKE_RISE * (0.5 + smokeLit * 0.5),
          Math.sin(p.angle) * p.radius + p.drift * age * 2,
        );
        mesh.scale.set(s, s, s);
        mesh.quaternion.copy(face);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        // In at the bottom, out at the top, so the column has a head and a tail
        // rather than a hard edge where the puffs are recycled.
        const fade = Math.min(1, age * 5) * (1 - age);
        mat.opacity = smokeLit * fade * 0.5;
      });
    }

    if (light.current) {
      // One light, and it is the reason the fire lights the trunks around it.
      // Flicker is two sines rather than a random walk: a random flicker on a
      // 60 Hz frame reads as a strobe.
      const flick = 0.82 + 0.18 * Math.sin(t * 11) * Math.sin(t * 4.3);
      light.current.intensity = lit * lit * 90 * flick;
      light.current.visible = lit > 0.02;
    }
  });

  if (!fire) return null;
  // Hidden on the briefing card, like every other mission marker: the pilot is
  // reading, and the camera is sitting on the pad.
  const flying = phase !== 'briefing';

  return (
    <group position={[at[0], groundY, at[1]]} visible={flying}>
      {/* The burnt ground. Alpha-blended and dark — the one part of this that
          takes light AWAY — so it still reads once the flames are out and the
          screenshot at the end has something to show for the flight. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[fire.burnRadius, 40]} />
        <meshBasicMaterial color="#140d07" transparent opacity={0.55} depthWrite={false} />
      </mesh>

      <group ref={flames}>
        {flamePuffs.map((_puff, i) => (
          <mesh key={i}>
            <planeGeometry args={[1.6, 1.6]} />
            <meshBasicMaterial
              map={tex}
              // Alternating hot and cool, so the sum through a stack of them has
              // a yellow core and a red edge without a gradient texture.
              color={i % 3 === 0 ? FLAME_HOT : FLAME_EDGE}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      <group ref={smoke}>
        {smokePuffs.map((_puff, i) => (
          <mesh key={i}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={tex} color={SMOKE} transparent depthWrite={false} />
          </mesh>
        ))}
      </group>

      <pointLight ref={light} position={[0, 2.5, 0]} color="#ff7a2a" distance={46} decay={2} />
    </group>
  );
}

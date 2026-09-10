import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import type { Mission } from './types';
import { beaconHeightFor, zoneGroundY } from './types';

// ----------------------------------------------------------------------------
// The emergency beacon at the live search site.
//
// The only thing in the world that says where the casualty is, and it is
// deliberately NOT a mission marker: no ring, no column of light in a colour the
// pilot has learned means "your destination". It is a road flare and its smoke,
// which is a thing that would actually be there.
//
// The whole mission balances on this. The pilot is meant to find the casualty
// with their EYES and have the HUD confirm it — so the beacon has to carry a
// long way and the signal readout has to not. That is why the two numbers pull
// in opposite directions: the flare is drawn out to 220 m and the signal is not
// heard until 26.
//
// Four parts, and each is doing a different job at a different range:
//
//   1. The SMOKE carries across the city. New York is pale — white facades and
//      open sky down every street — and an additive glow held against that adds
//      light to something already near white and disappears. A dark plume is the
//      one thing that reads at distance here.
//   2. The SHAFT of red light says which of the things down there it is, from a
//      street or two away.
//   3. The GROUND POOL says exactly where, once the pilot is overhead and the
//      shaft is edge-on to them.
//   4. The FLARE and its flash are what the pilot is looking at while they hold
//      the hover.
// ----------------------------------------------------------------------------

/** Metres the smoke column is across at the base. Narrow — it is a flare, not a
 *  building fire, and a wide one over a 13 m street reads as the street being on
 *  fire rather than as a signal in it. */
const SMOKE_R = 1.1;
/** How much wider the plume is at the top. Smoke spreads; a parallel-sided
 *  column reads as a solid object standing in the road. */
const SPREAD = 2.6;

/**
 * Metres from the site past which the beacon is not drawn at all.
 *
 * A draw budget and nothing else. It is set far beyond the signal's own detect
 * radius on purpose: the pilot must always SEE the beacon before the HUD says
 * anything about it. A plume that faded in as the percentage arrived would make
 * the readout the thing that found the casualty, which is the opposite of the
 * mission.
 */
const DRAW_RANGE = 220;

/** A soft radial dot: white in the middle, gone at the rim. One canvas, shared
 *  by the glow and the ground pool — a texture rather than a shader, because a
 *  one-off program is a compile and a look to maintain for a fade. */
let dotTex: THREE.CanvasTexture | null = null;
function dotTexture(): THREE.CanvasTexture {
  if (dotTex) return dotTex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  dotTex = new THREE.CanvasTexture(canvas);
  return dotTex;
}

export function SearchBeacon({ mission, siteIndex }: { mission: Mission; siteIndex: number }) {
  const group = useRef<THREE.Group>(null);
  const flare = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Sprite>(null);
  const light = useRef<THREE.PointLight>(null);
  const shaft = useRef<THREE.Mesh>(null);
  const pool = useRef<THREE.Mesh>(null);
  const smoke = useRef<THREE.Mesh>(null);

  const search = mission.search;
  const site = search?.sites[Math.min(Math.max(siteIndex, 0), search.sites.length - 1)];
  // Measured against the site's own hover band, so the rooftop's short flare
  // and the streets' full column both come out of one rule.
  const beaconHeight = site ? beaconHeightFor(mission, site.zone) : (search?.beaconHeight ?? 10);

  const tex = useMemo(() => dotTexture(), []);

  // The plume is one tapered cylinder, built once. Two dozen billboards is what
  // the forest's fire costs and that map has one fire; this is a signal flare on
  // a street in a city that is VRAM-bound before the mission adds anything.
  const smokeGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(SMOKE_R * SPREAD, SMOKE_R, beaconHeight, 10, 1, true);
    g.translate(0, beaconHeight / 2, 0);
    return g;
  }, [beaconHeight]);

  /** The red shaft. Shorter than the smoke and sitting inside the bottom of it,
   *  so the two read as one object — light at the source, smoke above it. */
  const shaftGeo = useMemo(() => {
    const h = beaconHeight * 0.55;
    const g = new THREE.CylinderGeometry(0.85, 0.3, h, 12, 1, true);
    g.translate(0, h / 2, 0);
    return g;
  }, [beaconHeight]);

  useFrame(({ clock }) => {
    if (!site || !group.current) return;
    const d = Math.hypot(dronePose.position.x - site.at[0], dronePose.position.z - site.at[1]);
    const visible = d <= DRAW_RANGE;
    group.current.visible = visible;
    if (!visible) return;

    const t = clock.elapsedTime;

    // The flash. Two quick strikes and a rest, rather than a sine swell — a slow
    // pulse reads as a decorative glow, and what makes a light say EMERGENCY
    // from three hundred metres is the RHYTHM, not the brightness.
    const cycle = t % 1.4;
    const on = cycle < 0.13 || (cycle > 0.26 && cycle < 0.39);
    const beat = on ? 1 : 0.22;

    const mat = flare.current?.material as THREE.MeshStandardMaterial | undefined;
    if (mat) mat.emissiveIntensity = 3 + beat * 9;
    if (light.current) light.current.intensity = 4 + beat * 30;
    if (glow.current) {
      const s = 2.1 + beat * 1.5;
      glow.current.scale.set(s, s, 1);
      (glow.current.material as THREE.SpriteMaterial).opacity = 0.3 + beat * 0.55;
    }
    // The shaft and the pool breathe with the flash but never go dark: they are
    // the parts that say WHERE, and a marker that vanishes for a second at a
    // time is one the pilot loses every time they look away.
    if (shaft.current)
      (shaft.current.material as THREE.MeshBasicMaterial).opacity = 0.3 + beat * 0.34;
    if (pool.current) {
      (pool.current.material as THREE.MeshBasicMaterial).opacity = 0.26 + beat * 0.3;
      pool.current.scale.setScalar(1 + beat * 0.06);
    }
    // The plume drifts and breathes. Barely — enough that it is not a prop.
    if (smoke.current) {
      smoke.current.rotation.y = t * 0.09;
      smoke.current.scale.set(1 + Math.sin(t * 0.7) * 0.04, 1, 1 + Math.cos(t * 0.6) * 0.04);
    }
  });

  if (!site) return null;

  return (
    <group ref={group} position={[site.at[0], zoneGroundY(mission, site.zone), site.at[1]]}>
      {/* The pool of red on the road. Drawn flat, just clear of the surface, and
          it is the part that answers "exactly where" once the pilot is directly
          overhead and every vertical thing here is edge-on to them. */}
      <mesh ref={pool} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[5.2, 32]} />
        <meshBasicMaterial
          map={tex}
          color="#ff4432"
          transparent
          opacity={0.4}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* The flare, on the ground where the casualty is, with its halo. */}
      <mesh ref={flare} position={[0, 0.55, 0]} castShadow={false}>
        <sphereGeometry args={[0.45, 14, 10]} />
        <meshStandardMaterial
          color="#ff7a5c"
          emissive="#ff3a24"
          emissiveIntensity={6}
          toneMapped={false}
        />
      </mesh>
      <sprite ref={glow} position={[0, 0.7, 0]} scale={[2.4, 2.4, 1]}>
        <spriteMaterial
          map={tex}
          color="#ff5030"
          transparent
          opacity={0.6}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>

      {/* One light, and a small one. It is here to throw the flash onto the road
          and the facades either side — which is what makes the beacon findable
          down a street the drone is not yet on — not to light the block. */}
      <pointLight
        ref={light}
        position={[0, 1.6, 0]}
        color="#ff5030"
        intensity={16}
        distance={34}
        decay={2}
      />

      {/* The shaft of red light standing out of the flare. Additive and
          depth-written-off so it reads as light rather than as a plastic cone,
          and open-ended so there is no lid on it from above. */}
      <mesh ref={shaft} geometry={shaftGeo} position={[0, 0.3, 0]}>
        <meshBasicMaterial
          color="#ff4a2e"
          transparent
          opacity={0.5}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* The plume. `depthWrite` off so it never punches a hole in the buildings
          behind it, and back faces kept so it still reads as a volume from
          directly overhead — the angle the pilot confirms it from. Warm-tinted
          rather than neutral grey: it is lit from underneath by the flare. */}
      <mesh ref={smoke} geometry={smokeGeo} position={[0, 0.4, 0]}>
        <meshBasicMaterial
          color="#3a2f31"
          transparent
          opacity={0.46}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

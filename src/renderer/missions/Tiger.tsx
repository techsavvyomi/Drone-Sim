import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useMissionStore } from '../state/missionStore';
import { dronePose } from '../sim/drone/pose';
import { tigerPose, resetTigerPose } from './tigerPose';
import { tigerRouteOf } from './types';
import { tigerAt } from './tigerRoutes';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// The tiger: the only thing to find on Mission 5, and the only thing on any
// mission that will not wait where it was put.
//
// Built from primitives, for the reasons `CasualtyFigure` is: there is no animal
// asset in the repo, the CSP blocks fetching one, and a skinned quadruped is a
// skeleton, a mixer and a texture set on a map that is VRAM-bound before the
// mission adds anything. What sells a tiger at drone distance at night is not a
// face — it is a long low silhouette that MOVES, stripes that break up under a
// moving light, and EYESHINE.
//
// The eyeshine is the mission's whole visual design in one detail. At night, in
// a forest, from thirty metres up, an unlit animal on dark ground is invisible —
// so the two things that give it away are the cat's-eye glint when the light
// crosses it, which is what real spotlight surveys look for, and the pale
// underside catching the pool. Both are cheap; neither is a marker.
//
// It does NOT publish to the store. `Tiger` writes `tigerPose` sixty times a
// second and `MissionDirector` reads it sixty times a second — routing a walk
// through zustand would re-render the HUD on every step.
// ----------------------------------------------------------------------------

const COLORS = {
  /** Deep orange, darker than a picture-book tiger: it is being read under a
   *  white spotlight at night, and a bright orange blows out to a flat blob. */
  coat: '#a5551d',
  belly: '#e4d9c6',
  stripe: '#140d09',
  nose: '#2a1a14',
} as const;

/**
 * How far the light-facing eye glint reaches, metres.
 *
 * Deliberately WIDER than the spotlight's own range. A glint that only appeared
 * once the animal was already lit would tell the pilot nothing they could not
 * already see; what it is for is the half second BEFORE — the pilot sweeps past,
 * catches a spark at the edge of the pool, and comes back. That is the moment
 * the mission is built around.
 */
const EYESHINE_RANGE = 55;

/** Body length, nose to rump, metres. A real tiger is 1.9 m of body; this is
 *  drawn at that so the pilot's safe distance reads against something true. */
const BODY_LEN = 1.9;
/** Shoulder height, metres. */
const SHOULDER = 0.95;

/** A solid of revolution from [radius, y] pairs, bottom to top. */
function lathe(profile: readonly (readonly [number, number])[], segments = 12) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

export function Tiger({ mission }: { mission: Mission }) {
  const phase = useMissionStore((s) => s.phase);
  const routeIndex = useMissionStore((s) => s.routeIndex);
  const route = tigerRouteOf(mission, routeIndex);

  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legFL = useRef<THREE.Group>(null);
  const legFR = useRef<THREE.Group>(null);
  const legBL = useRef<THREE.Group>(null);
  const legBR = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);

  /** The walk clock. Its own, not the mission's: the animal has been walking
   *  this ravine since long before the drone took off, and restarting it with
   *  the attempt would put the tiger back at the head of the path every time —
   *  which is exactly the memorisable thing the two routes exist to prevent. */
  const walk = useRef(0);

  /** Scratch, written every frame. Module-scope by contract — nothing may
   *  allocate in the frame loop. */
  const at = useMemo(() => ({ x: 0, y: 0, z: 0, heading: 0 }), []);

  const materials = useMemo(() => {
    const coat = new THREE.MeshStandardMaterial({ color: COLORS.coat, roughness: 0.85 });
    const belly = new THREE.MeshStandardMaterial({ color: COLORS.belly, roughness: 0.9 });
    const stripe = new THREE.MeshStandardMaterial({ color: COLORS.stripe, roughness: 0.95 });
    const nose = new THREE.MeshStandardMaterial({ color: COLORS.nose, roughness: 0.6 });
    // ONE material for both eyes, shared by reference. Two that glinted out of
    // step would read as two animals.
    const eye = new THREE.MeshStandardMaterial({
      color: '#f6f0d2',
      emissive: new THREE.Color('#d8e89a'),
      emissiveIntensity: 0.15,
      roughness: 0.2,
    });
    return { coat, belly, stripe, nose, eye };
  }, []);

  useEffect(
    () => () => {
      for (const m of Object.values(materials)) m.dispose();
      resetTigerPose();
    },
    [materials],
  );

  const geo = useMemo(
    () => ({
      /** Torso: a tapered barrel, deeper at the chest than at the hips. */
      torso: lathe([
        [0.0, -0.95],
        [0.2, -0.86],
        [0.31, -0.5],
        [0.34, 0.0],
        [0.3, 0.55],
        [0.22, 0.88],
        [0.0, 0.95],
      ]),
      skull: new THREE.SphereGeometry(0.19, 12, 10),
      muzzle: new THREE.SphereGeometry(0.11, 10, 8),
      ear: new THREE.ConeGeometry(0.06, 0.09, 7),
      eye: new THREE.SphereGeometry(0.032, 8, 6),
      limb: new THREE.CapsuleGeometry(0.075, 0.42, 4, 8),
      paw: new THREE.SphereGeometry(0.085, 8, 6),
      tail: new THREE.CapsuleGeometry(0.045, 0.62, 4, 6),
      /** One stripe: a thin arc laid over the barrel. Eight of them. */
      stripe: new THREE.TorusGeometry(0.315, 0.022, 4, 10, Math.PI * 1.05),
    }),
    [],
  );
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);

  useFrame((_, dt) => {
    if (!route || !root.current) return;

    // The animal walks through the briefing as well as the flight. It is not
    // waiting for the pilot.
    walk.current += dt;
    tigerAt(route, walk.current, mission.tracking?.speed ?? 0.9, at);

    root.current.position.set(at.x, at.y, at.z);
    root.current.rotation.y = at.heading;

    tigerPose.x = at.x;
    tigerPose.y = at.y;
    tigerPose.z = at.z;
    tigerPose.heading = at.heading;
    tigerPose.present = phase === 'flying';

    // The gait. A diagonal pair at a time, which is what a walking cat does and
    // what stops the four legs reading as a pushed toy.
    const stride = walk.current * 2.6;
    const swing = Math.sin(stride) * 0.42;
    const swingOff = Math.sin(stride + Math.PI) * 0.42;
    if (legFL.current) legFL.current.rotation.x = swing;
    if (legBR.current) legBR.current.rotation.x = swing;
    if (legFR.current) legFR.current.rotation.x = swingOff;
    if (legBL.current) legBL.current.rotation.x = swingOff;
    // The body rises and falls a couple of centimetres with the stride, and the
    // head lags it. Without this the silhouette is rigid, and a rigid silhouette
    // at forty metres reads as scenery.
    if (body.current) body.current.position.y = SHOULDER + Math.sin(stride * 2) * 0.022;
    if (head.current) head.current.rotation.x = Math.sin(stride * 2 + 0.6) * 0.05;
    if (tail.current) tail.current.rotation.z = Math.sin(stride * 0.7) * 0.22;

    // EYESHINE. It is not a lamp — it is a retroreflection, so it only answers
    // when something is looking at it from roughly where the light is. The
    // aircraft is the only light out here, so "the drone is close and more or
    // less above" is the honest approximation, and it fades with distance
    // rather than switching, so the pilot catches a glint rather than a bulb.
    const dx = tigerPose.x - dronePose.position.x;
    const dz = tigerPose.z - dronePose.position.z;
    const near = Math.max(0, 1 - Math.hypot(dx, dz) / EYESHINE_RANGE);
    materials.eye.emissiveIntensity = 0.15 + near * near * 2.6;
  });

  if (!route) return null;

  return (
    <group ref={root}>
      <group ref={body} position={[0, SHOULDER, 0]}>
        {/* Torso, laid on its side so the lathe's axis runs nose to tail. */}
        <mesh
          geometry={geo.torso}
          material={materials.coat}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[1, BODY_LEN / 1.9, 0.86]}
          castShadow
        />
        {/* Pale underside: the half of the animal a spotlight from above
            actually lights, and the half that gives it away. */}
        <mesh
          geometry={geo.torso}
          material={materials.belly}
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, -0.11, 0]}
          scale={[0.78, BODY_LEN / 2.1, 0.5]}
        />
        {[-0.62, -0.42, -0.22, 0, 0.22, 0.42, 0.62, 0.8].map((z, i) => (
          <mesh
            key={z}
            geometry={geo.stripe}
            material={materials.stripe}
            position={[0, 0.02, z]}
            rotation={[0, Math.PI / 2, Math.PI * (0.47 + (i % 2) * 0.06)]}
            scale={[0.92, 0.92, 0.86]}
          />
        ))}

        {/* Head, forward of the shoulders and a little down — a cat walking
            carries its head below the line of its back. */}
        <group ref={head} position={[0, 0.02, -BODY_LEN / 2 - 0.1]}>
          <mesh geometry={geo.skull} material={materials.coat} castShadow />
          <mesh geometry={geo.muzzle} material={materials.belly} position={[0, -0.05, -0.17]} />
          <mesh geometry={geo.ear} material={materials.coat} position={[-0.11, 0.17, 0.03]} />
          <mesh geometry={geo.ear} material={materials.coat} position={[0.11, 0.17, 0.03]} />
          <mesh
            geometry={geo.eye}
            material={materials.nose}
            position={[0, -0.04, -0.26]}
            scale={[1.3, 0.9, 0.9]}
          />
          {/* The two that matter. One shared emissive material, driven above. */}
          <mesh geometry={geo.eye} material={materials.eye} position={[-0.078, 0.045, -0.16]} />
          <mesh geometry={geo.eye} material={materials.eye} position={[0.078, 0.045, -0.16]} />
        </group>

        {/* Legs. The pivot is at the shoulder/hip so the swing reads as a
            stride rather than as a sliding foot. */}
        {(
          [
            ['FL', legFL, -0.23, -0.62],
            ['FR', legFR, 0.23, -0.62],
            ['BL', legBL, -0.23, 0.6],
            ['BR', legBR, 0.23, 0.6],
          ] as const
        ).map(([key, ref, x, z]) => (
          <group key={key} ref={ref} position={[x, -0.1, z]}>
            <mesh
              geometry={geo.limb}
              material={materials.coat}
              position={[0, -0.3, 0]}
              castShadow
            />
            <mesh geometry={geo.paw} material={materials.belly} position={[0, -0.56, -0.02]} />
          </group>
        ))}

        <group ref={tail} position={[0, 0.12, BODY_LEN / 2 - 0.05]}>
          <mesh
            geometry={geo.tail}
            material={materials.coat}
            position={[0, 0.02, 0.3]}
            rotation={[Math.PI / 2.4, 0, 0]}
          />
        </group>
      </group>
    </group>
  );
}

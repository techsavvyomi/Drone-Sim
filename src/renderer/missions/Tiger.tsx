import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useMissionStore } from '../state/missionStore';
import { useFlightStore } from '../state/flightStore';
import { dronePose } from '../sim/drone/pose';
import { useDisposable } from '../scene/useDisposable';
import { staticHitDistance } from '../scene/cameraProbe';
import { tigerPose, resetTigerPose } from './tigerPose';
import { tigerRouteOf } from './types';
import { ambleDistance, amblePace, tigerAtDistance } from './tigerRoutes';
import tigerModelUrl from '../../assets/models/tiger.glb?url';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// The Bengal Tiger — Mission 6: Search and Rescue (Nightfall Predator Tracking)
//
// Photorealistic 3D Bengal Tiger model with:
// 1. FULL SKELETAL QUADRUPED LOCOMOTION:
//    - Real-time procedural 4-beat feline gait (LH -> LF -> RH -> RF).
//    - Stride phase is mathematically synchronized to path distance displacement:
//      paws physically push, plant, bend, and lift without sliding or skating.
//    - Organic knee flexion, paw ankle articulation, spine S-curve sway,
//      shoulder roll, rhythmic vertical weight transfer, and trailing tail motion.
// 2. LIFELIKE BIG-CAT BEHAVIOR:
//    - Scenting pauses, stride acceleration, stealth head-countering, and
//      gentle ribcage breathing.
// 3. RETROREFLECTIVE EYESHINE (Tapetum Lucidum):
//    - Green-gold eye shine glints attached to the ocular bones that intensify
//      under the drone's searchlight beam.
// 4. FOREST AMBIENCE:
//    - Ground dust swirls around paw contact points.
// ----------------------------------------------------------------------------

/** Eyeshine retroreflection range, metres. */
const EYESHINE_RANGE = 55;

/** How fast the body yaws to face its heading, per second. */
const TURN_LERP = 2.4;

/**
 * Off its heading by more than this, degrees, the tiger stops advancing and
 * turns first; between this and straight ahead it slows smoothly.
 *
 * The patrol reverses at each end, and the path has corners: the heading jumps
 * there, the body takes a second to come round, and an animal still moving
 * along the path meanwhile walks backward or sideways while its legs step
 * forward. A real animal turns, then walks.
 */
const TURN_BEFORE_WALK_DEG = 75;

/**
 * Ground-following: where the paws are, and how the body settles onto them.
 *
 * The route stores ONE measured ground height per node and interpolated a
 * straight line between them, and those heights are only checked to within
 * 0.6 m. A dirt road is not a straight line: wherever it rose above the
 * interpolation the paws went into it — flown and reported as "the tiger's legs
 * go inside the road". So the ground is measured under the animal every frame:
 * one ray down under the front paws and one under the hind paws, against the
 * same static terrain the drone collides with. The body sits on their average
 * and pitches to the slope between them.
 *
 * Not a physics collider, on purpose: the tiger stays non-solid so a drone
 * cannot bump it (see MissionViewport). Two rays a frame.
 */
/** Front and hind paws, metres ahead of / behind the root along the body. */
const PAW_REACH = 0.5;
/** Rays start this far above the route height, and look this far below it. */
const RAY_UP = 1.5;
const RAY_DOWN = 3;
/** How fast the body settles onto the measured ground, per second. */
const GROUND_LERP = 12;
/** The steepest the body will pitch to follow a slope, degrees. */
const MAX_PITCH_DEG = 25;

/** Full 4-beat walk cycle distance for all four paws, metres. */
const STRIDE_LENGTH = 0.88;

/** Shortest angle interpolation from a to b, radians. */
function turnTowards(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function Tiger({ mission }: { mission: Mission }) {
  const phase = useMissionStore((s) => s.phase);
  const routeIndex = useMissionStore((s) => s.routeIndex);
  const route = tigerRouteOf(mission, routeIndex);

  const root = useRef<THREE.Group>(null);
  const modelRef = useRef<THREE.Group>(null);
  const dustPoints = useRef<THREE.Points>(null);

  // Clocks and states
  const walk = useRef(0);
  /** Patrol clock: like `walk`, but it stops while the tiger turns round. */
  const patrol = useRef(0);
  const along = useRef(0);
  const facing = useRef<number | null>(null);
  /** Smoothed ground height under the body, and the body's pitch. */
  const groundY = useRef<number | null>(null);
  const pitch = useRef(0);
  /** Scratch for the two ground rays. */
  const rayFrom = useMemo(() => new THREE.Vector3(), []);
  const rayTo = useMemo(() => new THREE.Vector3(), []);

  // Scratch coordinate
  const at = useMemo(() => ({ x: 0, y: 0, z: 0, heading: 0 }), []);

  // Reusable transform helpers (zero allocations in frame loop)
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, 'XYZ'), []);
  const qRot = useMemo(() => new THREE.Quaternion(), []);

  // Load the 3D Tiger model
  const { scene: rawScene } = useGLTF(tigerModelUrl);

  // Clone with SkeletonUtils so bones, skinning, and materials bind uniquely
  const scene = useMemo(() => {
    const cloned = SkeletonUtils.clone(rawScene) as THREE.Group;
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material && mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.roughness = 0.82;
          mesh.material.metalness = 0.0;
          if (mesh.material.normalMap) {
            mesh.material.normalScale.set(1.2, 1.2);
          }
        }
      }
    });
    return cloned;
  }, [rawScene]);

  // Index the skeletal joints for organic procedural quadruped locomotion
  const bones = useMemo(() => {
    return {
      // Front Left
      lfFemur: scene.getObjectByName('l_femurRibbonFront_00_uJnt') as THREE.Bone | null,
      lfTibia: scene.getObjectByName('l_tibiaRibbonFront_00_uJnt') as THREE.Bone | null,
      lfFoot: scene.getObjectByName('l_footFront_00_uJnt') as THREE.Bone | null,
      // Front Right
      rfFemur: scene.getObjectByName('r_femurRibbonFront_00_uJnt') as THREE.Bone | null,
      rfTibia: scene.getObjectByName('r_tibiaRibbonFront_00_uJnt') as THREE.Bone | null,
      rfFoot: scene.getObjectByName('r_footFront_00_uJnt') as THREE.Bone | null,
      // Hind Left
      lhFemur: scene.getObjectByName('l_femurRibbon_00_uJnt') as THREE.Bone | null,
      lhTibia: scene.getObjectByName('l_tibiaRibbon_00_uJnt') as THREE.Bone | null,
      lhFoot: scene.getObjectByName('l_foot_00_uJnt') as THREE.Bone | null,
      // Hind Right
      rhFemur: scene.getObjectByName('r_femurRibbon_00_uJnt') as THREE.Bone | null,
      rhTibia: scene.getObjectByName('r_tibiaRibbon_00_uJnt') as THREE.Bone | null,
      rhFoot: scene.getObjectByName('r_foot_00_uJnt') as THREE.Bone | null,
      // Spine & Torso
      rootBone: scene.getObjectByName('c_root_01_uJnt') as THREE.Bone | null,
      spine0: scene.getObjectByName('c_spine_00_uJnt') as THREE.Bone | null,
      spine1: scene.getObjectByName('c_spine_01_uJnt') as THREE.Bone | null,
      spine2: scene.getObjectByName('c_spine_02_uJnt') as THREE.Bone | null,
      chest: scene.getObjectByName('c_chest_00_uJnt') as THREE.Bone | null,
      neck0: scene.getObjectByName('c_neck_00_uJnt') as THREE.Bone | null,
      head: scene.getObjectByName('c_head_00_uJnt') as THREE.Bone | null,
      // Tail
      tail: [
        scene.getObjectByName('c_tail_00_uJnt') as THREE.Bone | null,
        scene.getObjectByName('c_tail_01_uJnt') as THREE.Bone | null,
        scene.getObjectByName('c_tail_02_uJnt') as THREE.Bone | null,
        scene.getObjectByName('c_tail_03_uJnt') as THREE.Bone | null,
        scene.getObjectByName('c_tail_04_uJnt') as THREE.Bone | null,
        scene.getObjectByName('c_tail_05_uJnt') as THREE.Bone | null,
        scene.getObjectByName('c_tail_06_uJnt') as THREE.Bone | null,
        scene.getObjectByName('c_tail_07_uJnt') as THREE.Bone | null,
      ],
    };
  }, [scene]);

  // Store rest/base quaternions of all bones
  const restQuats = useMemo(() => {
    const map = new Map<THREE.Object3D, THREE.Quaternion>();
    scene.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) {
        map.set(obj, obj.quaternion.clone());
      }
    });
    return map;
  }, [scene]);

  // Helper to apply relative local rotation onto a bone from its rest pose
  const applyRot = (bone: THREE.Bone | null, rx: number, ry: number, rz: number) => {
    if (!bone) return;
    const base = restQuats.get(bone);
    if (!base) return;
    euler.set(rx, ry, rz);
    qRot.setFromEuler(euler);
    bone.quaternion.copy(base).multiply(qRot);
  };

  // Glowing tapetum lucidum eyeshine material
  const materials = useMemo(() => {
    const eyeshine = new THREE.MeshStandardMaterial({
      color: '#f8ffe0',
      emissive: new THREE.Color('#9ae83a'), // Vivid wild cat eye retroreflection
      emissiveIntensity: 0.25,
      roughness: 0.1,
    });

    const dust = new THREE.PointsMaterial({
      color: '#c4b598',
      size: 0.07,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });

    return { eyeshine, dust };
  }, []);

  useDisposable(materials);
  useEffect(() => () => resetTigerPose(), []);

  // Eye geometries & dust particles
  const geo = useMemo(() => {
    const eyeGlint = new THREE.SphereGeometry(0.016, 8, 6);

    const dustCount = 40;
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3 + 0] = (Math.random() - 0.5) * 1.6;
      dustPositions[i * 3 + 1] = Math.random() * 0.2;
      dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 2.2;
    }
    const dust = new THREE.BufferGeometry();
    dust.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));

    return { eyeGlint, dust };
  }, []);

  useDisposable(geo);

  // Attach retroreflective eyeshine glints to the eye bones
  const eyeR = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Group>(null);

  useEffect(() => {
    const boneR = scene.getObjectByName('r_eyeAim_00_uJnt');
    const boneL = scene.getObjectByName('l_eyeAim_00_uJnt');
    if (boneR && eyeR.current && eyeR.current.parent !== boneR) {
      boneR.add(eyeR.current);
    }
    if (boneL && eyeL.current && eyeL.current.parent !== boneL) {
      boneL.add(eyeL.current);
    }
  }, [scene]);

  useFrame((_, dt) => {
    if (!route || !root.current) return;
    // A paused flight stops the animal too: a tiger that walked on under a
    // frozen drone would be somewhere else when the pilot came back.
    if (useFlightStore.getState().paused) return;

    walk.current += dt;
    const speed = mission.tracking?.speed ?? 0.9;

    // Advance along the patrol only as fast as the body is facing the way the
    // path goes — see TURN_BEFORE_WALK_DEG. Judged against last frame's
    // heading; on the first frame the body is snapped to it, so it walks.
    let go = 1;
    if (facing.current !== null) {
      const off = Math.abs(turnTowards(0, at.heading - facing.current, 1));
      const cosLimit = Math.cos((TURN_BEFORE_WALK_DEG * Math.PI) / 180);
      const t = (Math.cos(off) - cosLimit) / (1 - cosLimit);
      go = Math.min(1, Math.max(0, t));
    }
    patrol.current += dt * go;

    // Continuous distance amble along the forest patrol
    const travelled = ambleDistance(patrol.current, speed);
    along.current = travelled;
    tigerAtDistance(route, travelled, at);

    // Natural pace variations (ambling, pauses, stalking)
    const basePace = Math.max(0, amblePace(patrol.current)) * go;

    // ------------------------------------------------------------------------
    // QUADRUPED STRIDE-SYNCHRONIZED LEG MOTION (NO SLIDING / ZERO SKATING)
    // ------------------------------------------------------------------------
    // Stride phase is driven by true linear distance travelled.
    const cycle = (travelled / STRIDE_LENGTH) * Math.PI * 2;

    // 4-beat feline lateral walk sequence:
    // Left Hind (LH) -> Left Front (LF) -> Right Hind (RH) -> Right Front (RF)
    const pLH = cycle;
    const pLF = cycle + Math.PI * 0.5;
    const pRH = cycle + Math.PI;
    const pRF = cycle + Math.PI * 1.5;

    // Swing & lift amplitudes scale smoothly with pace (settle naturally when paused)
    const activePace = Math.min(1.2, basePace);
    const swingAmp = 0.32 * activePace;
    const liftAmp = 0.42 * activePace;

    // Front Left leg: swing, knee bend, paw flex
    const swingLF = Math.sin(pLF) * swingAmp;
    const liftLF = Math.max(0, Math.cos(pLF)) * liftAmp;
    applyRot(bones.lfFemur, 0, 0, swingLF);
    applyRot(bones.lfTibia, 0, liftLF * 0.45, liftLF * 0.75);
    applyRot(bones.lfFoot, 0, 0, -liftLF * 0.55);

    // Front Right leg: swing, knee bend, paw flex
    const swingRF = Math.sin(pRF) * swingAmp;
    const liftRF = Math.max(0, Math.cos(pRF)) * liftAmp;
    applyRot(bones.rfFemur, 0, 0, swingRF);
    applyRot(bones.rfTibia, 0, -liftRF * 0.45, liftRF * 0.75);
    applyRot(bones.rfFoot, 0, 0, -liftRF * 0.55);

    // Hind Left leg: hip swing, knee flex, paw plant
    const swingLH = Math.sin(pLH) * swingAmp;
    const liftLH = Math.max(0, Math.cos(pLH)) * liftAmp;
    applyRot(bones.lhFemur, 0, 0, swingLH);
    applyRot(bones.lhTibia, 0, liftLH * 0.4, -liftLH * 0.85);
    applyRot(bones.lhFoot, 0, 0, liftLH * 0.5);

    // Hind Right leg: hip swing, knee flex, paw plant
    const swingRH = Math.sin(pRH) * swingAmp;
    const liftRH = Math.max(0, Math.cos(pRH)) * liftAmp;
    applyRot(bones.rhFemur, 0, 0, swingRH);
    applyRot(bones.rhTibia, 0, -liftRH * 0.4, -liftRH * 0.85);
    applyRot(bones.rhFoot, 0, 0, liftRH * 0.5);

    // ------------------------------------------------------------------------
    // SPINE S-CURVE, TORSO SWAY & PROWLING DYNAMICS
    // ------------------------------------------------------------------------
    const spineSway = Math.sin(cycle) * 0.055 * Math.min(1.0, activePace);
    applyRot(bones.spine0, 0, spineSway, 0);
    applyRot(bones.spine1, 0, spineSway * 0.8, 0);
    applyRot(bones.spine2, 0, -spineSway * 0.6, 0);
    applyRot(bones.chest, 0, -spineSway * 0.75, Math.sin(cycle) * 0.035 * activePace);

    // Gentle ribcage breathing
    const breath = Math.sin(walk.current * 2.2) * 0.018;
    if (bones.chest) {
      bones.chest.scale.set(1 + breath, 1 + breath, 1 + breath);
    }

    // Stealth low head posture with counter-balance
    const headCounter = -spineSway * 0.6;
    applyRot(bones.neck0, Math.cos(cycle * 2) * 0.018 * activePace, headCounter, 0);
    applyRot(bones.head, Math.sin(cycle * 2) * 0.014 * activePace, headCounter * 0.5, 0);

    // Fluid trailing tail with progressive vertebra phase delays
    for (let k = 0; k < bones.tail.length; k++) {
      const tailBone = bones.tail[k];
      if (tailBone) {
        const tailY = Math.sin(cycle - k * 0.42) * 0.075 * Math.min(1.0, activePace + 0.35);
        const tailZ = Math.sin(walk.current * 1.6 - k * 0.25) * 0.025;
        applyRot(tailBone, 0, tailY, tailZ);
      }
    }

    // Vertical rhythmic body weight transfer (drops and rises with paw plants)
    if (modelRef.current) {
      // Never below zero: a downward bob pushed the paws into the ground.
      const bob = (1 + Math.cos(cycle * 2)) * 0.007 * Math.min(1.0, activePace);
      modelRef.current.position.y = bob;
    }

    // Smooth heading orientation
    facing.current =
      facing.current === null
        ? at.heading
        : turnTowards(facing.current, at.heading, 1 - Math.exp(-TURN_LERP * dt));

    // Stand on the ground actually under the paws — see PAW_REACH. Facing is
    // (−sin h, −cos h); a ray that finds nothing falls back to the route height.
    const fx = -Math.sin(facing.current);
    const fz = -Math.cos(facing.current);
    const groundAt = (ox: number, oz: number): number => {
      rayFrom.set(at.x + ox, at.y + RAY_UP, at.z + oz);
      rayTo.set(at.x + ox, at.y - RAY_DOWN, at.z + oz);
      const hit = staticHitDistance(rayFrom, rayTo);
      return Number.isFinite(hit) ? rayFrom.y - hit : at.y;
    };
    const front = groundAt(fx * PAW_REACH, fz * PAW_REACH);
    const hind = groundAt(-fx * PAW_REACH, -fz * PAW_REACH);
    const wantY = (front + hind) / 2;
    const maxPitch = (MAX_PITCH_DEG * Math.PI) / 180;
    const wantPitch = Math.max(
      -maxPitch,
      Math.min(maxPitch, Math.atan2(front - hind, PAW_REACH * 2)),
    );
    const settle = 1 - Math.exp(-GROUND_LERP * dt);
    // Never let the smoothing lag the body BELOW the ground on a rise.
    groundY.current =
      groundY.current === null
        ? wantY
        : Math.max(wantY, groundY.current + (wantY - groundY.current) * settle);
    pitch.current += (wantPitch - pitch.current) * settle;

    root.current.position.set(at.x, groundY.current, at.z);
    root.current.rotation.order = 'YXZ';
    // Positive X rotation lifts local −Z, the head end.
    root.current.rotation.set(pitch.current, facing.current, 0);

    // Update tigerPose for spotlight detection, safe distance checks, and radar
    tigerPose.x = at.x;
    tigerPose.y = groundY.current;
    tigerPose.z = at.z;
    tigerPose.heading = at.heading;
    tigerPose.present = phase === 'flying';

    // ------------------------------------------------------------------------
    // EYESHINE (Tapetum Lucidum Retroreflection)
    // ------------------------------------------------------------------------
    const dDroneX = tigerPose.x - dronePose.position.x;
    const dDroneZ = tigerPose.z - dronePose.position.z;
    const distToDrone = Math.hypot(dDroneX, dDroneZ);
    const near = Math.max(0, 1 - distToDrone / EYESHINE_RANGE);

    // Eyeshine glows brightly when illuminated by the spotlight at distance
    materials.eyeshine.emissiveIntensity = 0.2 + near * near * 4.2;

    // Dust particles drift gently near paws
    if (dustPoints.current) {
      dustPoints.current.rotation.y += dt * 0.15;
      materials.dust.opacity = Math.min(0.35, 0.1 + basePace * 0.18);
    }
  });

  if (!route) return null;

  return (
    <group ref={root}>
      {/* Eye glints attached directly to the skeletal eye bones */}
      <group ref={eyeR}>
        <mesh geometry={geo.eyeGlint} material={materials.eyeshine} position={[0, 0.015, 0.03]} />
      </group>
      <group ref={eyeL}>
        <mesh geometry={geo.eyeGlint} material={materials.eyeshine} position={[0, 0.015, 0.03]} />
      </group>

      {/* Forest floor dust swirl */}
      <points ref={dustPoints} geometry={geo.dust} material={materials.dust} position={[0, 0.04, 0]} />

      {/*
        AAA Skinned Bengal Tiger:
        Rotate Math.PI around Y to align model +Z forward with Three.js -Z forward.
      */}
      <group ref={modelRef} rotation={[0, Math.PI, 0]} position={[0, 0, 0]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

// Preload the photorealistic model for zero delay on mission launch
useGLTF.preload(tigerModelUrl);

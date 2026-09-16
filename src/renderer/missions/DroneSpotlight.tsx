import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import { useDisposable } from '../scene/useDisposable';
import { useSimStore } from '../state/simStore';
import { useFlightStore } from '../state/flightStore';
import { staticHitDistance } from '../scene/cameraProbe';
import { beamPose, resetBeamPose } from './beamPose';
import { tigerPose } from './tigerPose';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// The searchlight under the drone, on Mission 5 (Wildlife Tracker).
//
// Mounted strictly UNDERNEATH the drone fuselage, flush against the underbelly
// (beneath the battery and between the landing legs), pointing downward and
// forward onto the terrain.
//
// What is on screen is the lamp housing, its lens, and the light itself — the
// pool it throws on the ground, the trees and the tiger.
// There is deliberately NO mesh in the air between them: see `TUNING`.
//
// The lamp is dark on the pad and comes up across the first metre or two of
// climb (`lampRamp`), and stays up in flight until the aircraft rests or
// crashes (`lampHold`).
//
// PARENTING. The SpotLight and its target are both children of `rig`, and the
// rig takes the drone's position AND heading every frame. So the target is a
// LOCAL point — ahead of the nose (−Z, the drone's forward) and below — and the
// pool turns with the aircraft without any world-space arithmetic on the
// target. The rig is not a child of the airframe mesh itself because that lives
// inside <Physics> in `Drone.tsx`; copying `dronePose` is the same transform,
// the one the chase camera follows. Roll is left out on purpose.
// ----------------------------------------------------------------------------

// ---- TUNING ------------------------------------------------------------------
//
// Every number worth adjusting after a flight is here.
//
// There used to be a visible cone mesh — an additive, double-sided shell from
// the lens to the ground. It was the "shadow over the tree by the road": a
// transparent mesh with depthWrite off is still depth-TESTED, so everything
// BEHIND it from the chase camera (the trunk by the road, the road itself) was
// painted over with a pale veil, while nothing in front of it was. Shortening
// and dimming it only moved the problem. It is gone; the light is shown where
// it lands, which is where a real torch at night is seen.

/**
 * Lean ahead of straight down at a level hover, degrees.
 *
 * 60: a torch held like a phone with its top tipped up — the beam is thrown
 * well ahead of the nose, close to a headlight, rather than lighting the ground
 * under the aircraft. At 25° the pool sat almost under the drone and the
 * tiger's shadow fell under the tiger, where nobody could see it.
 */
export const LIGHT_TILT_DEG = 60;

/** The most the beam may lean ahead in forward flight, degrees. At 70° the
 *  beam from the 30 m ceiling still meets flat ground inside `LIGHT_DISTANCE`. */
export const LIGHT_MAX_TILT_DEG = 70;

/** How much of the airframe's nose-down pitch the beam follows, 0 to 1.
 *  0 holds the beam at `LIGHT_TILT_DEG` whatever the aircraft does. */
const PITCH_FOLLOW = 0.8;

/** How fast the lean catches up with the pitch, per second. Slower than the
 *  stick, so a jab forward swings the pool rather than jolting it. */
const TILT_LERP = 2.5;

/*
 * LIGHT_ANGLE — the cone's half-angle — is NOT here, deliberately: it is
 * `coneDeg` in `nightTracking.ts`, because the tiger detection judges the SAME
 * number. A copy here could drift from it, and then what looks lit would not
 * be lit.
 */

/**
 * Candela at full power, against decay = 2.
 *
 * 1350. At 1500 with no low-altitude correction the pool under a drone a
 * metre or two up was several times over the bloom threshold: the whole pool
 * clipped to flat white and its penumbra clipped with it, which is what made
 * the edge look hard. 900 fixed that and was flown as too dim ("kaafi halka"),
 * so it is 1.5x that. Near the ground `lampExposure` still holds it well under
 * the old blowout (TC-502b).
 */
export const LIGHT_INTENSITY = 1350;

/**
 * The brightness the current look was approved at is that of a lamp this many
 * metres further from the ground than the real one.
 *
 * Not a mount position — a record. The approved look was flown with the
 * SpotLight accidentally sitting 1 m ABOVE the drone (three.js puts a SpotLight
 * at (0, 1, 0) when no position is given, and the prop had been dropped). Moved
 * back under the belly, the same intensity is ~3x hotter at 1–2 m, so the pool
 * is scaled by `(d / (d + LOOK_OFFSET))²` to keep the brightness that was
 * signed off. 0 turns the correction off.
 */
const LOOK_OFFSET = 1;

/**
 * Light reach, metres. The pool fades to nothing by here.
 *
 * 90, the mission's own `lightRange`, so what the detection counts is exactly
 * as far as the light shows. It was 40 with the beam at 25°; leaning at 60° the
 * beam is twice as long to the ground, and 40 put the pool out above ~20 m.
 */
const LIGHT_DISTANCE = 90;

/** Soft pool edge, 0 (hard) to 1. */
const LIGHT_PENUMBRA = 0.5;

/** Light colour — a warm white, like a halogen torch. */
const LIGHT_COLOR = '#ffe2bd';

/**
 * Where the lamp's lens sits, in the drone's own frame, metres.
 *
 * MEASURED off PlutoGuru.opt.glb as the game draws it (modelScale, sizeScale
 * 2.5, yaw and offset applied): the fuselage nose ends at z = −0.145 and its
 * underside there is at y ≈ +0.030 — ABOVE the drone's origin, since the feet
 * hang down to −0.024. So the lamp is mounted at the front edge of the belly,
 * just inside the nose, with its 12 mm housing touching the underside. The old
 * centre mount at y = −0.03 was hanging below the feet.
 */
const LIGHT_OFFSET_Y = 0.018;

/** Forward is −Z. Just inside the nose tip at −0.145. */
const LIGHT_OFFSET_Z = -0.12;

// ---- SHADOW ------------------------------------------------------------------
//
// On Medium and High only (Low has no shadow map). Nothing in the forest GLB
// casts — every tree and ground tile has castShadow = false — so what this
// light shadows is the tiger. Two things keep it cheap, both learned from
// Mission 5 lagging on High the last time this was on:
// - a 512 map, not 1024, next to the sun's own map on a VRAM-bound target;
// - the map is redrawn only while the tiger is near the beam, plus one frame
//   after it leaves to clear it, instead of every frame.

/** Shadow map resolution, texels per side. */
const SHADOW_MAP = 512;

/** Depth bias against shadow acne. More negative removes acne but detaches the
 *  shadow from the animal's feet (peter-panning). */
const SHADOW_BIAS = -0.0005;

/** Offset along the surface normal; handles acne on slopes without detaching. */
const SHADOW_NORMAL_BIAS = 0.02;

/** Shadow camera near plane, metres. Clears the airframe the lamp is under, or
 *  the drone's own arms would shadow the whole pool. */
const SHADOW_NEAR = 0.3;

/** How far outside the cone the tiger may be and still have its shadow
 *  redrawn, as a multiple of the cone's half-angle — so the shadow is already
 *  there as the animal walks into the pool. */
const SHADOW_CONE_MARGIN = 1.6;

/** How fast the aim catches up with the nose, per second. */
const AIM_LERP = 3.5;

/**
 * The beam's lean ahead of straight down, radians, for an airframe pitched
 * `pitchDown` radians nose-down (negative is nose-up).
 *
 * The lamp is bolted to the belly, so when the aircraft tips forward to fly,
 * the light tips forward with it — that is what makes it read as a light ON the
 * drone. Only most of the pitch is followed, and the lean is clamped, because a
 * beam that followed every degree would throw its pool tens of metres ahead in
 * a hard dash. Roll is ignored for the same reason. Pure, so the clamp is
 * checkable.
 */
export function beamTilt(pitchDown: number): number {
  const deg = LIGHT_TILT_DEG + ((pitchDown * 180) / Math.PI) * PITCH_FOLLOW;
  return (Math.min(LIGHT_MAX_TILT_DEG, Math.max(0, deg)) * Math.PI) / 180;
}

/** How far along the beam the terrain is looked for, metres — just past the
 *  light's own reach, so a clear reading means the pool is fully faded. One
 *  ray per frame; the shorter it is, the cheaper. */
const RANGE_REACH = LIGHT_DISTANCE + 5;

/** Shadow camera far plane, metres: the light's own reach. */
const SHADOW_FAR = LIGHT_DISTANCE;


/** The altitude the pool is exposed for, metres. Above it the lamp runs at
 *  full power; below it, it is turned down. */
export const IRIS_ALT = 18;

/** Power falloff curve below IRIS_ALT. Under 2 the pool still brightens as the
 *  drone descends; at 2 it would hold flat. */
const IRIS_FALLOFF = 1.7;

/** How fast the iris chases the rangefinder, per second. */
const IRIS_LERP = 4;

/**
 * The iris, 0 to 1: how far the lamp is turned down for close surfaces.
 */
export function irisScale(height: number): number {
  if (!(height > 0) || height >= IRIS_ALT) return 1;
  return Math.pow(height / IRIS_ALT, IRIS_FALLOFF);
}

/**
 * The lamp's power scale, 0 to 1, for a surface `distance` metres along the
 * beam: the iris, and the correction that holds the approved brightness — see
 * `LOOK_OFFSET`. What the SpotLight's intensity is actually multiplied by.
 */
export function lampExposure(distance: number): number {
  if (!(distance > 0)) return 1;
  const keep = distance / (distance + LOOK_OFFSET);
  return irisScale(distance) * keep * keep;
}

/** Take-off gate heights, metres. */
const LAMP_ON_FROM = 0.3;
const LAMP_ON_FULL = 1.8;
const LAMP_LERP = 2.6;

export function lampRamp(height: number, live: boolean): number {
  if (!live) return 0;
  const t = (height - LAMP_ON_FROM) / (LAMP_ON_FULL - LAMP_ON_FROM);
  return Math.min(1, Math.max(0, t));
}

export function lampHold(ramp: number, held: number, live: boolean, footDown: boolean): number {
  if (!live || footDown) return 0;
  return Math.max(held, ramp);
}

/**
 * Distance from `from` along the unit vector `dir` to the first static surface,
 * or `RANGE_REACH` when there is none within it. `end` is scratch, so the frame
 * loop can call this without allocating.
 */
function castAlong(from: THREE.Vector3, dir: THREE.Vector3, end: THREE.Vector3): number {
  end.copy(from).addScaledVector(dir, RANGE_REACH);
  const hit = staticHitDistance(from, end);
  return Number.isFinite(hit) ? hit : RANGE_REACH;
}

export function DroneSpotlight({ mission, shadows }: { mission: Mission; shadows: boolean }) {
  const rig = useRef<THREE.Group>(null);
  const light = useRef<THREE.SpotLight>(null);
  const track = mission.tracking;

  // Scratch vectors to avoid allocations in frame loop
  const forward = useMemo(() => new THREE.Vector3(), []);
  const aimDir = useMemo(() => new THREE.Vector3(), []);
  /** The lamp's world position, and a point along a ray from it. */
  const lampAt = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  /** The lamp's mount in the drone's frame. */
  const mount = useMemo(() => new THREE.Vector3(), []);
  const rayEnd = useMemo(() => new THREE.Vector3(), []);

  /** The smoothed flat heading the beam is aimed along, as a unit XZ vector.
   *  Null until the first frame, so the beam starts pointing where the nose
   *  does rather than swinging in from north. */
  const aim = useRef<{ x: number; z: number } | null>(null);
  /** The smoothed lean ahead of straight down, radians. */
  const tilt = useRef(beamTilt(0));
  const lamp = useRef(0);
  const held = useRef(0);
  const irisAgl = useRef(IRIS_ALT);
  /** Whether the shadow map was drawn with the tiger near the beam last frame,
   *  so it is redrawn once more after the animal leaves — clearing it. */
  const shadowWasLive = useRef(false);
  /** The `shadows` prop, readable from the dev console helper. */
  const shadowsOn = useRef(shadows);
  shadowsOn.current = shadows;

  // SpotLight cone half-angle
  const angle = ((track?.coneDeg ?? 26) * Math.PI) / 180;

  const lensBase = useMemo(() => new THREE.Color('#93a9cc'), []);
  const lensMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#000000', toneMapped: true, fog: false }),
    [],
  );

  const housingMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#101317', roughness: 0.7, metalness: 0.4 }),
    [],
  );

  useDisposable(lensMat, housingMat);

  useEffect(() => {
    if (light.current && rig.current) {
      rig.current.add(light.current.target);
      // The shadow map is redrawn on demand, not every frame — see below.
      light.current.shadow.autoUpdate = false;
      light.current.shadow.needsUpdate = true;
    }
    // Development only: `beamDebug()` in the DevTools console prints where the
    // light really is and where its pool really lands, read from the live
    // objects. Nothing runs per frame.
    const w = window as unknown as { beamDebug?: () => void };
    if (import.meta.env.DEV) {
      w.beamDebug = () => {
        const l = light.current;
        if (!l || !dronePose.present) return console.info('[beam] no drone / light yet');
        const lightW = l.getWorldPosition(new THREE.Vector3());
        const targetW = l.target.getWorldPosition(new THREE.Vector3());
        const dir = targetW.clone().sub(lightW).normalize();
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(dronePose.quaternion);
        const flatFwd = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
        const hit = castAlong(lightW, dir, new THREE.Vector3());
        const centre = lightW.clone().addScaledVector(dir, hit);
        const drone = dronePose.position;
        const offset = centre.clone().sub(drone);
        const f = (v: THREE.Vector3) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
        console.table({
          drone: f(drone),
          'drone forward': f(fwd),
          light: f(lightW),
          'light target': f(targetW),
          'beam direction': f(dir),
          'circle centre (ground)': hit >= RANGE_REACH ? 'no ground within reach' : f(centre),
          'circle ahead of drone, m': offset.dot(flatFwd).toFixed(2),
          'circle to the right, m': offset.dot(new THREE.Vector3(-flatFwd.z, 0, flatFwd.x)).toFixed(2),
          'published to detection': f(new THREE.Vector3(beamPose.dx, beamPose.dy, beamPose.dz)),
          'shadows allowed (graphics)': String(shadowsOn.current),
          'light castShadow': String(l.castShadow),
          'shadow map created': String(l.shadow.map !== null),
          'tiger near beam (shadow redrawing)': String(shadowWasLive.current),
          'tiger distance from lamp, m': tigerPose.present
            ? Math.hypot(tigerPose.x - lightW.x, tigerPose.y - lightW.y, tigerPose.z - lightW.z).toFixed(1)
            : 'no tiger',
          'light intensity now': l.intensity.toFixed(0),
        });
      };
    }
    return () => {
      resetBeamPose();
      delete w.beamDebug;
    };
  }, []);

  useFrame((_, dt) => {
    const g = rig.current;
    if (!g) return;

    g.visible = dronePose.present;
    if (!dronePose.present) {
      lamp.current = 0;
      held.current = 0;
      aim.current = null;
      tilt.current = beamTilt(0);
      resetBeamPose();
      return;
    }

    const p = dronePose.position;

    // Forward direction from drone yaw/pitch. The nose's drop below the
    // horizon is the pitch the beam leans with, read before it is flattened.
    forward.set(0, 0, -1).applyQuaternion(dronePose.quaternion);
    const pitchDown = Math.asin(Math.min(1, Math.max(-1, -forward.y)));
    tilt.current += (beamTilt(pitchDown) - tilt.current) * (1 - Math.exp(-TILT_LERP * dt));
    forward.y = 0;
    if (forward.lengthSq() > 1e-6) forward.normalize();

    // Chase the heading, framerate-independently, and keep it a unit vector —
    // interpolating two unit vectors shortens them through a turn, and a short
    // one would flatten the tilt.
    if (!aim.current) aim.current = { x: forward.x, z: forward.z };
    const k = 1 - Math.exp(-AIM_LERP * dt);
    aim.current.x += (forward.x - aim.current.x) * k;
    aim.current.z += (forward.z - aim.current.z) * k;
    const flat = Math.hypot(aim.current.x, aim.current.z);
    if (flat > 1e-4) {
      aim.current.x /= flat;
      aim.current.z /= flat;
    }

    // Place the rig: at the lamp, turned to the smoothed heading. Three.js yaw
    // θ carries forward (−Z) to (−sin θ, 0, −cos θ), so θ = atan2(−x, −z).
    const sinT = Math.sin(tilt.current);
    const cosT = Math.cos(tilt.current);
    // The mount point follows the full airframe transform, so the lamp stays on
    // the nose when the aircraft pitches; the beam's own aim is set below.
    mount.set(0, LIGHT_OFFSET_Y, LIGHT_OFFSET_Z).applyQuaternion(dronePose.quaternion).add(p);
    g.position.copy(mount);
    g.quaternion.setFromAxisAngle(up, Math.atan2(-aim.current.x, -aim.current.z));

    // THE AXIS, world space — down, leaning toward the heading. It is exactly
    // the rig-local target direction (0, −cos, −sin) turned by the rig's yaw,
    // and it is what the tiger detection is given below.
    aimDir.set(aim.current.x * sinT, -cosT, aim.current.z * sinT);

    // Take-off gate
    const support = useSimStore.getState().support;
    const d = support.distances;
    const height = Math.min(d[0], d[1], d[2], d[3]);
    const status = useFlightStore.getState().status();
    const live = status === 'armed' || status === 'flying';

    // Only reset light if resting on pad/surface while not in flight, or if crashed.
    // Flying low or skimming bumps must NEVER turn off the light!
    const isResting = support.contactState === 'SUPPORTED' && status !== 'flying';
    const isCrashed = support.contactState === 'CRASHED';
    const footDown = isResting || isCrashed;

    const ramp = lampRamp(height, live);
    held.current = lampHold(ramp, held.current, live, footDown);
    const wanted = Math.max(ramp, held.current);
    lamp.current += (wanted - lamp.current) * (1 - Math.exp(-LAMP_LERP * dt));
    const on = lamp.current;

    // What the middle of the pool lands on, for the iris. The same axis the
    // light is aimed along and the Director judges with.
    lampAt.copy(mount);
    const axisHit = castAlong(lampAt, aimDir, rayEnd);
    irisAgl.current += (axisHit - irisAgl.current) * (1 - Math.exp(-IRIS_LERP * dt));

    // Clamp effective altitude to minimum 1.0 m for iris calculation so the lamp never dims to near-black
    const effectiveAgl = Math.max(1.0, irisAgl.current);

    // Target in the RIG'S LOCAL space: 10 m ahead of the nose along the lean.
    // Its world matrix is updated by the renderer with the rest of the rig.
    if (light.current) {
      if (!light.current.target.parent) g.add(light.current.target);
      light.current.target.position.set(0, -cosT * 10, -sinT * 10);
      light.current.intensity = LIGHT_INTENSITY * on * lampExposure(effectiveAgl);

      // Redraw the shadow only while the tiger is near the beam, plus one frame
      // after it leaves.
      let tigerNear = false;
      if (shadows && tigerPose.present && on > 0.01) {
        const dx = tigerPose.x - lampAt.x;
        const dy = tigerPose.y - lampAt.y;
        const dz = tigerPose.z - lampAt.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 1e-3 && dist < SHADOW_FAR) {
          const cosOff = (dx * aimDir.x + dy * aimDir.y + dz * aimDir.z) / dist;
          tigerNear = cosOff > Math.cos(Math.min(Math.PI / 2, angle * SHADOW_CONE_MARGIN));
        }
      }
      if (tigerNear || shadowWasLive.current) light.current.shadow.needsUpdate = true;
      shadowWasLive.current = tigerNear;
    }

    // Lens glow: subtle white illumination on optic face
    lensMat.color.copy(lensBase).multiplyScalar(on * 0.9);

    // Publish the beam exactly as it was drawn, for the Director to judge.
    beamPose.x = lampAt.x;
    beamPose.y = lampAt.y;
    beamPose.z = lampAt.z;
    beamPose.dx = aimDir.x;
    beamPose.dy = aimDir.y;
    beamPose.dz = aimDir.z;
    beamPose.present = true;
  });

  if (!track) return null;

  return (
    <group ref={rig}>
      {/*
        Mount pod bracket: sits flush under the drone belly (battery bottom).
        Compact aerodynamic searchlight housing attached directly to the airframe.
      */}
      <mesh material={housingMat} position={[0, 0.006, 0]}>
        <cylinderGeometry args={[0.02, 0.022, 0.012, 16]} />
      </mesh>
      <mesh material={housingMat} position={[0, 0.001, 0]}>
        <cylinderGeometry args={[0.022, 0.019, 0.002, 16]} />
      </mesh>

      {/* Downward optic lens, at the rig origin — which is the lamp. */}
      <mesh material={lensMat} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.017, 16]} />
      </mesh>

      {/*
        The SpotLight, at the lamp. Casts shadows on Medium/High — see SHADOW.
        Its target is a child of this rig too (added in the effect above).
      */}
      <spotLight
        ref={light}
        // At the lamp. NOT optional: without it three.js places a SpotLight at
        // (0, 1, 0), a metre above the drone.
        position={[0, 0, 0]}
        angle={angle}
        intensity={0}
        penumbra={LIGHT_PENUMBRA}
        decay={2}
        color={LIGHT_COLOR}
        distance={LIGHT_DISTANCE}
        castShadow={shadows}
        shadow-mapSize={[SHADOW_MAP, SHADOW_MAP]}
        shadow-bias={SHADOW_BIAS}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
        shadow-camera-near={SHADOW_NEAR}
        shadow-camera-far={SHADOW_FAR}
      />
    </group>
  );
}

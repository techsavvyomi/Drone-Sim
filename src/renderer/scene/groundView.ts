import * as THREE from 'three';
import type { DroneSpec, EnvironmentSpec } from '@shared/types';
import { DEG2RAD } from '../sim/mathx';

// The pure geometry behind the ground view (orbit mode): where the pilot stands,
// and which way they have to turn to keep the aircraft in sight.
//
// Kept out of CameraRig.tsx so it can be unit tested without React, drei or a
// WebGL context.

/** Eye height of a standing pilot, above the pad. */
export const PILOT_EYE_HEIGHT = 1.6;

/**
 * How far back from the pad the pilot stands, scaled to the airframe so a
 * 160 mm whoop is not a speck the moment it lifts and a 450-class quad is not
 * in the pilot's face. Clamped: below about 2.5 m the drone fills the frame at
 * takeoff, and beyond 9 m the pad itself is hard to read.
 */
export function pilotStandoff(spec: DroneSpec): number {
  const span = Math.max(spec.armLength * 2, 0.1);
  return THREE.MathUtils.clamp(span * 8, 2.5, 9);
}

/**
 * The pilot's standing spot: behind the pad along the spawn heading, at eye
 * height.
 *
 * Indoors it is pulled back inside the room. Classroom 2 spawns 3.2 m from one
 * end wall and the Forest clearing has no walls at all, so a standoff applied
 * blindly would put the camera inside the plaster on the one map that has any.
 */
export function pilotAnchor(
  spec: DroneSpec,
  env: EnvironmentSpec,
  out: THREE.Vector3,
): THREE.Vector3 {
  const standoff = pilotStandoff(spec);
  const h = env.spawn.heading * DEG2RAD;
  out.set(
    env.spawn.position[0] + Math.sin(h) * standoff,
    env.spawn.position[1] + PILOT_EYE_HEIGHT,
    env.spawn.position[2] + Math.cos(h) * standoff,
  );

  if (env.kind === 'indoor') {
    const pad = 0.5;
    out.x = THREE.MathUtils.clamp(out.x, env.bounds.min[0] + pad, env.bounds.max[0] - pad);
    out.z = THREE.MathUtils.clamp(out.z, env.bounds.min[2] + pad, env.bounds.max[2] - pad);
    out.y = THREE.MathUtils.clamp(out.y, env.bounds.min[1] + 0.5, env.bounds.max[1] - 0.2);
  }
  return out;
}

/**
 * Heading and elevation that point a camera down `dir`, as a YXZ Euler with no
 * roll.
 *
 * Deliberately not `lookAt`: with a fixed up vector, a target passing directly
 * overhead rolls the horizon right over, and a drone climbing above the pilot
 * is the most ordinary thing in this view. Angles stay well behaved there —
 * pitch simply reaches a right angle — and they can be damped, which a
 * quaternion from `lookAt` cannot be without the same flip.
 */
export function aimYaw(dir: THREE.Vector3): number {
  return Math.atan2(-dir.x, -dir.z);
}

export function aimPitch(dir: THREE.Vector3): number {
  return Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
}

/** An angle folded into (-PI, PI], so a turn always takes the short way round. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

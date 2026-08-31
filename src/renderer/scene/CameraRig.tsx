import { useLayoutEffect, useRef, type ComponentRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { DroneSpec, EnvironmentSpec } from '@shared/types';
import { useUiStore } from '../state/uiStore';
import { useSettingsStore } from '../state/settingsStore';
import { dronePose } from '../sim/drone/pose';
import { DEG2RAD, damp } from '../sim/mathx';
import { decayShake } from '../sim/effects';

// Positions the R3F camera for chase and FPV modes. Orbit mode is handled by
// OrbitCamera below (this rig no-ops so it doesn't fight the user's drag).

const _yawQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _offset = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();
const _currentLook = new THREE.Vector3();
const _tilt = new THREE.Quaternion();
const _mount = new THREE.Vector3();
const _trail = new THREE.Vector3();
const _pivotStep = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Chase distance scales with the airframe so a 20 cm whoop and a 450-class quad
// both fill roughly the same amount of frame.
function chaseOffset(spec: DroneSpec): THREE.Vector3 {
  const span = Math.max(spec.armLength * 2, 0.1);
  return new THREE.Vector3(0, span * 3.2, span * 9);
}

export function CameraRig({ spec, env }: { spec: DroneSpec; env?: EnvironmentSpec }) {
  const camera = useThree((s) => s.camera);
  const mode = useUiStore((s) => s.cameraMode);
  // Chase distance scales with the user's zoom preference, applied live.
  const zoom = useSettingsStore((s) => s.settings.cameraZoom);
  const CHASE_OFFSET = chaseOffset(spec).multiplyScalar(zoom);

  useFrame((_state, delta) => {
    if (!dronePose.present || mode === 'orbit') return;

    // Impact shake, decaying over time. Applied as a camera offset so it never
    // perturbs the simulation itself.
    const shake = decayShake(delta);

    if (mode === 'chase') {
      // Follow heading (yaw only) so the view turns with the drone but stays level.
      _euler.setFromQuaternion(dronePose.quaternion, 'YXZ');
      _yawQuat.setFromAxisAngle(UP, _euler.y);
      _offset.copy(CHASE_OFFSET).applyQuaternion(_yawQuat);
      _target.copy(dronePose.position).add(_offset);

      // Clamp camera + look target inside indoor room so chase never clips
      // into wall interiors (grey faces / "invisible" Pluto) when pitching back.
      if (env && env.kind === 'indoor') {
        const padding = 0.55;
        _target.x = THREE.MathUtils.clamp(_target.x, env.bounds.min[0] + padding, env.bounds.max[0] - padding);
        _target.z = THREE.MathUtils.clamp(_target.z, env.bounds.min[2] + padding, env.bounds.max[2] - padding);
        _target.y = THREE.MathUtils.clamp(_target.y, Math.max(env.bounds.min[1] + 0.85, 0.85), env.bounds.max[1] - 0.25);
      }

      // Follow rate rises with how far behind the camera has fallen.
      //
      // A fixed rate is fine for cruising and fails badly the moment the drone
      // moves quickly: chopping the throttle in Altitude Hold cuts thrust
      // outright, so the aircraft free-falls and gains ~10 m/s every second,
      // while a camera easing at a constant lambda simply cannot keep up. The
      // drone slid out of frame and the pilot lost it completely.
      //
      // Scaling with the error means the camera is unhurried when nothing much
      // is happening, and snaps to a hard chase when the drone is getting away.
      const err = Math.hypot(
        _target.x - camera.position.x,
        _target.y - camera.position.y,
        _target.z - camera.position.z,
      );
      const lambda = 8 + Math.min(err, 25) * 1.4;

      camera.position.x = damp(camera.position.x, _target.x, lambda, delta);
      camera.position.y = damp(camera.position.y, _target.y, lambda, delta);
      camera.position.z = damp(camera.position.z, _target.z, lambda, delta);

      // Hard ceiling on how far the camera may trail, as a fraction of its own
      // chase distance.
      //
      // Damping alone cannot guarantee this. The chase offset is scaled to the
      // airframe, so on a 160 mm Pluto the camera sits about 1.4 m back — and at
      // a 60 degree field of view that frames barely 1.7 m. A second of free-fall
      // outruns any sane lambda, and the drone is simply gone off the bottom of
      // the screen. Clamping the trail keeps it on screen no matter how hard it
      // falls, while everything short of the limit still eases naturally.
      const maxTrail = CHASE_OFFSET.length() * 0.5;
      _trail.set(
        camera.position.x - _target.x,
        camera.position.y - _target.y,
        camera.position.z - _target.z,
      );
      const trailLen = _trail.length();
      if (trailLen > maxTrail) {
        _trail.multiplyScalar(maxTrail / trailLen);
        camera.position.set(
          _target.x + _trail.x,
          _target.y + _trail.y,
          _target.z + _trail.z,
        );
      }

      // Aim just above the airframe, scaled to its size.
      _look.copy(dronePose.position).addScaledVector(UP, spec.armLength * 1.5);
      if (env && env.kind === 'indoor') {
        const lookPad = 0.35;
        _look.x = THREE.MathUtils.clamp(_look.x, env.bounds.min[0] + lookPad, env.bounds.max[0] - lookPad);
        _look.z = THREE.MathUtils.clamp(_look.z, env.bounds.min[2] + lookPad, env.bounds.max[2] - lookPad);
        _look.y = THREE.MathUtils.clamp(_look.y, 0.3, env.bounds.max[1] - 0.2);
      }
      // Where the camera LOOKS tracks the drone far more tightly than where it
      // sits. Position lag is what gives a chase camera its weight; aim lag just
      // walks the aircraft off the edge of the screen. Keeping this fast means
      // that even when the camera is trailing badly the drone stays centred in
      // frame — further away, but never lost.
      const lookLambda = Math.max(lambda, 20);
      _currentLook.x = damp(_currentLook.x, _look.x, lookLambda, delta);
      _currentLook.y = damp(_currentLook.y, _look.y, lookLambda, delta);
      _currentLook.z = damp(_currentLook.z, _look.z, lookLambda, delta);
      camera.lookAt(_currentLook);

      if (shake > 0.001) {
        const a = shake * 0.35;
        camera.position.x += (Math.random() - 0.5) * a;
        camera.position.y += (Math.random() - 0.5) * a;
        camera.position.z += (Math.random() - 0.5) * a;
      }
    } else if (mode === 'fpv') {
      // Onboard camera: mount offset in body frame, oriented with the drone plus
      // the camera's downward tilt.
      _mount.set(...spec.cameraMount.position).applyQuaternion(dronePose.quaternion);
      camera.position.copy(dronePose.position).add(_mount);

      _tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), spec.cameraMount.tiltDeg * DEG2RAD);
      camera.quaternion.copy(dronePose.quaternion).multiply(_tilt);
    }
  });

  return null;
}

// Orbit mode. OrbitControls owns the angle and the zoom, but the point it
// orbits has to be the drone: pinned to the spawn point, flying more than a few
// metres away left the pilot orbiting empty air with the aircraft off screen.
//
// The pivot is moved and the camera is moved by exactly the same amount, so the
// pilot's orbit angle and distance survive the follow untouched — the view pans
// with the drone rather than being re-aimed behind its back.
export function OrbitCamera({ spec }: { spec: DroneSpec }) {
  const camera = useThree((s) => s.camera);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const pinned = useRef(false);

  // Aim just above the airframe, as chase does, so the props are not dead
  // centre of frame.
  const lookTarget = (out: THREE.Vector3) =>
    out.copy(dronePose.position).addScaledVector(UP, spec.armLength * 1.5);

  // Snap the pivot onto the drone while keeping the camera exactly where the
  // previous mode left it. Done before the first frame, otherwise OrbitControls
  // aims at the world origin for one frame and the view visibly whips across.
  const pin = () => {
    const c = controls.current;
    if (!c || !dronePose.present) return;
    lookTarget(_look);
    _offset.copy(camera.position).sub(c.target);
    c.target.copy(_look);
    camera.position.copy(_look).add(_offset);
    c.update();
    pinned.current = true;
  };

  useLayoutEffect(pin, []);

  useFrame((_state, delta) => {
    const c = controls.current;
    if (!c || !dronePose.present) return;
    // The drone may not have existed yet at mount (respawn, scene swap).
    if (!pinned.current) {
      pin();
      return;
    }

    lookTarget(_look);

    // Error-scaled follow rate, for the same reason chase uses one: a constant
    // rate cannot keep up with a free fall and the drone leaves the frame.
    const err = _look.distanceTo(c.target);
    const lambda = 8 + Math.min(err, 25) * 1.4;
    _target.set(
      damp(c.target.x, _look.x, lambda, delta),
      damp(c.target.y, _look.y, lambda, delta),
      damp(c.target.z, _look.z, lambda, delta),
    );

    // Runs after OrbitControls' own update (drei schedules it at priority -1),
    // so the camera is already aimed at the old pivot. Shifting both by the
    // same step leaves that aim correct and simply carries the whole orbit
    // along with the aircraft.
    _pivotStep.copy(_target).sub(c.target);
    c.target.copy(_target);
    camera.position.add(_pivotStep);
  });

  return <OrbitControls ref={controls} makeDefault maxPolarAngle={Math.PI / 2.05} />;
}

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
import { aimPitch, aimYaw, pilotAnchor, wrapAngle } from './groundView';

// Positions the R3F camera for chase and FPV modes. The ground view (orbit
// mode) is handled by OrbitCamera below, and this rig no-ops there so it does
// not fight the pilot's drag.

const _yawQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _offset = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();
const _currentLook = new THREE.Vector3();
const _tilt = new THREE.Quaternion();
const _mount = new THREE.Vector3();
const _trail = new THREE.Vector3();
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
      // the camera's uptilt.
      //
      // The mount has to be inflated by sizeScale, exactly as DroneModel inflates
      // the model it is mounted on. It is authored against the TRUE airframe, so
      // left unscaled it lands deep inside a drone drawn 2.5x bigger: on the Guru
      // the "nose camera" sat under the fuselage looking up at its own belly, and
      // FPV showed the airframe rather than the world ahead of it.
      _mount
        .set(...spec.cameraMount.position)
        .multiplyScalar(spec.sizeScale ?? 1)
        .applyQuaternion(dronePose.quaternion);
      camera.position.copy(dronePose.position).add(_mount);

      _tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), spec.cameraMount.tiltDeg * DEG2RAD);
      camera.quaternion.copy(dronePose.quaternion).multiply(_tilt);
    }
  });

  return null;
}

// Ground view (orbit mode). The camera stands where the pilot stands: a fixed
// spot beside the pad, at eye height, that does not move with the aircraft. It
// only turns, exactly as a pilot flying line of sight turns to face their own
// drone — however far it goes, it stays in view, and it genuinely shrinks with
// distance instead of being followed at a constant size.
//
// Two consequences are deliberate. The engine note falls away with the drone,
// because DroneAudio measures from the camera. And the wheel works the lens
// rather than the legs: it narrows the field of view so a distant aircraft can
// still be read, while OrbitControls' own dolly is off — moving the camera in
// and out is precisely what this view must never do.
//
// Drag still orbits, but about the PAD rather than the drone: it walks the
// pilot around their own takeoff point. OrbitControls owns that position; the
// aim is overwritten afterwards at default `useFrame` priority, so it lands
// after drei's controls update (priority −1) and wins.
const MIN_FOV = 12;
const _dir = new THREE.Vector3();
const _anchor = new THREE.Vector3();

export function OrbitCamera({ spec, env }: { spec: DroneSpec; env: EnvironmentSpec }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const yaw = useRef(0);
  const pitch = useRef(0);
  const baseFov = useRef(60);

  // Stand the camera up before the first frame is drawn, otherwise the view
  // visibly whips across from wherever the previous mode left it.
  useLayoutEffect(() => {
    const c = controls.current;
    if (!c) return;
    camera.position.copy(pilotAnchor(spec, env, _anchor));
    c.target.set(
      env.spawn.position[0],
      env.spawn.position[1] + spec.armLength * 1.5,
      env.spawn.position[2],
    );
    c.update();

    _dir.copy(c.target).sub(camera.position);
    yaw.current = aimYaw(_dir);
    pitch.current = aimPitch(_dir);
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      baseFov.current = (camera as THREE.PerspectiveCamera).fov;
    }
  }, [camera, spec, env]);

  // Wheel zooms the lens, and the lens is put back on the way out — left
  // narrowed, chase and FPV would inherit a telephoto view.
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      cam.fov = THREE.MathUtils.clamp(cam.fov * Math.exp(e.deltaY * 0.0015), MIN_FOV, baseFov.current);
      cam.updateProjectionMatrix();
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      cam.fov = baseFov.current;
      cam.updateProjectionMatrix();
    };
  }, [camera, gl]);

  useFrame((_state, delta) => {
    if (!controls.current || !dronePose.present) return;

    // Aim just above the airframe, as chase does, so the props are not dead
    // centre of frame.
    _look.copy(dronePose.position).addScaledVector(UP, spec.armLength * 1.5);
    _dir.copy(_look).sub(camera.position);

    // Error-scaled turn rate, for the same reason chase uses one: a constant
    // rate cannot keep up with a fast pass close by, where a few metres of
    // travel is most of a right angle of head turn.
    const dYaw = wrapAngle(aimYaw(_dir) - yaw.current);
    const dPitch = aimPitch(_dir) - pitch.current;
    const lambda = 12 + Math.min(Math.max(Math.abs(dYaw), Math.abs(dPitch)), 1.5) * 12;
    yaw.current = wrapAngle(yaw.current + damp(0, dYaw, lambda, delta));
    pitch.current += damp(0, dPitch, lambda, delta);

    _euler.set(pitch.current, yaw.current, 0, 'YXZ');
    camera.quaternion.setFromEuler(_euler);
  });

  // Pan would move the pad out from under the orbit, and the dolly would move
  // the pilot; both are the one thing this view exists to prevent.
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableZoom={false}
      minPolarAngle={0.2}
      maxPolarAngle={Math.PI / 2.05}
    />
  );
}

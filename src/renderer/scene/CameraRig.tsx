import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DroneSpec, EnvironmentSpec } from '@shared/types';
import { useUiStore } from '../state/uiStore';
import { useSettingsStore } from '../state/settingsStore';
import { dronePose } from '../sim/drone/pose';
import { DEG2RAD, damp } from '../sim/mathx';
import { decayShake } from '../sim/effects';

// Positions the R3F camera for chase and FPV modes. Orbit mode is left to
// OrbitControls (this rig no-ops so it doesn't fight the user's drag).

const _yawQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _offset = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();
const _currentLook = new THREE.Vector3();
const _tilt = new THREE.Quaternion();
const _mount = new THREE.Vector3();
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

      const lambda = 8;
      camera.position.x = damp(camera.position.x, _target.x, lambda, delta);
      camera.position.y = damp(camera.position.y, _target.y, lambda, delta);
      camera.position.z = damp(camera.position.z, _target.z, lambda, delta);

      // Aim just above the airframe, scaled to its size.
      _look.copy(dronePose.position).addScaledVector(UP, spec.armLength * 1.5);
      if (env && env.kind === 'indoor') {
        const lookPad = 0.35;
        _look.x = THREE.MathUtils.clamp(_look.x, env.bounds.min[0] + lookPad, env.bounds.max[0] - lookPad);
        _look.z = THREE.MathUtils.clamp(_look.z, env.bounds.min[2] + lookPad, env.bounds.max[2] - lookPad);
        _look.y = THREE.MathUtils.clamp(_look.y, 0.3, env.bounds.max[1] - 0.2);
      }
      _currentLook.x = damp(_currentLook.x, _look.x, lambda, delta);
      _currentLook.y = damp(_currentLook.y, _look.y, lambda, delta);
      _currentLook.z = damp(_currentLook.z, _look.z, lambda, delta);
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

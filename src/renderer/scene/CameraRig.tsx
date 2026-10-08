import { useLayoutEffect, useRef, type ComponentRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { DroneSpec, EnvironmentSpec } from '@shared/types';
import { useUiStore } from '../state/uiStore';
import { useFlightStore } from '../state/flightStore';
import { useSettingsStore } from '../state/settingsStore';
import { dronePose } from '../sim/drone/pose';
import { DEG2RAD, damp, spring } from '../sim/mathx';
import { decayShake } from '../sim/effects';
import { aimPitch, aimYaw, pilotAnchor, wrapAngle } from './groundView';
import { staticHitDistance, staticSweepDistance } from './cameraProbe';
import { chaseReport } from './cameraReport';

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
const _pivot = new THREE.Vector3();
const _over = new THREE.Vector3();
const _free = new THREE.Vector3();

/** How long the line behind the drone must stay clear before the camera drops
 *  back from overhead, seconds. Stops it bobbing up and down past a corner.
 *  Chosen by judgement. */
const RETURN_HOLD = 0.35;
/** How long the line behind must stay blocked before the camera rises at all,
 *  seconds. Something passing between camera and drone is handled by the
 *  pull-in; only a lasting block is worth going overhead for. Chosen by
 *  judgement. */
const RISE_HOLD = 0.3;
/** Roughly how long the camera takes to rise over the drone, and to come back
 *  down, s. Chosen by judgement. */
const RISE_TIME = 0.7;
const DROP_TIME = 0.9;
/** Largest radius of the ball the camera is treated as when checking what is
 *  in its way, m — it is also how far the camera stays off a wall. Smaller on a
 *  small drone, whose whole chase distance is barely a metre and a half. */
const WALL_GAP = 0.3;
/** How far above the drone's origin the swept ball's underside starts, m —
 *  clear of the 24 mm the airframe rests above the ground, and of small bumps. */
const PIVOT_CLEAR = 0.08;
/** Roughly how long the camera takes to slide in toward the drone when
 *  something comes between them, and to drift back out once it has gone, s.
 *  In is quick, so the drone is not hidden for long; out is slow, the way an
 *  operator eases back rather than springing. Chosen by judgement. */
const PULL_IN_TIME = 0.12;
const PULL_OUT_TIME = 0.6;

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
  // 0 = the normal spot behind the drone, 1 = up over it looking down. Springs,
  // not plain easing: they carry their speed from frame to frame, so every move
  // starts and stops gently instead of lurching off at full rate.
  const overhead = useRef({ value: 0, vel: 0 });
  const clearFor = useRef(0);
  const blockedFor = useRef(0);
  // Where the camera would be with nothing in the way — the easing's own state,
  // kept apart from the rendered position so a wall pull-in never feeds back
  // into it — and how far in from there the wall currently holds it, m.
  const freeReady = useRef(false);
  const pull = useRef({ value: 0, vel: 0 });
  const acroHeading = useRef<number | null>(null);
  const seenReset = useRef(-1);

  useFrame((_state, delta) => {
    if (!dronePose.present || mode !== 'chase') {
      acroHeading.current = null;
      freeReady.current = false;
      chaseReport.pulledIn = 0;
    }
    if (!dronePose.present || mode === 'orbit') return;

    // Impact shake, decaying over time. Applied as a camera offset so it never
    // perturbs the simulation itself.
    const shake = decayShake(delta);

    if (mode === 'chase') {
      if (seenReset.current !== dronePose.resetVersion) {
        seenReset.current = dronePose.resetVersion;
        acroHeading.current = dronePose.spawnHeading;
        overhead.current.value = 0;
        overhead.current.vel = 0;
        clearFor.current = 0;
        blockedFor.current = 0;
        pull.current.value = 0;
        pull.current.vel = 0;
        chaseReport.pulledIn = 0;
        _yawQuat.setFromAxisAngle(UP, dronePose.spawnHeading);
        _free.copy(CHASE_OFFSET).applyQuaternion(_yawQuat).add(dronePose.position);
        camera.position.copy(_free);
        _currentLook.copy(dronePose.position).addScaledVector(UP, spec.armLength * 1.5);
        freeReady.current = true;
      }
      // Euler yaw jumps 180 degrees during a pitch flip. In Acro, follow the
      // twist of the attitude about world UP instead: it turns with the drone's
      // yaw but stays continuous through flips and rolls. Only exactly inverted
      // is it undefined, and there the last heading is held.
      if (useFlightStore.getState().mode === 'acro') {
        const q = dronePose.quaternion;
        if (Math.hypot(q.y, q.w) > 0.15) acroHeading.current = 2 * Math.atan2(q.y, q.w);
        else if (acroHeading.current === null) acroHeading.current = dronePose.spawnHeading;
        _yawQuat.setFromAxisAngle(UP, acroHeading.current);
      } else {
        acroHeading.current = null;
        _euler.setFromQuaternion(dronePose.quaternion, 'YXZ');
        _yawQuat.setFromAxisAngle(UP, _euler.y);
      }
      camera.up.copy(UP);
      _offset.copy(CHASE_OFFSET).applyQuaternion(_yawQuat);
      _target.copy(dronePose.position).add(_offset);

      // A building behind the drone: go up and over it instead.
      //
      // The chase spot is a fixed point behind the airframe, and in a city that
      // point is often inside a tower — lifting off a pad beside one showed the
      // pilot the inside of the building. The line from the drone to that spot
      // is cast against the static world; while it is blocked the camera eases
      // up over the drone, looking down, and it drops back only once the line
      // has stayed clear for a moment.
      //
      // It used to rise the very frame the line was blocked, and quickly, so
      // anything drifting past sent the view shooting up over the drone. Now
      // the block has to last before it rises, the rise is a spring (eases in
      // and out), and it does not rise at all when the overhead spot is blocked
      // too — with something over the drone, going up only runs into it. The
      // lines are swept with a ball the camera's size, so skimming past an
      // edge does not flicker between blocked and clear.
      const outdoor = !env || env.kind !== 'indoor';
      const len = CHASE_OFFSET.length();
      const camRadius = THREE.MathUtils.clamp(len * 0.12, 0.08, WALL_GAP);
      // The sweeps start with the ball CLEAR of whatever the drone stands on.
      // At armLength x 1.5 alone the ball (up to 0.3 m) began sunk into the
      // ground under a parked drone — 0.23 m up on the Racing Drone, 0.17 m on
      // the Guru — so on uneven ground (the Forest's terrain, a kerb) the first
      // bump behind read as "blocked": the camera went overhead and the
      // pull-in dragged it into the airframe.
      _pivot
        .copy(dronePose.position)
        .addScaledVector(UP, Math.max(spec.armLength * 1.5, camRadius + PIVOT_CLEAR));
      if (outdoor) {
        // A little behind as well as above, so lookAt never points straight
        // down along the camera's up vector.
        _over
          .set(0, len * 0.95, len * 0.35)
          .applyQuaternion(_yawQuat)
          .add(dronePose.position);
        const blocked = staticSweepDistance(_pivot, _target, camRadius) < Infinity;
        clearFor.current = blocked ? 0 : clearFor.current + delta;
        blockedFor.current = blocked ? blockedFor.current + delta : 0;
        const rising = overhead.current.value > 0.01;
        const want =
          (blocked && (rising || blockedFor.current >= RISE_HOLD)) ||
          (rising && !blocked && clearFor.current < RETURN_HOLD)
            ? 1
            : 0;
        const overClear = want === 0 || staticSweepDistance(_pivot, _over, camRadius) === Infinity;
        const goal = overClear ? want : 0;
        const t = spring(overhead.current, goal, goal ? RISE_TIME : DROP_TIME, delta);
        if (t > 0.001) _target.lerp(_over, t);
      } else {
        overhead.current.value = 0;
        overhead.current.vel = 0;
      }

      // Clamp camera + look target inside indoor room so chase never clips
      // into wall interiors (grey faces / "invisible" Pluto) when pitching back.
      if (env && env.kind === 'indoor') {
        const padding = 0.55;
        _target.x = THREE.MathUtils.clamp(
          _target.x,
          env.bounds.min[0] + padding,
          env.bounds.max[0] - padding,
        );
        _target.z = THREE.MathUtils.clamp(
          _target.z,
          env.bounds.min[2] + padding,
          env.bounds.max[2] - padding,
        );
        _target.y = THREE.MathUtils.clamp(
          _target.y,
          Math.max(env.bounds.min[1] + 0.85, 0.85),
          env.bounds.max[1] - 0.25,
        );
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
      if (!freeReady.current) {
        _free.copy(camera.position);
        pull.current.value = 0;
        pull.current.vel = 0;
        freeReady.current = true;
      }
      const err = Math.hypot(_target.x - _free.x, _target.y - _free.y, _target.z - _free.z);
      const lambda = 8 + Math.min(err, 25) * 1.4;

      _free.x = damp(_free.x, _target.x, lambda, delta);
      _free.y = damp(_free.y, _target.y, lambda, delta);
      _free.z = damp(_free.z, _target.z, lambda, delta);

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
      _trail.subVectors(_free, _target);
      const trailLen = _trail.length();
      if (trailLen > maxTrail) {
        _trail.multiplyScalar(maxTrail / trailLen);
        _free.addVectors(_target, _trail);
      }
      camera.position.copy(_free);

      // Something between the camera and the drone: slide in along the line,
      // like a camera boom retracting, to just short of it.
      //
      // Placed straight at the hit, as it once was, the camera jumped in the
      // frame a ledge or a bridge came between it and the drone, jumped back
      // out the frame it cleared, and chattered along an edge. Now how far in
      // it is held is a spring: in quickly, back out slowly, never a jump. A
      // ledge or beam merely between the two may cover the drone for a moment
      // while it slides; only when the camera's own spot is inside something
      // solid (a ray cast back from it hits at once — the cast is solid) is it
      // put in front of the hit immediately, so the view is never from inside
      // a building.
      if (outdoor) {
        const d = _pivot.distanceTo(_free);
        const hit = staticSweepDistance(_pivot, _free, camRadius);
        const want = hit < Infinity ? Math.max(d - Math.max(hit, 0.2), 0) : 0;
        const p = pull.current;
        spring(p, want, want > p.value ? PULL_IN_TIME : PULL_OUT_TIME, delta);
        if (want > p.value && staticHitDistance(_free, _pivot) < 0.05) {
          p.value = want;
          p.vel = 0;
        }
        if (p.value > 1e-3 && d > 1e-3) {
          camera.position.lerpVectors(_pivot, _free, Math.max(d - p.value, 0.2) / d);
        }
        chaseReport.pulledIn = p.value > 1e-3 && d > 1e-3 ? p.value : 0;
        chaseReport.distance = Math.max(d - p.value, 0.2);
      } else {
        pull.current.value = 0;
        pull.current.vel = 0;
        chaseReport.pulledIn = 0;
      }

      // Aim just above the airframe, scaled to its size.
      _look.copy(dronePose.position).addScaledVector(UP, spec.armLength * 1.5);
      if (env && env.kind === 'indoor') {
        const lookPad = 0.35;
        _look.x = THREE.MathUtils.clamp(
          _look.x,
          env.bounds.min[0] + lookPad,
          env.bounds.max[0] - lookPad,
        );
        _look.z = THREE.MathUtils.clamp(
          _look.z,
          env.bounds.min[2] + lookPad,
          env.bounds.max[2] - lookPad,
        );
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
      cam.fov = THREE.MathUtils.clamp(
        cam.fov * Math.exp(e.deltaY * 0.0015),
        MIN_FOV,
        baseFov.current,
      );
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

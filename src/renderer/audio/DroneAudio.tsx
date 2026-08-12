import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { clamp } from '../sim/mathx';
import { dronePose } from '../sim/drone/pose';
import { useFlightStore } from '../state/flightStore';
import { useSettingsStore } from '../state/settingsStore';
import { useSimStore } from '../state/simStore';
import { useUiStore } from '../state/uiStore';
import { dopplerFactor, MotorAudio, motorAudioConfig } from './motorAudio';
import { playArm, playBatteryBeep, playDisarm, playImpact } from './sfx';

// Drives the synthesised engine (motorAudio.ts) from the live simulation, and
// fires the flight-event one-shots that belong to the drone rather than the UI.
//
// Mounted inside the Canvas because the interesting half of the job is
// positional: where the drone is relative to the camera decides how loud, how
// dull, how far left or right, and how pitch-shifted it sounds.

/** How wide the stereo image is. Full hard-panning is disorienting in flight. */
const PAN_WIDTH = 0.75;

/** Buzzer intervals, seconds — warning nags, critical insists. */
const BEEP_WARNING = 2;
const BEEP_CRITICAL = 0.7;

/** Time constant for smoothing frame-differentiated velocities, seconds. */
const VELOCITY_SMOOTH = 0.06;

const _dronePos = new THREE.Vector3();
const _toDrone = new THREE.Vector3();
const _right = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _relative = new THREE.Vector3();

export function DroneAudio({ spec }: { spec: DroneSpec }) {
  // Built in the effect, not a useMemo: StrictMode runs the memo factory twice
  // but only ever cleans up one instance, and a MotorAudio nobody disposes is
  // four oscillators playing for the rest of the session.
  const engine = useRef<MotorAudio | null>(null);
  useEffect(() => {
    const e = new MotorAudio(motorAudioConfig(spec));
    engine.current = e;
    return () => {
      e.dispose();
      if (engine.current === e) engine.current = null;
    };
  }, [spec]);

  const droneVel = useRef(new THREE.Vector3());
  const cameraVel = useRef(new THREE.Vector3());
  const prevDrone = useRef<THREE.Vector3 | null>(null);
  const prevCamera = useRef<THREE.Vector3 | null>(null);

  const prevArmed = useRef(false);
  const prevCrashed = useRef(false);
  const beepIn = useRef(0);

  useFrame((state, delta) => {
    const dt = clamp(delta, 1 / 480, 0.1);
    const flight = useFlightStore.getState();
    const sim = useSimStore.getState();
    const { engineVolume } = useSettingsStore.getState().settings;
    const fpv = useUiStore.getState().cameraMode === 'fpv';
    const camera = state.camera;

    // ---- Flight-event one-shots ----
    // These live here rather than in the training Director so the Fly view gets
    // them too; the Director used to own arm/disarm and nothing else did.
    if (flight.armed !== prevArmed.current) {
      if (flight.armed) playArm();
      else playDisarm();
      prevArmed.current = flight.armed;
    }
    if (flight.crashed !== prevCrashed.current) {
      if (flight.crashed) playImpact(flight.crashSpeed, flight.brokenProps.length > 0);
      prevCrashed.current = flight.crashed;
    }

    if (flight.armed && !flight.crashed && (flight.batteryWarning || flight.lowBattery)) {
      beepIn.current -= dt;
      if (beepIn.current <= 0) {
        playBatteryBeep(flight.lowBattery);
        beepIn.current = flight.lowBattery ? BEEP_CRITICAL : BEEP_WARNING;
      }
    } else {
      // Reset rather than decay, so the next warning beeps immediately.
      beepIn.current = 0;
    }

    // ---- Positional engine ----
    const motor = engine.current;
    if (!motor) return;

    if (dronePose.present) _dronePos.copy(dronePose.position);
    else _dronePos.set(...sim.position);

    // Velocities by differentiation, low-passed: a per-frame difference is
    // noisy enough that feeding it straight into Doppler makes the pitch
    // shimmer at framerate.
    const smooth = 1 - Math.exp(-dt / VELOCITY_SMOOTH);
    if (prevDrone.current) {
      _delta.subVectors(_dronePos, prevDrone.current).divideScalar(dt);
      droneVel.current.lerp(_delta, smooth);
    } else {
      prevDrone.current = new THREE.Vector3();
    }
    prevDrone.current.copy(_dronePos);

    if (prevCamera.current) {
      _delta.subVectors(camera.position, prevCamera.current).divideScalar(dt);
      cameraVel.current.lerp(_delta, smooth);
    } else {
      prevCamera.current = new THREE.Vector3();
    }
    prevCamera.current.copy(camera.position);

    _toDrone.subVectors(_dronePos, camera.position);
    const range = _toDrone.length();
    let pan = 0;
    let doppler = 1;
    if (range > 1e-3) {
      _toDrone.divideScalar(range);
      // Doppler on the RELATIVE closing speed, so a chase camera flying
      // alongside hears almost no shift — which is correct, and is why the
      // effect only really shows up on a fly-by past a static camera.
      _relative.subVectors(droneVel.current, cameraVel.current);
      doppler = dopplerFactor(_relative.dot(_toDrone));
      // Camera's own right vector, so panning follows wherever it is looking.
      _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      pan = clamp(_toDrone.dot(_right), -1, 1) * PAN_WIDTH;
    }

    motor.update(dt, {
      motors: sim.motors,
      armed: flight.armed && !flight.crashed,
      speed: Math.hypot(sim.groundSpeed, sim.verticalSpeed),
      altitude: sim.altitude,
      // In FPV the listener is bolted to the airframe: no distance, no panning,
      // and no Doppler, because nothing is moving relative to your ears.
      distance: fpv ? 0 : range,
      pan: fpv ? 0 : pan,
      doppler: fpv ? 1 : doppler,
      level: flight.paused ? 0 : clamp(engineVolume ?? 0.75, 0, 1),
    });
  });

  return null;
}

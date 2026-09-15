import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import type { Mission } from './types';

// ----------------------------------------------------------------------------
// The searchlight under the drone, on Mission 5.
//
// It is the mission's only instrument. There is no marker, no radar dot and no
// distance readout until the observation is done, so what the pilot flies is a
// pool of light over a dark forest — and the whole of the mission's difficulty
// is the trade the cone imposes: climb and the pool widens and dims, descend and
// it is bright, tight and moving too fast to hold anything in.
//
// It hangs BELOW and slightly AHEAD of the aircraft, pointing down. Not steered
// separately: the Guru has no gimbal, and giving the light its own axis would be
// a second aircraft to fly. The pilot aims it by flying.
//
// The angle and the reach are the mission's own numbers (`MissionTracking`), so
// the light the pilot sees and the light the runtime judges against cannot
// drift apart — the Director tests the same cone this draws.
// ----------------------------------------------------------------------------

/** How far in front of the drone the beam is aimed, metres, so the pilot sees
 *  where they are GOING rather than only where they are. Small: a lamp aimed
 *  too far ahead lights nothing under the aircraft, and the lock is judged on
 *  what is under it. */
const LEAD = 1.2;
/** How far below the airframe the lamp sits. Under the belly, clear of the
 *  props. */
const DROP = 0.14;

export function DroneSpotlight({ mission }: { mission: Mission }) {
  const light = useRef<THREE.SpotLight>(null);
  const target = useRef<THREE.Object3D>(null);
  const track = mission.tracking;

  /** Scratch. Nothing allocates in the frame loop. */
  const forward = useMemo(() => new THREE.Vector3(), []);

  // The cone is the mission's, in radians. `THREE.SpotLight.angle` is the HALF
  // angle, which is the same thing `coneDeg` means — see the Director, which
  // builds the ground pool from the tangent of exactly this number.
  const angle = ((track?.coneDeg ?? 28) * Math.PI) / 180;
  const range = track?.lightRange ?? 45;

  useEffect(() => {
    // The target has to be in the scene graph for three to read its world
    // matrix; it is added by being rendered below, and this only pairs them.
    if (light.current && target.current) light.current.target = target.current;
  }, []);

  useFrame(() => {
    const l = light.current;
    const t = target.current;
    if (!l || !t || !dronePose.present) return;

    const p = dronePose.position;
    // The aircraft's own forward, so the lead follows the nose rather than a
    // world axis. −Z is forward in this engine's convention.
    forward.set(0, 0, -1).applyQuaternion(dronePose.quaternion);
    // Flattened: the lead is a horizontal offset, not a tilt. A beam that
    // pitched with the airframe would swing wildly on every stick input, and
    // the pilot would be chasing their own light.
    forward.y = 0;
    if (forward.lengthSq() > 1e-6) forward.normalize();

    l.position.set(p.x, p.y - DROP, p.z);
    t.position.set(p.x + forward.x * LEAD, p.y - DROP - 10, p.z + forward.z * LEAD);
    t.updateMatrixWorld();
  });

  if (!track) return null;

  return (
    <>
      <spotLight
        ref={light}
        angle={angle}
        distance={range * 1.35}
        /* Raised with the light the mission is flown in. It was 140 against the
           `night` preset's ambient 0.22; `dusk` lifts the ground around the pool
           to 0.38 with the outdoor hemisphere back at 0.7, and at 140 the pool
           stopped being obviously brighter than what surrounded it. The beam has
           to WIN against the ambient, or the instrument is decoration — which is
           the same failure that ruled `evening` out. */
        intensity={190}
        penumbra={0.42}
        decay={1.35}
        color="#eef3ff"
        /* NO SHADOWS. A shadow-casting spot over a forest of five thousand
           trunk boxes is a second shadow pass across the whole canopy every
           frame, on a 512 MB integrated GPU that is already VRAM-bound. The
           pool reads perfectly well without one, and the mission never asks the
           pilot to judge anything by a shadow. */
        castShadow={false}
      />
      <object3D ref={target} />
    </>
  );
}

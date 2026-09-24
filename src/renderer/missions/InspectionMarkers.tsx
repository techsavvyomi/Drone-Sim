import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMissionStore } from '../state/missionStore';
import { useDisposable } from '../scene/useDisposable';
import { glowTexture } from './glowTexture';
import type { Mission, MissionInspectionPoint } from './types';

// ----------------------------------------------------------------------------
// The inspection zones as the pilot sees them: an amber marker on each
// structure, and nothing else.
//
// The brief asks for VISIBLE MARKERS and NO ROUTE LINE. So there is no column
// of light, no ring on the ground and no hoop at the hover — a hoop was tried
// and taken out on the maintainer's call: the marker on the structure is the
// whole cue. The pilot flies to it, faces it and holds the light on it.
//
// A MARKER on every zone's target, all three from the start: a blinking amber
// lamp on the zone being flown, a dim one on the zones still to come, and a
// steady green one on each zone already inspected. It is also the thing the
// spotlight has to be put on, so "find the marker" and "light the marker" are
// one instruction.
//
// Everything is mounted for the whole flight and only its colour changes, the
// rule the other marks follow: nothing is built while the pilot is flying.
// ----------------------------------------------------------------------------

const AMBER = new THREE.Color('#ffb020');
const DONE = new THREE.Color('#37e08a');

function Marker({
  point,
  index,
  mats,
}: {
  point: MissionInspectionPoint;
  index: number;
  mats: { lamp: THREE.MeshBasicMaterial; halo: THREE.SpriteMaterial };
}) {
  const lamp = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Sprite>(null);
  // Per-marker copies: each one blinks and changes colour on its own.
  const own = useMemo(() => ({ lamp: mats.lamp.clone(), halo: mats.halo.clone() }), [mats]);
  useDisposable(own);

  useFrame(({ clock }) => {
    const s = useMissionStore.getState();
    const flying = s.phase === 'flying';
    const done = index < s.deliveredCount;
    const live = flying && !done && index === s.runIndex;
    // Blinking at 1.5 Hz while it is the one to go to; steady otherwise.
    const blink = live ? (Math.sin(clock.elapsedTime * Math.PI * 3) > -0.2 ? 1 : 0.15) : 1;
    const level = done ? 0.55 : live ? blink : 0.28;
    const color = done ? DONE : AMBER;
    own.lamp.color.copy(color).multiplyScalar(0.4 + 0.9 * level);
    own.halo.color.copy(color);
    own.halo.opacity = 0.95 * level;
    if (halo.current) halo.current.scale.setScalar(live ? 1.6 : 1.1);
  });

  return (
    <group position={point.target}>
      <mesh ref={lamp} material={own.lamp}>
        <sphereGeometry args={[0.09, 12, 8]} />
      </mesh>
      <sprite ref={halo} material={own.halo} />
    </group>
  );
}

export function InspectionMarkers({ mission }: { mission: Mission }) {
  const mats = useMemo(
    () => ({
      lamp: new THREE.MeshBasicMaterial({ color: AMBER, toneMapped: false }),
      halo: new THREE.SpriteMaterial({
        map: glowTexture(),
        color: AMBER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    }),
    [],
  );
  useDisposable(mats);
  const points = mission.inspection?.points ?? [];

  return (
    <group name="inspection-markers">
      {points.map((p, i) => (
        <Marker key={p.id} point={p} index={i} mats={mats} />
      ))}
    </group>
  );
}

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { useSimStore } from '../../state/simStore';
import { useFlightStore } from '../../state/flightStore';
import { propHubs } from './propHubs';

// Status LED only.
//
// The PlutoX .glb ships its own propeller geometry and it looks right, so we
// leave it alone. Two attempts at animating it failed: the CAD nodes are
// wrappers whose child geometry is offset from the hub, so rotating them swings
// parts around each prop instead of spinning the blades. Substituting our own
// blades looked worse than the real model, so the .glb is left untouched.
//
// Spinning the actual blades needs a model-side fix: re-export with each
// propeller as a single mesh pivoted at its hub.
/** Faint disc over each rotor, fading in with RPM to convey speed the frame
 *  rate cannot show. Sits on the real props rather than replacing them. */
function BlurDiscs({ spec }: { spec: DroneSpec }) {
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const group = useRef<THREE.Group>(null);
  // Blade sweep from the spec's real prop diameter, not a guessed fraction of
  // the arm length.
  const propR = (spec.propDiameterIn * 25.4) / 2000;

  useFrame(() => {
    const { motors } = useSimStore.getState();
    const status = useFlightStore.getState().status();
    const live = status === 'armed' || status === 'flying';

    // Snap each disc onto its measured hub as soon as the model reports them.
    if (propHubs.ready && group.current) {
      group.current.children.forEach((child, i) => {
        const hub = propHubs.positions[i];
        if (hub) child.position.copy(hub);
      });
    }

    for (let i = 0; i < 4; i++) {
      const m = mats.current[i];
      if (!m) continue;
      // Only above the point where the blades stop resolving individually.
      // Comes in early and goes further: at speed the disc IS the propeller,
      // since the blades themselves have faded out.
      const v = live ? Math.min(1, Math.max(0, motors[i] - 0.08) * 2.2) : 0;
      m.opacity = v * 0.55;
      m.visible = m.opacity > 0.02;
    }
  });

  return (
    <group ref={group}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[propR, 20]} />
          <meshBasicMaterial
            ref={(el) => {
              mats.current[i] = el;
            }}
            color="#dce8f7"
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export function Propellers({ spec }: { spec: DroneSpec }) {
  const ledMat = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    if (!ledMat.current) return;
    const { batterySoc } = useSimStore.getState();
    const status = useFlightStore.getState().status();
    const live = status === 'armed' || status === 'flying';

    const low = batterySoc < 0.2 && live;
    const on = low ? Math.sin(performance.now() * 0.012) > 0 : true;
    const green = live && !low;
    ledMat.current.color.set(green ? '#2bff88' : '#ff3344');
    ledMat.current.emissive.set(green ? '#2bff88' : '#ff3344');
    ledMat.current.emissiveIntensity = on ? 2.4 : 0.15;
  });

  return (
    <group>
      <BlurDiscs spec={spec} />
      <mesh position={[0, 0.016, spec.armLength * 0.42]}>
        <sphereGeometry args={[0.006, 8, 8]} />
        <meshStandardMaterial
          ref={ledMat}
          color="#ff3344"
          emissive="#ff3344"
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

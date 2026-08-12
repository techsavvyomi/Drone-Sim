import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { useSimStore } from '../../state/simStore';
import { useFlightStore } from '../../state/flightStore';
import { propHubs } from './propHubs';

// Status LED + spin-blur discs. Real PROP_ meshes are spun inside DroneModel.
// Single-mesh airframes get black SyntheticBlades that cover the baked props
// and spin with the motors — same look, actually moving.

function bladeRadius(spec: DroneSpec): number {
  if (propHubs.synthetic && propHubs.propRadius > 0) return propHubs.propRadius;
  return (spec.propDiameterIn * 25.4) / 2000;
}

/** Faint disc over each rotor — Pluto CAD path. Softer / darker when synthetic. */
function BlurDiscs({ spec }: { spec: DroneSpec }) {
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    const { motors } = useSimStore.getState();
    const status = useFlightStore.getState().status();
    const live = status === 'armed' || status === 'flying';
    const synthetic = propHubs.synthetic;
    const propR = bladeRadius(spec);

    if (propHubs.ready && group.current) {
      group.current.children.forEach((child, i) => {
        const hub = propHubs.positions[i];
        if (!hub) return;
        child.position.copy(hub);
        child.position.y += synthetic ? 0.002 : 0;
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          // Keep geometry radius in sync with measured prop size.
          const g = mesh.geometry as THREE.CircleGeometry;
          const params = g.parameters;
          if (params && Math.abs(params.radius - propR) > 1e-4) {
            mesh.geometry.dispose();
            mesh.geometry = new THREE.CircleGeometry(propR, 24);
          }
        }
      });
    }

    for (let i = 0; i < 4; i++) {
      const m = mats.current[i];
      if (!m) continue;
      if (synthetic) {
        // Dark motion smear that matches black props — only at higher RPM.
        const v = live ? Math.min(1, Math.max(0, motors[i] - 0.25) * 1.6) : 0;
        m.opacity = v * 0.35;
        m.color.set('#1c1c1c');
        m.depthTest = false;
      } else {
        const v = live ? Math.min(1, Math.max(0, motors[i] - 0.08) * 2.2) : 0;
        m.opacity = v * 0.55;
        m.color.set('#dce8f7');
        m.depthTest = true;
      }
      m.visible = m.opacity > 0.02;
    }
  });

  const propR = (spec.propDiameterIn * 25.4) / 2000;

  return (
    <group ref={group}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <circleGeometry args={[propR, 24]} />
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

/**
 * Black two-blade props for single-mesh .glbs — sized/placed over the baked
 * propellers so it looks like those props are spinning.
 */
function SyntheticBlades({ spec }: { spec: DroneSpec }) {
  const group = useRef<THREE.Group>(null);
  const pivots = useRef<(THREE.Group | null)[]>([]);
  const bladeMats = useRef(
    [0, 1, 2, 3].map(
      () =>
        new THREE.MeshStandardMaterial({
          color: '#0d0d0d',
          roughness: 0.65,
          metalness: 0.05,
          depthTest: false,
        }),
    ),
  );
  const hubMats = useRef(
    [0, 1, 2, 3].map(
      () =>
        new THREE.MeshStandardMaterial({
          color: '#2a2a2a',
          roughness: 0.4,
          metalness: 0.5,
          depthTest: false,
        }),
    ),
  );

  useFrame((_s, dt) => {
    const root = group.current;
    if (!root) return;
    const live =
      propHubs.synthetic &&
      propHubs.ready &&
      (() => {
        const s = useFlightStore.getState().status();
        return s === 'armed' || s === 'flying';
      })();
    root.visible = !!(propHubs.synthetic && propHubs.ready && live);
    if (!root.visible) return;

    const propR = bladeRadius(spec);
    const { motors } = useSimStore.getState();
    const broken = useFlightStore.getState().brokenProps;

    root.children.forEach((child, i) => {
      const hub = propHubs.positions[i];
      if (hub) child.position.copy(hub);

      const pivot = pivots.current[i];
      if (!pivot) return;
      const gone = broken.includes(i);
      pivot.visible = !gone;
      if (gone) return;

      const dir = i === 0 || i === 3 ? 1 : -1;
      const m = motors[i] ?? 0;
      // Visible spin (same feel as procedural Pluto / DroneMesh).
      const refR = (spec.propDiameterIn * 25.4) / 2000;
      pivot.scale.setScalar(propR / Math.max(refR, 1e-4));
      pivot.rotation.y += dir * (8 + Math.max(m, 0.18) * 220) * dt;
    });
  });

  const propR = (spec.propDiameterIn * 25.4) / 2000;

  return (
    <group ref={group} visible={false} renderOrder={2}>
      {[0, 1, 2, 3].map((i) => (
        <group key={i}>
          <group
            ref={(el) => {
              pivots.current[i] = el;
            }}
          >
            {[0, Math.PI].map((a, k) => (
              <mesh key={k} rotation={[0, a, 0.12]} material={bladeMats.current[i]}>
                <boxGeometry args={[propR * 0.92, 0.001, 0.012]} />
              </mesh>
            ))}
            <mesh material={hubMats.current[i]}>
              <cylinderGeometry args={[0.005, 0.005, 0.004, 12]} />
            </mesh>
          </group>
        </group>
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
      <SyntheticBlades spec={spec} />
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

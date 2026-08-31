import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { useSimStore } from '../../state/simStore';
import { useFlightStore } from '../../state/flightStore';
import { BLUR_REV_PER_SEC, blurMix, propHubs, TAU } from './propHubs';
import { PROP_SPIN_Y } from '../control/mixer';

// Status LED + spin-blur discs. Real PROP_ meshes are spun inside DroneModel.
// Single-mesh airframes get black SyntheticBlades that cover the baked props
// and spin with the motors — same look, actually moving.

function bladeRadius(spec: DroneSpec): number {
  // The synthetic radius is measured off the model AABB, which is already
  // scaled; the catalogue figure is not, so it needs sizeScale applying or the
  // blur discs sit inboard of the blades on an inflated airframe.
  if (propHubs.synthetic && propHubs.propRadius > 0) return propHubs.propRadius;
  return ((spec.propDiameterIn * 25.4) / 2000) * (spec.sizeScale ?? 1);
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
 * Black stand-in propellers, drawn where the .glb cannot supply real ones.
 *
 * Two cases, and they want opposite visibility rules:
 *
 *  - Single-mesh airframes: the props are baked into the body and cannot turn.
 *    Cover them and spin, but only while the motors are running — with the
 *    drone parked, the bake underneath already looks correct.
 *  - 'blur' airframes: the model ships motion-blur discs and no blades at all,
 *    so these ARE the propellers whenever the rotors are stopped. Always
 *    mounted, crossfading against the disc via blurMix.
 */
function SyntheticBlades({ spec }: { spec: DroneSpec }) {
  const group = useRef<THREE.Group>(null);
  const pivots = useRef<(THREE.Group | null)[]>([]);
  const blurArt = spec.propArt === 'blur';
  const blades = Math.max(2, Math.round(spec.propBlades ?? 2));
  const mats = useMemo(() => {
    const make = (color: string, roughness: number, metalness: number) =>
      [0, 1, 2, 3].map(
        () =>
          new THREE.MeshStandardMaterial({
            color,
            roughness,
            metalness,
            // Single-mesh airframes have to draw OVER the baked propellers, so
            // they ignore depth. A blur airframe has nothing to cover and must
            // respect it, or its props show through the frame from underneath.
            depthTest: blurArt,
            transparent: blurArt,
          }),
      );
    return { blade: make('#0d0d0d', 0.65, 0.05), hub: make('#2a2a2a', 0.4, 0.5) };
  }, [blurArt]);

  useFrame((_s, dt) => {
    const root = group.current;
    if (!root) return;
    const status = useFlightStore.getState().status();
    const live = status === 'armed' || status === 'flying';
    root.visible = propHubs.ready && (blurArt || (propHubs.synthetic && live));
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

      const dir = PROP_SPIN_Y[i];
      const refR = (spec.propDiameterIn * 25.4) / 2000;
      pivot.scale.setScalar(propR / Math.max(refR, 1e-4));

      if (blurArt) {
        // Driven by DroneModel's damped rotor speed, the same number feeding
        // the disc — so exactly one of the two is ever solid. At rest that is
        // this one, which is the whole point: a parked drone's props stop.
        const s = propHubs.spin[i] ?? 0;
        const solid = 1 - blurMix(s);
        mats.blade[i].opacity = solid;
        mats.hub[i].opacity = solid;
        pivot.visible = solid > 0.01;
        pivot.rotation.y += dir * s * BLUR_REV_PER_SEC * TAU * dt;
        return;
      }

      // Visible spin (same feel as procedural Pluto / DroneMesh). Driven by
      // the motor output alone: the old `8 + max(m, 0.18)` floor turned these
      // blades the moment the aircraft was armed, while the motors were still
      // stopped — the same bug already fixed in DroneModel's rotor spin.
      const m = motors[i] ?? 0;
      pivot.rotation.y += dir * m * 220 * dt;
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
            {Array.from({ length: blades }, (_, k) => (
              // Each blade is its own arm from hub to tip, rotated into place —
              // rather than one bar across the centre, which only ever makes a
              // two-blade prop however many you draw.
              <group key={k} rotation={[0, (k * TAU) / blades, 0]}>
                <mesh
                  position={[propR * 0.47, 0, 0]}
                  rotation={[0.22, 0, 0]}
                  material={mats.blade[i]}
                >
                  <boxGeometry args={[propR * 0.9, 0.0012, 0.014]} />
                </mesh>
              </group>
            ))}
            <mesh material={mats.hub[i]}>
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
      {/* Skipped when the .glb already ships motion-blur discs — a second,
          brighter disc over the top only washes the art out. */}
      {spec.propArt !== 'blur' && <BlurDiscs spec={spec} />}
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

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { useSimStore } from '../../state/simStore';
import { PROP_SPIN_Y } from '../control/mixer';

// Procedural nano-quad built to the PlutoX's real proportions and colour scheme
// (palette sampled from the CAD model's materials). ~3k triangles and a handful
// of draw calls, versus 2.15M triangles / 3,656 meshes in the CAD export.
//
// Geometry is driven by the DroneSpec, so the same component serves every
// airframe we add later. Body frame: +Y up, -Z forward.

// Palette (original CAD RGB values, recovered from material names).
const C = {
  pcb: '#14161a', // near-black board
  plastic: '#1f1f1f', // glossy black plastic
  frame: '#2b2e33', // dark grey frame
  metal: '#c0c0c0', // satin steel
  copper: '#c79b2b', // motor windings
  prop: '#f7f7f2', // white nylon props
  battery: '#23262c',
  labelBlue: '#0080b6',
  ledGreen: '#00d24a',
  ledRed: '#e23527',
  mint: '#69ffb9',
};

export function DroneMesh({ spec }: { spec: DroneSpec }) {
  const motors = useSimStore((s) => s.motors);
  const propRefs = useRef<(THREE.Group | null)[]>([]);

  // Motor radius from CoG -> per-axis offset for an X layout.
  const radial = spec.armLength;
  const off = radial / Math.SQRT2;
  // Props reach just inside the overall span.
  const propR = radial * 0.45;

  const positions: [number, number, number][] = [
    [off, 0, -off], // FR
    [-off, 0, -off], // FL
    [off, 0, off], // BR
    [-off, 0, off], // BL
  ];

  // Spin the props at a rate proportional to motor output (visual only).
  // Strictly proportional: the old constant 6 rad/s term meant these props
  // never stopped, so a disarmed drone sat on the pad turning about one
  // revolution a second.
  useFrame((_s, delta) => {
    for (let i = 0; i < 4; i++) {
      const g = propRefs.current[i];
      if (!g) continue;
      const dir = PROP_SPIN_Y[i]; // FR/RL clockwise, FL/RR counter-clockwise
      g.rotation.y += dir * motors[i] * 260 * delta;
    }
  });

  return (
    <group>
      {/* ---- Center stack: main board, FC board, canopy ---- */}
      <mesh castShadow position={[0, 0, 0]}>
        <boxGeometry args={[radial * 0.62, 0.003, radial * 0.62]} />
        <meshStandardMaterial color={C.pcb} metalness={0.1} roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0, 0.005, 0]}>
        <boxGeometry args={[radial * 0.4, 0.004, radial * 0.4]} />
        <meshStandardMaterial color={C.plastic} metalness={0.2} roughness={0.5} />
      </mesh>
      {/* Mint solder-mask accent strip */}
      <mesh position={[0, 0.0075, 0]}>
        <boxGeometry args={[radial * 0.22, 0.001, radial * 0.22]} />
        <meshStandardMaterial color={C.mint} emissive={C.mint} emissiveIntensity={0.25} />
      </mesh>

      {/* ---- LiPo battery slung underneath ---- */}
      <mesh castShadow position={[0, -0.011, 0.004]}>
        <boxGeometry args={[radial * 0.5, 0.014, radial * 0.36]} />
        <meshStandardMaterial color={C.battery} metalness={0.15} roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.011, -radial * 0.181]}>
        <boxGeometry args={[radial * 0.3, 0.008, 0.001]} />
        <meshStandardMaterial color={C.labelBlue} emissive={C.labelBlue} emissiveIntensity={0.2} />
      </mesh>

      {/* ---- Forward camera ---- */}
      <group position={[0, 0.006, -radial * 0.3]} rotation={[-spec.cameraMount.tiltDeg * 0.0175, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.012, 0.012, 0.010]} />
          <meshStandardMaterial color={C.plastic} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, -0.007]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0045, 0.0045, 0.004, 12]} />
          <meshStandardMaterial color="#0a0a0a" metalness={0.9} roughness={0.15} />
        </mesh>
      </group>

      {/* ---- Arms, motors, props, legs ---- */}
      {positions.map((p, i) => {
        const front = p[2] < 0;
        const angle = Math.atan2(p[0], p[2]);
        return (
          <group key={i}>
            {/* Arm: a thin bar from the centre out to the motor */}
            <group rotation={[0, -angle, 0]}>
              <mesh castShadow position={[0, 0, radial / 2]}>
                <boxGeometry args={[0.008, 0.004, radial]} />
                <meshStandardMaterial color={C.frame} metalness={0.3} roughness={0.6} />
              </mesh>
            </group>

            <group position={p}>
              {/* Motor bell + copper winding band */}
              <mesh castShadow position={[0, 0.008, 0]}>
                <cylinderGeometry args={[0.0085, 0.0085, 0.014, 14]} />
                <meshStandardMaterial color={C.frame} metalness={0.7} roughness={0.35} />
              </mesh>
              <mesh position={[0, 0.004, 0]}>
                <cylinderGeometry args={[0.0088, 0.0088, 0.005, 14]} />
                <meshStandardMaterial color={C.copper} metalness={0.85} roughness={0.35} />
              </mesh>
              {/* Shaft */}
              <mesh position={[0, 0.017, 0]}>
                <cylinderGeometry args={[0.0015, 0.0015, 0.006, 6]} />
                <meshStandardMaterial color={C.metal} metalness={0.9} roughness={0.2} />
              </mesh>

              {/* Two-blade prop */}
              <group
                ref={(el) => {
                  propRefs.current[i] = el;
                }}
                position={[0, 0.019, 0]}
              >
                {[0, Math.PI].map((a, k) => (
                  <mesh key={k} rotation={[0, a, 0.18]} position={[0, 0, 0]} castShadow>
                    <boxGeometry args={[propR * 0.92, 0.0012, 0.011]} />
                    <meshStandardMaterial color={C.prop} roughness={0.5} />
                  </mesh>
                ))}
                {/* Hub */}
                <mesh>
                  <cylinderGeometry args={[0.004, 0.004, 0.003, 10]} />
                  <meshStandardMaterial color={C.plastic} />
                </mesh>
              </group>

              {/* Spin-blur disc — opacity tracks motor output */}
              <mesh position={[0, 0.019, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <circleGeometry args={[propR, 20]} />
                <meshBasicMaterial
                  color={C.prop}
                  transparent
                  opacity={Math.min(0.28, motors[i] * 0.42)}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>

              {/* Landing leg */}
              <mesh position={[0, -0.012, 0]}>
                <cylinderGeometry args={[0.0018, 0.0022, 0.02, 6]} />
                <meshStandardMaterial color={C.plastic} roughness={0.8} />
              </mesh>

              {/* Orientation LED: green up front, red at the back */}
              <mesh position={[0, 0.0, 0]}>
                <sphereGeometry args={[0.0035, 8, 8]} />
                <meshStandardMaterial
                  color={front ? C.ledGreen : C.ledRed}
                  emissive={front ? C.ledGreen : C.ledRed}
                  emissiveIntensity={1.4}
                />
              </mesh>
            </group>
          </group>
        );
      })}
    </group>
  );
}

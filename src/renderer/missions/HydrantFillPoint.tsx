import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { textTexture } from './Storefront';
import type { Mission } from './types';
import { zoneGroundY } from './types';

// ----------------------------------------------------------------------------
// The hydrant fill point: where Forest Fire's suppression tank is filled and
// waiting.
//
// It replaced a tank standing on bare dirt. A fire crew fills from a hydrant fed
// by a water tank, and that is what makes the pickup read as a job.
//
// It stands BEHIND the spawn and to its left. The drone faces -z at launch (the
// chase camera sits on +z), and the first placement, on the road at [11, -4],
// put the water tank square in the middle of the opening view. The pilot now
// turns round to find it, and the view ahead is the forest they are about to
// cross.
//
// Built in its own frame around the pickup mark and turned by LAYOUT_YAW. Every
// spot was sampled against the forest GLB and its colliders, not placed by eye:
//
//   - the pad's ground runs -0.13 to -0.24 m, the hydrant's -0.24 to -0.30, the
//     sign's -0.19 to -0.24, the tank's -0.34 to -0.44 — so the pad's top sits
//     above the highest of its own ground and everything else is sunk into the
//     slope rather than standing on a level that is not there;
//   - trunks are 6.8 m from the tank and further from everything else, and the
//     nearest log or fence is 5.3 m from the tank;
//   - the hydrant, sign and bollards stand past the 2.5 m a rotor can reach from
//     a drone anywhere inside the 1.8 m pickup ring;
//   - the pad is 18.4 m from the spawn and 12.8 m from the base pad; the tank is
//     28.3 m from the spawn and 22.7 m from the base.
//
// Primitives and one canvas texture, no lights. Everything above ankle height
// that a drone could fly into has a collider.
// ----------------------------------------------------------------------------

const RED = '#c0261c';
const STEEL = '#5b6168';
const BRASS = '#b99546';
const YELLOW = '#f2c230';

/** How the layout is turned about the pickup mark. A quarter turn puts the
 *  water tank out to the north-west, away from both the spawn and the base. */
const LAYOUT_YAW = Math.PI / 2;

/** Offsets from the pickup mark in the layout's own frame, metres. */
const HYDRANT: readonly [number, number] = [0, -3.5];
const SIGN: readonly [number, number] = [3.5, -2.5];
const TANK: readonly [number, number] = [-7, -7];
/** Side of the concrete fill pad, metres. */
const PAD = 4.4;
/**
 * How far the pad's top stands above the frame's origin, metres.
 *
 * The frame sits on the ground under the mark's centre; the pad's own ground
 * rises 5 cm higher at one edge, so a thinner slab would have the slope showing
 * through it. The mark's `groundY` IS this top face.
 */
const PAD_TOP = 0.07;
/** How deep everything is sunk below the frame's origin, metres — past the
 *  lowest ground under any of it, relative to the pad. */
const SINK = 0.3;

export function HydrantFillPoint({ mission }: { mission: Mission }) {
  const zone = mission.zones.pickup;
  const origin = zoneGroundY(mission, zone) - PAD_TOP;

  const tex = useMemo(
    () => ({
      sign: textTexture(['WATER FILL POINT', 'FIRE SUPPRESSION TANKS'], {
        w: 1024,
        h: 256,
        bg: '#b3261e',
        fg: '#ffffff',
        size: 110,
      }),
      band: textTexture(['FIRE WATER  ·  FIRE WATER  ·  FIRE WATER'], {
        w: 1024,
        h: 96,
        bg: '#f4f1ea',
        fg: '#b3261e',
        size: 64,
      }),
    }),
    [],
  );
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex]);

  // The hose, lying from the hydrant's side nozzle across to the pad's edge.
  const hose = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(HYDRANT[0] + 0.2, 0.46, HYDRANT[1]),
      new THREE.Vector3(HYDRANT[0] + 0.5, 0.02, HYDRANT[1] + 0.4),
      new THREE.Vector3(0.3, 0.04, -2.6),
      new THREE.Vector3(0.9, PAD_TOP + 0.04, -2.05),
    ]);
    return new THREE.TubeGeometry(curve, 32, 0.045, 8, false);
  }, []);
  useEffect(() => () => hose.dispose(), [hose]);

  // The feed pipe along the ground, from under the water tank to the hydrant.
  const feed = useMemo(() => {
    const dx = HYDRANT[0] - TANK[0];
    const dz = HYDRANT[1] - TANK[1];
    return {
      length: Math.hypot(dx, dz),
      yaw: Math.atan2(dx, dz),
      mid: [(HYDRANT[0] + TANK[0]) / 2, (HYDRANT[1] + TANK[1]) / 2] as const,
    };
  }, []);

  const signYaw = Math.atan2(-SIGN[0], -SIGN[1]);
  const corners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const;

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[zone.at[0], origin, zone.at[1]]}
      rotation={[0, LAYOUT_YAW, 0]}
    >
      {/* ---- Colliders ---------------------------------------------------- */}
      <CuboidCollider args={[0.25, 0.5, 0.25]} position={[HYDRANT[0], 0.5, HYDRANT[1]]} />
      <CuboidCollider
        args={[1.15, 1.1, 0.12]}
        position={[SIGN[0], 1.1, SIGN[1]]}
        rotation={[0, signYaw, 0]}
      />
      <CuboidCollider args={[1.75, 3.15, 1.75]} position={[TANK[0], 3.15, TANK[1]]} />
      {corners.map(([sx, sz]) => (
        <CuboidCollider
          key={`${sx}${sz}`}
          args={[0.09, 0.45, 0.09]}
          position={[(sx * PAD) / 2, 0.45, (sz * PAD) / 2]}
        />
      ))}

      {/* ---- The fill pad --------------------------------------------------- */}
      {/* Concrete, its top above the highest ground under it and its bottom well
          into the slope, with a yellow edge line. */}
      <mesh position={[0, (PAD_TOP - SINK - 0.1) / 2, 0]} receiveShadow>
        <boxGeometry args={[PAD, PAD_TOP + SINK + 0.1, PAD]} />
        <meshStandardMaterial color="#8e918f" roughness={0.95} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2;
        return (
          <mesh
            key={i}
            position={[Math.sin(a) * (PAD / 2 - 0.1), PAD_TOP + 0.004, Math.cos(a) * (PAD / 2 - 0.1)]}
            rotation={[-Math.PI / 2, 0, a]}
          >
            <planeGeometry args={[PAD, 0.12]} />
            <meshStandardMaterial color={YELLOW} roughness={0.8} />
          </mesh>
        );
      })}
      {/* Bollards at the corners, footed below the slope. */}
      {corners.map(([sx, sz]) => (
        <group key={`${sx}${sz}`} position={[(sx * PAD) / 2, 0, (sz * PAD) / 2]}>
          <mesh position={[0, (0.9 - SINK) / 2, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.09, 0.9 + SINK, 12]} />
            <meshStandardMaterial color={YELLOW} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.72, 0]}>
            <cylinderGeometry args={[0.083, 0.083, 0.1, 12]} />
            <meshStandardMaterial color="#1b1b1b" roughness={0.6} />
          </mesh>
        </group>
      ))}

      {/* ---- The hydrant ---------------------------------------------------- */}
      <group position={[HYDRANT[0], 0, HYDRANT[1]]}>
        {/* The flange, carried down into the ground. */}
        <mesh position={[0, (0.08 - SINK) / 2, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.24, 0.08 + SINK, 16]} />
          <meshStandardMaterial color={RED} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.4, 0]} castShadow>
          <cylinderGeometry args={[0.14, 0.15, 0.64, 16]} />
          <meshStandardMaterial color={RED} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.72, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.05, 16]} />
          <meshStandardMaterial color={RED} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.745, 0]} castShadow>
          <sphereGeometry args={[0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={RED} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.93, 0]}>
          <cylinderGeometry args={[0.04, 0.05, 0.06, 5]} />
          <meshStandardMaterial color={BRASS} metalness={0.7} roughness={0.35} />
        </mesh>
        {/* Two hose nozzles out of the sides, and the big pumper outlet facing
            the pad. */}
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.2, 0.46, 0]} rotation={[0, 0, Math.PI / 2]}>
            <mesh>
              <cylinderGeometry args={[0.06, 0.07, 0.14, 12]} />
              <meshStandardMaterial color={RED} roughness={0.45} />
            </mesh>
            <mesh position={[0, s * 0.08, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.04, 6]} />
              <meshStandardMaterial color={BRASS} metalness={0.7} roughness={0.35} />
            </mesh>
          </group>
        ))}
        <group position={[0, 0.5, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[0.08, 0.09, 0.14, 12]} />
            <meshStandardMaterial color={RED} roughness={0.45} />
          </mesh>
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.04, 6]} />
            <meshStandardMaterial color={BRASS} metalness={0.7} roughness={0.35} />
          </mesh>
        </group>
      </group>

      {/* The hose to the pad, and its coupling. */}
      <mesh geometry={hose} castShadow>
        <meshStandardMaterial color="#e3d6b8" roughness={0.85} />
      </mesh>
      <mesh position={[0.9, PAD_TOP + 0.04, -2.05]} rotation={[0, Math.PI / 4, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 0.12, 10]} />
        <meshStandardMaterial color={BRASS} metalness={0.7} roughness={0.35} />
      </mesh>

      {/* ---- The sign ------------------------------------------------------- */}
      <group position={[SIGN[0], 0, SIGN[1]]} rotation={[0, signYaw, 0]}>
        {[-0.95, 0.95].map((x) => (
          <mesh key={x} position={[x, (2.2 - SINK) / 2, -0.03]} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 2.2 + SINK, 8]} />
            <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, 1.65, -0.03]} castShadow>
          <boxGeometry args={[2.3, 0.9, 0.05]} />
          <meshStandardMaterial color={STEEL} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.65, 0.0]}>
          <planeGeometry args={[2.2, 0.8]} />
          <meshStandardMaterial
            map={tex.sign}
            emissiveMap={tex.sign}
            emissive="#ffffff"
            emissiveIntensity={0.35}
            roughness={0.6}
          />
        </mesh>
      </group>

      {/* ---- The water tank on its stand ------------------------------------ */}
      <group position={[TANK[0], 0, TANK[1]]}>
        {/* Legs, footed well below the frame: the tank's ground is the lowest
            of anything here. */}
        {corners.map(([sx, sz]) => (
          <mesh
            key={`${sx}${sz}`}
            position={[sx * 1.15, (2.6 - 0.5) / 2, sz * 1.15]}
            castShadow
          >
            <boxGeometry args={[0.16, 2.6 + 0.5, 0.16]} />
            <meshStandardMaterial color={STEEL} metalness={0.4} roughness={0.55} />
          </mesh>
        ))}
        {/* Cross bracing on two faces. */}
        {[-1, 1].map((s) => (
          <group key={s} position={[0, 1.3, s * 1.15]}>
            {[0.78, -0.78].map((r) => (
              <mesh key={r} rotation={[0, 0, r]}>
                <boxGeometry args={[3.1, 0.06, 0.06]} />
                <meshStandardMaterial color={STEEL} metalness={0.4} roughness={0.55} />
              </mesh>
            ))}
          </group>
        ))}
        <mesh position={[0, 2.62, 0]} castShadow>
          <cylinderGeometry args={[1.75, 1.75, 0.08, 24]} />
          <meshStandardMaterial color={STEEL} metalness={0.4} roughness={0.55} />
        </mesh>
        <mesh position={[0, 4.06, 0]} castShadow>
          <cylinderGeometry args={[1.6, 1.6, 2.8, 32]} />
          <meshStandardMaterial color={RED} roughness={0.5} metalness={0.15} />
        </mesh>
        <mesh position={[0, 4.35, 0]}>
          <cylinderGeometry args={[1.615, 1.615, 0.5, 32, 1, true]} />
          <meshStandardMaterial map={tex.band} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 5.76, 0]} castShadow>
          <coneGeometry args={[1.72, 0.6, 32]} />
          <meshStandardMaterial color="#9c1f18" roughness={0.55} metalness={0.15} />
        </mesh>
        {/* A ladder up one side. */}
        {[-0.22, 0.22].map((x) => (
          <mesh key={x} position={[x, 2.7, 1.7]}>
            <boxGeometry args={[0.04, 6.2, 0.04]} />
            <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.5} />
          </mesh>
        ))}
        {Array.from({ length: 16 }, (_, i) => (
          <mesh key={i} position={[0, 0.3 + i * 0.35, 1.7]}>
            <boxGeometry args={[0.44, 0.03, 0.03]} />
            <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.5} />
          </mesh>
        ))}
        {/* The outlet pipe down into the ground. */}
        <mesh position={[0, (2.6 - 0.5) / 2, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 2.6 + 0.5, 10]} />
          <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.5} />
        </mesh>
      </group>

      {/* The feed pipe along the ground from the tank to the hydrant, laid low
          enough to follow the slope down to the tank. */}
      <mesh
        position={[feed.mid[0], -0.1, feed.mid[1]]}
        rotation={[Math.PI / 2, 0, -feed.yaw]}
        castShadow
      >
        <cylinderGeometry args={[0.08, 0.08, feed.length, 10]} />
        <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.5} />
      </mesh>
    </RigidBody>
  );
}

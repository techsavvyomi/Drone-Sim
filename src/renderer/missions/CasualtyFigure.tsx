import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import { useMissionStore } from '../state/missionStore';

// ----------------------------------------------------------------------------
// The casualty: a person on the roof, waving for help.
//
// The only thing at the search site. No ring, no light, no smoke — the pilot
// finds a PERSON, flies over them and hovers.
//
// Built from primitives rather than loaded. There is no human asset in the repo,
// the CSP blocks fetching one, and a skinned character is a skeleton, a mixer
// and a texture set on a map that is VRAM-bound before the mission adds anything.
// What sells a person at drone distance is proportion, a silhouette with
// shoulders and a waist, clothes that are not the colour of a roof, and
// MOVEMENT: two arms crossing over a head reads as "help" long before any face.
//
// The torso and legs are lathed profiles rather than capsules — a capsule reads
// as a toy, a tapered chest into a narrower waist reads as a body. Materials are
// built once and shared across every part.
//
// Metres, standing on y = 0, facing +z. About 1.76 m tall.
// ----------------------------------------------------------------------------

const COLORS = {
  skin: '#c48d69',
  hair: '#231812',
  /** A rust jacket: warm against the blue evening and the grey roofs, without
   *  being a hi-vis vest nobody on a roof would be wearing. */
  jacket: '#9c3f26',
  trim: '#5e2616',
  jeans: '#2f3d5a',
  belt: '#1a1512',
  shoe: '#2a2622',
  sole: '#d8d2c6',
  eye: '#17110e',
} as const;

/**
 * Where the casualty stands relative to the site centre, metres (x, z).
 *
 * Off the centre because the food box is dropped there: the pilot hovers over
 * the site and the box falls straight down, and a person standing on the centre
 * would take it on the head. Still well inside the 3.5 m rescue zone and the
 * 4.5 m of flat roof every site was swept for. Shared with `CasualtyCollider`.
 */
export const CASUALTY_OFFSET: readonly [number, number] = [1.5, 0.5];

/** Shoulder pivot, from the figure's origin. */
const SHOULDER_Y = 1.44;
const SHOULDER_X = 0.215;
const HIP_X = 0.092;

/** Flat metres inside which the casualty turns to face the aircraft. Further
 *  out they have not seen it yet. */
const NOTICE = 60;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** A solid of revolution from [radius, y] pairs, bottom to top. */
function lathe(profile: readonly (readonly [number, number])[], segments = 14) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

export function CasualtyFigure({
  worldX,
  worldZ,
  position,
}: {
  /** World position of the figure, for turning toward the drone. */
  worldX: number;
  worldZ: number;
  /** Local position inside the parent group. */
  position: [number, number, number];
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const chest = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const elbowL = useRef<THREE.Group>(null);
  const elbowR = useRef<THREE.Group>(null);
  /** 0 = frantic two-arm wave, 1 = found, one calm hand up. Eased. */
  const calm = useRef(0);

  const mat = useMemo(() => {
    const m = (color: string, roughness: number) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    return {
      skin: m(COLORS.skin, 0.6),
      hair: m(COLORS.hair, 0.95),
      jacket: m(COLORS.jacket, 0.8),
      trim: m(COLORS.trim, 0.85),
      jeans: m(COLORS.jeans, 0.95),
      belt: m(COLORS.belt, 0.5),
      shoe: m(COLORS.shoe, 0.7),
      sole: m(COLORS.sole, 0.8),
      eye: m(COLORS.eye, 0.3),
    };
  }, []);

  const geo = useMemo(
    () => ({
      // Waist to shoulders: a narrow waist, the chest filling out, the shoulders
      // rolling in to the base of the neck.
      torso: lathe([
        [0, 0.9],
        [0.148, 0.9],
        [0.156, 0.97],
        [0.148, 1.05],
        [0.158, 1.15],
        [0.178, 1.27],
        [0.188, 1.37],
        [0.172, 1.45],
        [0.115, 1.5],
        [0.055, 1.525],
        [0, 1.525],
      ]),
      // Seat of the jeans, from the crotch up into the belt line.
      hips: lathe([
        [0, 0.8],
        [0.1, 0.8],
        [0.145, 0.84],
        [0.156, 0.9],
        [0.15, 0.95],
        [0, 0.95],
      ]),
      // Knee to hip, fuller at the top.
      thigh: lathe([
        [0, 0],
        [0.044, 0.005],
        [0.053, 0.04],
        [0.061, 0.15],
        [0.073, 0.29],
        [0.079, 0.37],
        [0.05, 0.405],
        [0, 0.41],
      ]),
      // Ankle to knee, with the calf.
      shin: lathe([
        [0, 0],
        [0.041, 0.005],
        [0.043, 0.06],
        [0.052, 0.24],
        [0.054, 0.33],
        [0.047, 0.4],
        [0, 0.41],
      ]),
    }),
    [],
  );

  useEffect(
    () => () => {
      Object.values(mat).forEach((m) => m.dispose());
      Object.values(geo).forEach((g) => g.dispose());
    },
    [mat, geo],
  );

  useFrame(({ clock }, dt) => {
    if (!root.current) return;
    const step = Math.min(dt, 0.1);
    const t = clock.elapsedTime;

    const found = useMissionStore.getState().located ? 1 : 0;
    calm.current += (found - calm.current) * Math.min(1, step * 1.5);
    const c = calm.current;

    // Turn toward the aircraft once it is close enough to have been noticed.
    // Slowly — a person shuffles round, they do not snap.
    const dx = dronePose.position.x - worldX;
    const dz = dronePose.position.z - worldZ;
    const flat = Math.hypot(dx, dz);
    if (flat < NOTICE) {
      const cur = root.current.rotation.y;
      root.current.rotation.y = cur + wrapAngle(Math.atan2(dx, dz) - cur) * Math.min(1, step * 1.2);
      // And look up at it.
      if (head.current) {
        const up = Math.atan2(dronePose.position.y - SHOULDER_Y, flat + 0.01);
        head.current.rotation.x = -Math.min(Math.max(up, 0), 0.7) * 0.8;
      }
    }

    // The wave. Both arms swing across the top of the head — the distress signal
    // — and after the casualty is found, the left comes down and the right keeps
    // a slower wave going.
    const fast = Math.sin(t * 6.2);
    const slow = Math.sin(t * 3.4);
    const both = 2.55 + 0.45 * fast;
    if (armR.current) armR.current.rotation.z = both + (2.35 + 0.3 * slow - both) * c;
    if (armL.current) armL.current.rotation.z = -(both + (0.16 - both) * c);
    if (elbowR.current) elbowR.current.rotation.z = 0.25 + 0.2 * c;
    if (elbowL.current) elbowL.current.rotation.z = -(0.25 * (1 - c) + 0.1 * c);

    // A little of the whole body goes into it: the weight rocks with the arms,
    // and the chest rises and falls.
    if (body.current) {
      body.current.rotation.z = 0.035 * fast * (1 - c) + 0.012 * slow * c;
      body.current.position.y = 0.01 * Math.abs(fast) * (1 - c);
    }
    if (chest.current) chest.current.scale.set(1 + 0.012 * Math.sin(t * 2.1), 1, 1);
  });

  return (
    <group ref={root} position={position}>
      <group ref={body}>
        {/* Legs. The left a little forward and out — nobody stands to attention
            while waving for help. */}
        {(
          [
            [-1, 0.05, 0.03],
            [1, -0.02, -0.02],
          ] as const
        ).map(([s, z, splay]) => (
          <group key={s} position={[s * HIP_X, 0, z]} rotation={[0, 0, s * splay]}>
            {/* Shoe: a rounded upper on a pale sole. */}
            <mesh position={[0, 0.012, 0.045]} material={mat.sole}>
              <boxGeometry args={[0.1, 0.024, 0.27]} />
            </mesh>
            <mesh
              position={[0, 0.055, 0.04]}
              rotation={[Math.PI / 2, 0, 0]}
              scale={[1, 1, 0.75]}
              material={mat.shoe}
              castShadow
            >
              <capsuleGeometry args={[0.048, 0.15, 4, 10]} />
            </mesh>
            {/* Shin and thigh, jeans all the way down, and a hem over the shoe. */}
            <mesh position={[0, 0.08, 0]} geometry={geo.shin} material={mat.jeans} castShadow />
            <mesh position={[0, 0.1, 0]} material={mat.jeans}>
              <cylinderGeometry args={[0.047, 0.056, 0.06, 12]} />
            </mesh>
            <mesh position={[0, 0.48, 0]} geometry={geo.thigh} material={mat.jeans} castShadow />
          </group>
        ))}

        {/* Hips and belt. */}
        <mesh geometry={geo.hips} scale={[1, 1, 0.7]} material={mat.jeans} castShadow />
        <mesh position={[0, 0.915, 0]} scale={[1, 1, 0.68]} material={mat.belt}>
          <cylinderGeometry args={[0.156, 0.156, 0.035, 18]} />
        </mesh>

        <group ref={chest}>
          {/* The jacket, flattened front to back, with rounded shoulders. */}
          <mesh geometry={geo.torso} scale={[1, 1, 0.62]} material={mat.jacket} castShadow />
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              position={[s * 0.19, 1.43, 0]}
              scale={[1, 0.85, 0.9]}
              material={mat.jacket}
              castShadow
            >
              <sphereGeometry args={[0.072, 12, 10]} />
            </mesh>
          ))}
          {/* Hem of the jacket, and the collar standing round the neck. */}
          <mesh position={[0, 0.94, 0]} scale={[1, 1, 0.64]} material={mat.trim}>
            <cylinderGeometry args={[0.158, 0.16, 0.03, 18]} />
          </mesh>
          <mesh
            position={[0, 1.51, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[1, 0.8, 1]}
            material={mat.trim}
          >
            <torusGeometry args={[0.065, 0.022, 8, 18]} />
          </mesh>
          {/* The zip, down the front. */}
          <mesh position={[0, 1.2, 0.108]} rotation={[-0.08, 0, 0]} material={mat.trim}>
            <boxGeometry args={[0.012, 0.5, 0.01]} />
          </mesh>
        </group>

        {/* Neck. */}
        <mesh position={[0, 1.56, 0]} material={mat.skin}>
          <cylinderGeometry args={[0.046, 0.054, 0.1, 10]} />
        </mesh>

        {/* Head, on a pivot at the top of the neck so it can look up. */}
        <group ref={head} position={[0, 1.59, 0.005]}>
          {/* Skull and jaw. */}
          <mesh position={[0, 0.115, 0]} scale={[0.86, 1, 0.96]} material={mat.skin} castShadow>
            <sphereGeometry args={[0.1, 18, 14]} />
          </mesh>
          <mesh position={[0, 0.055, 0.022]} scale={[0.92, 0.8, 1]} material={mat.skin}>
            <sphereGeometry args={[0.074, 14, 10]} />
          </mesh>
          {/* Nose and ears. */}
          <mesh position={[0, 0.098, 0.1]} rotation={[Math.PI / 2, 0, 0]} material={mat.skin}>
            <coneGeometry args={[0.016, 0.045, 8]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              position={[s * 0.087, 0.108, -0.005]}
              scale={[0.45, 1, 0.75]}
              material={mat.skin}
            >
              <sphereGeometry args={[0.024, 8, 6]} />
            </mesh>
          ))}
          {/* Eyes and brows. */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.032, 0, 0]}>
              <mesh position={[0, 0.125, 0.084]} material={mat.eye}>
                <sphereGeometry args={[0.0115, 8, 6]} />
              </mesh>
              <mesh position={[0, 0.147, 0.089]} rotation={[0, 0, s * -0.12]} material={mat.hair}>
                <boxGeometry args={[0.034, 0.008, 0.012]} />
              </mesh>
            </group>
          ))}
          {/* Hair: a cap over the crown, and volume at the back of the head. */}
          <mesh
            position={[0, 0.128, -0.006]}
            rotation={[-0.3, 0, 0]}
            scale={[0.91, 1, 1.02]}
            material={mat.hair}
            castShadow
          >
            <sphereGeometry args={[0.106, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
          </mesh>
          <mesh position={[0, 0.1, -0.038]} scale={[0.9, 0.95, 0.75]} material={mat.hair}>
            <sphereGeometry args={[0.092, 14, 10]} />
          </mesh>
        </group>

        {/* Arms. The group rotates at the shoulder; rotation.z of +θ swings the
            right arm (+x) outward and up, −θ the left. Past π it crosses the head. */}
        {(
          [
            [1, armR, elbowR],
            [-1, armL, elbowL],
          ] as const
        ).map(([s, arm, elbow]) => (
          <group key={s} ref={arm} position={[s * SHOULDER_X, SHOULDER_Y, 0]}>
            <mesh position={[0, -0.14, 0]} material={mat.jacket} castShadow>
              <capsuleGeometry args={[0.05, 0.19, 4, 10]} />
            </mesh>
            <group ref={elbow} position={[0, -0.29, 0]}>
              <mesh position={[0, -0.115, 0]} material={mat.jacket} castShadow>
                <capsuleGeometry args={[0.043, 0.16, 4, 10]} />
              </mesh>
              {/* Cuff, wrist, hand and thumb. */}
              <mesh position={[0, -0.23, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat.trim}>
                <torusGeometry args={[0.038, 0.012, 6, 14]} />
              </mesh>
              <mesh position={[0, -0.255, 0]} material={mat.skin}>
                <cylinderGeometry args={[0.026, 0.028, 0.04, 8]} />
              </mesh>
              <mesh position={[0, -0.31, 0]} scale={[0.42, 1.1, 0.85]} material={mat.skin}>
                <sphereGeometry args={[0.05, 10, 8]} />
              </mesh>
              <mesh
                position={[0, -0.29, 0.032]}
                rotation={[0.5, 0, 0]}
                material={mat.skin}
              >
                <capsuleGeometry args={[0.012, 0.03, 3, 6]} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

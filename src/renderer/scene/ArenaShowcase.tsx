import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { DroneModel } from '../sim/drone/DroneModel';

// Animated racing-arena backdrop for the main menu.
//
// The drone flies a continuous S-weave: it starts deep in the arena, snakes
// left-right through the gates while approaching, then passes the camera and
// briefly leaves frame before looping back. Gates are positioned ON the path
// and oriented to its tangent, so the drone genuinely flies through them.

const BLUE = '#2f7fff';
const RED = '#ff2b4d';
const GREEN = '#22e06a';
const CYAN = '#38bdf8';

const FLOOR_Y = -0.12;

/**
 * Flight path. x is biased to the right so the drone doesn't sit on top of the
 * hero text, and the weave is phased so it passes BESIDE the camera rather than
 * straight through it.
 */
const PATH = {
  // Shifted left; gates sit on the path, so moving the whole circuit keeps
  // the drone flying through their centres.
  xOffset: 0.1,
  weave: 2.6,
  cz: -4,
  depth: 8, // z spans cz-depth .. cz+depth (so it passes the camera)
  cy: 1.15,
  bob: 0.22,
  speed: 0.3,
};

function pathPoint(t: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(
    PATH.xOffset - Math.cos(t * 2) * PATH.weave,
    PATH.cy + Math.sin(t * 3) * PATH.bob,
    PATH.cz + Math.cos(t) * PATH.depth,
  );
}

function pathTangent(t: number, out: THREE.Vector3): THREE.Vector3 {
  return out
    .set(
      2 * PATH.weave * Math.sin(t * 2),
      3 * PATH.bob * Math.cos(t * 3),
      -PATH.depth * Math.sin(t),
    )
    .normalize();
}

/** Path parameters where gates sit — all on the approaching leg. */
const GATE_TS = [3.6, 4.2, 4.75, 5.2];
// Gates stay just larger than the airframe (~1.3 m at showcase scale) so the
// drone still visibly fits through them, without dominating the frame.
// `size` is edge length for squares and radius for hoops.
const GATE_STYLE: { kind: 'square' | 'hoop'; color: string; size: number }[] = [
  { kind: 'square', color: BLUE, size: 1.9 },
  { kind: 'hoop', color: RED, size: 1.0 },
  { kind: 'square', color: GREEN, size: 1.9 },
  { kind: 'hoop', color: RED, size: 1.0 },
];

const LOOK_AT = new THREE.Vector3(0.4, -0.35, -5);

function CameraAim() {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.lookAt(LOOK_AT);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

/**
 * Clean racing gate: a single emissive rim, steady and uniform.
 * Deliberately plain — the pulsing/LED-chase version read as busy rather than
 * sharp, and at this distance a crisp lit outline looks better than detail.
 */
function Gate({
  position,
  yaw,
  kind,
  color,
  size,
}: {
  position: THREE.Vector3;
  yaw: number;
  kind: 'square' | 'hoop';
  color: string;
  size: number;
}) {
  const mat = (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={1.7}
      roughness={0.35}
      toneMapped={false}
    />
  );

  if (kind === 'hoop') {
    return (
      <group position={position} rotation={[0, yaw, 0]}>
        <mesh>
          <torusGeometry args={[size, size * 0.05, 12, 64]} />
          {mat}
        </mesh>
      </group>
    );
  }

  const h = size / 2;
  const t = size * 0.045;
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh position={[0, h, 0]}>
        <boxGeometry args={[size + t, t, t]} />
        {mat}
      </mesh>
      <mesh position={[0, -h, 0]}>
        <boxGeometry args={[size + t, t, t]} />
        {mat}
      </mesh>
      <mesh position={[-h, 0, 0]}>
        <boxGeometry args={[t, size, t]} />
        {mat}
      </mesh>
      <mesh position={[h, 0, 0]}>
        <boxGeometry args={[t, size, t]} />
        {mat}
      </mesh>
    </group>
  );
}

/** The drone, following the path with heading and bank derived from it. */
function FlyingDrone({ spec }: { spec: DroneSpec }) {
  const group = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const bank = useRef(0);

  const pos = useMemo(() => new THREE.Vector3(), []);
  const tan = useMemo(() => new THREE.Vector3(), []);
  const tanNext = useMemo(() => new THREE.Vector3(), []);

  useFrame((s, dt) => {
    if (!group.current) return;
    const t = s.clock.elapsedTime * PATH.speed;

    pathPoint(t, pos);
    pathTangent(t, tan);
    group.current.position.copy(pos);

    // Heading: the airframe's forward is -Z.
    const heading = Math.atan2(-tan.x, -tan.z);
    group.current.rotation.set(0, heading, 0);

    // Bank into the turn, from how fast the heading is changing.
    pathTangent(t + 0.05, tanNext);
    const turn = Math.atan2(-tanNext.x, -tanNext.z) - heading;
    const wrapped = Math.atan2(Math.sin(turn), Math.cos(turn));
    bank.current = THREE.MathUtils.lerp(
      bank.current,
      THREE.MathUtils.clamp(wrapped * 9, -0.75, 0.75),
      Math.min(1, dt * 3),
    );
    if (tilt.current) {
      tilt.current.rotation.z = bank.current;
      tilt.current.rotation.x = 0.14; // nose-down, as in forward flight
    }
  });

  const SCALE = 7;

  return (
    <group ref={group}>
      <group ref={tilt}>
        <group scale={SCALE}>
          {/* No stand-in mesh: briefly showing a different-looking airframe
              in the hero shot is worse than showing nothing. */}
          <DroneModel spec={spec} placeholder={null} idleSpin={0.8} />
        </group>
      </group>

      {/* Key, fill and rim so the dark airframe separates from the dark arena. */}
      <pointLight color="#ffffff" intensity={3.2} distance={4} position={[0.8, 1.0, 1.4]} />
      <pointLight color={CYAN} intensity={2.6} distance={3} position={[-0.9, 0.2, 0.8]} />
      <pointLight color="#ffffff" intensity={2.2} distance={3} position={[0, 0.5, -1.2]} />
      <pointLight color={CYAN} intensity={2} distance={2.4} position={[0, -0.4, 0]} />
    </group>
  );
}

function Arena() {
  const gates = useMemo(() => {
    const p = new THREE.Vector3();
    const tg = new THREE.Vector3();
    return GATE_TS.map((t, i) => {
      const position = pathPoint(t, p).clone();
      pathTangent(t, tg);
      return {
        position,
        yaw: Math.atan2(tg.x, tg.z), // gate plane normal aligns with travel
        seed: i * 1.3,
        ...GATE_STYLE[i],
      };
    });
  }, []);

  return (
    <>
      {/* Fog is deliberately tight. The drone's path reaches ~15 m from camera,
          so a far plane of 40 barely faded it at all; pulling it in to 17 means
          the far half of the circuit dissolves into the dark and only the clean,
          close part of the pass is actually on show. */}
      <fog attach="fog" args={['#04060b', 7, 17]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]}>
        <planeGeometry args={[120, 120]} />
        <MeshReflectorMaterial
          resolution={512}
          mirror={0.55}
          mixBlur={7}
          mixStrength={2.4}
          blur={[300, 80]}
          depthScale={1}
          minDepthThreshold={0.3}
          maxDepthThreshold={1.3}
          color="#070c14"
          metalness={0.8}
          roughness={0.74}
        />
      </mesh>

      {gates.map((g, i) => (
        <group key={i}>
          <Gate
            position={g.position}
            yaw={g.yaw}
            kind={g.kind}
            color={g.color}
            size={g.size}
          />
          <pointLight
            color={g.color}
            intensity={30}
            distance={18}
            position={[g.position.x, g.position.y + 0.2, g.position.z]}
          />
        </group>
      ))}
    </>
  );
}

export function ArenaShowcase({ spec }: { spec: DroneSpec }) {
  return (
    <div className="arena-scene">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0.25, 1.4, 3.4], fov: 42, near: 0.05, far: 120 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#04060b']} />
        <CameraAim />
        <ambientLight intensity={1.2} />
        <hemisphereLight intensity={1} color="#bcd8ff" groundColor="#0a1018" />
        <directionalLight position={[3, 5, 4]} intensity={2.4} />
        <directionalLight position={[-3, 2, 2]} intensity={1} color={CYAN} />
        <Suspense fallback={null}>
          <Arena />
          <FlyingDrone spec={spec} />
        </Suspense>
      </Canvas>
    </div>
  );
}

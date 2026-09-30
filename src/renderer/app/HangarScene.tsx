import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { RoomEnvironment } from 'three-stdlib';
import * as THREE from 'three';
import type { DroneSpec } from '@shared/types';
import { DroneModel } from '../sim/drone/DroneModel';
import { SyntheticBlades } from '../sim/drone/Propellers';
import { token } from '../styles/tokens';

// The drone turntable on Home, the Sign-in page and in the Hangar: the drone on
// a landing pad, turning slowly, lit like a product shot. No physics.
//
// Lighting (user, 2026-09-29: "lighting … accha kar lo"): reflections from
// three's bundled RoomEnvironment — built in memory, nothing fetched, which the
// CSP would block anyway — a soft key light from above, a fill from the other
// side, and a neutral rim light behind the drone that picks out its edge. A
// contact shadow sits it on the pad; the pad's side carries the one signal
// accent (see Pad). The page
// behind the transparent canvas is the stage glow from tokens.css.
// Colours come from tokens.css (via token()), like the rest of the UI.

/** Radians per second: one turn in about 18 s. */
const TURN_RATE = 0.35;
/** Height of the disc's top face. */
const DISC_TOP = -0.069;

/** Every drone drawn at one size on the disc: a 50 g Pluto and a 1.5 kg Guru
 *  would otherwise be a speck and a wall. Arm length is the airframe's scale. */
function fit(spec: DroneSpec): number {
  return 0.09 / (spec.armLength * (spec.sizeScale ?? 1));
}

/** Studio reflections: a small prefiltered RoomEnvironment, freed on unmount. */
function StudioReflections() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    // The room is only needed to bake the reflections.
    room.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

/** Camera distance at a landscape stage. */
const CAMERA_POS = new THREE.Vector3(0, 0.14, 0.52);
/** Below this aspect the camera backs off, so the disc keeps a margin at the sides. */
const FIT_ASPECT = 1.45;

/** A tall stage (Home's hero, a narrow window) narrows the horizontal view,
 *  and the disc would run off both sides. Back the camera off so it fits. */
function FitCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const back = Math.max(1, FIT_ASPECT / aspect);
    camera.position.copy(CAMERA_POS).multiplyScalar(back);
    camera.lookAt(0, 0, 0);
  }, [camera, size.width, size.height]);
  return null;
}

/** The pad's thickness, and the bevel that rounds its top edge. */
const PAD_H = 0.012;
const PAD_R = 0.2;
const BEVEL = 0.004;

/** The pad in profile, turned on a lathe: flat bottom, straight side, a
 *  rounded top edge, flat top. One solid, so nothing sits ON its top face. */
function padProfile(): THREE.Vector2[] {
  const bottom = DISC_TOP - PAD_H;
  const pts = [new THREE.Vector2(0, bottom), new THREE.Vector2(PAD_R, bottom)];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(
      new THREE.Vector2(
        PAD_R - BEVEL + Math.cos(a) * BEVEL,
        DISC_TOP - BEVEL + Math.sin(a) * BEVEL,
      ),
    );
  }
  pts.push(new THREE.Vector2(0, DISC_TOP));
  return pts;
}

/**
 * A landing pad: matte rubber with a bevelled edge, a painted marking ring and
 * a thin signal light band round its side.
 *
 * It used to be a cylinder with a glowing ring laid ON its top face, both at
 * exactly DISC_TOP — coplanar, so the two z-fought and the edge flickered
 * while it turned (user, 2026-09-29: "lap-dap"). Now nothing shares a plane:
 * the marking is lifted off the top and pulled forward with polygon offset,
 * and the light band sits on the SIDE, a hair outside the rubber.
 */
function Pad() {
  const profile = useMemo(padProfile, []);
  return (
    <group>
      <mesh>
        <latheGeometry args={[profile, 128]} />
        <meshStandardMaterial
          color={token('ink-800')}
          roughness={0.85}
          metalness={0}
          envMapIntensity={0.35}
        />
      </mesh>
      {/* Painted marking, inset from the edge. */}
      <mesh position={[0, DISC_TOP + 0.0004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.152, 0.162, 128]} />
        <meshStandardMaterial
          color={token('txt-low')}
          roughness={0.9}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      {/* The light band round the side: the one signal accent. */}
      <mesh position={[0, DISC_TOP - PAD_H / 2, 0]}>
        <cylinderGeometry args={[PAD_R + 0.0006, PAD_R + 0.0006, 0.0025, 128, 1, true]} />
        <meshBasicMaterial color={token('signal')} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** How far the turntable turns in `dt` seconds, radians: nothing while paused
 *  (❚❚ Pause, or reduced motion). Exported for tests — the canvas cannot run
 *  under jsdom. */
export function turnFor(dt: number, paused: boolean): number {
  return paused ? 0 : dt * TURN_RATE;
}

function Turntable({ spec, paused }: { spec: DroneSpec; paused: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_s, dt) => {
    if (ref.current) ref.current.rotation.y += turnFor(dt, paused);
  });
  return (
    <group ref={ref} rotation={[0, -0.6, 0]}>
      <Pad />
      <group position={[0, -0.04, 0]} scale={fit(spec)}>
        <DroneModel spec={spec} placeholder={null} />
        {/* A 'blur' airframe (the Racing Drone) ships motion-blur discs, not
            blades, and hides them while the motors are stopped. In flight the
            stand-in blades fill in; on the turntable they must too, or the
            drone stands there with no propellers. */}
        {spec.propArt === 'blur' && <SyntheticBlades spec={spec} />}
      </group>
    </group>
  );
}

export function HangarScene({ spec, paused }: { spec: DroneSpec; paused: boolean }) {
  const light = token('txt-hi');
  return (
    <div className="hangar-scene" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0.14, 0.52], fov: 38, near: 0.01, far: 10 }}
        gl={{ alpha: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        dpr={[1, 2]}
      >
        <FitCamera />
        <StudioReflections />
        <hemisphereLight args={[light, token('ink-950'), 0.6]} />
        {/* Key: above and in front. */}
        <spotLight position={[0.35, 0.9, 0.6]} angle={0.5} penumbra={0.8} intensity={6} color={light} />
        {/* Fill: low, from the other side — enough that the drone's own colours read. */}
        <directionalLight position={[-1.5, 0.6, 1]} intensity={1.3} color={light} />
        {/* Rim: behind and low, neutral, so it outlines the airframe instead of
            flooding the pad. It was signal orange at 2.4 from above, which
            turned the whole pad orange (user, 2026-09-29: "bahut zyada"). */}
        <directionalLight position={[0, 0.2, -1.2]} intensity={1.4} color={light} />
        <Suspense fallback={null}>
          <Turntable spec={spec} paused={paused} />
          <ContactShadows
            position={[0, DISC_TOP + 0.0012, 0]}
            scale={0.4}
            blur={2.4}
            far={0.12}
            opacity={0.7}
            resolution={256}
            color={token('ink-950')}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

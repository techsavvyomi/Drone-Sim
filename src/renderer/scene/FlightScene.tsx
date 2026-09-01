import { Physics } from '@react-three/rapier';
import { Grid, Sky, Stars } from '@react-three/drei';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useFlightStore } from '../state/flightStore';
import { useWorldStore, TIME_PRESETS } from '../state/worldStore';
import { getDrone, getEnvironment } from '../plugins/registry';
import { GRAVITY, SIM_DT } from '../sim/constants';
import { Drone } from '../sim/drone/Drone';
import { CameraRig, OrbitCamera } from './CameraRig';
import { GroundMarker } from './GroundMarker';
import { getEnvironmentComponent } from './environment';
import { SkyClouds } from './SkyClouds';
import { RotorWash } from './RotorWash';
import { PropDebris } from './PropDebris';
import { LocalEnvironment } from './LocalEnvironment';
import { PostFX } from './PostFX';
import { DroneAudio } from '../audio/DroneAudio';

// The Fly view's 3D contents: sky + lighting for the selected time of day, the
// active environment, the drone under a fixed-timestep Rapier world, and the
// camera rig.
//
// `envIdOverride` lets callers (e.g. Flight School) force a specific environment
// without changing the pilot's saved selection; the Fly view passes nothing.
export function FlightScene({ envIdOverride }: { envIdOverride?: string } = {}) {
  const droneId = useSettingsStore((s) => s.settings.selectedDroneId);
  const selectedEnvId = useSettingsStore((s) => s.settings.selectedEnvironmentId);
  const envId = envIdOverride ?? selectedEnvId;
  const cameraMode = useUiStore((s) => s.cameraMode);
  const timeOfDay = useWorldStore((s) => s.timeOfDay);
  const cloudsEnabled = useWorldStore((s) => s.cloudsEnabled);
  const paused = useFlightStore((s) => s.paused);

  const graphics = useSettingsStore((s) => s.settings.graphics);
  const hud = useSettingsStore((s) => s.settings.hud);

  const spec = getDrone(droneId);
  const env = getEnvironment(envId);

  if (!spec || !env) return null;

  // Shadow cost scales with map area, and the sun is the only caster. On Low the
  // shadow pass is skipped outright — an integrated GPU cannot afford a full
  // extra scene render for it.
  const shadows = graphics !== 'low';
  const shadowMap = graphics === 'high' ? 1024 : 512;

  const t = TIME_PRESETS[timeOfDay];
  const EnvComponent = getEnvironmentComponent(env.id);
  const outdoor = env.kind === 'outdoor';
  const isClassroom = env.id === 'classroom-2';
  // Outdoor presets wash indoor albedo. Classroom 2 brings its own light rig;
  // keep global fill modest so textured PBR colors stay readable (Meshy-like).
  const ambient = isClassroom ? 0.35 : outdoor ? t.ambient : t.ambient * 0.4;
  const hemi = isClassroom
    ? 0.25
    : outdoor
      ? t.night
        ? 0.25
        : 0.7
      : t.night
        ? 0.18
        : 0.28;
  const sun = isClassroom ? 0.2 : outdoor ? t.sunIntensity : t.sunIntensity * 0.3;
  const bg = isClassroom
    ? '#2a3340'
    : outdoor
      ? t.fogColor
      : t.night
        ? '#1a2230'
        : '#c8d0da';
  // Image-based lighting is what puts specular sheen on roads and glass, so the
  // time preset scales it: a hard midday sun made every surface read as wet.
  const ibl = (isClassroom ? 0.6 : outdoor ? 1 : 0.22) * t.iblScale;
  const fogNear = env.fog?.near ?? t.fogNear;
  const fogFar = env.fog?.far ?? t.fogFar;

  return (
    <>
      <color attach="background" args={[bg]} />
      {/* Indoors: skip distance fog — small rooms sit inside outdoor fogNear
          and the light fog colour flattens textured walls to white. */}
      {outdoor && <fog attach="fog" args={[t.fogColor, fogNear, fogFar]} />}

      {/* Procedural sky — no HDRI download, so it works offline under our CSP. */}
      {outdoor && (
        <Sky
          distance={45000}
          sunPosition={t.sun}
          turbidity={t.skyTurbidity}
          rayleigh={t.skyRayleigh}
          mieCoefficient={0.006}
          mieDirectionalG={0.8}
        />
      )}
      {outdoor && t.night && <Stars radius={300} depth={60} count={3500} factor={5} fade speed={0.4} />}
      {outdoor && cloudsEnabled && !t.night && <SkyClouds tint={t.sunColor} />}

      <LocalEnvironment preset={t} environmentIntensity={ibl} />

      <ambientLight intensity={ambient} />
      <hemisphereLight
        intensity={hemi}
        color={t.night ? '#26364d' : '#cfe3ff'}
        groundColor={outdoor ? '#3f5233' : '#0a1018'}
      />
      {/* Classroom uses its own window + ceiling rig; skip the outdoor sun key. */}
      {!isClassroom && (
        <directionalLight
          position={t.sun}
          intensity={sun}
          color={t.sunColor}
          castShadow={shadows}
          shadow-mapSize={[shadowMap, shadowMap]}
          shadow-bias={-0.0002}
          shadow-normalBias={0.02}
          shadow-camera-left={-38}
          shadow-camera-right={38}
          shadow-camera-top={38}
          shadow-camera-bottom={-38}
          shadow-camera-near={0.5}
          shadow-camera-far={200}
        />
      )}

      {!outdoor && !isClassroom && (
        <Grid
          args={[60, 60]}
          cellColor="#6d7d94"
          sectionColor="#9fb4cc"
          sectionSize={5}
          cellSize={1}
          fadeDistance={70}
          infiniteGrid
          position={[0, 0.002, 0]}
        />
      )}

      {/* Contact tuning, not cosmetics: on Rapier's defaults the drone sinks
          17-47 mm into the floor on touchdown before the solver pushes it back
          out, which reads as the airframe briefly disappearing underground. The
          collider is only 48 mm tall, so at 250 Hz a descent of a few m/s
          travels most of its own thickness in a single step and the contact is
          found only once it is already deep.

          Predicting contacts from 50 mm out lets the solver catch the floor
          before the overlap happens; the extra iterations clean up what is left.
          Measured worst-case sink across 0-18 m/s impacts: 47 mm -> 5 mm.
          Rapier's `contactSkin` kills the sink outright but rests the drone
          visibly floating above the ground, so it is deliberately not used. */}
      <Physics
        timeStep={SIM_DT}
        interpolate
        paused={paused}
        gravity={[0, -GRAVITY, 0]}
        predictionDistance={0.05}
        numSolverIterations={8}
      >
        <EnvComponent env={env} />
        <Drone
          spec={spec}
          spawn={env.spawn}
          bounds={env.bounds}
          outdoor={outdoor}
          groundY={env.groundY}
        />
        <PropDebris spec={spec} />
      </Physics>

      {hud.groundMarker && <GroundMarker />}
      <RotorWash />
      <CameraRig spec={spec} env={env} />
      {/* Must stay below CameraRig: useFrame callbacks run in mount order, and
          the engine reads the camera pose for distance, panning and Doppler.
          Mounted above, it would be a frame behind — audible on a fly-by. */}
      <DroneAudio spec={spec} />
      {cameraMode === 'orbit' && <OrbitCamera spec={spec} env={env} />}

      <PostFX />
    </>
  );
}

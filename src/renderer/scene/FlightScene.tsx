import { Physics } from '@react-three/rapier';
import { Grid, OrbitControls, Sky, Stars } from '@react-three/drei';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useFlightStore } from '../state/flightStore';
import { useWorldStore, TIME_PRESETS } from '../state/worldStore';
import { getDrone, getEnvironment } from '../plugins/registry';
import { GRAVITY, SIM_DT } from '../sim/constants';
import { Drone } from '../sim/drone/Drone';
import { CameraRig } from './CameraRig';
import { GroundMarker } from './GroundMarker';
import { getEnvironmentComponent } from './environment';
import { SkyClouds } from './SkyClouds';
import { RotorWash } from './RotorWash';
import { PropDebris } from './PropDebris';
import { LocalEnvironment } from './LocalEnvironment';
import { PostFX } from './PostFX';

// The Fly view's 3D contents: sky + lighting for the selected time of day, the
// active environment, the drone under a fixed-timestep Rapier world, and the
// camera rig.
export function FlightScene() {
  const droneId = useSettingsStore((s) => s.settings.selectedDroneId);
  const envId = useSettingsStore((s) => s.settings.selectedEnvironmentId);
  const cameraMode = useUiStore((s) => s.cameraMode);
  const timeOfDay = useWorldStore((s) => s.timeOfDay);
  const cloudsEnabled = useWorldStore((s) => s.cloudsEnabled);
  const paused = useFlightStore((s) => s.paused);

  const spec = getDrone(droneId);
  const env = getEnvironment(envId);

  if (!spec || !env) return null;

  const t = TIME_PRESETS[timeOfDay];
  const EnvComponent = getEnvironmentComponent(env.id);
  const outdoor = env.kind === 'outdoor';

  return (
    <>
      <color attach="background" args={[t.fogColor]} />
      <fog attach="fog" args={[t.fogColor, t.fogNear, t.fogFar]} />

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

      {/* Image-based lighting so PBR materials have something to reflect. */}
      <LocalEnvironment preset={t} />

      <ambientLight intensity={t.ambient} />
      <hemisphereLight
        intensity={t.night ? 0.25 : 0.7}
        color={t.night ? '#26364d' : '#cfe3ff'}
        groundColor={outdoor ? '#3f5233' : '#0a1018'}
      />
      <directionalLight
        position={t.sun}
        intensity={t.sunIntensity}
        color={t.sunColor}
        castShadow
        /* 4096 over a 76m span is ~1.9cm per texel. The drone is only 16cm
           across, so at the old 2048/90m (4.4cm per texel) its shadow was about
           four texels wide and read as a smudge. */
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
        shadow-camera-left={-38}
        shadow-camera-right={38}
        shadow-camera-top={38}
        shadow-camera-bottom={-38}
        shadow-camera-near={0.5}
        shadow-camera-far={200}
      />

      {/* The indoor arena keeps its reference grid; outdoors has real ground. */}
      {!outdoor && (
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

      {/* Halting the world means the drone hangs where you paused it instead of
          dropping while the menu is open. */}
      <Physics timeStep={SIM_DT} interpolate paused={paused} gravity={[0, -GRAVITY, 0]}>
        <EnvComponent env={env} />
        <Drone spec={spec} spawn={env.spawn} bounds={env.bounds} outdoor={outdoor} />
        <PropDebris spec={spec} />
      </Physics>

      <GroundMarker />
      <RotorWash />
      <CameraRig spec={spec} />
      {cameraMode === 'orbit' && (
        <OrbitControls makeDefault target={[0, 1.5, 0]} maxPolarAngle={Math.PI / 2.05} />
      )}

      <PostFX />
    </>
  );
}

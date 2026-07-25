import { EffectComposer, Bloom, Vignette, SMAA, SSAO } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { useSettingsStore } from '../state/settingsStore';
import { useWorldStore, TIME_PRESETS } from '../state/worldStore';

// Post-processing. Deliberately restrained — bloom is what makes emissive gates,
// LEDs and floodlights read as *light* rather than as brightly-painted geometry,
// and a light vignette stops the frame edges feeling flat.
//
// The luminance threshold keeps bloom off ordinary lit surfaces so only genuinely
// emissive things glow. Disabled entirely on the Low graphics preset.
export function PostFX() {
  const graphics = useSettingsStore((s) => s.settings.graphics);
  const timeOfDay = useWorldStore((s) => s.timeOfDay);
  const night = TIME_PRESETS[timeOfDay].night;

  if (graphics === 'low') return null;

  const highQuality = graphics === 'high' || graphics === 'ultra';

  return (
    <EffectComposer multisampling={highQuality ? 4 : 0} enableNormalPass={highQuality}>
      {/* Ambient occlusion darkens contact points and crevices. Without it
          everything reads as floating on the ground rather than resting on it —
          the single biggest "CG" tell in a procedural scene. Needs the normal
          pass, so it's High/Ultra only. */}
      {highQuality ? (
        <SSAO
          blendFunction={BlendFunction.MULTIPLY}
          samples={16}
          radius={0.08}
          intensity={22}
          luminanceInfluence={0.5}
          bias={0.03}
          worldDistanceThreshold={40}
          worldDistanceFalloff={12}
          worldProximityThreshold={4}
          worldProximityFalloff={1}
        />
      ) : (
        <></>
      )}
      <Bloom
        // Emissive materials sit well above 1.0, ordinary surfaces below it.
        luminanceThreshold={night ? 0.55 : 0.95}
        luminanceSmoothing={0.25}
        intensity={night ? 1.15 : 0.5}
        mipmapBlur
        radius={0.72}
      />
      <Vignette offset={0.28} darkness={0.42} eskil={false} />
      {highQuality ? <SMAA /> : <></>}
    </EffectComposer>
  );
}

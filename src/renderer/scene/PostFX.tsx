import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing';
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
  const t = TIME_PRESETS[timeOfDay];

  if (graphics === 'low') return null;

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        // Emissive materials sit well above 1.0, ordinary surfaces below it —
        // but how far below depends on how hard the sun is driving them, so the
        // threshold comes from the time preset rather than a night/day flag.
        luminanceThreshold={t.bloomThreshold}
        luminanceSmoothing={0.25}
        intensity={t.bloomIntensity}
        radius={0.6}
      />
      <Vignette offset={0.28} darkness={0.42} eskil={false} />
      {graphics === 'high' ? <SMAA /> : <></>}
    </EffectComposer>
  );
}

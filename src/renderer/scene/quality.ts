import type { GraphicsPreset } from '@shared/types';

/**
 * What each graphics preset actually costs to draw.
 *
 * The preset used to gate only post-processing, so "Low" still rendered the full
 * city at native device pixel ratio with MSAA and shadows — which is why an
 * integrated GPU sat at single-digit framerates on Low and High alike. Pixel
 * count is the dominant term on integrated parts, so that is what the preset
 * moves first.
 *
 * It lives here rather than in `Viewport` because Flight School has its own
 * <Canvas> and used to hard-code shadows and MSAA on. A pilot who dropped to Low
 * because the Fly view was unusable then opened a lesson and got the expensive
 * settings back, on the very machine that could not afford them.
 */
export const QUALITY: Record<
  GraphicsPreset,
  { dpr: [number, number]; shadows: boolean; msaa: boolean }
> = {
  // Low renders at native resolution and buys its frames by dropping the shadow
  // pass instead. Undersampling below 1.0 was tried and reads as a soft, smeared
  // image — on a city full of thin geometry (railings, poles, leaf cutouts) it
  // costs far more perceived quality per frame gained than turning shadows off.
  low: { dpr: [1, 1], shadows: false, msaa: false },
  medium: { dpr: [1, 1], shadows: true, msaa: false },
  // MSAA is deliberately OFF here, and it is not an oversight.
  //
  // High runs the post-processing chain, and `EffectComposer` is mounted with
  // `multisampling={0}`: the scene is rendered into the composer's own target,
  // and all the WebGL context's `antialias` can touch is the default framebuffer
  // — which by then receives nothing but the composer's final fullscreen pass.
  // So it anti-aliased nothing while still forcing a multisampled framebuffer to
  // be allocated and resolved every frame. SMAA, inside the chain, is what has
  // actually been smoothing High's edges all along.
  //
  // The dpr entry is a CEILING rather than a fixed scale — see
  // `AdaptiveResolution`, which walks it down when the frames do not arrive.
  high: { dpr: [1, 1.5], shadows: true, msaa: false },
};

export function qualityFor(preset: GraphicsPreset | undefined) {
  return QUALITY[preset as GraphicsPreset] ?? QUALITY.medium;
}

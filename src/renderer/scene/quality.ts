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
  high: { dpr: [1, 1.5], shadows: true, msaa: true },
};

export function qualityFor(preset: GraphicsPreset | undefined) {
  return QUALITY[preset as GraphicsPreset] ?? QUALITY.medium;
}

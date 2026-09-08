import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { QUALITY } from './quality';
import { useSettingsStore } from '../state/settingsStore';

// ----------------------------------------------------------------------------
// Holds the frame rate by moving the one number that actually costs frames.
//
// The graphics preset is a fixed setting, and "High" was a promise the machine
// might not be able to keep: dpr 1.5 on a 2000 px window is 2.25x the pixels of
// Medium, and on an integrated GPU over the city that landed at eleven frames a
// second. Eleven fps is ninety milliseconds a frame, and EVERY part of the
// control chain — the stick easing, the physics catch-up, the camera — advances
// once per frame. That is felt as input lag, and no amount of tuning in
// `controls.ts` can recover it, because the delay is not in the input.
//
// So the preset now sets a CEILING rather than a fixed resolution. High still
// renders at 1.5 on hardware that can hold it; where it cannot, the resolution
// comes down until the frames arrive. Everything else the preset asks for —
// shadows, the shadow map size, SMAA — is left alone: those are what make High
// look like High, and they are not the term that scales with window size.
// ----------------------------------------------------------------------------

/**
 * The lowest resolution scale this will fall to.
 *
 * One, and not below. Undersampling reads as a soft, smeared image, and on a
 * city full of thin geometry — railings, poles, leaf cutouts — it costs far more
 * perceived quality per frame gained than any other lever (the same reason the
 * Low preset buys its frames by dropping shadows instead — see `quality.ts`).
 */
const FLOOR = 1;

export function AdaptiveResolution() {
  const setDpr = useThree((s) => s.setDpr);
  const graphics = useSettingsStore((s) => s.settings.graphics);
  const ceiling = QUALITY[graphics]?.dpr[1] ?? 1;
  /** What we last asked for, so an unchanged factor does not resize the drawing
   *  buffer — reallocating it is itself a dropped frame. */
  const applied = useRef(-1);

  /** Set once the monitor gives up: the machine is below the floor and there is
   *  nothing left to give, so stop touching the drawing buffer at all. */
  const settled = useRef(false);

  const apply = (next: number) => {
    if (Math.abs(next - applied.current) < 0.05) return;
    applied.current = next;
    setDpr(next);
  };

  return (
    <PerformanceMonitor
      // Three changes of direction and it stops.
      //
      // Resizing the drawing buffer is not free: the frame it happens on is a
      // long one. A monitor left to hunt forever will find the resolution the
      // machine sits exactly at the edge of, and then oscillate around it —
      // which is a resize every second or so, and that reads as the stutter this
      // was meant to remove rather than as a lower frame rate. So it is allowed
      // a few corrections and then told to settle.
      flipflops={3}
      onFallback={() => {
        settled.current = true;
        apply(FLOOR);
      }}
      // `factor` is 0 when the frame rate is at the bottom of the monitor's
      // bounds and 1 at the top; onChange fires on its steps rather than every
      // frame, which is what keeps this from resizing the buffer constantly.
      onChange={({ factor }) => {
        if (settled.current) return;
        apply(Math.round((FLOOR + (ceiling - FLOOR) * factor) * 100) / 100);
      }}
    />
  );
}

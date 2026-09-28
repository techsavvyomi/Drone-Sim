import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Material, Mesh } from 'three';
import { create } from 'zustand';
import type { GraphicsPreset } from '@shared/types';
import { useSettingsStore } from '../state/settingsStore';
import { useFlightStore } from '../state/flightStore';

// ----------------------------------------------------------------------------
// Steps the graphics preset down when a machine cannot hold it.
//
// The preset is the pilot's to choose, but most never open Settings, and the
// default (Medium) is a guess about a laptop we have never seen. Measured on a
// fast Mac, the Forest runs 25 / 38 / 45 fps on High / Medium / Low and New York
// 35 / 55 / 72; on an integrated GPU the same Medium lands in the teens, and
// every part of the control chain advances once per frame, so it flies badly,
// not just looks choppy. `AdaptiveResolution` only has room to move on High.
//
// So: after the view settles, frames are counted in windows, and two slow
// windows in a row step the preset down one level (High -> Medium -> Low),
// saved, with a notice saying so. Never up — a pilot on a machine that can do
// more can pick it in Settings — and never below Low. Off in Settings → Video.
// ----------------------------------------------------------------------------

/** Below this, a window counts as slow, fps. Judgement: under ~28 the stick
 *  easing and the camera visibly step, and the next preset down is worth more
 *  than what it takes away. */
export const LOW_FPS = 28;
/** Slow windows in a row before stepping down; one alone can be a hitch. */
export const SLOW_WINDOWS = 2;
/** Length of one counting window, ms. */
const WINDOW_MS = 5000;
/** Ignored after mounting and after every change, ms: the veil, the warm
 *  frames, and the recompile a change itself causes are not the steady state. */
const SETTLE_MS = 4000;

const ORDER: GraphicsPreset[] = ['low', 'medium', 'high'];

/** The preset one step down, or null at the bottom. */
export function stepDown(preset: GraphicsPreset): GraphicsPreset | null {
  const i = ORDER.indexOf(preset);
  return i > 0 ? ORDER[i - 1] : null;
}

/** The notice shown after an automatic change; cleared by the notice itself. */
export const useQualityNotice = create<{ lowered: GraphicsPreset | null }>(() => ({ lowered: null }));

export function AutoQuality() {
  const scene = useThree((s) => s.scene);
  const enabled = useSettingsStore((s) => s.settings.autoGraphics);
  const graphics = useSettingsStore((s) => s.settings.graphics);

  const settleUntil = useRef(0);
  const windowStart = useRef(0);
  const frames = useRef(0);
  const slow = useRef(0);
  /** Set when this view changed the preset, so the materials are recompiled
   *  for it once React has applied the new one. */
  const recompile = useRef(false);

  // A fresh start on mount and whenever the preset changes, by hand or by us.
  useEffect(() => {
    settleUntil.current = performance.now() + SETTLE_MS;
    windowStart.current = 0;
    frames.current = 0;
    slow.current = 0;
    if (!recompile.current) return;
    recompile.current = false;
    // Shadows on or off changes every lit material's program, and three does
    // not notice on its own mid-view.
    scene.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }, [graphics, scene]);

  useFrame(() => {
    if (!enabled) return;
    const now = performance.now();
    // Time that is not flying says nothing about the machine.
    if (useFlightStore.getState().paused || document.visibilityState !== 'visible') {
      windowStart.current = 0;
      return;
    }
    if (now < settleUntil.current) return;
    if (windowStart.current === 0) {
      windowStart.current = now;
      frames.current = 0;
      return;
    }
    frames.current += 1;
    const elapsed = now - windowStart.current;
    if (elapsed < WINDOW_MS) return;

    const fps = (frames.current * 1000) / elapsed;
    windowStart.current = now;
    frames.current = 0;
    slow.current = fps < LOW_FPS ? slow.current + 1 : 0;
    if (slow.current < SLOW_WINDOWS) return;

    const next = stepDown(graphics);
    slow.current = 0;
    if (!next) return;
    recompile.current = true;
    useSettingsStore.getState().set('graphics', next);
    useQualityNotice.setState({ lowered: next });
  });

  return null;
}

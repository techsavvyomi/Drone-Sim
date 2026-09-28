import { app } from 'electron';

// Which GPU the app draws on.
//
// The 3D view is GPU-bound, and on the machine it was built on there is only
// one GPU to pick. A pilot's laptop is often different, in two ways that both
// read as "the sim lags" and neither of which the renderer can fix:
//
// - A Windows laptop with a discrete GPU runs an unknown app on its integrated
//   one. WebGL's `powerPreference: 'high-performance'` does not move it there;
//   the GPU process picks its adapter before any page asks.
// - An older graphics driver on Chromium's blocklist turns hardware WebGL off,
//   and the view falls back to software rendering on the CPU — single-digit
//   frame rates, with nothing on screen to say why.
//
// Settings → About shows the GPU the view ended up on, and flags software
// rendering, so either case can be read off the pilot's machine.

/** Chromium switches, set before the app is ready (they are read at GPU startup). */
export const GPU_SWITCHES = ['force_high_performance_gpu', 'ignore-gpu-blocklist'] as const;

/** Call before `app.whenReady()`. */
export function preferHighPerformanceGpu(): void {
  for (const name of GPU_SWITCHES) app.commandLine.appendSwitch(name);
}

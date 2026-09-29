// The smallest layout the app shell is drawn for, in CSS px. The window can't
// be resized below it, but a screen can be smaller than it in CSS px — 1366 ×
// 768 at 150 % Windows scaling is 910 × 512 — and then the page is zoomed out
// rather than reflowed below the minimum.
export const SHELL_MIN_WIDTH = 1100;
export const SHELL_MIN_HEIGHT = 720;

/** Zoom factor for a window content area of `width` × `height` DIP (CSS px at
 *  zoom 1): min(w / 1100, h / 720), never above 1. */
export function shellZoom(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const z = Math.min(1, width / SHELL_MIN_WIDTH, height / SHELL_MIN_HEIGHT);
  return Math.floor(z * 1000) / 1000;
}

/** Launch flag that shows the renderer's FPS read-out. Never in a shipped build's
 *  default launch; the renderer sees it as `?devFps=1`. */
export const DEV_FPS_FLAG = '--dev-fps';

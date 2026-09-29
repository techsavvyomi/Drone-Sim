// ----------------------------------------------------------------------------
// Design tokens for code that cannot use CSS: canvas minimaps, uPlot charts,
// three.js overlays. They read the SAME variables `tokens.css` defines, at run
// time, so tokens.css stays the only place a colour is written.
// ----------------------------------------------------------------------------

/** Every colour token in tokens.css. */
export const COLOR_TOKENS = [
  'ink-950',
  'ink-900',
  'ink-800',
  'ink-700',
  'line',
  'txt-hi',
  'txt-mid',
  'txt-low',
  'signal',
  'signal-d',
  'armed',
  'caution',
  'fail',
  'plot',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

const cache = new Map<string, string>();

/** The current value of a CSS custom property on :root, e.g. `token('signal')`.
 *  Cached: tokens do not change while the app runs. */
export function token(name: ColorToken | (string & {})): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  if (value) cache.set(name, value);
  return value;
}

/** Drops cached values — for tests, or after tokens.css hot-reloads in dev. */
export function clearTokenCache(): void {
  cache.clear();
}

// Where the profile & analytics backend lives.
//
// The prototype's Apps Script web app is the default. Two overrides, in order:
//   1. DRONESIM_BACKEND_URL at run time, to point `npm start` at a test deployment;
//   2. DRONESIM_BACKEND_URL at build time (see vite.main.config.ts), for a build
//      that should talk to a different deployment.
// Set either to `off` to run with profiles switched off.
//
// Redeploying the Apps Script as a NEW VERSION of the same deployment keeps this
// URL; creating a new deployment does not, and the new URL goes here.

export const PROTOTYPE_BACKEND_URL =
  'https://script.google.com/macros/s/AKfycbwwK87DaHuCRxWm09UJOw0Bd7uetYVUU5HpuOneXajS5zpYA_Uv2i30bnjAZmJeoAgX/exec';

declare const __DRONESIM_BACKEND_URL__: string;

export function backendUrl(): string {
  const built = typeof __DRONESIM_BACKEND_URL__ === 'string' ? __DRONESIM_BACKEND_URL__.trim() : '';
  const chosen = process.env.DRONESIM_BACKEND_URL?.trim() || built || PROTOTYPE_BACKEND_URL;
  return chosen.toLowerCase() === 'off' ? '' : chosen;
}

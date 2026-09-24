import * as THREE from 'three';

// A soft round glow, for the small lights a night mission hangs in the world:
// the site's floodlight heads and the amber marker
// on an inspection zone.
//
// Drawn on a canvas rather than loaded: the CSP blocks every external fetch,
// and a radial gradient is all a halo is. One texture for all of them, built on
// first use and kept — it is 64 px square and every sprite shares it.

let glow: THREE.CanvasTexture | null = null;

export function glowTexture(): THREE.CanvasTexture {
  if (glow) return glow;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  glow = new THREE.CanvasTexture(canvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}

import * as THREE from 'three';

/**
 * Procedural texture generator for a realistic Bengal tiger coat and features.
 *
 * Why procedural canvas textures:
 * 1. Zero external network assets (100% offline, CSP compliant).
 * 2. Ultra-lightweight (computed in milliseconds on canvas, cached in GPU VRAM).
 * 3. Rich realistic details: authentic vertical branching stripes, warm tawny orange
 *    fur with golden highlights, creamy-white belly/throat gradients, fur fiber noise,
 *    and facial mask markings (white eye patches, cheek ruffs, whisker dots).
 */

export interface TigerTextures extends Record<string, THREE.CanvasTexture> {
  bodyMap: THREE.CanvasTexture;
  bodyBump: THREE.CanvasTexture;
  faceMap: THREE.CanvasTexture;
  legMap: THREE.CanvasTexture;
  tailMap: THREE.CanvasTexture;
  eyeMap: THREE.CanvasTexture;
}

/**
 * Creates the primary body coat texture (tawny orange base, white underbelly,
 * vertical flame-like branching tiger stripes, and fur micro-texture).
 */
function generateBodyTexture(): { map: HTMLCanvasElement; bump: HTMLCanvasElement } {
  const width = 1024;
  const height = 512;

  // Diffuse Canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Bump Canvas
  const bCanvas = document.createElement('canvas');
  bCanvas.width = width;
  bCanvas.height = height;
  const bCtx = bCanvas.getContext('2d')!;

  // 1. Base gradient: Dorsal spine (top/bottom edges in cylindrical mapping or V-gradient)
  const baseGrad = ctx.createLinearGradient(0, 0, 0, height);
  baseGrad.addColorStop(0.0, '#9e4410'); // Deep mahogany dorsal ridge
  baseGrad.addColorStop(0.18, '#bd5e1b'); // Bengal tawny orange
  baseGrad.addColorStop(0.45, '#d97b28'); // Golden amber flank
  baseGrad.addColorStop(0.72, '#eec58f'); // Transition fawn
  baseGrad.addColorStop(0.85, '#f4ebd8'); // Creamy warm underbelly
  baseGrad.addColorStop(1.0, '#faf6ec'); // Pure soft white underside
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, width, height);

  // Bump base
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, width, height);

  // 2. Micro fur noise
  const imgData = ctx.getImageData(0, 0, width, height);
  const bImgData = bCtx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const bData = bImgData.data;

  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 16;
    data[i] = Math.min(255, Math.max(0, data[i] + noise));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise * 0.8));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise * 0.6));

    const bVal = Math.min(255, Math.max(0, 128 + (Math.random() - 0.5) * 32));
    bData[i] = bVal;
    bData[i + 1] = bVal;
    bData[i + 2] = bVal;
  }
  ctx.putImageData(imgData, 0, 0);
  bCtx.putImageData(bImgData, 0, 0);

  // 3. Realistic tiger stripes:
  // Tiger stripes are vertical, undulating, tapering ribbons that often bifurcate / branch.
  ctx.fillStyle = '#160e0a';
  bCtx.fillStyle = '#383838';

  const numStripes = 30;
  for (let s = 0; s < numStripes; s++) {
    const xCenter = (s / numStripes) * width + ((s * 37) % 25) - 12;
    const stripeWidth = 8 + (s % 5) * 3.5;
    const branches = s % 3 === 0;

    ctx.beginPath();
    bCtx.beginPath();

    const startY = 15 + ((s * 19) % 30);
    const endY = height * (0.65 + ((s * 23) % 20) * 0.01);
    const waveFreq = 0.015 + (s % 4) * 0.005;
    const waveAmp = 12 + (s % 3) * 8;

    ctx.moveTo(xCenter, startY);
    bCtx.moveTo(xCenter, startY);

    // Left edge of stripe
    for (let y = startY; y <= endY; y += 12) {
      const taper = Math.sin(((y - startY) / (endY - startY)) * Math.PI);
      const curve = Math.sin(y * waveFreq) * waveAmp;
      const w = stripeWidth * (0.3 + taper * 0.9);
      ctx.lineTo(xCenter + curve - w / 2, y);
      bCtx.lineTo(xCenter + curve - w / 2, y);
    }

    // Right edge of stripe back up
    for (let y = endY; y >= startY; y -= 12) {
      const taper = Math.sin(((y - startY) / (endY - startY)) * Math.PI);
      const curve = Math.sin(y * waveFreq) * waveAmp;
      const w = stripeWidth * (0.3 + taper * 0.9);
      ctx.lineTo(xCenter + curve + w / 2, y);
      bCtx.lineTo(xCenter + curve + w / 2, y);
    }
    ctx.closePath();
    bCtx.closePath();
    ctx.fill();
    bCtx.fill();

    // Secondary fork / branch
    if (branches) {
      ctx.beginPath();
      bCtx.beginPath();
      const forkY = startY + (endY - startY) * 0.4;
      const forkLen = (endY - startY) * 0.45;
      const forkDir = s % 2 === 0 ? 1 : -1;

      ctx.moveTo(xCenter + Math.sin(forkY * waveFreq) * waveAmp, forkY);
      bCtx.moveTo(xCenter + Math.sin(forkY * waveFreq) * waveAmp, forkY);

      for (let y = forkY; y <= forkY + forkLen; y += 10) {
        const fProg = (y - forkY) / forkLen;
        const taper = 1 - fProg;
        const xOffset = forkDir * fProg * 26;
        const w = stripeWidth * 0.6 * taper;
        ctx.lineTo(xCenter + Math.sin(y * waveFreq) * waveAmp + xOffset + w, y);
        bCtx.lineTo(xCenter + Math.sin(y * waveFreq) * waveAmp + xOffset + w, y);
      }
      for (let y = forkY + forkLen; y >= forkY; y -= 10) {
        const fProg = (y - forkY) / forkLen;
        const taper = 1 - fProg;
        const xOffset = forkDir * fProg * 26;
        const w = stripeWidth * 0.6 * taper;
        ctx.lineTo(xCenter + Math.sin(y * waveFreq) * waveAmp + xOffset - w, y);
        bCtx.lineTo(xCenter + Math.sin(y * waveFreq) * waveAmp + xOffset - w, y);
      }
      ctx.closePath();
      bCtx.closePath();
      ctx.fill();
      bCtx.fill();
    }
  }

  // Soft blur edges of stripes for natural fur look
  ctx.filter = 'blur(1.5px)';
  ctx.drawImage(canvas, 0, 0);
  ctx.filter = 'none';

  return { map: canvas, bump: bCanvas };
}

/**
 * Creates the tiger facial texture with cheek ruffs, whisker pads, forehead markings.
 */
function generateFaceTexture(): HTMLCanvasElement {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Warm orange base
  const grad = ctx.createRadialGradient(size / 2, size / 2, 40, size / 2, size / 2, size / 2);
  grad.addColorStop(0, '#c8661e');
  grad.addColorStop(0.7, '#ba5716');
  grad.addColorStop(1, '#9b4210');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // White facial zones:
  // 1. White eye spots / eyebrows
  ctx.fillStyle = '#f8f4e6';
  ctx.beginPath();
  ctx.ellipse(size * 0.35, size * 0.38, 38, 22, -0.25, 0, Math.PI * 2);
  ctx.ellipse(size * 0.65, size * 0.38, 38, 22, 0.25, 0, Math.PI * 2);
  ctx.fill();

  // 2. White muzzle & whisker pads
  ctx.beginPath();
  ctx.ellipse(size * 0.5, size * 0.72, 70, 48, 0, 0, Math.PI * 2);
  ctx.fill();

  // 3. White cheek ruff flares
  ctx.beginPath();
  ctx.ellipse(size * 0.16, size * 0.65, 55, 35, 0.4, 0, Math.PI * 2);
  ctx.ellipse(size * 0.84, size * 0.65, 55, 35, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // Forehead markings: iconic 王 (King) tiger symbol & chevron stripes
  ctx.fillStyle = '#160e0a';

  // Center vertical bar
  ctx.fillRect(size * 0.48, size * 0.14, 20, 75);

  // Cross bars
  ctx.beginPath();
  ctx.roundRect(size * 0.36, size * 0.15, size * 0.28, 12, 6);
  ctx.roundRect(size * 0.38, size * 0.23, size * 0.24, 12, 6);
  ctx.roundRect(size * 0.34, size * 0.31, size * 0.32, 14, 7);
  ctx.fill();

  // Angled forehead chevrons
  ctx.beginPath();
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#160e0a';

  // Left & right crown stripes
  ctx.moveTo(size * 0.28, size * 0.16);
  ctx.quadraticCurveTo(size * 0.34, size * 0.24, size * 0.3, size * 0.34);
  ctx.moveTo(size * 0.72, size * 0.16);
  ctx.quadraticCurveTo(size * 0.66, size * 0.24, size * 0.7, size * 0.34);

  // Eye contours / eyeliner
  ctx.moveTo(size * 0.31, size * 0.44);
  ctx.lineTo(size * 0.41, size * 0.46);
  ctx.moveTo(size * 0.69, size * 0.44);
  ctx.lineTo(size * 0.59, size * 0.46);
  ctx.stroke();

  // Whisker dots (black speckles on muzzle)
  ctx.fillStyle = '#221510';
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const lx = size * 0.41 - col * 12;
      const rx = size * 0.59 + col * 12;
      const y = size * 0.68 + row * 11 + col * 2;
      ctx.beginPath();
      ctx.arc(lx, y, 2.8, 0, Math.PI * 2);
      ctx.arc(rx, y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Pinkish-black leather nose
  const noseGrad = ctx.createLinearGradient(0, size * 0.54, 0, size * 0.63);
  noseGrad.addColorStop(0, '#3a1e16');
  noseGrad.addColorStop(0.5, '#bd6a68');
  noseGrad.addColorStop(1, '#2c1511');
  ctx.fillStyle = noseGrad;
  ctx.beginPath();
  ctx.moveTo(size * 0.44, size * 0.54);
  ctx.lineTo(size * 0.56, size * 0.54);
  ctx.lineTo(size * 0.5, size * 0.63);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

/**
 * Creates the tiger leg texture: horizontal bars on outer leg, pale inner fur.
 */
function generateLegTexture(): HTMLCanvasElement {
  const width = 256;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Left half outer (orange), right half inner (pale)
  const grad = ctx.createLinearGradient(0, 0, width, 0);
  grad.addColorStop(0, '#b85818');
  grad.addColorStop(0.5, '#c96822');
  grad.addColorStop(0.75, '#eec594');
  grad.addColorStop(1.0, '#f6eedc');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Horizontal tiger leg stripes on outer half
  ctx.fillStyle = '#160e0a';
  for (let i = 0; i < 9; i++) {
    const y = 50 + i * 48 + ((i * 17) % 15);
    const barWidth = 70 + (i % 3) * 25;
    const barThick = 9 + (i % 3) * 3;

    ctx.beginPath();
    ctx.roundRect(10, y, barWidth, barThick, 4);
    ctx.fill();
  }

  // Paws at the bottom fade to pale cream
  const pawGrad = ctx.createLinearGradient(0, height - 70, 0, height);
  pawGrad.addColorStop(0, 'rgba(246, 238, 220, 0)');
  pawGrad.addColorStop(1, 'rgba(246, 238, 220, 0.92)');
  ctx.fillStyle = pawGrad;
  ctx.fillRect(0, height - 70, width, 70);

  return canvas;
}

/**
 * Creates the tail texture: alternating orange and bold black bands ending in solid black tip.
 */
function generateTailTexture(): HTMLCanvasElement {
  const width = 128;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Orange base
  ctx.fillStyle = '#ba5717';
  ctx.fillRect(0, 0, width, height);

  // Cream pale underside on one side
  const underGrad = ctx.createLinearGradient(0, 0, width, 0);
  underGrad.addColorStop(0, 'rgba(244, 235, 216, 0.8)');
  underGrad.addColorStop(0.4, 'rgba(244, 235, 216, 0)');
  ctx.fillStyle = underGrad;
  ctx.fillRect(0, 0, width, height);

  // Bold black rings along length
  ctx.fillStyle = '#140c08';
  const rings = 9;
  for (let i = 0; i < rings; i++) {
    const y = 30 + i * 44;
    ctx.fillRect(0, y, width, 18);
  }

  // Solid black tail tip (last 70 pixels)
  ctx.fillRect(0, height - 75, width, 75);

  return canvas;
}

/**
 * Creates realistic feline eye texture with slit pupil, golden iris, and black limbal ring.
 */
function generateEyeTexture(): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Outer black limbal ring
  ctx.fillStyle = '#0a0806';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fill();

  // Golden-amber feline iris with radial fibers
  const irisGrad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    20,
    size / 2,
    size / 2,
    size / 2 - 12,
  );
  irisGrad.addColorStop(0, '#f0d060'); // Bright amber/gold near pupil
  irisGrad.addColorStop(0.5, '#c99622'); // Warm topaz
  irisGrad.addColorStop(0.85, '#875812'); // Rich bronze
  irisGrad.addColorStop(1.0, '#362008'); // Dark rim
  ctx.fillStyle = irisGrad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 14, 0, Math.PI * 2);
  ctx.fill();

  // Radial striations
  ctx.strokeStyle = 'rgba(255, 230, 140, 0.4)';
  ctx.lineWidth = 1.5;
  for (let a = 0; a < Math.PI * 2; a += 0.12) {
    ctx.beginPath();
    ctx.moveTo(size / 2 + Math.cos(a) * 28, size / 2 + Math.sin(a) * 28);
    ctx.lineTo(size / 2 + Math.cos(a) * (size / 2 - 18), size / 2 + Math.sin(a) * (size / 2 - 18));
    ctx.stroke();
  }

  // Cat pupil: slightly oval/slit
  ctx.fillStyle = '#050302';
  ctx.beginPath();
  ctx.ellipse(size / 2, size / 2, 18, 48, 0, 0, Math.PI * 2);
  ctx.fill();

  // Specular gleam
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(size * 0.42, size * 0.38, 8, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

/**
 * Builds and returns all Three.js textures for the Tiger.
 */
export function buildTigerTextures(): TigerTextures {
  const { map: bodyCanvas, bump: bumpCanvas } = generateBodyTexture();
  const faceCanvas = generateFaceTexture();
  const legCanvas = generateLegTexture();
  const tailCanvas = generateTailTexture();
  const eyeCanvas = generateEyeTexture();

  const toTex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };

  const bodyMap = toTex(bodyCanvas);
  const bodyBump = new THREE.CanvasTexture(bumpCanvas);
  bodyBump.wrapS = THREE.RepeatWrapping;
  bodyBump.wrapT = THREE.ClampToEdgeWrapping;

  const faceMap = toTex(faceCanvas);
  const legMap = toTex(legCanvas);
  const tailMap = toTex(tailCanvas);
  const eyeMap = toTex(eyeCanvas);

  return {
    bodyMap,
    bodyBump,
    faceMap,
    legMap,
    tailMap,
    eyeMap,
  };
}

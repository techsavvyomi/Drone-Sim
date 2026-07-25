import * as THREE from 'three';

// Procedural surface textures generated on a canvas at runtime.
//
// We deliberately avoid downloaded PBR texture sets: the app runs offline under
// a strict CSP, so anything fetched from a CDN would fail. Generating noise +
// speckle here gives concrete/asphalt/grass enough variation to kill the "one
// giant flat grey plane" look, with zero assets to ship. Real texture maps can
// replace these later by swapping the loader.

function makeCanvas(size = 512): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d')!];
}

/** Deterministic value noise so surfaces look identical every run. */
function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  seed: number,
  shades: string[],
  min: number,
  max: number,
) {
  for (let i = 0; i < count; i++) {
    const x = hash(i, 1, seed) * size;
    const y = hash(i, 2, seed) * size;
    const r = min + hash(i, 3, seed) * (max - min);
    ctx.fillStyle = shades[Math.floor(hash(i, 4, seed) * shades.length)];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function finish(canvas: HTMLCanvasElement, repeat: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _concrete: THREE.CanvasTexture | null = null;
let _asphalt: THREE.CanvasTexture | null = null;
let _grass: THREE.CanvasTexture | null = null;

export function concreteTexture(): THREE.CanvasTexture {
  if (_concrete) return _concrete;
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#9a9e9f';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 2600, 11, ['#8f9395', '#a5a9aa', '#8a8e90', '#adb1b2'], 0.6, 3.2);
  // Expansion joints
  ctx.strokeStyle = 'rgba(70,74,76,0.55)';
  ctx.lineWidth = 2;
  for (const p of [0, size / 2]) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  _concrete = finish(c, 12);
  return _concrete;
}

export function asphaltTexture(): THREE.CanvasTexture {
  if (_asphalt) return _asphalt;
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#3e4245';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 5200, 23, ['#4a4e51', '#34383b', '#54585b', '#2e3235'], 0.5, 2.4);
  _asphalt = finish(c, 10);
  return _asphalt;
}

export function grassTexture(): THREE.CanvasTexture {
  if (_grass) return _grass;
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = '#4a6b38';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 7000, 37, ['#3f5f2f', '#557a3f', '#456a34', '#5f8547'], 0.8, 3.4);
  // A few darker mown bands
  ctx.fillStyle = 'rgba(40,60,30,0.16)';
  for (let i = 0; i < size; i += 64) ctx.fillRect(0, i, size, 32);
  _grass = finish(c, 40);
  return _grass;
}

/** Disposes cached textures (used on hot reload / teardown). */
export function disposeTextures(): void {
  [_concrete, _asphalt, _grass].forEach((t) => t?.dispose());
  _concrete = _asphalt = _grass = null;
}

let _cloud: THREE.CanvasTexture | null = null;

/**
 * Soft cloud puff, generated locally.
 * drei's <Cloud> pulls its sprite from rawcdn.githack.com, which the app's CSP
 * blocks — that failure throws inside the Canvas and blanks the whole view, so
 * we generate our own instead.
 */
export function cloudTexture(): THREE.CanvasTexture {
  if (_cloud) return _cloud;
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.clearRect(0, 0, size, size);

  // Several overlapping soft blobs give a puffier silhouette than one circle.
  const blobs: [number, number, number][] = [
    [128, 140, 74],
    [86, 152, 52],
    [170, 150, 56],
    [110, 112, 46],
    [156, 116, 42],
  ];
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _cloud = tex;
  return _cloud;
}

/**
 * Derives a tangent-space normal map from a procedural height field.
 * Flat-shaded surfaces are the main reason procedural scenes look "off" — a
 * normal map gives concrete and asphalt real surface relief under the sun
 * without needing any downloaded PBR maps.
 */
function normalFromHeight(
  size: number,
  height: (x: number, y: number) => number,
  strength = 2.2,
): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Central differences, wrapping so the tile stays seamless.
      const l = height((x - 1 + size) % size, y);
      const r = height((x + 1) % size, y);
      const u = height(x, (y - 1 + size) % size);
      const d = height(x, (y + 1) % size);

      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;

      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Fractal value noise in [0,1], deterministic. */
function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let v = 0;
  let amp = 0.5;
  let f = 0.045;
  for (let o = 0; o < octaves; o++) {
    v += amp * hash(Math.floor(x * f), Math.floor(y * f), seed + o);
    amp *= 0.5;
    f *= 2.1;
  }
  return v;
}

let _concreteN: THREE.CanvasTexture | null = null;
let _asphaltN: THREE.CanvasTexture | null = null;
let _grassN: THREE.CanvasTexture | null = null;

export function concreteNormal(): THREE.CanvasTexture {
  if (!_concreteN) {
    _concreteN = normalFromHeight(256, (x, y) => fbm(x, y, 11, 3), 1.6);
    _concreteN.repeat.set(12, 12);
  }
  return _concreteN;
}

export function asphaltNormal(): THREE.CanvasTexture {
  if (!_asphaltN) {
    _asphaltN = normalFromHeight(256, (x, y) => fbm(x * 1.8, y * 1.8, 23, 3), 2.6);
    _asphaltN.repeat.set(10, 10);
  }
  return _asphaltN;
}

export function grassNormal(): THREE.CanvasTexture {
  if (!_grassN) {
    _grassN = normalFromHeight(256, (x, y) => fbm(x * 2.4, y * 2.4, 37, 2), 3.2);
    _grassN.repeat.set(40, 40);
  }
  return _grassN;
}

/** Vertical sky gradient used to light the scene (a stand-in for an HDRI). */
export function skyGradientTexture(
  top: string,
  horizon: string,
  ground: string,
): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, top);
  g.addColorStop(0.48, horizon);
  g.addColorStop(0.52, ground);
  g.addColorStop(1, ground);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

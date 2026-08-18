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
  if (_streetPbr) {
    _streetPbr.map.dispose();
    _streetPbr.normalMap.dispose();
    _streetPbr.roughnessMap.dispose();
    _streetPbr = null;
  }
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

let _microStreetNormal: THREE.CanvasTexture | null = null;
export function microStreetNormal(maxAniso = 16): THREE.CanvasTexture {
  if (!_microStreetNormal) {
    _microStreetNormal = normalFromHeight(512, (x, y) => fbm(x * 4.0, y * 4.0, 77, 4) * 0.7 + fbm(x * 16.0, y * 16.0, 93, 2) * 0.3, 3.5);
    _microStreetNormal.repeat.set(80, 80);
  }
  _microStreetNormal.anisotropy = maxAniso;
  return _microStreetNormal;
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

let _streetPbr: {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} | null = null;

/**
 * Draws sharp, multifaceted aggregate mineral chips and dark tar sockets
 * onto both albedo and roughness canvas contexts.
 */
function drawAggregateChips(
  ctx: CanvasRenderingContext2D,
  ctxRough: CanvasRenderingContext2D,
  size: number,
  count: number,
  seed: number,
  shades: string[],
  minR: number,
  maxR: number,
  roughMin: number,
  roughMax: number,
) {
  for (let i = 0; i < count; i++) {
    const cx = hash(i, 1, seed) * size;
    const cy = hash(i, 2, seed) * size;
    const r = minR + hash(i, 3, seed) * (maxR - minR);
    const sides = 3 + Math.floor(hash(i, 5, seed) * 4); // 3 to 6-sided polygon stone
    const rot = hash(i, 6, seed) * Math.PI * 2;
    const shade = shades[Math.floor(hash(i, 4, seed) * shades.length)];
    const roughVal = Math.floor(roughMin + hash(i, 7, seed) * (roughMax - roughMin));
    const roughHex = roughVal.toString(16).padStart(2, '0');

    // 1. Albedo stone polygon
    ctx.fillStyle = shade;
    ctx.beginPath();
    for (let s = 0; s < sides; s++) {
      const a = rot + (s / sides) * Math.PI * 2 + (hash(i * 7 + s, 8, seed) - 0.5) * 0.4;
      const rad = r * (0.75 + hash(i * 11 + s, 9, seed) * 0.5);
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    // 2. Dark recessed bitumen socket perimeter around medium/large aggregate
    if (r >= 1.4) {
      ctx.strokeStyle = 'rgba(8, 10, 12, 0.7)';
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }

    // 3. Roughness map polygon (matte stone facets)
    ctxRough.fillStyle = `#${roughHex}${roughHex}${roughHex}`;
    ctxRough.beginPath();
    for (let s = 0; s < sides; s++) {
      const a = rot + (s / sides) * Math.PI * 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (s === 0) ctxRough.moveTo(px, py);
      else ctxRough.lineTo(px, py);
    }
    ctxRough.closePath();
    ctxRough.fill();
  }
}

/**
 * Draws procedural asphalt fissures and tar seams for macro road texture.
 */
function drawAsphaltCracks(
  ctx: CanvasRenderingContext2D,
  ctxRough: CanvasRenderingContext2D,
  size: number,
  numCracks = 6,
  seed = 59,
) {
  for (let c = 0; c < numCracks; c++) {
    let x = hash(c, 11, seed) * size;
    let y = hash(c, 12, seed) * size;
    const segs = 12 + Math.floor(hash(c, 13, seed) * 14);

    ctx.strokeStyle = '#0a0c0e';
    ctx.lineWidth = 1.2 + hash(c, 14, seed) * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);

    for (let s = 0; s < segs; s++) {
      const angle = (hash(c * 17 + s, 15, seed) - 0.5) * 1.6 + (c % 2 === 0 ? 0.3 : 1.7);
      const dist = 14 + hash(c * 19 + s, 16, seed) * 26;
      x = (x + Math.cos(angle) * dist + size) % size;
      y = (y + Math.sin(angle) * dist + size) % size;
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Smooth bitumen tar seal along crack core
    ctxRough.strokeStyle = '#404040';
    ctxRough.lineWidth = 2.0;
    ctxRough.stroke();
  }
}

/**
 * Generates ultra-crisp, high-definition procedural PBR textures for New York streets.
 * Multi-layer aggregate stone chips (quartz, granite, basalt), asphalt fissures,
 * and high-relief normal mapping ensure pin-sharp clarity right under the drone camera
 * and rich tactical depth at all camera angles.
 */
export function highResStreetPBR(maxAniso = 16): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  if (_streetPbr) {
    _streetPbr.map.anisotropy = maxAniso;
    _streetPbr.normalMap.anisotropy = maxAniso;
    _streetPbr.roughnessMap.anisotropy = maxAniso;
    return _streetPbr;
  }

  const size = 1024;
  const [cMap, ctxMap] = makeCanvas(size);
  const [cRough, ctxRough] = makeCanvas(size);

  // 1. Deep Rich Bitumen Base Matrix
  ctxMap.fillStyle = '#141618';
  ctxMap.fillRect(0, 0, size, size);

  // Base asphalt binder roughness (semi-glossy compacted bitumen)
  ctxRough.fillStyle = '#9e9e9e';
  ctxRough.fillRect(0, 0, size, size);

  // 2. Fine mineral sand & filler matrix (18,000 grains)
  drawAggregateChips(
    ctxMap,
    ctxRough,
    size,
    18000,
    31,
    ['#22262a', '#2c3137', '#181b1d', '#363d44', '#1b1e20'],
    0.4,
    1.4,
    140,
    180,
  );

  // 3. Medium crushed stone aggregate (8,000 multifaceted pebbles)
  drawAggregateChips(
    ctxMap,
    ctxRough,
    size,
    8000,
    73,
    ['#485058', '#383e45', '#555f69', '#2d3238', '#5e6874'],
    1.4,
    3.2,
    190,
    235,
  );

  // 4. Coarse quartz & granite mineral highlights (2,500 crisp stone chips)
  drawAggregateChips(
    ctxMap,
    ctxRough,
    size,
    2500,
    109,
    ['#788490', '#95a1ad', '#66717d', '#adb9c6', '#8893a0'],
    2.2,
    4.8,
    220,
    255,
  );

  // 5. Asphalt fissures, tar veins, and compaction seams
  drawAsphaltCracks(ctxMap, ctxRough, size, 8, 43);

  const repeat = 1;

  const map = finish(cMap, repeat);
  map.anisotropy = maxAniso;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;

  const roughnessMap = finish(cRough, repeat);
  roughnessMap.anisotropy = maxAniso;
  roughnessMap.generateMipmaps = true;
  roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  roughnessMap.magFilter = THREE.LinearFilter;

  // 6. Tangent-space micro-relief & cellular aggregate normal map (512x512 with 5.5x strength)
  const normalMap = normalFromHeight(
    512,
    (x, y) => {
      const macro = fbm(x * 1.8, y * 1.8, 37, 2) * 0.22;
      const stone = fbm(x * 7.5, y * 7.5, 77, 3) * 0.48;
      const grit = fbm(x * 28.0, y * 28.0, 93, 2) * 0.30;
      return macro + stone + grit;
    },
    5.5,
  );
  normalMap.repeat.set(repeat, repeat);
  normalMap.anisotropy = maxAniso;
  normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.magFilter = THREE.LinearFilter;

  _streetPbr = { map, normalMap, roughnessMap };
  return _streetPbr;
}

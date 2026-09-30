import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FOLIAGE,
  ROAD_MARKINGS,
  ROAD_MARKING_OFFSET,
} from '../src/renderer/scene/environment/newYorkMaterials';

// New York's road lines flickered and broke up as the drone climbed (user,
// 2026-09-30). Three causes, each held here against the model itself: the paint
// sits ~0.6 mm over the road, which the depth buffer cannot resolve from height,
// so it needs a polygon offset; the foliage rule matched "S-tree-t", so the road
// and the crossings never reached their own treatment; and the whole city's lane
// lines — one mesh — were distance-culled as if they were a small prop.
//
// Only the GLB's JSON chunk is read: material names, and each primitive's
// POSITION min / max, which glTF requires even for Draco-compressed meshes.

interface Gltf {
  materials: { name?: string }[];
  meshes: { primitives: { material?: number; attributes: { POSITION: number } }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
  nodes: { mesh?: number; translation?: number[]; scale?: number[]; rotation?: number[] }[];
}

function readGltfJson(path: string): Gltf {
  const buf = readFileSync(path);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const length = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8')) as Gltf;
}

const gltf = readGltfJson('src/assets/models/new_york_city.opt.glb');
const names = gltf.materials.map((m) => m.name ?? '');

/** World-space y and x range of every primitive drawn with a material matching `re`. */
function extent(re: RegExp) {
  let yMin = Infinity;
  let yMax = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    // The city's meshes are placed without scale or rotation; a change there
    // would make these raw ranges wrong, so say so rather than misread them.
    expect(node.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
    expect(node.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
    const [tx, ty] = node.translation ?? [0, 0, 0];
    for (const p of gltf.meshes[node.mesh].primitives) {
      if (p.material === undefined || !re.test(names[p.material])) continue;
      const a = gltf.accessors[p.attributes.POSITION];
      yMin = Math.min(yMin, a.min![1] + ty);
      yMax = Math.max(yMax, a.max![1] + ty);
      xMin = Math.min(xMin, a.min![0] + tx);
      xMax = Math.max(xMax, a.max![0] + tx);
    }
  }
  return { yMin, yMax, width: xMax - xMin };
}

describe('New York material rules against the model', () => {
  it('foliage is only the tree canopies — never the road or the street furniture', () => {
    expect(names.filter((n) => FOLIAGE.test(n)).sort()).toEqual(['FoliageTrees.001', 'FoliageTrees.002']);
    for (const n of ['CityGen_Streets', 'Street_Assets', 'Street_Assets.001']) {
      expect(names).toContain(n);
      expect(FOLIAGE.test(n)).toBe(false);
    }
  });

  it('road paint is the lane lines and the crossings, not the 3D street furniture', () => {
    expect(names.filter((n) => ROAD_MARKINGS.test(n)).sort()).toEqual([
      'CityGen_lanes_secondary_color',
      'Street_Assets.001',
    ]);
    expect(ROAD_MARKINGS.test('Street_Assets')).toBe(false);
    expect(ROAD_MARKINGS.test('CityGen_Streets')).toBe(false);
  });
});

describe('road paint and the depth buffer', () => {
  it('the lane lines lie flat, well under 2 mm over the road', () => {
    const road = extent(/^CityGen_Streets$/);
    const lines = extent(/^CityGen_lanes_secondary_color$/);
    expect(lines.yMax - lines.yMin).toBeLessThan(0.0001);
    const gap = lines.yMin - road.yMax;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(0.002);
  });

  it('from 30 m the depth buffer cannot separate them, so the paint carries an offset toward the camera', () => {
    const viewport = readFileSync('src/renderer/scene/Viewport.tsx', 'utf8');
    const near = Number(/near:\s*([\d.]+)/.exec(viewport)![1]);
    // Smallest depth step of a 24-bit buffer at distance d: ≈ d² / (near · 2²⁴).
    const step = (d: number) => (d * d) / (near * 2 ** 24);
    const gap = extent(/^CityGen_lanes_secondary_color$/).yMin - extent(/^CityGen_Streets$/).yMax;
    expect(step(30)).toBeGreaterThan(gap);
    expect(ROAD_MARKING_OFFSET.factor).toBeLessThan(0);
    expect(ROAD_MARKING_OFFSET.units).toBeLessThanOrEqual(-1);
  });

  it('NewYorkEnv gives road paint its offset before the foliage rule is ever asked', () => {
    const src = readFileSync('src/renderer/scene/environment/NewYorkEnv.tsx', 'utf8');
    const paint = src.indexOf('if (ROAD_MARKINGS.test(matName))');
    const foliage = src.indexOf('FOLIAGE.test(matName)');
    expect(paint).toBeGreaterThan(0);
    expect(foliage).toBeGreaterThan(paint);
    const branch = src.slice(paint, foliage);
    expect(branch).toContain('std.polygonOffset = true');
    expect(branch).toContain('ROAD_MARKING_OFFSET.factor');
    expect(branch).toContain('ROAD_MARKING_OFFSET.units');
    // The asphalt branch is reachable: nothing before it catches the road.
    expect(src).toContain('/CityGen_Streets/i.test(matName)');
  });
});

describe('the lane lines are never distance-culled', () => {
  it('they are one mesh across the whole city, so hiding it hides every line', () => {
    expect(extent(/^CityGen_lanes_secondary_color$/).width).toBeGreaterThan(200);
  });

  it('NewYorkEnv hides nothing by camera distance', () => {
    const src = readFileSync('src/renderer/scene/environment/NewYorkEnv.tsx', 'utf8');
    expect(src).not.toMatch(/\.visible\s*=\s*dist/);
    expect(src).not.toMatch(/MICRO_PROP/);
  });
});

import { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

// Materials for the Construction Site map, built from the scanned PBR set in
// src/assets/textures/site.
//
// Unlike the rest of environment/textures.ts, these are real photographed maps
// rather than canvas noise. That is allowed here for the same reason the .glb
// models are: they are BUNDLED, not fetched. Vite rewrites the globs below into
// local asset URLs served from 'self', which the app's CSP permits — the rule
// the procedural textures exist to satisfy is "nothing off a CDN", not "nothing
// on disk".
//
// Two families:
//   surfaces/  tiling maps for slabs, columns, walls and the ground
//   props/     per-asset baked maps for the scanned debris in site_props.opt.glb

const surfaceUrls = import.meta.glob('../../../assets/textures/site/surfaces/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const propUrls = import.meta.glob('../../../assets/textures/site/props/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** `.../surfaces/block_n.jpg` -> `block_n`. */
function key(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -'.jpg'.length);
}

function byKey(urls: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(urls)) out[key(path)] = url;
  return out;
}

const SURFACES = byKey(surfaceUrls);
const PROPS = byKey(propUrls);

export type SurfaceName = 'concrete' | 'rebar' | 'block' | 'slab' | 'ground';

/** Every surface map, in a stable order so the loader hook stays consistent. */
const SURFACE_ORDER = Object.keys(SURFACES).sort();
const PROP_ORDER = Object.keys(PROPS).sort();

/** Ids of the debris props that shipped with baked maps. */
export const PROP_IDS = [...new Set(PROP_ORDER.map((k) => k.slice(0, -2)))];

function configure(tex: THREE.Texture, srgb: boolean, repeat: number, aniso: number) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Per-surface albedo tint and normal strength.
 *
 * Ground gets the weakest normal of the set: at 8 m per tile its relief is
 * stretched so far that a strong normal map turns into visible rolling waves
 * rather than surface texture.
 */
const TUNING: Record<SurfaceName, { color: string; normal: number }> = {
  concrete: { color: '#9a968e', normal: 1.0 },
  rebar: { color: '#948f86', normal: 1.0 },
  block: { color: '#9d968a', normal: 0.9 },
  slab: { color: '#a09b93', normal: 0.8 },
  ground: { color: '#8c8880', normal: 0.45 },
};

export interface SiteMaterials {
  surface: Record<SurfaceName, THREE.MeshStandardMaterial>;
  /** Keyed by the prop's mesh name in site_props.opt.glb. */
  prop: Record<string, THREE.MeshStandardMaterial>;
}

/**
 * Loads every site texture once and hands back ready materials.
 *
 * The tiling surfaces get a shared material per role; a caller that needs a
 * different tiling density clones it (see `tiled` below) rather than mutating
 * the shared one, because repeat lives on the TEXTURE, not the material — one
 * `.repeat.set` on the ground map would also change every column using it.
 */
export function useSiteMaterials(aniso = 8): SiteMaterials {
  const urls = useMemo(
    () => [...SURFACE_ORDER.map((k) => SURFACES[k]), ...PROP_ORDER.map((k) => PROPS[k])],
    [],
  );
  const loaded = useLoader(THREE.TextureLoader, urls) as THREE.Texture[];

  return useMemo(() => {
    const tex: Record<string, THREE.Texture> = {};
    SURFACE_ORDER.forEach((k, i) => (tex[`s:${k}`] = loaded[i]));
    PROP_ORDER.forEach((k, i) => (tex[`p:${k}`] = loaded[SURFACE_ORDER.length + i]));

    const surface = {} as Record<SurfaceName, THREE.MeshStandardMaterial>;
    for (const name of ['concrete', 'rebar', 'block', 'slab', 'ground'] as SurfaceName[]) {
      const map = configure(tex[`s:${name}_c`].clone(), true, 1, aniso);
      const normalMap = configure(tex[`s:${name}_n`].clone(), false, 1, aniso);
      const roughnessMap = configure(tex[`s:${name}_r`].clone(), false, 1, aniso);
      const t = TUNING[name];
      surface[name] = new THREE.MeshStandardMaterial({
        name: `site-${name}`,
        map,
        normalMap,
        roughnessMap,
        // These scans were captured under flat, even light, which is what makes
        // them tile — but it also means their albedo already contains the
        // brightness a lit surface is supposed to GAIN. Passed through at
        // #ffffff under an outdoor sun plus ambient plus IBL, every one of them
        // came out near-white and the whole site read as snow.
        //
        // The tint below is the same correction the New York asphalt needed:
        // dim the map, take the metal out so the sky stops tinting it, and hold
        // the image-based lighting down. Concrete is a dark-ish grey in life
        // (~35% reflectance) and it should look like one.
        color: t.color,
        metalness: 0,
        roughness: 1,
        envMapIntensity: 0.3,
        normalScale: new THREE.Vector2(t.normal, t.normal),
      });
    }

    const prop: Record<string, THREE.MeshStandardMaterial> = {};
    for (const id of PROP_IDS) {
      const map = configure(tex[`p:${id}_c`], true, 1, aniso);
      const normalMap = configure(tex[`p:${id}_n`], false, 1, aniso);
      // Baked atlases: the UVs are the asset's own layout, so these must NOT
      // repeat — clamping stops a filtered edge texel wrapping to the far side
      // of the atlas and smearing a stripe across the piece.
      map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
      normalMap.wrapS = normalMap.wrapT = THREE.ClampToEdgeWrapping;
      prop[id] = new THREE.MeshStandardMaterial({
        name: `site-prop-${id}`,
        map,
        normalMap,
        color: '#a8a49c',
        metalness: 0,
        roughness: 0.92,
        envMapIntensity: 0.3,
      });
    }

    return { surface, prop };
  }, [loaded, aniso]);
}

/**
 * A copy of a surface material whose maps tile at `repeat` metres per tile.
 *
 * Cloning the material alone is not enough — clones share texture objects, and
 * `repeat` is a property of the texture. Each call therefore clones the maps
 * too. Cheap: clones share the same GPU upload, only the sampler state differs.
 */
export function tiled(
  base: THREE.MeshStandardMaterial,
  repeatU: number,
  repeatV = repeatU,
): THREE.MeshStandardMaterial {
  const m = base.clone();
  for (const slot of ['map', 'normalMap', 'roughnessMap'] as const) {
    const t = base[slot];
    if (!t) continue;
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(repeatU, repeatV);
    c.needsUpdate = true;
    m[slot] = c;
  }
  return m;
}

import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import forestModelUrl from '../../../assets/models/forest.opt.glb?url';
import { ForestColliders } from './ForestColliders';

// Forest scene. Draco-compressed like the classroom; the decoder path is set
// globally at startup (see main.tsx) so nothing needs passing here.

/**
 * Where the scene's playable floor sits in the raw export.
 *
 * The model's lowest geometry is at y = 96, but that is the valley floor far
 * below. The clearing you actually fly in — the bare dirt road, with the fence,
 * logs and cobblestone around it — sits at y ~= 173.24, centred at x = 2.3,
 * z = 53.7. Shifting by the negative of that puts the clearing at the origin
 * with its ground on y = 0, which is where the sim expects to find it.
 *
 * The height is the road SURFACE sampled at the spawn point (within 4 m: min
 * 173.22, median 173.24, max 173.25), not the mid-point of the road mesh's
 * bounding box. The bbox mid gave 173.15 — 9 cm low, and since the Guru's
 * airframe is only 7.8 cm tall that sank it into the dirt up to its propellers.
 */
const CLEARING_CENTRE: [number, number, number] = [2.3, 173.24, 53.7];

/**
 * Scene scale, in metres per authored unit.
 *
 * Taken at face value the export is already metric: the clearing measures
 * ~40 x 27 and the canopy stands ~34 above it, which reads as a believable
 * forest track. It does look coarse at drone height, but that is texel density
 * — a ground texture stretched over 40 m, viewed from 30 cm up — rather than
 * proportion. Lower this if the scene should feel tighter; everything else,
 * including the recentring below, follows from it.
 */
const MODEL_SCALE = 1;

// The offset is applied after the scale (Three composes T * R * S), so it has
// to be expressed in scaled metres, not authored units.
const MODEL_OFFSET: [number, number, number] = [
  -CLEARING_CENTRE[0] * MODEL_SCALE,
  -CLEARING_CENTRE[1] * MODEL_SCALE,
  -CLEARING_CENTRE[2] * MODEL_SCALE,
];

/**
 * Meshes the drone should hit: the landscape underfoot, and everything standing
 * up off it — trunks, fences, logs, rocks, cliff face.
 *
 * The ground is the real terrain rather than a flat plane, because this map is
 * uneven: what you can see under the drone is what it lands on. A flat slab at
 * y = 0 only matches the clearing, and everywhere else the drone floats above
 * or sinks into visible ground.
 *
 * Canopy and undergrowth are excluded. They are alpha-cut cards
 * (Background_Tree_Atlas_0, Grass_*, Fallen_*_Leaves, Forest_Bush) and flat
 * decals (Rock_Decal, Puddle_Streaks); colliding those would hang invisible
 * walls in mid-air wherever a leaf plane sits, and they are most of the scene's
 * 341k triangles.
 *
 * TRUNKS ARE ALSO EXCLUDED, and handled analytically by ForestColliders.
 * They were 83,074 of this trimesh's 140,545 triangles — 59% of the geometry
 * the drone queried against on every one of the 250 physics steps per second,
 * for objects that are just vertical posts. Terrain stays a trimesh because it
 * is genuinely uneven ground the drone lands on.
 */
const SOLID =
  /Terrain|Aerial_Grass|Ground_Dirt|Dirt_Road|Cobblestone|Sloped_Rock|Tall_Cliff|Broken_Rocks|Wood_Log|Metal_Fence|Wood_Fence/i;

/**
 * Top face of the catch floor — a backstop for anything that finds a seam in
 * the terrain, or flies out past it over the valley.
 *
 * It has to sit BELOW everything the pilot can legitimately reach. At -50 it was
 * above the terrain: within the play area the ground descends to -62.5 m, so the
 * deepest parts of the valley had an invisible floor 12 m above the visible
 * ground. It must also stay above the "fell out of the world" reset (bounds
 * floor - 8 = -78), or a deep descent teleports to spawn instead of landing.
 *
 * See the ordering table in plugins/environments/forest.ts.
 */
const CATCH_TOP = -76;
const CATCH_HALF = 5;

/**
 * Half-width of a flat apron over the spawn clearing, top face on y = 0.
 *
 * This is not a substitute for the terrain — it exists because the terrain
 * arrives inside a Suspense boundary. Until the 15 MB scene finishes streaming
 * there is no ground at all, and the drone drops away from the pad before the
 * map appears. The apron is always mounted, so spawn is solid immediately.
 *
 * It is also honest here: the road surface within this radius sits between
 * -0.19 m and +0.05 m of the spawn height, so a flat plate matches what you see
 * to within a couple of centimetres. Whichever is higher wins, so once the
 * terrain loads the drone rests on the real surface anywhere it rises above 0.
 */
const APRON_HALF = 12;

/**
 * How far past the play area to keep collidable terrain, metres.
 *
 * The drone is hard-clamped inside `env.bounds`, so terrain far outside it can
 * never be touched — but it was still going into the physics trimesh, where it
 * cost BVH depth on every one of the 250 queries per second. This scene's
 * terrain reaches X 346 and Z -402 while the play area stops at 130 and -150,
 * so most of it was pure weight.
 *
 * The margin exists so the collider never ends exactly where the drone stops.
 */
const PHYSICS_MARGIN = 25;

/**
 * Drops triangles whose centroid lies outside the play area, returning a new
 * geometry. Returns null when nothing survives, so the caller can skip the mesh
 * entirely. Only positions are kept — a collision proxy needs nothing else.
 */
function clipToPlayArea(
  geo: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  min: THREE.Vector3,
  max: THREE.Vector3,
): THREE.BufferGeometry | null {
  const src = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!src) return null;
  const idx = geo.index;
  const count = idx ? idx.count : src.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const out: number[] = [];

  for (let i = 0; i + 2 < count; i += 3) {
    const i0 = idx ? idx.getX(i) : i;
    const i1 = idx ? idx.getX(i + 1) : i + 1;
    const i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(src, i0).applyMatrix4(matrix);
    b.fromBufferAttribute(src, i1).applyMatrix4(matrix);
    c.fromBufferAttribute(src, i2).applyMatrix4(matrix);
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    if (cx < min.x || cx > max.x || cz < min.z || cz > max.z) continue;
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  if (out.length === 0) return null;

  const clipped = new THREE.BufferGeometry();
  clipped.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  clipped.computeBoundingBox();
  clipped.computeBoundingSphere();
  return clipped;
}

/** Meshes bigger than this get split into tiles so frustum culling can work. */
const SPLIT_ABOVE_TRIS = 8000;
/** Tile size for that split, metres. */
const TILE = 60;

/**
 * Splits one mesh into a grid of tiles, so the camera can reject the parts it
 * cannot see.
 *
 * The export ships the whole forest as a handful of enormous merged meshes — the
 * two leaf-card meshes alone are 93k triangles — and each one's bounding sphere
 * covers the entire map. Frustum culling therefore never rejected anything: every
 * triangle in the scene was submitted every frame no matter where the drone was
 * looking. Tiling gives the culler something it can actually throw away.
 *
 * Returns null when the mesh spans a single tile and splitting would gain nothing.
 */
function tileMesh(mesh: THREE.Mesh): THREE.Mesh[] | null {
  const geo = mesh.geometry;
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return null;
  const idx = geo.index;
  const triCount = (idx ? idx.count : pos.count) / 3;
  if (triCount < SPLIT_ABOVE_TRIS) return null;

  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const nx = Math.ceil((bb.max.x - bb.min.x) / TILE);
  const nz = Math.ceil((bb.max.z - bb.min.z) / TILE);
  if (nx * nz < 2) return null;

  // Bucket triangles by the tile their centroid falls in. Positions are copied
  // rather than indexed: these are draw-once static meshes, and a de-duplicating
  // pass costs more than the vertices it would save.
  const buckets = new Map<string, number[]>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const names = ['position', 'normal', 'uv'].filter((n) => geo.attributes[n]);

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    const tx = Math.floor((a.x + b.x + c.x) / 3 / TILE);
    const tz = Math.floor((a.z + b.z + c.z) / 3 / TILE);
    const k = `${tx},${tz}`;
    let list = buckets.get(k);
    if (!list) buckets.set(k, (list = []));
    list.push(i0, i1, i2);
  }
  if (buckets.size < 2) return null;

  const out: THREE.Mesh[] = [];
  for (const [k, indices] of buckets) {
    const g = new THREE.BufferGeometry();
    for (const name of names) {
      const src = geo.attributes[name] as THREE.BufferAttribute;
      const size = src.itemSize;
      const arr = new Float32Array(indices.length * size);
      for (let i = 0; i < indices.length; i++)
        for (let s = 0; s < size; s++) arr[i * size + s] = src.array[indices[i] * size + s];
      g.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const tile = new THREE.Mesh(g, mesh.material);
    tile.name = `${mesh.name}_tile${k}`;
    tile.castShadow = false;
    tile.receiveShadow = true;
    tile.frustumCulled = true;
    out.push(tile);
  }
  return out;
}

function ForestModel({ url, bounds }: { url: string; bounds: EnvironmentSpec['bounds'] }) {
  const { scene } = useGLTF(url);

  const model = useMemo(() => {
    const root = scene.clone(true);
    root.position.set(...MODEL_OFFSET);
    root.scale.setScalar(MODEL_SCALE);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Foliage is the whole scene here, so shadow-casting every leaf card is
      // not worth it; the ground still receives the sun.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (!mat) continue;
        // Tree and grass cards are alpha-cut planes. Without double-siding they
        // vanish when viewed from behind, which in a forest is most of the time.
        mat.side = THREE.DoubleSide;
        // The cutoff decides how full the canopy reads: too high and every leaf
        // card is eaten away until the wood looks like late autumn. Kept low,
        // and the fringing it leaves is handled by the material below rather
        // than by clipping harder.
        if (mat.map) mat.alphaTest = Math.max(mat.alphaTest, 0.32);

        // Bark, leaves, dirt and moss are all matte. The export leaves them
        // with default roughness/metalness, which puts a faint sheen on every
        // surface and is most of why the scene reads as plastic rather than
        // woodland under a low sun.
        if (/Trunk_|Bark|Wood_|Log/i.test(mat.name)) {
          mat.roughness = 0.95;
          mat.metalness = 0;
        } else if (/Tree|Leaf|Leaves|Grass|Bush|Foliage|Fallen_/i.test(mat.name)) {
          mat.roughness = 0.92;
          mat.metalness = 0;
        } else if (/Terrain|Dirt|Ground|Rock|Cliff|Mud|Cobble/i.test(mat.name)) {
          mat.roughness = 0.98;
          mat.metalness = 0;
        }

        // Anisotropy costs nothing here and is the difference between a ground
        // texture that smears at a grazing angle — which is every angle at
        // 30 cm altitude — and one that holds detail into the distance.
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) {
          if (t) t.anisotropy = Math.max(t.anisotropy, 4);
        }
        mat.needsUpdate = true;
      }
    });

    // Tile the big merged meshes so frustum culling has something to reject.
    const oversized: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) oversized.push(m);
    });
    let split = 0;
    let tiles = 0;
    for (const m of oversized) {
      const parts = tileMesh(m);
      if (!parts || !m.parent) continue;
      const holder = new THREE.Group();
      holder.name = `${m.name}_tiles`;
      holder.position.copy(m.position);
      holder.rotation.copy(m.rotation);
      holder.scale.copy(m.scale);
      for (const p of parts) holder.add(p);
      m.parent.add(holder);
      m.parent.remove(m);
      m.geometry.dispose();
      split++;
      tiles += parts.length;
    }
    if (import.meta.env.DEV && split > 0) {
      console.info(`[forest] tiled ${split} oversized meshes into ${tiles} culled tiles`);
    }

    root.updateMatrixWorld(true);
    return root;
  }, [scene]);

  // Collision proxies: the solid meshes again, geometry shared with the visual
  // model, flattened to the model root's frame so the RigidBody can place them.
  // They stay invisible (hence includeInvisible on the body) so nothing is drawn
  // twice — only their shapes reach Rapier.
  const solids = useMemo(() => {
    model.updateWorldMatrix(true, true);
    const toRoot = new THREE.Matrix4().copy(model.matrixWorld).invert();

    // The proxies live in the model root's frame, and the RigidBody re-applies
    // MODEL_OFFSET — so the play area has to be expressed in that frame too.
    const lo = new THREE.Vector3(
      bounds.min[0] - PHYSICS_MARGIN - MODEL_OFFSET[0],
      0,
      bounds.min[2] - PHYSICS_MARGIN - MODEL_OFFSET[2],
    );
    const hi = new THREE.Vector3(
      bounds.max[0] + PHYSICS_MARGIN - MODEL_OFFSET[0],
      0,
      bounds.max[2] + PHYSICS_MARGIN - MODEL_OFFSET[2],
    );

    const out: THREE.Mesh[] = [];
    let kept = 0;
    let dropped = 0;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !SOLID.test(mesh.name)) return;
      mesh.updateWorldMatrix(true, false);
      const toModelRoot = new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld);

      const before = mesh.geometry.index
        ? mesh.geometry.index.count / 3
        : mesh.geometry.attributes.position.count / 3;
      const clipped = clipToPlayArea(mesh.geometry, toModelRoot, lo, hi);
      if (!clipped) {
        dropped += before;
        return;
      }
      kept += clipped.attributes.position.count / 3;
      dropped += before - clipped.attributes.position.count / 3;

      // Vertices are already in the model root's frame, so no further transform.
      const proxy = new THREE.Mesh(clipped);
      proxy.visible = false;
      out.push(proxy);
    });

    if (import.meta.env.DEV) {
      console.info(
        `[forest] physics trimesh: ${Math.round(kept).toLocaleString()} triangles ` +
          `(${Math.round(dropped).toLocaleString()} outside the play area dropped)`,
      );
    }
    return out;
  }, [model, bounds]);

  return (
    <>
      <primitive object={model} />
      <RigidBody
        type="fixed"
        colliders="trimesh"
        includeInvisible
        position={MODEL_OFFSET}
        scale={MODEL_SCALE}
      >
        {solids.map((s, i) => (
          <primitive key={i} object={s} />
        ))}
      </RigidBody>
    </>
  );
}

export function ForestEnv({ env }: { env: EnvironmentSpec }) {
  const { min, max } = env.bounds;
  const spanX = max[0] - min[0];
  const spanZ = max[2] - min[2];

  return (
    <group>
      {/* Catch floor, far below the terrain. Declared as an explicit
          CuboidCollider rather than an invisible mesh with colliders="cuboid":
          the automatic path walks the tree with traverseVisible, so a hidden
          mesh yields no collider at all and the drone drops straight through. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[spanX, CATCH_HALF, spanZ]}
          position={[0, CATCH_TOP - CATCH_HALF, 0]}
        />
        {/* Spawn apron — mounted before the terrain streams in. */}
        <CuboidCollider args={[APRON_HALF, 0.5, APRON_HALF]} position={[0, -0.5, 0]} />
      </RigidBody>

      {/* Tree trunks as analytical boxes — see ForestColliders. Mounted outside
          the Suspense boundary so trees are solid the moment the map opens,
          rather than only once the 15 MB scene has streamed in. */}
      <ForestColliders />

      <Suspense fallback={null}>
        <ForestModel url={forestModelUrl} bounds={env.bounds} />
      </Suspense>
    </group>
  );
}

// Warm the cache at startup: the scene is 15 MB, and until it resolves the
// terrain colliders do not exist, so the drone would drop off the pad waiting.
useGLTF.preload(forestModelUrl);

import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import forestModelUrl from '../../../assets/models/forest.opt.glb?url';

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
 * 341k triangles. What remains is small enough for a static trimesh.
 */
const SOLID =
  /Terrain|Aerial_Grass|Ground_Dirt|Dirt_Road|Cobblestone|Sloped_Rock|Tall_Cliff|Broken_Rocks|Trunk_|Wood_Log|Metal_Fence|Wood_Fence/i;

/**
 * Top face of the catch floor — a backstop for anything that finds a seam in
 * the terrain, or flies out past it over the valley.
 *
 * It has to sit well INSIDE the arena floor, not level with it. A first attempt
 * put it at -26 against a bounds floor of -25, so a drone resting on it was
 * permanently within the containment's 0.2 m margin: the spring lifted it, it
 * fell back, and it looped up and down forever. With the bounds floor at -60,
 * landing here is 10 m clear of the spring.
 */
const CATCH_TOP = -50;
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

function ForestModel({ url }: { url: string }) {
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
        if (mat.map) mat.alphaTest = Math.max(mat.alphaTest, 0.35);
      }
    });
    return root;
  }, [scene]);

  // Collision proxies: the solid meshes again, geometry shared with the visual
  // model, flattened to the model root's frame so the RigidBody can place them.
  // They stay invisible (hence includeInvisible on the body) so nothing is drawn
  // twice — only their shapes reach Rapier.
  const solids = useMemo(() => {
    model.updateWorldMatrix(true, true);
    const toRoot = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const out: THREE.Mesh[] = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !SOLID.test(mesh.name)) return;
      const proxy = new THREE.Mesh(mesh.geometry);
      mesh.updateWorldMatrix(true, false);
      proxy.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
      proxy.visible = false;
      out.push(proxy);
    });
    return out;
  }, [model]);

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

      <Suspense fallback={null}>
        <ForestModel url={forestModelUrl} />
      </Suspense>
    </group>
  );
}

// Warm the cache at startup: the scene is 15 MB, and until it resolves the
// terrain colliders do not exist, so the drone would drop off the pad waiting.
useGLTF.preload(forestModelUrl);

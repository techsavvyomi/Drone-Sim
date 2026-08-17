import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import classroom2ModelUrl from '../../../assets/models/classroom2.glb?url';

// classroom2.glb is already in metres, and IS Draco-compressed.
//
// drei defaults its DRACOLoader to gstatic.com, which the app's CSP
// (`connect-src 'self'`) blocks — the decoder never loads, the geometry never
// decompresses, and the room renders as untextured grey. Hence the bundled
// decoder in public/draco/gltf/ and the explicit path below.
//
// The path is deliberately RELATIVE: it resolves against the document base, so
// it works both under the dev server and under file:// in a packaged build,
// where a leading slash would point at the filesystem root.
const DRACO_DECODER_PATH = 'draco/gltf/';
const MODEL_SCALE = 1;
// Raw bbox ≈ [-100.7, -0.2, -10.2] → [-92.4, 3.3, 0.17].
// XZ recentre only. Do NOT lift Y — visual parquet must sit on physics y=0.
const MODEL_OFFSET: [number, number, number] = [96.54, 0, 5.02];

const FLOOR_HALF_H = 0.25;
/** Outer shell thickness — centres sit outside play bounds. */
const WALL_T = 0.55;
/** Pull inner faces in so they sit on the visible plaster, not behind it. */
const WALL_INSET = 0.18;

const KEEP_METAL = /metal|chrome|iron|galva/i;

type BoxCollider = {
  key: string;
  position: [number, number, number];
  half: [number, number, number];
};

function Classroom2Lights() {
  return (
    <group>
      <ambientLight intensity={0.55} color="#fff6ea" />
      <hemisphereLight args={['#e8f0ff', '#3a3228', 0.45]} />
      <directionalLight position={[-6.5, 2.6, 0.2]} intensity={1.05} color="#dff0ff" />
      <pointLight position={[0, 2.9, 0]} intensity={1.1} color="#fff8ec" distance={11} decay={2} />
    </group>
  );
}

function prepareMaterial(mat: THREE.Material): THREE.Material {
  const clone = mat.clone();
  const name = (clone.name || mat.name || '').trim();
  const std = clone as THREE.MeshStandardMaterial;
  const isPbr =
    std.isMeshStandardMaterial ||
    (clone as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial;
  if (!isPbr) return clone;

  if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
  if (std.emissiveMap) std.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  if (/glass|window/i.test(name)) {
    const phys = clone as THREE.MeshPhysicalMaterial;
    phys.transmission = 0;
    phys.transparent = true;
    phys.opacity = Math.min(phys.opacity || 1, 0.35);
    phys.depthWrite = false;
    phys.side = THREE.DoubleSide;
    phys.needsUpdate = true;
    return clone;
  }

  if (!KEEP_METAL.test(name)) {
    std.metalness = Math.min(std.metalness, 0.1);
  }

  std.envMapIntensity = 0.5;
  std.needsUpdate = true;
  return clone;
}

function skipNamed(obj: THREE.Object3D): boolean {
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (/floor|ceiil|ceiling|glass|emissive/i.test(o.name)) return true;
    o = o.parent;
  }
  return false;
}

/**
 * Fast, accurate, non-lagging colliders for classroom furniture & structures:
 * - Table tops & chair seats get thin plate colliders at top/seat height.
 * - Furniture legs & side frames get thin leg colliders at outer bounds.
 * - Middle space under desks & chairs remains 100% open for drone fly-through.
 */
function buildColliders(
  root: THREE.Object3D,
  spawn: { position: [number, number, number] },
): BoxCollider[] {
  root.updateWorldMatrix(true, true);
  const boxes: BoxCollider[] = [];
  const worldBox = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  const [sx, sy, sz] = spawn.position;

  const SPAWN_HX = 0.14;
  const SPAWN_HY = 0.1;
  const SPAWN_HZ = 0.14;
  let i = 0;

  const pushBox = (position: [number, number, number], half: [number, number, number], tag: string) => {
    const overlapX = Math.abs(position[0] - sx) < half[0] + SPAWN_HX;
    const overlapY = Math.abs(position[1] - sy) < half[1] + SPAWN_HY;
    const overlapZ = Math.abs(position[2] - sz) < half[2] + SPAWN_HZ;
    if (overlapX && overlapY && overlapZ) return;

    // Deduplicate: avoid adding identical/concentric boxes
    for (let b = 0; b < boxes.length; b++) {
      const existing = boxes[b];
      if (
        Math.abs(existing.position[0] - position[0]) < 0.02 &&
        Math.abs(existing.position[1] - position[1]) < 0.02 &&
        Math.abs(existing.position[2] - position[2]) < 0.02 &&
        Math.abs(existing.half[0] - half[0]) < 0.03 &&
        Math.abs(existing.half[2] - half[2]) < 0.03
      ) {
        return; // Duplicate / near-duplicate box found, skip
      }
    }

    boxes.push({ key: `furn-${i++}-${tag}`, position, half });
  };

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (skipNamed(mesh)) return;

    worldBox.setFromObject(mesh);
    if (worldBox.isEmpty()) return;
    worldBox.getSize(size);
    worldBox.getCenter(center);

    if (size.x < 0.008 || size.y < 0.008 || size.z < 0.008) return;
    if (size.x * size.y * size.z < 0.0001) return;
    if (size.y < 0.15 && size.x > 3 && size.z > 3) return; // Ignore room-wide floor/ceiling planes

    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const matName = (mat && mat.name ? mat.name : '').toLowerCase();
    const isWood = /wood|board|laminate/i.test(matName);
    const isMetal = /metal|steel|iron|gray/i.test(matName);

    // 1. INTEGRATED STUDENT DESK + CHAIR STATIONS (Object_53: Wood tabletop + chair seat + backrest)
    if (isWood && size.z > 0.60 && size.y > 0.20) {
      // 1A. Tabletop Solid Slab (Front/Desk at +Z side):
      const deskHx = Math.max(size.x * 0.49, 0.015);
      const deskHy = 0.035; // 7cm solid tabletop slab (y: ~0.69m to ~0.76m) to prevent penetration
      const deskHz = 0.22;  // 44cm depth covering the full visual wooden desk
      const deskTopY = center.y + size.y * 0.5 - deskHy;
      const deskZ = (center.z + size.z * 0.5) - deskHz;
      pushBox([center.x, deskTopY, deskZ], [deskHx, deskHy, deskHz], 'wood-tabletop');

      // 1B. Chair Seat Plate (Back/Chair at -Z side, lower at y ≈ 0.44m):
      const chairSeatHx = 0.20; // 40cm wide seat
      const chairSeatHy = 0.025; // 5cm solid seat slab to prevent penetration
      const chairSeatHz = 0.18; // 36cm deep seat
      const chairSeatY = (center.y - size.y * 0.5) + chairSeatHy + 0.01; // ≈ 0.44m top height
      const chairSeatZ = (center.z - size.z * 0.5 + 0.04) + chairSeatHz;
      pushBox([center.x, chairSeatY, chairSeatZ], [chairSeatHx, chairSeatHy, chairSeatHz], 'chair-seat');

      // 1C. Chair Backrest Plate (Rear-most thin vertical plate at -Z side, y ≈ 0.65-0.78m):
      const backrestHx = 0.20; // 40cm wide
      const backrestHy = 0.065; // 13cm tall plate
      const backrestHz = 0.02; // 4cm solid plate
      const backrestY = (center.y + size.y * 0.5) - backrestHy;
      const backrestZ = (center.z - size.z * 0.5) + backrestHz;
      pushBox([center.x, backrestY, backrestZ], [backrestHx, backrestHy, backrestHz], 'chair-backrest');
      return;
    }

    // 2. OTHER SOLID WOOD BOARDS & FLAT PLATES (Single tables, doors, blackboards, podiums, shelves)
    if (isWood || size.y < 0.06) {
      const hx = Math.max(size.x * 0.48, 0.015);
      const hy = Math.max(Math.min(size.y * 0.5, 0.035), 0.015);
      const hz = Math.max(size.z * 0.48, 0.015);
      pushBox([center.x, center.y, center.z], [hx, hy, hz], isWood ? 'wood-plate' : 'plate');
      return;
    }

    // 3. METAL FRAMES & LEGS (Hollow / Open Middle)
    if (isMetal && size.y > 0.25 && size.x > 0.15 && size.z > 0.15) {
      const legRadius = 0.02; // 4 cm sturdy leg pillar to prevent high-speed tunneling
      if (size.z > 0.60) {
        // Integrated desk + chair steel frame:
        // Desk 4 leg pillars (height ~0.70m at +Z side):
        const deskLegHalfY = 0.35;
        const deskLegY = 0.35;
        const deskX = size.x * 0.44;
        const deskZFront = center.z + size.z * 0.44;
        const deskZBack = center.z + size.z * 0.08;
        pushBox([center.x - deskX, deskLegY, deskZFront], [legRadius, deskLegHalfY, legRadius], 'desk-leg');
        pushBox([center.x + deskX, deskLegY, deskZFront], [legRadius, deskLegHalfY, legRadius], 'desk-leg');
        pushBox([center.x - deskX, deskLegY, deskZBack], [legRadius, deskLegHalfY, legRadius], 'desk-leg');
        pushBox([center.x + deskX, deskLegY, deskZBack], [legRadius, deskLegHalfY, legRadius], 'desk-leg');

        // Chair 4 leg pillars (height ~0.44m at -Z side):
        const chairLegHalfY = 0.22;
        const chairLegY = 0.22;
        const chairX = 0.18;
        const chairZFront = center.z - size.z * 0.12;
        const chairZBack = center.z - size.z * 0.44;
        pushBox([center.x - chairX, chairLegY, chairZFront], [legRadius, chairLegHalfY, legRadius], 'chair-leg');
        pushBox([center.x + chairX, chairLegY, chairZFront], [legRadius, chairLegHalfY, legRadius], 'chair-leg');
        pushBox([center.x - chairX, chairLegY, chairZBack], [legRadius, chairLegHalfY, legRadius], 'chair-leg');
        pushBox([center.x + chairX, chairLegY, chairZBack], [legRadius, chairLegHalfY, legRadius], 'chair-leg');

        // Chair 2 backrest upright metal support posts (from seat y=0.44 up to backrest y=0.78):
        const uprightHalfY = 0.17;
        const uprightY = 0.61;
        pushBox([center.x - chairX, uprightY, chairZBack], [legRadius, uprightHalfY, legRadius], 'chair-upright');
        pushBox([center.x + chairX, uprightY, chairZBack], [legRadius, uprightHalfY, legRadius], 'chair-upright');
        return;
      }

      // Single standard frame:
      const legHalfY = size.y * 0.5;
      const cornerX = Math.max(0.01, size.x * 0.44);
      const cornerZ = Math.max(0.01, size.z * 0.44);
      pushBox([center.x - cornerX, center.y, center.z - cornerZ], [legRadius, legHalfY, legRadius], 'leg-bl');
      pushBox([center.x + cornerX, center.y, center.z - cornerZ], [legRadius, legHalfY, legRadius], 'leg-br');
      pushBox([center.x - cornerX, center.y, center.z + cornerZ], [legRadius, legHalfY, legRadius], 'leg-fl');
      pushBox([center.x + cornerX, center.y, center.z + cornerZ], [legRadius, legHalfY, legRadius], 'leg-fr');
      return;
    }

    // 4. Single Pipes, Rails, Walls & Miscellaneous Props
    const hx = Math.max(size.x * 0.5, 0.015);
    const hy = Math.max(size.y * 0.5, 0.015);
    const hz = Math.max(size.z * 0.5, 0.015);
    pushBox([center.x, center.y, center.z], [hx, hy, hz], mesh.name || 'prop');
  });

  return boxes;
}

/** Developer toggle for visual collider wireframe debugging (keep false for production) */
const DEBUG_COLLIDERS = false;

function Classroom2Model({
  url,
  spawnPos,
}: {
  url: string;
  spawnPos: [number, number, number];
}) {
  const { scene } = useGLTF(url, DRACO_DECODER_PATH);

  const { model, furnitureBoxes } = useMemo(() => {
    const root = scene.clone(true);
    root.position.set(...MODEL_OFFSET);
    root.scale.setScalar(MODEL_SCALE);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const mat = mesh.material;
      if (Array.isArray(mat)) mesh.material = mat.map(prepareMaterial);
      else if (mat) mesh.material = prepareMaterial(mat);
    });

    return {
      model: root,
      furnitureBoxes: buildColliders(root, { position: spawnPos }),
    };
  }, [scene, spawnPos[0], spawnPos[1], spawnPos[2]]);

  return (
    <>
      <primitive object={model} />
      <RigidBody type="fixed" colliders={false}>
        {furnitureBoxes.map((b) => (
          <CuboidCollider
            key={b.key}
            args={b.half}
            position={b.position}
            friction={0.4}
            restitution={0.02}
          />
        ))}
      </RigidBody>

      {/* Visual Developer Debug Wireframe for Chair/Table Colliders (disabled by default) */}
      {DEBUG_COLLIDERS &&
        furnitureBoxes.map((b) => (
          <mesh key={`debug-${b.key}`} position={b.position}>
            <boxGeometry args={[b.half[0] * 2, b.half[1] * 2, b.half[2] * 2]} />
            <meshBasicMaterial
              color={
                b.key.includes('chair-seat')
                  ? '#4ade80' // Green: Chair Seat
                  : b.key.includes('chair-backrest')
                  ? '#38bdf8' // Cyan: Chair Backrest
                  : b.key.includes('chair-leg') || b.key.includes('chair-upright')
                  ? '#f87171' // Red: Chair Legs & Upright Support Posts
                  : b.key.includes('wood-tabletop')
                  ? '#fbbf24' // Amber: Tabletop
                  : '#94a3b8' // Slate: General frame / prop
              }
              wireframe
              transparent
              opacity={0.35}
            />
          </mesh>
        ))}
    </>
  );
}

export function Classroom2Env({ env }: { env: EnvironmentSpec }) {
  const { min, max } = env.bounds;
  const sizeX = max[0] - min[0];
  const sizeZ = max[2] - min[2];
  const cx = (max[0] + min[0]) / 2;
  const cz = (max[2] + min[2]) / 2;
  const halfX = sizeX / 2;
  const halfZ = sizeZ / 2;
  const wallH = Math.max(max[1], 3.0);
  const spawnPos = env.spawn.position as [number, number, number];

  return (
    <group>
      <Classroom2Lights />

      {env.model && (
        <Suspense fallback={null}>
          <Classroom2Model url={env.model} spawnPos={spawnPos} />
        </Suspense>
      )}

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[halfX + 0.5, FLOOR_HALF_H, halfZ + 0.5]}
          position={[cx, -FLOOR_HALF_H, cz]}
        />
      </RigidBody>

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[halfX + 0.5, 0.18, halfZ + 0.5]}
          position={[cx, max[1] + 0.18, cz]}
          friction={0}
          restitution={0}
        />
      </RigidBody>

      {/* Room walls — inset so the drone stops on the visible plaster. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[halfX + WALL_T, wallH / 2, WALL_T / 2]}
          position={[cx, wallH / 2, min[2] - WALL_T / 2 + WALL_INSET]}
          friction={0.05}
          restitution={0}
        />
        <CuboidCollider
          args={[halfX + WALL_T, wallH / 2, WALL_T / 2]}
          position={[cx, wallH / 2, max[2] + WALL_T / 2 - WALL_INSET]}
          friction={0.05}
          restitution={0}
        />
        <CuboidCollider
          args={[WALL_T / 2, wallH / 2, halfZ + WALL_T]}
          position={[min[0] - WALL_T / 2 + WALL_INSET, wallH / 2, cz]}
          friction={0.05}
          restitution={0}
        />
        <CuboidCollider
          args={[WALL_T / 2, wallH / 2, halfZ + WALL_T]}
          position={[max[0] + WALL_T / 2 - WALL_INSET, wallH / 2, cz]}
          friction={0.05}
          restitution={0}
        />
      </RigidBody>
    </group>
  );
}

useGLTF.preload(classroom2ModelUrl, DRACO_DECODER_PATH);



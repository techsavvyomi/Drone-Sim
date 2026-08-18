import { Suspense, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import newYorkModelUrl from '../../../assets/models/new_york_city.opt.glb?url';
import { NewYorkColliders } from './NewYorkColliders';
import { highResStreetPBR } from './textures';

// New York City urban environment. Draco-compressed GLB with realistic Manhattan
// skyscrapers, roadways, sidewalks, and rooftops.

/**
 * Centering offset: raw model center is at [-61.68, 0, 30.56].
 * Shifting by [+61.68, 0, -30.56] places the central avenue and intersection
 * right at (0, 0, 0) with ground level on y = 0.
 */
const CITY_OFFSET: [number, number, number] = [61.68, 0, -30.56];
const MODEL_SCALE = 1;

/**
 * Top face of the catch floor — a safety boundary below the city streets.
 */
const CATCH_TOP = -8;
const CATCH_HALF = 2;

/**
 * Half-width of a flat apron over the spawn avenue, top face on y = 0.
 * Ensures the drone can sit firmly on solid ground immediately while the
 * 3D city scene finishes streaming in.
 */
const APRON_HALF = 25;
const SPAWN_POS: [number, number, number] = [0, 0.018, 30];

function NewYorkModel({ url }: { url: string }) {
  const gl = useThree((s) => s.gl);
  const { scene } = useGLTF(url);

  // Full 16x texture anisotropy for razor-sharp ground and facades at grazing angles
  const maxAniso = Math.min(gl.capabilities.getMaxAnisotropy(), 16);
  const streetPbr = useMemo(() => highResStreetPBR(maxAniso), [maxAniso]);
  const uTimeUniform = useMemo(() => ({ value: 0 }), []);

  const model = useMemo(() => {
    const root = scene.clone(true);
    root.position.set(...CITY_OFFSET);
    root.scale.setScalar(MODEL_SCALE);

    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.frustumCulled = true;

        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const bb = m.geometry.boundingBox;
        const height = bb ? bb.max.y - bb.min.y : 0;

        const mats = Array.isArray(m.material) ? m.material : [m.material];

        for (const mat of mats) {
          if (!mat) continue;
          const std = mat as THREE.MeshStandardMaterial;
          const matName = std.name || '';

          // 1. Realistic Foliage & Trees (Alpha-Test cutoff, 3D volume lighting & wind sway)
          if (/foliage|tree|leaf|leaves/i.test(matName)) {
            std.transparent = false;
            std.alphaTest = 0.45;
            std.depthWrite = true;
            std.side = THREE.DoubleSide;
            std.roughness = 0.80;
            std.metalness = 0.02;

            // Wind sway vertex shader displacement using shared uniform
            std.onBeforeCompile = (shader) => {
              shader.uniforms.uTime = uTimeUniform;
              shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `#include <common>
                uniform float uTime;`
              );
              shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                float windHeight = clamp((position.y - 2.0) * 0.15, 0.0, 1.0);
                float windSway = sin(uTime * 2.2 + position.x * 0.5 + position.z * 0.4) * 0.045 * windHeight;
                transformed.x += windSway;
                transformed.z += windSway * 0.7;`
              );
            };
            std.needsUpdate = true;
          } else if (/bark/i.test(matName)) {
            std.roughness = 0.92;
            std.metalness = 0.0;
            std.needsUpdate = true;
          } else if (/CityGen_Streets/i.test(matName)) {
            // Re-unwrap street quad with planar world-space UV coordinates (2.6 units per metre for razor-sharp aggregate)
            const posAttr = m.geometry.attributes.position;
            if (posAttr) {
              const uvs = new Float32Array(posAttr.count * 2);
              const scale = 2.6; // 2.6 repeats per metre -> coarse and medium gravel stones are crisp 2-8mm chips under the camera
              for (let i = 0; i < posAttr.count; i++) {
                uvs[i * 2] = (posAttr.getX(i) + CITY_OFFSET[0]) * scale;
                uvs[i * 2 + 1] = (posAttr.getZ(i) + CITY_OFFSET[2]) * scale;
              }
              m.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
              m.geometry.attributes.uv.needsUpdate = true;
            }

            // Apply high-definition procedural PBR asphalt (sharp aggregate stone facets, dark bitumen matrix, micro-relief normal)
            std.map = streetPbr.map;
            std.normalMap = streetPbr.normalMap;
            std.normalScale = new THREE.Vector2(1.2, 1.2);
            std.roughnessMap = streetPbr.roughnessMap;
            std.roughness = 0.82;
            std.metalness = 0.05;
            std.color.set('#ffffff');
            std.needsUpdate = true;
          } else if (/DecalsStain/i.test(matName)) {
            // High-detail street tar patches & ground stains (polygon offset prevents z-fighting with street slab)
            std.transparent = true;
            std.depthWrite = false;
            std.polygonOffset = true;
            std.polygonOffsetFactor = -1;
            std.polygonOffsetUnits = -1;
            if (std.map) {
              std.map.anisotropy = maxAniso;
              std.map.needsUpdate = true;
            }
            std.needsUpdate = true;
          } else if (/lanes/i.test(matName) || /Street_Assets/i.test(matName)) {
            // Bright white painted markings, diagonal parking lines, road arrows, and manholes
            std.color.set('#ffffff');
            std.roughness = 0.40;
            std.metalness = 0.01;
            if (std.map) {
              std.map.anisotropy = maxAniso;
              std.map.needsUpdate = true;
            }
            std.needsUpdate = true;
          } else if (/side_walks|Curb|simple_concrete/i.test(matName)) {
            // Clean sidewalk stone concrete and curbs
            std.color.set('#a0a6ac');
            std.roughness = 0.72;
            if (std.map) {
              std.map.anisotropy = maxAniso;
              std.map.needsUpdate = true;
            }
            std.needsUpdate = true;
          } else {
            // Apply 16x anisotropy across all authored building facade and rooftop PBR maps
            if (std.map) {
              std.map.anisotropy = maxAniso;
              std.map.needsUpdate = true;
            }
            if (std.normalMap) {
              std.normalMap.anisotropy = maxAniso;
              std.normalMap.needsUpdate = true;
            }
            if (std.roughnessMap) {
              std.roughnessMap.anisotropy = maxAniso;
              std.roughnessMap.needsUpdate = true;
            }
            if (std.metalnessMap) {
              std.metalnessMap.anisotropy = maxAniso;
              std.metalnessMap.needsUpdate = true;
            }
            std.needsUpdate = true;
          }
        }

        // Shadow casting: Consolidate shadow casting to major high-rise structures (height >= 12m)
        m.castShadow = height >= 12.0;
        m.receiveShadow = true;
      }
    });

    return root;
  }, [scene, maxAniso, streetPbr, uTimeUniform]);

  // Animate wind sway over time
  useFrame((_, dt) => {
    uTimeUniform.value += dt;
  });

  // Visual model is purely cosmetic — 0 physics trimesh overhead
  return <primitive object={model} />;
}

useGLTF.preload(newYorkModelUrl);

export function NewYorkEnv({ env }: { env: EnvironmentSpec }) {
  const url = env.model ?? newYorkModelUrl;

  return (
    <group name="new-york-environment">
      {/* Immediate spawn ground pad (solid physics support while GLB streams in) */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[APRON_HALF, 0.25, APRON_HALF]} position={[SPAWN_POS[0], -0.25, SPAWN_POS[2]]} />
      </RigidBody>

      {/* Analytical Compound Physics Colliders (Ground Plane + 28 Building Boxes + 4 Exact Boundary Walls) */}
      <NewYorkColliders />

      {/* Safety catch floor (spanning full 3D visual city area) */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[130, CATCH_HALF, 105]} position={[0, CATCH_TOP - CATCH_HALF, 0]} />
      </RigidBody>

      {/* 3D City Visual Model */}
      <Suspense fallback={null}>
        <NewYorkModel url={url} />
      </Suspense>
    </group>
  );
}

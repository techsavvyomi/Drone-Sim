import { Suspense, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { EnvironmentSpec } from '@shared/types';
import newYorkModelUrl from '../../../assets/models/new_york_city.opt.glb?url';
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
 */
const APRON_HALF = 25;
const SPAWN_POS: [number, number, number] = [0, 0.024, 30];

function NewYorkModel({ url }: { url: string }) {
  const gl = useThree((s) => s.gl);
  const { scene } = useGLTF(url);

  // Full 16x texture anisotropy for razor-sharp ground and facades at grazing angles
  const maxAniso = Math.min(gl.capabilities.getMaxAnisotropy(), 16);
  const streetPbr = useMemo(() => highResStreetPBR(maxAniso), [maxAniso]);
  const uTimeUniform = useMemo(() => ({ value: 0 }), []);

  const { solidRoot, visualRoot } = useMemo(() => {
    const solid = new THREE.Group();
    solid.position.set(...CITY_OFFSET);
    solid.scale.setScalar(MODEL_SCALE);

    const visual = new THREE.Group();
    visual.position.set(...CITY_OFFSET);
    visual.scale.setScalar(MODEL_SCALE);

    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const origMesh = o as THREE.Mesh;
        const m = origMesh.clone(true);
        m.frustumCulled = true;

        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const bb = m.geometry.boundingBox;
        const height = bb ? bb.max.y - bb.min.y : 0;

        const mats = Array.isArray(m.material) ? m.material : [m.material];

        let isVisualOnly = false;

        for (const mat of mats) {
          if (!mat) continue;
          const std = mat as THREE.MeshStandardMaterial;
          const matName = std.name || '';

          // 1. Foliage Leaves & Wind Sway (Visual-only pass-through)
          if (/foliage|tree|leaf|leaves/i.test(matName)) {
            isVisualOnly = true;
            std.transparent = false;
            std.alphaTest = 0.45;
            std.depthWrite = true;
            std.side = THREE.DoubleSide;
            std.roughness = 0.80;
            std.metalness = 0.02;

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
          } else if (/DecalsStain/i.test(matName)) {
            // Ground stain decals (Visual-only)
            isVisualOnly = true;
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
          } else if (/bark/i.test(matName)) {
            std.roughness = 0.92;
            std.metalness = 0.0;
            std.needsUpdate = true;
          } else if (/CityGen_Streets/i.test(matName)) {
            // Re-unwrap street quad with planar world-space UV coordinates
            const posAttr = m.geometry.attributes.position;
            if (posAttr) {
              const uvs = new Float32Array(posAttr.count * 2);
              const scale = 2.6;
              for (let i = 0; i < posAttr.count; i++) {
                uvs[i * 2] = (posAttr.getX(i) + CITY_OFFSET[0]) * scale;
                uvs[i * 2 + 1] = (posAttr.getZ(i) + CITY_OFFSET[2]) * scale;
              }
              m.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
              m.geometry.attributes.uv.needsUpdate = true;
            }

            std.map = streetPbr.map;
            std.normalMap = streetPbr.normalMap;
            std.normalScale = new THREE.Vector2(1.2, 1.2);
            std.roughnessMap = streetPbr.roughnessMap;
            std.roughness = 0.82;
            std.metalness = 0.05;
            std.color.set('#ffffff');
            std.needsUpdate = true;
          } else if (/lanes/i.test(matName) || /Street_Assets/i.test(matName)) {
            std.color.set('#ffffff');
            std.roughness = 0.40;
            std.metalness = 0.01;
            if (std.map) {
              std.map.anisotropy = maxAniso;
              std.map.needsUpdate = true;
            }
            std.needsUpdate = true;
          } else if (/side_walks|Curb|simple_concrete/i.test(matName)) {
            std.color.set('#a0a6ac');
            std.roughness = 0.72;
            if (std.map) {
              std.map.anisotropy = maxAniso;
              std.map.needsUpdate = true;
            }
            std.needsUpdate = true;
          } else {
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

        m.castShadow = height >= 12.0;
        m.receiveShadow = true;

        if (isVisualOnly) {
          visual.add(m);
        } else {
          solid.add(m);
        }
      }
    });

    return { solidRoot: solid, visualRoot: visual };
  }, [scene, maxAniso, streetPbr, uTimeUniform]);

  // Animate wind sway over time
  useFrame((_, dt) => {
    uTimeUniform.value += dt;
  });

  return (
    <>
      {/* Visual-only meshes (Foliage leaves with wind sway, ground stain decals) */}
      <primitive object={visualRoot} />

      {/* Solid structural meshes (Buildings, Facades, Sidewalks, Curbs, Road, Street Furniture, Poles, Tree Trunks) */}
      <RigidBody type="fixed" colliders="trimesh">
        <primitive object={solidRoot} />
      </RigidBody>
    </>
  );
}

useGLTF.preload(newYorkModelUrl);

export function NewYorkEnv({ env }: { env: EnvironmentSpec }) {
  const url = env.model ?? newYorkModelUrl;

  return (
    <group name="new-york-environment">
      {/* Immediate spawn ground pad */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[APRON_HALF, 0.25, APRON_HALF]} position={[SPAWN_POS[0], -0.25, SPAWN_POS[2]]} />
      </RigidBody>

      {/* Extended open field ground plane beyond visual city */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[500, 0.5, 500]} position={[0, -0.5, 0]} friction={0.8} restitution={0.05} />
      </RigidBody>

      {/* Safety catch floor */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[130, CATCH_HALF, 105]} position={[0, CATCH_TOP - CATCH_HALF, 0]} />
      </RigidBody>

      {/* 3D City Visual Model with Exact Structural Trimesh Physics */}
      <Suspense fallback={null}>
        <NewYorkModel url={url} />
      </Suspense>
    </group>
  );
}

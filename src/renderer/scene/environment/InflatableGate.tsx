import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';

// Inflatable FPV Drone Racing Arch Gate with custom "PlutoSim" branding.
// Designed from official FPV drone racing gates (MultiGP / FPV SkyDive).
// Features inflatable vinyl texture with shattered geometric shard patterns on
// the pillars, bold high-visibility "PLUTO SIM" top banner on front and back,
// and a semi-transparent luminous green checkpoint laser curtain.

interface InflatableGateProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  showCurtain?: boolean;
}

/** Generates high-res PlutoSim banner texture for the top crossbar. */
function createBannerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Dark inflatable vinyl background with subtle horizontal gradient
  const grad = ctx.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#0c0e10');
  grad.addColorStop(0.2, '#15181b');
  grad.addColorStop(0.5, '#1e2226');
  grad.addColorStop(0.8, '#15181b');
  grad.addColorStop(1, '#0c0e10');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 256);

  // Inflatable tube welded seam lines at top and bottom
  ctx.fillStyle = '#2a2f35';
  ctx.fillRect(0, 6, 1024, 4);
  ctx.fillRect(0, 246, 1024, 4);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(0, 10, 1024, 2);
  ctx.fillRect(0, 244, 1024, 2);

  // Geometric shattered shards at outer ends of banner
  ctx.fillStyle = 'rgba(255, 59, 30, 0.45)'; // Brand racing red-orange
  ctx.beginPath();
  ctx.moveTo(30, 20);
  ctx.lineTo(110, 20);
  ctx.lineTo(80, 100);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(994, 20);
  ctx.lineTo(914, 20);
  ctx.lineTo(944, 100);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.beginPath();
  ctx.moveTo(60, 130);
  ctx.lineTo(140, 180);
  ctx.lineTo(80, 230);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(964, 130);
  ctx.lineTo(884, 180);
  ctx.lineTo(944, 230);
  ctx.closePath();
  ctx.fill();

  // Racing chevrons on both sides
  ctx.fillStyle = '#ff3b1e';
  for (let i = 0; i < 3; i++) {
    const xLeft = 140 + i * 28;
    ctx.beginPath();
    ctx.moveTo(xLeft, 90);
    ctx.lineTo(xLeft + 16, 128);
    ctx.lineTo(xLeft, 166);
    ctx.lineTo(xLeft + 10, 166);
    ctx.lineTo(xLeft + 26, 128);
    ctx.lineTo(xLeft + 10, 90);
    ctx.closePath();
    ctx.fill();

    const xRight = 860 - i * 28;
    ctx.beginPath();
    ctx.moveTo(xRight, 90);
    ctx.lineTo(xRight - 16, 128);
    ctx.lineTo(xRight, 166);
    ctx.lineTo(xRight - 10, 166);
    ctx.lineTo(xRight - 26, 128);
    ctx.lineTo(xRight - 10, 90);
    ctx.closePath();
    ctx.fill();
  }

  // Brand Name: Bold racing typography "PLUTO SIM"
  // "PLUTO" in red-orange (#FF3B1E), "SIM" in clean white (#FFFFFF)
  ctx.font = '900 106px "Geist", "Impact", "Arial Black", sans-serif';

  const plutoWidth = ctx.measureText('PLUTO ').width;
  const simWidth = ctx.measureText('SIM').width;
  const totalWidth = plutoWidth + simWidth;
  const startX = 512 - totalWidth / 2;

  // Drop shadow for 3D realism and contrast
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('PLUTO ', startX + 4, 122 + 4);
  ctx.fillText('SIM', startX + plutoWidth + 4, 122 + 4);

  // Draw PLUTO in vivid racing red-orange
  ctx.fillStyle = '#ff3b1e';
  ctx.fillText('PLUTO ', startX, 122);

  // Draw SIM in pure clean white
  ctx.fillStyle = '#ffffff';
  ctx.fillText('SIM', startX + plutoWidth, 122);

  // Subtitle / tagline
  ctx.font = '700 24px "Geist Mono", "Arial", sans-serif';
  ctx.fillStyle = '#9aa1a8';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '6px';
  ctx.fillText('DRONA AVIATION  •  FPV RACING', 512, 198);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Generates shattered geometric shard camouflage texture for the pillars. */
function createPillarTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Vertical gradient background matching the reference screenshot:
  // Light silver/white at the base, transitioning into dark vinyl at the top
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 1024);
  bgGrad.addColorStop(0, '#0e1013'); // Top: dark inflatable vinyl
  bgGrad.addColorStop(0.35, '#181b20');
  bgGrad.addColorStop(0.6, '#48525e');
  bgGrad.addColorStop(0.85, '#bac4cf');
  bgGrad.addColorStop(1, '#e2e7ec'); // Bottom: light silver base
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 1024);

  // Inflatable side seam ribs
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.fillRect(0, 0, 16, 1024);
  ctx.fillRect(496, 0, 16, 1024);

  // Seeded deterministic pseudo-random generator
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // Shattered polygon shards:
  // At the bottom (light bg), shards are black/dark charcoal
  // At the top (dark bg), shards are light silver/grey/orange
  for (let i = 0; i < 110; i++) {
    const cx = rand() * 470 + 20;
    const cy = rand() * 980 + 20;
    const r = 24 + rand() * 56;

    // Pick color depending on vertical position
    let color: string;
    if (cy > 600) {
      // Bottom section: dark shards on light background
      const darkPalette = [
        '#0c0e10',
        '#16191d',
        '#22262c',
        '#2f353d',
        '#ff3b1e', // Red-orange accent shard
      ];
      color = darkPalette[Math.floor(rand() * darkPalette.length)];
    } else {
      // Top section: light/medium shards on dark background
      const lightPalette = [
        '#262c33',
        '#373f49',
        '#525c6a',
        '#788494',
        '#a1adb9',
        '#ff3b1e',
      ];
      color = lightPalette[Math.floor(rand() * lightPalette.length)];
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    const sides = 3 + (rand() > 0.75 ? 1 : 0); // Triangles and quadrilaterals
    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * Math.PI * 2 + rand() * 0.8;
      const dist = r * (0.6 + rand() * 0.7);
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Base Racing Triangle / Chevron at the very bottom (like reference screenshot)
  ctx.fillStyle = '#ff3b1e';
  ctx.beginPath();
  ctx.moveTo(196, 1010);
  ctx.lineTo(256, 920);
  ctx.lineTo(316, 1010);
  ctx.closePath();
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Generates green translucent laser checkpoint curtain texture. */
function createCurtainTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 512, 512);

  // Soft luminous green gradient fill
  const radGrad = ctx.createRadialGradient(256, 256, 40, 256, 256, 256);
  radGrad.addColorStop(0, 'rgba(40, 250, 110, 0.45)');
  radGrad.addColorStop(0.7, 'rgba(25, 220, 90, 0.25)');
  radGrad.addColorStop(1, 'rgba(15, 180, 70, 0.10)');
  ctx.fillStyle = radGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Fine horizontal scanlines
  ctx.strokeStyle = 'rgba(90, 255, 150, 0.35)';
  ctx.lineWidth = 1.5;
  for (let y = 14; y < 512; y += 14) {
    ctx.beginPath();
    ctx.moveTo(10, y);
    ctx.lineTo(502, y);
    ctx.stroke();
  }

  // Center flight trajectory guide arc (orange/amber curved arc from screenshot)
  ctx.strokeStyle = '#ff9900';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(256, 230, 80, Math.PI * 0.2, Math.PI * 0.8, false);
  ctx.stroke();

  // Subtle outer glow around the trajectory arc
  ctx.strokeStyle = 'rgba(255, 170, 0, 0.35)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(256, 230, 80, Math.PI * 0.2, Math.PI * 0.8, false);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Creates custom arch curtain geometry that fits inside the chamfered opening.
 */
function createCurtainGeometry(colX: number, colHeight: number, barY: number, tubeR: number) {
  const innerW = colX - tubeR;
  const topW = colX - 0.95;
  const topY = barY - tubeR;
  const shoulderY = colHeight - 0.1;
  const botY = 0.04;

  const shape = new THREE.Shape();
  shape.moveTo(-innerW, botY);
  shape.lineTo(-innerW, shoulderY);
  shape.lineTo(-topW, topY);
  shape.lineTo(topW, topY);
  shape.lineTo(innerW, shoulderY);
  shape.lineTo(innerW, botY);
  shape.closePath();

  const geom = new THREE.ShapeGeometry(shape);

  // Set UVs normalized [0..1]
  const pos = geom.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  const minX = -innerW;
  const maxX = innerW;
  const minY = botY;
  const maxY = topY;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uvs[i * 2] = (x - minX) / (maxX - minX);
    uvs[i * 2 + 1] = (y - minY) / (maxY - minY);
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geom;
}

/**
 * Inflatable FPV Drone Racing Arch Gate.
 * Features:
 * - 4.0m span, 3.4m height, 0.28m tube radius.
 * - Solid inflatable vinyl finish with shattered polygonal camo graphics.
 * - Dual-sided front & back high-contrast "PLUTO SIM" branding.
 * - Glowing translucent green laser checkpoint curtain with trajectory arc.
 * - Rapier physics colliders for realistic drone impacts.
 */
export function InflatableGate({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  showCurtain = true,
}: InflatableGateProps) {
  const bannerTex = useMemo(() => createBannerTexture(), []);
  const pillarTex = useMemo(() => createPillarTexture(), []);
  const curtainTex = useMemo(() => createCurtainTexture(), []);

  // Geometry dimensions
  const colX = 2.0; // Distance of columns from center
  const colHeight = 2.4; // Straight vertical post height
  const tubeR = 0.28; // Inflatable tube radius
  const barY = 3.3; // Top horizontal bar height
  const barWidth = 2.4; // Straight horizontal section length

  const curtainGeom = useMemo(
    () => createCurtainGeometry(colX, colHeight, barY, tubeR),
    [colX, colHeight, barY, tubeR],
  );

  // Inflatable material with glossy vinyl reflection
  const vinylMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#121417',
        roughness: 0.38,
        metalness: 0.08,
      }),
    [],
  );

  const pillarMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: pillarTex,
        roughness: 0.42,
        metalness: 0.06,
      }),
    [pillarTex],
  );

  const bannerMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: bannerTex,
        roughness: 0.35,
        metalness: 0.05,
      }),
    [bannerTex],
  );

  const curtainMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: curtainTex,
        transparent: true,
        opacity: 0.38,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [curtainTex],
  );

  // Gentle breathing / pulse on the green laser curtain
  const curtainRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (curtainRef.current) {
      const t = clock.getElapsedTime();
      const pulse = 0.34 + Math.sin(t * 3.5) * 0.08;
      (curtainRef.current.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* ----------------- Visual Inflatable Arch Meshes ----------------- */}
      <group>
        {/* Left Column */}
        <mesh position={[-colX, colHeight / 2, 0]} material={pillarMat} castShadow receiveShadow>
          <cylinderGeometry args={[tubeR, tubeR, colHeight, 24]} />
        </mesh>

        {/* Right Column */}
        <mesh position={[colX, colHeight / 2, 0]} material={pillarMat} castShadow receiveShadow>
          <cylinderGeometry args={[tubeR, tubeR, colHeight, 24]} />
        </mesh>

        {/* Left Joint Sphere */}
        <mesh position={[-colX, colHeight, 0]} material={vinylMat} castShadow>
          <sphereGeometry args={[tubeR * 1.02, 20, 20]} />
        </mesh>

        {/* Right Joint Sphere */}
        <mesh position={[colX, colHeight, 0]} material={vinylMat} castShadow>
          <sphereGeometry args={[tubeR * 1.02, 20, 20]} />
        </mesh>

        {/* Left Corner Elbow (Angled 45 deg) */}
        <mesh
          position={[-colX + 0.4, colHeight + 0.45, 0]}
          rotation={[0, 0, Math.PI / 4]}
          material={pillarMat}
          castShadow
        >
          <cylinderGeometry args={[tubeR, tubeR, 1.25, 24]} />
        </mesh>

        {/* Right Corner Elbow (Angled -45 deg) */}
        <mesh
          position={[colX - 0.4, colHeight + 0.45, 0]}
          rotation={[0, 0, -Math.PI / 4]}
          material={pillarMat}
          castShadow
        >
          <cylinderGeometry args={[tubeR, tubeR, 1.25, 24]} />
        </mesh>

        {/* Top-Left Elbow to Bar Joint Sphere */}
        <mesh position={[-barWidth / 2, barY, 0]} material={vinylMat} castShadow>
          <sphereGeometry args={[tubeR * 1.02, 20, 20]} />
        </mesh>

        {/* Top-Right Elbow to Bar Joint Sphere */}
        <mesh position={[barWidth / 2, barY, 0]} material={vinylMat} castShadow>
          <sphereGeometry args={[tubeR * 1.02, 20, 20]} />
        </mesh>

        {/* Top Crossbar Tube */}
        <mesh
          position={[0, barY, 0]}
          rotation={[0, 0, Math.PI / 2]}
          material={vinylMat}
          castShadow
        >
          <cylinderGeometry args={[tubeR, tubeR, barWidth, 24]} />
        </mesh>

        {/* Front Banner Face (Ultra-sharp PLUTO SIM Branding) */}
        <mesh position={[0, barY, tubeR + 0.015]} material={bannerMat}>
          <planeGeometry args={[3.2, 0.64]} />
        </mesh>

        {/* Back Banner Face (For flying through from reverse direction) */}
        <mesh
          position={[0, barY, -(tubeR + 0.015)]}
          rotation={[0, Math.PI, 0]}
          material={bannerMat}
        >
          <planeGeometry args={[3.2, 0.64]} />
        </mesh>

        {/* Weighted Black Stabilizer Foot Pads */}
        <mesh position={[-colX, 0.04, 0]} receiveShadow>
          <boxGeometry args={[0.9, 0.08, 0.9]} />
          <meshStandardMaterial color="#0b0d0e" roughness={0.9} />
        </mesh>
        <mesh position={[colX, 0.04, 0]} receiveShadow>
          <boxGeometry args={[0.9, 0.08, 0.9]} />
          <meshStandardMaterial color="#0b0d0e" roughness={0.9} />
        </mesh>

        {/* Luminous Green Checkpoint Laser Curtain matching chamfered opening */}
        {showCurtain && (
          <mesh ref={curtainRef} geometry={curtainGeom} material={curtainMat} />
        )}
      </group>

      {/* ----------------- Physical Colliders (RigidBody) ----------------- */}
      <RigidBody type="fixed" colliders={false}>
        {/* Left Column Collider */}
        <CuboidCollider args={[tubeR, colHeight / 2, tubeR]} position={[-colX, colHeight / 2, 0]} />
        {/* Right Column Collider */}
        <CuboidCollider args={[tubeR, colHeight / 2, tubeR]} position={[colX, colHeight / 2, 0]} />
        {/* Top Crossbar Collider */}
        <CuboidCollider args={[colX, tubeR, tubeR]} position={[0, barY, 0]} />
        {/* Left Base Pad Collider */}
        <CuboidCollider args={[0.45, 0.04, 0.45]} position={[-colX, 0.04, 0]} />
        {/* Right Base Pad Collider */}
        <CuboidCollider args={[0.45, 0.04, 0.45]} position={[colX, 0.04, 0]} />
      </RigidBody>
    </group>
  );
}

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';

// Continuous Inflatable FPV Drone Racing Arch Gate with custom "PlutoSim" branding.
// Accurately styled after official FPV racing inflatable gates (e.g. FPV SkyDive).
// Features:
// - A single seamless, continuous 3D inflatable tubular arch with smooth curved bevels.
// - Authentic high-resolution vinyl texture with dark vinyl sheen, corner shattered
//   geometric polygon shards, red base chevron markers, and bold "PLUTO SIM" branding.
// - No distracting subtitles (pure racing logo as requested).
// - Luminous neon-green checkpoint laser curtain with scanlines and center trajectory guide.
// - Rapier physics colliders on the tube structure with an open fly-through center.

interface InflatableGateProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  showCurtain?: boolean;
}

const ARCH_COL_X = 2.2; // Half-width from center to pillar axis
const ARCH_TOP_Y = 3.25; // Centerline height of top horizontal section
const ARCH_TUBE_RADIUS = 0.28; // Radius of inflatable tube

/**
 * Creates the continuous CatmullRom spline path for the arch centerline.
 */
function createArchCurve(): THREE.CatmullRomCurve3 {
  const points = [
    new THREE.Vector3(-ARCH_COL_X, 0, 0),
    new THREE.Vector3(-ARCH_COL_X, 1.0, 0),
    new THREE.Vector3(-ARCH_COL_X, 1.95, 0),
    new THREE.Vector3(-ARCH_COL_X + 0.35, 2.65, 0),
    new THREE.Vector3(-ARCH_COL_X + 0.95, 3.05, 0),
    new THREE.Vector3(-0.6, ARCH_TOP_Y, 0),
    new THREE.Vector3(0, ARCH_TOP_Y, 0),
    new THREE.Vector3(0.6, ARCH_TOP_Y, 0),
    new THREE.Vector3(ARCH_COL_X - 0.95, 3.05, 0),
    new THREE.Vector3(ARCH_COL_X - 0.35, 2.65, 0),
    new THREE.Vector3(ARCH_COL_X, 1.95, 0),
    new THREE.Vector3(ARCH_COL_X, 1.0, 0),
    new THREE.Vector3(ARCH_COL_X, 0, 0),
  ];
  return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.1);
}

/**
 * Constructs a seamless, non-twisting 3D tube geometry along the planar arch curve.
 */
function createSeamlessTubeGeometry(
  curve: THREE.CatmullRomCurve3,
  radius: number,
  tubularSegments = 84,
  radialSegments = 24,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();

    // Constant in-plane normal and out-of-plane binormal for zero twisting
    const n = new THREE.Vector3(-t.y, t.x, 0).normalize();
    const b = new THREE.Vector3(0, 0, 1);

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const phi = v * Math.PI * 2;
      const dir = new THREE.Vector3()
        .addScaledVector(n, Math.cos(phi))
        .addScaledVector(b, Math.sin(phi))
        .normalize();

      const vertex = new THREE.Vector3().copy(p).addScaledVector(dir, radius);
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(dir.x, dir.y, dir.z);
      uvs.push(u, v);
    }
  }

  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = (i + 1) * (radialSegments + 1) + j;
      const c = (i + 1) * (radialSegments + 1) + (j + 1);
      const d = i * (radialSegments + 1) + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return geom;
}

/**
 * Generates high-res 2048x1024 texture for the entire continuous arch tube.
 * - U axis (X 0..2048) runs along the tube: Left Leg -> Left Elbow -> Top Bar -> Right Elbow -> Right Leg.
 * - V axis (Y 0..1024) runs around the tube: Front face is Y=256 (v=0.25), Back face is Y=768 (v=0.75).
 */
function createArchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // 1. Dark inflatable vinyl base
  ctx.fillStyle = '#111316';
  ctx.fillRect(0, 0, 2048, 1024);

  // Subtle inflatable seam line gradients
  const seamGrad = ctx.createLinearGradient(0, 0, 0, 1024);
  seamGrad.addColorStop(0, '#1a1d22');
  seamGrad.addColorStop(0.2, '#141619');
  seamGrad.addColorStop(0.25, '#1e2227'); // Front ridge
  seamGrad.addColorStop(0.3, '#141619');
  seamGrad.addColorStop(0.5, '#0e1012'); // Inner ridge
  seamGrad.addColorStop(0.7, '#141619');
  seamGrad.addColorStop(0.75, '#1e2227'); // Back ridge
  seamGrad.addColorStop(0.8, '#141619');
  seamGrad.addColorStop(1, '#1a1d22');
  ctx.fillStyle = seamGrad;
  ctx.fillRect(0, 0, 2048, 1024);

  // 2. Shattered geometric polygon shards on the corner elbows
  // Left elbow (u: 0.22..0.38 -> X: 450..780)
  // Right elbow (u: 0.62..0.78 -> X: 1268..1600)
  const drawShardsCluster = (centerX: number, centerY: number, width: number, height: number) => {
    let seed = centerX * 13 + centerY * 7;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const shardColors = [
      '#1b1f24',
      '#242930',
      '#323a45',
      '#495362',
      '#667487',
      '#9eabbc',
      '#e1e7ee',
      '#ff3b1e', // Red accent
    ];

    for (let i = 0; i < 48; i++) {
      const px = centerX + (rand() - 0.5) * width;
      const py = centerY + (rand() - 0.5) * height;
      const r = 18 + rand() * 42;
      const color = shardColors[Math.floor(rand() * shardColors.length)];

      ctx.fillStyle = color;
      ctx.beginPath();
      const sides = 3 + (rand() > 0.7 ? 1 : 0);
      for (let s = 0; s < sides; s++) {
        const angle = (s / sides) * Math.PI * 2 + rand() * 0.9;
        const d = r * (0.6 + rand() * 0.8);
        const sx = px + Math.cos(angle) * d;
        const sy = py + Math.sin(angle) * d;
        if (s === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
    }
  };

  // Draw shards on both elbows on front and back
  drawShardsCluster(610, 256, 320, 200); // Left elbow front
  drawShardsCluster(1438, 256, 320, 200); // Right elbow front
  drawShardsCluster(610, 768, 320, 200); // Left elbow back
  drawShardsCluster(1438, 768, 320, 200); // Right elbow back

  // 3. Red upward-pointing triangular chevrons at the base of each pillar
  const drawBaseChevron = (cx: number, cy: number) => {
    ctx.fillStyle = '#ff3b1e';
    ctx.beginPath();
    ctx.moveTo(cx - 32, cy + 42);
    ctx.lineTo(cx, cy - 42);
    ctx.lineTo(cx + 32, cy + 42);
    ctx.closePath();
    ctx.fill();

    // Subtle dark border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 3;
    ctx.stroke();
  };

  // Front base chevrons
  drawBaseChevron(80, 256);
  drawBaseChevron(1968, 256);
  // Back base chevrons
  drawBaseChevron(80, 768);
  drawBaseChevron(1968, 768);

  // 4. Official "PLUTO SIM" Branding on Top Crossbar
  // Positioned cleanly at X=1024, Y=256 (front) and Y=768 (back)
  // No extra clutter/subtitles per user instructions
  const drawBranding = (cx: number, cy: number, mirror = false) => {
    ctx.save();
    ctx.translate(cx, cy);
    if (mirror) {
      ctx.scale(-1, 1);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 132px "Geist", "Impact", "Arial Black", sans-serif';

    const plutoText = 'PLUTO ';
    const simText = 'SIM';
    const plutoW = ctx.measureText(plutoText).width;
    const simW = ctx.measureText(simText).width;
    const totalW = plutoW + simW;
    const startX = -totalW / 2;

    // Heavy drop shadow for contrast against vinyl
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.textAlign = 'left';
    ctx.fillText(plutoText, startX + 5, 5);
    ctx.fillText(simText, startX + plutoW + 5, 5);

    // PLUTO in bold racing red-orange
    ctx.fillStyle = '#ff381e';
    ctx.fillText(plutoText, startX, 0);

    // SIM in bold pure white
    ctx.fillStyle = '#ffffff';
    ctx.fillText(simText, startX + plutoW, 0);

    ctx.restore();
  };

  // Front branding
  drawBranding(1024, 256, false);
  // Back branding (mirrored so it reads left-to-right when viewed from reverse direction)
  drawBranding(1024, 768, true);

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
  radGrad.addColorStop(0.7, 'rgba(25, 220, 90, 0.28)');
  radGrad.addColorStop(1, 'rgba(15, 180, 70, 0.12)');
  ctx.fillStyle = radGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Fine horizontal scanlines
  ctx.strokeStyle = 'rgba(90, 255, 150, 0.38)';
  ctx.lineWidth = 1.5;
  for (let y = 14; y < 512; y += 14) {
    ctx.beginPath();
    ctx.moveTo(10, y);
    ctx.lineTo(502, y);
    ctx.stroke();
  }

  // Center flight trajectory guide arc (amber curved arc from reference screenshot)
  ctx.strokeStyle = '#ff9900';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(256, 230, 80, Math.PI * 0.2, Math.PI * 0.8, false);
  ctx.stroke();

  // Subtle outer glow around the trajectory arc
  ctx.strokeStyle = 'rgba(255, 170, 0, 0.4)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(256, 230, 80, Math.PI * 0.2, Math.PI * 0.8, false);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Creates custom arch curtain geometry that fits inside the arch opening.
 */
function createCurtainGeometry(curve: THREE.CatmullRomCurve3, radius: number): THREE.BufferGeometry {
  const innerPoints: THREE.Vector3[] = [];
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).normalize();
    const inward = new THREE.Vector3(t.y, -t.x, 0).normalize();
    const innerP = new THREE.Vector3().copy(p).addScaledVector(inward, radius);
    innerPoints.push(innerP);
  }

  const shape = new THREE.Shape();
  shape.moveTo(innerPoints[0].x, 0.02);
  for (let i = 0; i < innerPoints.length; i++) {
    shape.lineTo(innerPoints[i].x, Math.max(0.02, innerPoints[i].y));
  }
  shape.lineTo(innerPoints[0].x, 0.02);
  shape.closePath();

  const geom = new THREE.ShapeGeometry(shape);

  // Set normalized UVs
  geom.computeBoundingBox();
  const min = geom.boundingBox?.min || new THREE.Vector3(-1.9, 0, 0);
  const max = geom.boundingBox?.max || new THREE.Vector3(1.9, 3.0, 0);
  const pos = geom.attributes.position;
  const uvs = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uvs[i * 2] = (x - min.x) / (max.x - min.x);
    uvs[i * 2 + 1] = (y - min.y) / (max.y - min.y);
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geom;
}

/**
 * PlutoSim Continuous Inflatable FPV Drone Racing Arch Gate.
 */
export function InflatableGate({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  showCurtain = true,
}: InflatableGateProps) {
  const curve = useMemo(() => createArchCurve(), []);
  const tubeGeom = useMemo(
    () => createSeamlessTubeGeometry(curve, ARCH_TUBE_RADIUS),
    [curve],
  );
  const curtainGeom = useMemo(
    () => createCurtainGeometry(curve, ARCH_TUBE_RADIUS),
    [curve],
  );

  const archTex = useMemo(() => createArchTexture(), []);
  const curtainTex = useMemo(() => createCurtainTexture(), []);

  // Inflatable vinyl material with realistic sheen
  const archMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: archTex,
        roughness: 0.36,
        metalness: 0.06,
      }),
    [archTex],
  );

  const curtainMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: curtainTex,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [curtainTex],
  );

  // Subtle breathing pulse on the laser curtain
  const curtainRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (curtainRef.current) {
      const t = clock.getElapsedTime();
      const pulse = 0.36 + Math.sin(t * 3.2) * 0.08;
      (curtainRef.current.material as THREE.MeshBasicMaterial).opacity = pulse;
    }
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* ----------------- Continuous Seamless Arch Mesh ----------------- */}
      <mesh geometry={tubeGeom} material={archMat} castShadow receiveShadow />

      {/* Closed Bottom End Caps */}
      <mesh position={[-ARCH_COL_X, 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[ARCH_TUBE_RADIUS, 24]} />
        <meshStandardMaterial color="#111316" roughness={0.8} />
      </mesh>
      <mesh position={[ARCH_COL_X, 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[ARCH_TUBE_RADIUS, 24]} />
        <meshStandardMaterial color="#111316" roughness={0.8} />
      </mesh>

      {/* Weighted Black Stabilizer Foot Pads */}
      <mesh position={[-ARCH_COL_X, 0.03, 0]} receiveShadow>
        <cylinderGeometry args={[0.52, 0.58, 0.06, 24]} />
        <meshStandardMaterial color="#0c0e10" roughness={0.92} />
      </mesh>
      <mesh position={[ARCH_COL_X, 0.03, 0]} receiveShadow>
        <cylinderGeometry args={[0.52, 0.58, 0.06, 24]} />
        <meshStandardMaterial color="#0c0e10" roughness={0.92} />
      </mesh>

      {/* Luminous Green Checkpoint Laser Curtain */}
      {showCurtain && (
        <mesh ref={curtainRef} geometry={curtainGeom} material={curtainMat} />
      )}

      {/* ----------------- Physical Colliders (RigidBody) ----------------- */}
      <RigidBody type="fixed" colliders={false}>
        {/* Left Column Collider */}
        <CuboidCollider
          args={[ARCH_TUBE_RADIUS, 1.0, ARCH_TUBE_RADIUS]}
          position={[-ARCH_COL_X, 1.0, 0]}
        />
        {/* Right Column Collider */}
        <CuboidCollider
          args={[ARCH_TUBE_RADIUS, 1.0, ARCH_TUBE_RADIUS]}
          position={[ARCH_COL_X, 1.0, 0]}
        />
        {/* Top Crossbar Collider */}
        <CuboidCollider
          args={[ARCH_COL_X * 0.9, ARCH_TUBE_RADIUS, ARCH_TUBE_RADIUS]}
          position={[0, ARCH_TOP_Y, 0]}
        />
        {/* Left Base Foot Pad Collider */}
        <CuboidCollider args={[0.52, 0.03, 0.52]} position={[-ARCH_COL_X, 0.03, 0]} />
        {/* Right Base Foot Pad Collider */}
        <CuboidCollider args={[0.52, 0.03, 0.52]} position={[ARCH_COL_X, 0.03, 0]} />
      </RigidBody>
    </group>
  );
}

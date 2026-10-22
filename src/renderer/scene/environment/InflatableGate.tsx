import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { dronePose } from '../../sim/drone/pose';
import { playCollect } from '../../audio/sfx';

// PlutoSim inflatable FPV racing arch, built after the classic "SkyDive" style
// air gate: one inflated tube — a rounded square in section, so its front is
// flat enough to carry the lettering — bent into a chamfered arch on straight
// legs that swell a little at the ground, shattered-glass print over the shoulders and legs,
// red chevrons at each foot, the branding across the top and a green curtain
// filling the hole.
//
// The tube is swept along a planar centreline, so it never twists: around the
// tube, angle 0 points away from the opening, a quarter turn faces the front
// (+z) and three quarters the back. Its texture is laid out the same way — u
// runs along the tube from the left foot to the right, v runs once around it.
// The skin pinches in a little at each bend, where a real one is stitched.
//
// Geometry, textures and materials are built once and shared by every gate.
//
// Fly through the opening and the checkpoint chime plays and the curtain fades
// away; it comes back when the drone is reset (R), so the gate can be flown again.

/** Centreline, left foot to right foot, in metres. */
const CENTRE: [number, number][] = [
  [-2.3, -0.1], // foot, just into the ground
  [-2.3, 2.4], // top of leg
  [-1.7, 3.05], // start of crossbar
  [1.7, 3.05],
  [2.3, 2.4],
  [2.3, -0.1],
];
const BEND_RADIUS = 0.22; // short, tight chamfers, as on the reference
const TUBE_R = 0.38;
const FOOT_R = 0.45; // legs swell to this at the ground
const SQUARENESS = 3.2; // superellipse power: 2 is a circle, higher is boxier
const SEAM_PINCH = 0.05;

const TUBE_SEGMENTS = 220;
const RADIAL_SEGMENTS = 40;

const TEX_W = 4096;
const TEX_H = 1024;

function seeded(seed: number) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

/** The centreline with each corner rounded off, plus where each bend sits along it (0..1). */
function centreline() {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const v = CENTRE.map(([x, y]) => new THREE.Vector3(x, y, 0));
  let from = v[0];
  for (let i = 1; i < v.length - 1; i++) {
    const r = Math.min(BEND_RADIUS, v[i].distanceTo(v[i - 1]) / 2, v[i].distanceTo(v[i + 1]) / 2);
    const a = v[i].clone().add(v[i - 1].clone().sub(v[i]).setLength(r));
    const b = v[i].clone().add(v[i + 1].clone().sub(v[i]).setLength(r));
    path.add(new THREE.LineCurve3(from, a));
    path.add(new THREE.QuadraticBezierCurve3(a, v[i], b));
    from = b;
  }
  path.add(new THREE.LineCurve3(from, v[v.length - 1]));

  const lengths = path.getCurveLengths();
  const total = path.getLength();
  // Bends are the odd curves; take the middle of each.
  const bends: number[] = [];
  for (let i = 1; i < path.curves.length; i += 2) {
    bends.push((lengths[i - 1] + lengths[i]) / 2 / total);
  }
  const leg = path.curves[0] as THREE.LineCurve3;
  return { path, total, bends, leg };
}

const CL = centreline();

/** Tube radius at a point along the centreline. */
function radiusAt(u: number, y: number) {
  const swell = Math.pow(THREE.MathUtils.clamp(1 - y / 1.2, 0, 1), 1.8);
  let r = TUBE_R + (FOOT_R - TUBE_R) * swell;
  for (const b of CL.bends) {
    const d = ((u - b) * CL.total) / 0.14;
    r *= 1 - SEAM_PINCH * Math.exp(-d * d);
  }
  return r;
}

function tubeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const z = new THREE.Vector3(0, 0, 1);

  for (let i = 0; i <= TUBE_SEGMENTS; i++) {
    const u = i / TUBE_SEGMENTS;
    const p = CL.path.getPointAt(u);
    const t = CL.path.getTangentAt(u);
    const n = new THREE.Vector3(-t.y, t.x, 0).normalize(); // away from the opening
    const r = radiusAt(u, p.y);
    for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
      const v = j / RADIAL_SEGMENTS;
      const phi = v * Math.PI * 2;
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const e = 2 / SQUARENESS;
      const dir = n
        .clone()
        .multiplyScalar(Math.sign(c) * Math.pow(Math.abs(c), e))
        .addScaledVector(z, Math.sign(sn) * Math.pow(Math.abs(sn), e));
      positions.push(p.x + dir.x * r, p.y + dir.y * r, dir.z * r);
      uvs.push(u, v);
    }
  }
  const row = RADIAL_SEGMENTS + 1;
  for (let i = 0; i < TUBE_SEGMENTS; i++) {
    for (let j = 0; j < RADIAL_SEGMENTS; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals(); // picks up the swell and the seam pinches
  return geom;
}

/** Texture (u, v) to canvas pixels. Canvas y runs opposite to v. */
const tx = (u: number, v: number) => [u * TEX_W, (1 - v) * TEX_H] as const;

/** u at a given height up the left leg (the right leg is 1 - u). */
function legU(y: number) {
  const { v1, v2 } = CL.leg;
  return ((y - v1.y) / (v2.y - v1.y)) * (CL.leg.getLength() / CL.total);
}

const VINYL_BLACK = '#0d0e10';
const LEG_GREY_TOP = '#4a4e55';
const LEG_GREY_FOOT = '#62666d';
const SHATTER_Y = 1.75; // where the black breaks up, metres up the leg

/** Pixels per metre along the tube, and around it (the section is a squircle, a bit over a circle). */
const ALONG_PX = () => TEX_W / CL.total;
const AROUND_PX = TEX_H / (2 * Math.PI * TUBE_R * 1.07);

/** A sharp shard: a long tip one way, a short broken base the other. */
function shard(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  len: number,
  width: number,
  angle: number,
  skew: number,
) {
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const pt = (along: number, across: number) =>
    [cx + c * along - sn * across, cy + sn * along + c * across] as const;
  ctx.beginPath();
  ctx.moveTo(...pt(len, 0));
  ctx.lineTo(...pt(-len * 0.35, width * (0.6 + skew * 0.4)));
  ctx.lineTo(...pt(-len * 0.2 * skew, 0));
  ctx.lineTo(...pt(-len * 0.4, -width * (0.6 + (1 - skew) * 0.4)));
  ctx.closePath();
  ctx.fill();
}

/**
 * The left leg's shatter print, drawn in canvas space with the leg running up
 * +x. Black from the shoulders down to a torn edge at SHATTER_Y, where it breaks
 * into shards that thin out and shrink as they fall over the grey below; the
 * black itself carries a few dark-grey cracks. Called again mirrored for the
 * right leg, so both sides match.
 */
function drawShatter(ctx: CanvasRenderingContext2D) {
  const rand = seeded(4211);
  const along = ALONG_PX();
  const edgeX = legU(SHATTER_Y) * TEX_W;
  const blackEnd = 0.5 * TEX_W; // the crossbar is solid black anyway

  // Solid black above the torn edge.
  ctx.fillStyle = VINYL_BLACK;
  ctx.fillRect(edgeX, 0, blackEnd - edgeX, TEX_H);

  // The torn edge: black teeth hanging down over the grey, all the way round.
  let y = -20;
  while (y < TEX_H + 20) {
    const w = (0.05 + rand() * 0.14) * AROUND_PX;
    const len = (0.1 + Math.pow(rand(), 1.5) * 0.6) * along;
    ctx.beginPath();
    ctx.moveTo(edgeX + 2, y);
    ctx.lineTo(edgeX - len, y + w * (0.3 + rand() * 0.4));
    ctx.lineTo(edgeX + 2, y + w);
    ctx.closePath();
    ctx.fill();
    y += w * (0.55 + rand() * 0.3);
  }

  // Broken-off shards falling away below the edge: big and dense near it,
  // smaller and sparser further down.
  for (let i = 0; i < 170; i++) {
    const t = Math.pow(rand(), 1.7); // 0 at the edge, 1 far below it
    const drop = (0.05 + t * 0.95) * along;
    const size = (0.26 - t * 0.17) * (0.6 + rand() * 0.8);
    const v = rand();
    ctx.fillStyle = rand() < 0.85 ? VINYL_BLACK : '#22252a';
    for (const wrap of [-TEX_H, 0, TEX_H]) {
      shard(
        ctx,
        edgeX - drop,
        v * TEX_H + wrap,
        size * along,
        size * 0.45 * AROUND_PX,
        Math.PI + (rand() - 0.5) * 2.2, // mostly pointing down the leg
        rand(),
      );
    }
  }

  // Cracks in the black: dark-grey slivers up the leg and over the shoulder.
  const shoulderEnd = (CL.bends[1] + 0.02) * TEX_W;
  for (let i = 0; i < 90; i++) {
    const x = edgeX + 0.15 * along + rand() * (shoulderEnd - edgeX - 0.15 * along);
    const v = rand();
    const size = 0.05 + rand() * 0.12;
    ctx.fillStyle = ['#262a30', '#30343b', '#3b4048'][Math.floor(rand() * 3)];
    for (const wrap of [-TEX_H, 0, TEX_H]) {
      shard(ctx, x, v * TEX_H + wrap, size * along, size * 0.4 * AROUND_PX, rand() * Math.PI * 2, rand());
    }
  }
}

/** Red chevrons pointing up each leg, front and back. */
function drawChevrons(ctx: CanvasRenderingContext2D) {
  const pxPerM = TEX_W / CL.total;
  const base = legU(0.02);
  const tall = 0.4 * pxPerM;
  const half = 0.06 * TEX_H; // across the tube
  for (const left of [true, false]) {
    for (const v of [0.25, 0.75]) {
      const [bx, cy] = tx(left ? base : 1 - base, v);
      const tip = bx + (left ? tall : -tall);
      ctx.fillStyle = '#e8261c';
      ctx.beginPath();
      ctx.moveTo(bx, cy - half);
      ctx.lineTo(tip, cy);
      ctx.lineTo(bx, cy + half);
      ctx.closePath();
      ctx.fill();
      // A darker facet so it reads as a folded chevron, not a flat sticker.
      ctx.fillStyle = '#a3140e';
      ctx.beginPath();
      ctx.moveTo(tip, cy);
      ctx.lineTo(bx, cy + half);
      ctx.lineTo(bx + (tip - bx) * 0.2, cy + half);
      ctx.closePath();
      ctx.fill();
    }
  }
}

const brandFont = (sizePx: number) =>
  `italic 900 ${Math.round(sizePx)}px "Arial Black", "Helvetica Neue", Impact, sans-serif`;
const BRAND_MAX_W = 2.6; // metres along the crossbar and a little of each shoulder
const BRAND_H = 0.32; // metres around the tube

/** "PLUTO" in racing red, "SIM" in white, centred on (0, 0). */
function drawBrand(ctx: CanvasRenderingContext2D) {
  const alongPxPerM = TEX_W / CL.total;
  const aroundPxPerM = TEX_H / (2 * Math.PI * TUBE_R);
  const red = 'PLUTO';
  const white = 'SIM';
  ctx.save();
  ctx.textBaseline = 'middle';

  // u and v pixels are not the same size: set the type by its height around the
  // tube, then scale it along the tube to true proportions, or less if it is too wide.
  const size = BRAND_H * aroundPxPerM * 1.35;
  ctx.font = brandFont(size);
  const gap = size * 0.1;
  const redW = ctx.measureText(red).width;
  const whiteW = ctx.measureText(white).width;
  const total = redW + gap + whiteW;
  const aspect = alongPxPerM / aroundPxPerM;
  ctx.scale(Math.min(aspect, (BRAND_MAX_W * alongPxPerM) / total), 1);
  let x = -total / 2;

  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.07;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(red, x, 0);
  ctx.fillStyle = '#ef2a1f';
  ctx.fillText(red, x, 0);
  x += redW + gap;
  ctx.strokeText(white, x, 0);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillText(white, x, 0);
  ctx.restore();
}

function paintTube(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;

  // Grey lower legs, darkening a little towards the shatter line.
  const grad = ctx.createLinearGradient(0, 0, TEX_W, 0);
  const foot = legU(0);
  const edge = legU(SHATTER_Y);
  grad.addColorStop(foot, LEG_GREY_FOOT);
  grad.addColorStop(edge, LEG_GREY_TOP);
  grad.addColorStop(1 - edge, LEG_GREY_TOP);
  grad.addColorStop(1 - foot, LEG_GREY_FOOT);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  drawShatter(ctx);
  ctx.save();
  ctx.translate(TEX_W, 0);
  ctx.scale(-1, 1);
  drawShatter(ctx);
  ctx.restore();

  drawChevrons(ctx);

  // Front face: going up v walks from the top of the tube down its face, so the
  // canvas is flipped vertically there. Back face: seen from behind, flip across.
  const [fx, fy] = tx(0.5, 0.25);
  ctx.save();
  ctx.translate(fx, fy);
  ctx.scale(1, -1);
  drawBrand(ctx);
  ctx.restore();
  const [bx, by] = tx(0.5, 0.75);
  ctx.save();
  ctx.translate(bx, by);
  ctx.scale(-1, 1);
  drawBrand(ctx);
  ctx.restore();
}

/** The opening: the centreline pulled in to inside the tube wall. */
function curtainGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 80; i++) {
    const u = i / 80;
    const p = CL.path.getPointAt(u);
    const t = CL.path.getTangentAt(u);
    const r = radiusAt(u, p.y) * 0.6;
    pts.push(new THREE.Vector2(p.x + t.y * r, Math.max(0.01, p.y - t.x * r)));
  }
  return new THREE.ShapeGeometry(new THREE.Shape(pts));
}

type GateAssets = {
  tube: THREE.BufferGeometry;
  tubeMat: THREE.MeshStandardMaterial;
  curtain: THREE.BufferGeometry;
  curtainMat: THREE.MeshBasicMaterial;
};
let assets: GateAssets | null = null;

function gateAssets(): GateAssets {
  if (assets) return assets;
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  paintTube(canvas);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;

  assets = {
    tube: tubeGeometry(),
    tubeMat: new THREE.MeshStandardMaterial({ map, roughness: 0.42, metalness: 0.05 }),
    curtain: curtainGeometry(),
    curtainMat: new THREE.MeshBasicMaterial({
      color: '#48c816', // one flat green, no texture
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  };
  return assets;
}

/** Collision boxes along each straight run of the centreline. */
const SEGMENTS = (() => {
  const runs: { pos: [number, number, number]; half: number; r: number; angle: number }[] = [];
  for (let i = 0; i < CENTRE.length - 1; i++) {
    const [ax, ay] = CENTRE[i];
    const [bx, by] = CENTRE[i + 1];
    const legRun = i === 0 || i === CENTRE.length - 2;
    runs.push({
      pos: [(ax + bx) / 2, (ay + by) / 2, 0],
      half: Math.hypot(bx - ax, by - ay) / 2,
      r: legRun ? (TUBE_R + FOOT_R) / 2 : TUBE_R,
      angle: Math.atan2(by - ay, bx - ax),
    });
  }
  return runs;
})();

/** The clear opening, in gate space: inside the legs and under the crossbar. */
const OPENING_HALF_W = Math.abs(CENTRE[1][0]) - TUBE_R;
const OPENING_TOP = CENTRE[2][1] - TUBE_R;
const CURTAIN_OPACITY = 0.68;
const FADE_SECONDS = 0.35;

interface InflatableGateProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  showCurtain?: boolean;
}

export function InflatableGate({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  showCurtain = true,
}: InflatableGateProps) {
  const { tube, tubeMat, curtain, curtainMat } = gateAssets();
  // Each gate fades its own curtain, so it gets its own copy of the material.
  const ownCurtainMat = useMemo(() => curtainMat.clone(), [curtainMat]);
  useEffect(() => () => ownCurtainMat.dispose(), [ownCurtainMat]);

  const groupRef = useRef<THREE.Group>(null);
  const curtainRef = useRef<THREE.Mesh>(null);
  const gate = useRef({
    passed: false,
    fade: 1, // 1 shown, 0 gone
    side: 0, // which side of the gate plane the drone was on last frame
    resetVersion: dronePose.resetVersion,
    local: new THREE.Vector3(),
  });

  useFrame(({ clock }, delta) => {
    const g = gate.current;
    if (dronePose.resetVersion !== g.resetVersion) {
      g.resetVersion = dronePose.resetVersion;
      g.passed = false;
      g.fade = 1;
      g.side = 0;
    }

    // Passed = crossed the gate plane (local z = 0) inside the opening.
    if (!g.passed && dronePose.present && groupRef.current) {
      const p = groupRef.current.worldToLocal(g.local.copy(dronePose.position));
      const side = Math.sign(p.z);
      const inOpening = Math.abs(p.x) < OPENING_HALF_W && p.y > 0 && p.y < OPENING_TOP;
      if (g.side !== 0 && side !== 0 && side !== g.side && inOpening) {
        g.passed = true;
        playCollect();
      }
      if (side !== 0) g.side = side;
    }

    if (g.passed && g.fade > 0) g.fade = Math.max(0, g.fade - delta / FADE_SECONDS);
    const pulse = CURTAIN_OPACITY + Math.sin(clock.getElapsedTime() * 2.4) * 0.05;
    ownCurtainMat.opacity = pulse * g.fade;
    if (curtainRef.current) curtainRef.current.visible = g.fade > 0;
  });

  return (
    <group ref={groupRef} position={position} rotation={rotation} scale={scale}>
      <mesh geometry={tube} material={tubeMat} castShadow receiveShadow />
      {showCurtain && (
        <mesh ref={curtainRef} geometry={curtain} material={ownCurtainMat} renderOrder={1} />
      )}

      <RigidBody type="fixed" colliders={false}>
        {SEGMENTS.map((s, i) => (
          <CuboidCollider
            key={i}
            args={[s.half, s.r, s.r]}
            position={s.pos}
            rotation={[0, 0, s.angle]}
          />
        ))}
      </RigidBody>
    </group>
  );
}

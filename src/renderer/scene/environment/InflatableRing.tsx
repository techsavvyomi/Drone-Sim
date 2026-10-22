import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { dronePose } from '../../sim/drone/pose';
import { playCollect } from '../../audio/sfx';

// PlutoSim inflatable race ring, the round partner of `InflatableGate`: the same
// vinyl tube — black over the top breaking up into shards over grey below, red
// chevrons, "PLUTO SIM" front and back — bent into a full circle floating in the
// air, with the same green curtain in the hole. No pole under it: the user wanted
// it free in the air (2026-10-21).
//
// The ring stands in its own x-y plane, so like the gate it is flown through
// along local z. Its origin is the ground under it; `height` is the centre of
// the ring above that.
//
// Torus texture layout (three's TorusGeometry): u runs once round the ring
// starting at +x and going over the top, v once round the tube starting at the
// outside, so v = 0.25 is the front face (+z) and 0.75 the back.
//
// Fly through and the checkpoint chime plays and the curtain fades; it comes
// back on reset (R).

const RING_R = 2.1; // centreline radius
const TUBE_R = 0.38; // as the gate

const TEX_W = 2048;
const TEX_H = 512;

const VINYL_BLACK = '#0d0e10';
const GREY_TOP = '#4a4e55';
const GREY_BOTTOM = '#62666d';
/** Black covers the ring from this far below the sides, as a fraction of a turn. */
const BLACK_OVERLAP = 0.06;

const CURTAIN_OPACITY = 0.68;
const FADE_SECONDS = 0.35;
const OPENING_R = RING_R - TUBE_R;

function seeded(seed: number) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

/** Texture (u, v) to canvas pixels. Canvas y runs opposite to v. */
const tx = (u: number, v: number) => [u * TEX_W, (1 - v) * TEX_H] as const;

const ALONG_PX = TEX_W / (2 * Math.PI * RING_R);
const AROUND_PX = TEX_H / (2 * Math.PI * TUBE_R);

/** The black top half, torn into shards where it meets the grey, both sides. */
function drawShatter(ctx: CanvasRenderingContext2D) {
  const rand = seeded(7331);
  const start = -BLACK_OVERLAP * TEX_W; // just under the right side
  const end = (0.5 + BLACK_OVERLAP) * TEX_W; // just under the left side
  ctx.fillStyle = VINYL_BLACK;
  ctx.fillRect(start, 0, end - start, TEX_H);
  ctx.fillRect(TEX_W + start, 0, -start, TEX_H); // the part past the seam

  // Each torn edge: teeth hanging down over the grey, then loose shards.
  for (const [edge, dir] of [
    [start, -1],
    [end, 1],
  ] as const) {
    let y = -10;
    while (y < TEX_H + 10) {
      const w = (0.05 + rand() * 0.14) * AROUND_PX;
      const len = (0.1 + Math.pow(rand(), 1.5) * 0.5) * ALONG_PX;
      for (const wrap of [0, TEX_W]) {
        const x = edge + wrap;
        ctx.beginPath();
        ctx.moveTo(x - dir * 2, y);
        ctx.lineTo(x + dir * len, y + w * (0.3 + rand() * 0.4));
        ctx.lineTo(x - dir * 2, y + w);
        ctx.closePath();
        ctx.fill();
      }
      y += w * (0.55 + rand() * 0.3);
    }
    for (let i = 0; i < 70; i++) {
      const t = Math.pow(rand(), 1.7);
      const drop = (0.05 + t * 0.8) * ALONG_PX;
      const size = (0.22 - t * 0.14) * (0.6 + rand() * 0.8);
      const v = rand();
      const along = size * ALONG_PX;
      const across = size * 0.45 * AROUND_PX;
      const angle = (dir > 0 ? 0 : Math.PI) + (rand() - 0.5) * 2.2;
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      ctx.fillStyle = rand() < 0.85 ? VINYL_BLACK : '#22252a';
      for (const wrapX of [0, TEX_W]) {
        for (const wrapY of [-TEX_H, 0, TEX_H]) {
          const cx = edge + dir * drop + wrapX;
          const cy = v * TEX_H + wrapY;
          const pt = (a: number, b: number) => [cx + c * a - sn * b, cy + sn * a + c * b] as const;
          ctx.beginPath();
          ctx.moveTo(...pt(along, 0));
          ctx.lineTo(...pt(-along * 0.35, across));
          ctx.lineTo(...pt(-along * 0.4, -across));
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }
}

/** Red chevrons low on each side, pointing up the ring, front and back. */
function drawChevrons(ctx: CanvasRenderingContext2D) {
  const tall = 0.4 * ALONG_PX;
  const half = 0.06 * TEX_H;
  // u grows over the top from the right, so up the right side is +u and up the left -u.
  for (const [u, dir] of [
    [0.9, 1],
    [0.6, -1],
  ] as const) {
    for (const v of [0.25, 0.75]) {
      const [bx, cy] = tx(u, v);
      const tip = bx + dir * tall;
      ctx.fillStyle = '#e8261c';
      ctx.beginPath();
      ctx.moveTo(bx, cy - half);
      ctx.lineTo(tip, cy);
      ctx.lineTo(bx, cy + half);
      ctx.closePath();
      ctx.fill();
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
const BRAND_MAX_W = 2.4; // metres round the top of the ring
const BRAND_H = 0.32; // metres around the tube

/** "PLUTO" in racing red, "SIM" in white, centred on (0, 0). */
function drawBrand(ctx: CanvasRenderingContext2D) {
  const red = 'PLUTO';
  const white = 'SIM';
  ctx.save();
  ctx.textBaseline = 'middle';
  const size = BRAND_H * AROUND_PX * 1.35;
  ctx.font = brandFont(size);
  const gap = size * 0.1;
  const redW = ctx.measureText(red).width;
  const whiteW = ctx.measureText(white).width;
  const total = redW + gap + whiteW;
  ctx.scale(Math.min(ALONG_PX / AROUND_PX, (BRAND_MAX_W * ALONG_PX) / total), 1);
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

function paintRing(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;

  // Grey underneath, lightest at the very bottom (u 0.75).
  const grad = ctx.createLinearGradient(0.5 * TEX_W, 0, TEX_W, 0);
  grad.addColorStop(0, GREY_TOP);
  grad.addColorStop(0.5, GREY_BOTTOM);
  grad.addColorStop(1, GREY_TOP);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  drawShatter(ctx);
  drawChevrons(ctx);

  // Over the top u runs right to left as seen from the front, and v runs down
  // the front face: flipped both ways there. On the back both already read right.
  const [fx, fy] = tx(0.25, 0.25);
  ctx.save();
  ctx.translate(fx, fy);
  ctx.scale(-1, -1);
  drawBrand(ctx);
  ctx.restore();
  const [bx, by] = tx(0.25, 0.75);
  ctx.save();
  ctx.translate(bx, by);
  drawBrand(ctx);
  ctx.restore();
}

type RingAssets = {
  tube: THREE.BufferGeometry;
  tubeMat: THREE.MeshStandardMaterial;
  curtain: THREE.BufferGeometry;
  curtainMat: THREE.MeshBasicMaterial;
};
let assets: RingAssets | null = null;

function ringAssets(): RingAssets {
  if (assets) return assets;
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  paintRing(canvas);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;

  assets = {
    tube: new THREE.TorusGeometry(RING_R, TUBE_R, 32, 160),
    tubeMat: new THREE.MeshStandardMaterial({ map, roughness: 0.42, metalness: 0.05 }),
    curtain: new THREE.CircleGeometry(RING_R - TUBE_R * 0.6, 64),
    curtainMat: new THREE.MeshBasicMaterial({
      color: '#48c816', // the gate's green
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  };
  return assets;
}

/**
 * Collision boxes round the tube: one chord per segment, a little fatter than
 * the tube itself. The drone is drawn bigger than its physics body outdoors
 * (DroneSpec.sizeScale is render-only — the Guru draws at 2.5×), so a box the
 * tube's own size let the drawn props sink into the vinyl before the body
 * touched it, and the drone looked to fly straight through the ring (user,
 * 2026-10-21). The margin is about what the drawn props stick out past the
 * physical ones; the hole the curtain judges stays the visible one.
 */
const COLLIDER_MARGIN = 0.2;
const RING_SEGMENTS = 32;
const SEGMENTS = Array.from({ length: RING_SEGMENTS }, (_, i) => {
  const a = ((i + 0.5) / RING_SEGMENTS) * Math.PI * 2;
  return {
    pos: [Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0] as [number, number, number],
    angle: a + Math.PI / 2,
  };
});
const SEGMENT_HALF = RING_R * Math.sin(Math.PI / RING_SEGMENTS) + 0.04;

interface InflatableRingProps {
  /** The ground under the ring. */
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Height of the ring's centre above the ground, metres. */
  height?: number;
}

export function InflatableRing({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  height = 6,
}: InflatableRingProps) {
  const { tube, tubeMat, curtain, curtainMat } = ringAssets();
  const ownCurtainMat = useMemo(() => curtainMat.clone(), [curtainMat]);
  useEffect(() => () => ownCurtainMat.dispose(), [ownCurtainMat]);

  const ringRef = useRef<THREE.Group>(null);
  const curtainRef = useRef<THREE.Mesh>(null);
  const ring = useRef({
    passed: false,
    fade: 1,
    side: 0,
    resetVersion: dronePose.resetVersion,
    local: new THREE.Vector3(),
  });

  useFrame(({ clock }, delta) => {
    const g = ring.current;
    if (dronePose.resetVersion !== g.resetVersion) {
      g.resetVersion = dronePose.resetVersion;
      g.passed = false;
      g.fade = 1;
      g.side = 0;
    }

    // Passed = crossed the ring plane (local z = 0) inside the opening.
    if (!g.passed && dronePose.present && ringRef.current) {
      const p = ringRef.current.worldToLocal(g.local.copy(dronePose.position));
      const side = Math.sign(p.z);
      const inOpening = Math.hypot(p.x, p.y) < OPENING_R;
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
    <group position={position} rotation={rotation}>
      <group ref={ringRef} position={[0, height, 0]}>
        <mesh geometry={tube} material={tubeMat} castShadow receiveShadow />
        <mesh ref={curtainRef} geometry={curtain} material={ownCurtainMat} renderOrder={1} />
      </group>

      <RigidBody type="fixed" colliders={false}>
        {SEGMENTS.map((s, i) => (
          <CuboidCollider
            key={i}
            args={[SEGMENT_HALF, TUBE_R + COLLIDER_MARGIN, TUBE_R + COLLIDER_MARGIN]}
            position={[s.pos[0], s.pos[1] + height, s.pos[2]]}
            rotation={[0, 0, s.angle]}
          />
        ))}
      </RigidBody>
    </group>
  );
}

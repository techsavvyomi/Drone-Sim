import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import { useMissionStore } from '../state/missionStore';

// ----------------------------------------------------------------------------
// Hyper-Realistic Pressurized Fire Suppression Deluge & Water Plume
//
// 1. Direct Nozzle Origin: Streams shoot directly from the black discharge
//    nozzle of the retardant cylinder slung under the drone belly.
// 2. High-Pressure Dense Core Jet: High-velocity pure white core filaments
//    stretching with speed straight down from the nozzle.
// 3. Braided Outer Water Deluge: Semi-transparent fluid ribbons fanning out
//    naturally with aerodynamic shear and gravity acceleration.
// 4. Fine Airborne Droplet Shower: Micro-spray needles scattering in the downwash.
// 5. Impact Water Foam & Splashes: Foaming water dispersion striking the ground.
// ----------------------------------------------------------------------------

const CORE_STREAMS = 32;
const OUTER_STREAMS = 36;
const DROPLET_NEEDLES = 32;
const IMPACT_SPLASHES = 20;

const REACH = 15.2;
const CORE_LIFE = 0.32;
const OUTER_LIFE = 0.46;
const DROPLET_LIFE = 0.58;
const SPLASH_LIFE = 0.48;

const COLOR_CORE = '#ffffff';
const COLOR_STREAM = '#dcf4ff';
const COLOR_DROPLET = '#b8eaff';
const COLOR_SPLASH = '#c8f2ff';

/** Core high-pressure water jet needle texture */
let coreTex: THREE.CanvasTexture | null = null;
function getCoreTexture(): THREE.CanvasTexture {
  if (coreTex) return coreTex;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 16, 128);
    const g = ctx.createLinearGradient(8, 0, 8, 128);
    g.addColorStop(0, 'rgba(255, 255, 255, 0)');
    g.addColorStop(0.15, 'rgba(255, 255, 255, 0.7)');
    g.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.85, 'rgba(230, 250, 255, 0.7)');
    g.addColorStop(1, 'rgba(200, 240, 255, 0)');
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(11, 64);
    ctx.lineTo(8, 128);
    ctx.lineTo(5, 64);
    ctx.closePath();
    ctx.fill();
  }
  coreTex = new THREE.CanvasTexture(canvas);
  return coreTex;
}

/** Fluid water stream streak texture with fine longitudinal threads */
let streamTex: THREE.CanvasTexture | null = null;
function getStreamTexture(): THREE.CanvasTexture {
  if (streamTex) return streamTex;
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 24, 128);

    // Multiple thin vertical stream filaments
    for (let i = 0; i < 6; i++) {
      const x = 4 + i * 3.2;
      const g = ctx.createLinearGradient(x, 0, x, 128);
      g.addColorStop(0, 'rgba(255, 255, 255, 0)');
      g.addColorStop(0.2, 'rgba(220, 245, 255, 0.5)');
      g.addColorStop(0.6, 'rgba(255, 255, 255, 0.9)');
      g.addColorStop(0.85, 'rgba(200, 240, 255, 0.4)');
      g.addColorStop(1, 'rgba(180, 230, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 0.8, 0, 1.6, 128);
    }
  }
  streamTex = new THREE.CanvasTexture(canvas);
  return streamTex;
}

/** Micro droplet spray texture */
let dropletTex: THREE.CanvasTexture | null = null;
function getDropletTexture(): THREE.CanvasTexture {
  if (dropletTex) return dropletTex;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 32, 64);
    // Draw small cluster of fast-moving micro droplets
    let s = 98765;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    for (let i = 0; i < 12; i++) {
      const x = 6 + rnd() * 20;
      const y = 4 + rnd() * 48;
      const h = 4 + rnd() * 10;
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, 'rgba(255, 255, 255, 0)');
      g.addColorStop(0.5, 'rgba(235, 250, 255, 0.85)');
      g.addColorStop(1, 'rgba(200, 240, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 0.7, y, 1.4, h);
    }
  }
  dropletTex = new THREE.CanvasTexture(canvas);
  return dropletTex;
}

/** Ground impact foam texture */
let foamTex: THREE.CanvasTexture | null = null;
function getFoamTexture(): THREE.CanvasTexture {
  if (foamTex) return foamTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
    g.addColorStop(0.35, 'rgba(220, 245, 255, 0.4)');
    g.addColorStop(0.7, 'rgba(180, 235, 255, 0.12)');
    g.addColorStop(1, 'rgba(170, 230, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  foamTex = new THREE.CanvasTexture(canvas);
  return foamTex;
}

interface Spec {
  phase: number;
  angle: number;
  spread: number;
  length: number;
  width: number;
  speed: number;
  wobble: number;
}

function createSpecs(
  count: number,
  seed: number,
  spreadBase: number,
  lenBase: number,
  widthBase: number,
): Spec[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => ({
    phase: i / count + (rnd() - 0.5) * 0.02,
    angle: rnd() * Math.PI * 2,
    spread: spreadBase * (0.6 + rnd() * 0.8),
    length: lenBase * (0.75 + rnd() * 0.6),
    width: widthBase * (0.75 + rnd() * 0.5),
    speed: 0.9 + rnd() * 0.22,
    wobble: (rnd() - 0.5) * 2.0,
  }));
}

export function Spray() {
  const suppressing = useMissionStore((s) => s.suppressing);
  const rootGroup = useRef<THREE.Group>(null);
  const coreGroup = useRef<THREE.Group>(null);
  const outerGroup = useRef<THREE.Group>(null);
  const dropletsGroup = useRef<THREE.Group>(null);
  const splashesGroup = useRef<THREE.Group>(null);

  const streakGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    // Pivot at top-center: local Y extends strictly downwards [0 to -1]
    geo.translate(0, -0.5, 0);
    return geo;
  }, []);

  const splashGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const coreT = useMemo(() => getCoreTexture(), []);
  const streamT = useMemo(() => getStreamTexture(), []);
  const dropletT = useMemo(() => getDropletTexture(), []);
  const foamT = useMemo(() => getFoamTexture(), []);

  const coreSpecs = useMemo(() => createSpecs(CORE_STREAMS, 20260904, 0.35, 2.2, 0.045), []);
  const outerSpecs = useMemo(() => createSpecs(OUTER_STREAMS, 20260905, 0.95, 2.6, 0.075), []);
  const dropletSpecs = useMemo(() => createSpecs(DROPLET_NEEDLES, 20260906, 1.4, 1.5, 0.12), []);
  const splashSpecs = useMemo(() => createSpecs(IMPACT_SPLASHES, 20260907, 2.2, 0.9, 0.9), []);

  const on = useRef(0);
  const nozzlePos = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock, camera }, rawDt) => {
    const root = rootGroup.current;
    if (!root) return;

    const dt = Math.min(rawDt, 0.1);
    on.current += ((suppressing ? 1 : 0) - on.current) * Math.min(1, dt * 14);
    root.visible = on.current > 0.01 && dronePose.present;
    if (!root.visible) return;

    // Anchor precisely at the retardant cylinder bottom nozzle tip under drone belly
    nozzlePos.set(0, -0.28, 0);
    if (dronePose.present) {
      nozzlePos.applyQuaternion(dronePose.quaternion);
      nozzlePos.add(dronePose.position);
    }
    root.position.copy(nozzlePos);

    const t = clock.elapsedTime;
    const face = camera.quaternion;
    const power = on.current;

    // 1. High-Pressure Pure White Core Jet
    if (coreGroup.current) {
      coreGroup.current.children.forEach((child, i) => {
        const spec = coreSpecs[i];
        const age = (((t / (CORE_LIFE / spec.speed) + spec.phase) % 1) + 1) % 1;
        const mesh = child as THREE.Mesh;

        // Fast initial velocity + gravity acceleration downwards
        const fall = age * 11.0 + age * age * (REACH - 11.0);
        // Stays tight to nozzle tip at exit, spreading naturally downstream
        const r = 0.008 + Math.pow(age, 1.4) * spec.spread * 0.7;
        const x = Math.cos(spec.angle) * r;
        const z = Math.sin(spec.angle) * r;

        mesh.position.set(x, -fall, z);
        mesh.quaternion.copy(face);

        const sw = spec.width * (1 + age * 0.7);
        const sh = spec.length * (1 + age * 1.8);
        mesh.scale.set(sw, sh, sw);

        const mat = mesh.material as THREE.MeshBasicMaterial;
        // Clean fade in at nozzle exit, smooth fade out at tail
        const fadeIn = Math.min(1, age * 12);
        const fadeOut = Math.max(0, 1 - age * 0.9);
        mat.opacity = power * fadeIn * fadeOut * 0.95;
      });
    }

    // 2. Braided Outer Water Deluge
    if (outerGroup.current) {
      outerGroup.current.children.forEach((child, i) => {
        const spec = outerSpecs[i];
        const age = (((t / (OUTER_LIFE / spec.speed) + spec.phase) % 1) + 1) % 1;
        const mesh = child as THREE.Mesh;

        const fall = age * 8.5 + age * age * (REACH - 8.5);
        // Sinuous aerodynamic wave from downwash shear
        const wave = Math.sin(t * 12 + age * 7 + spec.wobble) * 0.09 * age;
        const r = 0.015 + Math.pow(age, 1.25) * spec.spread * 1.25;
        const x = Math.cos(spec.angle) * r + wave;
        const z = Math.sin(spec.angle) * r + wave;

        mesh.position.set(x, -fall, z);
        mesh.quaternion.copy(face);

        const sw = spec.width * (1 + age * 1.0);
        const sh = spec.length * (1 + age * 1.6);
        mesh.scale.set(sw, sh, sw);

        const mat = mesh.material as THREE.MeshBasicMaterial;
        const fadeIn = Math.min(1, age * 10);
        const fadeOut = Math.max(0, 1 - age * 0.95);
        mat.opacity = power * fadeIn * fadeOut * 0.85;
      });
    }

    // 3. Fine Airborne Droplet Shower ("Bauchaar")
    if (dropletsGroup.current) {
      dropletsGroup.current.children.forEach((child, i) => {
        const spec = dropletSpecs[i];
        const age = (((t / (DROPLET_LIFE / spec.speed) + spec.phase) % 1) + 1) % 1;
        const mesh = child as THREE.Mesh;

        const fall = age * 7.0 + age * age * (REACH - 7.5);
        const r = 0.025 + Math.pow(age, 1.15) * spec.spread * 1.7;
        const x = Math.cos(spec.angle + t * 0.8) * r;
        const z = Math.sin(spec.angle + t * 0.8) * r;

        mesh.position.set(x, -fall, z);
        mesh.quaternion.copy(face);

        const s = spec.width * (1 + age * 2.5);
        mesh.scale.set(s, s * 1.8, s);

        const mat = mesh.material as THREE.MeshBasicMaterial;
        const fadeIn = Math.min(1, age * 8);
        const fadeOut = Math.max(0, 1 - age * 0.9);
        mat.opacity = power * fadeIn * fadeOut * 0.5;
      });
    }

    // 4. Ground Impact Foam & Splashes
    if (splashesGroup.current) {
      splashesGroup.current.children.forEach((child, i) => {
        const spec = splashSpecs[i];
        const age = (((t / (SPLASH_LIFE / spec.speed) + spec.phase) % 1) + 1) % 1;
        const mesh = child as THREE.Mesh;

        const groundDist = REACH * 0.95;
        const r = 0.25 + age * spec.spread * 1.8;
        const x = Math.cos(spec.angle) * r;
        const z = Math.sin(spec.angle) * r;
        const lift = Math.sin(age * Math.PI * 0.5) * 0.8;

        mesh.position.set(x, -groundDist + lift, z);
        mesh.quaternion.copy(face);

        const s = spec.width * (1.0 + age * 2.8);
        mesh.scale.set(s, s * 0.7, s);

        const mat = mesh.material as THREE.MeshBasicMaterial;
        const alpha = (1 - age) * Math.sin(age * Math.PI);
        mat.opacity = power * alpha * 0.55;
      });
    }
  });

  return (
    <group ref={rootGroup} visible={false}>
      {/* 1. High-Pressure White Core Jet */}
      <group ref={coreGroup}>
        {coreSpecs.map((_s, i) => (
          <mesh key={i} geometry={streakGeometry}>
            <meshBasicMaterial
              map={coreT}
              color={COLOR_CORE}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* 2. Braided Outer Water Deluge */}
      <group ref={outerGroup}>
        {outerSpecs.map((_s, i) => (
          <mesh key={i} geometry={streakGeometry}>
            <meshBasicMaterial
              map={streamT}
              color={COLOR_STREAM}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* 3. Fine Droplet Shower */}
      <group ref={dropletsGroup}>
        {dropletSpecs.map((_s, i) => (
          <mesh key={i} geometry={streakGeometry}>
            <meshBasicMaterial
              map={dropletT}
              color={COLOR_DROPLET}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* 4. Ground Impact Foam Splashes */}
      <group ref={splashesGroup}>
        {splashSpecs.map((_s, i) => (
          <mesh key={i} geometry={splashGeometry}>
            <meshBasicMaterial
              map={foamT}
              color={COLOR_SPLASH}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}

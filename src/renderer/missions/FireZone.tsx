import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useMissionStore } from '../state/missionStore';
import { zoneGroundY, type Mission } from './types';

// ----------------------------------------------------------------------------
// Cinematic Realistic Wildfire Simulation
//
// 1. Clustered Hotspot Raging Flames: Dynamic licking flame tongues originating
//    from multiple burning fuel nodes across the fire zone.
// 2. Interactive Water Steam Bursts: Dense vapor clouds billowing violently
//    when the water suppressant impacts burning ground.
// 3. Swirling Fiery Embers: Sparks carried upward in a turbulent thermal vortex.
// 4. Heavy Volumetric Smoke Plumes: Massive multi-tone smoke rising past canopy.
// 5. Dual-Color Dynamic Fire Lighting: Blazing gold core + deep crimson perimeter.
// 6. Glowing Ember Ash Bed: Glowing coals cooling to charred black carbon.
// ----------------------------------------------------------------------------

const FLAME_COUNT = 48;
const EMBER_COUNT = 32;
const SMOKE_COUNT = 22;
const STEAM_COUNT = 20;

const FLAME_LIFE = 0.92;
const FLAME_RISE = 4.2;
const EMBER_LIFE = 1.9;
const EMBER_RISE = 9.5;
const SMOKE_LIFE = 5.6;
const SMOKE_RISE = 30;
const STEAM_LIFE = 1.2;

const COLOR_CORE = '#fffbe8';
const COLOR_HOT = '#ffba3b';
const COLOR_MID = '#ff6a00';
const COLOR_TIP = '#e61e00';
const COLOR_EMBER = '#ffc83b';
const COLOR_SMOKE = '#2e2620';
const COLOR_STEAM = '#f2f8fc';

let flameTex: THREE.CanvasTexture | null = null;
function getFlameTexture(): THREE.CanvasTexture {
  if (flameTex) return flameTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(32, 128, 32, 0);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.2, 'rgba(255, 230, 110, 0.98)');
    g.addColorStop(0.55, 'rgba(255, 105, 15, 0.8)');
    g.addColorStop(0.85, 'rgba(230, 35, 0, 0.4)');
    g.addColorStop(1, 'rgba(140, 0, 0, 0)');
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(32, 0);
    ctx.bezierCurveTo(2, 45, 0, 105, 32, 128);
    ctx.bezierCurveTo(64, 105, 62, 45, 32, 0);
    ctx.fill();
  }
  flameTex = new THREE.CanvasTexture(canvas);
  return flameTex;
}

let emberTex: THREE.CanvasTexture | null = null;
function getEmberTexture(): THREE.CanvasTexture {
  if (emberTex) return emberTex;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.35, 'rgba(255, 215, 70, 0.95)');
    g.addColorStop(0.7, 'rgba(255, 90, 0, 0.4)');
    g.addColorStop(1, 'rgba(255, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  }
  emberTex = new THREE.CanvasTexture(canvas);
  return emberTex;
}

let smokeTex: THREE.CanvasTexture | null = null;
function getSmokeTexture(): THREE.CanvasTexture {
  if (smokeTex) return smokeTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    g.addColorStop(0.4, 'rgba(215, 215, 215, 0.55)');
    g.addColorStop(0.75, 'rgba(140, 140, 140, 0.22)');
    g.addColorStop(1, 'rgba(90, 90, 90, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  smokeTex = new THREE.CanvasTexture(canvas);
  return smokeTex;
}

let steamTex: THREE.CanvasTexture | null = null;
function getSteamTexture(): THREE.CanvasTexture {
  if (steamTex) return steamTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    g.addColorStop(0.45, 'rgba(240, 248, 255, 0.6)');
    g.addColorStop(0.8, 'rgba(210, 230, 245, 0.2)');
    g.addColorStop(1, 'rgba(200, 220, 240, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  steamTex = new THREE.CanvasTexture(canvas);
  return steamTex;
}

let ashBedTex: THREE.CanvasTexture | null = null;
function getAshBedTexture(): THREE.CanvasTexture {
  if (ashBedTex) return ashBedTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, 'rgba(255, 110, 10, 0.95)');
    g.addColorStop(0.35, 'rgba(200, 50, 0, 0.75)');
    g.addColorStop(0.7, 'rgba(40, 25, 18, 0.85)');
    g.addColorStop(1, 'rgba(12, 6, 2, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  ashBedTex = new THREE.CanvasTexture(canvas);
  return ashBedTex;
}

interface FireParticle {
  phase: number;
  cx: number;
  cz: number;
  radius: number;
  angle: number;
  scale: number;
  speed: number;
  swirl: number;
}

function createClusterParticles(count: number, spread: number, seed: number): FireParticle[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };

  // 4 fuel hotspot centers across the clearing
  const hotspots: [number, number][] = [
    [0, 0],
    [(rnd() - 0.5) * spread * 0.9, (rnd() - 0.5) * spread * 0.9],
    [(rnd() - 0.5) * spread * 0.9, (rnd() - 0.5) * spread * 0.9],
    [(rnd() - 0.5) * spread * 0.8, (rnd() - 0.5) * spread * 0.8],
  ];

  return Array.from({ length: count }, (_, i) => {
    const spot = hotspots[i % hotspots.length];
    return {
      phase: i / count + (rnd() - 0.5) * 0.05,
      cx: spot[0],
      cz: spot[1],
      radius: Math.pow(rnd(), 0.7) * (spread * 0.45),
      angle: rnd() * Math.PI * 2,
      scale: 0.8 + rnd() * 0.75,
      speed: 0.85 + rnd() * 0.35,
      swirl: (rnd() - 0.5) * 3.0,
    };
  });
}

export function FireZone({ mission }: { mission: Mission }) {
  const fire = mission.fire;
  const intensity = useMissionStore((s) => s.fireIntensity);
  const suppressing = useMissionStore((s) => s.suppressing);
  const phase = useMissionStore((s) => s.phase);

  const flamesGroup = useRef<THREE.Group>(null);
  const embersGroup = useRef<THREE.Group>(null);
  const smokeGroup = useRef<THREE.Group>(null);
  const steamGroup = useRef<THREE.Group>(null);
  const ashMesh = useRef<THREE.Mesh>(null);
  const coreLight = useRef<THREE.PointLight>(null);
  const ambientLight = useRef<THREE.PointLight>(null);

  const shown = useRef(1);
  const steamPower = useRef(0);

  const flameT = useMemo(() => getFlameTexture(), []);
  const emberT = useMemo(() => getEmberTexture(), []);
  const smokeT = useMemo(() => getSmokeTexture(), []);
  const steamT = useMemo(() => getSteamTexture(), []);
  const ashT = useMemo(() => getAshBedTexture(), []);

  const burnR = (fire?.burnRadius ?? 8) * 0.8;
  const flameParticles = useMemo(() => createClusterParticles(FLAME_COUNT, burnR, 701), [burnR]);
  const emberParticles = useMemo(
    () => createClusterParticles(EMBER_COUNT, burnR * 0.95, 802),
    [burnR],
  );
  const smokeParticles = useMemo(
    () => createClusterParticles(SMOKE_COUNT, burnR * 0.7, 903),
    [burnR],
  );
  const steamParticles = useMemo(
    () => createClusterParticles(STEAM_COUNT, burnR * 0.8, 1004),
    [burnR],
  );

  const groundY = fire ? zoneGroundY(mission, mission.zones.drop) : 0;
  const at = mission.zones.drop.at;

  useFrame(({ clock, camera }, rawDt) => {
    if (!fire) return;
    const dt = Math.min(rawDt, 0.1);
    shown.current += (intensity - shown.current) * Math.min(1, dt * 3.5);
    const lit = shown.current;

    // Steam activates when suppressing and fire is still burning
    const targetSteam = suppressing && lit > 0.05 ? 1 : 0;
    steamPower.current += (targetSteam - steamPower.current) * Math.min(1, dt * 6);
    const steamLit = steamPower.current;

    const t = clock.elapsedTime;
    const face = camera.quaternion;

    // 1. Hot Raging Flames
    if (flamesGroup.current) {
      flamesGroup.current.visible = lit > 0.01;
      flamesGroup.current.children.forEach((child, i) => {
        const p = flameParticles[i];
        const age = (((t / (FLAME_LIFE / p.speed) + p.phase) % 1) + 1) % 1;
        const mesh = child as THREE.Mesh;

        const rise = age * FLAME_RISE * (0.55 + lit * 0.55);
        const taper = 1 - age * 0.42;
        const r = p.radius * (0.35 + lit * 0.65) * taper;
        const wobble = Math.sin(t * 9 + i * 1.6) * 0.3 * age;
        const x = p.cx + Math.cos(p.angle) * r + wobble;
        const z = p.cz + Math.sin(p.angle) * r + wobble;

        mesh.position.set(x, rise + 0.25, z);
        mesh.quaternion.copy(face);

        const sw = p.scale * (1.25 + lit * 0.95) * taper;
        const sh = p.scale * (1.9 + lit * 1.8) * (1 + (1 - age) * 0.55);
        mesh.scale.set(sw, sh, sw);

        const mat = mesh.material as THREE.MeshBasicMaterial;
        const alpha = Math.sin(age * Math.PI) * (1 - age * 0.22);
        mat.opacity = lit * alpha * 0.9;
      });
    }

    // 2. Swirling Rising Embers
    if (embersGroup.current) {
      embersGroup.current.visible = lit > 0.04;
      embersGroup.current.children.forEach((child, i) => {
        const p = emberParticles[i];
        const age = (((t / (EMBER_LIFE / p.speed) + p.phase) % 1) + 1) % 1;
        const mesh = child as THREE.Mesh;

        const rise = age * EMBER_RISE * (0.65 + lit * 0.5);
        const swirlAngle = p.angle + p.swirl * age * 2.8 + t * 0.9;
        const r = p.radius * (0.3 + age * 1.1);
        const x = p.cx + Math.cos(swirlAngle) * r;
        const z = p.cz + Math.sin(swirlAngle) * r;

        mesh.position.set(x, rise + 0.35, z);
        mesh.quaternion.copy(face);

        const s = p.scale * 0.38 * (1 - age * 0.45);
        mesh.scale.set(s, s, s);

        const mat = mesh.material as THREE.MeshBasicMaterial;
        const twinkle = 0.65 + 0.35 * Math.sin(t * 20 + i * 3.7);
        mat.opacity = lit * (1 - age) * twinkle * 0.95;
      });
    }

    // 3. Volumetric Smoke Plumes
    if (smokeGroup.current) {
      const smokeLit = Math.max(lit, lit > 0.001 ? 0.22 : 0);
      smokeGroup.current.visible = smokeLit > 0.02;
      smokeGroup.current.children.forEach((child, i) => {
        const p = smokeParticles[i];
        const age = (((t / (SMOKE_LIFE / p.speed) + p.phase) % 1) + 1) % 1;
        const mesh = child as THREE.Mesh;

        const rise = 1.2 + age * SMOKE_RISE * (0.6 + smokeLit * 0.4);
        const r = p.radius * 0.5 + Math.pow(age, 1.3) * (fire?.burnRadius ?? 8) * 0.85;
        const drift = p.swirl * age * 3.8;
        const x = p.cx + Math.cos(p.angle) * r + drift;
        const z = p.cz + Math.sin(p.angle) * r + drift * 0.5;

        mesh.position.set(x, rise, z);
        mesh.quaternion.copy(face);

        const s = p.scale * (2.8 + age * 12) * (0.6 + smokeLit * 0.4);
        mesh.scale.set(s, s, s);

        const mat = mesh.material as THREE.MeshBasicMaterial;
        const fade = Math.min(1, age * 4.5) * (1 - age * age);
        mat.opacity = smokeLit * fade * 0.48;
      });
    }

    // 4. Interactive Suppressant Steam Clouds
    if (steamGroup.current) {
      steamGroup.current.visible = steamLit > 0.01;
      steamGroup.current.children.forEach((child, i) => {
        const p = steamParticles[i];
        const age = (((t / (STEAM_LIFE / p.speed) + p.phase) % 1) + 1) % 1;
        const mesh = child as THREE.Mesh;

        const rise = age * 5.5;
        const r = p.radius * 0.6 + age * 2.8;
        const x = p.cx * 0.5 + Math.cos(p.angle) * r;
        const z = p.cz * 0.5 + Math.sin(p.angle) * r;

        mesh.position.set(x, rise + 0.4, z);
        mesh.quaternion.copy(face);

        const s = p.scale * (1.5 + age * 4.8);
        mesh.scale.set(s, s * 0.85, s);

        const mat = mesh.material as THREE.MeshBasicMaterial;
        const alpha = Math.sin(age * Math.PI) * (1 - age * 0.35);
        mat.opacity = steamLit * alpha * 0.65;
      });
    }

    // 5. Ash Bed Cooling
    if (ashMesh.current) {
      const mat = ashMesh.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.4 + lit * 0.5;
    }

    // 6. Dual Organic Fire Lights
    if (coreLight.current) {
      const flick1 = 0.85 + 0.15 * Math.sin(t * 15) * Math.cos(t * 7.3);
      coreLight.current.intensity = lit * lit * 90 * flick1;
      coreLight.current.visible = lit > 0.02;
    }
    if (ambientLight.current) {
      const flick2 = 0.9 + 0.1 * Math.sin(t * 8.5);
      ambientLight.current.intensity = lit * 65 * flick2;
      ambientLight.current.visible = lit > 0.02;
    }
  });

  if (!fire) return null;
  const flying = phase !== 'briefing';

  return (
    <group position={[at[0], groundY, at[1]]} visible={flying}>
      {/* 5. Glowing Ash & Scorched Earth Bed */}
      <mesh ref={ashMesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <circleGeometry args={[fire.burnRadius, 40]} />
        <meshBasicMaterial
          map={ashT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* 1. Hot Core Flames */}
      <group ref={flamesGroup}>
        {flameParticles.map((_p, i) => (
          <mesh key={i}>
            <planeGeometry args={[1.5, 2.2]} />
            <meshBasicMaterial
              map={flameT}
              color={
                i % 4 === 0
                  ? COLOR_CORE
                  : i % 3 === 0
                    ? COLOR_HOT
                    : i % 2 === 0
                      ? COLOR_MID
                      : COLOR_TIP
              }
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* 2. Rising Embers & Sparks */}
      <group ref={embersGroup}>
        {emberParticles.map((_p, i) => (
          <mesh key={i}>
            <planeGeometry args={[0.6, 0.6]} />
            <meshBasicMaterial
              map={emberT}
              color={COLOR_EMBER}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* 3. Billowing Smoke Plumes */}
      <group ref={smokeGroup}>
        {smokeParticles.map((_p, i) => (
          <mesh key={i}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={smokeT} color={COLOR_SMOKE} transparent depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* 4. Interactive Suppressant Steam Clouds */}
      <group ref={steamGroup}>
        {steamParticles.map((_p, i) => (
          <mesh key={i}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              map={steamT}
              color={COLOR_STEAM}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* 6. Dual-Tone Dynamic Lighting */}
      <pointLight ref={coreLight} position={[0, 2.2, 0]} color="#ffa834" distance={30} decay={2} />
      <pointLight
        ref={ambientLight}
        position={[0, 3.5, 0]}
        color="#ff3b00"
        distance={55}
        decay={2}
      />
    </group>
  );
}

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import {
  PICKUP_DECK_HEIGHT,
  PICKUP_DECK_OUT,
  PICKUP_DECK_SIZE,
  STOREFRONT_BASE,
  storefrontYaw,
} from './pickupStorefront';
import type { StorefrontSite } from './pickupStorefront';

// ----------------------------------------------------------------------------
// A shop the drone collects from: a shopfront on a building face and a raised
// drone pickup deck on the sidewalk in front of it.
//
// Two kinds, one build. Lotus Kitchen (mission 4's food box) and Lake City
// Pharmacy (mission 3's medical packages) share the same bones — piers, lit
// windows, a door, a fascia sign, an awning, planters and the deck — and differ
// in materials, the sign, and what stands on the sidewalk. Cargo used to be
// collected off the road; where an order comes FROM is what makes a pickup read
// as a job rather than an object left in the street.
//
// Built in the shop's own frame: local +x runs along the wall, +z points out of
// the shop, y is up from the sidewalk. `pickupStorefront.ts` places that frame
// in the city.
//
// Primitives and a few canvas textures, no lights. A point light adds a light to
// every material's shader in the scene on a GPU that is already the limit; the
// windows and the signs are emissive instead, and the post chain's bloom does
// the rest at the blue half hour the missions are flown in.
//
// Everything a drone could fly into has a collider, all in one fixed body.
// ----------------------------------------------------------------------------

export type StorefrontKind = 'restaurant' | 'pharmacy';

interface Look {
  pier: string;
  plinth: string;
  fascia: string;
  glass: string;
  glow: string;
  glowIntensity: number;
  sign: readonly [string, string];
  signBg: string;
  signFg: string;
  awning: readonly [string, string];
  deckSign: string;
}

const LOOKS: Record<StorefrontKind, Look> = {
  restaurant: {
    pier: '#7a3b2a',
    plinth: '#3b3634',
    fascia: '#1f2326',
    glass: '#3a2a1a',
    glow: '#ffc27a',
    glowIntensity: 0.85,
    sign: ['LOTUS KITCHEN', 'FRESH FOOD · DRONE PICKUP'],
    signBg: '#1f2326',
    signFg: '#fff1d6',
    awning: ['#b3261e', '#f1e6d0'],
    deckSign: 'DRONE PICKUP',
  },
  pharmacy: {
    pier: '#e4e7e5',
    plinth: '#8d9491',
    fascia: '#0f7a4a',
    glass: '#1d2a30',
    glow: '#dff3ff',
    glowIntensity: 0.9,
    sign: ['LAKE CITY PHARMACY', 'MEDICINES · DRONE DISPATCH'],
    signBg: '#0f7a4a',
    signFg: '#ffffff',
    awning: ['#12804f', '#f4f7f5'],
    deckSign: 'DRONE DISPATCH',
  },
};

const FRAME = '#1d1f22';
const STEEL = '#4a5058';
const PLATE = '#cfd4da';

/** Shopfront width along the wall, metres. */
const W = 8;
/** Top of the shopfront, metres. */
const TOP = 3.6;

/** A canvas texture with one or two lines of centred text. */
function textTexture(
  lines: readonly string[],
  opts: { w: number; h: number; bg: string; fg: string; size: number },
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = opts.w;
  canvas.height = opts.h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, opts.w, opts.h);
    ctx.fillStyle = opts.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const step = opts.h / lines.length;
    lines.forEach((line, i) => {
      const size = i === 0 ? opts.size : opts.size * 0.55;
      ctx.font = `${i === 0 ? 700 : 500} ${size}px system-ui, sans-serif`;
      ctx.fillText(line, opts.w / 2, step * (i + 0.5), opts.w * 0.94);
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Vertical stripes in two colours, for an awning or a deck's safety edge. */
function stripeTexture(a: string, b: string, repeat: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 4;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 32, 4);
    ctx.fillStyle = b;
    ctx.fillRect(32, 0, 32, 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(repeat, 1);
  return tex;
}

export function Storefront({ site, kind }: { site: StorefrontSite; kind: StorefrontKind }) {
  const look = LOOKS[kind];
  const tex = useMemo(
    () => ({
      sign: textTexture(look.sign, { w: 1024, h: 128, bg: look.signBg, fg: look.signFg, size: 64 }),
      deck: textTexture([look.deckSign], { w: 512, h: 112, bg: '#1c64f2', fg: '#ffffff', size: 58 }),
      menu: textTexture(['MENU', 'Thali · Noodles · Wraps'], {
        w: 256,
        h: 256,
        bg: '#232826',
        fg: '#f5f1e6',
        size: 64,
      }),
      awning: stripeTexture(look.awning[0], look.awning[1], 10),
      hazard: stripeTexture('#f2c230', '#1b1b1b', 12),
    }),
    [look],
  );
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex]);

  const deckZ = PICKUP_DECK_OUT;
  const half = PICKUP_DECK_SIZE / 2;
  const deckH = PICKUP_DECK_HEIGHT;
  const restaurant = kind === 'restaurant';

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[site.wall[0], STOREFRONT_BASE, site.wall[1]]}
      rotation={[0, storefrontYaw(site), 0]}
    >
      {/* ---- Colliders ---------------------------------------------------- */}
      <CuboidCollider args={[half, deckH / 2, half]} position={[0, deckH / 2, deckZ]} />
      <CuboidCollider args={[W / 2 + 0.1, 0.25, 0.6]} position={[0, 2.7, 0.6]} />
      <CuboidCollider args={[W / 2 + 0.15, 0.45, 0.2]} position={[0, 3.15, 0.15]} />
      {restaurant ? (
        <>
          {[-3.3, 3.3].map((x) => (
            <CuboidCollider key={x} args={[1, 0.46, 0.55]} position={[x, 0.46, 1.9]} />
          ))}
          <CuboidCollider args={[0.35, 0.5, 0.3]} position={[-2.6, 0.5, 1.3]} />
        </>
      ) : (
        <>
          <CuboidCollider args={[0.85, 0.45, 0.3]} position={[-3.2, 0.45, 1.0]} />
          <CuboidCollider args={[0.05, 0.5, 0.5]} position={[W / 2 - 0.3, 3.25, 0.6]} />
        </>
      )}

      {/* ---- The shopfront, on the wall ---------------------------------- */}
      {/* Plinth and piers. */}
      <mesh position={[0, 0.18, 0.12]} castShadow>
        <boxGeometry args={[W + 0.3, 0.36, 0.24]} />
        <meshStandardMaterial color={look.plinth} roughness={0.55} />
      </mesh>
      {[-W / 2, -0.85, 0.85, W / 2].map((x) => (
        <mesh key={x} position={[x, TOP / 2, 0.13]} castShadow>
          <boxGeometry args={[0.34, TOP, 0.26]} />
          <meshStandardMaterial color={look.pier} roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 2.6, 0.12]}>
        <boxGeometry args={[W, 0.3, 0.22]} />
        <meshStandardMaterial color={look.pier} roughness={0.9} />
      </mesh>
      {/* Returns at both ends, back to the building, so the shopfront never
          reads as a panel standing off the wall. */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (W / 2 + 0.2), TOP / 2, -0.1]}>
          <boxGeometry args={[0.1, TOP, 0.5]} />
          <meshStandardMaterial color={look.pier} roughness={0.9} />
        </mesh>
      ))}

      {/* The two display windows, lit from inside. */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 2.4, 1.43, 0.06]}>
          <mesh>
            <planeGeometry args={[2.78, 2.1]} />
            <meshStandardMaterial
              color={look.glass}
              emissive={look.glow}
              emissiveIntensity={look.glowIntensity}
              roughness={0.15}
              metalness={0.1}
            />
          </mesh>
          {/* A pharmacy's windows are shelves of stock, seen through the glass. */}
          {!restaurant &&
            [-0.45, 0.15].map((y) => (
              <mesh key={y} position={[0, y, 0.015]}>
                <boxGeometry args={[2.6, 0.035, 0.02]} />
                <meshStandardMaterial color="#9aa6ad" roughness={0.6} />
              </mesh>
            ))}
          {/* Mullion and transom. */}
          <mesh position={[0, 0, 0.03]}>
            <boxGeometry args={[0.06, 2.1, 0.05]} />
            <meshStandardMaterial color={FRAME} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.68, 0.03]}>
            <boxGeometry args={[2.78, 0.06, 0.05]} />
            <meshStandardMaterial color={FRAME} roughness={0.5} />
          </mesh>
          {/* Sill. */}
          <mesh position={[0, -1.08, 0.12]}>
            <boxGeometry args={[2.9, 0.07, 0.22]} />
            <meshStandardMaterial color={look.plinth} roughness={0.55} />
          </mesh>
        </group>
      ))}

      {/* The door: glass in a dark frame, with a push bar. */}
      <group position={[0, 1.44, 0.05]}>
        <mesh>
          <boxGeometry args={[1.36, 2.2, 0.06]} />
          <meshStandardMaterial color={FRAME} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.05, 0.035]}>
          <planeGeometry args={[1.1, 1.95]} />
          <meshStandardMaterial
            color={look.glass}
            emissive={look.glow}
            emissiveIntensity={look.glowIntensity * 0.65}
            roughness={0.15}
          />
        </mesh>
        <mesh position={[0.36, 0, 0.1]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.018, 0.018, 0.5, 8]} />
          <meshStandardMaterial color="#c9ccd1" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>

      {/* The sign on the fascia. */}
      <mesh position={[0, 3.15, 0.14]} castShadow>
        <boxGeometry args={[W + 0.3, 0.9, 0.28]} />
        <meshStandardMaterial color={look.fascia} roughness={0.6} />
      </mesh>
      <mesh position={[0, 3.15, 0.285]}>
        <planeGeometry args={[6.6, 0.82]} />
        <meshStandardMaterial
          map={tex.sign}
          emissiveMap={tex.sign}
          emissive="#ffffff"
          emissiveIntensity={0.9}
          roughness={0.6}
        />
      </mesh>

      {/* The awning: striped canvas sloping out over the windows, a valance
          along its front edge, and two arms back to the wall. */}
      <mesh position={[0, 2.7, 0.6]} rotation={[-(Math.PI / 2 - 0.42), 0, 0]} castShadow>
        <planeGeometry args={[W + 0.2, 1.3]} />
        <meshStandardMaterial map={tex.awning} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 2.35, 1.14]}>
        <planeGeometry args={[W + 0.2, 0.26]} />
        <meshStandardMaterial map={tex.awning} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      {[-3.2, 3.2].map((x) => (
        <mesh key={x} position={[x, 2.5, 0.57]} rotation={[0.9, 0, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 1.2, 6]} />
          <meshStandardMaterial color={FRAME} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}

      {/* The pharmacy's green cross, on a blade sign standing off the wall so it
          reads down the street in both directions. */}
      {!restaurant && (
        <group position={[W / 2 - 0.3, 3.25, 0.6]}>
          <mesh castShadow>
            <boxGeometry args={[0.08, 0.95, 0.95]} />
            <meshStandardMaterial color="#f4f7f5" roughness={0.6} />
          </mesh>
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.045, 0, 0]}>
              <mesh>
                <boxGeometry args={[0.02, 0.22, 0.72]} />
                <meshStandardMaterial
                  color="#16a34a"
                  emissive="#22c55e"
                  emissiveIntensity={1.4}
                  toneMapped={false}
                />
              </mesh>
              <mesh>
                <boxGeometry args={[0.02, 0.72, 0.22]} />
                <meshStandardMaterial
                  color="#16a34a"
                  emissive="#22c55e"
                  emissiveIntensity={1.4}
                  toneMapped={false}
                />
              </mesh>
            </group>
          ))}
          <mesh position={[0, 0, -0.55]}>
            <boxGeometry args={[0.04, 0.04, 0.2]} />
            <meshStandardMaterial color={FRAME} metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      )}

      {/* Planters at each end of the frontage. */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (W / 2 + 0.55), 0, 0.45]}>
          <mesh position={[0, 0.3, 0]} castShadow>
            <boxGeometry args={[0.7, 0.6, 0.6]} />
            <meshStandardMaterial color="#5b5e61" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.85, 0]} scale={[1, 0.85, 0.9]} castShadow>
            <sphereGeometry args={[0.42, 12, 10]} />
            <meshStandardMaterial color="#3f6b35" roughness={0.95} />
          </mesh>
        </group>
      ))}

      {/* ---- The sidewalk --------------------------------------------------- */}
      {restaurant ? (
        <>
          {/* Two café tables, two chairs each. */}
          {[-3.3, 3.3].map((x) => (
            <group key={x} position={[x, 0, 1.9]}>
              <mesh position={[0, 0.74, 0]} castShadow>
                <cylinderGeometry args={[0.4, 0.4, 0.035, 20]} />
                <meshStandardMaterial color="#e9e4da" roughness={0.5} />
              </mesh>
              <mesh position={[0, 0.37, 0]}>
                <cylinderGeometry args={[0.03, 0.03, 0.72, 8]} />
                <meshStandardMaterial color={FRAME} metalness={0.6} roughness={0.4} />
              </mesh>
              <mesh position={[0, 0.015, 0]}>
                <cylinderGeometry args={[0.22, 0.24, 0.03, 16]} />
                <meshStandardMaterial color={FRAME} metalness={0.6} roughness={0.4} />
              </mesh>
              {[-1, 1].map((s) => (
                <group
                  key={s}
                  position={[s * 0.62, 0, 0]}
                  rotation={[0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
                >
                  <mesh position={[0, 0.45, 0]} castShadow>
                    <boxGeometry args={[0.42, 0.04, 0.42]} />
                    <meshStandardMaterial color="#8a5a3b" roughness={0.8} />
                  </mesh>
                  <mesh position={[0, 0.7, -0.2]}>
                    <boxGeometry args={[0.42, 0.46, 0.04]} />
                    <meshStandardMaterial color="#8a5a3b" roughness={0.8} />
                  </mesh>
                  {[-0.18, 0.18].map((z) => (
                    <mesh key={z} position={[0, 0.22, z]}>
                      <boxGeometry args={[0.38, 0.44, 0.03]} />
                      <meshStandardMaterial color={FRAME} metalness={0.5} roughness={0.5} />
                    </mesh>
                  ))}
                </group>
              ))}
            </group>
          ))}

          {/* A-frame menu board. */}
          <group position={[-2.6, 0, 1.3]} rotation={[0, 0.25, 0]}>
            {[-1, 1].map((s) => (
              <mesh
                key={s}
                position={[0, 0.5, s * 0.14]}
                rotation={[s * 0.28, s > 0 ? 0 : Math.PI, 0]}
                castShadow
              >
                <boxGeometry args={[0.6, 1.0, 0.03]} />
                <meshStandardMaterial color="#6b4a2f" roughness={0.8} />
              </mesh>
            ))}
            <mesh position={[0, 0.52, 0.17]} rotation={[0.28, 0, 0]}>
              <planeGeometry args={[0.5, 0.78]} />
              <meshStandardMaterial map={tex.menu} roughness={0.9} />
            </mesh>
          </group>
        </>
      ) : (
        /* A bench outside the pharmacy, for whoever is waiting on a prescription. */
        <group position={[-3.2, 0, 1.0]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[1.6, 0.06, 0.45]} />
            <meshStandardMaterial color="#8a5a3b" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.72, -0.2]} castShadow>
            <boxGeometry args={[1.6, 0.4, 0.05]} />
            <meshStandardMaterial color="#8a5a3b" roughness={0.8} />
          </mesh>
          {[-0.7, 0.7].map((x) => (
            <mesh key={x} position={[x, 0.3, -0.05]}>
              <boxGeometry args={[0.06, 0.6, 0.45]} />
              <meshStandardMaterial color={FRAME} metalness={0.5} roughness={0.5} />
            </mesh>
          ))}
        </group>
      )}

      {/* ---- The drone pickup deck ------------------------------------------ */}
      <group position={[0, 0, deckZ]}>
        <mesh position={[0, (deckH - 0.06) / 2, 0]} castShadow>
          <boxGeometry args={[PICKUP_DECK_SIZE - 0.1, deckH - 0.06, PICKUP_DECK_SIZE - 0.1]} />
          <meshStandardMaterial color={STEEL} roughness={0.7} metalness={0.3} />
        </mesh>
        <mesh position={[0, deckH - 0.03, 0]} castShadow>
          <boxGeometry args={[PICKUP_DECK_SIZE, 0.06, PICKUP_DECK_SIZE]} />
          <meshStandardMaterial color={PLATE} roughness={0.6} metalness={0.2} />
        </mesh>
        {/* Safety edge, yellow and black, round the top. */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i * Math.PI) / 2;
          return (
            <mesh
              key={i}
              position={[Math.sin(a) * (half - 0.08), deckH + 0.002, Math.cos(a) * (half - 0.08)]}
              rotation={[-Math.PI / 2, 0, a]}
            >
              <planeGeometry args={[PICKUP_DECK_SIZE, 0.14]} />
              <meshStandardMaterial map={tex.hazard} roughness={0.7} />
            </mesh>
          );
        })}
        {/* The street-facing board. */}
        <mesh position={[0, deckH * 0.55, half - 0.04]}>
          <planeGeometry args={[1.7, 0.37]} />
          <meshStandardMaterial
            map={tex.deck}
            emissiveMap={tex.deck}
            emissive="#ffffff"
            emissiveIntensity={0.5}
            roughness={0.6}
          />
        </mesh>
        {/* Steps up from the shop side, for whoever brings the order out. */}
        {[0, 1].map((i) => (
          <mesh key={i} position={[0, 0.15 + i * 0.15, -half - 0.35 + i * 0.3]} castShadow>
            <boxGeometry args={[1, 0.3 + i * 0.3, 0.3]} />
            <meshStandardMaterial color={STEEL} roughness={0.8} metalness={0.3} />
          </mesh>
        ))}
      </group>
    </RigidBody>
  );
}

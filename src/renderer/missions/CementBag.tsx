import * as THREE from 'three';
import { textTexture } from './Storefront';

// ----------------------------------------------------------------------------
// A cement bag: a filled paper sack with a printed label, what Mission 7
// carries.
//
// No behaviour, like `MedicalCase`: `Payload` moves it, and the material store
// stacks it at full size on a pallet by the door. `size` is the same number the
// other cargo takes, so a bag slung under the Guru is sized off the airframe
// exactly as the case was.
//
// PILLOWED, not boxed. A straight box with a label read as a carton — flown and
// reported as "a cement box". A sack is fat in the middle and pinched at its
// edges, so the one geometry here is a subdivided box whose height falls away
// toward the rim. Built once at unit size and scaled, so the carried bag and
// the six on the pallet share it.
// ----------------------------------------------------------------------------

/** The sack's proportions, as multiples of `size`. */
export const BAG_W = 1.3;
export const BAG_H = 0.6;
export const BAG_D = 0.9;

/** How much thinner the sack is at its rim than at its middle, 0..1. */
const PINCH = 0.45;

let sack: THREE.BufferGeometry | null = null;
/** The sack at unit size: a box, puffed. Shared by every bag. */
function sackGeometry(): THREE.BufferGeometry {
  if (sack) return sack;
  const g = new THREE.BoxGeometry(BAG_W, BAG_H, BAG_D, 8, 2, 6);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / (BAG_W / 2);
    const v = p.getZ(i) / (BAG_D / 2);
    // Full height in the middle, pinched toward the edges and hardest at the
    // corners, the way a filled sack slumps.
    const f = 1 - PINCH * Math.max(u * u, v * v) * (0.7 + 0.3 * Math.min(u * u, v * v));
    p.setY(i, p.getY(i) * f);
  }
  g.computeVertexNormals();
  sack = g;
  return g;
}

/** Built once and shared: every bag on screen prints the same label. */
let label: THREE.CanvasTexture | null = null;
function labelTexture(): THREE.CanvasTexture {
  if (!label) {
    label = textTexture(['CEMENT', 'OPC 53 GRADE · 50 KG'], {
      w: 256,
      h: 96,
      bg: '#f1ece2',
      fg: '#b3261e',
      size: 52,
    });
  }
  return label;
}

export function CementBag({ size }: { size: number }) {
  const skin = 0.006;
  return (
    <group scale={size}>
      {/* The sack: grey kraft paper. */}
      <mesh geometry={sackGeometry()} castShadow receiveShadow>
        <meshStandardMaterial color="#aaa396" roughness={0.95} metalness={0} />
      </mesh>
      {/* The printed label, on the top and on both long faces — a bag is seen
          from above when it waits on the pad and from the side when it hangs.
          Kept to the middle of each face, where the sack is at full height. */}
      {/* The top is domed, so this one sits a touch under the crown: at its
          corners the sack has already fallen away by about that much. */}
      <mesh position={[0, BAG_H / 2 - 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BAG_W * 0.42, BAG_D * 0.34]} />
        <meshStandardMaterial map={labelTexture()} roughness={0.85} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh
          key={s}
          position={[0, 0, s * (BAG_D / 2 + skin)]}
          rotation={[0, s > 0 ? 0 : Math.PI, 0]}
        >
          <planeGeometry args={[BAG_W * 0.5, BAG_H * 0.55]} />
          <meshStandardMaterial map={labelTexture()} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

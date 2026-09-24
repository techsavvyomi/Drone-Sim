import * as THREE from 'three';
import { textTexture } from './Storefront';

// ----------------------------------------------------------------------------
// A cement bag: a squat paper sack with a printed band, what Mission 7 carries.
//
// No behaviour, like `MedicalCase`: `Payload` moves it, and the material store
// stacks it at full size on a pallet by the door. `size` is the same number the
// other cargo takes, so a bag slung under the Guru is sized off the airframe
// exactly as the case was; the proportions are a sack's — wider than it is
// deep, and flat.
// ----------------------------------------------------------------------------

/** The sack's proportions, as multiples of `size`. */
export const BAG_W = 1.3;
export const BAG_H = 0.6;
export const BAG_D = 0.9;

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
  const w = size * BAG_W;
  const h = size * BAG_H;
  const d = size * BAG_D;
  const skin = size * 0.004;
  return (
    <>
      {/* The sack: grey kraft paper. */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#aaa396" roughness={0.95} metalness={0} />
      </mesh>
      {/* The folded, stitched ends: a darker strip across each. */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * (w / 2 + skin), 0, 0]} rotation={[0, (s * Math.PI) / 2, 0]}>
          <planeGeometry args={[d * 0.96, h * 0.9]} />
          <meshStandardMaterial color="#8f887b" roughness={0.95} />
        </mesh>
      ))}
      {/* The printed label, on the top and on both long faces — a bag is seen
          from above when it waits on the pad and from the side when it hangs. */}
      <mesh position={[0, h / 2 + skin, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w * 0.72, d * 0.62]} />
        <meshStandardMaterial map={labelTexture()} roughness={0.85} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, 0, s * (d / 2 + skin)]} rotation={[0, s > 0 ? 0 : Math.PI, 0]}>
          <planeGeometry args={[w * 0.72, h * 0.7]} />
          <meshStandardMaterial map={labelTexture()} roughness={0.85} />
        </mesh>
      ))}
    </>
  );
}

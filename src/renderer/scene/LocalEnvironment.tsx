import { useMemo } from 'react';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import { skyGradientTexture } from './environment/textures';
import type { TimePreset } from '../state/worldStore';

// Image-based lighting generated locally.
//
// PBR materials need an environment map to look like anything — without one,
// metal reads as flat grey and everything appears "off". The usual answer is an
// HDRI, but drei's <Environment preset> downloads from a CDN which our CSP
// blocks. Instead we render a sky gradient plus a sun blob into a small cube
// map: drei's <Environment> renders whatever children you give it, so this
// costs one 128px cube render and no network at all.
export function LocalEnvironment({ preset }: { preset: TimePreset }) {
  const gradient = useMemo(() => {
    const top = preset.night ? '#0a1020' : preset.skyTurbidity > 6 ? '#6d4a52' : '#3f7fc4';
    const horizon = preset.night ? '#141d2e' : preset.fogColor;
    const ground = preset.night ? '#0a0f18' : '#4a4f45';
    return skyGradientTexture(top, horizon, ground);
  }, [preset]);

  const sun = useMemo(
    () => new THREE.Vector3(...preset.sun).normalize().multiplyScalar(40),
    [preset],
  );

  return (
    // frames={1} bakes it once per preset change rather than every frame.
    <Environment frames={1} resolution={128}>
      <mesh scale={50}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial map={gradient} side={THREE.BackSide} toneMapped={false} />
      </mesh>
      {!preset.night && (
        <mesh position={sun}>
          <sphereGeometry args={[6, 12, 12]} />
          <meshBasicMaterial color={preset.sunColor} toneMapped={false} />
        </mesh>
      )}
    </Environment>
  );
}

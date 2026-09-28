import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { dronePose } from '../sim/drone/pose';
import { cameraShake } from '../sim/effects';
import { useSimStore } from '../state/simStore';

// TEMPORARY diagnostic: logs camera + drone pose for 3 s after mount and after
// every reset, so the spawn shake can be read from the terminal.
export function ShakeProbe() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const start = useRef(performance.now());
  const token = useRef(-1);
  const n = useRef(0);
  useFrame((_s, delta) => {
    const t = useSimStore.getState().resetToken;
    if (t !== token.current) {
      token.current = t;
      start.current = performance.now();
      n.current = 0;
      console.info(`[perfshake] ---- start token ${t}`);
    }
    if (performance.now() - start.current > 3000) return;
    n.current++;
    const p = dronePose.position;
    const c = camera.position;
    const q = camera.quaternion;
    console.info(
      `[perfshake] ${n.current} dt ${(delta * 1000).toFixed(1)} shake ${cameraShake.intensity.toFixed(3)} ` +
        `dpr ${gl.getPixelRatio().toFixed(2)} ` +
        `drone ${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)} ` +
        `cam ${c.x.toFixed(4)} ${c.y.toFixed(4)} ${c.z.toFixed(4)} ` +
        `q ${q.x.toFixed(4)} ${q.y.toFixed(4)} ${q.z.toFixed(4)} ${q.w.toFixed(4)}`,
    );
  });
  return null;
}

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useAfterPhysicsStep, useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import { dronePose } from '../sim/drone/pose';

// DEV ONLY. Logs where a flight's time goes, every two seconds, as one line:
//
//   [perf] fps 58 worst 31ms | phys 0.42ms x4.1/frame (max 2.9) | heap 212MB |
//          calls 38 tris 312k | colliders 1712 | drone -41.2 1.4 -13.1
//
// Mounted inside <Physics> by FlightScene only under `import.meta.env.DEV`, and
// forwarded to the terminal by the main process (dev only as well), so a pilot
// reporting "it starts smooth and then stutters" can be answered with numbers:
// whether the time is going to the physics or the frame, whether it grows, and
// where the drone was when it did.

const WINDOW_SEC = 2;

/**
 * SNAP_RUN engine steps in a row slower than SNAP_STEP_MS — sustained, not the
 * one-off spikes of a map streaming in — are captured once per mount as a Rapier
 * snapshot, logged base64 in `[perfsnap]` chunks, so the exact world — every
 * collider, contact and velocity — can be replayed and profiled outside the app.
 */
const SNAP_STEP_MS = 3;
const SNAP_RUN = 50;
const SNAP_CHUNK = 256 * 1024;

function logSnapshot(world: { takeSnapshot: () => Uint8Array }, ms: number) {
  const bytes = world.takeSnapshot();
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const b64 = btoa(bin);
  const n = Math.ceil(b64.length / SNAP_CHUNK);
  const p = dronePose.position;
  console.info(
    `[perfsnap] begin ${n} step ${ms.toFixed(1)}ms bytes ${bytes.length} ` +
      `drone ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}`,
  );
  for (let i = 0; i < n; i++) {
    console.info(`[perfsnap] ${i} ${b64.slice(i * SNAP_CHUNK, (i + 1) * SNAP_CHUNK)}`);
  }
  console.info('[perfsnap] end');
}

export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const { world } = useRapier();

  const frames = useRef(0);
  const worst = useRef(0);
  const last = useRef(performance.now());
  const windowStart = useRef(performance.now());
  const stepStart = useRef(0);
  const stepMs = useRef(0);
  const stepMax = useRef(0);
  const steps = useRef(0);
  /** Time inside Rapier's own `world.step`, apart from the step callbacks. */
  const engineMs = useRef(0);
  const snapped = useRef(false);
  const slowRun = useRef(0);

  // Wrap the world's step so the engine's share can be told from the JS that
  // runs around every step (the drone's controller, the mission, the camera
  // probe's queries). Dev only, and undone on unmount.
  useEffect(() => {
    const w = world as unknown as { step: (...a: unknown[]) => void };
    const raw = w.step;
    w.step = (...a: unknown[]) => {
      const t0 = performance.now();
      raw.apply(world, a);
      const ms = performance.now() - t0;
      engineMs.current += ms;
      slowRun.current = ms > SNAP_STEP_MS ? slowRun.current + 1 : 0;
      if (slowRun.current >= SNAP_RUN && !snapped.current) {
        snapped.current = true;
        logSnapshot(world, ms);
      }
    };
    return () => {
      w.step = raw;
    };
  }, [world]);

  useBeforePhysicsStep(() => {
    stepStart.current = performance.now();
  });
  useAfterPhysicsStep(() => {
    const ms = performance.now() - stepStart.current;
    stepMs.current += ms;
    steps.current++;
    if (ms > stepMax.current) stepMax.current = ms;
  });

  useFrame(() => {
    const now = performance.now();
    const dt = now - last.current;
    last.current = now;
    frames.current++;
    if (dt > worst.current) worst.current = dt;

    const span = now - windowStart.current;
    if (span < WINDOW_SEC * 1000) return;

    const f = frames.current;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const info = gl.info.render;
    const p = dronePose.position;
    console.info(
      `[perf] fps ${Math.round((f * 1000) / span)} worst ${Math.round(worst.current)}ms | ` +
        `phys ${(stepMs.current / Math.max(steps.current, 1)).toFixed(2)}ms ` +
        `x${(steps.current / f).toFixed(1)}/frame (max ${stepMax.current.toFixed(1)}) ` +
        `engine ${(engineMs.current / Math.max(steps.current, 1)).toFixed(2)}ms | ` +
        `heap ${heap ? Math.round(heap.usedJSHeapSize / 1048576) : '?'}MB | ` +
        `calls ${info.calls} tris ${Math.round(info.triangles / 1000)}k | ` +
        `geo ${gl.info.memory.geometries} tex ${gl.info.memory.textures} ` +
        `programs ${gl.info.programs?.length ?? '?'} | ` +
        `colliders ${world.colliders.len()} bodies ${world.bodies.len()} | ` +
        `drone ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
    );

    frames.current = 0;
    worst.current = 0;
    stepMs.current = 0;
    stepMax.current = 0;
    steps.current = 0;
    engineMs.current = 0;
    windowStart.current = now;
  });

  return null;
}

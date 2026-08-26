import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * How many frames to keep the veil up AFTER the shaders report compiled.
 *
 * Compilation is not the whole of a cold start: the first frames still upload
 * textures, build shadow maps and let the physics solver settle. Three is
 * enough for those to land and cheap enough that a warm machine barely sees the
 * veil at all.
 */
const WARM_FRAMES = 3;

/**
 * Release the veil regardless after this long.
 *
 * Insurance, not a schedule. Everything the veil waits on can in principle not
 * arrive — a lost context, a driver that never resolves the compile, a canvas
 * that stops being ticked — and a veil that never lifts is a black screen with
 * a spinner on it, which is worse than the hitching it was hiding.
 */
const VEIL_MAX_MS = 8000;

/**
 * Hold the scene behind a veil until it can actually be drawn at speed.
 *
 * A cold map used to open straight into the flight view and then hitch for a
 * second or two while every material compiled its shader on the frame that
 * first needed it. On a fast machine that reads as a stutter; on an integrated
 * GPU it reads as the app hanging, and it lands exactly when a pilot is forming
 * their first impression of the controls.
 *
 * `compileAsync` does that same work up front, off the critical path where the
 * driver supports parallel compilation. It cannot be made invisible — the cost
 * is real and has to be paid somewhere — so the point is only to move it behind
 * an honest "getting ready" instead of leaving it under a scene the pilot is
 * already trying to fly.
 *
 * Mounted INSIDE the canvas; the veil it releases is DOM, next to the canvas.
 */
export function SceneReady({ onReady }: { onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const compiled = useRef(false);
  const frames = useRef(0);
  const fired = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const finish = () => {
      if (!cancelled) compiled.current = true;
    };
    // Rejects on a lost context, which is not a reason to sit behind the veil
    // forever — both paths release it.
    gl.compileAsync(scene, camera).then(finish, finish);

    const bail = setTimeout(() => {
      if (cancelled || fired.current) return;
      fired.current = true;
      onReady();
    }, VEIL_MAX_MS);

    return () => {
      cancelled = true;
      clearTimeout(bail);
    };
  }, [gl, scene, camera, onReady]);

  useFrame(() => {
    if (fired.current || !compiled.current) return;
    frames.current += 1;
    if (frames.current < WARM_FRAMES) return;
    fired.current = true;
    onReady();
  });

  return null;
}

/** The DOM cover shown while `SceneReady` is warming the scene. */
export function SceneVeil({ label }: { label: string }) {
  return (
    <div className="scene-veil" role="status" aria-live="polite">
      <span className="scene-veil-mark" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

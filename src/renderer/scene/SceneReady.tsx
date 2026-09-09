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
 * How often to look for scene content that arrived after the first compile.
 *
 * Every 30 frames rather than every frame: the check walks the scene graph, and
 * the thing it is watching for — a .glb finishing — happens a handful of times
 * in a session, not sixty times a second.
 */
const RESCAN_FRAMES = 30;

/**
 * How many consecutive stable scans before recompiling.
 *
 * A .glb does not land in one frame: meshes are added as the loader walks the
 * file, so a scan taken mid-load sees a partial scene. Waiting for the count to
 * stop moving means compiling once, when everything has arrived, rather than
 * once per batch of meshes.
 */
const STABLE_SCANS = 2;

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

  // ---- Warming content that arrives AFTER the first compile ----
  //
  // The compile below runs when this mounts, and at that moment the scene is
  // very nearly empty: the environment .glb and the drone both load under
  // Suspense and are added to the graph seconds later. So the up-front compile
  // was warming a scene that did not yet contain the city, and every one of its
  // materials still paid for its own shader on the first frame that drew it.
  //
  // Flying is what exposes it. Programs compile as the geometry that needs them
  // enters view, so a pilot crossing the map at speed meets a fresh material
  // every few seconds and the frame it lands on is a long one — a hitch while
  // moving, on a machine that is otherwise holding its frame rate. (Measured
  // over New York: the program count kept climbing well into the flight.)
  //
  // The fix is to compile again once the graph stops growing. It costs nothing
  // in the steady state — the scan is a walk, and a compile with no new
  // materials returns immediately.
  const scans = useRef(0);
  const objects = useRef(-1);
  const stable = useRef(0);
  const warming = useRef(false);

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
    if (!fired.current && compiled.current) {
      frames.current += 1;
      if (frames.current >= WARM_FRAMES) {
        fired.current = true;
        onReady();
      }
    }

    if (++scans.current < RESCAN_FRAMES) return;
    scans.current = 0;
    if (warming.current) return;

    let count = 0;
    scene.traverse(() => {
      count += 1;
    });

    if (count !== objects.current) {
      // Still growing (or shrinking — swapping arena or drone tears the old one
      // out and builds a new one, whose materials are just as cold).
      objects.current = count;
      stable.current = 0;
      return;
    }

    // Settled. Compile once for this episode, then wait for the next change.
    if (stable.current > STABLE_SCANS) return;
    if (++stable.current <= STABLE_SCANS) return;

    warming.current = true;
    const done = () => {
      warming.current = false;
    };
    gl.compileAsync(scene, camera).then(done, done);
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

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Camera, WebGLProgram } from 'three';
import { create } from 'zustand';
import { allSettled, overallProgress, useResourceStore } from '../assets/resourceTracker';
import { Progress } from '../ds';

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
 * Where the veil's scene has got, for its percentage.
 *
 * A store rather than a prop: `SceneReady` is inside the canvas and the veil is
 * DOM beside it, and a percentage passed up through React state would re-render
 * the whole viewport on every step. Only one flight view is open at a time.
 *
 * `since` is when `SceneReady` mounted. A veil opened after it reads the store
 * as stale: the last view left it at the end, and that read as 100% for the
 * whole of the next map's build.
 */
export interface VeilProgress {
  /** building: the scene is being put together, before `SceneReady` mounts.
   *  compiling: `compileAsync` is out. warming: compiled, counting frames. */
  stage: 'building' | 'compiling' | 'warming';
  /** Shader programs finished over programs created, 0..1. */
  shaders: number;
  /** Warm frames drawn since the compile finished. */
  frames: number;
  since: number;
}

export const useVeilProgress = create<VeilProgress>(() => ({
  stage: 'building',
  shaders: 0,
  frames: 0,
  since: 0,
}));

/**
 * Shader programs finished over programs created.
 *
 * `isReady()` reads KHR_parallel_shader_compile's completion status, which does
 * not wait on the driver (it returns true outright where the extension is
 * missing). It is not in three's typings, hence the cast.
 */
function shaderProgress(programs: WebGLProgram[] | null): number {
  if (!programs || programs.length === 0) return 0;
  let ready = 0;
  for (const p of programs) {
    const isReady = (p as WebGLProgram & { isReady?: () => boolean }).isReady;
    if (!isReady || isReady.call(p)) ready += 1;
  }
  return ready / programs.length;
}

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
    useVeilProgress.setState({ stage: 'compiling', shaders: 0, frames: 0, since: performance.now() });

    // Reading a program's error log waits for the driver to finish compiling
    // it, so three's default check turns every first draw into a stall. Kept in
    // development, where a shader error is worth seeing; a release build has no
    // console to show one in.
    gl.debug.checkShaderErrors = import.meta.env.DEV;

    // Draw nothing while the compile runs.
    //
    // The render loop does not stop behind the veil, and a draw that uses a
    // program the driver has not finished blocks until it has — which is the
    // parallel compile turned back into a serial one, on the main thread.
    // Measured opening Mission 1: ~3.2 s of the veil was that wait (2.1 s of it
    // the transmission pass redrawing the scene for the glass), and in one
    // stretch no script ran for 4.4 s, so the percentage could not move at all.
    //
    // With every layer off, the camera sees nothing and the programs are left to
    // the driver. The compile gets a copy with the real layers: three picks the
    // lights a program is built for by the camera's layers, and programs built
    // for no lights would all be rebuilt on the first real frame.
    const layers = camera.layers.mask;
    // Without its children (three's `clone` would copy those too).
    const compileCamera = new (camera.constructor as new () => Camera)().copy(camera as Camera, false);
    camera.layers.disableAll();
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      camera.layers.mask = layers;
    };

    const finish = () => {
      restore();
      if (cancelled) return;
      compiled.current = true;
      useVeilProgress.setState({ stage: 'warming', shaders: 1 });
    };
    // Rejects on a lost context, which is not a reason to sit behind the veil
    // forever — both paths release it.
    gl.compileAsync(scene, compileCamera).then(finish, finish);

    const bail = setTimeout(() => {
      restore();
      if (cancelled || fired.current) return;
      fired.current = true;
      onReady();
    }, VEIL_MAX_MS);

    return () => {
      cancelled = true;
      restore();
      clearTimeout(bail);
    };
  }, [gl, scene, camera, onReady]);

  useFrame(() => {
    // Only while the compile is out, and only on a whole-percent change.
    const progress = useVeilProgress.getState();
    if (!fired.current && !compiled.current && progress.stage === 'compiling') {
      const next = Math.floor(shaderProgress(gl.info.programs) * 100) / 100;
      if (next > progress.shaders) useVeilProgress.setState({ shaders: next });
    }

    if (!fired.current && compiled.current) {
      frames.current += 1;
      useVeilProgress.setState({ frames: frames.current });
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

/** Share of the bar each stage fills; the rest is the stages before it. */
const BUILD_SHARE = 0.35;
const COMPILE_SHARE = 0.6;

/**
 * How long building the scene usually takes, for the bar while it is unmeasured.
 *
 * React and Rapier putting a map together report no progress, so this stage
 * eases towards its share on the clock instead: ~63% of it by this many ms,
 * never all of it. Chosen by judgement from one measurement (0.8-1.5 s on this
 * Mac, Mission 1); where models are still loading, their bytes are used instead.
 */
const BUILD_TIME_MS = 1500;

/**
 * The veil's percentage, 0..100, stage by stage: the scene being built (models
 * still loading, or the clock), then the shader compile, then the warm frames.
 * 100 only on the last warm frame, the one that lifts the veil.
 */
export function veilPercent(
  progress: Pick<VeilProgress, 'stage' | 'shaders' | 'frames'>,
  building: number,
): number {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  let p: number;
  if (progress.stage === 'building') p = BUILD_SHARE * clamp(building);
  else if (progress.stage === 'compiling') p = BUILD_SHARE + COMPILE_SHARE * clamp(progress.shaders);
  else p = BUILD_SHARE + COMPILE_SHARE + (1 - BUILD_SHARE - COMPILE_SHARE) * clamp(progress.frames / WARM_FRAMES);
  // The epsilon keeps 0.35 + 0.6 * 0.5 from flooring to 64.
  return Math.floor(clamp(p) * 100 + 1e-9);
}

/** How often the veil redraws its percentage, ms. */
const VEIL_TICK_MS = 100;

/** The DOM cover shown while `SceneReady` is warming the scene. */
export function SceneVeil({ label }: { label: string }) {
  const models = useResourceStore((s) => overallProgress(s.entries));
  const stored = useVeilProgress();
  const [openedAt] = useState(() => performance.now());
  const [waitingOnModels] = useState(() => !allSettled(useResourceStore.getState().entries));

  // Redraw on a clock while building, when nothing else changes. The spinner is
  // a CSS animation and turns even while a script is running; this does not,
  // so a long block on the main thread still shows as a pause in the number.
  const [now, setNow] = useState(openedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), VEIL_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Left over from the last view until this one's `SceneReady` mounts.
  const progress = stored.since >= openedAt ? stored : { stage: 'building' as const, shaders: 0, frames: 0 };
  const building = waitingOnModels ? models : 1 - Math.exp(-(now - openedAt) / BUILD_TIME_MS);

  // Never backwards: a .glb that lands mid-compile adds programs, which would
  // pull the ratio down, and a bar that retreats reads as broken.
  const shown = useRef(0);
  shown.current = Math.max(shown.current, veilPercent(progress, building));
  const pct = shown.current;

  return (
    <div className="scene-veil" role="status" aria-live="polite">
      <span className="scene-veil__spinner" aria-hidden="true" />
      <p className="scene-veil__label">{label}</p>
      <div className="scene-veil__meter">
        <b className="scene-veil__pct">{pct}%</b>
        <Progress value={pct} max={100} label={label} tone="neutral" />
      </div>
    </div>
  );
}

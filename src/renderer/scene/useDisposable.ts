import { useEffect, useRef } from 'react';

// ----------------------------------------------------------------------------
// Free three.js GPU resources on unmount — WITHOUT being fooled by StrictMode.
//
// The problem this exists for shows up in the terminal, not on screen:
//
//     GL_INVALID_VALUE: glGetProgramiv: Program object expected.
//
// repeated a few dozen times whenever a view mounts. It is a WebGL driver
// complaint about a shader program that has been deleted and then asked about,
// and the sequence that produces it is entirely a React one.
//
// Every component that builds its own materials and geometries in a `useMemo`
// frees them in an effect cleanup:
//
//     const mat = useMemo(() => new THREE.MeshStandardMaterial(...), []);
//     useEffect(() => () => mat.dispose(), [mat]);        // <- the trap
//
// That is correct on a real unmount and wrong under StrictMode, which in
// development deliberately mounts effects, tears them down, and mounts them
// again to catch exactly this class of bug. The component is NOT re-rendered in
// between, so the `useMemo` values survive — which means the cleanup disposes
// the very materials the remounted component goes on using. three.js quietly
// rebuilds them the next time they are drawn, so nothing looks wrong; what is
// left behind is the driver noise, plus a shader compile per material on every
// mount on a machine that is already VRAM-bound.
//
// The fix is to notice that StrictMode's teardown is followed by a remount in
// the same tick, and a real unmount is not. So the disposal is deferred by one
// macrotask and cancelled if the component comes back.
//
// Usage — the factory's resources are freed once, on the real unmount:
//
//     const mat = useMemo(() => ({ body: new THREE.MeshStandardMaterial() }), []);
//     useDisposable(mat);
//
// It is deliberately NOT a resource-creating hook. Everything here already
// builds its own objects in a memo, and a hook that took that over would be a
// rewrite of five components rather than a fix for one bug.
// ----------------------------------------------------------------------------

/** Anything three.js frees the same way. */
interface Disposable {
  dispose(): void;
}

/**
 * Free `resources` when the component really unmounts.
 *
 * Accepts a single disposable, an array, or a record of them — which is the
 * shape these are already held in, so adopting it is a one-line change at each
 * call site.
 */
export function useDisposable(
  ...resources: (
    Disposable | readonly Disposable[] | Record<string, Disposable> | null | undefined
  )[]
): void {
  /** False between the teardown and the remount StrictMode fakes. A real
   *  unmount leaves it false for good, which is the whole signal. */
  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    live.current = true;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return () => {
      live.current = false;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (live.current) return;
        for (const r of resources) {
          if (!r) continue;
          if (isDisposable(r)) r.dispose();
          else for (const one of Object.values(r)) one?.dispose();
        }
      }, 0);
    };
    // The resources themselves are the dependencies: they are memoised by the
    // caller and stable for the life of the component, so this runs once. The
    // rest array is a fresh array each render but React compares it
    // element-wise, and its LENGTH is fixed by the call site's argument count.
  }, resources);
}

function isDisposable(
  v: Disposable | readonly Disposable[] | Record<string, Disposable>,
): v is Disposable {
  return typeof (v as Disposable).dispose === 'function';
}

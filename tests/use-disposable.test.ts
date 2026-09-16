// @vitest-environment jsdom
import { createElement, StrictMode, useMemo } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useDisposable } from '../src/renderer/scene/useDisposable';

// TC-050 — three.js resources must survive StrictMode's fake unmount.
//
// The bug this pins filled the terminal rather than the screen:
//
//     GL_INVALID_VALUE: glGetProgramiv: Program object expected.
//
// a few dozen times on every view that builds its own materials. React's
// StrictMode deliberately mounts effects, tears them down and mounts them again
// in development, and the component is NOT re-rendered in between — so its
// `useMemo` values survive while a plain `useEffect(() => () => mat.dispose())`
// frees them. three.js silently rebuilds what it needs, so nothing looks wrong;
// what is left is driver noise and a shader compile per material on every
// mount, on a machine that is already VRAM-bound.
//
// Every one of the five components that hit this (`Tiger`, `DroneSpotlight`,
// `CasualtyFigure`, `Storefront`, `HydrantFillPoint`) now frees through
// `useDisposable`, and the whole of what makes that correct is the behaviour
// below. It cannot be checked by eye — a disposed material still draws.

/** React's own `act` needs this flag, and jsdom does not set it. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for a `THREE.Material` — all this hook wants is `dispose`. */
function fake() {
  return { dispose: vi.fn() };
}

/**
 * Mount a component under StrictMode, optionally unmount it, and run the timers
 * the deferred disposal hangs off.
 */
async function run(
  hook: () => void,
  { unmount }: { unmount: boolean },
): Promise<void> {
  vi.useFakeTimers();
  const host = document.createElement('div');
  const root = createRoot(host);
  const Probe = () => {
    hook();
    return null;
  };
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(Probe)));
  });
  if (unmount) {
    await act(async () => {
      root.unmount();
    });
  }
  // The disposal is deferred by one macrotask, so nothing has happened yet.
  await act(async () => {
    vi.runAllTimers();
  });
  vi.useRealTimers();
}

describe('TC-050 useDisposable survives StrictMode', () => {
  it('does not free resources on the unmount StrictMode fakes', async () => {
    const mat = fake();
    await run(() => {
      // The memo is what makes this the real case: StrictMode's teardown and
      // remount do not re-render, so the component keeps this exact object.
      const held = useMemo(() => mat, []);
      useDisposable(held);
    }, { unmount: false });
    expect(mat.dispose).not.toHaveBeenCalled();
  });

  it('frees them once on a real unmount', async () => {
    const mat = fake();
    await run(() => {
      const held = useMemo(() => mat, []);
      useDisposable(held);
    }, { unmount: true });
    expect(mat.dispose).toHaveBeenCalledTimes(1);
  });

  it('takes the shapes the call sites already hold their resources in', async () => {
    // A record, an array and a bare disposable — `Tiger` passes records,
    // `DroneSpotlight` passes four bare ones.
    const record = { a: fake(), b: fake() };
    const list = [fake(), fake()];
    const bare = fake();
    await run(() => {
      const r = useMemo(() => record, []);
      const l = useMemo(() => list, []);
      const b = useMemo(() => bare, []);
      useDisposable(r, l, b);
    }, { unmount: true });
    for (const m of [record.a, record.b, ...list, bare]) {
      expect(m.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it('tolerates a resource that is not there yet', async () => {
    const mat = fake();
    await run(() => {
      const held = useMemo(() => mat, []);
      useDisposable(null, held, undefined);
    }, { unmount: true });
    expect(mat.dispose).toHaveBeenCalledTimes(1);
  });
});

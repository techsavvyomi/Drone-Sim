import { beforeEach, vi } from 'vitest';

// The renderer talks to the main process through `window.api`, which does not
// exist in Node. Only the settings channels are reached by anything under test,
// so this stands in for them with an in-memory document.
//
// It is a `globalThis.window` rather than a module mock because the stores read
// `window.api` at call time, not at import time.
let stored: Record<string, unknown> = {};

export function setStoredSettings(next: Record<string, unknown>): void {
  stored = next;
}

export function getStoredSettings(): Record<string, unknown> {
  return stored;
}

beforeEach(() => {
  stored = {};
  const api = {
    loadSettings: vi.fn(async () => stored),
    saveSettings: vi.fn(async (s: Record<string, unknown>) => {
      stored = s;
    }),
    appInfo: vi.fn(async () => ({
      name: 'Drone Flight Simulator',
      version: '0.1.0',
      platform: 'darwin',
      electron: '43.0.0',
    })),
  };

  // Only `api` is ours to define. A file that opts into jsdom
  // (`// @vitest-environment jsdom`) has a REAL window — listeners, focus, the
  // DOM — and this used to replace the whole object, so `addEventListener`
  // stopped being a function in every such test. A Node test still gets the bare
  // stand-in, which is all it ever needed.
  const g = globalThis as Record<string, unknown>;
  const existing = g.window as { addEventListener?: unknown } | undefined;
  if (existing && typeof existing.addEventListener === 'function') {
    (existing as Record<string, unknown>).api = api;
  } else {
    g.window = { api };
  }
});

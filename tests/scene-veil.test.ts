import { describe, expect, it } from 'vitest';
import { veilPercent } from '../src/renderer/scene/SceneReady';

// "Getting the arena ready" shows how far along it is: models still loading
// behind the menu first, then the shader warm-up.

describe('scene veil percentage', () => {
  it('is the shader warm-up alone when every model was already in', () => {
    expect(veilPercent(1, 0, false)).toBe(0);
    expect(veilPercent(1, 0.5, false)).toBe(50);
    expect(veilPercent(1, 1, false)).toBe(100);
  });

  it('counts models first when the view opened while they were still loading', () => {
    expect(veilPercent(0, 0, true)).toBe(0);
    expect(veilPercent(0.5, 0, true)).toBe(30);
    expect(veilPercent(1, 0, true)).toBe(60);
    expect(veilPercent(1, 1, true)).toBe(100);
  });

  it('stays within 0-100', () => {
    expect(veilPercent(2, 2, true)).toBe(100);
    expect(veilPercent(-1, -1, false)).toBe(0);
  });
});

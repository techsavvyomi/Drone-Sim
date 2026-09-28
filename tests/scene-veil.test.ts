import { describe, expect, it } from 'vitest';
import { veilPercent } from '../src/renderer/scene/SceneReady';

// "Getting the arena ready" counts up through the stages the veil is actually
// waiting on — the scene being built, the shader compile, the warm frames — and
// reaches 100 only on the frame that lifts it.

const at = (stage: 'building' | 'compiling' | 'warming', shaders = 0, frames = 0) => ({ stage, shaders, frames });

describe('scene veil percentage', () => {
  it('starts at 0 and fills its first share while the scene is built', () => {
    expect(veilPercent(at('building'), 0)).toBe(0);
    expect(veilPercent(at('building'), 0.5)).toBe(17);
    expect(veilPercent(at('building'), 1)).toBe(35);
  });

  it('counts the shader compile next, and never shows 100 before the warm frames', () => {
    expect(veilPercent(at('compiling', 0), 1)).toBe(35);
    expect(veilPercent(at('compiling', 0.5), 1)).toBe(65);
    expect(veilPercent(at('compiling', 1), 1)).toBe(95);
    expect(veilPercent(at('warming', 1, 0), 1)).toBe(95);
    expect(veilPercent(at('warming', 1, 2), 1)).toBeLessThan(100);
    expect(veilPercent(at('warming', 1, 3), 1)).toBe(100);
  });

  it('ignores the building figure once the compile is out', () => {
    expect(veilPercent(at('compiling', 0.5), 0)).toBe(veilPercent(at('compiling', 0.5), 1));
  });

  it('stays within 0-100', () => {
    expect(veilPercent(at('building'), 5)).toBe(35);
    expect(veilPercent(at('building'), -1)).toBe(0);
    expect(veilPercent(at('warming', 1, 9), 1)).toBe(100);
  });
});

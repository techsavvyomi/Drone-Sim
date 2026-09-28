import { describe, expect, it } from 'vitest';
import { LOW_FPS, SLOW_WINDOWS, stepDown } from '../src/renderer/scene/AutoQuality';
import { DEFAULT_SETTINGS } from '../src/shared/types';

// A machine that cannot hold its preset gets the next one down, never up and
// never below Low, and only after more than one slow window.

describe('automatic graphics quality', () => {
  it('steps one level down at a time and stops at Low', () => {
    expect(stepDown('high')).toBe('medium');
    expect(stepDown('medium')).toBe('low');
    expect(stepDown('low')).toBeNull();
  });

  it('is on by default, and waits for more than one slow window', () => {
    expect(DEFAULT_SETTINGS.autoGraphics).toBe(true);
    expect(SLOW_WINDOWS).toBeGreaterThan(1);
    expect(LOW_FPS).toBeGreaterThan(20);
    expect(LOW_FPS).toBeLessThan(40);
  });
});

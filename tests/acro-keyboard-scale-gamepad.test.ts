import { describe, expect, it, vi } from 'vitest';

// The same scale with a gamepad flying: it must be 1, so the pad keeps 670 deg/s.
vi.mock('../src/renderer/input/gamepad', () => ({
  consumeGamepadActivity: () => true,
  gamepadConnected: () => true,
  gamepadStick: { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 },
  setActionHandler: () => undefined,
}));

const { acroRateScaleFor, updateStick, activeInputSource } = await import('../src/renderer/input/controls');
const { racingDrone } = await import('../src/renderer/plugins/drones/racer');

describe('keyboard Acro rate scale, gamepad flying', () => {
  it('is 1 once the pad is the active device', () => {
    updateStick(1 / 60);
    expect(activeInputSource()).toBe('gamepad');
    expect(acroRateScaleFor(racingDrone)).toBe(1);
  });
});

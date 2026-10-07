import { describe, expect, it, vi } from 'vitest';

// The same scale with a gamepad flying: it must be 1, so the pad keeps 670 deg/s.
vi.mock('../src/renderer/input/gamepad', () => ({
  consumeGamepadActivity: () => true,
  gamepadConnected: () => true,
  gamepadLive: { kind: 'standard' },
  gamepadStick: { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 },
  setActionHandler: () => undefined,
}));

const { acroRateScaleFor, updateStick, activeInputSource, throttleRestsAtCentre, throttleSafeToArm } = await import('../src/renderer/input/controls');
const { gamepadLive, gamepadStick } = await import('../src/renderer/input/gamepad');
const { useFlightStore } = await import('../src/renderer/state/flightStore');
const { racingDrone } = await import('../src/renderer/plugins/drones/racer');

describe('keyboard Acro rate scale, gamepad flying', () => {
  it('is 1 once the pad is the active device', () => {
    updateStick(1 / 60);
    expect(activeInputSource()).toBe('gamepad');
    expect(acroRateScaleFor(racingDrone)).toBe(1);
  });

  it('requires idle throttle on a radio in Acro, while a gamepad rests at centre', () => {
    useFlightStore.setState({ mode: 'acro' });
    gamepadLive.kind = 'rc';
    gamepadStick.throttle = 0.5;
    updateStick(1 / 60);
    expect(throttleRestsAtCentre('acro')).toBe(false);
    expect(throttleSafeToArm()).toBe(false);
    gamepadStick.throttle = 0;
    updateStick(1 / 60);
    expect(throttleSafeToArm()).toBe(true);
    gamepadLive.kind = 'standard';
    gamepadStick.throttle = 0.5;
    updateStick(1 / 60);
    expect(throttleRestsAtCentre('acro')).toBe(true);
    expect(throttleSafeToArm()).toBe(true);
  });
});

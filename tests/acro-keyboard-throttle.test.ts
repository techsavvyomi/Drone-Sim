// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachKeyboard,
  resetStick,
  setScripted,
  stick,
  updateStick,
} from '../src/renderer/input/controls';
import { useFlightStore } from '../src/renderer/state/flightStore';

// Acro on the keyboard: W and S walk the throttle at 0.7 of its range per
// second, and letting go leaves it where it is. 0.7 is the user's starting
// value, to be tuned by feel — change it here and in controls.ts together.

const INITIAL_FLIGHT = { ...useFlightStore.getState() };
let detachKeys: (() => void) | undefined;

function press(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
}
function release(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
}
function run(seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 100); i++) updateStick(0.01);
}

beforeEach(() => {
  useFlightStore.setState({ ...INITIAL_FLIGHT, mode: 'acro', onGround: false }, true);
  setScripted(false);
  resetStick();
  detachKeys = attachKeyboard();
});

afterEach(() => {
  detachKeys?.();
  detachKeys = undefined;
});

describe('Acro keyboard throttle', () => {
  it('W raises it at 0.7 per second and it stays when released', () => {
    expect(stick.throttle).toBe(0);
    press('KeyW');
    run(0.5);
    release('KeyW');
    expect(stick.throttle).toBeCloseTo(0.35, 2);
    run(2);
    expect(stick.throttle).toBeCloseTo(0.35, 2);
  });

  it('S lowers it at the same rate, and it stays when released', () => {
    stick.throttle = 0.8;
    press('KeyS');
    run(0.5);
    release('KeyS');
    expect(stick.throttle).toBeCloseTo(0.45, 2);
    run(2);
    expect(stick.throttle).toBeCloseTo(0.45, 2);
  });

  it('Altitude Hold keeps its own rate and spring', () => {
    useFlightStore.setState({ mode: 'altitude-hold' });
    resetStick();
    press('KeyW');
    run(0.2);
    release('KeyW');
    expect(stick.throttle).toBeCloseTo(0.5 + 0.85 * 0.2, 2);
    run(1);
    expect(stick.throttle).toBeCloseTo(0.5, 1);
  });
});

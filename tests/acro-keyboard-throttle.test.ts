// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acroKeyThrottleRate,
  attachKeyboard,
  resetStick,
  setHoverThrottle,
  setScripted,
  stick,
  updateStick,
} from '../src/renderer/input/controls';
import { useFlightStore } from '../src/renderer/state/flightStore';

// Acro on the keyboard: W and S walk the throttle so that idle to hover takes
// 0.7 s on every airframe, and letting go leaves it where it is. The rate is
// the airframe's hover fraction / 0.7 s: Pluto ~0.70/s, Racer ~0.39/s.

const G = 9.81;
/** Weight over full thrust, as the drone computes it (spec mass x g / sum of maxThrustN). */
const HOVER = { pluto: (0.05 * G) / (4 * 0.25), guru: (1.5 * G) / (4 * 7.36), racer: (0.72 * G) / (4 * 6.4) };

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
  setHoverThrottle(HOVER.pluto);
  resetStick();
  detachKeys = attachKeyboard();
});

afterEach(() => {
  detachKeys?.();
  detachKeys = undefined;
});

describe('Acro keyboard throttle', () => {
  it('W raises it at ~0.7 per second on the Pluto and it stays when released', () => {
    expect(acroKeyThrottleRate()).toBeCloseTo(0.70, 2);
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

  it('the Racer walks it at ~0.39 per second', () => {
    setHoverThrottle(HOVER.racer);
    expect(acroKeyThrottleRate()).toBeCloseTo(0.394, 3);
    press('KeyW');
    run(0.5);
    release('KeyW');
    expect(stick.throttle).toBeCloseTo(0.197, 2);
  });

  it('idle to hover takes ~0.7 s on every airframe', () => {
    for (const hover of Object.values(HOVER)) {
      setHoverThrottle(hover);
      stick.throttle = 0;
      press('KeyW');
      let t = 0;
      while (stick.throttle < hover && t < 3) {
        updateStick(0.01);
        t += 0.01;
      }
      release('KeyW');
      expect(t).toBeCloseTo(0.7, 1);
    }
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

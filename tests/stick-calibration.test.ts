import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAMEPAD, type GamepadSettings } from '../src/shared/types';
import {
  attachGamepad,
  beginCalibration,
  calibrationPhase,
  calibrationProgress,
  captureCenter,
  finishCalibration,
  isCalibrating,
} from '../src/renderer/input/gamepad';

// Calibration is two steps: centre every stick and confirm, then sweep each one
// to both ends. The centre is what the pilot confirmed, not wherever the sticks
// sat when Calibrate was clicked.

const cfg: GamepadSettings = {
  ...DEFAULT_GAMEPAD,
  axes: {
    roll: { axis: 0, invert: false },
    pitch: { axis: 1, invert: false },
    throttle: { axis: 2, invert: false },
    yaw: { axis: 3, invert: false },
  },
};

let axes = [0, 0, 0, 0];
let frame: FrameRequestCallback | null = null;
let detach: () => void = () => {};

/** Feed one frame of stick positions through the poll loop. */
function step(next: number[]): void {
  axes = next;
  const f = frame;
  frame = null;
  f?.(0);
}

beforeEach(() => {
  const pad = {
    index: 0,
    id: 'Xbox Wireless Controller',
    mapping: 'standard',
    connected: true,
    get axes() {
      return axes;
    },
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
  };
  vi.stubGlobal('navigator', { getGamepads: () => [pad] });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  detach = attachGamepad();
});

afterEach(() => {
  detach();
  vi.unstubAllGlobals();
});

describe('stick calibration', () => {
  it('waits for the centre before measuring anything', () => {
    // Throttle parked at the bottom when Calibrate is clicked.
    step([0, 0, -1, 0]);
    beginCalibration();
    expect(calibrationPhase()).toBe('center');
    step([0.9, -0.9, -1, 0.9]);
    // Sweeping before OK records nothing.
    expect(calibrationProgress(cfg).roll.done).toBe(false);
    expect(finishCalibration(cfg)).toEqual({});
    expect(isCalibrating()).toBe(false);
  });

  it('takes the confirmed centre, then min and max, for every channel', () => {
    beginCalibration();
    // Centred, with a radio-style off-centre rest on yaw.
    for (let i = 0; i < 5; i++) step([0.02, -0.01, 0, 0.1]);
    captureCenter();
    expect(calibrationPhase()).toBe('sweep');
    step([-0.8, -0.85, -0.9, -0.7]);
    step([0.8, 0.85, 0.9, 0.75]);
    step([0.02, -0.01, 0, 0.1]);
    const p = calibrationProgress(cfg);
    expect(Object.values(p).every((c) => c.done)).toBe(true);
    const cal = finishCalibration(cfg);
    expect(cal.roll).toEqual({ lo: -0.8, mid: expect.closeTo(0.02, 5), hi: 0.8 });
    expect(cal.throttle).toEqual({ lo: -0.9, mid: expect.closeTo(0, 5), hi: 0.9 });
    expect(cal.yaw?.mid).toBeCloseTo(0.1, 5);
    expect(isCalibrating()).toBe(false);
  });

  it('leaves a channel swept only one way uncalibrated', () => {
    beginCalibration();
    step([0, 0, 0, 0]);
    captureCenter();
    step([0.9, 0.9, 0.9, 0.9]);
    step([-0.9, 0, -0.9, -0.9]);
    const cal = finishCalibration(cfg);
    expect(cal.pitch).toBeUndefined();
    expect(cal.roll).toBeDefined();
  });
});

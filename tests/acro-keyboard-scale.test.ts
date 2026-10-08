import { beforeEach, describe, expect, it } from 'vitest';
import {
  acroRateScaleFor,
  KEYBOARD_ACRO_SCALE,
  resetStick,
  setScripted,
} from '../src/renderer/input/controls';
import {
  acroRateDps,
  FlightController,
  SIM_ACRO_RATES,
  type ControlState,
} from '../src/renderer/sim/control/flightController';
import { DEG2RAD } from '../src/renderer/sim/mathx';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { racingDrone } from '../src/renderer/plugins/drones/racer';
import { testSpec } from './helpers/airframe';

// Keyboard Acro scale: every airframe's keyboard flies Acro at 0.4 of the
// shared curve (620 -> 248 deg/s at a full key), unless `handling.keyboardAcroScale`
// says otherwise. The scale is on the RATE out of acroRateDps, on roll, pitch and
// yaw; a gamepad keeps the full 620.

const state: ControlState = {
  rotation: [0, 0, 0, 1],
  angvelWorld: [0, 0, 0],
  velocityWorld: [0, 0, 0],
  position: [0, 5, 0],
  inertia: [0.01, 0.02, 0.01],
  mass: 0.72,
  maxPerMotor: 10,
  groundEffect: 1,
  onGround: false,
  contactState: 'AIRBORNE',
};

beforeEach(() => {
  setScripted(false);
  resetStick();
});

describe('keyboard Acro rate scale', () => {
  it('defaults to 0.4 on every airframe, overridable per airframe', () => {
    expect(KEYBOARD_ACRO_SCALE).toBe(0.4);
    expect(acroRateScaleFor(racingDrone)).toBe(0.4); // no pad: the keyboard is flying
    expect(acroRateScaleFor(plutoDrone)).toBe(0.4);
    expect(acroRateScaleFor(testSpec({ handling: { keyboardAcroScale: 0.7 } }))).toBe(0.7);
  });

  it('is not applied to a scripted demonstration', () => {
    setScripted(true);
    expect(acroRateScaleFor(racingDrone)).toBe(1);
  });

  it('scales the roll, pitch and yaw RATE: a full key is 248 deg/s', () => {
    const fc = new FlightController(racingDrone);
    fc.update({ roll: 1, pitch: -1, yaw: 1, throttle: 0.5 }, 'acro', state, 0.004, undefined, false, false, 0.4);
    expect(-fc.rateSp.roll / DEG2RAD).toBeCloseTo(620 * 0.4, 6);
    expect(fc.rateSp.pitch / DEG2RAD).toBeCloseTo(620 * 0.4, 6);
    expect(-fc.rateSp.yaw / DEG2RAD).toBeCloseTo(620 * 0.4, 6);
    // Scaled after the curve, so half a key is 0.4 of the curve at half, not the curve at 0.2.
    fc.update({ roll: 0.5, pitch: 0, yaw: 0, throttle: 0.5 }, 'acro', state, 0.004, undefined, false, false, 0.4);
    expect(-fc.rateSp.roll / DEG2RAD).toBeCloseTo(acroRateDps(0.5, SIM_ACRO_RATES) * 0.4, 6);
  });

  it('a scale of 1 (the gamepad) flies the full 620 on every axis', () => {
    const fc = new FlightController(racingDrone);
    fc.update({ roll: 1, pitch: 0, yaw: -1, throttle: 0.5 }, 'acro', state, 0.004, undefined, false, false, 1);
    expect(-fc.rateSp.roll / DEG2RAD).toBeCloseTo(620, 6);
    expect(-fc.rateSp.yaw / DEG2RAD).toBeCloseTo(-620, 6);
  });
});

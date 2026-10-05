import { beforeEach, describe, expect, it } from 'vitest';
import { acroRateScaleFor, resetStick, setScripted } from '../src/renderer/input/controls';
import {
  acroRateDps,
  BETAFLIGHT_ACRO_RATES,
  FlightController,
  type ControlState,
} from '../src/renderer/sim/control/flightController';
import { DEG2RAD } from '../src/renderer/sim/mathx';
import { racingDrone } from '../src/renderer/plugins/drones/racer';
import { testSpec } from './helpers/airframe';

// `handling.keyboardAcroScale`: the keyboard flies the Racer's Acro at 0.4 of
// its Betaflight rate (670 -> ~268 deg/s at a full key). The scale is on the
// RATE out of acroRateDps, roll and pitch only; yaw and the gamepad keep theirs.

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
  it('comes from the airframe, defaulting to 1', () => {
    expect(racingDrone.handling?.keyboardAcroScale).toBe(0.4);
    expect(acroRateScaleFor(racingDrone)).toBe(0.4); // no pad: the keyboard is flying
    expect(acroRateScaleFor(testSpec())).toBe(1);
  });

  it('is not applied to a scripted demonstration', () => {
    setScripted(true);
    expect(acroRateScaleFor(racingDrone)).toBe(1);
  });

  it('scales the roll and pitch RATE: a full key is ~268 deg/s on the Racer', () => {
    const fc = new FlightController(racingDrone);
    fc.update({ roll: 1, pitch: -1, yaw: 0.5, throttle: 0.5 }, 'acro', state, 0.004, undefined, false, false, 0.4);
    expect(-fc.rateSp.roll / DEG2RAD).toBeCloseTo(670 * 0.4, 6);
    expect(fc.rateSp.pitch / DEG2RAD).toBeCloseTo(670 * 0.4, 6);
    // Scaled after the curve, so half a key is 0.4 of the curve at half, not the curve at 0.2.
    fc.update({ roll: 0.5, pitch: 0, yaw: 0, throttle: 0.5 }, 'acro', state, 0.004, undefined, false, false, 0.4);
    expect(-fc.rateSp.roll / DEG2RAD).toBeCloseTo(acroRateDps(0.5, BETAFLIGHT_ACRO_RATES) * 0.4, 6);
  });

  it('leaves yaw, and a scale of 1 (the gamepad), untouched', () => {
    const fc = new FlightController(racingDrone);
    fc.update({ roll: 1, pitch: 0, yaw: 0.5, throttle: 0.5 }, 'acro', state, 0.004, undefined, false, false, 0.4);
    const yawScaled = fc.rateSp.yaw;
    fc.update({ roll: 1, pitch: 0, yaw: 0.5, throttle: 0.5 }, 'acro', state, 0.004, undefined, false, false, 1);
    expect(fc.rateSp.yaw).toBe(yawScaled);
    expect(-fc.rateSp.roll / DEG2RAD).toBeCloseTo(670, 6);
  });
});

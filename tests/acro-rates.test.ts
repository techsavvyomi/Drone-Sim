import { describe, expect, it } from 'vitest';
import {
  acroRateDps,
  BETAFLIGHT_ACRO_RATES,
  FlightController,
  MAGIS_ACRO_RATES,
  SIM_ACRO_RATES,
  type ControlState,
} from '../src/renderer/sim/control/flightController';
import { DEG2RAD } from '../src/renderer/sim/mathx';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { racingDrone } from '../src/renderer/plugins/drones/racer';

// Acro's stick-to-rate curve is the firmware's own arithmetic. These are the
// numbers MagisV2 and Betaflight produce for their default profiles, worked by
// hand from the source, so a change to the curve has to be a change on purpose.

describe('acroRateDps', () => {
  it('follows the Magis (Pluto) table: rcRate 90, expo 65, rates 0', () => {
    // lookupPitchRollRC = [0, 33.84, 81.72, 157.68, 275.76, 450]; deg/s = 20·rc/16/4.1
    expect(acroRateDps(0, MAGIS_ACRO_RATES)).toBe(0);
    expect(acroRateDps(0.2, MAGIS_ACRO_RATES)).toBeCloseTo((20 * 33.84) / 16 / 4.1, 3);
    expect(acroRateDps(1, MAGIS_ACRO_RATES)).toBeCloseTo((20 * 450) / 16 / 4.1, 3); // ~137
    expect(acroRateDps(-1, MAGIS_ACRO_RATES)).toBeCloseTo(-acroRateDps(1, MAGIS_ACRO_RATES), 6);
  });

  it('follows Betaflight Actual defaults: 70 centre, 670 max', () => {
    expect(acroRateDps(1, BETAFLIGHT_ACRO_RATES)).toBeCloseTo(670, 6);
    expect(acroRateDps(0.5, BETAFLIGHT_ACRO_RATES)).toBeCloseTo(35 + 600 * 0.25, 6);
    expect(acroRateDps(-0.5, BETAFLIGHT_ACRO_RATES)).toBeCloseTo(-185, 6);
  });

  it('the sim curve: 100 centre, 620 max, expo 0.20', () => {
    // 0.5·100 + 520·0.5·(0.5⁵·0.2 + 0.5·0.8) = 50 + 520·0.203125
    expect(acroRateDps(0.5, SIM_ACRO_RATES)).toBeCloseTo(155.625, 6);
    expect(acroRateDps(1, SIM_ACRO_RATES)).toBeCloseTo(620, 6);
    expect(acroRateDps(-1, SIM_ACRO_RATES)).toBeCloseTo(-620, 6);
  });
});

const state: ControlState = {
  rotation: [0, 0, 0, 1],
  angvelWorld: [0, 0, 0],
  velocityWorld: [0, 0, 0],
  position: [0, 5, 0],
  inertia: [0.01, 0.02, 0.01],
  mass: 0.1,
  maxPerMotor: 10,
  groundEffect: 1,
  onGround: false,
  contactState: 'AIRBORNE',
};

describe('every airframe flies Acro on the sim curve', () => {
  it.each([plutoDrone, guruDrone, racingDrone])('$id: 620 deg/s on roll, pitch and yaw at full stick', (spec) => {
    const fc = new FlightController(spec);
    fc.update({ roll: 1, pitch: 1, yaw: 1, throttle: 0.5 }, 'acro', state, 0.004);
    expect(-fc.rateSp.roll / DEG2RAD).toBeCloseTo(620, 6);
    expect(-fc.rateSp.pitch / DEG2RAD).toBeCloseTo(620, 6);
    expect(-fc.rateSp.yaw / DEG2RAD).toBeCloseTo(620, 6);
  });

  it('Stabilize keeps the linear maxYawRate yaw', () => {
    const fc = new FlightController(racingDrone);
    fc.update({ roll: 0, pitch: 0, yaw: 1, throttle: 0.5 }, 'stabilize', state, 0.004);
    expect(-fc.rateSp.yaw).toBeCloseTo(4.0, 6);
  });
});

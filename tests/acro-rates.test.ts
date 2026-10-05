import { describe, expect, it } from 'vitest';
import {
  acroRateDps,
  BETAFLIGHT_ACRO_RATES,
  MAGIS_ACRO_RATES,
} from '../src/renderer/sim/control/flightController';

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
});

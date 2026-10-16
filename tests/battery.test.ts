import { describe, expect, it } from 'vitest';
import {
  Battery,
  BATTERY_CRITICAL_V,
  BATTERY_CUTOFF_V,
  BATTERY_WARNING_V,
  socForVoltage,
} from '../src/renderer/sim/dynamics/battery';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { racingDrone } from '../src/renderer/plugins/drones/racer';

// The 1S LiPo model: the discharge curve, sag under load, and the three
// voltages the HUD and the forced landing are written against.

const SPEC = plutoDrone.battery;
/** Thrust fraction that corresponds to a hover, as the sim passes it in. */
const HOVER = 0.5;

describe('discharge curve', () => {
  it('TC-086 a full pack reads 4.2 V per cell', () => {
    const b = new Battery(SPEC);

    const s = b.update(HOVER, HOVER, 0);

    expect(s.soc).toBeCloseTo(1, 3);
    expect(s.restingVoltage).toBeCloseTo(4.2, 2);
  });

  it('TC-086 voltage is not a straight line against charge', () => {
    // A real LiPo sits near 3.7-3.85 V for most of the flight and then falls
    // off a cliff. A linear model would put the 50% reading at 3.7 V.
    const half = socForVoltage(3.775);
    const low = socForVoltage(3.5);

    expect(half).toBeGreaterThan(0.45);
    expect(half).toBeLessThan(0.55);
    // 3.5 V is already down at a fifth of the pack, not a third.
    expect(low).toBeCloseTo(0.2, 1);
  });

  it('TC-086 socForVoltage inverts the curve at every charge level', () => {
    // Genuinely drain the pack down to each level and read the voltage back:
    // the inverse only means anything if it is checked away from a full pack.
    const b = new Battery(SPEC);
    let state = b.update(HOVER, HOVER, 0);
    const checked: number[] = [];

    for (const target of [0.8, 0.6, 0.4, 0.2]) {
      while (state.soc > target) state = b.update(1, HOVER, 1);
      expect(socForVoltage(state.restingVoltage, SPEC.cells)).toBeCloseTo(state.soc, 2);
      checked.push(state.soc);
    }

    // The pack really did fall through the whole range, rather than the loop
    // testing a full battery four times over.
    expect(checked).toHaveLength(4);
    expect(checked[0]).toBeGreaterThan(checked[3]);
    expect(checked[3]).toBeLessThan(0.25);
  });

  it('TC-086 charge outside the curve clamps rather than running away', () => {
    expect(socForVoltage(5)).toBe(1);
    expect(socForVoltage(1)).toBe(0);
  });
});

describe('sag under load', () => {
  it('TC-086 a full-throttle punch pulls the voltage below the hover reading', () => {
    const b = new Battery(SPEC);
    const hover = b.update(HOVER, HOVER, 0);

    const punch = b.update(1, HOVER, 0);

    expect(punch.voltage).toBeLessThan(hover.voltage);
    // Sized to roughly 0.13 V at full throttle on a 1S pack.
    expect(hover.voltage - punch.voltage).toBeGreaterThan(0.08);
    expect(hover.voltage - punch.voltage).toBeLessThan(0.2);
  });

  it('TC-086 releasing the throttle lets the voltage recover', () => {
    const b = new Battery(SPEC);
    const punch = b.update(1, HOVER, 0);

    const released = b.update(HOVER, HOVER, 0);

    expect(released.voltage).toBeGreaterThan(punch.voltage);
  });

  it('TC-086 at a hover the reading sits on the curve, with no sag', () => {
    const b = new Battery(SPEC);

    const s = b.update(HOVER, HOVER, 0);

    expect(s.voltage).toBeCloseTo(s.restingVoltage, 3);
  });

  it('TC-086 a harder throttle draws more current', () => {
    const b = new Battery(SPEC);

    const idle = b.update(0, HOVER, 0);
    const hover = b.update(HOVER, HOVER, 0);
    const full = b.update(1, HOVER, 0);

    expect(idle.current).toBeLessThan(hover.current);
    expect(hover.current).toBeLessThan(full.current);
  });
});

describe('thresholds and drain', () => {
  it('TC-087 TC-088 TC-089 the three thresholds are ordered and correct', () => {
    expect(BATTERY_WARNING_V).toBe(3.5);
    expect(BATTERY_CRITICAL_V).toBe(3.3);
    expect(BATTERY_CUTOFF_V).toBe(3.0);
    expect(BATTERY_WARNING_V).toBeGreaterThan(BATTERY_CRITICAL_V);
    expect(BATTERY_CRITICAL_V).toBeGreaterThan(BATTERY_CUTOFF_V);
  });

  it('TC-086 a hover drains the pack over roughly the target flight time', () => {
    const b = new Battery(SPEC, 7.5);
    let state = b.update(HOVER, HOVER, 0);

    // Seven and a half minutes of hovering, a second at a time.
    for (let t = 0; t < 7.5 * 60; t++) state = b.update(HOVER, HOVER, 1);

    // The model drains the usable 95% over the target, so a little is left.
    expect(state.soc).toBeLessThan(0.1);
    expect(state.soc).toBeGreaterThanOrEqual(0);
  });

  it('TC-086 thrust falls as the pack empties, but never to nothing', () => {
    const b = new Battery(SPEC);
    const full = b.update(HOVER, HOVER, 0);

    let state = full;
    for (let t = 0; t < 20 * 60; t++) state = b.update(1, HOVER, 1);

    expect(state.thrustScale).toBeLessThan(full.thrustScale);
    // Floored so the drone stays controllable through the forced landing.
    expect(state.thrustScale).toBeGreaterThanOrEqual(0.55);
  });

  it('TC-089 a reset refills the pack', () => {
    const b = new Battery(SPEC);
    for (let t = 0; t < 300; t++) b.update(1, HOVER, 1);

    b.reset();
    const s = b.update(HOVER, HOVER, 0);

    expect(s.soc).toBeCloseTo(1, 3);
  });
});

// The forced landing compares the per-cell voltage with the 1S limits. Racer
// and Guru are 4S: their whole pack read 12.8 V when empty, never under 3.3 V,
// so they flew on at 0% with only "Land soon" (tester, TC-FF-010).
describe('multi-cell packs reach the limits', () => {
  for (const drone of [guruDrone, racingDrone]) {
    it(`TC-FF-010 ${drone.name} (${drone.battery.cells}S) warns, goes critical and empties`, () => {
      const b = new Battery(drone.battery);
      const seen = { warning: false, critical: false, cutoff: false };

      for (let t = 0; t < 20 * 60; t++) {
        const s = b.update(HOVER, HOVER, 1);
        expect(s.cellVoltage * drone.battery.cells).toBeCloseTo(s.restingVoltage, 6);
        if (s.cellVoltage <= BATTERY_WARNING_V) seen.warning = true;
        if (s.cellVoltage <= BATTERY_CRITICAL_V) seen.critical = true;
        if (s.cellVoltage <= BATTERY_CUTOFF_V) seen.cutoff = true;
      }

      expect(seen).toEqual({ warning: true, critical: true, cutoff: true });
    });
  }

  it('TC-FF-010 a full 4S pack is nowhere near the limits', () => {
    const s = new Battery(guruDrone.battery).update(HOVER, HOVER, 0);

    expect(s.cellVoltage).toBeCloseTo(4.2, 2);
    expect(s.restingVoltage).toBeCloseTo(16.8, 1);
  });

  it('the 4S FPV packs are 14.8 V nominal and bottom out at 12.0 V', () => {
    for (const drone of [guruDrone, racingDrone]) {
      expect(drone.battery.nominalV).toBe(14.8);
      const b = new Battery(drone.battery);
      let s = b.update(HOVER, HOVER, 0);
      for (let t = 0; t < 30 * 60; t++) s = b.update(1, HOVER, 1);
      expect(s.restingVoltage).toBeCloseTo(12.0, 2);
      expect(s.voltage).toBeGreaterThanOrEqual(12.0 - 1e-9);
    }
  });

  it('the 1S Pluto pack is 4.2 V full, 3.7 V nominal, 3.0 V minimum', () => {
    expect(plutoDrone.battery.nominalV).toBe(3.7);
    const b = new Battery(plutoDrone.battery);
    expect(b.update(HOVER, HOVER, 0).restingVoltage).toBeCloseTo(4.2, 2);
    let s = b.update(HOVER, HOVER, 0);
    for (let t = 0; t < 30 * 60; t++) s = b.update(1, HOVER, 1);
    expect(s.restingVoltage).toBeCloseTo(3.0, 2);
    expect(s.voltage).toBeGreaterThanOrEqual(3.0 - 1e-9);
  });
});

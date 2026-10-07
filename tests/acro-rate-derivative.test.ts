import { describe, expect, it } from 'vitest';
import { FlightController, type ControlState } from '../src/renderer/sim/control/flightController';
import { testSpec } from './helpers/airframe';

const spec = testSpec({
  pidDefaults: {
    rate: {
      roll: { p: 0, i: 0, d: 0.1 },
      pitch: { p: 0, i: 0, d: 0.1 },
      yaw: { p: 0, i: 0, d: 0.1 },
    },
    angle: { roll: { p: 0, i: 0, d: 0 }, pitch: { p: 0, i: 0, d: 0 } },
  },
});

describe('Acro integral handling', () => {
  it('does not carry ground-contact correction into takeoff', () => {
    const fc = new FlightController(testSpec());
    const grounded = { ...state, onGround: true, angvelWorld: [0.2, 0, 0] as [number, number, number] };
    for (let i = 0; i < 250; i++) fc.update(input, 'acro', grounded, 0.004);
    fc.update(input, 'acro', { ...grounded, angvelWorld: [0, 0, 0] }, 0.004);
    // Let the derivative filter settle after leaving the ground.
    let out = fc.update(input, 'acro', { ...state, angvelWorld: [0, 0, 0] }, 0.004);
    for (let i = 0; i < 250; i++) {
      out = fc.update(input, 'acro', { ...state, angvelWorld: [0, 0, 0] }, 0.004);
    }
    expect(Math.max(...out.motorThrusts) - Math.min(...out.motorThrusts)).toBeCloseTo(0, 8);
  });
});
const state: ControlState = {
  rotation: [0, 0, 0, 1],
  angvelWorld: [0, 0, 1],
  velocityWorld: [0, 0, 0],
  position: [0, 5, 0],
  inertia: [0.02, 0.04, 0.02],
  mass: 1.5,
  maxPerMotor: 7.36,
  groundEffect: 1,
  onGround: false,
  contactState: 'AIRBORNE',
};
const input = { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 };
const rollTorque = (f: readonly number[]) =>
  (spec.armLength / Math.SQRT2) * (f[0] - f[1] + f[2] - f[3]);

describe('Acro gyro derivative', () => {
  it('does not brake a constant rotation through the D term', () => {
    const fc = new FlightController(spec);
    for (let i = 0; i < 100; i++) {
      const out = fc.update(input, 'acro', state, 0.004);
      expect(rollTorque(out.motorThrusts)).toBeCloseTo(0, 10);
    }
  });

  it('opposes a sudden increase in angular velocity', () => {
    const fc = new FlightController(spec);
    fc.update(input, 'acro', { ...state, angvelWorld: [0, 0, 0] }, 0.004);
    const out = fc.update(input, 'acro', state, 0.004);
    expect(rollTorque(out.motorThrusts)).toBeLessThan(-0.01);
  });

  it('primes the gyro again after reset', () => {
    const fc = new FlightController(spec);
    fc.update(input, 'acro', { ...state, angvelWorld: [0, 0, 0] }, 0.004);
    fc.reset();
    expect(rollTorque(fc.update(input, 'acro', state, 0.004).motorThrusts)).toBeCloseTo(0, 10);
  });
});

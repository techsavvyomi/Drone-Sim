import { describe, expect, it } from 'vitest';
import {
  ACRO_THRUST_BOOST,
  FlightController,
  type ControlState,
} from '../src/renderer/sim/control/flightController';
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
    const grounded = {
      ...state,
      onGround: true,
      angvelWorld: [0.2, 0, 0] as [number, number, number],
    };
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

describe('Acro controller collective', () => {
  const sum = (m: number[]) => m.reduce((a, b) => a + b, 0);
  const still = { ...state, angvelWorld: [0, 0, 0] as [number, number, number] };

  it('answers a stick just above hover more firmly on a controller', () => {
    const collective = (throttle: number, pad: boolean) =>
      sum(
        new FlightController(testSpec()).update(
          { ...input, throttle },
          'acro',
          still,
          0.004,
          undefined,
          false,
          false,
          1,
          pad,
        ).motorThrusts,
      );
    const keyboardStep = collective(0.6, false) - collective(0.5, false);
    const padStep = collective(0.6, true) - collective(0.5, true);
    // Centre stays centre; the first part of a push above it lands harder.
    expect(collective(0.5, true)).toBeCloseTo(collective(0.5, false), 9);
    expect(padStep).toBeGreaterThan(keyboardStep * 2.2);
    // Neither end of the stick goes dead, and full stick is still full thrust.
    expect(collective(0.05, true) - collective(0, true)).toBeGreaterThan(
      (collective(0.05, false) - collective(0, false)) * 0.8,
    );
    expect(collective(1, true)).toBeCloseTo(collective(1, false), 9);
  });

  it('adds no idle spin on the pad: a low stick leaves the motors stopped', () => {
    const fc = new FlightController(testSpec());
    const low = { ...input, throttle: 0.3 };
    const grounded = { ...still, onGround: true };
    fc.update(low, 'acro', grounded, 0.004, undefined, true, true, 1, true);
    const out = fc.update(low, 'acro', grounded, 0.004, undefined, false, true, 1, true);
    expect(sum(out.motorThrusts)).toBe(0);
  });
});

describe('Acro radio idle', () => {
  it('spins the props at idle on the pad from the moment a radio arms', () => {
    const sum = (m: number[]) => m.reduce((a, b) => a + b, 0);
    const grounded = {
      ...state,
      angvelWorld: [0, 0, 0] as [number, number, number],
      onGround: true,
    };
    const low = { ...input, throttle: 0 };
    const radio = new FlightController(testSpec());
    const pad = new FlightController(testSpec());
    const radioOut = radio.update(
      low,
      'acro',
      grounded,
      0.004,
      undefined,
      false,
      false,
      1,
      true,
      true,
    );
    const padOut = pad.update(low, 'acro', grounded, 0.004, undefined, false, true, 1, true, false);
    expect(sum(radioOut.motorThrusts)).toBeGreaterThan(0);
    // Idle only: all four equal, and well short of lifting the aircraft.
    expect(new Set(radioOut.motorThrusts).size).toBe(1);
    expect(sum(radioOut.motorThrusts)).toBeLessThan(state.mass * 9.81);
    expect(sum(padOut.motorThrusts)).toBe(0);
  });
});

describe('radio throttle interlock', () => {
  it('holds the motors stopped until the stick reaches the bottom, then idles', () => {
    const sum = (m: number[]) => m.reduce((a, b) => a + b, 0);
    const grounded = {
      ...state,
      angvelWorld: [0, 0, 0] as [number, number, number],
      onGround: true,
    };
    const fc = new FlightController(testSpec());
    fc.lockThrottle();
    const high = { ...input, throttle: 0.8 };
    const out = (throttle: number, down: boolean) =>
      sum(
        fc.update(
          { ...high, throttle },
          'acro',
          grounded,
          0.004,
          undefined,
          down,
          false,
          1,
          true,
          true,
        ).motorThrusts,
      );
    expect(out(0.8, false)).toBe(0);
    expect(out(0.3, false)).toBe(0);
    expect(out(0, true)).toBeGreaterThan(0);
    // Released: the stick flies again.
    expect(out(0.8, false)).toBeGreaterThan(out(0, false));
  });
});

describe('Acro thrust authority', () => {
  it('full stick in Acro makes ACRO_THRUST_BOOST times the rated thrust; other modes the rated', () => {
    const sum = (m: number[]) => m.reduce((a, b) => a + b, 0);
    const still = { ...state, angvelWorld: [0, 0, 0] as [number, number, number] };
    const full = { ...input, throttle: 1 };
    const acro = sum(
      new FlightController(testSpec()).update(full, 'acro', still, 0.004).motorThrusts,
    );
    const stab = sum(
      new FlightController(testSpec()).update(full, 'stabilize', still, 0.004).motorThrusts,
    );
    expect(acro).toBeCloseTo(4 * state.maxPerMotor * ACRO_THRUST_BOOST, 6);
    expect(stab).toBeCloseTo(4 * state.maxPerMotor, 6);
  });
});

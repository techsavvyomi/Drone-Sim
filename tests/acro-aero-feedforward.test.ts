import { describe, expect, it } from 'vitest';
import type { FlightMode, Vec3 } from '../src/shared/types';
import {
  ACRO_THRUST_BOOST,
  FlightController,
  type ControlState,
} from '../src/renderer/sim/control/flightController';
import { mixQuad } from '../src/renderer/sim/control/mixer';
import { testSpec } from './helpers/airframe';

// Acro feeds the aerodynamic moment forward: the controller commands minus that
// torque, so the attitude does not wander off with it. Stabilize and Alt Hold
// ignore it entirely.
//
// One step from rest with centred sticks: the rate PID has no error and puts out
// nothing, so in Acro the motors carry exactly −aeroTorque.

const spec = testSpec();
const AERO: Vec3 = [0.004, 0, -0.003]; // body N·m: pitch and roll

function state(aero?: Vec3): ControlState {
  return {
    rotation: [0, 0, 0, 1],
    angvelWorld: [0, 0, 0],
    velocityWorld: [0, 0, 0],
    position: [0, 5, 0],
    inertia: [0.02, 0.04, 0.02],
    mass: 1.5,
    maxPerMotor: 7.36,
    groundEffect: 1,
    onGround: false,
    contactState: 'AIRBORNE',
    aeroTorque: aero,
  };
}

function step(mode: FlightMode, aero?: Vec3) {
  return new FlightController(spec).update(
    { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 },
    mode,
    state(aero),
    0.004,
  );
}

describe('Acro aero feed-forward', () => {
  it('in Acro the motors carry exactly minus the aero moment', () => {
    const out = step('acro', AERO);
    // Acro's collective and motor ceiling both carry ACRO_THRUST_BOOST.
    const thrust = 0.5 * 4 * 7.36 * ACRO_THRUST_BOOST;
    const arm = spec.armLength / Math.SQRT2;
    const kQ = Math.max(spec.armLength * 0.15, 0.005);
    const expected = mixQuad(
      thrust,
      -AERO[0],
      -AERO[2],
      -AERO[1],
      arm,
      kQ,
      7.36 * ACRO_THRUST_BOOST,
    ).thrusts;
    out.motorThrusts.forEach((f, i) => expect(f).toBeCloseTo(expected[i], 9));
    // and it is a real differential, not nothing
    expect(Math.max(...out.motorThrusts) - Math.min(...out.motorThrusts)).toBeGreaterThan(0.01);
  });

  it('Stabilize and Alt Hold are unchanged by it', () => {
    for (const mode of ['stabilize', 'altitude-hold'] as const) {
      const withAero = step(mode, AERO).motorThrusts;
      const without = step(mode).motorThrusts;
      withAero.forEach((f, i) => expect(f).toBe(without[i]));
    }
  });

  it('no aero moment, no change in Acro either', () => {
    const a = step('acro', [0, 0, 0]).motorThrusts;
    const b = step('acro').motorThrusts;
    a.forEach((f, i) => expect(f).toBe(b[i]));
  });
});

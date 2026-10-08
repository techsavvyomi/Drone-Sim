import { describe, expect, it } from 'vitest';
import {
  FlightController,
  RADIO_ACRO_HOVER_STICK,
  radioAcroThrust,
  type ControlState,
} from '../src/renderer/sim/control/flightController';
import { GRAVITY } from '../src/renderer/sim/constants';
import { guruDrone } from '../src/renderer/plugins/drones/guru';
import { plutoDrone } from '../src/renderer/plugins/drones/pluto';
import { racingDrone } from '../src/renderer/plugins/drones/racer';
import type { DroneSpec } from '../src/shared/types';

// A radio's Acro throttle is linear: hover at 22% of the stick on every
// airframe, more climb for every step above it, the Acro ceiling at full.

function thrustOverWeight(spec: DroneSpec, stick: number, radio = true): number {
  const state: ControlState = {
    rotation: [0, 0, 0, 1],
    angvelWorld: [0, 0, 0],
    velocityWorld: [0, 0, 0],
    position: [0, 0.05, 0],
    inertia: [0.001, 0.002, 0.001],
    mass: spec.mass,
    maxPerMotor: spec.motors[0].maxThrustN,
    groundEffect: 1,
    onGround: true,
    contactState: 'SUPPORTED',
  };
  const fc = new FlightController(spec);
  // Armed from the bottom of the stick, as a radio always is.
  fc.update({ roll: 0, pitch: 0, yaw: 0, throttle: 0 }, 'acro', state, 0.004, undefined, true, !radio, 1, true, radio);
  const out = fc.update(
    { roll: 0, pitch: 0, yaw: 0, throttle: stick },
    'acro',
    state,
    0.004,
    undefined,
    false,
    !radio,
    1,
    true,
    radio,
  );
  return out.motorThrusts.reduce((a, b) => a + b, 0) / (spec.mass * GRAVITY);
}

describe('radio Acro throttle', () => {
  it('is a straight line through the weight at the hover stick', () => {
    expect(RADIO_ACRO_HOVER_STICK).toBe(0.22);
    expect(radioAcroThrust(0, 1, 3)).toBe(0);
    expect(radioAcroThrust(0.11, 1, 3)).toBeCloseTo(0.5, 9);
    expect(radioAcroThrust(0.22, 1, 3)).toBeCloseTo(1, 9);
    expect(radioAcroThrust(0.61, 1, 3)).toBeCloseTo(2, 9);
    expect(radioAcroThrust(1, 1, 3)).toBeCloseTo(3, 9);
  });

  it.each([plutoDrone, guruDrone, racingDrone])('$id: 25% lifts, and every step above lifts harder', (spec) => {
    const steps = [0.25, 0.3, 0.4, 0.5, 0.75, 1].map((t) => thrustOverWeight(spec, t));
    expect(steps[0]).toBeGreaterThan(1);
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    expect(thrustOverWeight(spec, 0.2)).toBeLessThan(1);
  });

  it('leaves a gamepad on its centre-rest curve', () => {
    // A pad's Acro stick rests at centre: grounded at centre is still no lift.
    expect(thrustOverWeight(guruDrone, 0.5, false)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import type { FlightMode } from '../src/shared/types';
import { FlightController, type ControlState } from '../src/renderer/sim/control/flightController';
import { testSpec } from './helpers/airframe';

// Entering Altitude Hold with a climb in progress (Fix 3). It used to demand
// climbP x (0 - vz) at once: at 3 m/s, -9.6 m/s^2 and ~2% of the weight in
// thrust. Now the climb is eased out at ALT_ENTRY_DECEL (2.5 m/s^2) and the hold
// height is where that leaves the aircraft.
//
// A vertical point mass stands in for the physics: level attitude, thrust
// straight up, no drag. Enough to see the collective the controller asks for.

const spec = testSpec(); // 1.5 kg on 4 x 7.36 N: hover at exactly half
const G = 9.81;
const DT = 0.004;

function fly(opts: { vz: number; from?: FlightMode; seconds: number; stickAt?: (t: number) => number }) {
  const fc = new FlightController(spec);
  let alt = 20;
  let vz = opts.vz;
  const st = (): ControlState => ({
    rotation: [0, 0, 0, 1],
    angvelWorld: [0, 0, 0],
    velocityWorld: [0, vz, 0],
    position: [0, alt, 0],
    inertia: [0.02, 0.04, 0.02],
    mass: 1.5,
    maxPerMotor: 7.36,
    groundEffect: 1,
    onGround: false,
    contactState: 'AIRBORNE',
  });
  // One step in the mode it came from, so the switch is a real mode change.
  fc.update({ roll: 0, pitch: 0, yaw: 0, throttle: 0.5 }, opts.from ?? 'stabilize', st(), DT);
  const entryAlt = alt;
  let minThrottle = 1;
  let peakAlt = alt;
  for (let t = 0; t < opts.seconds; t += DT) {
    const throttle = opts.stickAt ? opts.stickAt(t) : 0.5;
    const out = fc.update({ roll: 0, pitch: 0, yaw: 0, throttle }, 'altitude-hold', st(), DT);
    minThrottle = Math.min(minThrottle, out.throttleFraction);
    const thrust = out.motorThrusts.reduce((a, b) => a + b, 0);
    vz += (thrust / 1.5 - G) * DT;
    alt += vz * DT;
    peakAlt = Math.max(peakAlt, alt);
  }
  return { minThrottle, overshoot: peakAlt - entryAlt, finalAlt: alt, finalVz: vz, entryAlt };
}

describe('entering Altitude Hold', () => {
  it('climbing at 3 m/s: no motor drop, and it stops where the ease says', () => {
    const r = fly({ vz: 3, seconds: 8 });
    // Hover is 0.5; easing at 2.5 m/s^2 needs ~(9.81 - 2.5)/9.81 of it. The old
    // entry went to 0.011 here.
    expect(r.minThrottle).toBeGreaterThan(0.3);
    // Stop point: v^2/2a = 1.8 m plus the climb loop's lag, v/climbP ~0.94 m.
    expect(r.overshoot).toBeGreaterThan(2.4);
    expect(r.overshoot).toBeLessThan(3.1);
    // ...and it stays there, rather than overshooting it and sinking back.
    expect(r.entryAlt + r.overshoot - r.finalAlt).toBeLessThan(0.2);
    expect(Math.abs(r.finalVz)).toBeLessThan(0.05);
  });

  it('a descent handed over is not eased: the existing powered stop', () => {
    const r = fly({ vz: -3, seconds: 4 });
    // It never drops below where it was entered by more than the old stop did.
    expect(r.entryAlt - r.finalAlt).toBeLessThan(1);
    expect(Math.abs(r.finalVz)).toBeLessThan(0.05);
  });

  it('a stick input during the ease takes over once the ease meets it', () => {
    // Full throttle stick from 0.2 s: half a stick above centre, so 2 x 0.5 x
    // maxClimbRate (1.8) = 1.8 m/s. The ease comes down to it and hands over.
    const r = fly({ vz: 3, seconds: 3, stickAt: (t) => (t > 0.2 ? 1 : 0.5) });
    expect(r.finalVz).toBeCloseTo(1.8, 1);
  });

  it("the previous mode's raised stick, for the steps before the handover, does not cancel the ease", () => {
    // Live: the throttle handover runs at render rate, so Alt Hold's first few
    // physics steps still see Stabilize's 0.85. That used to reset the hold to
    // the entry altitude and chop the motors to 0.
    const r = fly({ vz: 3, seconds: 8, stickAt: (t) => (t < 0.016 ? 0.85 : 0.5) });
    expect(r.minThrottle).toBeGreaterThan(0.3);
    expect(r.overshoot).toBeGreaterThan(2.4);
    expect(r.entryAlt + r.overshoot - r.finalAlt).toBeLessThan(0.2);
  });

  it('entered at rest, it holds where it is', () => {
    const r = fly({ vz: 0, seconds: 3 });
    expect(Math.abs(r.finalAlt - r.entryAlt)).toBeLessThan(0.05);
  });
});

import { describe, expect, it } from 'vitest';
import type { ContactState, StickInput } from '../src/shared/types';
import { FlightController, type ControlState } from '../src/renderer/sim/control/flightController';
import { testSpec } from './helpers/airframe';

// The collective end of the flight controller: what the motors are asked for
// when the throttle is chopped. The attitude loops are not exercised here —
// they need a physics step to close around.

const spec = testSpec();
/** Four 7.36 N motors under a 1.5 kg airframe: hover sits at half throttle. */
const MAX_PER_MOTOR = 7.36;

function state(over: Partial<ControlState> = {}): ControlState {
  return {
    rotation: [0, 0, 0, 1],
    angvelWorld: [0, 0, 0],
    velocityWorld: [0, 0, 0],
    position: [0, 3, 0],
    inertia: [0.01, 0.02, 0.01],
    mass: spec.mass,
    maxPerMotor: MAX_PER_MOTOR,
    groundEffect: 1,
    onGround: false,
    contactState: 'AIRBORNE' as ContactState,
    ...over,
  };
}

function sticks(over: Partial<StickInput> = {}): StickInput {
  return { roll: 0, pitch: 0, yaw: 0, throttle: 0, ...over };
}

describe('the ESC idle', () => {
  it('TC-209 a chopped throttle stops the motors dead when nothing asks for idle', () => {
    const fc = new FlightController(spec);

    const out = fc.update(sticks({ throttle: 0 }), 'acro', state(), 1 / 250);

    expect(out.motors).toEqual([0, 0, 0, 0]);
    expect(out.throttleFraction).toBe(0);
  });

  it('TC-209 holding the throttle down idles all four motors instead', () => {
    const fc = new FlightController(spec);

    const out = fc.update(sticks({ throttle: 0 }), 'acro', state(), 1 / 250, undefined, true);

    for (const m of out.motors) expect(m).toBeGreaterThan(0);
    // Five per cent of full collective, split four ways.
    expect(out.throttleFraction).toBeCloseTo(0.05, 2);
  });

  it('TC-209 the idle is far too small to arrest a descent', () => {
    const fc = new FlightController(spec);

    const out = fc.update(sticks({ throttle: 0 }), 'acro', state(), 1 / 250, undefined, true);

    const total = out.motorThrusts.reduce((s, t) => s + t, 0);
    const weight = spec.mass * 9.81;
    expect(total).toBeLessThan(weight * 0.2);
  });

  it('TC-210 the idle applies in Altitude Hold too, where thrust is managed', () => {
    const fc = new FlightController(spec);

    const out = fc.update(
      sticks({ throttle: 0 }),
      'altitude-hold',
      state({ onGround: true, contactState: 'SUPPORTED' }),
      1 / 250,
      undefined,
      true,
    );

    for (const m of out.motors) expect(m).toBeGreaterThan(0);
  });

  it('TC-210 a centred stick on the pad still commands nothing (invariants #15b)', () => {
    // The idle is keyed on the pilot COMMANDING it. Altitude Hold's stick rests
    // at centre on the pad, and that must stay a full cut, not an idle.
    const fc = new FlightController(spec);

    const out = fc.update(
      sticks({ throttle: 0.5 }),
      'altitude-hold',
      state({ onGround: true, position: [0, 0, 0], contactState: 'SUPPORTED' }),
      1 / 250,
    );

    expect(out.motors).toEqual([0, 0, 0, 0]);
  });

  it('TC-211 an unstable edge still refuses to levitate the airframe', () => {
    // The overhang gate zeroes thrust outright; the idle must not undo it.
    const fc = new FlightController(spec);

    const out = fc.update(
      sticks({ throttle: 0 }),
      'acro',
      state({ onGround: true, contactState: 'UNSTABLE' as ContactState }),
      1 / 250,
      undefined,
      true,
    );

    expect(out.motors).toEqual([0, 0, 0, 0]);
  });
});

describe('re-arming after the motors were cut in the air', () => {
  // `targetAltitude` is the one piece of controller state that outlives a disarm.
  // `Drone.tsx` calls `captureAltitude()` on the arm transition for exactly this
  // reason; these lock the two halves of that contract.

  /** Hold 3 m for a second, then chop the throttle and descend to 1.2 m. */
  function cutInTheAir(fc: FlightController) {
    for (let i = 0; i < 60; i++) {
      fc.update(sticks({ throttle: 0.5 }), 'altitude-hold', state(), 1 / 60);
    }
    let alt = 3;
    for (let i = 0; i < 60; i++) {
      fc.update(
        sticks({ throttle: 0 }),
        'altitude-hold',
        state({ position: [0, alt, 0], velocityWorld: [0, -1.2, 0] }),
        1 / 60,
        undefined,
        true,
      );
      alt -= 1.2 / 60;
    }
    // The pilot disarms here: the controller stops being called while the drone
    // drops the rest of the way.
  }

  const collective = (out: { motorThrusts: number[] }) =>
    out.motorThrusts.reduce((s, t) => s + t, 0);
  const hover = spec.mass * 9.81;

  it('TC-213 a stale hold altitude would fly the drone back up on its own', () => {
    // The bug, kept as a test: without the capture the controller is still
    // holding 3 m, so a centred stick at 1.2 m is a hard climb the pilot never
    // asked for.
    const fc = new FlightController(spec);
    cutInTheAir(fc);

    const out = fc.update(
      sticks({ throttle: 0.5 }),
      'altitude-hold',
      state({ position: [0, 1.2, 0] }),
      1 / 60,
    );

    expect(collective(out)).toBeGreaterThan(hover * 1.5);
  });

  it('TC-213 capturing the altitude on arming holds where the drone is instead', () => {
    const fc = new FlightController(spec);
    cutInTheAir(fc);

    fc.captureAltitude(1.2); // what the arm transition does

    const out = fc.update(
      sticks({ throttle: 0.5 }),
      'altitude-hold',
      state({ position: [0, 1.2, 0] }),
      1 / 60,
    );

    expect(collective(out)).toBeCloseTo(hover, 1);
  });

  it('TC-213 landing first already clears the target, armed or not', () => {
    // The on-ground branch rewrites the target every step, which is why the bug
    // only ever showed up when the disarm beat the touchdown.
    const fc = new FlightController(spec);
    cutInTheAir(fc);

    for (let i = 0; i < 30; i++) {
      fc.update(
        sticks({ throttle: 0 }),
        'altitude-hold',
        state({ position: [0, 0.05, 0], onGround: true, contactState: 'SUPPORTED' }),
        1 / 60,
        undefined,
        true,
      );
    }
    const out = fc.update(
      sticks({ throttle: 0.5 }),
      'altitude-hold',
      state({ position: [0, 0.05, 0], onGround: true, contactState: 'SUPPORTED' }),
      1 / 60,
    );

    expect(out.motors).toEqual([0, 0, 0, 0]);
  });
});

describe('a spring-centred stick on the pad', () => {
  const pad = () =>
    state({ onGround: true, position: [0, 0.05, 0], contactState: 'SUPPORTED' as ContactState });

  it('TC-216 a grounded Acro stick at centre commands nothing', () => {
    // Acro's stick springs to centre now, so centre on the pad is where the
    // spring left it and not a request to fly. Letting it through would float
    // the aircraft off the pad having been asked for nothing (#15a, #16).
    const fc = new FlightController(spec);
    fc.unlockThrottle();

    const out = fc.update(sticks({ throttle: 0.5 }), 'acro', pad(), 1 / 250);

    expect(out.motors).toEqual([0, 0, 0, 0]);
  });

  it('TC-216 pushing past centre on the pad is a command, and flies', () => {
    const fc = new FlightController(spec);
    fc.unlockThrottle();

    const out = fc.update(sticks({ throttle: 0.75 }), 'acro', pad(), 1 / 250);

    expect(out.throttleFraction).toBeCloseTo(0.75, 2);
  });

  it('TC-216 the gate is the pad only — the same stick flies in the air', () => {
    const fc = new FlightController(spec);
    fc.unlockThrottle();

    const out = fc.update(sticks({ throttle: 0.5 }), 'acro', state(), 1 / 250);

    expect(out.throttleFraction).toBeCloseTo(0.5, 2);
  });

  it('TC-216 Stabilize is untouched: its stick rests at idle, not centre', () => {
    const fc = new FlightController(spec);
    fc.unlockThrottle();

    const out = fc.update(sticks({ throttle: 0.5 }), 'stabilize', pad(), 1 / 250);

    expect(out.throttleFraction).toBeCloseTo(0.5, 2);
  });
});

describe('the arming throttle interlock', () => {
  // S before W, every flight. A radio pilot never notices it — the stick rests
  // at the bottom, which IS the throttle-down command (#15d).
  const pad = () =>
    state({ onGround: true, position: [0, 0.05, 0], contactState: 'SUPPORTED' as ContactState });

  it('TC-214 an armed drone will not fly on throttle up alone', () => {
    const fc = new FlightController(spec);
    fc.lockThrottle(); // what arming on the pad does

    // Full throttle in a direct mode, and a climb command in Alt Hold.
    const acro = fc.update(sticks({ throttle: 1 }), 'acro', pad(), 1 / 250);
    const alt = fc.update(sticks({ throttle: 0.9 }), 'altitude-hold', pad(), 1 / 250);

    expect(acro.motors).toEqual([0, 0, 0, 0]);
    expect(alt.motors).toEqual([0, 0, 0, 0]);
  });

  it('TC-214 commanding the throttle down releases it, and W then flies', () => {
    const fc = new FlightController(spec);
    fc.lockThrottle();

    // S: the release. The motors idle rather than staying dead (#15d).
    const idling = fc.update(sticks({ throttle: 0 }), 'acro', pad(), 1 / 250, undefined, true);
    expect(idling.throttleFraction).toBeCloseTo(0.05, 2);
    expect(fc.throttleLocked).toBe(false);

    // W, S released.
    const flying = fc.update(sticks({ throttle: 1 }), 'acro', pad(), 1 / 250);
    expect(flying.throttleFraction).toBeGreaterThan(0.9);
  });

  it('TC-214 the release does not carry over to the next arm', () => {
    // The bug this exists for: idle before disarming, then arm again and press
    // W. The previous flight's throttle-down does not count for this one.
    const fc = new FlightController(spec);
    fc.lockThrottle();
    fc.update(sticks({ throttle: 0 }), 'acro', pad(), 1 / 250, undefined, true);
    fc.update(sticks({ throttle: 1 }), 'acro', pad(), 1 / 250);

    fc.lockThrottle(); // disarmed, then armed again

    const out = fc.update(sticks({ throttle: 1 }), 'acro', pad(), 1 / 250);
    expect(out.motors).toEqual([0, 0, 0, 0]);
  });

  it('TC-214 an auto sequence is handed live motors, having no pilot to press S', () => {
    const fc = new FlightController(spec);
    fc.lockThrottle();
    fc.unlockThrottle(); // what Drone.tsx does for auto takeoff and scripted demos

    const out = fc.update(sticks({ throttle: 0 }), 'altitude-hold', pad(), 1 / 250, 12);

    expect(out.motorThrusts.reduce((a, b) => a + b, 0)).toBeCloseTo(12, 1);
  });

  it('TC-214 a scene reset clears it', () => {
    const fc = new FlightController(spec);
    fc.lockThrottle();

    fc.reset();

    expect(fc.throttleLocked).toBe(false);
  });
});

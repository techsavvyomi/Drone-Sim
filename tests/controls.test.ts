import { beforeEach, describe, expect, it } from 'vitest';
import {
  isScripted,
  isThrottleDown,
  resetStick,
  runScriptedCommand,
  setScripted,
  setScriptedStick,
  stick,
  throttleAfterModeChange,
  throttleSafeToArm,
  updateStick,
} from '../src/renderer/input/controls';
import { useFlightStore } from '../src/renderer/state/flightStore';

// The control layer: the arm interlock, the throttle's different meaning either
// side of an altitude-managed mode, and the scripted-input flag that lets a
// Flight School demonstration own the sticks.
//
// The arming refusal lives HERE, not in the flight store: `toggleArm` will arm
// anything that is not crashed or flat, and it is `runCommand` in this module
// that refuses on a raised throttle. So that is what these tests drive.

const INITIAL_FLIGHT = { ...useFlightStore.getState() };

beforeEach(() => {
  useFlightStore.setState({ ...INITIAL_FLIGHT }, true);
  setScripted(false);
  resetStick();
});

describe('the arm interlock', () => {
  it('TC-022 a resting throttle is safe to arm on', () => {
    // Altitude Hold rests at the spring centre.
    expect(stick.throttle).toBeCloseTo(0.5, 3);
    expect(throttleSafeToArm()).toBe(true);
  });

  it('TC-024 a raised throttle is refused in an altitude-managed mode', () => {
    stick.throttle = 0.8;

    expect(throttleSafeToArm()).toBe(false);
  });

  it('TC-024 the limit sits just above the spring centre, not at it', () => {
    // A stick resting fractionally off centre must not read as raised.
    stick.throttle = 0.6;
    expect(throttleSafeToArm()).toBe(true);

    stick.throttle = 0.7;
    expect(throttleSafeToArm()).toBe(false);
  });

  it('TC-025 a direct-thrust mode wants the throttle near idle, not centred', () => {
    useFlightStore.setState({ mode: 'stabilize' });
    resetStick();

    // Direct modes rest at zero, so the centre position is now a raised stick.
    expect(stick.throttle).toBe(0);
    expect(throttleSafeToArm()).toBe(true);

    stick.throttle = 0.5;
    expect(throttleSafeToArm()).toBe(false);
  });

  it('TC-026 the refusal clears once the throttle is back at rest', () => {
    stick.throttle = 0.9;
    expect(throttleSafeToArm()).toBe(false);

    resetStick();

    expect(throttleSafeToArm()).toBe(true);
  });
});

describe('throttle behaviour by mode', () => {
  it('TC-040 a released throttle springs back to centre in Altitude Hold', () => {
    stick.throttle = 0.9;

    // A second of frames with nothing held.
    for (let i = 0; i < 60; i++) updateStick(1 / 60);

    expect(stick.throttle).toBeCloseTo(0.5, 1);
  });

  it('TC-040 a released throttle does NOT spring back in a direct mode', () => {
    // invariants #13: throttle means different things either side of
    // ALT_MANAGED. In Stabilize the stick stays where the pilot left it.
    useFlightStore.setState({ mode: 'stabilize' });
    stick.throttle = 0.9;

    for (let i = 0; i < 60; i++) updateStick(1 / 60);

    expect(stick.throttle).toBeCloseTo(0.9, 3);
  });

  it("TC-207 the keyboard's Acro throttle holds where it was left, airborne", () => {
    // Acro has no altitude logic, so a throttle that sprang back to a hover was
    // a hidden assist. On the keyboard it is incremental, like a radio's stick.
    // (A gamepad's stick still springs physically — that is the device, not this.)
    useFlightStore.setState({ mode: 'acro', onGround: false });
    stick.throttle = 0.9;
    for (let i = 0; i < 60; i++) updateStick(1 / 60);
    expect(stick.throttle).toBeCloseTo(0.9, 3);

    stick.throttle = 0.1;
    for (let i = 0; i < 60; i++) updateStick(1 / 60);
    expect(stick.throttle).toBeCloseTo(0.1, 3);
  });

  it("TC-208 the keyboard's Acro throttle holds on the pad too", () => {
    useFlightStore.setState({ mode: 'acro', onGround: true });
    stick.throttle = 0.2;
    for (let i = 0; i < 60; i++) updateStick(1 / 60);
    expect(stick.throttle).toBeCloseTo(0.2, 3);
  });

  it('TC-208 on the keyboard, Acro arms near idle like any direct mode', () => {
    useFlightStore.setState({ mode: 'acro' });
    resetStick();

    expect(stick.throttle).toBe(0);
    expect(throttleSafeToArm()).toBe(true);

    stick.throttle = 0.5;
    expect(throttleSafeToArm()).toBe(false);
  });

  it('TC-046 a reset recentres the sticks for the mode it is in', () => {
    stick.roll = 0.7;
    stick.pitch = -0.4;
    stick.yaw = 0.9;
    stick.throttle = 1;

    resetStick();

    expect(stick.roll).toBe(0);
    expect(stick.pitch).toBe(0);
    expect(stick.yaw).toBe(0);
    // A spring-centred mode rests at the centre; Stabilize rests at idle.
    expect(stick.throttle).toBeCloseTo(0.5, 3);

    // Acro on the keyboard is a direct, incremental throttle: it starts at idle.
    useFlightStore.setState({ mode: 'acro' });
    resetStick();
    expect(stick.throttle).toBe(0);

    useFlightStore.setState({ mode: 'stabilize' });
    resetStick();
    expect(stick.throttle).toBe(0);
  });
});

describe('the idle-throttle command', () => {
  it('TC-209 an untouched keyboard is not commanding idle', () => {
    // Wherever the stick RESTS, resting is not a command — or arming alone would
    // spin the props (invariants #15a). Stabilize rests at zero, which is the
    // position that would otherwise read as a throttle-down.
    useFlightStore.setState({ mode: 'stabilize' });
    resetStick();

    expect(stick.throttle).toBe(0);
    expect(isThrottleDown()).toBe(false);
  });

  it('TC-209 a demonstration never asks for idle', () => {
    setScripted(true);
    setScriptedStick({ throttle: 0 });

    expect(isThrottleDown()).toBe(false);
  });
});

describe('scripted input', () => {
  it('TC-149 a demonstration owns the sticks outright', () => {
    // invariants #14: while scripted, updateStick returns early so neither
    // easing nor live input can overwrite what the Director wrote.
    setScripted(true);
    setScriptedStick({ roll: 0.42, pitch: -0.3, throttle: 0.8 });

    for (let i = 0; i < 60; i++) updateStick(1 / 60);

    expect(stick.roll).toBeCloseTo(0.42, 3);
    expect(stick.pitch).toBeCloseTo(-0.3, 3);
    expect(stick.throttle).toBeCloseTo(0.8, 3);
  });

  it('TC-149 an unset channel keeps its value across a scripted step', () => {
    setScripted(true);
    setScriptedStick({ roll: 0.5, pitch: 0.5 });

    setScriptedStick({ roll: -0.5 });

    expect(stick.roll).toBeCloseTo(-0.5, 3);
    expect(stick.pitch).toBeCloseTo(0.5, 3);
  });

  it('TC-150 control comes back when the demonstration ends', () => {
    setScripted(true);
    expect(isScripted()).toBe(true);

    setScripted(false);

    expect(isScripted()).toBe(false);
    stick.throttle = 0.9;
    for (let i = 0; i < 60; i++) updateStick(1 / 60);
    // Easing is live again, so the stick springs back.
    expect(stick.throttle).toBeCloseTo(0.5, 1);
  });

  it('TC-166 a scripted arm command arms, and disarm disarms', () => {
    runScriptedCommand('arm');
    expect(useFlightStore.getState().armed).toBe(true);

    // Arming twice must not toggle it back off.
    runScriptedCommand('arm');
    expect(useFlightStore.getState().armed).toBe(true);

    runScriptedCommand('disarm');
    expect(useFlightStore.getState().armed).toBe(false);
  });

  it('TC-030 a scripted take-off still refuses to arm the aircraft', () => {
    // The demo drives the REAL controller, so invariants #16 holds here too.
    runScriptedCommand('takeoffLand');

    expect(useFlightStore.getState().armed).toBe(false);
    expect(useFlightStore.getState().auto).toBe('manual');
  });
});

describe('the throttle across a mode change', () => {
  const HOVER = 0.49;

  it('Alt Hold → Stabilize on the pad starts at idle, so arming is not refused', () => {
    // It used to hand over the hover-equivalent 0.49, a raised stick to a
    // direct mode, and ENTER did nothing.
    const next = throttleAfterModeChange('altitude-hold', 'stabilize', true, HOVER);
    expect(next).toBe(0);
    useFlightStore.setState({ mode: 'stabilize' });
    stick.throttle = next!;
    expect(throttleSafeToArm()).toBe(true);
  });

  it('keyboard Acro on the pad starts at idle too', () => {
    expect(throttleAfterModeChange('altitude-hold', 'acro', true, HOVER)).toBe(0);
  });

  it('armed in the air, leaving Alt Hold hands back the hover position', () => {
    expect(throttleAfterModeChange('altitude-hold', 'stabilize', false, HOVER)).toBe(HOVER);
    expect(throttleAfterModeChange('altitude-hold', 'acro', false, HOVER)).toBe(HOVER);
  });

  it('into Alt Hold centres the stick; between direct modes it is left alone', () => {
    expect(throttleAfterModeChange('stabilize', 'altitude-hold', true, HOVER)).toBe(0.5);
    expect(throttleAfterModeChange('stabilize', 'acro', false, HOVER)).toBeNull();
    expect(throttleAfterModeChange('acro', 'stabilize', true, HOVER)).toBeNull();
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Whether the next poll counts as the pilot moving the pad. On by default, so
// the radio is the active device from the first `updateStick`.
const pad = vi.hoisted(() => ({ activity: true }));
vi.mock('../src/renderer/input/gamepad', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/input/gamepad')>();
  return { ...actual, consumeGamepadActivity: () => pad.activity };
});

import {
  activeInputSource,
  attachKeyboard,
  beginThrottleCatch,
  flyingOnRadio,
  resetStick,
  setDirectHoverThrottle,
  stick,
  throttleCatchActive,
  throttleCatchHolds,
  updateStick,
} from '../src/renderer/input/controls';
import { gamepadLive, gamepadStick } from '../src/renderer/input/gamepad';
import { THROTTLE_CENTER } from '../src/renderer/sim/control/flightController';
import { useFlightStore } from '../src/renderer/state/flightStore';

// A radio's throttle rests at the bottom. In Alt Hold that is a full-rate
// descent, so when an auto-takeoff handed back to it the aircraft flew itself
// back onto the pad. The catch holds centre until the pilot brings the stick up.

const INITIAL_FLIGHT = { ...useFlightStore.getState() };
const DT = 1 / 60;

beforeEach(() => {
  pad.activity = true;
  useFlightStore.setState({ ...INITIAL_FLIGHT, armed: true, onGround: false, mode: 'altitude-hold' }, true);
  gamepadLive.index = 0;
  gamepadLive.kind = 'rc';
  gamepadStick.throttle = 0;
  resetStick();
  updateStick(DT);
});

describe('throttleCatchHolds', () => {
  it('holds while the stick stays on the side it started', () => {
    expect(throttleCatchHolds(0, -1)).toBe(true);
    expect(throttleCatchHolds(0.4, -1)).toBe(true);
    expect(throttleCatchHolds(0.9, 1)).toBe(true);
  });

  it('lets go inside the band, or once the stick has crossed centre', () => {
    expect(throttleCatchHolds(0.47, -1)).toBe(false);
    expect(throttleCatchHolds(0.7, -1)).toBe(false);
    expect(throttleCatchHolds(0.3, 1)).toBe(false);
    expect(throttleCatchHolds(0, 0)).toBe(false);
  });
});

describe('radio in Alt Hold after an auto-takeoff', () => {
  it('is flying on a radio', () => {
    expect(flyingOnRadio()).toBe(true);
  });

  it('holds centre while the stick sits at the bottom', () => {
    beginThrottleCatch();
    for (let i = 0; i < 120; i++) updateStick(DT);
    expect(stick.throttle).toBe(THROTTLE_CENTER);
    expect(throttleCatchActive()).toBe(true);
  });

  it('hands the stick back once the pilot brings it to centre', () => {
    beginThrottleCatch();
    gamepadStick.throttle = 0.3;
    updateStick(DT);
    expect(stick.throttle).toBe(THROTTLE_CENTER);
    gamepadStick.throttle = 0.5;
    updateStick(DT);
    expect(throttleCatchActive()).toBe(false);
    gamepadStick.throttle = 0.3;
    updateStick(DT);
    expect(stick.throttle).toBe(0.3);
  });

  it('hands back on a push that jumps the band between two frames', () => {
    beginThrottleCatch();
    gamepadStick.throttle = 0.8;
    updateStick(DT);
    expect(stick.throttle).toBe(0.8);
    expect(throttleCatchActive()).toBe(false);
  });

  it('never starts when the stick is already at centre', () => {
    gamepadStick.throttle = 0.52;
    beginThrottleCatch();
    expect(throttleCatchActive()).toBe(false);
  });

  it('ends on a disarm or a switch out of Alt Hold', () => {
    beginThrottleCatch();
    useFlightStore.setState({ armed: false });
    updateStick(DT);
    expect(throttleCatchActive()).toBe(false);
    expect(stick.throttle).toBe(0);

    useFlightStore.setState({ armed: true });
    beginThrottleCatch();
    useFlightStore.setState({ mode: 'stabilize' });
    updateStick(DT);
    expect(throttleCatchActive()).toBe(false);
  });
});

describe('a radio left plugged in while flying on the keyboard', () => {
  it('gives up the throttle when Arm or Take off is pressed on the keyboard', () => {
    expect(activeInputSource()).toBe('gamepad');
    pad.activity = false;
    const detach = attachKeyboard();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    detach();
    updateStick(DT);
    expect(activeInputSource()).toBe('keyboard');
    for (let i = 0; i < 60; i++) updateStick(DT);
    // The keyboard's Alt Hold throttle rests at hold, not at the radio's bottom.
    expect(stick.throttle).toBeCloseTo(THROTTLE_CENTER, 3);
  });

  it('is caught when the radio takes over in the air', () => {
    pad.activity = false;
    const detach = attachKeyboard();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    detach();
    updateStick(DT);
    expect(activeInputSource()).toBe('keyboard');

    // The pilot nudges the radio: it takes over, with its throttle at the bottom.
    pad.activity = true;
    updateStick(DT);
    expect(activeInputSource()).toBe('gamepad');
    expect(throttleCatchActive()).toBe(true);
    expect(stick.throttle).toBe(THROTTLE_CENTER);
  });

  it('is not caught on the pad, where the bottom of the stick is idle', () => {
    useFlightStore.setState({ onGround: true });
    pad.activity = false;
    const detach = attachKeyboard();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    detach();
    updateStick(DT);
    pad.activity = true;
    updateStick(DT);
    expect(throttleCatchActive()).toBe(false);
    expect(stick.throttle).toBe(0);
  });
});

// Stabilize holds at the airframe's hover throttle rather than centre: its
// stick is raw collective, so a radio at the bottom dropped it just the same.
describe('Stabilize on a controller after an auto-takeoff', () => {
  const HOVER = 0.42;

  beforeEach(() => {
    setDirectHoverThrottle(HOVER);
    useFlightStore.setState({ mode: 'stabilize' });
    updateStick(DT);
  });

  it('holds hover throttle while the stick sits at the bottom', () => {
    beginThrottleCatch();
    for (let i = 0; i < 120; i++) updateStick(DT);
    expect(stick.throttle).toBe(HOVER);
    expect(throttleCatchActive()).toBe(true);
  });

  it('hands back once the stick reaches hover, not centre', () => {
    beginThrottleCatch();
    gamepadStick.throttle = 0.3;
    updateStick(DT);
    expect(stick.throttle).toBe(HOVER);
    gamepadStick.throttle = HOVER + 0.02;
    updateStick(DT);
    expect(throttleCatchActive()).toBe(false);
    expect(stick.throttle).toBe(HOVER + 0.02);
  });

  it('is caught when a controller takes over in the air', () => {
    pad.activity = false;
    const detach = attachKeyboard();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    detach();
    updateStick(DT);
    pad.activity = true;
    updateStick(DT);
    expect(throttleCatchActive()).toBe(true);
    expect(stick.throttle).toBe(HOVER);
  });

  it('never catches in Acro, which holds nothing', () => {
    useFlightStore.setState({ mode: 'acro' });
    beginThrottleCatch();
    expect(throttleCatchActive()).toBe(false);
  });
});

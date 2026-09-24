// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachKeyboard,
  resetStick,
  setScripted,
  stick,
  updateStick,
} from '../src/renderer/input/controls';
import { useFlightStore } from '../src/renderer/state/flightStore';
import { useSimStore } from '../src/renderer/state/simStore';

// P pauses and resumes a flight, from the flight input layer, so it works in
// Free Flight, in a mission and in a lesson's practice alike.
//
// The physics is halted by `paused` (FlightScene hands it to <Physics>); what is
// tested here is the part around it — that the key toggles, that a paused
// flight ignores the commands that would change what the aircraft is doing,
// that the sticks hold still, and that R is a fresh start rather than a paused
// one.

const INITIAL_FLIGHT = { ...useFlightStore.getState() };
const INITIAL_SIM = { ...useSimStore.getState() };

let detachKeys: (() => void) | undefined;

function press(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
}
function release(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  useFlightStore.setState({ ...INITIAL_FLIGHT }, true);
  useSimStore.setState({ ...INITIAL_SIM }, true);
  setScripted(false);
  resetStick();
  detachKeys = attachKeyboard();
});

afterEach(() => {
  detachKeys?.();
  detachKeys = undefined;
});

describe('pausing a flight with P', () => {
  it('TC-509 P pauses, and P again resumes', () => {
    press('KeyP');
    expect(useFlightStore.getState().paused).toBe(true);

    press('KeyP');
    expect(useFlightStore.getState().paused).toBe(false);
  });

  it('TC-509 a held P does not flicker the pause on and off', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', repeat: true }));
    expect(useFlightStore.getState().paused).toBe(false);
  });

  it('TC-510 a paused flight does not arm, take off or change mode', () => {
    press('KeyP');
    const before = useFlightStore.getState();

    press('Enter');
    press('Space');
    press('KeyM');

    const after = useFlightStore.getState();
    expect(after.armed).toBe(before.armed);
    expect(after.auto).toBe(before.auto);
    expect(after.mode).toBe(before.mode);
  });

  it('TC-510 the sticks hold still while paused, even with a key down', () => {
    useFlightStore.setState({ mode: 'stabilize' });
    resetStick();
    press('KeyP');

    press('KeyW');
    updateStick(0.5);
    release('KeyW');

    expect(stick.throttle).toBe(0);

    // And move again the moment the flight resumes.
    press('KeyP');
    press('KeyW');
    updateStick(0.5);
    release('KeyW');
    expect(stick.throttle).toBeGreaterThan(0);
  });

  it('TC-511 R on a paused flight resets AND resumes', () => {
    press('KeyP');
    const token = useSimStore.getState().resetToken;

    press('KeyR');

    expect(useSimStore.getState().resetToken).not.toBe(token);
    expect(useFlightStore.getState().paused).toBe(false);
  });

  it('TC-511 a demonstration swallows P with every other key', () => {
    setScripted(true);
    press('KeyP');
    expect(useFlightStore.getState().paused).toBe(false);
  });
});

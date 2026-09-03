// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  attachKeyboard,
  resetStick,
  setScripted,
  stick,
  updateStick,
} from '../src/renderer/input/controls';
import { attachModalKeyLock } from '../src/renderer/input/useModalKeyLock';
import { useFlightStore } from '../src/renderer/state/flightStore';

// The lock a blocking card holds over the keyboard.
//
// The bug it exists for: the Flight School Learn card was up, ENTER armed the
// drone behind it and SPACE took it off, on a lesson the pilot had not started.
// The demo's `scripted` flag did not cover it — that is the Director's, and it
// is off for a mission briefing and for the result card at the end of a lesson.
//
// jsdom, because the whole mechanism is a capture-phase window listener and
// there is nothing left of it without a DOM.

const INITIAL_FLIGHT = { ...useFlightStore.getState() };

let detachKeys: (() => void) | undefined;
let detachLock: (() => void) | undefined;

/** A card with a button in it, mounted and focusable. */
function mountCard(): { card: HTMLElement; button: HTMLButtonElement } {
  const card = document.createElement('div');
  const button = document.createElement('button');
  card.appendChild(button);
  document.body.appendChild(card);
  return { card, button };
}

function press(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  useFlightStore.setState({ ...INITIAL_FLIGHT }, true);
  setScripted(false);
  resetStick();
  detachKeys = attachKeyboard();
});

afterEach(() => {
  detachLock?.();
  detachKeys?.();
  detachLock = undefined;
  detachKeys = undefined;
  document.body.innerHTML = '';
});

describe('the modal key lock', () => {
  it('TC-236 without it, ENTER behind a card arms the drone', () => {
    // The bug, stated as a test: nothing else stops this.
    press('Enter');

    expect(useFlightStore.getState().armed).toBe(true);
  });

  it('TC-236 ENTER does not arm the drone while a card is up', () => {
    const { card } = mountCard();
    detachLock = attachModalKeyLock(() => card);

    press('Enter');

    expect(useFlightStore.getState().armed).toBe(false);
  });

  it('TC-236 SPACE does not ask for a take-off while a card is up', () => {
    const { card } = mountCard();
    useFlightStore.getState().toggleArm();
    detachLock = attachModalKeyLock(() => card);

    press('Space');

    expect(useFlightStore.getState().auto).toBe('manual');
  });

  it('TC-236 a stick key never reaches the sticks while a card is up', () => {
    const { card } = mountCard();
    detachLock = attachModalKeyLock(() => card);

    press('ArrowUp');
    // `updateStick` eases towards whatever the key set is holding. Half a second
    // of it is long enough for a held pitch key to reach full deflection.
    for (let i = 0; i < 30; i++) updateStick(1 / 60);

    expect(stick.pitch).toBe(0);
  });

  // The card's own buttons stay usable from the keyboard, and that is a
  // DEFAULT ACTION rather than a listener: the browser presses the focused
  // button itself, and only `preventDefault` cancels it. So the two halves are
  // tested as what they are — the event still reaches nothing, and the
  // activation is left alone.
  it('TC-236 a key with the card focused still reaches nobody', () => {
    const { card, button } = mountCard();
    detachLock = attachModalKeyLock(() => card);
    button.focus();

    button.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(useFlightStore.getState().armed).toBe(false);
  });

  it('TC-236 a key with the card focused keeps its default action', () => {
    const { card, button } = mountCard();
    detachLock = attachModalKeyLock(() => card);
    button.focus();

    const onCard = new KeyboardEvent('keydown', {
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(onCard);
    // ...where a key pressed with focus off the card has it cancelled, so no
    // button the card happened to leave focused can be pressed by SPACE.
    button.blur();
    const offCard = new KeyboardEvent('keydown', {
      code: 'Space',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(offCard);

    expect(onCard.defaultPrevented).toBe(false);
    expect(offCard.defaultPrevented).toBe(true);
  });

  it('TC-236 Escape is never swallowed — it is how the card is left', () => {
    const { card } = mountCard();
    detachLock = attachModalKeyLock(() => card);

    let seen = 0;
    const spy = () => seen++;
    window.addEventListener('keydown', spy);
    press('Escape');
    window.removeEventListener('keydown', spy);

    expect(seen).toBe(1);
  });

  it('TC-236 control comes back the moment the card goes', () => {
    const { card } = mountCard();
    const detach = attachModalKeyLock(() => card);
    press('Enter');
    expect(useFlightStore.getState().armed).toBe(false);

    detach();
    press('Enter');

    expect(useFlightStore.getState().armed).toBe(true);
  });
});

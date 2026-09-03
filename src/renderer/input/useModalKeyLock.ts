import { useEffect, type RefObject } from 'react';
import { resetStick } from './controls';

// ----------------------------------------------------------------------------
// The keyboard lock a blocking card holds while it is on screen.
//
// A full-screen card — the lesson's Learn card, its result card, a mission
// briefing — is a question the app is asking, and until it is answered the
// aircraft is not being flown. The keyboard did not know that. ENTER armed the
// drone and SPACE took it off from behind the Learn card, so a pilot reading the
// steps of Module 10 could look up to find the aircraft already in the air, on a
// lesson that had not started.
//
// `setScripted` in `controls.ts` is NOT this. That flag is the demonstration
// saying "I am flying, do not fight me", it is owned by the training Director,
// and it is off for every card a mission shows and for the result card at the
// end of a lesson. This is the UI saying "nothing is being flown at all", and it
// belongs to whatever is covering the screen.
//
// It is a CAPTURE listener on the window, which is the only place that can hold
// the whole promise: capture runs before every bubble-phase listener in the app,
// so one `stopImmediatePropagation` there takes the event away from the flight
// controls, from the keycap row's held-key tracker, and from the browser's own
// default action — which is what would otherwise let SPACE press whichever
// button the card happened to leave focused.
//
// Split the way `controls.ts` is split: `attachModalKeyLock` is the whole
// mechanism and knows nothing about React, `useModalKeyLock` is the two lines
// that tie it to a component's lifetime.
// ----------------------------------------------------------------------------

/** Keys the lock never eats.
 *
 *  Escape is how a card is LEFT, and a lock that swallowed it would be a card
 *  that could only be closed with the mouse. Tab is how a keyboard reaches the
 *  card's own buttons; taking it away would make the lock an accessibility
 *  regression rather than a safety one. */
const PASS_THROUGH = new Set(['Escape', 'Tab']);

/**
 * Swallow flight input until the returned function is called.
 *
 * `card` is asked for the element the card is drawn in, each time, rather than
 * handed one — the element is a ref that is still null when the effect runs.
 *
 * PROPAGATION is stopped for every key, always: no listener in the app sees one
 * while a card is up, and that is the whole guarantee. Whose focus it is cannot
 * soften it — letting a key through because the card had a button focused would
 * hand that same key to the flight controls listening on the window behind it,
 * which is the bug this exists for wearing a hat.
 *
 * The DEFAULT ACTION is the part that depends on focus, and it is a different
 * thing: preventing it is what stops the browser pressing whichever button the
 * card left focused. So it is prevented when focus is anywhere else — the body,
 * the canvas, where focus is after every click that opened the card — and left
 * alone when focus is on one of the card's own controls, where SPACE and ENTER
 * pressing the focused button is exactly what the pilot asked for. Activation
 * behaviour does not travel with the event, so it survives the stop.
 */
export function attachModalKeyLock(card: () => HTMLElement | null): () => void {
  const swallow = (e: KeyboardEvent) => {
    if (PASS_THROUGH.has(e.code)) return;
    const focused = document.activeElement;
    const onCard = !!focused && focused !== document.body && !!card()?.contains(focused);
    if (!onCard) e.preventDefault();
    e.stopPropagation();
    // Capture-phase siblings on the window would otherwise still see it —
    // `stopPropagation` alone only stops the phases after this one.
    e.stopImmediatePropagation();
  };

  window.addEventListener('keydown', swallow, true);
  window.addEventListener('keyup', swallow, true);
  // Both ends, and for the same reason: a key held as the card opens would
  // otherwise stay "down" behind it, and a key released behind the card would
  // have its keyup swallowed and stay down after it closes.
  resetStick();

  return () => {
    window.removeEventListener('keydown', swallow, true);
    window.removeEventListener('keyup', swallow, true);
    resetStick();
  };
}

/** `attachModalKeyLock` for as long as `active` is true. */
export function useModalKeyLock(active: boolean, card: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    return attachModalKeyLock(() => card.current);
  }, [active, card]);
}
